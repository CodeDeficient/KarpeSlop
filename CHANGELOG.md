# Changelog

All notable changes will be documented in this file.

## [Unreleased]

### Added
- `swallowed_error` (medium): a `catch` block whose only statements are `console` calls. The error is logged and the code carries on as if the operation succeeded. A comment in the block explaining why that is safe, a rethrow, or any other statement (such as `setError(e)`) means it is not reported, and so does a fallback after the `try`, as for `empty_catch`.

### Changed
- A bundler config marks an import as an alias only when it quotes the whole name (`'@components'`, `'@components/...'`). A longer name that starts the same way (`'vite-plugin-pwa'` for `vite-plugin`) used to hide an undeclared or nonexistent package.
- Names in a Deno import map (`imports` in `deno.json`/`deno.jsonc`, or the file its `importMap` names) are aliases, not npm packages. hono's Deno tests import `@std/assert` from JSR and got four critical `nonexistent_package` findings, so `--strict` failed a clean repository.
- `hallucinated_import` reports a relative or tsconfig `paths` import with no file behind it (`import { validate } from '../lib/validation'`). A file with any extension counts (`./Widget.vue`, `./styles.css?raw`). Paths into build output or generated code (`dist/`, `build/`, `out/`, `generated/`, dot-folders, SvelteKit `$types`) are skipped, since they are often absent from a checkout.
- Benchmark and example folders (`bench/`, `benchmarks/`, `examples/`, `runtime-tests/`, `perf-measures/`) count as non-production code, like tests: rules for application code skip them and they are left out of finding density. zod's `packages/bench` produced 375 `production_console_log` findings and express's `examples/` 36.
- `any_type_usage` skips the rest parameter and bare `any` return of a function type such as `type AnyFn = (...args: any[]) => any`. Parameters are contravariant, so `(...args: unknown[]) => unknown` does not accept `(x: string) => void` and there is no safer spelling.
- `placeholder_implementation` recognizes "In a production environment, you would ...", "In production you'd ..." and "In a production app, this would ..." over a short body.
- `placeholder_value` recognizes setup-guide keys (`sk_test_your_stripe_secret_key_here`, `whsec_your_webhook_secret_here`), template credentials for any user name (`postgres:password@`) and hosts that start with `your-` (`https://your-project.supabase.co`). A run of `x` (`'XXXX'`) is reported only when it is stored as a key, token, secret or password: date-fns uses `'XXXX'` and `'xxxxx'` as timezone format tokens and got 12 high-severity findings.
- `empty_catch` and `swallowed_error` skip a `try` that only assigns variables declared before it and read after it (`let recursive = true; try { recursive = check(s) } catch {}`): the earlier value is the fallback. zod and hono use this pattern for feature probes.
- `swallowed_error` also reports a catch that logs and then returns `[]`, `{}` or `''`. The caller gets what looks like an empty success. `return null` is still not reported, because a caller can check for it.
- `empty_catch` skips `catch (_)` and `catch (_error)`. An underscore name is the usual way to mark a binding as unused on purpose, the same signal as a comment.
- The scan starts with "Scanning..." instead of "Scanning for AI slop patterns...": the findings describe code, not who wrote it. The report file is still `ai-slop-report.json`, so existing CI keeps working.
- The example GitHub workflow moved to `examples/github-workflow.yml`, and its PR-comment job asks for `pull-requests: write`, without which the comment could not be posted. This repository's own KarpeSlop check now scans its source with the checked-out code instead of the published package, which scanned no files here.
- An invalid `.karpesloprc.json` stops the run with exit 1 and says what is wrong. It used to print a warning and scan with defaults, which silently dropped the project's severity overrides and ignore paths (KarpeSlop's own `swallowed_error` rule found this).
- `hallucinated_import` reports a subpath an installed package does not have (`lodash-es/debounceAsync`): no file or folder by that name and no matching `exports` key, `*` patterns included.
- `hallucinated_import` checks names re-exported with `export { a, b } from 'mod'`, not only imports.
- `hallucinated_import` checks default imports. `import dateFns from 'date-fns'` is reported when the module is an ES module with no default export, following the same rule as TypeScript: CommonJS modules (`export =`, or a declaration file not in ES module format) get a synthesized default and are not reported.
- Finding density is per 1,000 lines of application code: test files, whose findings most rules skip, are left out of both sides. The JSON report adds `applicationLinesScanned`.
- Each real file is scanned once. Symlinked copies (TanStack Query links the root lint config into every package) were scanned and reported once per link.
- `__fixtures__` and `__testfixtures__` folders count as test code, and their imports are not checked: they hold sample input such as codemod before/after files. TanStack Query's codemod fixtures produced 54 `undeclared_dependency` findings.
- `hedging_comment` also recognizes "might not work", "seems to work" and "should handle most/all ...", and skips a hedge that links the issue it is about.
- `todo_comment` skips markers that link a tracking issue (a URL, `#123`, `PROJ-123`, "issue 42"), which is what its own advice asks for.
- `filler_comment` reports a stock opener ("This function is used to ...", "This component is responsible for ...") only when the rest of the summary repeats the declaration that follows. A doc comment that opens that way and then explains something is no longer reported.
- `restating_comment` skips one-word comments such as `// Imports` or `// ZodEmail`, which label a section rather than restate a line, and commented-out code. They were most of its findings on zod and TanStack Query.
- `placeholder_value` recognizes `<API_KEY>`, `Bearer <API_KEY>`, `INSERT_API_KEY_HERE`, template credentials in URLs (`user:password@`), `yourdomain.com`, `XXX` path segments in URLs, and `example.com` URLs stored in a variable or property (not ones passed to a call, such as a base for `new URL`). It also reports a non-empty hard-coded fallback for a secret environment variable (`process.env.SESSION_PASSWORD ?? 'supersecret'`).
- `unchecked_fetch_response`: passing the response to a `console` call no longer counts as checking its status.
- `placeholder_implementation` judges the body, not only the wording. Any TODO/FIXME or "for now" in a body that returns a constant counts, constants include literal arrays and objects (`return [{ id: 1 }]`), a fake delay (`await new Promise(r => setTimeout(r, 500))`) counts as trivial, a comment that says the real code is elsewhere ("Simulate API call", "In a real application you would", "Mock data", "replace with a proper ... in production") counts on any body of up to three statements, and a body that only logs and then returns success is reported. A thrown message counts only when it is just "not implemented", not when it explains why.
- `elided_code_comment` checks block and JSX comments (`{/* ... other fields */}`), not only `//` comments, and recognizes more wordings ("Add more cases as needed", "[existing code here]", "Handle other actions similarly", "omitted for brevity"). A wording counts only when it is the whole comment, so prose that mentions "the other fields" is not reported.
- `empty_catch` skips a catch that falls through to a fallback: the `try` block returns (on any path, such as a fast path inside an `if`), and code after the `try` (or the next loop iteration) handles the failure. zod and ky use this pattern; it was reported at high severity.
- SECURITY.md lists the npm registry requests a scan makes and how to turn them off, and gives a real contact for vulnerability reports. It used to say the tool made no network requests.
- `--quiet` matches core folders at any depth, so `packages/ui/src/` in a monorepo is scanned. Before, only folders at the repository root counted and a monorepo scanned no files.
- `unsafe_type_assertion` reports the start of the cast (`value` in `value as any`), like the other cast rules, instead of the `any` keyword. A multi-line cast now reports the line it starts on.

