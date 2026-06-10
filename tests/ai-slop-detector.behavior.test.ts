import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasOnlyFreshPackageWarnings,
  isRegistryBackedLockfileEntry,
  shouldAnalyzePathInQuietMode
} from '../ai-slop-detector.ts';

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
      { type: 'any_type_usage' }
    ]),
    false
  );
});
