#!/usr/bin/env npx tsx

/**
 * KarpeSlop: finds the patterns that slip into TypeScript and JavaScript when
 * generated code is not carefully reviewed.
 *
 * Built-in rules run on the TypeScript AST (rules.ts) and on real module
 * resolution (imports.ts). User-defined customPatterns from .karpesloprc.json
 * are plain line regexes.
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import {
  RULES,
  analyzeSource,
  findUnsafeAssertions,
  getRule,
  isTestPath,
  type Severity,
  type UnsafeAssertionFinding
} from './rules.ts';
import { checkImports, npmRegistryLookup, type RegistryLookup } from './imports.ts';

const globSync = glob.sync;
const globEscape = glob.escape;

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
const OVERRIDE_SEVERITIES: ReadonlyArray<Severity | 'off'> = [...SEVERITIES, 'off'];

interface AISlopIssue {
  type: string;
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: Severity;
  fix?: string;
}

interface ConsolidatedIssue {
  type: string;
  file: string;
  code: string;
  message: string;
  severity: Severity;
  location: string[];
}

interface DetectionPattern {
  id: string;
  pattern: RegExp;
  message: string;
  severity: Severity;
  fix?: string;
  learnMore?: string;
}

interface CustomPatternConfig {
  id: string;
  pattern: string;
  message: string;
  severity: Severity;
  description?: string;
  fix?: string;
  learnMore?: string;
}

interface KarpeSlopConfig {
  customPatterns?: CustomPatternConfig[];
  ignorePaths?: string[];
  severityOverrides?: Record<string, Severity | 'off'>;
  blockOnCritical?: boolean;
  minPackageAgeDays?: number;
}

interface ScanSummary {
  filesScanned: number;
  linesScanned: number;
}

function isSeverity(value: unknown): value is Severity {
  return SEVERITIES.some(severity => severity === value);
}

function isOverrideSeverity(value: unknown): value is Severity | 'off' {
  return OVERRIDE_SEVERITIES.some(severity => severity === value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries: Array<[string, unknown]> = Object.entries(value);
  return Object.fromEntries(entries);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parse a semver string into the concrete version and whether the original
 * was a floating caret/tilde range.
 *
 * We intentionally only treat `^` and `~` as eligible for the package-age
 * check because those are the common semver ranges that drift on install.
 * Broader operators like `>=`, `1.x`, or `latest` are not resolved here.
 */
export function parseVersionRange(version: string): { actualVersion: string; isRange: boolean } {
  if (version.startsWith('^') || version.startsWith('~')) {
    return { actualVersion: version.slice(1), isRange: true };
  }
  return { actualVersion: version, isRange: false };
}

/**
 * Run an array of async tasks with bounded concurrency. Used to throttle
 * outbound HTTP calls to the npm registry (which rate-limits unauthenticated
 * callers at ~600 req/min).
 */