## [2.0.0] - 2026-10-25

Rebuild of the built-in rules. Measured on two corpora: three mature TypeScript codebases (zustand `src`, TanStack Query `query-core/src` and `react-query/src`) and a file with eight planted mistakes typical of generated code. Before: 300 findings on the clean code, mostly false positives, and 1 of 8 planted mistakes caught. After: every finding on the clean code is a real cast, `any`, `!`, TODO or restating comment, and 8 of 8 planted mistakes are caught.

### Upgrading from 1.x
- Remove `severityOverrides` entries for the removed rule ids listed below. They are ignored now. The replacement ids are listed next to each removed rule.
- CI that fails on any finding should expect exit 1 only for medium severity and above. `--strict` still exits 2 on critical findings.
- Anything that read the slop score from the output should read the per-severity counts instead.

### Breaking
- **Rules rebuilt on the TypeScript AST.** Built-in rules no longer match lines of text, so strings, JSX text and multi-line code are handled correctly. User `customPatterns` are still line regexes.
- **Removed rules** (they were unreliable or wrong): `redundant_self_explanatory_comment`, `excessive_boilerplate_comment`, `debug_log_with_comment`, `hallucinated_react_import` and `hallucinated_next_import` (replaced by `hallucinated_import`), `todo_implementation_placeholder` (replaced by `placeholder_implementation`), `assumption_comment`, `overconfident_comment`, `hedging_uncertainty_comment` (replaced by the narrower `hedging_comment`), `unnecessary_iife_wrapper`, `vibe_coded_ternary_abuse`, `magic_css_value`, `useEffect_derived_state`, `useEffect_empty_deps_suspicious`, `setState_in_loop`, `useCallback_no_deps`, `array_any_type`, `generic_any_type`, `function_param_any_type`, `index_signature_any` (all folded into `any_type_usage`), `missing_error_handling` (replaced by `unchecked_fetch_response`), `unsafe_member_access`, `complex_nested_conditionals`. Overrides for removed ids are ignored.
- **Exit codes:** exit 1 now means a finding at medium severity or above. Low-severity findings are informational.
- **Score removed.** The "Karpathy Slop Index" point total grew with repo size and wasn't comparable between projects. The summary now reports findings by severity and per 1,000 lines.
- **`--quiet`** now includes `src/` and always skips test files.
- **Folders named `types` are scanned.** Only `.d.ts` files are skipped as declarations. Generated `.ts` type files (Supabase, GraphQL codegen) under `types/` now get findings; add their path to `ignorePaths` to skip them.

