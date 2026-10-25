# KarpeSlop

[![npm version](https://img.shields.io/npm/v/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![npm downloads](https://img.shields.io/npm/dt/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A linter for the mistakes AI coding tools tend to leave in TypeScript and JavaScript.

```bash
npx karpeslop@latest
```

> KarpeSlop is a work in progress. Rules change between releases, and some findings will be wrong. If you hit one, please [open an issue](https://github.com/CodeDeficient/KarpeSlop/issues).

## Why

AI tools write code fast, and some of it looks finished when it isn't. Common examples:

- importing a function the library never had
- importing a package that isn't on npm
- a function body that is just a TODO and `return true`
- `// ... rest of the code` where real code should be
- `catch {}` that hides an error
- reading `res.json()` without checking `res.ok`
- `as any` and other casts that switch off type checking

ESLint and `tsc` catch some of this. KarpeSlop looks for the rest, so you can find it before it ships.

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

| Severity | Rules |
| --- | --- |
| critical | Imports of names a module doesn't export, files that don't exist, and packages that aren't on npm |
| high | Packages missing from `package.json`, placeholder bodies, elided-code comments, placeholder values like `"YOUR_API_KEY"`, empty `catch` blocks, `as any` and other unsafe casts |
| medium | Errors that are logged and dropped, other casts, `any`, `@ts-ignore`, blanket `eslint-disable`, unchecked `fetch` responses, dependency versions published in the last few days |
| low | `!` assertions, hedging and filler comments, TODOs without an issue link, `console.log` in app code |

`npx karpeslop@latest --help` lists every rule by name. Test, fixture and example folders are skipped by rules meant for app code.

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
      "severity": "medium"
    }
  ]
}
```

- `severityOverrides` changes a rule's severity, or turns it off with `"off"`.
- `ignorePaths` skips files that match these globs.
- `minPackageAgeDays` sets how new a dependency version has to be before it gets flagged.
- `blockOnCritical` acts like `--strict` on every run.
- `customPatterns` adds your own regex rules, matched one line at a time.

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
