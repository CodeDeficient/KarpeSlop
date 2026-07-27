# Changelog

All notable changes will be documented in this file.

## [1.0.29] - 2026-07-27

### Changed
- **`unsafe_type_assertion` migrated from regex to AST detection**: `as any` assertions are now detected by the TypeScript Compiler API instead of a line-based regex. Comments and strings containing `as any` are no longer reported. Nested and multiline assertions are handled syntactically. The pattern ID and configuration key remain unchanged — existing `severityOverrides` continue to work.
- **`unsafe_double_type_assertion` broadened**: Now detects any chained assertion (`as X as Y`), not only `as unknown as Y`. The `assertionForm` metadata field changed from `as_unknown_as` to `chained_as`. The message no longer references `as unknown as`.
- **First-line inline suppressions fixed**: `// eslint-disable-line` and `@ts-ignore` on line 1 now suppress findings correctly.
- **Test-file exclusion restored**: `unsafe_type_assertion` is once again skipped in `isTestFile` paths (`.test.*`, `.spec.*`, `__tests__/`, etc.) during normal scans, matching the pre-migration behavior.

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
