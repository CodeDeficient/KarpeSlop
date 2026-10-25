/**
 * Import checks that need module resolution.
 *
 * - hallucinated_import: a named import the target module does not export.
 *   Uses the TypeScript checker on the real, installed type declarations.
 * - undeclared_dependency / nonexistent_package: a bare package import that
 *   is neither declared in any package.json up the tree nor installed. When
 *   the npm registry is reachable we also check whether the name exists.
 */

import fs from 'fs';
import path from 'path';
import { builtinModules } from 'module';
import ts from 'typescript';
import { fileURLToPath } from 'url';

export interface ImportFinding {
  type: 'hallucinated_import' | 'undeclared_dependency' | 'nonexistent_package';
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  fix?: string;
}

export type RegistryStatus = 'exists' | 'missing' | 'unknown';
export type RegistryLookup = (packageName: string) => Promise<RegistryStatus>;

/**
 * Names that are commonly imported from the wrong package. Used to suggest
 * where a symbol really lives, and as a fallback when the module's types are
 * not installed (e.g. a scan before `npm install`).
 */
const KNOWN_WRONG_IMPORTS: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>> = new Map([
  ['react', new Map([
    ['useRouter', ['next/navigation', 'next/router']],
    ['usePathname', ['next/navigation']],
    ['useSearchParams', ['next/navigation', 'react-router-dom']],
    ['useParams', ['next/navigation', 'react-router-dom']],
    ['useNavigate', ['react-router-dom']],
    ['Link', ['next/link', 'react-router-dom']],
    ['Image', ['next/image']],
    ['Script', ['next/script']],
    ['Head', ['next/head']],
    ['redirect', ['next/navigation']],
    ['notFound', ['next/navigation']],
    ['getServerSideProps', []],
    ['getStaticProps', []],
    ['getStaticPaths', []],
    ['useQuery', ['@tanstack/react-query']],
    ['useSelector', ['react-redux']],
    ['useDispatch', ['react-redux']],
    ['styled', ['styled-components']]
  ])],
  ['react-dom', new Map([
    ['useState', ['react']],
    ['useEffect', ['react']]
  ])],
  ['next/router', new Map([
    ['usePathname', ['next/navigation']],
    ['useSearchParams', ['next/navigation']],
    ['redirect', ['next/navigation']]
  ])]
]);

const PAGE_EXPORTS = new Set(['getServerSideProps', 'getStaticProps', 'getStaticPaths']);

function hintFor(moduleName: string, symbol: string): string | undefined {
  if (PAGE_EXPORTS.has(symbol)) {
    return `${symbol} is not imported from anywhere. In the Next.js Pages Router it is a function you export from the page file.`;
  }
  const homes = KNOWN_WRONG_IMPORTS.get(moduleName)?.get(symbol);
  if (homes === undefined || homes.length === 0) return undefined;
  return `'${symbol}' is exported by ${homes.map(home => `'${home}'`).join(' or ')}.`;
}

const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Specifiers that are never npm packages: relative paths, aliases, protocols, builtins. */
export function isBarePackageSpecifier(specifier: string): boolean {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')) return false;
  if (/^[~#$]/.test(specifier) || specifier.startsWith('@/')) return false;
  if (specifier.includes(':')) return false; // node:, bun:, virtual:, data:, https:
  if (BUILTINS.has(specifier) || BUILTINS.has(specifier.split('/')[0])) return false;
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/.*)?$/i.test(specifier);
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : undefined;
  } catch {
    return undefined;
  }
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

interface PackageScope {
  /** At least one package.json was found from the file up to the filesystem root. */
  hasManifest: boolean;
  declared: Set<string>;
}

class PackageIndex {
  private manifestCache = new Map<string, Record<string, unknown> | undefined>();
  private scopeCache = new Map<string, PackageScope>();

  private manifest(dir: string): Record<string, unknown> | undefined {
    if (!this.manifestCache.has(dir)) {
      const file = path.join(dir, 'package.json');
      this.manifestCache.set(dir, fs.existsSync(file) ? readJsonObject(file) : undefined);
    }
    return this.manifestCache.get(dir);
  }

  /** Every dependency declared by any package.json from `dir` upward (covers hoisted monorepo roots). */
  scopeFor(dir: string): PackageScope {
    const cached = this.scopeCache.get(dir);
    if (cached !== undefined) return cached;

    const parent = path.dirname(dir);
    const inherited: PackageScope = parent === dir
      ? { hasManifest: false, declared: new Set() }
      : this.scopeFor(parent);
    const manifest = this.manifest(dir);
    let scope = inherited;
    if (manifest !== undefined) {
      const declared = new Set(inherited.declared);
      if (typeof manifest.name === 'string') declared.add(manifest.name);
      for (const field of DEPENDENCY_FIELDS) {
        const deps = manifest[field];
        if (typeof deps === 'object' && deps !== null) {
          Object.keys(deps).forEach(name => declared.add(name));
        }
      }
      scope = { hasManifest: true, declared };
    }
    this.scopeCache.set(dir, scope);
    return scope;
  }

  isInstalled(fromDir: string, packageName: string): boolean {
    let dir = fromDir;
    while (true) {
      if (fs.existsSync(path.join(dir, 'node_modules', packageName))) return true;
      const parent = path.dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  }
}

function typesPackageFor(packageName: string): string {
  return packageName.startsWith('@')
    ? `@types/${packageName.slice(1).replace('/', '__')}`
    : `@types/${packageName}`;
}

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true
};

interface ProjectConfig {
  options: ts.CompilerOptions;
  /** Declaration files the tsconfig includes (ambient modules, augmentations). */
  declarationFiles: string[];
}

function parseConfigFile(configPath: string): ts.ParsedCommandLine | undefined {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  return read.error === undefined
    ? ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath))
    : undefined;
}

