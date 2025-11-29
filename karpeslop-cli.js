#!/usr/bin/env node
// This is an ES module wrapper for the KarpeSlop CLI tool

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the path to the TypeScript file and local tsx binary
const detectorPath = join(__dirname, 'ai-slop-detector.ts');
const tsxPath = join(__dirname, 'node_modules', '.bin', 'tsx');
const tsxPathWin = join(__dirname, 'node_modules', '.bin', 'tsx.cmd');

// Check if we're on Windows
const isWindows = process.platform === 'win32';
const tsxCommand = isWindows ? tsxPathWin : tsxPath;

// Get command line arguments, excluding the first two (node and script path)
const args = process.argv.slice(2);

// Run with local tsx
const child = spawn(
  tsxCommand,
  [detectorPath, ...args],
  { stdio: 'inherit', cwd: process.cwd() }
);

child.on('error', (err) => {
  console.error('Failed to start karpeslop:', err.message);

  // Fallback: try to run via node with tsx import
  if (err.code === 'ENOENT') {
    const nodeChild = spawn(
      'node',
      ['--import', 'tsx', detectorPath, ...args],
      { stdio: 'inherit', cwd: process.cwd() }
    );

    nodeChild.on('error', (nodeErr) => {
      console.error('Fallback execution also failed:', nodeErr.message);
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});