# Changelog

All notable changes will be documented in this file.

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
