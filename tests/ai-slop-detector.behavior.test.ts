import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AISlopDetector,
  exitCodeFor,
  failOnFrom,
  findUnsafeAssertions,
  hasOnlyFreshPackageWarnings,
  isExcludedPath,
  isRegistryBackedLockfileEntry,
  parseVersionRange,
  pLimit,
  shouldAnalyzePathInQuietMode,
  splitCliArgs,
  uniqueRealFiles,
  unknownFlags,
} from '../ai-slop-detector.ts';
import { npmRegistryLookup } from '../imports.ts';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('quiet mode still filters explicit paths to core app files and manifests', () => {
  const rootDir = '/repo';
  const coreAppDirs = ['app/', 'components/', 'lib/', 'hooks/', 'services/'];

  assert.equal(shouldAnalyzePathInQuietMode('/repo/app/inside.ts', rootDir, coreAppDirs), true);
  assert.equal(shouldAnalyzePathInQuietMode('/repo/src/outside.ts', rootDir, coreAppDirs), false);
  assert.equal(shouldAnalyzePathInQuietMode('/repo/package.json', rootDir, coreAppDirs), true);
  assert.equal(shouldAnalyzePathInQuietMode('/repo/packages/ui/app/inside.ts', rootDir, coreAppDirs), true);
  assert.equal(shouldAnalyzePathInQuietMode('/repo/packages/ui/app.ts', rootDir, coreAppDirs), false);
  assert.equal(shouldAnalyzePathInQuietMode('/repo/applications/x.ts', rootDir, coreAppDirs), false);
});

