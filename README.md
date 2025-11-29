# KarpeSlop

[![npm version](https://badge.fury.io/js/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![npm downloads](https://img.shields.io/npm/dm/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> "Because `any` is the mind virus of our generation."
> — probably @karpathy

The first linter that detects **all three axes of AI slop**:

1. Information Utility (Noise)
2. Information Quality (Hallucinations & Lies)
3. Style / Taste (Soul)

Currently speaks fluent **TypeScript / JavaScript / React / Next.js**.
Python support coming when the pigs learn to fly.

## Installation

```bash
# Run once without installing
npx karpeslop

# Or install globally
npm install -g karpeslop
karpeslop
```

## Usage

Run in your project directory:

```bash
# Full scan (all files)
npx karpeslop

# Quiet mode - only scan core app files (recommended for CI)
npx karpeslop --quiet

# The tool generates a detailed JSON report at ./ai-slop-report.json
```

## Features

- **AI Slop Detection**: Identifies the three axes of AI-generated code problems
- **Type Safety Analysis**: Detects improper use of `any`, unsafe type assertions
- **Comment Quality**: Flags hedging, overconfident, and redundant comments
- **Import Validation**: Catches hallucinated imports (e.g., React APIs in wrong packages)
- **Code Quality**: Finds TODOs, assumptions, and poor coding practices

## Example Output

```
KARPATHY SLOP INDEX™
══════════════════════════════════════════════════
Information Utility (Noise) : 42 pts
Information Quality (Lies)  : 87 pts
Style / Taste (Soul)        : 5535 pts
TOTAL KARPE-SLOP SCORE      : 5664 pts

SUEEEY! Here piggy piggy... this codebase is 100% slop-fed.
```

## License

MIT — go forth and purge the slop.
