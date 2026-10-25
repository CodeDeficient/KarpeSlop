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
| `hallucinated_import` | critical | A named import the module doesn't export (`import { useRouter } from 'react'`), including multi-line and aliased imports, a default import from an ES module with no default export, a subpath an installed package does not have (`lodash-es/debounceAsync`), and a relative or tsconfig-alias import of a file that does not exist (`../lib/validation`, `@/lib/formatting`). Paths into build output or generated code (`dist/`, `generated/`, dot-folders, SvelteKit `$types`) are not checked |
| `nonexistent_package` | critical | An imported package that isn't on the npm registry |
| `undeclared_dependency` | high | An imported package that isn't in any `package.json` and isn't installed. Not reported in `examples/`, whose readers install what each example needs |
| `placeholder_implementation` | high | A body that returns a constant (or nothing) under a TODO or placeholder comment; a short body under a comment that says the real code is elsewhere ("Simulate API call", "In a real app you would..."); a body that only logs and returns success; or `throw new Error("Not implemented")` |
| `elided_code_comment` | high | `// ... rest of the code`, `// ...existing code...`, `{/* ... other fields */}`, `// Add more cases as needed` and similar, in line, block and JSX comments |
| `placeholder_value` | high | `"YOUR_API_KEY"`, `"<your-token>"`, `"Bearer <API_KEY>"`, `"sk-xxxxxx"`, `"sk_test_your_key_here"`, `"postgres://postgres:password@..."`, `"https://your-project.supabase.co"`, `"xxxx"` stored as a key or token, an `example.com` URL stored in config, and a hard-coded fallback for a secret (`process.env.JWT_SECRET \|\| "secret"`) |
| `empty_catch` | high | `catch {}` or `.catch(() => {})` with no comment explaining why, no `_`-named binding and no `void` in front. Not reported when the `try` returns and code after it is the fallback (`try { return parse(x) } catch {}` then a default), or when the `try` only assigns variables declared before it that are read after it (`let found = fallback; try { found = probe() } catch {}`) |
| `swallowed_error` | medium | A `catch` block that only logs (`console.error('Failed', err)`) and lets execution continue as if nothing failed, or logs and then returns `[]`, `{}` or `''`, which the caller cannot tell apart from an empty success |
| `unsafe_type_assertion` | high | `as any` |
| `unsafe_double_type_assertion` | high | `as unknown as T` and other chained casts |
| `unsafe_object_assertion` / `unsafe_array_assertion` | high | Casts to `Record<...>`, `{ ... }`, `T[]`. A cast of `[]`, `{}` or `Object.keys(...)` (and `Object.getOwnPropertyNames`) only narrows a known shape and is reported as `type_assertion` |
| `type_assertion` | medium | Any other cast (`as T`, `<T>x`). `as const` and `as unknown` are not casts |
| `any_type_usage` | medium | Declared `any`, once per line. Not reported in generic constraints, conditional `extends`, fully erased generics like `Query<any, any, any>`, or the "any function" type `(...args: any[]) => any`, which `unknown` cannot express |
| `ts_suppression` | medium | `@ts-ignore`, `@ts-nocheck` |
| `blanket_eslint_disable` | medium | `eslint-disable` without a rule name |
| `unchecked_fetch_response` | medium | `res.json()` with no `res.ok`/`res.status` check (`fetch` only rejects on network errors) |
| `non_null_assertion` | low | `value!` |
| `hedging_comment` | low | "should work", "hopefully", "not sure if" |
| `restating_comment` | low | `// Set loading to true` above `setLoading(true)` |
| `filler_comment` | low | `@param id - the id`, `@returns the result`, "This function is used to..." |
| `todo_comment` | low | TODO / FIXME / HACK that does not link a tracking issue (a URL, `#123` or `PROJ-123`) |
| `production_console_log` | low | `console.log/debug/info` outside tests and CLI scripts |
| `fresh_package_version` | medium | A dependency version published within `minPackageAgeDays` (default 7). New releases are where typosquats and compromised versions usually land |

The cast rules (`unsafe_*_assertion`, `type_assertion`), `any_type_usage` and `non_null_assertion` only run on TypeScript files. They are skipped for `.js`, `.jsx`, `.mjs` and `.cjs`, which have no `as` casts, type annotations or `!`. JSDoc types such as `/** @type {any} */` are not checked.