test('symlinked copies of a file are scanned once, under the real path', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-links-')));
  try {
    fs.writeFileSync(path.join(dir, 'config.ts'), 'export {};\n');
    fs.mkdirSync(path.join(dir, 'pkg'));
    fs.symlinkSync(path.join(dir, 'config.ts'), path.join(dir, 'pkg', 'config.ts'));
    assert.deepEqual(uniqueRealFiles([path.join(dir, 'pkg', 'config.ts'), path.join(dir, 'config.ts')]), [path.join(dir, 'config.ts')]);
    assert.deepEqual(uniqueRealFiles([path.join(dir, 'config.ts'), path.join(dir, 'pkg', 'config.ts')]), [path.join(dir, 'config.ts')]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace-local lockfile entries are not treated like registry dependencies', () => {
  assert.equal(isRegistryBackedLockfileEntry('packages/ui'), false);
  assert.equal(isRegistryBackedLockfileEntry('node_modules/parent/node_modules/lodash'), true);
});

test('fresh-package warnings do not trigger the clean banner state', () => {
  assert.equal(hasOnlyFreshPackageWarnings([]), false);
  assert.equal(hasOnlyFreshPackageWarnings([{ type: 'fresh_package_version' }]), true);
  assert.equal(
    hasOnlyFreshPackageWarnings([
      { type: 'fresh_package_version' },
      { type: 'any_type_usage' },
    ]),
    false
  );
});

test('isExcludedPath uses segment-based matching so dist anywhere in path is excluded', () => {
  const rootDir = '/repo';

  // dist/ anywhere in the segment list is excluded
  assert.equal(isExcludedPath('/repo/dist/utils.ts', rootDir), true);
  assert.equal(isExcludedPath('/repo/src/dist/utils.ts', rootDir), true);
  assert.equal(isExcludedPath('/repo/packages/core/dist/index.ts', rootDir), true);

  // Other exclusions still fire
  assert.equal(isExcludedPath('/repo/node_modules/lodash/index.ts', rootDir), true);
  assert.equal(isExcludedPath('/repo/coverage/lcov-report/index.ts', rootDir), true);
  assert.equal(isExcludedPath('/repo/src/components/Button.tsx', rootDir), false);
});

test('isExcludedPath skips build, out and temp only at the root or next to a package.json', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-output-'));
  fs.mkdirSync(path.join(rootDir, 'packages', 'next', 'src', 'build'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'packages', 'next', 'package.json'), '{}');
  try {
    assert.equal(isExcludedPath(path.join(rootDir, 'build', 'index.js'), rootDir), true);
    assert.equal(isExcludedPath(path.join(rootDir, 'out', 'page.js'), rootDir), true);
    assert.equal(isExcludedPath(path.join(rootDir, 'packages', 'next', 'build', 'index.js'), rootDir), true);
    assert.equal(isExcludedPath(path.join(rootDir, 'packages', 'next', 'src', 'build', 'webpack.ts'), rootDir), false);
    assert.equal(isExcludedPath(path.join(rootDir, 'scripts', 'temp', 'clean.ts'), rootDir), false);
    assert.equal(isExcludedPath(path.join(rootDir, 'src', 'build.ts'), rootDir), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('isExcludedPath scans hand-written types/ folders but still skips .d.ts files', () => {
  const rootDir = '/repo';

  assert.equal(isExcludedPath('/repo/src/types/user.ts', rootDir), false);
  assert.equal(isExcludedPath('/repo/types/api.ts', rootDir), false);
  assert.equal(isExcludedPath('/repo/src/types/global.d.ts', rootDir), true);
  assert.equal(isExcludedPath('/repo/types/esm.d.mts', rootDir), true);
  assert.equal(isExcludedPath('/repo/types/cjs.d.cts', rootDir), true);
});

test('isExcludedPath with allowOutsideRoot preserves targets outside repo root', () => {
  const rootDir = '/repo';

  // Outside repo root → relativePath starts with ".."
  // With allowOutsideRoot=true, it resolves absolute path and checks segments.
  // /other/project/dist/foo.ts contains "dist" → excluded.
  assert.equal(isExcludedPath('/other/project/dist/foo.ts', rootDir, true), true);

  // /other/project/app/foo.ts has no excluded segment → preserved.
  assert.equal(isExcludedPath('/other/project/app/foo.ts', rootDir, true), false);
});

test('parseVersionRange intentionally only handles caret and tilde', () => {
  assert.deepStrictEqual(parseVersionRange('^1.2.3'), { actualVersion: '1.2.3', isRange: true });
  assert.deepStrictEqual(parseVersionRange('~4.5.6'), { actualVersion: '4.5.6', isRange: true });

  // Exact versions are not treated as ranges
  assert.deepStrictEqual(parseVersionRange('2.0.0'), { actualVersion: '2.0.0', isRange: false });

  // Broader operators (explicitly not handled)
  assert.deepStrictEqual(parseVersionRange('>=1.0.0'), { actualVersion: '>=1.0.0', isRange: false });
  assert.deepStrictEqual(parseVersionRange('1.x'), { actualVersion: '1.x', isRange: false });
  assert.deepStrictEqual(parseVersionRange('latest'), { actualVersion: 'latest', isRange: false });
  assert.deepStrictEqual(parseVersionRange('*'), { actualVersion: '*', isRange: false });
});

test('pLimit reports a rejected task to onError and still returns the other results', async () => {
  const failures: Array<[string, number]> = [];
  const results = await pLimit([
    async () => 1,
    async () => { throw new Error('registry exploded'); },
    async () => 3,
  ], 2, undefined, (error, index) => failures.push([error instanceof Error ? error.message : String(error), index]));

  assert.deepEqual(results, [1, undefined, 3]);
  assert.deepEqual(failures, [['registry exploded', 1]]);
});

test('pLimit without onError rejects with the task error', async () => {
  await assert.rejects(
    pLimit([async () => { throw new Error('registry exploded'); }], 1),
    /registry exploded/
  );
});

test('a failed package age check names the package and keeps the others', async (t) => {
  const detector = new AISlopDetector(process.cwd());
  detector['getNpmPackageAge'] = async (pkgName: string) => {
    if (pkgName === 'broken') throw new Error('boom');
    return null;
  };
  const warn = t.mock.method(console, 'warn', () => {});

  const manifest = JSON.stringify({ dependencies: { fine: '^1.0.0', broken: '^2.0.0' } });
  await detector['analyzePackageVersions']('/repo/package.json', manifest);

  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /broken@2\.0\.0 failed: boom/);
});

test('splitCliArgs respects -- separator and prevents flag-like paths from being treated as options', () => {
  assert.deepStrictEqual(splitCliArgs(['--quiet', '--']), { flagArgs: ['--quiet'], targetPaths: [] });
  assert.deepStrictEqual(splitCliArgs(['--quiet', '--', '-my-file.ts']), {
    flagArgs: ['--quiet'],
    targetPaths: ['-my-file.ts'],
  });
  assert.deepStrictEqual(splitCliArgs(['--quiet', 'src/app.ts']), {
    flagArgs: ['--quiet'],
    targetPaths: ['src/app.ts'],
  });
  assert.deepStrictEqual(splitCliArgs(['src/app.ts']), { flagArgs: [], targetPaths: ['src/app.ts'] });
  // Without --, anything starting with - is treated as a flag. This is expected.
  assert.deepStrictEqual(splitCliArgs(['-dash-file.ts']), { flagArgs: ['-dash-file.ts'], targetPaths: [] });
});

// ---------------------------------------------------------------------------
// Integration: CLI exit codes
// ---------------------------------------------------------------------------

test('--strict exits with code 2 when critical hallucination is found', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-strict-'));
  const fixtureFile = path.join(tmpDir, 'hallucinated.tsx');

  // The hallucinated_react_import pattern triggers a critical issue
  fs.writeFileSync(fixtureFile, "import { useRouter } from 'react';\n", 'utf-8');

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), '--strict', fixtureFile],
    { encoding: 'utf-8', cwd: process.cwd() }
  );

  try {
    assert.equal(result.status, 2, `Expected exit code 2 but got ${result.status}. stdout:"${result.stdout}" stderr:"${result.stderr}"`);
  } finally {
    fs.unlinkSync(fixtureFile);
    fs.rmdirSync(tmpDir);
  }
});

