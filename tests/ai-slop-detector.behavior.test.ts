import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  findUnsafeAssertions,
  hasOnlyFreshPackageWarnings,
  isExcludedPath,
  isRegistryBackedLockfileEntry,
  parseVersionRange,
  shouldAnalyzePathInQuietMode,
  splitCliArgs,
} from '../ai-slop-detector.ts';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('quiet mode still filters explicit paths to core app files and manifests', () => {
  const rootDir = '/repo';
  const coreAppDirs = ['app/', 'components/', 'lib/', 'hooks/', 'services/'];

  assert.equal(shouldAnalyzePathInQuietMode('/repo/app/inside.ts', rootDir, coreAppDirs), true);
  assert.equal(shouldAnalyzePathInQuietMode('/repo/src/outside.ts', rootDir, coreAppDirs), false);
  assert.equal(shouldAnalyzePathInQuietMode('/repo/package.json', rootDir, coreAppDirs), true);
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
  const tmpDir = fs.mkdtempSync(path.join(process.platform === 'win32' ? process.env.TEMP! : '/tmp', 'karpeslop-strict-'));
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
  const fixtureFile = path.resolve(process.cwd(), 'tests/fixtures/temp-off-fixture.ts');
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

test('findUnsafeAssertions does not report in .d.ts files', () => {
  assert.equal(findUnsafeAssertions('const x = value as unknown as Foo;', 'types.d.ts').length, 0);
});

test('findUnsafeAssertions does not report when preceded by @ts-expect-error', () => {
  const code = '// @ts-expect-error\nconst x = value as unknown as Foo;';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report when preceded by eslint-disable-next-line', () => {
  const code = '// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst x = value as Record<string, unknown>;';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
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
  assert.equal(findings[0].line, 2);
});

test('findUnsafeAssertions suppresses multiline as any with eslint-disable-line on the any line', () => {
  const code = 'const x = value as\nany; // eslint-disable-line';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
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

test('findUnsafeAssertions does not report as any when preceded by @ts-expect-error', () => {
  const code = '// @ts-expect-error\nconst x = value as any;';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report as any when preceded by eslint-disable-next-line', () => {
  const code = '// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst x = value as any;';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
});

test('findUnsafeAssertions does not report as any in .d.ts files', () => {
  assert.equal(findUnsafeAssertions('const x = value as any;', 'types.d.ts').length, 0);
});

test('findUnsafeAssertions suppresses as any on line 1 with eslint-disable-line', () => {
  const code = 'const x = value as any; // eslint-disable-line';
  assert.equal(findUnsafeAssertions(code, 'x.ts').length, 0);
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

  const anyFinding = findings.find(f => f.type === 'unsafe_type_assertion')!;
  assert.ok(anyFinding.code.includes('as any'));
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
  const fixtureFile = path.resolve(process.cwd(), 'tests/fixtures/temp-chained-any-fixture.ts');
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
    fs.writeFileSync(configFile, savedConfig, 'utf-8');
  }
});

test('default mode skips unsafe_type_assertion in test files', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.platform === 'win32' ? process.env.TEMP! : '/tmp', 'karpeslop-spec-'));
  const fixtureFile = path.join(tmpDir, 'component.test.ts');

  fs.writeFileSync(fixtureFile, 'const x = value as any;\n', 'utf-8');

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.resolve(process.cwd(), 'ai-slop-detector.ts'), fixtureFile],
    { encoding: 'utf-8', cwd: process.cwd() }
  );

  try {
    assert.ok(!result.stdout.includes('unsafe_type_assertion'),
      `should not report as any in test files. stdout:"${result.stdout}"`);
  } finally {
    fs.unlinkSync(fixtureFile);
    fs.rmdirSync(tmpDir);
  }
});

test('default mode still reports unsafe_type_assertion in non-test files', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.platform === 'win32' ? process.env.TEMP! : '/tmp', 'karpeslop-src-'));
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

test('-- separator lets paths starting with - be treated as targets, not flags', () => {
  const tmpDir = fs.mkdtempSync(path.join(process.platform === 'win32' ? process.env.TEMP! : '/tmp', 'karpeslop-dash-'));
  const fixtureFile = path.join(tmpDir, '-my-file.ts');

  // Write a file with an any-type so there's actual slop to report.
  // We assert that the file name appears in stdout, proving it was scanned and not dropped.
  fs.writeFileSync(fixtureFile, 'const x: any = 1;\n', 'utf-8');

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
