# KarpeSlop

[![npm version](https://img.shields.io/npm/v/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![npm downloads](https://img.shields.io/npm/dt/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A slop index for TypeScript and JavaScript. KarpeSlop finds the mistakes AI coding tools tend to leave and scores them on three axes: **noise**, **lies** and **soul**.

```bash
npx karpeslop@latest
```

> KarpeSlop is a work in progress. Rules change between releases, and some findings will be wrong. If you hit one, please [open an issue](https://github.com/CodeDeficient/KarpeSlop/issues).

## Why

AI tools write code fast, and some of it looks finished when it isn't. The idea for KarpeSlop comes from Andrej Karpathy's call for a "slop index": a number that says how much of a codebase is slop, and what kind. KarpeSlop sorts slop into three kinds:

- **Noise** (information utility): text that adds length without information. Comments that repeat the next line, doc comments that restate parameter names, leftover `console.log`.
- **Lies** (information quality): code that claims to do something it doesn't. A function the library never exported, a package that isn't on npm, a body that is just `return true`, `// ... rest of the code` where real code should be, a `catch {}` that hides the error, `as any` telling the compiler something nobody checked.
- **Soul** (style and taste): shortcuts that show no judgment behind the code. `any`, casts and `!` used to get past the type checker, blanket `eslint-disable`, TODOs nobody is tracking.

ESLint and `tsc` catch some of this. KarpeSlop looks for the rest and tells you which kind it is, so you can find it before it ships.

## The slop index

Every run ends with a score for each axis. This is a 210,000-line Next.js app:

```
Slop index (application code, higher is worse):
  Noise  information utility     0.6  restating_comment, production_console_log, filler_comment
  Lies   information quality     7.8  unsafe_object_assertion, unsafe_double_type_assertion, unsafe_array_assertion
  Soul   style and taste         3.5  type_assertion, non_null_assertion, any_type_usage
  Total                         11.9
```

KarpeSlop's own source has no findings and scores 0.

Each rule adds `weight × ln(1 + findings per 1,000 lines)` to its axis, with weights of 8, 4, 2 and 1 for critical, high, medium and low. The scores use findings in application code only, not tests, and:

- are per 1,000 lines, so a large repository and a small one can be compared
- grow with the logarithm of each rule's count, so one pattern repeated 500 times can't outweigh five different kinds of slop

The rules that add the most to each axis are listed next to its score. The JSON report has the full breakdown under `slopIndex`.

## Usage

Run it from your project root, after `npm install` so it can check imports against the packages you actually have.

```bash
npx karpeslop@latest                   # scan the current directory
npx karpeslop@latest src/ lib/api.ts   # scan specific files or folders
npx karpeslop@latest --help            # list every option and rule
```

| Option | What it does |
| --- | --- |
| `--quiet`, `-q` | Only scan `app/`, `components/`, `lib/`, `hooks/`, `services/` and `src/`, and skip tests |
| `--strict`, `-s` | Exit with code 2 when there are critical findings |
| `--fail-on=<severity>` | Lowest severity that fails the run: `critical`, `high` (default), `medium` or `low` |
| `--report=<path>` | Write the JSON report somewhere other than `./ai-slop-report.json` |
| `--no-report` | Don't write the JSON report |
| `--version`, `-v` | Print the version |
| `--` | Treat everything after it as a path, even if it starts with `-` |

Set `KARPESLOP_OFFLINE=1` to skip the npm registry lookups.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No findings at the `--fail-on` severity or above |
| `1` | Findings at the `--fail-on` severity or above |
| `2` | Critical findings, with `--strict` |

### Monorepos

Run it once from the repo root. Every `package.json` in the tree counts when checking imports, and `--quiet` picks up folders like `packages/ui/src/` at any depth.

### CI

Add a step to your workflow:

```yaml
- name: KarpeSlop
  run: npx karpeslop@latest --quiet --strict
```

[`examples/github-workflow.yml`](examples/github-workflow.yml) is a full GitHub Actions workflow that also uploads the report and comments on the pull request. [`examples/pre-commit`](examples/pre-commit) is a git hook that blocks commits with critical findings.

## What it checks

| Axis | Rules |
| --- | --- |
| Lies | Imports of names a module doesn't export, files that don't exist, and packages that aren't on npm (critical). Packages missing from `package.json`, placeholder bodies, elided-code comments, placeholder values like `"YOUR_API_KEY"`, empty `catch` blocks, `as any` and other unsafe casts (high). Errors that are logged and dropped, `@ts-ignore`, unchecked `fetch` responses (medium) |
| Soul | Other casts, `any`, blanket `eslint-disable`, dependency versions published in the last few days (medium). `!` assertions, TODOs without an issue link (low) |
| Noise | Hedging, filler and restating comments, `console.log` in app code (low) |

`npx karpeslop@latest --help` lists every rule with its severity and axis. Test, fixture and example folders are skipped by rules meant for app code.

## Configuration

Add a `.karpesloprc.json` to your project root:

```json
{
  "severityOverrides": {
    "type_assertion": "low",
    "production_console_log": "off"
  },
  "ignorePaths": ["**/legacy/**"],
  "minPackageAgeDays": 7,
  "blockOnCritical": true,
  "customPatterns": [
    {
      "id": "banned_import",
      "pattern": "from\\s+['\"]lodash['\"]",
      "message": "Use lodash-es",
      "severity": "medium",
      "axis": "soul"
    }
  ]
}
```

- `severityOverrides` changes a rule's severity, or turns it off with `"off"`.
- `ignorePaths` skips files that match these globs.
- `minPackageAgeDays` sets how new a dependency version has to be before it gets flagged.
- `blockOnCritical` acts like `--strict` on every run.
- `customPatterns` adds your own regex rules, matched one line at a time. `axis` is `noise`, `lies` or `soul` (the default, since a custom pattern usually records your team's taste).

There are no inline comments to silence a finding. Changes go in this file so they show up in code review.

## Contributing

```bash
npm ci
npm run typecheck
npm test
```

Run `./scripts/setup-git-hooks.sh` once after cloning to add a pre-push hook that stops pushes straight to `main`.

## License

[MIT](LICENSE)
