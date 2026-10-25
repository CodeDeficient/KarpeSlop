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
    ['useEffect', ['react']],
    ['render', ['react-dom/client (createRoot)']]
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

/** Load compiler options from the project's tsconfig/jsconfig, if any. */
function loadCompilerOptions(rootDir: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json') ??
    ts.findConfigFile(rootDir, ts.sys.fileExists, 'jsconfig.json');
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true
  };
  if (configPath !== undefined) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error === undefined) {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
      options = { ...options, ...parsed.options };
    }
  }
  return { ...options, allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true };
}

interface ImportSite {
  specifier: ts.StringLiteralLike;
  namedImports: ts.ImportSpecifier[];
}

function collectImportSites(sourceFile: ts.SourceFile): ImportSite[] {
  const sites: ImportSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      sites.push({
        specifier: node.moduleSpecifier,
        namedImports: bindings !== undefined && ts.isNamedImports(bindings) ? [...bindings.elements] : []
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      sites.push({ specifier: node.moduleSpecifier, namedImports: [] });
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

  const options = loadCompilerOptions(rootDir);
  const program = ts.createProgram({ rootNames: [...files], options });
  const checker = program.getTypeChecker();
  const packages = new PackageIndex();
  const findings: ImportFinding[] = [];
  const pendingRegistry: Array<{ finding: ImportFinding; packageName: string }> = [];

  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined || sourceFile.isDeclarationFile) continue;
    const fileDir = path.dirname(file);
    const scope = packages.scopeFor(fileDir);

    for (const site of collectImportSites(sourceFile)) {
      const specifier = site.specifier.text;
      const position = sourceFile.getLineAndCharacterOfPosition(site.specifier.getStart(sourceFile));
      const where = { file, line: position.line + 1, column: position.character + 1 };
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;

      if (resolved === undefined && isBarePackageSpecifier(specifier) && scope.hasManifest) {
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

      if (site.namedImports.length === 0) continue;

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
      if (exported.size === 0) continue;
      for (const element of site.namedImports) {
        const imported = (element.propertyName ?? element.name).text;
        if (imported !== 'default' && !exported.has(imported)) {
          findings.push(missingExportFinding(sourceFile, element, specifier, imported, file));
        }
      }
    }
  }

  // Only undeclared, uninstalled names are looked up, so this stays small.
  const statuses = new Map<string, Promise<RegistryStatus>>();
  for (const { finding, packageName } of pendingRegistry) {
    if (!statuses.has(packageName)) statuses.set(packageName, registryLookup(packageName));
    const status = await statuses.get(packageName);
    if (status === 'missing') {
      finding.type = 'nonexistent_package';
      finding.message = `'${packageName}' does not exist on the npm registry.`;
    }
  }

  return findings;
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
  element: ts.ImportSpecifier,
  moduleName: string,
  imported: string,
  file: string
): ImportFinding {
  const position = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
  return {
    type: 'hallucinated_import',
    file,
    line: position.line + 1,
    column: position.character + 1,
    code: `import { ${imported} } from '${moduleName}'`,
    message: `'${imported}' is not exported by '${moduleName}'.`,
    fix: hintFor(moduleName, imported)
  };
}

/** Look up a package on the public npm registry. Network errors give 'unknown'. */
export async function npmRegistryLookup(packageName: string): Promise<RegistryStatus> {
  if (process.env.KARPESLOP_OFFLINE === '1') return 'unknown';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2f')}`, {
      method: 'HEAD',
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