Rules marked for application code skip test, benchmark and example code (`__tests__/`, `*.test.*`, `*.spec.*`, `test/`, `tests/`, fixtures, `bench/`, `benchmarks/`, `examples/`, `runtime-tests/`, `perf-measures/`). Imports in `__fixtures__/` and `__testfixtures__/` are not checked, because those folders hold sample input rather than code that runs.

## Usage

```bash
npx karpeslop@latest                  # scan the current directory
npx karpeslop@latest src/ lib/api.ts  # scan specific paths
npx karpeslop@latest --quiet          # only app/, components/, lib/, hooks/, services/, src/ (at any depth); skip tests
npx karpeslop@latest --strict         # exit 2 on critical findings
npx karpeslop@latest --fail-on=medium # also fail on medium findings (casts, any, unchecked fetch)
npx karpeslop@latest -- -dash-file.ts # paths that start with "-"
npx karpeslop@latest --help           # list every rule
```

A JSON report is written to `./ai-slop-report.json`. `--report=<path>` writes it elsewhere, and `--no-report` skips it.

### Exit codes

- `0`: nothing at high severity or above. Package-age warnings never fail a run.
- `1`: findings at high severity or above. `--fail-on=medium` (or `low`, `critical`) moves the threshold. Medium findings such as a single cast or an `any` are worth a look in review, but most healthy codebases have some, so they do not fail a run by default.
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

An unknown option on the command line stops the run with exit 1, and a `severityOverrides` key that is not a rule id prints a warning, so a typo never silently changes what is checked.

There are no inline suppression comments. A comment that silences the linter is easy for anyone, or any tool, to add next to the problem it hides. Changing a rule's severity, or turning it off, goes through `severityOverrides`, where it shows up in review.

`customPatterns` are plain regexes matched line by line. Each needs an `id` of its own: a built-in rule id or one used by another pattern is rejected.

## Limitations

- Syntax rules don't use type information. `type_assertion` reports every cast, including ones a careful author made on purpose; tune it with `severityOverrides`.
- The named-import check only covers modules with TypeScript declarations. Exports inferred from plain JavaScript are skipped rather than guessed.
- An import that matches a `paths` alias, a Deno import map entry (`deno.json` `imports`), a folder under `baseUrl` or `src`, or a name quoted in a bundler config is treated as an internal alias. It is never sent to the npm registry, so a missing package with the same name as one of these goes unreported.
- Comment rules are heuristics. They are low severity for that reason and never fail a run.
- KarpeSlop complements ESLint and `tsc`; it doesn't replace them. Run all three.

## CI/CD

```yaml
- name: KarpeSlop
  run: npx karpeslop@latest --quiet --strict
```

[`examples/github-workflow.yml`](examples/github-workflow.yml) is a complete workflow that also uploads the JSON report and comments on the pull request when the check fails. [`examples/pre-commit`](examples/pre-commit) is a git hook that blocks a commit on critical findings.

## Contributing

```bash
npm ci
npm run typecheck
npm test
```

### Local git hooks

Run `./scripts/setup-git-hooks.sh` once after cloning. It installs a pre-push hook that refuses pushes to `main` or `master`; open a pull request from a feature branch instead. `--no-verify` skips the hook, so branch protection on the server is what actually keeps `main` safe.

The script never overwrites a hook it did not install, and stops if an unrelated `pre-push` hook exists. To keep yours, rename it to `pre-push.local` in the same hooks folder and run the script again: the KarpeSlop hook checks the refs first, then runs `pre-push.local` with the same arguments and input. Don't call the KarpeSlop hook from your own hook instead: a hook that reads stdin first leaves it no refs to check, and the push goes through.

To update an installed copy, first check that it is an unmodified KarpeSlop hook: a regular file that contains `Managed by KarpeSlop setup-git-hooks.sh.` and matches a committed version of `.githooks/pre-push`. This prints the matching commit:

```bash
hook="$(git rev-parse --git-path hooks)/pre-push"
if [ -f "$hook" ] && [ ! -L "$hook" ] && grep -qF 'Managed by KarpeSlop setup-git-hooks.sh.' "$hook"; then
  for c in $(git rev-list HEAD -- .githooks/pre-push); do
    git show "$c:.githooks/pre-push" | cmp -s - "$hook" && echo "matches $c"
  done
fi
```

If it matches, move it to the trash and run the script again. Hooks installed before the marker existed can't be told apart from your own; leave them unless you are sure they are KarpeSlop's.

## License

MIT

## Support

If KarpeSlop is useful to you, you can sponsor its development on [GitHub Sponsors](https://github.com/sponsors/CodeDeficient).