### Added
- `hallucinated_import`: named imports checked against the module's real exports via the TypeScript checker, including multi-line and aliased imports. Falls back to a list of well-known mix-ups when types aren't installed, and suggests where the symbol really lives.
- `nonexistent_package` and `undeclared_dependency`: bare imports checked against every `package.json` up the tree, `node_modules`, and the npm registry.
- `placeholder_implementation`, `elided_code_comment`, `placeholder_value`, `empty_catch`, `unchecked_fetch_response`, `type_assertion`, `non_null_assertion`, `ts_suppression`, `blanket_eslint_disable`, `restating_comment`, `filler_comment`.
- `<T>x` casts are detected alongside `x as T`.
- `KARPESLOP_OFFLINE=1` skips npm registry requests.
- `npm run typecheck`: the tool's own source is checked with `strict` and contains no casts, non-null assertions or `any`.

### Changed
- Messages describe the code, not its author. Fix text is only shown when the fix is certain; otherwise the finding says what to check and links the relevant docs.
- Removed the Karpathy attribution, quote and trademark symbol from the README, package description and CLI output.
- Removed the unused `npm run build` script, `babel.config.json` and the `@babel/*` devDependencies. The CLI runs `ai-slop-detector.ts` through tsx, so nothing used the `karpeslop-bin.js` it produced.

### Fixed
- One failed package age check no longer discards the results of all the others. The failure is printed with the package name and version.

## [1.0.30] - 2026-07-27

### Breaking
- **Code-level suppression removed**: KarpeSlop no longer suppresses findings due to source-code comments. `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line`, `@ts-ignore`, and `@ts-expect-error` comments no longer hide any findings. The only supported suppression mechanism is reviewed configuration via `severityOverrides` in `.karpesloprc.json`. This applies to AST-detected assertions (`findUnsafeAssertions`) and regex-detected pattern matches (`analyzeFile`).

