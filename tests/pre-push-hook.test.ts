import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOK_SOURCE = path.resolve(process.cwd(), '.githooks/pre-push');
const ZERO = '0'.repeat(40);
const OID = 'a'.repeat(40);

function record(remoteRef: string): string {
  return `refs/heads/work ${OID} ${remoteRef} ${ZERO}\n`;
}

/** Copy the hook into a fresh hooks directory, optionally with a pre-push.local. */
function hooksDir(localHook?: string, mode = 0o755): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-hooks-'));
  fs.copyFileSync(HOOK_SOURCE, path.join(dir, 'pre-push'));
  fs.chmodSync(path.join(dir, 'pre-push'), 0o755);
  if (localHook !== undefined) {
    fs.writeFileSync(path.join(dir, 'pre-push.local'), localHook, 'utf-8');
    fs.chmodSync(path.join(dir, 'pre-push.local'), mode);
  }
  return dir;
}

function runHook(dir: string, input: string) {
  return spawnSync('sh', [path.join(dir, 'pre-push'), 'origin', 'git@example.com:repo.git'], {
    input,
    encoding: 'utf-8'
  });
}

// Records what the chained hook saw, after consuming all of stdin.
const RECORDING_HOOK = '#!/bin/sh\ncat > "$(dirname "$0")/seen-input"\nprintf \'%s\\n\' "$*" > "$(dirname "$0")/seen-args"\n';

test('pre-push blocks main when it is not the first of several refs', () => {
  const dir = hooksDir();
  try {
    const result = runHook(dir, record('refs/heads/feature') + record('refs/heads/main'));
    assert.equal(result.status, 1, `stderr:"${result.stderr}"`);
    assert.match(result.stderr, /refs\/heads\/main/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-push allows several feature refs', () => {
  const dir = hooksDir();
  try {
    const result = runHook(dir, record('refs/heads/a') + record('refs/heads/b'));
    assert.equal(result.status, 0, `stderr:"${result.stderr}"`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-push blocks master before a stdin-consuming chained hook runs', () => {
  const dir = hooksDir(RECORDING_HOOK);
  try {
    const result = runHook(dir, record('refs/heads/master'));
    assert.equal(result.status, 1, `stderr:"${result.stderr}"`);
    assert.equal(fs.existsSync(path.join(dir, 'seen-input')), false, 'chained hook must not run for a blocked push');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-push passes the original records and arguments to the chained hook', () => {
  const dir = hooksDir(RECORDING_HOOK);
  const input = record('refs/heads/a') + record('refs/heads/b');
  try {
    const result = runHook(dir, input);
    assert.equal(result.status, 0, `stderr:"${result.stderr}"`);
    assert.equal(fs.readFileSync(path.join(dir, 'seen-input'), 'utf-8'), input);
    assert.equal(fs.readFileSync(path.join(dir, 'seen-args'), 'utf-8'), 'origin git@example.com:repo.git\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-push gives the chained hook empty input for an up-to-date push', () => {
  const dir = hooksDir(RECORDING_HOOK);
  try {
    const result = runHook(dir, '');
    assert.equal(result.status, 0, `stderr:"${result.stderr}"`);
    assert.equal(fs.readFileSync(path.join(dir, 'seen-input'), 'utf-8'), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-push fails when the chained hook fails', () => {
  const dir = hooksDir('#!/bin/sh\ncat >/dev/null\nexit 3\n');
  try {
    const result = runHook(dir, record('refs/heads/feature'));
    assert.equal(result.status, 3, `stderr:"${result.stderr}"`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pre-push fails when the chained hook is not executable', () => {
  const dir = hooksDir('#!/bin/sh\nexit 0\n', 0o644);
  try {
    const result = runHook(dir, record('refs/heads/feature'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not executable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