test('severityOverrides with "off" silences unsafe_double_type_assertion without crashing', () => {
  // Written outside tests/ so the finding is not dropped as a test file before the override applies.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-off-'));
  const fixtureFile = path.join(tmpDir, 'off-fixture.ts');
  const configFile = path.resolve(process.cwd(), '.karpesloprc.json');
  const savedConfig = fs.readFileSync(configFile, 'utf-8');

  fs.writeFileSync(fixtureFile, 'const x = value as unknown as Foo;\n', 'utf-8');

  try {
    const overriddenConfig = JSON.parse(savedConfig);
    overriddenConfig.severityOverrides = { "unsafe_double_type_assertion": "off" };
    fs.writeFileSync(configFile, JSON.stringify(overriddenConfig), 'utf-8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), '--strict', fixtureFile],
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    assert.equal(result.status, 0, `Expected exit code 0 but got ${result.status}. stdout:"${result.stdout}" stderr:"${result.stderr}"`);
    assert.ok(!result.stdout.includes('unsafe_double'), 'should not mention the suppressed pattern');
  } finally {
    fs.unlinkSync(fixtureFile);
    fs.rmdirSync(tmpDir);
    fs.writeFileSync(configFile, savedConfig, 'utf-8');
  }
});

// ---------------------------------------------------------------------------
// Unsafe assertions (AST-based)
// ---------------------------------------------------------------------------

test('findUnsafeAssertions does not report as const', () => {
  assert.equal(findUnsafeAssertions('const x = 42 as const;', 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report as typeof x', () => {
  assert.equal(findUnsafeAssertions('const x: typeof y = val as typeof y;', 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report as keyof T', () => {
  assert.equal(findUnsafeAssertions('type K = keyof T; const k = v as keyof T;', 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report in JavaScript files', () => {
  for (const fileName of ['x.js', 'x.jsx', 'x.mjs', 'x.cjs']) {
    assert.equal(findUnsafeAssertions('const y = value as any;\nconst z = (v as unknown) as Foo;', fileName).length, 0, fileName);
  }
  assert.equal(findUnsafeAssertions('const y = value as any;', 'x.mts').length, 1);
});

test('findUnsafeAssertions does not report in .d.ts files', () => {
  assert.equal(findUnsafeAssertions('const x = value as unknown as Foo;', 'types.d.ts').length, 0);
});

test('findUnsafeAssertions reports despite @ts-expect-error comment', () => {
  const code = '// @ts-expect-error\nconst x = value as unknown as Foo;';
  const findings = findUnsafeAssertions(code, 'x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_double_type_assertion');
});

test('findUnsafeAssertions reports despite eslint-disable-next-line comment', () => {
  const code = '// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst x = value as Record<string, unknown>;';
  const findings = findUnsafeAssertions(code, 'x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_object_assertion');
});

test('findUnsafeAssertions detects unsafe array assertion as EventRow[]', () => {
  const code = 'const rows = data as EventRow[];';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_array_assertion');
  assert.equal(findings[0].severity, 'high');
});

test('findUnsafeAssertions detects unsafe object assertion as Record<string, unknown>', () => {
  const code = 'const record = value as Record<string, unknown>;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_object_assertion');
  assert.equal(findings[0].severity, 'high');
});

test('findUnsafeAssertions on the fixtures/unsafe-assertions.ts fixture reports all three forms', () => {
  const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/unsafe-assertions.ts');
  const code = fs.readFileSync(fixturePath, 'utf-8');
  const findings = findUnsafeAssertions(code, 'unsafe-assertions.ts');

  const types = findings.map(f => f.type);
  assert.ok(types.includes('unsafe_double_type_assertion'), 'should report double assertion');
  assert.ok(types.includes('unsafe_array_assertion'), 'should report array assertion');
  assert.ok(types.includes('unsafe_object_assertion'), 'should report object assertion');

  const doubleFindings = findings.filter(f => f.type === 'unsafe_double_type_assertion');
  assert.ok(doubleFindings.length >= 1);
  assert.ok(doubleFindings[0].code.includes('as unknown as'));

  const arrFindings = findings.filter(f => f.type === 'unsafe_array_assertion');
  assert.equal(arrFindings.length, 1);
  assert.ok(arrFindings[0].code.includes('EventRow[]'));

  const objFindings = findings.filter(f => f.type === 'unsafe_object_assertion');
  assert.equal(objFindings.length, 1);
  assert.ok(objFindings[0].code.includes('Record<string, unknown>'));
});

test('findUnsafeAssertions detects unsafe as any assertion', () => {
  const code = 'const x = value as any;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_type_assertion');
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].severity, 'high');
  assert.ok(findings[0].code.includes('as any'));
});

test('findUnsafeAssertions does not report as any inside a line comment', () => {
  const code = '// this is as any comment';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report as any inside a string', () => {
  const code = 'const msg = "this is as any test";';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report as any inside a template literal', () => {
  const code = 'const msg = `this is as any test`;';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
});

test('findUnsafeAssertions detects unsafe as any assertion in nested expression', () => {
  const code = 'const x = foo(value as any);';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_type_assertion');
  assert.equal(findings[0].line, 1);
});

test('findUnsafeAssertions detects unsafe as any assertion in multiline expression', () => {
  const code = 'const x = value as\n  any;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_type_assertion');
  assert.equal(findings[0].line, 1);
});

test('findUnsafeAssertions reports multiline as any at its first line despite eslint-disable-line on the any line', () => {
  const code = 'const x = value as\nany; // eslint-disable-line';
  const findings = findUnsafeAssertions(code, 'x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_type_assertion');
  assert.equal(findings[0].line, 1);
});

test('findUnsafeAssertions reports every cast form at the column where the cast starts', () => {
  const positions = (code: string) => findUnsafeAssertions(code, 'x.ts').map(f => `${f.type}@${f.line}:${f.column}`);
  assert.deepEqual(positions('const a = value as any;'), ['unsafe_type_assertion@1:11']);
  assert.deepEqual(positions('const a = <any>value;'), ['unsafe_type_assertion@1:11']);
  assert.deepEqual(positions('const a = value as unknown as any;'),
    ['unsafe_double_type_assertion@1:11', 'unsafe_type_assertion@1:11']);
  assert.deepEqual(positions('const a = value as Record<string, unknown>;'), ['unsafe_object_assertion@1:11']);
  assert.deepEqual(positions('const a = value as Foo[];'), ['unsafe_array_assertion@1:11']);
});

test('unsafe_type_assertion guidance does not recommend chained assertion pattern to users', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), path.resolve(process.cwd(), 'tests/t4-educational-output.ts')],
    { encoding: 'utf-8', cwd: process.cwd() }
  );

  assert.ok(!result.stdout.includes('as unknown as TargetType'),
    `guidance should not recommend chained assertions. stdout:"${result.stdout}"`);
});

