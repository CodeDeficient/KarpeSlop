import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
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
