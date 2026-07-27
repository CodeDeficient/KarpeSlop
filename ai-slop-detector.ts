#!/usr/bin/env npx tsx

/**
 * AI Slop Detection Tool for Food Truck Finder Application
 *
 * This tool identifies common AI-generated code patterns that represent "AI Slop"
 * including excessive use of `any` types, unsafe type assertions, and other problematic patterns.
 *
 * Follows industry best practices based on typescript-eslint patterns.
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const globSync = glob.sync;
const globEscape = glob.escape;

interface SlopScoreBreakdown {
  informationUtility: number;
  informationQuality: number;
  style: number;
  total: number;
}

interface AISlopIssue {
  type: string;
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface UnsafeAssertionFinding {
  type: string;
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  assertionForm: string;
}

interface ConsolidatedIssue {
  type: string;
  file: string;
  code: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  location: string[];
}

interface DetectionPattern {
  id: string;
  pattern: RegExp;
  message: string;
  severity: AISlopIssue['severity'] | 'off';
  description: string;
  fix?: string;           // Phase 2: How to fix this issue
  learnMore?: string;     // Phase 2: Link to documentation
  skipTests?: boolean;
  skipMocks?: boolean;
}

// Phase 6: Configuration file support
interface CustomPatternConfig {
  id: string;
  pattern: string;  // Will be converted to RegExp
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description?: string;
  fix?: string;
  learnMore?: string;
}

interface KarpeSlopConfig {
  customPatterns?: CustomPatternConfig[];
  ignorePaths?: string[];
  severityOverrides?: Record<string, 'critical' | 'high' | 'medium' | 'low' | 'off'>;
  blockOnCritical?: boolean;
  minPackageAgeDays?: number;
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
async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency: number, shouldStop?: () => boolean): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
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
    pathToMatch.endsWith('.d.ts') ||
    (!isOutsideRoot && (pathToMatch.endsWith('ai-slop-detector.ts') ||
      pathToMatch.endsWith('improved-ai-slop-detector.ts')));
}

export function findUnsafeAssertions(sourceText: string, fileName: string): UnsafeAssertionFinding[] {
  if (fileName.endsWith('.d.ts')) return [];

  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const findings: UnsafeAssertionFinding[] = [];
  const lines = sourceText.split('\n');

  const prevLineIsSuppressed = (line: number): boolean => {
    if (line <= 1) return false;
    const prevLine = lines[line - 2];
    return (
      prevLine.includes('@ts-expect-error') ||
      prevLine.includes('@ts-ignore') ||
      prevLine.includes('eslint-disable-next-line')
    );
  };

  function isUnsafeObjectType(type: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(type)) {
    const name = ts.isIdentifier(type.typeName) ? type.typeName.text : '';
    if (name === 'Record') return true;
  }
  if (ts.isTypeLiteralNode(type)) return true;
  return false;
}

function isArrayType(type: ts.TypeNode): boolean {
  if (ts.isArrayTypeNode(type)) return true;
  if (ts.isTypeReferenceNode(type)) {
    const name = ts.isIdentifier(type.typeName) ? type.typeName.text : '';
    if (name === 'Array' && type.typeArguments && type.typeArguments.length > 0) return true;
  }
  return false;
}

function visit(node: ts.Node) {
    if (ts.isAsExpression(node)) {
      const sourceLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const column = sourceFile.getLineAndCharacterOfPosition(node.getStart()).character + 1;

      if (prevLineIsSuppressed(sourceLine)) {
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isAsExpression(node.expression) && node.expression.type.kind === ts.SyntaxKind.UnknownKeyword) {
        const code = sourceText.slice(node.getStart(sourceFile), node.end);
        findings.push({
          type: 'unsafe_double_type_assertion',
          file: fileName,
          line: sourceLine,
          column,
          code,
          message: "Found unsafe double type assertion via 'as unknown as'. Use proper type guards or validation instead.",
          severity: 'high',
          assertionForm: 'as_unknown_as',
        });
      } else if (isUnsafeObjectType(node.type)) {
        const code = sourceText.slice(node.getStart(sourceFile), node.end);
        findings.push({
          type: 'unsafe_object_assertion',
          file: fileName,
          line: sourceLine,
          column,
          code,
          message: 'Found unsafe object type assertion. Use proper type guards or runtime validation instead.',
          severity: 'high',
          assertionForm: 'as_object',
        });
      } else if (isArrayType(node.type)) {
        const code = sourceText.slice(node.getStart(sourceFile), node.end);
        findings.push({
          type: 'unsafe_array_assertion',
          file: fileName,
          line: sourceLine,
          column,
          code,
          message: 'Found unsafe array type assertion. Use proper type guards or runtime validation instead.',
          severity: 'high',
          assertionForm: 'as_array',
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

class AISlopDetector {
  private issues: AISlopIssue[] = [];
  private targetExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  private manifestFilenames = ['package.json', 'package-lock.json'];

  // Core application directories to prioritize in reporting
  private coreAppDirs = ['app/', 'components/', 'lib/', 'hooks/', 'services/'];
  private detectionPatterns: DetectionPattern[] = [
    // ==================== AXIS 1: INFORMATION UTILITY (Noise) ====================
    {
      id: 'redundant_self_explanatory_comment',
      pattern: /const\s+(\w+)\s*=\s*\1\s*;?\s*\/\/.?(?:set|assign|store)\s+\1\b/gi,
      message: "Redundant comment explaining variable assignment to itself — peak AI slop",
      severity: 'high',
      description: 'e.g., const count = count; // assign count to count'
    },
    {
      id: 'excessive_boilerplate_comment',
      pattern: /\/\/\s*This (?:function|component|hook|variable|method).* (?:does|is|handles?|returns?|takes?|processes?)/gi,
      message: "Boilerplate comment that restates the obvious — adds zero insight",
      severity: 'medium',
      description: 'AI-generated comments that explain the obvious'
    },
    {
      id: 'debug_log_with_comment',
      pattern: /console\.(log|debug|info)\([^)]+\)\s*;\s*\/\/\s*(?:debug|temp|test|check|log|print)/gi,
      message: "Debug log with apologetic comment — AI trying to justify its existence",
      severity: 'medium',
      description: 'Debugging code that should not be in production',
      skipTests: true
    },

    // ==================== AXIS 2: INFORMATION QUALITY (Hallucinations) ====================
    {
      id: 'hallucinated_react_import',
      pattern: /import\s*{\s*(useRouter|useParams|useSearchParams|Link|Image|Script)\s*}\s*from\s*['"]react['"]/gi,
      message: "Hallucinated React import — these do NOT exist in 'react'",
      severity: 'critical',
      description: 'React-specific APIs are NOT in the react package',
      fix: "Import from correct package: 'next/router', 'next/link', 'next/image', 'next/script'",
      learnMore: 'https://nextjs.org/docs/api-reference/next/router'
    },
    {
      id: 'hallucinated_next_import',
      pattern: /import\s*{\s*(getServerSideProps|getStaticProps|getStaticPaths)\s*}\s*from\s*['"]react['"]/gi,
      message: "Next.js API imported from 'react' — 100% AI hallucination",
      severity: 'critical',
      description: 'Next.js APIs are NOT in the react package',
      fix: "These are page-level exports, not imports. Export them from your page file directly.",
      learnMore: 'https://nextjs.org/docs/basic-features/data-fetching'
    },
    {
      id: 'todo_implementation_placeholder',
      pattern: /\/\/\s*(?:TODO|FIXME|HACK).*(?:implement|add|finish|complete|your code|logic|here)/gi,
      message: "AI gave up and wrote a TODO instead of thinking",
      severity: 'high',
      description: 'Placeholder comments where AI failed to implement',
      fix: "Actually implement the logic, or if blocked, document WHY and create a tracking issue",
      learnMore: 'https://refactoring.guru/smells/comments'
    },
    {
      id: 'assumption_comment',
      pattern: /\b(assuming|assumes?|presumably|apparently|it seems|seems like)\b.{0,50}\b(that|this|the|it)\b/gi,
      message: "AI making unverified assumptions — dangerous in production",
      severity: 'high',
      description: 'Comments indicating unverified assumptions'
    },

    // ==================== AXIS 3: STYLE / TASTE (The Vibe Check) ====================
    {
      id: 'overconfident_comment',
      pattern: /\/\/.*\b(obviously|clearly|simply|just|easy|trivial|basically|literally|of course|naturally|certainly|surely)\b/gi,
      message: "Overconfident comment — AI pretending it understands when it doesn't",
      severity: 'high',
      description: 'Overconfident language indicating false certainty'
    },
    {
      id: 'hedging_uncertainty_comment',
      pattern: /\/\/.*\b(should work|hopefully|probably|might work|try this|i think|seems to|attempting to|looks like|appears to)\b/gi,
      message: "AI hedging its bets — classic sign of low-confidence generation",
      severity: 'high',
      description: 'Uncertain language masked as implementation'
    },
    {
      id: 'unnecessary_iife_wrapper',
      pattern: /\bconst\s+\w+\s*=\s*\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\}\)\(\)/g,
      message: "Unnecessary IIFE wrapper — AI over-engineering a simple async call",
      severity: 'medium',
      description: 'Unnecessarily complex function wrapping'
    },
    {
      id: 'vibe_coded_ternary_abuse',
      pattern: /\?\s*['"][^'"]+['"]\s*:\s*['"][^'"]+['"]\s*\?\s*['"][^'"]+['"]\s*:\s*['"][^'"]+['"]/g,
      message: "Nested ternary hell — AI trying to look clever",
      severity: 'medium',
      description: 'Overly complex nested ternary operations',
      fix: "Extract to a switch statement or a lookup object for better readability"
    },
    {
      id: 'magic_css_value',
      pattern: /(\d{3,4}px|#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsl\(\d+)/g,
      message: "Magic CSS value — extract to design token or const",
      severity: 'low',
      description: 'Hardcoded CSS values that should be constants',
      fix: "Move to CSS variables, theme tokens, or a constants file"
    },

    // ==================== PHASE 5: REACT-SPECIFIC ANTI-PATTERNS ====================
    {
      id: 'useEffect_derived_state',
      pattern: /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*set[A-Z]\w*\([^)]*\)/g,
      message: "useEffect setting state from props/other state — consider useMemo or compute in render",
      severity: 'high',
      description: 'Using useEffect to derive state is often unnecessary',
      fix: "If state depends only on props/other state, compute directly or use useMemo instead",
      learnMore: 'https://react.dev/learn/you-might-not-need-an-effect'
    },
    {
      id: 'useEffect_empty_deps_suspicious',
      pattern: /useEffect\s*\([^,]+,\s*\[\s*\]\s*\)/g,
      message: "useEffect with empty deps — verify this truly should only run on mount",
      severity: 'medium',
      description: 'Empty dependency arrays are often a sign of missing dependencies',
      fix: "Review if effect depends on any props/state. Use eslint-plugin-react-hooks to catch issues.",
      learnMore: 'https://react.dev/reference/react/useEffect#specifying-reactive-dependencies'
    },
    {
      id: 'setState_in_loop',
      pattern: /(?:for|while|forEach|map)\s*\([^)]+\)[^{]*\{[^}]*set[A-Z]\w*\(/g,
      message: "setState inside a loop — may cause multiple re-renders",
      severity: 'high',
      description: 'Calling setState in a loop triggers multiple re-renders',
      fix: "Batch updates by computing the final state outside the loop, then call setState once",
      learnMore: 'https://react.dev/learn/queueing-a-series-of-state-updates'
    },
    {
      id: 'useCallback_no_deps',
      pattern: /useCallback\s*\([^,]+,\s*\[\s*\]\s*\)/g,
      message: "useCallback with empty deps — the callback never updates",
      severity: 'medium',
      description: 'Empty deps means the callback is stale and may use outdated values',
      fix: "Add all values used inside the callback to the dependency array",
      learnMore: 'https://react.dev/reference/react/useCallback'
    },

    // ==================== ORIGINAL PATTERNS ====================
    {
      id: 'any_type_usage',
      pattern: /:\s*any\b/g,
      message: "Found 'any' type usage. Replace with specific type or unknown.",
      severity: 'high',
      description: 'Detects : any type annotations',
      fix: "Replace with 'unknown' and use type guards to narrow, or define a proper interface",
      learnMore: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html'
    },
    {
      id: 'array_any_type',
      pattern: /Array\s*<\s*any\s*>/g,
      message: "Found Array<any> type usage. Replace with specific type or unknown[].",
      severity: 'high',
      description: 'Detects Array<any> patterns'
    },
    {
      id: 'generic_any_type',
      pattern: /<\s*any\s*>/g,
      message: "Found generic <any> type usage. Replace with specific type or unknown.",
      severity: 'high',
      description: 'Detects generic type parameters with any'
    },
    {
      id: 'function_param_any_type',
      pattern: /\(\s*.*\s*:\s*any\s*\)/g,
      message: "Found function parameter with 'any' type. Replace with specific type or unknown.",
      severity: 'high',
      description: 'Detects function parameters with any type'
    },
    {
      id: 'unsafe_type_assertion',
      pattern: /\s+as\s+any\b/g,
      message: "Found unsafe 'as any' type assertion. Use proper type guards or validation.",
      severity: 'high',
      description: 'Detects unsafe as any assertions',
      fix: "Use 'as unknown as TargetType' or implement a runtime type guard with validation",
      learnMore: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates'
    },
    {
      id: 'index_signature_any',
      pattern: /\[\s*["'`]?(\w+)["'`]?[^\]]*\]\s*:\s*any/g,
      message: "Found index signature with 'any' type. Replace with specific type or unknown.",
      severity: 'high',
      description: 'Detects index signatures with any type'
    },
    {
      id: 'missing_error_handling',
      pattern: /\b(fetch|axios|http)\s*\(/g,
      message: "Potential missing error handling for promise. Consider adding try/catch or .catch().",
      severity: 'medium',
      description: 'Detects calls that might need error handling',
      fix: "Wrap in try/catch or add .catch() handler. Consider React Query or SWR for data fetching.",
      learnMore: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch',
      skipTests: true
    },
    {
      id: 'production_console_log',
      pattern: /console\.(log|warn|error|info|debug|trace)\(/g,
      message: "Found console logging in production code. Remove before deployment.",
      severity: 'medium',
      description: 'Detects console logs in production code',
      skipTests: true,
      skipMocks: true
    },
    {
      id: 'todo_comment',
      pattern: /\b(TODO|FIXME|HACK|XXX|BUG)\b/g,
      message: "Found TODO/FIXME/HACK comment indicating incomplete implementation.",
      severity: 'medium',
      description: 'Detects incomplete implementation markers'
    },
    // Note: complex_nested_conditionals is handled separately below with improved logic
    {
      id: 'unsafe_member_access',
      pattern: /\.\s*any\s*\[/g,
      message: "Found potentially unsafe member access on 'any' type.",
      severity: 'high',
      description: 'Detects unsafe member access patterns'
    },
    {
      id: 'unsafe_double_type_assertion',
      pattern: /unused_ast_detected/,
      message: "Found unsafe double type assertion via 'as unknown as'. Use proper type guards or runtime validation.",
      severity: 'high',
      description: 'Detects as unknown as T (AST-based)'
    },
    {
      id: 'unsafe_object_assertion',
      pattern: /unused_ast_detected/,
      message: "Found unsafe object type assertion. Use proper type guards or runtime validation.",
      severity: 'high',
      description: 'Detects as Record<...> or as { ... } (AST-based)'
    },
    {
      id: 'unsafe_array_assertion',
      pattern: /unused_ast_detected/,
      message: "Found unsafe array type assertion. Use proper type guards or runtime validation.",
      severity: 'high',
      description: 'Detects as T[] or as Array<T> (AST-based)'
    }
  ];

  private config: KarpeSlopConfig = {};
  private customIgnorePaths: string[] = [];
  private npmPackageCache: Map<string, Record<string, string>> = new Map();
  private registryWarningLogged = false;
  private registryUnavailable = false;
  private reportedFreshPackageKeys = new Set<string>();
  private targetPaths: string[] = [];

  constructor(private rootDir: string, targetPaths?: string[]) {
    this.loadConfig();
    if (targetPaths && targetPaths.length > 0) {
      this.targetPaths = targetPaths.map(p =>
        path.isAbsolute(p) ? p : path.resolve(this.rootDir, p)
      );
    }
  }

  /**
   * Validate configuration structure (Issue 3 fix)
   * Basic validation without external dependencies
   */
  private validateConfig(config: unknown): KarpeSlopConfig {
    if (typeof config !== 'object' || config === null) {
      throw new Error('Config must be an object');
    }

    const validOverrideSeverities = ['critical', 'high', 'medium', 'low', 'off'];
    const validPatternSeverities = ['critical', 'high', 'medium', 'low'];
    const cfg = config as Record<string, unknown>;

    // Validate customPatterns
    if (cfg.customPatterns !== undefined) {
      if (!Array.isArray(cfg.customPatterns)) {
        throw new Error('customPatterns must be an array');
      }
      for (let i = 0; i < cfg.customPatterns.length; i++) {
        const pattern = cfg.customPatterns[i] as Record<string, unknown>;
        if (!pattern.id || typeof pattern.id !== 'string') {
          throw new Error(`customPatterns[${i}].id must be a string`);
        }
        if (!pattern.pattern || typeof pattern.pattern !== 'string') {
          throw new Error(`customPatterns[${i}].pattern must be a string`);
        }
        if (!pattern.message || typeof pattern.message !== 'string') {
          throw new Error(`customPatterns[${i}].message must be a string`);
        }
        if (!pattern.severity || !validPatternSeverities.includes(pattern.severity as string)) {
          throw new Error(`customPatterns[${i}].severity must be one of: ${validPatternSeverities.join(', ')}`);
        }
        // Validate regex is valid
        try {
          new RegExp(pattern.pattern as string, 'gi');
        } catch (e) {
          throw new Error(`customPatterns[${i}].pattern is not a valid regex: ${pattern.pattern}`);
        }
      }
    }

    // Validate severityOverrides
    if (cfg.severityOverrides !== undefined) {
      if (typeof cfg.severityOverrides !== 'object' || cfg.severityOverrides === null) {
        throw new Error('severityOverrides must be an object');
      }
      for (const [key, value] of Object.entries(cfg.severityOverrides as Record<string, unknown>)) {
        if (!validOverrideSeverities.includes(value as string)) {
          throw new Error(`severityOverrides.${key} must be one of: ${validOverrideSeverities.join(', ')}`);
        }
      }
    }

    // Validate ignorePaths
    if (cfg.ignorePaths !== undefined) {
      if (!Array.isArray(cfg.ignorePaths)) {
        throw new Error('ignorePaths must be an array of strings');
      }
      for (let i = 0; i < cfg.ignorePaths.length; i++) {
        if (typeof cfg.ignorePaths[i] !== 'string') {
          throw new Error(`ignorePaths[${i}] must be a string`);
        }
      }
    }

    // Validate minPackageAgeDays
    if (cfg.minPackageAgeDays !== undefined) {
      const v = cfg.minPackageAgeDays;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new Error('minPackageAgeDays must be a finite non-negative number');
      }
    }

    return cfg as KarpeSlopConfig;
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
      if (fs.existsSync(configPath)) {
        try {
          const configContent = fs.readFileSync(configPath, 'utf-8');
          const rawConfig = JSON.parse(configContent);

          // Issue 3: Validate config before using
          this.config = this.validateConfig(rawConfig);
          console.log(`📋 Loaded config from ${path.basename(configPath)}\n`);

          // Add custom patterns
          if (this.config.customPatterns) {
            for (const customPattern of this.config.customPatterns) {
              this.detectionPatterns.push({
                id: customPattern.id,
                pattern: new RegExp(customPattern.pattern, 'gi'),
                message: customPattern.message,
                severity: customPattern.severity,
                description: customPattern.description || customPattern.message,
                fix: customPattern.fix,
                learnMore: customPattern.learnMore
              });
            }
            console.log(`   Added ${this.config.customPatterns.length} custom pattern(s)`);
          }

          // Apply severity overrides
          if (this.config.severityOverrides) {
            for (const [patternId, newSeverity] of Object.entries(this.config.severityOverrides)) {
              const pattern = this.detectionPatterns.find(p => p.id === patternId);
              if (pattern) {
                pattern.severity = newSeverity;
              }
            }
          }

          // Store ignore paths
          if (this.config.ignorePaths) {
            this.customIgnorePaths = this.config.ignorePaths;
          }

          break; // Stop after finding first valid config
        } catch (error) {
          console.warn(`⚠️  Failed to parse config at ${configPath}:`, error);
        }
      }
    }
  }

  /**
   * Run the AI Slop detection across the codebase
   */
  async detect(quiet: boolean = false) {
    console.log('🔍 Starting AI Slop detection...\n');

    let filesToAnalyze: string[];

    if (this.targetPaths.length > 0) {
      const resolvedTargetFiles = this.resolveTargetPaths();
      if (resolvedTargetFiles.length === 0) {
        throw new Error('No valid target files found for the supplied paths');
      }
      filesToAnalyze = quiet
        ? resolvedTargetFiles.filter(file => this.shouldAnalyzeInQuietMode(file))
        : resolvedTargetFiles;
      console.log(`🎯 Targeting ${filesToAnalyze.length} file(s) (explicit paths)\n`);
    } else {
      const allFiles = this.findAllFiles();

      filesToAnalyze = quiet
        ? allFiles.filter(file => this.shouldAnalyzeInQuietMode(file))
        : allFiles;

      console.log(`📁 Found ${allFiles.length} files to analyze (${filesToAnalyze.length} in ${quiet ? 'quiet' : 'full'} mode)\n`);
    }

    // 2. Analyze each file for AI Slop patterns
    for (const file of filesToAnalyze) {
      await this.analyzeFile(file, quiet);
    }

    // 3. Report findings
    this.generateReport(quiet);

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
      'scripts/ai-slop-detector.ts',
      'ai-slop-detector.ts',
      'improved-ai-slop-detector.ts',
      ...this.customIgnorePaths
    ];
  }

  private shouldAnalyzeInQuietMode(filePath: string): boolean {
    return shouldAnalyzePathInQuietMode(filePath, this.rootDir, this.coreAppDirs);
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

  /**
   * Find all TypeScript/JavaScript files in the project, plus manifest files
   */
  private findAllFiles(): string[] {
    const allFiles: string[] = [];

    for (const ext of this.targetExtensions) {
      const pattern = path.join(this.rootDir, `**/*${ext}`).replace(/\\/g, '/');
      const files = globSync(pattern, { ignore: this.getGlobIgnorePatterns() });
      const filteredFiles = files.filter(file => !isExcludedPath(file, this.rootDir));
      allFiles.push(...filteredFiles);
    }

    // Also pick up manifest files at the project root and below it for
    // package-age analysis in monorepos/workspaces.
    for (const name of this.manifestFilenames) {
      const rootManifestPath = path.join(this.rootDir, name);
      const nestedPattern = path.join(this.rootDir, '**', name).replace(/\\/g, '/');
      const manifestFiles = [
        ...(fs.existsSync(rootManifestPath) && !this.isIgnoredByConfig(rootManifestPath) && !isExcludedPath(rootManifestPath, this.rootDir)
          ? [rootManifestPath]
          : []),
        ...globSync(nestedPattern, { ignore: this.getGlobIgnorePatterns() })
      ].filter(file => !isExcludedPath(file, this.rootDir));
      allFiles.push(...manifestFiles);
    }

    // Remove duplicates and return
    return [...new Set(allFiles)];
  }

  /**
   * Resolve target paths (files and directories) passed via CLI
   * Expands directories into their scannable files, validates files exist and have correct extensions
   */
  private resolveTargetPaths(): string[] {
    const resolved: string[] = [];

    for (const targetPath of this.targetPaths) {
      if (!fs.existsSync(targetPath)) {
        console.warn(`⚠️  Target path does not exist, skipping: ${targetPath}`);
        continue;
      }

      const stat = fs.statSync(targetPath);

      if (stat.isFile()) {
        const ext = path.extname(targetPath);
        const base = path.basename(targetPath);
        const isManifest = ext === '.json' && this.manifestFilenames.includes(base);
        if (this.isIgnoredByConfig(targetPath)) {
          console.warn(`⚠️  Target file matches ignore paths, skipping: ${targetPath}`);
        } else if (isExcludedPath(targetPath, this.rootDir, true)) {
          console.warn(`⚠️  Target file is in an excluded path, skipping: ${targetPath}`);
        } else if (this.targetExtensions.includes(ext) || isManifest) {
          resolved.push(targetPath);
        } else {
          console.warn(`⚠️  Target file has unsupported extension (${ext}), skipping: ${targetPath}`);
        }
      } else if (stat.isDirectory()) {
        for (const ext of this.targetExtensions) {
          const pattern = path.join(targetPath, `**/*${ext}`).replace(/\\/g, '/');
          const files = globSync(pattern, { ignore: this.getGlobIgnorePatterns() });
          const filteredFiles = files.filter(file => !isExcludedPath(file, this.rootDir, true));
          resolved.push(...filteredFiles);
        }
        for (const manifestName of this.manifestFilenames) {
          // Pick up manifests both at the directory root and below it so the
          // fresh_package_version rule still fires in monorepos/workspaces.
          const rootManifestPath = path.join(targetPath, manifestName);
          const nestedPattern = path.join(targetPath, '**', manifestName).replace(/\\/g, '/');
          const manifestFiles = [
            ...(fs.existsSync(rootManifestPath) && !this.isIgnoredByConfig(rootManifestPath) && !isExcludedPath(rootManifestPath, this.rootDir, true)
              ? [rootManifestPath]
              : []),
            ...globSync(nestedPattern, { ignore: this.getGlobIgnorePatterns() })
          ].filter(file => !isExcludedPath(file, this.rootDir, true));
          resolved.push(...manifestFiles);
        }
      }
    }

    return [...new Set(resolved)];
  }

  /**
   * Check if a fetch call is properly handled with try/catch or .catch()
   */
  private isFetchCallProperlyHandled(lines: string[], fetchLineIndex: number): boolean {
    // Look in a reasonable range around the fetch call to see if it's in a try/catch block
    // or has a .catch() or similar error handling

    // First, find the function context containing this fetch call
    let functionStart = -1;
    let functionEnd = -1;

    // Look backwards to find the start of the function
    for (let i = fetchLineIndex; i >= Math.max(0, fetchLineIndex - 20); i--) {
      const line = lines[i];
      const isReactHook = line.includes('const') && (line.includes('useState') || line.includes('useEffect') || line.includes('useCallback') || line.includes('useMemo'));
      if (line.includes('async function') ||
        line.includes('function') ||
        line.includes('=>') ||
        isReactHook ||
        line.includes('export default function')) {
        // Check if this looks like the start of our function
        if (line.includes('{') || line.includes('=>')) {
          functionStart = i;
          break;
        }
      }
      // Check for arrow functions in the line above
      if (i > 0 && (lines[i - 1] + line).includes('=>')) {
        // Look for functions that end with an opening brace
        if (line.trim().startsWith('{')) {
          functionStart = i;
          break;
        }
      }
    }

    // Look forwards to find the end of the function block
    let braceCount = 0;
    let inFunction = false;

    for (let i = functionStart === -1 ? 0 : functionStart; i < lines.length && i < fetchLineIndex + 20; i++) {
      const line = lines[i];

      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') {
          braceCount++;
          if (i === functionStart && braceCount === 1) {
            inFunction = true;
          }
        } else if (line[j] === '}') {
          braceCount--;
          if (inFunction && braceCount === 0) {
            functionEnd = i;
            break;
          }
        }
      }

      if (functionEnd !== -1) break;
    }

    if (functionStart === -1 || functionEnd === -1) {
      // If we can't find function boundaries, check the current line and nearby lines for error handling
      // Check current line and 2 lines before and after
      const start = Math.max(0, fetchLineIndex - 2);
      const end = Math.min(lines.length, fetchLineIndex + 3);

      for (let i = start; i < end; i++) {
        const line = lines[i];
        if (line.includes('.catch(') || line.includes('try {') || line.includes('try{') ||
          (i > 0 && lines[i - 1].includes('try') && line.includes('.catch('))) {
          return true;
        }
      }
      return false;
    }

    // Now check the entire function for try/catch or .catch
    for (let i = functionStart; i <= functionEnd; i++) {
      const line = lines[i];
      if (line.includes('.catch(') || line.includes('try {') || line.includes('try{')) {
        return true;
      }
    }

    // Check if the fetch call is part of a promise chain that ends with .catch
    const currentLine = lines[fetchLineIndex];
    if (currentLine.includes('fetch(') && (currentLine.includes('.then(') || currentLine.includes('.catch('))) {
      // Look for .catch in the same or following lines within the same statement
      for (let i = fetchLineIndex; i < Math.min(lines.length, fetchLineIndex + 5); i++) {
        const line = lines[i];
        if (line.includes('.catch(')) {
          return true;
        }
        // If we find another statement (not a continuation), stop looking
        if (line.includes(';') && !line.trim().endsWith('\\') && !line.trim().endsWith(',')) {
          break;
        }
      }
    }

    return false;
  }

  /**
   * Analyze a single file for AI Slop patterns
   */
  private async analyzeFile(filePath: string, quiet: boolean = false) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Check if this is a test or mock file
    const isTestFile = filePath.includes('__tests__') ||
      filePath.includes('.test.') ||
      filePath.includes('.spec.') ||
      filePath.includes('__mocks__') ||
      filePath.includes('test-');

    const isMockFile = filePath.includes('__mocks__') || filePath.includes('mock');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Apply each detection pattern
      for (const pattern of this.detectionPatterns) {
        // Skip certain patterns in test/mock files
        if ((pattern.skipTests && isTestFile) || (pattern.skipMocks && isMockFile)) {
          continue;
        }

        // Skip the complex_nested_conditionals pattern since we handle it separately
        if (pattern.id === 'complex_nested_conditionals') {
          continue;
        }

        // Skip AST-based patterns (detected by findUnsafeAssertions, not regex)
        if (pattern.id === 'unsafe_double_type_assertion' ||
            pattern.id === 'unsafe_object_assertion' ||
            pattern.id === 'unsafe_array_assertion') {
          continue;
        }

        // Create a new RegExp object for each check to reset lastIndex
        const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
        let match;

        while ((match = regex.exec(line)) !== null) {
          // ========== PHASE 1: CONTEXT-AWARE WHITELISTING ==========

          // Skip any pattern that has an explicit eslint-disable or ts-expect-error on the same or previous line
          if (pattern.id.includes('any') || pattern.id.includes('unsafe')) {
            const prevLine = i > 0 ? lines[i - 1] : '';
            if (line.includes('eslint-disable') || line.includes('@ts-expect-error') ||
              line.includes('@ts-ignore') || prevLine.includes('eslint-disable-next-line') ||
              prevLine.includes('@ts-expect-error')) {
              continue; // Developer explicitly acknowledged this
            }
          }

          // Skip .d.ts declaration files entirely for 'any' related patterns
          if (pattern.id.includes('any') && filePath.endsWith('.d.ts')) {
            continue; // Declaration files often need 'any' for external library types
          }

          // Skip legitimate cases like expect.any() in tests
          if (pattern.id === 'any_type_usage' && (line.includes('expect.any(') || line.includes('jest.fn()'))) {
            continue;
          }

          // Skip JSX spread attributes which often legitimately use 'any'
          if (pattern.id === 'any_type_usage' && line.includes('{...') && line.includes('as any')) {
            continue;
          }

          // Skip legitimate JSON parsing patterns
          if (pattern.id === 'any_type_usage' &&
            (line.includes('JSON.parse(') || line.includes('.json') || line.includes('response.json'))) {
            continue;
          }

          // Skip legitimate API response handling where 'any' is often unavoidable
          if (pattern.id === 'any_type_usage' &&
            (line.includes('ApiResponse') || line.includes('apiResponse') ||
              line.includes('res.json') || line.includes('fetch') || line.includes('axios'))) {
            continue;
          }

          // Skip legitimate uses of 'any' for dynamic data processing
          if (pattern.id === 'any_type_usage' &&
            (line.includes('data: any') || line.includes('(data: any)') ||
              line.includes('result: any') || line.includes('response: any'))) {
            // Check if it's in a function that processes dynamic data
            if (line.includes('parse') || line.includes('process') || line.includes('transform')) {
              continue;
            }
          }

          // Special handling for function_param_any_type pattern
          if (pattern.id === 'function_param_any_type') {
            // Skip legitimate uses in data processing functions
            if (line.includes('(data: any)') &&
              (line.includes('parse') || line.includes('process') || line.includes('transform'))) {
              continue;
            }

            // Skip legitimate uses in generic functions dealing with external data
            if (line.includes('ApiResponse') || line.includes('apiResponse') ||
              line.includes('JSON.parse') || line.includes('response: any')) {
              continue;
            }
          }

          // Special handling for missing error handling - look for properly handled fetch calls
          if (pattern.id === 'missing_error_handling') {
            const fullLine = line.trim();
            // Skip matches inside comment lines (single-line, JSDoc, block)
            if (fullLine.startsWith('//') || fullLine.startsWith('*') || fullLine.startsWith('/*')) {
              continue;
            }
            // Check if this fetch call is part of a properly handled async function
            const isProperlyHandled = this.isFetchCallProperlyHandled(lines, i);
            if (isProperlyHandled) {
              continue;
            }
          }

          // Special handling for production_console_log - skip legitimate error handling and debugging patterns
          if (pattern.id === 'production_console_log') {
            const fullLine = line.trim();

            // Skip console.error logs inside catch blocks (legitimate error handling)
            if (fullLine.includes('console.error(') && this.isInTryCatchBlock(lines, i)) {
              continue;
            }

            // Skip console calls guarded by a conditional on the same line
            // e.g., if (isDev) console.log('debug');
            if (/^if\s*\(/.test(fullLine)) {
              continue;
            }

            // Skip console calls inside a conditional block opened on a prior line
            if (i > 0) {
              const prevLine = lines[i - 1].trim();
              if (/^if\s*\(/.test(prevLine) && !prevLine.includes('function') && (prevLine.includes('{') || fullLine.startsWith('{') === false)) {
                continue;
              }
            }

            // Skip general debugging logs that might be intentional in development
            if (fullLine.includes('console.log(') &&
              (fullLine.includes('Debug') || fullLine.includes('debug') || fullLine.includes('debug:'))) {
              continue;
            }

            // Skip console logs that contain the word 'error' in a non-error context (like error handling)
            if ((fullLine.includes('console.log(') || fullLine.includes('console.info(')) &&
              (fullLine.includes('error') || fullLine.includes('Error'))) {
              continue;
            }
          }

          // Special handling for hedging_uncertainty_comment - skip legitimate test patterns
          if (pattern.id === 'hedging_uncertainty_comment' || pattern.id === 'assumption_comment') {
            // Skip these patterns in test files where they might be legitimate test descriptions
            if (filePath.includes('test') || filePath.includes('spec') || filePath.includes('__tests__')) {
              continue;
            }

            // Skip common English phrases that are not code-related
            const fullLine = line.trim().toLowerCase();
            if (fullLine.includes('should work') && (fullLine.includes('//') || fullLine.includes('/*') || fullLine.includes('*/'))) {
              // This is likely a comment in a test file
              continue;
            }
          }

          // Special handling for unsafe_type_assertion - skip legitimate test patterns
          if (pattern.id === 'unsafe_type_assertion') {
            // Skip these in test files where they might be legitimate for testing
            if (filePath.includes('test') || filePath.includes('spec') || filePath.includes('__tests__')) {
              continue;
            }
          }



          // In quiet mode, skip test and mock files for all patterns except production console logs
          if (quiet && pattern.id !== 'production_console_log') {
            const isTestFile = filePath.includes('__tests__') ||
              filePath.includes('.test.') ||
              filePath.includes('.spec.') ||
              filePath.includes('__mocks__') ||
              filePath.includes('test-');

            if (isTestFile) {
              continue;
            }
          }

          if (pattern.severity === 'off') continue;

          this.issues.push({
            type: pattern.id,
            file: filePath,
            line: lineNumber,
            column: match.index + 1,
            code: match[0],
            message: `${pattern.message} (${pattern.description})`,
            severity: pattern.severity
          });
        }
      }

      // Now handle complex nested conditionals separately with improved logic
      this.analyzeComplexNestedConditionals(filePath, lines, i, lineNumber, line);

    }

    // AST-based unsafe assertion detection (.ts/.tsx only)
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const skipInQuiet = quiet && (
        filePath.includes('__tests__') ||
        filePath.includes('.test.') ||
        filePath.includes('.spec.') ||
        filePath.includes('__mocks__') ||
        filePath.includes('test-')
      );

      if (!skipInQuiet) {
        const astFindings = findUnsafeAssertions(content, filePath);
        for (const finding of astFindings) {
          const pattern = this.detectionPatterns.find(p => p.id === finding.type);
          const effectiveSeverity = pattern ? pattern.severity : finding.severity;
          if (effectiveSeverity === 'off') continue;

          this.issues.push({
            type: finding.type,
            file: finding.file,
            line: finding.line,
            column: finding.column,
            code: finding.code,
            message: pattern
              ? `${pattern.message} (${pattern.description})`
              : finding.message,
            severity: effectiveSeverity,
          });
        }
      }
    }

    // Special handling for package.json and package-lock.json to detect fresh package versions
    if (path.basename(filePath) === 'package.json' || path.basename(filePath) === 'package-lock.json') {
      await this.analyzePackageVersions(filePath, content);
    }
  }

  /**
   * Analyze complex nested conditionals using a more sophisticated approach
   * This tracks nesting depth rather than just finding control structure keywords
   */
  private analyzeComplexNestedConditionals(filePath: string, lines: string[], lineIndex: number, lineNumber: number, line: string) {
    // Count opening braces in this line to determine if we're entering nested blocks
    const ifMatches = line.match(/\bif\s*\(/g);
    const forMatches = line.match(/\bfor\s*\(/g);
    const whileMatches = line.match(/\bwhile\s*\(/g);

    // Only flag if there are potentially nested control structures in a single line
    // or if the line has multiple indicators of complexity
    if ((ifMatches && ifMatches.length > 1) ||
      (forMatches && forMatches.length > 1) ||
      (whileMatches && whileMatches.length > 1) ||
      (ifMatches && (forMatches || whileMatches)) ||
      (forMatches && whileMatches)) {
      this.issues.push({
        type: 'complex_nested_conditionals',
        file: filePath,
        line: lineNumber,
        column: 1,
        code: line.trim(),
        message: "Found potentially complex nested control structures in a single line. Consider refactoring for readability.",
        severity: 'medium'
      });
    }

    // Also look for deeply nested if statements across multiple lines
    // Count indentation to detect nesting
    const indentation = line.search(/\S/); // Get leading whitespace length
    if (indentation >= 16 && (line.includes('if (') || line.includes('for (') || line.includes('while ('))) {
      // This might indicate a highly nested structure
      // But first, verify it's not a simple case like formatting
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('//') && !trimmedLine.includes('=>')) { // Skip comments and arrow functions
        this.issues.push({
          type: 'complex_nested_conditionals',
          file: filePath,
          line: lineNumber,
          column: indentation + 1,
          code: line.trim(),
          message: "Highly indented control structure suggests deep nesting. Consider refactoring for readability.",
          severity: 'medium'
        });
      }
    }
  }

  /**
   * Check if a particular line is within a try-catch block
   * Used to determine if console.error is legitimate error handling
   */
  private isInTryCatchBlock(lines: string[], lineIndex: number): boolean {
    let braceDepth = 0;
    let inCatchBlock = false;
    let catchBlockDepth = -1;
    let nestedDepth = 0;
    let pendingExit = false;

    for (let i = 0; i <= lineIndex; i++) {
      const line = lines[i];
      const hasCatch = line.includes('catch (') || line.includes('catch(');
      const catchOnSameLineAsCloseBrace = hasCatch && line.trim().startsWith('}');

      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{') {
          if (inCatchBlock && !catchOnSameLineAsCloseBrace) {
            if (braceDepth >= catchBlockDepth) {
              nestedDepth++;
            }
          }
          braceDepth++;
        } else if (line[j] === '}') {
          braceDepth--;
          if (inCatchBlock) {
            if (nestedDepth > 0) {
              nestedDepth--;
              if (nestedDepth === 0) {
                pendingExit = true;
              }
            } else if (braceDepth <= catchBlockDepth) {
              inCatchBlock = false;
              nestedDepth = 0;
              pendingExit = false;
            }
          }
        }
      }

      if (pendingExit) {
        pendingExit = false;
      }

      if (hasCatch) {
        if (line.includes('{')) {
          if (catchOnSameLineAsCloseBrace) {
            const closeBraceIdx = line.indexOf('}');
            const catchIdx = line.indexOf('catch');
            const openBraceIdx = line.indexOf('{', catchIdx);
            if (closeBraceIdx !== -1 && closeBraceIdx < catchIdx && openBraceIdx > catchIdx) {
              braceDepth--;
            }
            for (let j = 0; j < openBraceIdx; j++) {
              if (line[j] === '{') braceDepth++;
            }
            for (let j = openBraceIdx + 1; j < line.length; j++) {
              if (line[j] === '{') nestedDepth++;
              else if (line[j] === '}') {
                nestedDepth--;
                if (nestedDepth === 0) {
                  pendingExit = true;
                }
              }
            }
            inCatchBlock = true;
            catchBlockDepth = braceDepth;
            nestedDepth = 0;
          } else {
            inCatchBlock = true;
            catchBlockDepth = braceDepth - 1;
            nestedDepth = 0;
            pendingExit = false;
          }
        } else {
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (lines[j].includes('{')) {
              inCatchBlock = true;
              catchBlockDepth = braceDepth;
              nestedDepth = 0;
              pendingExit = false;
              break;
            }
          }
        }
      }
    }

    return inCatchBlock;
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
      if (typeof dependencies !== 'object' || dependencies === null) {
        return;
      }

      for (const [depName, depInfo] of Object.entries(dependencies as Record<string, unknown>)) {
        if (typeof depInfo !== 'object' || depInfo === null) {
          continue;
        }

        const info = depInfo as Record<string, unknown>;
        const version = typeof info.version === 'string' ? info.version : '';
        const pkgName = typeof info.name === 'string' && info.name ? info.name : depName;
        const scopeKey = normalizePath(lockfileRoot);
        const sourceId = ['dependencies', ...trail, depName].join('/');

        if (pkgName && version) {
          packageEntries.push({ scopeKey, sourceId, pkgName, version });
        }

        if (info.dependencies && typeof info.dependencies === 'object') {
          collectLegacyLockfileEntries(info.dependencies, [...trail, depName]);
        }
      }
    };

    try {
      const pkg = JSON.parse(content);

      if (filePath.endsWith('package-lock.json')) {
        if (pkg.packages) {
          for (const [pkgPath, pkgInfo] of Object.entries(pkg.packages)) {
            if (pkgPath === '' || pkgPath === 'node_modules/') continue;
            // Workspace entries like `packages/ui` are local packages, not
            // registry-installed dependencies, so they should not be checked
            // for package freshness.
            if (!isRegistryBackedLockfileEntry(pkgPath)) continue;
            if (pkgInfo === null || pkgInfo === undefined) continue;
            const info = pkgInfo as Record<string, unknown>;
            const version = info.version as string;
            const pkgName = typeof info.name === 'string' && info.name
              ? info.name
              : pkgPath.split('node_modules/').pop() || pkgPath;
            if (pkgName && version) {
              packageEntries.push({ scopeKey: lockfileScopeKey(pkgPath), sourceId: pkgPath, pkgName, version });
            }
          }
        } else if (pkg.dependencies) {
          collectLegacyLockfileEntries(pkg.dependencies);
        }
      } else if (typeof pkg === 'object' && pkg !== null) {
        const packageJsonScopeKey = normalizePath(path.dirname(filePath));
        const p = pkg as Record<string, Record<string, string> | undefined>;
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          if (p[key]) {
            for (const [pkgName, version] of Object.entries(p[key]!)) {
              packageEntries.push({ scopeKey: packageJsonScopeKey, sourceId: key, pkgName, version });
            }
          }
        }
      }
    } catch {
      return;
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
        this.issues.push({
          type: 'fresh_package_version',
          file: filePath,
          line: 1,
          column: 1,
          code: filePath.endsWith('package-lock.json')
            ? `${sourceId}: ${pkgName}@${version}`
            : `"${pkgName}": "${version}"`,
          message: filePath.endsWith('package-lock.json')
            ? `Package '${pkgName}' from ${sourceId} v${version} is only ${daysOld} day${daysOld === 1 ? '' : 's'} old — wait at least ${minAgeDays} days before updating`
            : `Package '${pkgName}' v${version} is only ${daysOld} day${daysOld === 1 ? '' : 's'} old — wait at least ${minAgeDays} days before updating`,
          severity: 'medium'
        });
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

    if (this.registryUnavailable) {
      return null;
    }

    let data: { time: Record<string, string> } | null = null;
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
      data = (await response.json()) as { time: Record<string, string> };
    } catch {
      if (!this.registryWarningLogged) {
        console.warn('⚠️  Could not reach npm registry to check package ages. fresh_package_version checks will be skipped.');
        this.registryWarningLogged = true;
      }
      this.registryUnavailable = true;
      return null;
    }

    if (data?.time) {
      this.npmPackageCache.set(pkgName, data.time);
    }
    const versionTime = data?.time?.[version];
    if (!versionTime) return null;
    const publishTime = new Date(versionTime).getTime();
    return { version, time: versionTime, ageMs: now - publishTime };
  }

  /**
   * Generate a detailed report of findings
   */
  private generateReport(quiet: boolean = false) {
    console.log('📊 AI Slop Detection Report');
    console.log('============================\n');

    if (this.issues.length === 0) {
      console.log('✅ No AI Slop issues detected!');
      return;
    }

    // Group issues by severity
    const bySeverity = {
      critical: this.issues.filter(i => i.severity === 'critical'),
      high: this.issues.filter(i => i.severity === 'high'),
      medium: this.issues.filter(i => i.severity === 'medium'),
      low: this.issues.filter(i => i.severity === 'low')
    };

    console.log(`Found ${this.issues.length} AI Slop issues:`);
    console.log(`  Critical: ${bySeverity.critical.length}`);
    console.log(`  High:     ${bySeverity.high.length}`);
    console.log(`  Medium:   ${bySeverity.medium.length}`);
    console.log(`  Low:      ${bySeverity.low.length}\n`);

    // Display top issues by severity
    ['critical', 'high', 'medium', 'low'].forEach(severity => {
      const issues = bySeverity[severity];
      if (issues.length > 0) {
        console.log(`\n${severity.toUpperCase()} SEVERITY ISSUES:`);
        console.log(''.padStart(80, '-'));

        // Group by type for better organization
        const byType = {};
        issues.slice(0, 20).forEach(issue => {
          if (!byType[issue.type]) {
            byType[issue.type] = [];
          }
          byType[issue.type].push(issue);
        });

        Object.entries(byType).forEach(([type, typeIssues]) => {
          const sampleIssue = (typeIssues as AISlopIssue[])[0];
          // Find the pattern to get fix and learnMore info
          const patternInfo = this.detectionPatterns.find(p => p.id === type);

          console.log(`\n📍 Pattern: ${type}`);
          console.log(`   Description: ${sampleIssue.message.split('(').pop()?.replace(')', '') || ''}`);

          // Phase 2: Show fix suggestions and learn more links
          if (patternInfo?.fix) {
            console.log(`   💡 Fix: ${patternInfo.fix}`);
          }
          if (patternInfo?.learnMore) {
            console.log(`   📚 Learn more: ${patternInfo.learnMore}`);
          }

          console.log(`   Sample occurrences: ${(typeIssues as AISlopIssue[]).length}`);

          // Show a few specific examples
          (typeIssues as AISlopIssue[]).slice(0, 3).forEach(issue => {
            const relativePath = path.relative(this.rootDir, issue.file);
            console.log(`   → ${relativePath}:${issue.line} - ${issue.code}`);
          });

          if ((typeIssues as AISlopIssue[]).length > 3) {
            console.log(`   ... and ${(typeIssues as AISlopIssue[]).length - 3} more instances`);
          }
        });

        if (issues.length > 20) {
          console.log(`\n   ... and ${issues.length - 20} more issues of this severity`);
        }
      }
    });

    // Provide summary statistics
    console.log(`\n📈 SUMMARY STATISTICS:`);
    console.log(''.padStart(80, '-'));

    // Count by type
    const byType = {};
    this.issues.forEach(issue => {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
    });

    console.log('\nIssues by type:');
    Object.entries(byType)
      .sort((a, b) => (b[1] as number) - (a[1] as number)) // Sort by count
      .slice(0, 10)
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

    // Files with most issues - show core application files separately
    const fileCounts = {};
    this.issues.forEach(issue => {
      fileCounts[issue.file] = (fileCounts[issue.file] || 0) + 1;
    });

    // Split files into core app files and others
    const allFiles = Object.entries(fileCounts);
    const coreAppFiles = allFiles.filter(([file]) => {
      const relativePath = path.relative(this.rootDir, file).replace(/\\/g, '/');
      return this.coreAppDirs.some(dir => relativePath.startsWith(dir));
    });

    const otherFiles = allFiles.filter(([file]) => {
      const relativePath = path.relative(this.rootDir, file).replace(/\\/g, '/');
      return !this.coreAppDirs.some(dir => relativePath.startsWith(dir));
    });

    // Show core application files separately
    const topCoreFiles = coreAppFiles
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 10);

    console.log('\nTop CORE APPLICATION files with AI Slop issues:');
    if (topCoreFiles.length > 0) {
      topCoreFiles.forEach(([file, count]) => {
        const relativePath = path.relative(this.rootDir, file);
        console.log(`  ${relativePath}: ${count} issues ★`);
      });
    } else {
      console.log('  No core application files found with issues');
    }

    // In quiet mode, don't show other files (tests, scripts, mocks, etc.)
    if (!quiet) {
      // Also show other notable files if there's space
      const topOtherFiles = otherFiles
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 5);

      if (topOtherFiles.length > 0) {
        console.log('\nTop OTHER files with AI Slop issues (utilities, scripts, etc.):');
        topOtherFiles.forEach(([file, count]) => {
          const relativePath = path.relative(this.rootDir, file);
          console.log(`  ${relativePath}: ${count} issues`);
        });
      }
    }

    // Add KarpeSlop scoring
    const score = this.calculateKarpeSlopScore();

    console.log(`\nKARPATHY SLOP INDEX™`);
    console.log('═'.repeat(50));
    console.log(`Information Utility (Noise) : ${score.informationUtility} pts`);
    console.log(`Information Quality (Lies)  : ${score.informationQuality} pts`);
    console.log(`Style / Taste (Soul)        : ${score.style} pts`);
    console.log(`TOTAL KARPE-SLOP SCORE      : ${score.total} pts`);

    if (hasOnlyFreshPackageWarnings(this.issues)) {
      console.log(`\nPackage freshness warnings only. Not counted in the KarpeSlop score.`);
    } else if (score.total > 50) {
      console.log(`\nSUEEEY! Here piggy piggy... this codebase is 100% slop-fed.`);
    } else {
      console.log(`\nAcceptable. But Karpathy is watching.`);
    }

    console.log('\n🔧 Next Steps:');
    console.log('=============');
    console.log('1. Address critical and high severity issues first');
    console.log('2. Focus on removing `any` types and replacing with proper types');
    console.log('3. Add proper error handling to asynchronous operations');
    console.log('4. Refactor complex functions for better readability');
    console.log('5. Remove development artifacts like TODO comments and console logs');
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
  getIssuesBySeverity(severity: AISlopIssue['severity']): AISlopIssue[] {
    return this.issues.filter(issue => issue.severity === severity);
  }

  /**
   * Consolidate issues by grouping identical issues (same type, file, code, message, severity)
   * into single entries with a location array
   */
  private consolidateIssues(): ConsolidatedIssue[] {
    const issueMap = new Map<string, ConsolidatedIssue>();

    for (const issue of this.issues) {
      // Create a unique key for grouping identical issues
      const key = `${issue.type}|${issue.file}|${issue.code}|${issue.message}|${issue.severity}`;

      if (issueMap.has(key)) {
        // Add location to existing consolidated issue
        const existing = issueMap.get(key)!;
        existing.location.push(`${issue.line}:${issue.column}`);
      } else {
        // Create new consolidated issue
        issueMap.set(key, {
          type: issue.type,
          file: issue.file,
          code: issue.code,
          message: issue.message,
          severity: issue.severity,
          location: [`${issue.line}:${issue.column}`]
        });
      }
    }

    return Array.from(issueMap.values());
  }

  /**
   * Export results to JSON for further processing
   */
  exportResults(outputPath: string) {
    // Consolidate issues to avoid repetition
    const consolidatedIssues = this.consolidateIssues();

    // Helper to count occurrences from consolidated issues
    const countOccurrences = (issues: ConsolidatedIssue[]) =>
      issues.reduce((sum, issue) => sum + issue.location.length, 0);

    // Group consolidated issues by severity
    const consolidatedBySeverity = {
      critical: consolidatedIssues.filter(i => i.severity === 'critical'),
      high: consolidatedIssues.filter(i => i.severity === 'high'),
      medium: consolidatedIssues.filter(i => i.severity === 'medium'),
      low: consolidatedIssues.filter(i => i.severity === 'low')
    };

    // Count total occurrences (sum of all locations)
    const totalOccurrences = countOccurrences(consolidatedIssues);

    // Group by type and count occurrences
    const byTypeMap = new Map<string, ConsolidatedIssue[]>();
    for (const issue of consolidatedIssues) {
      if (!byTypeMap.has(issue.type)) {
        byTypeMap.set(issue.type, []);
      }
      byTypeMap.get(issue.type)!.push(issue);
    }

    const results = {
      timestamp: new Date().toISOString(),
      // Unique consolidated issues count
      uniqueIssues: consolidatedIssues.length,
      // Total occurrences (backwards compatible - same as old totalIssues)
      totalOccurrences: totalOccurrences,
      // Occurrence counts by severity (backwards compatible)
      bySeverity: {
        critical: countOccurrences(consolidatedBySeverity.critical),
        high: countOccurrences(consolidatedBySeverity.high),
        medium: countOccurrences(consolidatedBySeverity.medium),
        low: countOccurrences(consolidatedBySeverity.low)
      },
      // Occurrence counts by type (backwards compatible)
      byType: Array.from(byTypeMap.entries()).map(([type, issues]) => ({
        type,
        // Total occurrences of this issue type
        occurrences: countOccurrences(issues),
        // Unique consolidated issues of this type
        uniqueIssues: issues.length,
        sample: issues.slice(0, 3).map(issue => ({
          file: path.relative(this.rootDir, issue.file),
          locations: issue.location.slice(0, 3),
          code: issue.code
        }))
      })),
      // Consolidated issues array (new format with location arrays)
      issues: consolidatedIssues
    };

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n📈 Results exported to: ${outputPath}`);
  }




  /**
   * Calculate comprehensive KarpeSlop score based on the three axes
   */
  calculateKarpeSlopScore(): SlopScoreBreakdown {
    const weights: Record<string, number> = {
      // Critical hallucinations = instant fail
      hallucinated_react_import: 30,
      hallucinated_next_import: 30,

      // Type system poison
      any_type_usage: 15,
      unsafe_type_assertion: 12,
      unsafe_double_type_assertion: 12,
      unsafe_object_assertion: 12,
      unsafe_array_assertion: 12,

      // Soul death
      overconfident_comment: 10,
      hedging_uncertainty_comment: 10,
      todo_implementation_placeholder: 12,
      assumption_comment: 11,

      // Noise & bloat
      redundant_self_explanatory_comment: 8,
      excessive_boilerplate_comment: 6,
      debug_log_with_comment: 5,

      // Vibe crimes
      unnecessary_iife_wrapper: 7,
      vibe_coded_ternary_abuse: 6,
    };

    let utility = 0, quality = 0, style = 0;

    for (const i of this.issues) {
      // Package freshness is tracked separately from AI slop scoring.
      if (i.type === 'fresh_package_version') {
        continue;
      }
      const w = weights[i.type] || 3;
      if (i.type.includes('hallucinated') || i.type.includes('todo') || i.type.includes('assumption')) quality += w;
      else if (i.type.includes('comment') || i.type.includes('redundant') || i.type.includes('boilerplate')) utility += w;
      else style += w;
    }

    const total = utility + quality + style;

    return { informationUtility: utility, informationQuality: quality, style, total };
  }
}

// Run the detector if this script is executed directly
export function splitCliArgs(args: readonly string[]): { flagArgs: string[]; targetPaths: string[] } {
  // Support -- separator: everything after -- is treated as a path, even if it starts with -
  const doubleDashIdx = args.indexOf('--');
  if (doubleDashIdx !== -1) {
    return { flagArgs: args.slice(0, doubleDashIdx), targetPaths: args.slice(doubleDashIdx + 1) };
  }
  return { flagArgs: args.filter(a => a.startsWith('-')), targetPaths: args.filter(a => !a.startsWith('-')) };
}

async function runIfMain() {
  const rootDir = process.cwd();

  const args = process.argv.slice(2);
  const { flagArgs, targetPaths } = splitCliArgs(args);

  // Check for help options first, before constructing the detector
  // (so a bad config doesn't break --help)
  if (flagArgs.includes('--help') || flagArgs.includes('-h') || flagArgs.includes('/?')) {
    console.log(`
Usage: karpeslop [options] [path...]

Arguments:
  path...         File or directory path(s) to scan (scans all files if omitted)

Options:
  --help, -h     Show this help message
  --quiet, -q    Run in quiet mode (only scan core app files)
  --strict, -s   Exit with code 2 if critical issues (hallucinations) are found
  --version, -v  Show version information
  --             End of flags; treat remaining args as paths (even if they start with -)

Exit Codes:
  0 - No issues found, or only fresh package warnings were found
  1 - Blocking issues found (warnings/errors other than fresh package warnings)
  2 - Critical issues found (--strict mode only)

Examples:
  karpeslop                          # Scan all files in current directory
  karpeslop src/app.ts               # Scan a single file
  karpeslop src/lib/                 # Scan a directory
  karpeslop src/app.ts src/lib/      # Scan specific paths
  karpeslop --quiet                  # Scan only core application files
  karpeslop --strict src/app.ts      # Block on critical issues in a specific file
  karpeslop -- -dash-file.ts         # Scan a file whose name starts with -
  karpeslop --help                   # Show this help

The tool detects the three axes of AI slop:
  1. Information Utility (Noise) - Comments, boilerplate, etc.
  2. Information Quality (Lies)  - Hallucinated imports, assumptions, etc.
  3. Style / Taste (Soul)        - Overconfident comments, unnecessary complexity
`);
    process.exit(0);
  }

  // Check for version options
  if (flagArgs.includes('--version') || flagArgs.includes('-v')) {
    // Try to get version from package.json
    try {
      const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json');
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      console.log(`karpeslop/${packageData.version} ${process.platform}-${process.arch} node-${process.version}`);
    } catch {
      console.log('karpeslop/unknown');
    }
    process.exit(0);
  }

  const detector = new AISlopDetector(rootDir, targetPaths.length > 0 ? targetPaths : undefined);
  const quiet = flagArgs.includes('--quiet') || flagArgs.includes('-q');
  const strict = flagArgs.includes('--strict') || flagArgs.includes('-s') || !!detector.getConfig().blockOnCritical;

  try {
    const issues = await detector.detect(quiet);
    // Export results to a JSON file for CI/CD integration
    const outputPath = path.join(rootDir, 'ai-slop-report.json');
    detector.exportResults(outputPath);

    // In strict mode, exit with code 2 if there are any critical issues (hallucinations)
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (strict && criticalIssues.length > 0) {
      if (targetPaths.length > 0) {
        const criticalFiles = [...new Set(criticalIssues.map(i => path.relative(rootDir, i.file)))];
        console.log(`\n❌ STRICT MODE: ${criticalIssues.length} CRITICAL issue(s) found in: ${criticalFiles.join(', ')}`);
      } else {
        console.log(`\n❌ STRICT MODE: ${criticalIssues.length} CRITICAL issue(s) found. Blocking.`);
      }
      process.exit(2);
    }

    const exitCode = hasOnlyFreshPackageWarnings(issues) ? 0 : issues.length > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error('💥 AI Slop detection failed:', error);
    process.exit(1);
  }
}

// Execute only when run as the main module, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runIfMain().catch(error => {
    console.error('💥 AI Slop detection failed:', error);
    process.exit(1);
  });
}

export { AISlopDetector, AISlopIssue, ConsolidatedIssue, DetectionPattern, UnsafeAssertionFinding };