test('findUnsafeAssertions detects multiple as any assertions on separate lines', () => {
  const code = 'const a = x as any;\nconst b = y as any;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 2);
  assert.ok(findings.every(f => f.type === 'unsafe_type_assertion'));
});

test('findUnsafeAssertions reports as any despite preceding @ts-expect-error', () => {
  const code = '// @ts-expect-error\nconst x = value as any;';
  const findings = findUnsafeAssertions(code, 'x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_type_assertion');
});

test('findUnsafeAssertions reports as any despite preceding eslint-disable-next-line', () => {
  const code = '// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst x = value as any;';
  const findings = findUnsafeAssertions(code, 'x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_type_assertion');
});

test('findUnsafeAssertions does not report as any in .d.ts files', () => {
  assert.equal(findUnsafeAssertions('const x = value as any;', 'types.d.ts').length, 0);
});

test('findUnsafeAssertions reports as any despite eslint-disable-line on same line', () => {
  const code = 'const x = value as any; // eslint-disable-line';
  const findings = findUnsafeAssertions(code, 'x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'unsafe_type_assertion');
});

test('findUnsafeAssertions detects chained as unknown as T as unsafe_double_type_assertion', () => {
  const code = 'const rows = value as unknown as EventRow[];';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.type, 'unsafe_double_type_assertion');
  assert.equal(finding.line, 1);
  assert.equal(finding.severity, 'high');
  assert.ok(finding.code.includes('as unknown as'));
});