function readProjectConfig(configPath: string | undefined): ProjectConfig {
  let options = DEFAULT_OPTIONS;
  let declarationFiles: string[] = [];
  const parsed = configPath === undefined ? undefined : parseConfigFile(configPath);
  if (parsed !== undefined) {
    options = { ...options, ...parsed.options };
    declarationFiles = parsed.fileNames.filter(name => /\.d\.[cm]?ts$/.test(name));
    // Solution-style configs (`"files": []` plus `references`, as in the Vite
    // template) keep paths and baseUrl in the referenced configs.
    for (const reference of parsed.projectReferences ?? []) {
      const referencePath = ts.resolveProjectReferencePath(reference);
      const referenced = fs.existsSync(referencePath) ? parseConfigFile(referencePath) : undefined;
      if (referenced === undefined) continue;
      if (options.paths === undefined && referenced.options.paths !== undefined) {
        options = { ...options, paths: referenced.options.paths, pathsBasePath: referenced.options.pathsBasePath };
      }
      if (options.baseUrl === undefined && referenced.options.baseUrl !== undefined) {
        options = { ...options, baseUrl: referenced.options.baseUrl };
      }
      declarationFiles.push(...referenced.fileNames.filter(name => /\.d\.[cm]?ts$/.test(name)));
    }
  }
  return {
    options: { ...options, allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true },
    declarationFiles
  };
}

function findProjectConfig(dir: string): string | undefined {
  return ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json') ??
    ts.findConfigFile(dir, ts.sys.fileExists, 'jsconfig.json');
}

const BUNDLER_CONFIG = /^((vite|vitest|webpack|next|nuxt|astro|svelte|rollup|rspack|rsbuild|babel|jest|metro|craco|quasar|remix)\.config\.[cm]?[jt]s|\.babelrc(\.json)?|babel\.config\.json)$/;

/**
 * Resolves a file's imports with the tsconfig/jsconfig nearest to it (so
 * per-package `paths` in a monorepo apply), and recognizes import aliases
 * that only a bundler knows about.
 */
class ResolutionIndex {
  private configs = new Map<string, ProjectConfig>();
  private bundlerText = new Map<string, string>();

  configFor(fileDir: string): ProjectConfig {
    const configPath = findProjectConfig(fileDir) ?? '';
    let config = this.configs.get(configPath);
    if (config === undefined) {
      config = readProjectConfig(configPath === '' ? undefined : configPath);
      this.configs.set(configPath, config);
    }
    return config;
  }

  /** Concatenated text of bundler/test-runner configs from `dir` up to the filesystem root. */
  private bundlerConfigText(dir: string): string {
    const cached = this.bundlerText.get(dir);
    if (cached !== undefined) return cached;
    const parent = path.dirname(dir);
    let text = parent === dir ? '' : this.bundlerConfigText(parent);
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (BUNDLER_CONFIG.test(entry)) text += `\n${fs.readFileSync(path.join(dir, entry), 'utf-8')}`;
      }
    } catch {
      // Unreadable directory: nothing to add.
    }
    this.bundlerText.set(dir, text);
    return text;
  }

  /**
   * True when the specifier's first segment is an alias rather than a package:
   * a tsconfig `paths` key, a folder under `baseUrl` (or `src/`), or a name a
   * bundler config mentions.
   */
  isAlias(specifier: string, fileDir: string, options: ts.CompilerOptions): boolean {
    const first = specifier.split('/')[0];
    const pathKeys = Object.keys(options.paths ?? {});
    if (pathKeys.some(key => key.split('/')[0].replace(/\*$/, '') === first)) return true;
    const baseDirs = [options.baseUrl, options.pathsBasePath, path.join(path.dirname(findProjectConfig(fileDir) ?? fileDir), 'src')];
    for (const base of baseDirs) {
      if (typeof base === 'string' && fs.existsSync(path.join(base, first))) return true;
    }
    const text = this.bundlerConfigText(fileDir);
    return text.includes(`'${first}`) || text.includes(`"${first}`) || text.includes(`\`${first}`);
  }
}