### Removed
- `lineIsSuppressed()` function and its four call sites in the AST assertion visitor.
- The generic regex-pattern suppression check that skipped findings on lines with `eslint-disable`, `@ts-expect-error`, or `@ts-ignore` comments.

## [1.0.29] - 2026-07-27

### Changed
- **`unsafe_type_assertion` migrated from regex to AST detection**: `as any` assertions are now detected by the TypeScript Compiler API instead of a line-based regex. Comments and strings containing `as any` are no longer reported. Nested and multiline assertions are handled syntactically. The pattern ID and configuration key remain unchanged — existing `severityOverrides` continue to work.
- **`unsafe_double_type_assertion` broadened**: Now detects any chained assertion (`as X as Y`), not only `as unknown as Y`. The `assertionForm` metadata field changed from `as_unknown_as` to `chained_as`. The message no longer references `as unknown as`.
- **First-line inline suppressions fixed**: `// eslint-disable-line` and `@ts-ignore` on line 1 now suppress findings correctly.
- **Test-file exclusion restored**: `unsafe_type_assertion` is once again skipped in `isTestFile` paths (`.test.*`, `.spec.*`, `__tests__/`, `__mocks__/`, `test-`) during normal scans. The exclusion is narrower than the pre-migration heuristic (`includes('test')`), so paths merely containing `test` or `spec` (e.g. `tests/utils/helper.ts`, `my-test-utils.ts`) may now be analyzed.
- **`unsafe_type_assertion` guidance no longer recommends chained assertions**: The `fix` field previously told users to `Use 'as unknown as TargetType'`, which conflicted with the broadened `unsafe_double_type_assertion` rule. The new guidance advocates a migration-first strategy with runtime validation.
- **Multiline suppression anchored to the `any` token line**: Suppression checks for multiline `as any` assertions now evaluate the line containing the `any` keyword, not the outer `as` expression line. Inline suppressions on the `any` line work correctly.

## [1.0.28] - 2026-07-27

### Added
- **AST-based unsafe assertion detector**: `findUnsafeAssertions()` uses the TypeScript Compiler API to detect three assertion forms that bypass structural type safety:
  - `unsafe_double_type_assertion` — `expr as unknown as T` (chained `unknown` cast). Previously suppressed as "safe"; now reports at `high` severity by default.
  - `unsafe_object_assertion` — `expr as Record<...>` or `expr as { ... }`.
  - `unsafe_array_assertion` — `expr as T[]` or `expr as Array<T>`.
- **Configurable severity**: All three new patterns respect the existing `severityOverrides` mechanism in `.karpesloprc.json`.
- **Exclusions**: No reporting for `as const`, `as typeof`, `as keyof`, `.d.ts` files, or lines guarded by `@ts-expect-error`/`eslint-disable-next-line`.
- **Regression fixtures**: `tests/fixtures/unsafe-assertions.ts` with the issue #22 reproduction snippet plus safe-cast boundary tests.

### Changed
- **BREAKING**: `as unknown as T` is no longer treated as a guaranteed-safe pattern. It now produces a `high`-severity finding (`unsafe_double_type_assertion`). Silence it project-wide via `severityOverrides: { "unsafe_double_type_assertion": "off" }` in `.karpesloprc.json`.
- **Removed** the regex-based `unsafe_double_type_assertion` pattern and its heuristic skip block (English-word false-positive filter). The AST visitor naturally excludes comments and non-assertion text, making the heuristic unnecessary.
- `tests/fixtures/false-positives.ts`: Removed the `as unknown as Type` "safe" assertion block (lines referencing `someValue as unknown as string` / `jsonValue as unknown as User[]`).

## [1.0.27] - 2026-06-16

### Changed
- **Pinned all dependencies** to exact versions (no more `^`/`~` ranges)
- **Updated all deps** to latest versions published >7 days ago: `glob` 11→13, `tsx` 4.19→4.22, Babel toolchain 7.28→7.29, `@types/node` 24→25, `typescript` 5→6
- **Fixed transitive vulnerabilities**: `minimatch` ReDoS, `brace-expansion` process hang, `esbuild` RCE — all via scoped overrides
- **Added `packageManager` field** to pin npm version for reproducible installs