test('findUnsafeAssertions detects chained as Foo as Bar as unsafe_double_type_assertion', () => {
  const code = 'const value = input as Foo as Bar;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.type, 'unsafe_double_type_assertion');
  assert.equal(finding.line, 1);
  assert.equal(finding.severity, 'high');
});

test('findUnsafeAssertions reports 2 findings for 3-deep chain', () => {
  const code = 'const value = input as Bar as Baz as Qux;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 2);
  assert.ok(findings.every(f => f.type === 'unsafe_double_type_assertion'));
});

test('findUnsafeAssertions reports 3 findings for 4-deep chain', () => {
  const code = 'const value = input as Bar as Baz as Qux as Zap;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 3);
  assert.ok(findings.every(f => f.type === 'unsafe_double_type_assertion'));
});

test('findUnsafeAssertions reports double and any for chained as Bar as any', () => {
  const code = 'const value = input as Bar as any;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 2);
  const types = findings.map(f => f.type);
  assert.ok(types.includes('unsafe_double_type_assertion'));
  assert.ok(types.includes('unsafe_type_assertion'));

  const anyFinding = findings.find(f => f.type === 'unsafe_type_assertion');
  assert.ok(anyFinding?.code.includes('as any'));
});

test('findUnsafeAssertions reports both double and any assertion for chained as unknown as any', () => {
  const code = 'const value = input as unknown as any;';

  const findings = findUnsafeAssertions(code, 'x.ts');

  assert.equal(findings.length, 2);
  const types = findings.map(f => f.type);
  assert.ok(types.includes('unsafe_double_type_assertion'), 'should report double assertion');
  assert.ok(types.includes('unsafe_type_assertion'), 'should report any assertion');
  assert.ok(findings.every(f => f.severity === 'high'));
});