async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency: number, shouldStop?: () => boolean): Promise<Array<T | undefined>> {
  const results: Array<T | undefined> = Array.from({ length: tasks.length }, () => undefined);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      if (shouldStop?.()) return;
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

export function shouldAnalyzePathInQuietMode(filePath: string, rootDir: string, coreAppDirs: readonly string[]): boolean {
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const base = path.basename(filePath);
  if (base === 'package.json' || base === 'package-lock.json') {
    return true;
  }
  return coreAppDirs.some(dir => relativePath.startsWith(dir));
}

export function isRegistryBackedLockfileEntry(pkgPath: string): boolean {
  return pkgPath.includes('node_modules/');
}

export function hasOnlyFreshPackageWarnings(
  issues: ReadonlyArray<Pick<AISlopIssue, 'type'>>
): boolean {
  return issues.length > 0 && issues.every(issue => issue.type === 'fresh_package_version');
}

/**
 * Exit code for a finished scan: 1 when anything at medium severity or above
 * was found, ignoring package-freshness warnings. Low-severity findings are
 * informational and never fail a build.
 */
export function exitCodeFor(issues: ReadonlyArray<Pick<AISlopIssue, 'type' | 'severity'>>): number {
  return issues.some(issue => issue.type !== 'fresh_package_version' && issue.severity !== 'low') ? 1 : 0;
}

/**
 * Determine whether a file path should be excluded from analysis.
 *
 * Segment-based matching means any file under e.g. `src/dist/` is still excluded
 * because `dist` exists as a segment. Matching `dist` everywhere is the simpler,
 * reliable choice for a build-artifact filter.
 */
export function isExcludedPath(filePath: string, rootDir: string, allowOutsideRoot: boolean = false): boolean {
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const isOutsideRoot = relativePath.startsWith('..');
  const pathToMatch = allowOutsideRoot && isOutsideRoot
    ? path.resolve(filePath).replace(/\\/g, '/')
    : relativePath;

  const segments = pathToMatch.split('/');
  const excludedSegment = (name: string) => segments.includes(name);
  return excludedSegment('generated') ||
    excludedSegment('coverage') ||
    excludedSegment('.next') ||
    excludedSegment('node_modules') ||
    excludedSegment('dist') ||
    excludedSegment('build') ||
    excludedSegment('.git') ||
    excludedSegment('out') ||
    excludedSegment('temp') ||
    excludedSegment('types') ||
    segments.some(segment => segment.startsWith('.')) ||
    pathToMatch.endsWith('.d.ts');
}

function isCliPath(filePath: string, content: string): boolean {
  if (content.startsWith('#!')) return true;
  const normalized = filePath.replace(/\\/g, '/');
  return /(^|\/)(bin|scripts|cli)\//.test(normalized) || /(^|[-_.])cli\.[cm]?[jt]sx?$/.test(path.basename(normalized));
}

class AISlopDetector {
  private issues: AISlopIssue[] = [];
  private targetExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
  private manifestFilenames = ['package.json', 'package-lock.json'];

  // Core application directories used by --quiet
  private coreAppDirs = ['app/', 'components/', 'lib/', 'hooks/', 'services/', 'src/'];
  private customPatterns: DetectionPattern[] = [];
  private severityOverrides = new Map<string, Severity | 'off'>();
  private config: KarpeSlopConfig = {};
  private customIgnorePaths: string[] = [];
  private npmPackageCache: Map<string, Record<string, string>> = new Map();
  private registryWarningLogged = false;
  private registryUnavailable = false;
  private reportedFreshPackageKeys = new Set<string>();
  private targetPaths: string[] = [];
  private summary: ScanSummary = { filesScanned: 0, linesScanned: 0 };

  constructor(private rootDir: string, targetPaths?: string[], private registryLookup: RegistryLookup = npmRegistryLookup) {
    this.loadConfig();
    if (targetPaths && targetPaths.length > 0) {
      this.targetPaths = targetPaths.map(p =>
        path.isAbsolute(p) ? p : path.resolve(this.rootDir, p)
      );
    }
  }

  /**
   * Validate configuration structure. Throws with a specific message on the
   * first invalid field.
   */
  private validateConfig(config: unknown): KarpeSlopConfig {
    const cfg = asRecord(config);
    if (cfg === undefined) {
      throw new Error('Config must be an object');
    }
    const result: KarpeSlopConfig = {};

    if (cfg.customPatterns !== undefined) {
      if (!Array.isArray(cfg.customPatterns)) {
        throw new Error('customPatterns must be an array');
      }
      result.customPatterns = cfg.customPatterns.map((entry: unknown, i: number) => {
        const pattern = asRecord(entry) ?? {};
        const { id, message, severity } = pattern;
        const source = pattern.pattern;
        if (typeof id !== 'string' || id === '') {
          throw new Error(`customPatterns[${i}].id must be a string`);
        }
        if (typeof source !== 'string' || source === '') {
          throw new Error(`customPatterns[${i}].pattern must be a string`);
        }
        if (typeof message !== 'string' || message === '') {
          throw new Error(`customPatterns[${i}].message must be a string`);
        }
        if (!isSeverity(severity)) {
          throw new Error(`customPatterns[${i}].severity must be one of: ${SEVERITIES.join(', ')}`);
        }
        try {
          new RegExp(source, 'gi');
        } catch {
          throw new Error(`customPatterns[${i}].pattern is not a valid regex: ${source}`);
        }
        return {
          id,
          pattern: source,
          message,
          severity,
          description: optionalString(pattern.description),
          fix: optionalString(pattern.fix),
          learnMore: optionalString(pattern.learnMore)
        };
      });
    }

    if (cfg.severityOverrides !== undefined) {
      const overrides = asRecord(cfg.severityOverrides);
      if (overrides === undefined) {
        throw new Error('severityOverrides must be an object');
      }
      const validated: Record<string, Severity | 'off'> = {};
      for (const [key, value] of Object.entries(overrides)) {
        if (!isOverrideSeverity(value)) {
          throw new Error(`severityOverrides.${key} must be one of: ${OVERRIDE_SEVERITIES.join(', ')}`);
        }
        validated[key] = value;
      }
      result.severityOverrides = validated;
    }

    if (cfg.ignorePaths !== undefined) {
      if (!Array.isArray(cfg.ignorePaths)) {
        throw new Error('ignorePaths must be an array of strings');
      }
      result.ignorePaths = cfg.ignorePaths.map((entry: unknown, i: number) => {
        if (typeof entry !== 'string') {
          throw new Error(`ignorePaths[${i}] must be a string`);
        }
        return entry;
      });
    }

    if (cfg.minPackageAgeDays !== undefined) {
      const v = cfg.minPackageAgeDays;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new Error('minPackageAgeDays must be a finite non-negative number');
      }
      result.minPackageAgeDays = v;
    }

    if (typeof cfg.blockOnCritical === 'boolean') {
      result.blockOnCritical = cfg.blockOnCritical;
    }

    return result;
  }

  /**
   * Load configuration from .karpesloprc.json if it exists
   */
  private loadConfig(): void {
    const configPaths = [
      path.join(this.rootDir, '.karpesloprc.json'),
      path.join(this.rootDir, '.karpesloprc'),
      path.join(this.rootDir, 'karpeslop.config.json')
    ];

    for (const configPath of configPaths) {
      if (!fs.existsSync(configPath)) continue;
      try {
        const rawConfig: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this.config = this.validateConfig(rawConfig);
        console.log(`Loaded config from ${path.basename(configPath)}\n`);

        for (const customPattern of this.config.customPatterns ?? []) {
          this.customPatterns.push({
            id: customPattern.id,
            pattern: new RegExp(customPattern.pattern, 'gi'),
            message: customPattern.description
              ? `${customPattern.message} (${customPattern.description})`
              : customPattern.message,
            severity: customPattern.severity,
            fix: customPattern.fix,
            learnMore: customPattern.learnMore
          });
        }

        for (const [ruleId, severity] of Object.entries(this.config.severityOverrides ?? {})) {
          this.severityOverrides.set(ruleId, severity);
        }

        this.customIgnorePaths = this.config.ignorePaths ?? [];
        break; // Stop after finding first valid config
      } catch (error) {
        console.warn(`Failed to parse config at ${configPath}:`, error);
      }
    }
  }

  private severityOf(ruleId: string, fallback: Severity): Severity | 'off' {
    return this.severityOverrides.get(ruleId) ?? getRule(ruleId)?.severity ?? fallback;
  }

  /**
   * Run detection across the codebase or the explicit target paths.
   */
  async detect(quiet: boolean = false) {
    console.log('Scanning for AI slop patterns...\n');

    let filesToAnalyze: string[];

    if (this.targetPaths.length > 0) {
      const resolvedTargetFiles = this.resolveTargetPaths();
      if (resolvedTargetFiles.length === 0) {
        throw new Error('No valid target files found for the supplied paths');
      }
      filesToAnalyze = quiet
        ? resolvedTargetFiles.filter(file => this.shouldAnalyzeInQuietMode(file))
        : resolvedTargetFiles;
    } else {
      const allFiles = this.findAllFiles();
      filesToAnalyze = quiet
        ? allFiles.filter(file => this.shouldAnalyzeInQuietMode(file))
        : allFiles;
    }

    const codeFiles = filesToAnalyze.filter(file => !this.manifestFilenames.includes(path.basename(file)));
    for (const file of filesToAnalyze) {
      await this.analyzeFile(file, quiet);
    }
    await this.analyzeImports(codeFiles, quiet);

    this.summary = {
      filesScanned: codeFiles.length,
      linesScanned: codeFiles.reduce((sum, file) => sum + fs.readFileSync(file, 'utf-8').split('\n').length, 0)
    };
    this.issues.sort((a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line);

    this.generateReport();
    return this.issues;
  }

  private getGlobIgnorePatterns(): string[] {
    return [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'generated/**',
      '.vercel/**',
      '.git/**',
      '**/types/**',
      '**/node_modules/**',
      '**/.*',
      '**/*.d.ts',
      '**/coverage/**',
      '**/out/**',
      '**/temp/**',
      ...this.customIgnorePaths
    ];
  }

  private shouldAnalyzeInQuietMode(filePath: string): boolean {
    return shouldAnalyzePathInQuietMode(filePath, this.rootDir, this.coreAppDirs) && !isTestPath(filePath);
  }

  private isIgnoredByConfig(filePath: string): boolean {
    const relativePath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    if (relativePath.startsWith('..')) {
      return false;
    }

    return globSync(globEscape(relativePath), {
      cwd: this.rootDir,
      ignore: this.getGlobIgnorePatterns()
    }).length === 0;
  }

  private findCodeAndManifests(baseDir: string, allowOutsideRoot: boolean): string[] {
    const found: string[] = [];
    for (const ext of this.targetExtensions) {
      const pattern = path.join(baseDir, `**/*${ext}`).replace(/\\/g, '/');
      found.push(...globSync(pattern, { ignore: this.getGlobIgnorePatterns() }));
    }
    // Manifests at the root and below it, for package-age checks in monorepos.
    for (const name of this.manifestFilenames) {
      const rootManifestPath = path.join(baseDir, name);
      if (fs.existsSync(rootManifestPath) && !this.isIgnoredByConfig(rootManifestPath)) {
        found.push(rootManifestPath);
      }
      const nestedPattern = path.join(baseDir, '**', name).replace(/\\/g, '/');
      found.push(...globSync(nestedPattern, { ignore: this.getGlobIgnorePatterns() }));
    }
    return found.filter(file => !isExcludedPath(file, this.rootDir, allowOutsideRoot));
  }

  /**
   * Find all TypeScript/JavaScript files in the project, plus manifest files
   */
  private findAllFiles(): string[] {
    return [...new Set(this.findCodeAndManifests(this.rootDir, false))];
  }

  /**
   * Resolve target paths (files and directories) passed via CLI
   * Expands directories into their scannable files, validates files exist and have correct extensions
   */
  private resolveTargetPaths(): string[] {
    const resolved: string[] = [];

    for (const targetPath of this.targetPaths) {
      if (!fs.existsSync(targetPath)) {
        console.warn(`Target path does not exist, skipping: ${targetPath}`);
        continue;
      }

      const stat = fs.statSync(targetPath);

      if (stat.isFile()) {
        const ext = path.extname(targetPath);
        const base = path.basename(targetPath);
        const isManifest = ext === '.json' && this.manifestFilenames.includes(base);
        if (this.isIgnoredByConfig(targetPath)) {
          console.warn(`Target file matches ignore paths, skipping: ${targetPath}`);
        } else if (isExcludedPath(targetPath, this.rootDir, true)) {
          console.warn(`Target file is in an excluded path, skipping: ${targetPath}`);
        } else if (this.targetExtensions.includes(ext) || isManifest) {
          resolved.push(targetPath);
        } else {
          console.warn(`Target file has unsupported extension (${ext}), skipping: ${targetPath}`);
        }
      } else if (stat.isDirectory()) {
        resolved.push(...this.findCodeAndManifests(targetPath, true));
      }
    }

    return [...new Set(resolved)];
  }

  private record(issue: Omit<AISlopIssue, 'severity'>, fallbackSeverity: Severity): void {
    const severity = this.severityOf(issue.type, fallbackSeverity);
    if (severity === 'off') return;
    this.issues.push({ ...issue, severity });
  }

  /**
   * Analyze a single file with the AST rules and any custom patterns.
   */
  private async analyzeFile(filePath: string, quiet: boolean = false) {
    if (this.manifestFilenames.includes(path.basename(filePath))) {
      await this.analyzePackageVersions(filePath, fs.readFileSync(filePath, 'utf-8'));
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const isTestFile = isTestPath(path.relative(this.rootDir, filePath)) || isTestPath(path.basename(filePath));
    if (quiet && isTestFile) return;
    const isCliFile = isCliPath(path.relative(this.rootDir, filePath), content);

    const findings = analyzeSource(content, filePath);
    const unsafeCasts: UnsafeAssertionFinding[] = /\.[cm]?tsx?$/.test(filePath) ? findUnsafeAssertions(content, filePath) : [];

    const all = [
      ...findings,
      ...unsafeCasts.map(({ type, line, column, code }) => ({ type, line, column, code, message: undefined, fix: undefined }))
    ];

    for (const finding of all) {
      const rule = getRule(finding.type);
      if (rule === undefined) continue;
      if (rule.skipTests && isTestFile) continue;
      if (finding.type === 'production_console_log' && isCliFile) continue;
      this.record({
        type: finding.type,
        file: filePath,
        line: finding.line,
        column: finding.column,
        code: finding.code,
        message: finding.message ?? rule.message,
        fix: finding.fix ?? rule.fix
      }, rule.severity);
    }

    // User-defined line patterns
    if (this.customPatterns.length > 0) {
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        for (const pattern of this.customPatterns) {
          const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
          let match: RegExpExecArray | null;
          while ((match = regex.exec(line)) !== null) {
            if (match[0] === '') regex.lastIndex++;
            this.record({
              type: pattern.id,
              file: filePath,
              line: index + 1,
              column: match.index + 1,
              code: match[0],
              message: pattern.message,
              fix: pattern.fix
            }, pattern.severity);
          }
        }
      });
    }
  }

  private async analyzeImports(codeFiles: string[], quiet: boolean): Promise<void> {
    const files = quiet ? codeFiles.filter(file => !isTestPath(file)) : codeFiles;
    const findings = await checkImports(files, this.rootDir, this.registryLookup);
    for (const finding of findings) {
      const rule = getRule(finding.type);
      this.record({
        type: finding.type,
        file: finding.file,
        line: finding.line,
        column: finding.column,
        code: finding.code,
        message: finding.message,
        fix: finding.fix ?? rule?.fix
      }, rule?.severity ?? 'high');
    }
  }

  /**
   * Analyze package.json or package-lock.json for fresh (unstable) package versions
   * Flags packages updated less than minPackageAgeDays ago (default 7)
   */
  private async analyzePackageVersions(filePath: string, content: string): Promise<void> {
    const minAgeDays = this.config.minPackageAgeDays ?? 7;
    const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;

    const packageEntries: Array<{ scopeKey: string; sourceId: string; pkgName: string; version: string }> = [];
    const lockfileRoot = path.dirname(filePath);
    const normalizePath = (input: string) => input.replace(/\\/g, '/');
    const lockfileScopeKey = (pkgPath: string): string => {
      const normalizedPkgPath = normalizePath(pkgPath);
      const nodeModulesIndex = normalizedPkgPath.lastIndexOf('/node_modules/');
      const scopeRelative = nodeModulesIndex !== -1
        ? normalizedPkgPath.slice(0, nodeModulesIndex)
        : normalizedPkgPath.startsWith('node_modules/')
          ? ''
          : normalizedPkgPath;

      return normalizePath(path.resolve(lockfileRoot, scopeRelative || '.'));
    };
    const collectLegacyLockfileEntries = (dependencies: unknown, trail: string[] = []): void => {
      for (const [depName, depInfo] of Object.entries(asRecord(dependencies) ?? {})) {
        const info = asRecord(depInfo);
        if (info === undefined) continue;

        const version = typeof info.version === 'string' ? info.version : '';
        const pkgName = typeof info.name === 'string' && info.name ? info.name : depName;
        const scopeKey = normalizePath(lockfileRoot);
        const sourceId = ['dependencies', ...trail, depName].join('/');

        if (pkgName && version) {
          packageEntries.push({ scopeKey, sourceId, pkgName, version });
        }

        if (info.dependencies !== undefined) {
          collectLegacyLockfileEntries(info.dependencies, [...trail, depName]);
        }
      }
    };

    let pkg: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(content);
      pkg = asRecord(parsed);
    } catch {
      return;
    }
    if (pkg === undefined) return;

    if (filePath.endsWith('package-lock.json')) {
      const lockPackages = asRecord(pkg.packages);
      if (lockPackages !== undefined) {
        for (const [pkgPath, pkgInfo] of Object.entries(lockPackages)) {
          if (pkgPath === '' || pkgPath === 'node_modules/') continue;
          // Workspace entries like `packages/ui` are local packages, not
          // registry-installed dependencies, so they should not be checked
          // for package freshness.
          if (!isRegistryBackedLockfileEntry(pkgPath)) continue;
          const info = asRecord(pkgInfo);
          if (info === undefined || typeof info.version !== 'string') continue;
          const pkgName = typeof info.name === 'string' && info.name
            ? info.name
            : pkgPath.split('node_modules/').pop() || pkgPath;
          packageEntries.push({ scopeKey: lockfileScopeKey(pkgPath), sourceId: pkgPath, pkgName, version: info.version });
        }
      } else if (pkg.dependencies !== undefined) {
        collectLegacyLockfileEntries(pkg.dependencies);
      }
    } else {
      const packageJsonScopeKey = normalizePath(path.dirname(filePath));
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [pkgName, version] of Object.entries(asRecord(pkg[key]) ?? {})) {
          if (typeof version === 'string') {
            packageEntries.push({ scopeKey: packageJsonScopeKey, sourceId: key, pkgName, version });
          }
        }
      }
    }

    const entries = packageEntries
      .map(({ scopeKey, sourceId, pkgName, version }) => ({ scopeKey, sourceId, pkgName, ...parseVersionRange(version) }))
      // Keep the rule narrow on purpose: only caret/tilde ranges are treated
      // as "fresh package" candidates in package.json. package-lock.json is
      // always checked because it contains the resolved version.
      .filter(({ isRange }) => isRange || filePath.endsWith('package-lock.json'));

    // Bound concurrency: npm registry rate-limits unauthenticated callers at
    // ~600 req/min, and a typical package-lock.json has 200-1000 deps.
    const NPM_CONCURRENCY = 5;
    const ageInfos = await pLimit(
      entries.map(({ scopeKey, sourceId, pkgName, actualVersion }) => () =>
        this.getNpmPackageAge(pkgName, actualVersion)
          .then(ageInfo => ({ scopeKey, sourceId, pkgName, version: actualVersion, ageInfo }))
      ),
      NPM_CONCURRENCY,
      () => this.registryUnavailable
    );

    for (const ageInfoResult of ageInfos) {
      if (!ageInfoResult) {
        continue;
      }

      const { scopeKey, sourceId, pkgName, version, ageInfo } = ageInfoResult;
      if (ageInfo && ageInfo.ageMs < minAgeMs) {
        const issueKey = `${scopeKey}|${pkgName}|${version}`;
        if (this.reportedFreshPackageKeys.has(issueKey)) {
          continue;
        }
        this.reportedFreshPackageKeys.add(issueKey);
        const daysOld = Math.floor(ageInfo.ageMs / (24 * 60 * 60 * 1000));
        const isLockfile = filePath.endsWith('package-lock.json');
        this.record({
          type: 'fresh_package_version',
          file: filePath,
          line: 1,
          column: 1,
          code: isLockfile ? `${sourceId}: ${pkgName}@${version}` : `"${pkgName}": "${version}"`,
          message: `${isLockfile ? `Package '${pkgName}' from ${sourceId}` : `Package '${pkgName}'`} v${version} was published ${daysOld} day${daysOld === 1 ? '' : 's'} ago (threshold: ${minAgeDays} days).`
        }, 'medium');
      }
    }
  }

  /**
   * Get npm package version age info with caching.
   * Cache stores the full `time` map from the registry so repeated lookups
   * for different versions of the same package don't re-fetch the package.
   */
  private async getNpmPackageAge(pkgName: string, version: string): Promise<{ version: string; time: string; ageMs: number } | null> {
    const now = Date.now();

    const cached = this.npmPackageCache.get(pkgName);
    if (cached) {
      // Cached map contains every version the registry knows about. If our
      // requested version isn't here, the version genuinely doesn't exist
      // (or was unpublished) — don't refetch, that would just re-fetch the
      // same map we already have.
      const versionTime = cached[version];
      if (!versionTime) return null;
      const publishTime = new Date(versionTime).getTime();
      return { version, time: versionTime, ageMs: now - publishTime };
    }

    if (this.registryUnavailable || process.env.KARPESLOP_OFFLINE === '1') {
      return null;
    }

    const times: Record<string, string> = {};
    try {
      const url = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) return null;
      const body: unknown = await response.json();
      for (const [key, value] of Object.entries(asRecord(asRecord(body)?.time) ?? {})) {
        if (typeof value === 'string') times[key] = value;
      }
    } catch {
      if (!this.registryWarningLogged) {
        console.warn('Could not reach the npm registry. Package age checks are skipped.');
        this.registryWarningLogged = true;
      }
      this.registryUnavailable = true;
      return null;
    }

    this.npmPackageCache.set(pkgName, times);
    const versionTime = times[version];
    if (!versionTime) return null;
    const publishTime = new Date(versionTime).getTime();
    return { version, time: versionTime, ageMs: now - publishTime };
  }

  private describeRule(ruleId: string): { why?: string; learnMore?: string } {
    const rule = getRule(ruleId);
    if (rule !== undefined) return { why: rule.why, learnMore: rule.learnMore };
    if (ruleId === 'fresh_package_version') {
      return { why: 'New releases are where typosquats and compromised versions usually land. Waiting a few days lets the registry and the community catch them.' };
    }
    const custom = this.customPatterns.find(pattern => pattern.id === ruleId);
    return { learnMore: custom?.learnMore };
  }

  /**
   * Print findings grouped by rule, most severe first.
   */
  private generateReport() {
    const { filesScanned, linesScanned } = this.summary;
    console.log(`Scanned ${filesScanned} file${filesScanned === 1 ? '' : 's'} (${linesScanned.toLocaleString('en-US')} lines).\n`);

    if (this.issues.length === 0) {
      console.log('No findings.');
      return;
    }

    const byRule = new Map<string, AISlopIssue[]>();
    for (const issue of this.issues) {
      const group = byRule.get(issue.type) ?? [];
      group.push(issue);
      byRule.set(issue.type, group);
    }

    const MAX_LOCATIONS = 10;
    for (const [ruleId, issues] of byRule) {
      const first = issues[0];
      const { why, learnMore } = this.describeRule(ruleId);
      const sharedMessage = issues.every(issue => issue.message === first.message);
      console.log(`[${first.severity}] ${ruleId} (${issues.length})`);
      if (sharedMessage) console.log(`  ${first.message}`);
      if (why) console.log(`  Why: ${why}`);
      const sharedFix = issues.every(issue => issue.fix === first.fix) ? first.fix : undefined;
      if (sharedFix) console.log(`  Fix: ${sharedFix}`);
      if (learnMore) console.log(`  Docs: ${learnMore}`);
      for (const issue of issues.slice(0, MAX_LOCATIONS)) {
        const where = `${path.relative(this.rootDir, issue.file)}:${issue.line}:${issue.column}`;
        console.log(`    ${where}  ${issue.code}`);
        if (!sharedMessage) console.log(`      ${issue.message}`);
        if (!sharedFix && issue.fix) console.log(`      Fix: ${issue.fix}`);
      }
      if (issues.length > MAX_LOCATIONS) {
        console.log(`    ... and ${issues.length - MAX_LOCATIONS} more`);
      }
      console.log('');
    }

    const counts = SEVERITIES.map(severity => `${this.issues.filter(issue => issue.severity === severity).length} ${severity}`);
    const files = new Set(this.issues.map(issue => issue.file)).size;
    const perKloc = linesScanned > 0 ? (this.issues.length / linesScanned) * 1000 : 0;
    console.log(`${this.issues.length} finding${this.issues.length === 1 ? '' : 's'} (${counts.join(', ')}) in ${files} file${files === 1 ? '' : 's'}, ${perKloc.toFixed(1)} per 1,000 lines.`);
    if (hasOnlyFreshPackageWarnings(this.issues)) {
      console.log('Only package-age warnings were found.');
    }
    console.log('To turn a rule off or change its severity, use severityOverrides in .karpesloprc.json.');
  }

  /**
   * Get the current configuration
   */
  getConfig(): KarpeSlopConfig {
    return { ...this.config };
  }

  /**
   * Get the number of issues found
   */
  getIssueCount(): number {
    return this.issues.length;
  }

  /**
   * Get issues by severity level
   */
  getIssuesBySeverity(severity: Severity): AISlopIssue[] {
    return this.issues.filter(issue => issue.severity === severity);
  }

  /**
   * Consolidate issues by grouping identical issues (same type, file, code, message, severity)
   * into single entries with a location array
   */
  private consolidateIssues(): ConsolidatedIssue[] {
    const issueMap = new Map<string, ConsolidatedIssue>();

    for (const issue of this.issues) {
      const key = `${issue.type}|${issue.file}|${issue.code}|${issue.message}|${issue.severity}`;
      const location = `${issue.line}:${issue.column}`;
      const existing = issueMap.get(key);
      if (existing !== undefined) {
        existing.location.push(location);
      } else {
        issueMap.set(key, {
          type: issue.type,
          file: issue.file,
          code: issue.code,
          message: issue.message,
          severity: issue.severity,
          location: [location]
        });
      }
    }

    return Array.from(issueMap.values());
  }

  /**
   * Export results to JSON for further processing
   */
  exportResults(outputPath: string) {
    const consolidatedIssues = this.consolidateIssues();

    const countOccurrences = (issues: ConsolidatedIssue[]) =>
      issues.reduce((sum, issue) => sum + issue.location.length, 0);

    const bySeverity = Object.fromEntries(SEVERITIES.map(severity => [
      severity,
      countOccurrences(consolidatedIssues.filter(issue => issue.severity === severity))
    ]));

    const byTypeMap = new Map<string, ConsolidatedIssue[]>();
    for (const issue of consolidatedIssues) {
      const group = byTypeMap.get(issue.type) ?? [];
      group.push(issue);
      byTypeMap.set(issue.type, group);
    }

    const results = {
      timestamp: new Date().toISOString(),
      filesScanned: this.summary.filesScanned,
      linesScanned: this.summary.linesScanned,
      uniqueIssues: consolidatedIssues.length,
      totalOccurrences: countOccurrences(consolidatedIssues),
      bySeverity,
      byType: Array.from(byTypeMap.entries()).map(([type, issues]) => ({
        type,
        occurrences: countOccurrences(issues),
        uniqueIssues: issues.length,
        sample: issues.slice(0, 3).map(issue => ({
          file: path.relative(this.rootDir, issue.file),
          locations: issue.location.slice(0, 3),
          code: issue.code
        }))
      })),
      issues: consolidatedIssues
    };

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nReport written to ${outputPath}`);
  }
}

export function splitCliArgs(args: readonly string[]): { flagArgs: string[]; targetPaths: string[] } {
  // Support -- separator: everything after -- is treated as a path, even if it starts with -
  const doubleDashIdx = args.indexOf('--');
  if (doubleDashIdx !== -1) {
    return { flagArgs: args.slice(0, doubleDashIdx), targetPaths: args.slice(doubleDashIdx + 1) };
  }
  return { flagArgs: args.filter(a => a.startsWith('-')), targetPaths: args.filter(a => !a.startsWith('-')) };
}

function printHelp(): void {
  const ruleLines = RULES.map(rule => `  ${rule.id.padEnd(30)} ${rule.severity.padEnd(9)} ${rule.message}`);
  console.log(`
Usage: karpeslop [options] [path...]

Arguments:
  path...         File or directory path(s) to scan (scans the current directory if omitted)

Options:
  --help, -h     Show this help message
  --quiet, -q    Scan only core app directories (app/, components/, lib/, hooks/, services/, src/), skip tests
  --strict, -s   Exit with code 2 if critical findings (wrong imports, nonexistent packages) are present
  --version, -v  Show version information
  --             End of flags; treat remaining args as paths (even if they start with -)

Exit codes:
  0 - No findings at medium severity or above (package-age warnings never fail)
  1 - Findings at medium severity or above
  2 - Critical findings (--strict only)

Rules:
${ruleLines.join('\n')}
  ${'fresh_package_version'.padEnd(30)} ${'medium'.padEnd(9)} Dependency version was published very recently.

Inline suppression comments are not supported. Change a rule's severity, or
turn it off, with severityOverrides in .karpesloprc.json.
`);
}

async function runIfMain() {
  const rootDir = process.cwd();

  const args = process.argv.slice(2);
  const { flagArgs, targetPaths } = splitCliArgs(args);

  // Check for help options first, before constructing the detector
  // (so a bad config doesn't break --help)
  if (flagArgs.includes('--help') || flagArgs.includes('-h') || flagArgs.includes('/?')) {
    printHelp();
    process.exit(0);
  }

  if (flagArgs.includes('--version') || flagArgs.includes('-v')) {
    try {
      const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json');
      const packageData = asRecord(JSON.parse(fs.readFileSync(packagePath, 'utf8')));
      console.log(`karpeslop/${optionalString(packageData?.version) ?? 'unknown'} ${process.platform}-${process.arch} node-${process.version}`);
    } catch {
      console.log('karpeslop/unknown');
    }
    process.exit(0);
  }

  const detector = new AISlopDetector(rootDir, targetPaths.length > 0 ? targetPaths : undefined);
  const quiet = flagArgs.includes('--quiet') || flagArgs.includes('-q');
  const strict = flagArgs.includes('--strict') || flagArgs.includes('-s') || detector.getConfig().blockOnCritical === true;

  try {
    const issues = await detector.detect(quiet);
    const outputPath = path.join(rootDir, 'ai-slop-report.json');
    detector.exportResults(outputPath);

    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (strict && criticalIssues.length > 0) {
      const criticalFiles = [...new Set(criticalIssues.map(i => path.relative(rootDir, i.file)))];
      console.log(`\nSTRICT MODE: ${criticalIssues.length} critical finding(s) in: ${criticalFiles.join(', ')}`);
      process.exit(2);
    }

    process.exit(exitCodeFor(issues));
  } catch (error) {
    console.error('KarpeSlop failed:', error);
    process.exit(1);
  }
}

// Execute only when run as the main module, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runIfMain().catch(error => {
    console.error('KarpeSlop failed:', error);
    process.exit(1);
  });
}

export { findUnsafeAssertions };
export { AISlopDetector };
export type { AISlopIssue, ConsolidatedIssue, DetectionPattern, UnsafeAssertionFinding };