## [1.0.26] - 2026-06-10

### Fixed
- **Null lockfile entries**: npm lockfile v3 allows `null` for linked workspace packages; these now skip gracefully instead of throwing a TypeError that silently aborts freshness analysis for the entire lockfile.
- **Glob metacharacters in file paths**: `isIgnoredByConfig` now escapes `[`, `*`, `?`, `{`, `}` in literal paths before passing them to `glob.sync`, so files like `src/[test].ts` are no longer misclassified as ignored.
- **Dead branch in generateReport**: Removed unreachable `this.issues.length === 0` check after the early return that already handles the zero-issues case.
- **Published CLI wrapper**: `karpeslop-cli.js` resolves `tsx` from the package dependency graph instead of assuming a package-local `.bin/tsx` path, so normal installs no longer print an `ENOENT` before startup.
- **Exit code docs**: Help text and `README.md` now document that `fresh_package_version` findings are informational and exit with code `0` when they are the only issues.
- **Package cleanup**: Removed `karpeslop-bin.js` (68KB babel artifact) and `karpeslop.js` (duplicate wrapper without signal handling) from the npm package and git tracking. The published package is now 24KB instead of 92KB.

## [1.0.25] - 2026-06-09

### Added
- **Positional path arguments**: `karpeslop [options] [path...]` accepts file or directory targets so scans can focus on a single file or subset. The `--strict` mode now reports which targeted file(s) had critical issues.
- **`--` separator**: Use `--` to mark the end of flags, so paths starting with `-` aren't misclassified as flags.
- **Manifest file discovery**: `findAllFiles()` now picks up `package.json`/`package-lock.json` at the project root, and `resolveTargetPaths()` accepts `.json` for the two manifest filenames — making the `fresh_package_version` rule reachable from both full and targeted scans.
- **`--quiet` includes manifests**: Even with `--quiet`, the two manifest files are still analyzed so package freshness warnings aren't lost.

### Fixed
- **package-lock.json bin entry**: Aligned to `karpeslop-cli.js` (matching `package.json`).
- **Config validation**: `minPackageAgeDays` now rejects non-finite/negative values at load time instead of silently producing NaN.

### Refactored
- Shared `getGlobIgnorePatterns()` and `isExcludedPath()` between `findAllFiles()` and `resolveTargetPaths()` so both paths use the same exclusion logic.
- `isExcludedPath` flattened with De Morgan's law; segment-based check for dotfiles and `types/`.

## [1.0.24] - 2026-04-04

### Fixed
- **Bin entry point**: `karpeslop-cli.js` is now correctly registered as the CLI binary, fixing `npx karpeslop` execution errors

### Fixed (from PR #9)
- **isInTryCatchBlock**: Complete rewrite with proper nested depth tracking and catch scope detection
- **overconfident_comment**: Removed incorrect skip logic that was causing false negatives on lines starting with `//`
- **missing_error_handling**: Added word boundary anchors and comment-line skipping
- **todo_comment**: Added word boundary so `BUG` doesn't match inside `DEBUG`
- **unsafe_double_type_assertion**: Added comment-line skip and English phrase detection
- **production_console_log**: Added conditional guard detection to reduce false positives
- **overconfident_comment regex**: Changed from `/\/\/\s*.../` to `/\/\/.*.../` to match "This is obviously wrong"
- **magic_css_value**: Removed leading word boundary from hex color pattern

### Added
- **fresh_package_version detection**: New rule to flag npm packages in `package.json` or `package-lock.json` that use `^`/`~` with versions published less than 7 days ago. Configurable via `minPackageAgeDays` in `.karpesloprc.json`.

## [1.0.21] - 2026-04-04

### Initial Release
- Initial npm release of KarpeSlop AI slop detector
