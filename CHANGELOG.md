# Changelog

All notable changes will be documented in this file.

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
