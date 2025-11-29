#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the tsx executable in node_modules
const tsxPath = join(__dirname, 'node_modules', '.bin', 'tsx');
const tsxPathWindows = join(__dirname, 'node_modules', '.bin', 'tsx.cmd');

// Check if we're on Windows
const isWindows = process.platform === 'win32';
const command = isWindows ? tsxPathWindows : tsxPath;

// Use spawn to execute tsx with the TypeScript file
const child = spawn(command, [join(__dirname, 'ai-slop-detector.ts'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd()
});

child.on('error', (err) => {
  console.error('Failed to start karpeslop:', err.message);

  // Fallback: try running with node --import if tsx isn't available
  if (err.code === 'ENOENT') {
    console.error('tsx not found, attempting fallback method...');
    const nodeChild = spawn('node', ['--import', 'tsx', join(__dirname, 'ai-slop-detector.ts'), ...process.argv.slice(2)], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    nodeChild.on('error', (nodeErr) => {
      console.error('Fallback method also failed:', nodeErr.message);
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});