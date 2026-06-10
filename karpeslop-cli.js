#!/usr/bin/env node
// This is an ES module wrapper for the KarpeSlop CLI tool

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the tsx loader from this package's dependencies so published
// installs do not depend on a specific node_modules/.bin layout.
const detectorPath = join(__dirname, 'ai-slop-detector.ts');
const tsxLoaderPath = require.resolve('tsx');

function exitCodeForSignal(signal) {
  const signalExitCodes = {
    SIGINT: 130,
    SIGTERM: 143,
    SIGHUP: 129,
    SIGQUIT: 131
  };

  return signalExitCodes[signal] || 1;
}

function handleChildExit(code, signal) {
  if (signal) {
    process.exit(exitCodeForSignal(signal));
  }
  process.exit(code ?? 0);
}

// Get command line arguments, excluding the first two (node and script path)
const args = process.argv.slice(2);

// Run the detector through Node with the resolved tsx loader.
const child = spawn(
  process.execPath,
  ['--import', tsxLoaderPath, detectorPath, ...args],
  { stdio: 'inherit', cwd: process.cwd() }
);

child.on('error', (err) => {
  console.error('Failed to start karpeslop:', err.message);
  process.exit(1);
});

child.on('exit', handleChildExit);
