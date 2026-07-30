# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Test suite (`bun test`) covering plan parsing, validation, and utilities.
- GitHub Actions CI (type-check, lint, format, test, build) and a tag-triggered
  npm publish workflow.
- ESLint (flat config), Prettier, and EditorConfig for consistent style.
- `CONTRIBUTING.md`, `SECURITY.md`, and `docs/ARCHITECTURE.md`.
- `examples/demo/` — a ready-to-run four-section plan.

### Fixed

- `tsc --noEmit` now passes: re-expose the global `JSX` namespace for the
  React 19 + OpenTUI `jsxImportSource` setup.

### Changed

- Standardized on Bun as the required runtime and toolchain (OpenTUI depends on
  Bun-only asset loading); publish tarball trimmed via the `files` field.

## [0.1.0]

### Added

- Initial release: parallel agent orchestration CLI with a React/OpenTUI terminal UI.
- Codex, Claude Code, and OpenCode backends.
- Plan format (`.parallely/plan/*.md`), validation with overlap detection, and shared
  git-worktree execution with auto-commit to an integration branch.

[Unreleased]: https://github.com/MichaelTheMay/parallely/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MichaelTheMay/parallely/releases/tag/v0.1.0