test('severityOverrides disabling unsafe_double_type_assertion still reports unsafe_type_assertion for chained as unknown as any', () => {
  // Written outside tests/ so the file is not treated as a test file.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-chained-'));
  const fixtureFile = path.join(tmpDir, 'chained-any.ts');
  const configFile = path.resolve(process.cwd(), '.karpesloprc.json');
  const savedConfig = fs.readFileSync(configFile, 'utf-8');

  fs.writeFileSync(fixtureFile, 'const value = input as unknown as any;\n', 'utf-8');

  try {
    const overriddenConfig = JSON.parse(savedConfig);
    overriddenConfig.severityOverrides = { "unsafe_double_type_assertion": "off" };
    fs.writeFileSync(configFile, JSON.stringify(overriddenConfig), 'utf-8');

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), '--strict', fixtureFile],
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    assert.equal(result.status, 1, `Expected exit code 1 (high severity finding) but got ${result.status}. stdout:"${result.stdout}" stderr:"${result.stderr}"`);
    assert.ok(!result.stdout.includes('unsafe_double'), 'should not mention the suppressed double assertion');
    assert.ok(result.stdout.includes('unsafe_type_assertion'), 'should still mention the any assertion');
  } finally {
    fs.unlinkSync(fixtureFile);
    fs.rmdirSync(tmpDir);
    fs.writeFileSync(configFile, savedConfig, 'utf-8');
  }
});

test('default mode skips unsafe_type_assertion in test files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-spec-'));
  const fixtureFile = path.join(tmpDir, 'component.test.ts');

  fs.writeFileSync(fixtureFile, 'const x = value as any;\n', 'utf-8');

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), fixtureFile],
    { encoding: 'utf-8', cwd: process.cwd(), env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );

  try {
    assert.equal(result.status, 0, `Expected exit code 0 (finding excluded) but got ${result.status}. stdout:"${result.stdout}" stderr:"${result.stderr}"`);
    // Exit 0 with no findings is also what an unscanned file gives; prove it was scanned.
    assert.ok(result.stdout.includes('Scanned 1 file'), `the test file should still be scanned. stdout:"${result.stdout}"`);
    assert.ok(!result.stdout.includes('unsafe_type_assertion'),
      `should not report as any in test files. stdout:"${result.stdout}"`);
  } finally {
    fs.unlinkSync(fixtureFile);
    fs.rmdirSync(tmpDir);
  }
});

test('default mode still reports unsafe_type_assertion in non-test files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-src-'));
  const fixtureFile = path.join(tmpDir, 'component.ts');

  fs.writeFileSync(fixtureFile, 'const x = value as any;\n', 'utf-8');

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), fixtureFile],
    { encoding: 'utf-8', cwd: process.cwd() }
  );

  try {
    assert.ok(result.stdout.includes('unsafe_type_assertion'),
      `should report as any in non-test files. stdout:"${result.stdout}"`);
  } finally {
    fs.unlinkSync(fixtureFile);
    fs.rmdirSync(tmpDir);
  }
});