interface ImportSite {
  specifier: ts.StringLiteralLike;
  /** `{ a, b as c }` in `import { ... } from` or `export { ... } from`. */
  namedImports: Array<ts.ImportSpecifier | ts.ExportSpecifier>;
  /** `x` in `import x from 'mod'`. */
  defaultImport?: ts.Identifier;
}

function collectImportSites(sourceFile: ts.SourceFile): ImportSite[] {
  const sites: ImportSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      sites.push({
        specifier: node.moduleSpecifier,
        namedImports: bindings !== undefined && ts.isNamedImports(bindings) ? [...bindings.elements] : [],
        defaultImport: node.importClause?.name
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      sites.push({
        specifier: node.moduleSpecifier,
        namedImports: clause !== undefined && ts.isNamedExports(clause) ? [...clause.elements] : []
      });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      sites.push({ specifier: node.arguments[0], namedImports: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

export async function checkImports(
  files: readonly string[],
  rootDir: string,
  registryLookup: RegistryLookup
): Promise<ImportFinding[]> {
  if (files.length === 0) return [];

  const resolution = new ResolutionIndex();
  const rootConfig = resolution.configFor(rootDir);
  const options = rootConfig.options;
  // Include the project's own declaration files so ambient modules and
  // module augmentations count as exports.
  const program = ts.createProgram({ rootNames: [...new Set([...files, ...rootConfig.declarationFiles])], options });
  const checker = program.getTypeChecker();
  const packages = new PackageIndex();
  const findings: ImportFinding[] = [];
  const pendingRegistry: Array<{ finding: ImportFinding; packageName: string }> = [];

  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined || sourceFile.isDeclarationFile) continue;
    const fileDir = path.dirname(file);
    const scope = packages.scopeFor(fileDir);
    const fileOptions = resolution.configFor(fileDir).options;

    for (const site of collectImportSites(sourceFile)) {
      const specifier = site.specifier.text;
      const position = sourceFile.getLineAndCharacterOfPosition(site.specifier.getStart(sourceFile));
      const where = { file, line: position.line + 1, column: position.character + 1 };
      const resolved = ts.resolveModuleName(specifier, file, fileOptions, ts.sys).resolvedModule;

      if (resolved === undefined && isBarePackageSpecifier(specifier) && scope.hasManifest &&
        !resolution.isAlias(specifier, fileDir, fileOptions)) {
        const packageName = packageNameOf(specifier);
        const declared = scope.declared.has(packageName) || scope.declared.has(typesPackageFor(packageName));
        if (!declared && !packages.isInstalled(fileDir, packageName)) {
          const finding: ImportFinding = {
            type: 'undeclared_dependency',
            ...where,
            code: `'${specifier}'`,
            message: `'${packageName}' is not declared in package.json and is not installed.`
          };
          findings.push(finding);
          pendingRegistry.push({ finding, packageName });
        }
      }

      if (site.namedImports.length === 0 && site.defaultImport === undefined) continue;

      // Only check modules whose exports are declared in TypeScript. Exports
      // inferred from plain JS, or behind an `export *` that does not resolve,
      // are incomplete and would produce false positives.
      const checkable = resolved !== undefined && TYPED_EXTENSIONS.has(resolved.extension) &&
        !hasUnresolvedStarExport(program, options, resolved.resolvedFileName, new Set());
      const moduleSymbol = checkable ? checker.getSymbolAtLocation(site.specifier) : undefined;
      if (moduleSymbol === undefined) {
        // No types to check against. Fall back to the list of well-known mix-ups.
        for (const element of site.namedImports) {
          const imported = (element.propertyName ?? element.name).text;
          if (KNOWN_WRONG_IMPORTS.get(specifier)?.has(imported)) {
            findings.push(missingExportFinding(sourceFile, element, specifier, imported, file));
          }
        }
        continue;
      }

      const exported = new Set(checker.getExportsOfModule(moduleSymbol).map(symbol => symbol.name));
      // Modules typed as `export = something` without members expose nothing we can check.
      // An ES module with no exports (`export {}`) is still checked.
      if (exported.size === 0 && moduleSymbol.exports?.has(ts.InternalSymbolName.ExportEquals)) continue;
      const hasDefault = exported.has('default') || hasSyntheticDefault(program, moduleSymbol, resolved);
      if (site.defaultImport !== undefined && !hasDefault) {
        findings.push(missingExportFinding(sourceFile, site.defaultImport, specifier, 'default', file));
      }
      // `{ default as x }` and `export { default } from` name the default export too.
      for (const element of site.namedImports) {
        const imported = (element.propertyName ?? element.name).text;
        if (imported === 'default' ? !hasDefault : !exported.has(imported)) {
          findings.push(missingExportFinding(sourceFile, element, specifier, imported, file));
        }
      }
    }
  }

  // Only undeclared, uninstalled, non-alias names are looked up, so this stays
  // small. Lookups run in parallel.
  const names = [...new Set(pendingRegistry.map(entry => entry.packageName))];
  const results = await Promise.all(names.map(name => registryLookup(name)));
  const statuses = new Map(names.map((name, index) => [name, results[index]]));
  for (const { finding, packageName } of pendingRegistry) {
    if (statuses.get(packageName) === 'missing') {
      finding.type = 'nonexistent_package';
      finding.message = `'${packageName}' does not exist on the npm registry.`;
    }
  }

  return findings;
}

/**
 * CommonJS modules get a synthesized default import (esModuleInterop), the
 * way TypeScript allows it: an `export =` module, or a declaration file that
 * is not in ES module format. ES modules without a default export have none.
 */
function hasSyntheticDefault(program: ts.Program, moduleSymbol: ts.Symbol, resolved: ts.ResolvedModuleFull | undefined): boolean {
  if (moduleSymbol.exports?.has(ts.InternalSymbolName.ExportEquals)) return true;
  const target = resolved === undefined ? undefined : program.getSourceFile(resolved.resolvedFileName);
  return target !== undefined && target.isDeclarationFile && target.impliedNodeFormat !== ts.ModuleKind.ESNext;
}

const TYPED_EXTENSIONS = new Set<string>([
  ts.Extension.Ts, ts.Extension.Tsx, ts.Extension.Dts, ts.Extension.Mts, ts.Extension.Cts, ts.Extension.Dmts, ts.Extension.Dcts
]);

function hasUnresolvedStarExport(program: ts.Program, options: ts.CompilerOptions, fileName: string, seen: Set<string>): boolean {
  if (seen.has(fileName)) return false;
  seen.add(fileName);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) return true;
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.exportClause !== undefined ||
      statement.moduleSpecifier === undefined || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const target = ts.resolveModuleName(statement.moduleSpecifier.text, fileName, options, ts.sys).resolvedModule;
    if (target === undefined || !TYPED_EXTENSIONS.has(target.extension) ||
      hasUnresolvedStarExport(program, options, target.resolvedFileName, seen)) {
      return true;
    }
  }
  return false;
}

function missingExportFinding(
  sourceFile: ts.SourceFile,
  element: ts.ImportSpecifier | ts.ExportSpecifier | ts.Identifier,
  moduleName: string,
  imported: string,
  file: string
): ImportFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
  const isDefault = ts.isIdentifier(element);
  return {
    type: 'hallucinated_import',
    file,
    line: position.line + 1,
    column: position.character + 1,
    code: isDefault
      ? `import ${element.text} from '${moduleName}'`
      : `${ts.isExportSpecifier(element) ? 'export' : 'import'} { ${imported} } from '${moduleName}'`,
    message: imported === 'default' ? `'${moduleName}' has no default export.` : `'${imported}' is not exported by '${moduleName}'.`,
    fix: hintFor(moduleName, imported)
  };
}

/** This package's version from package.json, or 'unknown'. */
export function ownVersion(): string {
  try {
    const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'package.json');
    const version: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
    return typeof version === 'string' ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Sent with every npm registry request, as the registry asks of programmatic clients. */
export const NPM_REGISTRY_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': `karpeslop/${ownVersion()}`
};

/** Look up a package on the public npm registry. Network errors give 'unknown'. */
export async function npmRegistryLookup(packageName: string): Promise<RegistryStatus> {
  if (process.env.KARPESLOP_OFFLINE === '1') return 'unknown';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2f')}`, {
      method: 'HEAD',
      headers: NPM_REGISTRY_HEADERS,
      signal: controller.signal
    });
    if (response.status === 404) return 'missing';
    return response.ok ? 'exists' : 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
