# KarpeSlop

[![npm version](https://img.shields.io/npm/v/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![npm downloads](https://img.shields.io/npm/dt/karpeslop.svg)](https://www.npmjs.com/package/karpeslop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

KarpeSlop finds the mistakes that slip into TypeScript and JavaScript when generated code isn't carefully reviewed: imports of things that don't exist, packages that don't exist, placeholder bodies, code elided with `// ... rest of code`, swallowed errors, unchecked `fetch` responses, and type-system escape hatches (`any`, casts, `!`, `@ts-ignore`).

It can't tell who wrote a line, and it doesn't try. Every rule is a check on the code itself, and every finding says what was found and why it matters. A fix is only suggested when it is certain.

```bash
npx karpeslop@latest
```

## How it works

- **Syntax rules run on the TypeScript AST**, not on lines of text. Strings, comments, JSX text and code split across lines are all seen the way the compiler sees them.
- **Import checks use real module resolution.** KarpeSlop builds a TypeScript program with your `tsconfig.json`/`jsconfig.json` and checks each named import against the module's actual exports. Bare package imports are checked against every `package.json` up the tree and `node_modules`; names that are neither declared nor installed are looked up on the npm registry.
- **Run it after `npm install`** for the full import check. Without installed types it falls back to a list of well-known mix-ups (e.g. `useRouter` from `react`).

## Rules

| Rule | Severity | What it finds |
| --- | --- | --- |
| `hallucinated_import` | critical | A named import the module doesn't export (`import { useRouter } from 'react'`), including multi-line and aliased imports |
| `nonexistent_package` | critical | An imported package that isn't on the npm registry |
| `undeclared_dependency` | high | An imported package that isn't in any `package.json` and isn't installed |
| `placeholder_implementation` | high | A body that is only a placeholder comment plus a dummy return, or `throw new Error("Not implemented")` |
| `elided_code_comment` | high | `// ... rest of the code`, `// ...existing code...` and similar |
| `placeholder_value` | high | `"YOUR_API_KEY"`, `"<your-token>"`, `"sk-xxxxxx"` and similar |
| `empty_catch` | high | `catch {}` or `.catch(() => {})` with no comment explaining why |
| `unsafe_type_assertion` | high | `as any` |
| `unsafe_double_type_assertion` | high | `as unknown as T` and other chained casts |
| `unsafe_object_assertion` / `unsafe_array_assertion` | high | Casts to `Record<...>`, `{ ... }`, `T[]` |
| `type_assertion` | medium | Any other cast (`as T`, `<T>x`). `as const` and `as unknown` are not casts |
| `any_type_usage` | medium | Declared `any`, once per line. Not reported in generic constraints, conditional `extends`, or fully erased generics like `Query<any, any, any>` |
| `ts_suppression` | medium | `@ts-ignore`, `@ts-nocheck` |
| `blanket_eslint_disable` | medium | `eslint-disable` without a rule name |
| `unchecked_fetch_response` | medium | `res.json()` with no `res.ok`/`res.status` check (`fetch` only rejects on network errors) |
| `non_null_assertion` | low | `value!` |
| `hedging_comment` | low | "should work", "hopefully", "not sure if" |
| `restating_comment` | low | `// Set loading to true` above `setLoading(true)` |
| `filler_comment` | low | `@param id - the id`, `@returns the result`, "This function is used to..." |
| `todo_comment` | low | TODO / FIXME / HACK |
| `production_console_log` | low | `console.log/debug/info` outside tests and CLI scripts |
| `fresh_package_version` | medium | A dependency version published within `minPackageAgeDays` (default 7). New releases are where typosquats and compromised versions usually land |

Rules marked for application code skip test files (`__tests__/`, `*.test.*`, `*.spec.*`, `test/`, `tests/`, fixtures).

## Usage

```bash
npx karpeslop@latest                  # scan the current directory
npx karpeslop@latest src/ lib/api.ts  # scan specific paths
npx karpeslop@latest --quiet          # only app/, components/, lib/, hooks/, services/, src/; skip tests
npx karpeslop@latest --strict         # exit 2 on critical findings
npx karpeslop@latest -- -dash-file.ts # paths that start with "-"
npx karpeslop@latest --help           # list every rule
```

A JSON report is written to `./ai-slop-report.json`.

### Exit codes

- `0`: nothing at medium severity or above. Low-severity findings and package-age warnings never fail a run.
- `1`: findings at medium severity or above.
- `2`: critical findings, with `--strict`.

Set `KARPESLOP_OFFLINE=1` to skip every npm registry request (package age and package existence checks).

## Configuration

Create `.karpesloprc.json` in your project root:

```json
{
  "severityOverrides": {
    "type_assertion": "low",
    "production_console_log": "off"
  },
  "customPatterns": [
    {
      "id": "banned_import",
      "pattern": "from\\s+['\"]lodash['\"]",
      "message": "Use lodash-es for tree-shaking",
      "severity": "medium",
      "fix": "Replace 'lodash' with 'lodash-es'"
    }
  ],
  "minPackageAgeDays": 7,
  "ignorePaths": ["**/legacy/**"],
  "blockOnCritical": true
}
```

There are no inline suppression comments. A comment that silences the linter is easy for anyone, or any tool, to add next to the problem it hides. Changing a rule's severity, or turning it off, goes through `severityOverrides`, where it shows up in review.

`customPatterns` are plain regexes matched line by line.

## Limitations

- Syntax rules don't use type information. `type_assertion` reports every cast, including ones a careful author made on purpose; tune it with `severityOverrides`.
- The named-import check only covers modules with TypeScript declarations. Exports inferred from plain JavaScript are skipped rather than guessed.
- An import that matches a `paths` alias, a folder under `baseUrl` or `src`, or a name quoted in a bundler config is treated as an internal alias. It is never sent to the npm registry, so a missing package with the same name as one of these goes unreported.
- Comment rules are heuristics. They are low severity for that reason and never fail a run.
- KarpeSlop complements ESLint and `tsc`; it doesn't replace them. Run all three.

## CI/CD

```yaml
- name: KarpeSlop
  run: npx karpeslop@latest --quiet --strict
```

## Contributing

### Local git hooks

Install the repository's shared hooks once after cloning:

```bash
./scripts/setup-git-hooks.sh
```

The pre-push hook blocks pushes targeting `main`/`master`. Use a feature branch and open a pull request instead. Existing hooks are never overwritten; setup stops if an unrelated pre-push hook already exists. To keep that hook, move it to `pre-push.local` in the same hooks directory and rerun setup: the KarpeSlop hook checks the refs first, then runs `pre-push.local` with the same arguments and ref records. Do not call the KarpeSlop hook from your own hook instead, because a hook that reads stdin first leaves the check with no refs and the push goes through. The local hook is a convenience that `--no-verify` skips; branch protection on the server is what actually keeps `main` safe. To update a previously installed KarpeSlop copy, find the active hooks directory with `git rev-parse --git-path hooks` and verify the installed path is a regular file, contains the `Managed by KarpeSlop setup-git-hooks.sh.` marker, and matches `.githooks/pre-push` with `cmp -s "$(git rev-parse --git-path hooks)/pre-push" .githooks/pre-push`; only then move that managed file to the trash and rerun the setup script. Hooks installed before the marker was introduced cannot be identified automatically; preserve those files unless you independently confirm they are the old KarpeSlop hook. Only after that confirmation should you replace or chain it; otherwise leave unrelated hooks untouched.

## License

MIT

## 💝 Support Development

Building and maintaining KarpeSlop takes time. If this tool saved you from shipping slop:

[![GitHub Sponsors](https://img.shields.io/github/sponsors/CodeDeficient?style=social)](https://github.com/sponsors/CodeDeficient)

[☕ Buy me a coffee](https://github.com/sponsors/CodeDeficient) • Help keep the slop detector alive