test('a parent directory named test does not turn the whole project into test files', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-parent-'));
  const projectDir = path.join(parent, 'test', 'myapp');
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export const x = value as any;\n', 'utf-8');

  const result = spawnSync(
    process.execPath,
    // Resolve tsx from this repo: the project directory has no node_modules.
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts'), '--quiet'],
    { encoding: 'utf-8', cwd: projectDir, env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );

  try {
    assert.equal(result.status, 1, `stdout:"${result.stdout}" stderr:"${result.stderr}"`);
    assert.ok(result.stdout.includes('unsafe_type_assertion'));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('exit code: high and critical fail by default, --fail-on moves the threshold', () => {
  const medium = [{ type: 'type_assertion', severity: 'medium' as const }];
  const high = [{ type: 'empty_catch', severity: 'high' as const }];
  const fresh = [{ type: 'fresh_package_version', severity: 'medium' as const }];
  assert.equal(exitCodeFor(medium), 0);
  assert.equal(exitCodeFor(high), 1);
  assert.equal(exitCodeFor(medium, 'medium'), 1);
  assert.equal(exitCodeFor(high, 'critical'), 0);
  assert.equal(exitCodeFor(fresh, 'low'), 0);
  assert.equal(failOnFrom([]), 'high');
  assert.equal(failOnFrom(['--fail-on=low', '--fail-on=medium']), 'medium');
  assert.throws(() => failOnFrom(['--fail-on=warning']), /--fail-on must be one of: critical, high, medium, low/);
});

test('a path that cannot be scanned gives a one-line error, not a stack trace', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts'), 'does-not-exist.ts'],
    { encoding: 'utf-8', cwd: os.tmpdir(), env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Target path does not exist, skipping: .*does-not-exist\.ts/);
  assert.match(result.stderr, /KarpeSlop: None of the given paths is a file KarpeSlop can scan/);
  assert.equal(/\n\s+at /.test(result.stderr), false, result.stderr);
});

test('unknown flags are rejected instead of silently ignored', () => {
  assert.deepEqual(unknownFlags(['--quiet', '-s', '--fail-on=low']), []);
  assert.deepEqual(unknownFlags(['--stirct', '--json', '-dash-file.ts']), ['--stirct', '--json', '-dash-file.ts']);
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts'), '--stirct'],
    { encoding: 'utf-8', cwd: os.tmpdir(), env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option '--stirct'/);
  assert.equal(result.stdout.includes('Scanning'), false);
});

test('a severityOverrides key that is not a rule id is reported as a warning', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-override-'));
  fs.writeFileSync(path.join(projectDir, '.karpesloprc.json'), JSON.stringify({ severityOverrides: { type_asertion: 'off', type_assertion: 'low' } }), 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'index.ts'), 'export const n = (v: unknown) => v as number;\n', 'utf-8');
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts')],
    { encoding: 'utf-8', cwd: projectDir, env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );
  try {
    assert.match(result.stderr, /severityOverrides\.type_asertion does not name a rule/);
    assert.equal(result.stderr.includes('severityOverrides.type_assertion '), false);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('a cast alone does not fail the run unless --fail-on=medium is given', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-failon-'));
  fs.writeFileSync(path.join(projectDir, 'index.ts'), 'export const n = (v: unknown) => v as number;\n', 'utf-8');
  const run = (...flags: string[]) => spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts'), ...flags],
    { encoding: 'utf-8', cwd: projectDir, env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );
  try {
    assert.equal(run().status, 0);
    assert.equal(run('--fail-on=medium').status, 1);
    const bad = run('--fail-on=warn');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--fail-on must be one of/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('suppression comments do not hide customPatterns findings', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-custom-'));
  fs.mkdirSync(path.join(projectDir, 'src'));
  fs.writeFileSync(path.join(projectDir, '.karpesloprc.json'), JSON.stringify({
    customPatterns: [{ id: 'legacy_api_call', pattern: 'legacyApi\\(', message: 'Use newApi instead.', severity: 'high' }]
  }), 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'),
    'legacyApi(); // eslint-disable-line\n// eslint-disable-next-line\nlegacyApi();\n// @ts-ignore\nlegacyApi();\n', 'utf-8');

  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts'), '--quiet'],
    { encoding: 'utf-8', cwd: projectDir, env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );

  try {
    assert.equal(result.status, 1, `stdout:"${result.stdout}" stderr:"${result.stderr}"`);
    assert.ok(result.stdout.includes('legacy_api_call (3)'), `stdout:"${result.stdout}"`);
    for (const line of [1, 3, 5]) {
      assert.ok(result.stdout.includes(`src/index.ts:${line}:1`), `line ${line} should be reported. stdout:"${result.stdout}"`);
    }
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('-- separator lets paths starting with - be treated as targets, not flags', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-dash-'));
  const fixtureFile = path.join(tmpDir, '-my-file.ts');

  // Write a file with an `as any` cast (high) so the run fails.
  // We assert that the file name appears in stdout, proving it was scanned and not dropped.
  fs.writeFileSync(fixtureFile, 'const x = 1 as any;\n', 'utf-8');

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), '--', fixtureFile],
    { encoding: 'utf-8', cwd: process.cwd() }
  );

  try {
    assert.equal(result.status, 1, `Expected exit code 1 (slop found) but got ${result.status}. stdout:"${result.stdout}" stderr:"${result.stderr}"`);
    assert.ok(result.stdout.includes(fixtureFile) || result.stdout.includes('-my-file.ts'), 'stdout should mention the scanned file name, proving it was treated as a target');
  } finally {
    fs.unlinkSync(fixtureFile);
    fs.rmdirSync(tmpDir);
  }
});

test('a full scan includes hand-written files under types/', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-types-'));
  fs.mkdirSync(path.join(projectDir, 'src', 'types'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'types', 'user.ts'), 'export const x = value as any;\n', 'utf-8');

  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts')],
    { encoding: 'utf-8', cwd: projectDir, env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );

  try {
    assert.ok(result.stdout.includes('src/types/user.ts'), `stdout:"${result.stdout}" stderr:"${result.stderr}"`);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// npm registry requests
// ---------------------------------------------------------------------------

test('npm registry requests send a karpeslop User-Agent', async (t) => {
  const { version } = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
  const userAgents: Array<string | null> = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    userAgents.push(new Headers(init?.headers).get('User-Agent'));
    return new Response('{"time":{}}', { status: 200 });
  });
  const savedOffline = process.env.KARPESLOP_OFFLINE;
  delete process.env.KARPESLOP_OFFLINE;

  try {
    await npmRegistryLookup('left-pad');
    await new AISlopDetector(process.cwd())['getNpmPackageAge']('left-pad', '1.0.0');
  } finally {
    if (savedOffline !== undefined) process.env.KARPESLOP_OFFLINE = savedOffline;
  }

  assert.deepEqual(userAgents, [`karpeslop/${version}`, `karpeslop/${version}`]);
});

test('finding density counts application code only', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-density-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.ts'), 'export const a = 1;\n// TODO tidy\nexport const b = 2;\n');
    fs.mkdirSync(path.join(dir, '__tests__'));
    // A finding in the test file, which must not count toward application density.
    fs.writeFileSync(path.join(dir, '__tests__', 'a.test.ts'), '// @ts-ignore\n' +
      Array.from({ length: 96 }, (_, i) => `export const t${i} = ${i};`).join('\n') + '\n');
    const log = t.mock.method(console, 'log', () => {});
    const detector = new AISlopDetector(dir, undefined, async () => 'unknown');
    await detector.detect();
    const summary = log.mock.calls.map(call => String(call.arguments[0])).find(line => line.includes('per 1,000'));
    assert.match(summary ?? '', /333\.3 per 1,000 lines of application code/);
    const report = path.join(dir, 'report.json');
    detector.exportResults(report);
    const parsed = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(parsed.linesScanned, 100);
    assert.equal(parsed.applicationLinesScanned, 3);
    assert.ok(parsed.issues.some((issue: { file: string }) => issue.file.includes('a.test.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a custom pattern cannot reuse a built-in or another custom pattern\'s id', () => {
  for (const id of ['fresh_package_version', 'empty_catch']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-custom-id-'));
    try {
      fs.writeFileSync(path.join(dir, '.karpesloprc.json'), JSON.stringify({
        customPatterns: [{ id, pattern: 'x', message: 'm', severity: 'high' }]
      }));
      assert.throws(() => new AISlopDetector(dir), new RegExp(`customPatterns\\[0\\]\\.id '${id}' is a built-in rule id`));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-custom-id-'));
  try {
    const pattern = { id: 'no_foo', pattern: 'foo', message: 'm', severity: 'high' };
    fs.writeFileSync(path.join(dir, '.karpesloprc.json'), JSON.stringify({ customPatterns: [pattern, pattern] }));
    assert.throws(() => new AISlopDetector(dir), /customPatterns\[1\]\.id 'no_foo' is used by another custom pattern/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid config stops the run with exit 1 instead of falling back to defaults', () => {
  const dir = path.resolve(process.cwd(), 'tests/invalid-config');
  const result = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), path.resolve(process.cwd(), 'ai-slop-detector.ts')],
    { encoding: 'utf-8', cwd: dir, env: { ...process.env, KARPESLOP_OFFLINE: '1' } }
  );
  assert.equal(result.status, 1, `stdout:"${result.stdout}" stderr:"${result.stderr}"`);
  assert.match(result.stderr, /KarpeSlop: Invalid config at .*\.karpesloprc\.json: customPatterns\[0\]\.severity must be one of/);
  assert.doesNotMatch(result.stdout, /Scanning/);
});
