#!/usr/bin/env node
// The published entry point. `npm pack` compiles the TypeScript sources to dist/ first.
import { main } from './dist/ai-slop-detector.js';

main().catch(error => {
  console.error('KarpeSlop failed:', error);
  process.exit(1);
});
