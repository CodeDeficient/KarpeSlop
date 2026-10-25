#!/usr/bin/env node
// The published entry point. The prepare script (run by npm install, npm link and npm pack) compiles the TypeScript sources to dist/.
import { main } from './dist/ai-slop-detector.js';

main().catch(error => {
  console.error('KarpeSlop failed:', error);
  process.exit(1);
});
