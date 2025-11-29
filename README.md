# KarpeSlop

> "Because `any` is the mind virus of our generation."
> — probably @karpathy

The first linter that detects **all three axes of AI slop**:

1. Information Utility (Noise)
2. Information Quality (Hallucinations & Lies)
3. Style / Taste (Soul)

Currently speaks fluent **TypeScript / JavaScript / React / Next.js**.
Python support coming when the pigs learn to fly.

## Usage

The tool is designed to be used directly with npx:

```bash
# Full analysis
npx karpeslop

# Only core files (recommended for CI)
npx karpeslop --quiet

# Generate detailed report
npx karpeslop
```

Note: Global installation is not currently supported due to TypeScript runtime requirements. Use `npx karpeslop` for best results.

## Features

- **AI Slop Detection**: Identifies the three axes of AI-generated code problems
- **Type Safety Analysis**: Detects improper use of `any`, unsafe type assertions
- **Comment Quality**: Flags hedging, overconfident, and redundant comments
- **Import Validation**: Catches hallucinated imports (e.g., React APIs in wrong packages)
- **Code Quality**: Finds TODOs, assumptions, and poor coding practices

## Example Output

```
KARPATHY SLOPE INDEX™
══════════════════════════════════════════════════
Information Utility (Noise) : 42 pts
Information Quality (Lies)  : 87 pts
Style / Taste (Soul)        : 5535 pts
TOTAL KARPE-SLOP SCORE      : 5664 pts

SUEEEY! Here piggy piggy... this codebase is 100% slop-fed.
```

## License

MIT — go forth and purge the slop.
