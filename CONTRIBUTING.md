# Contributing to Parallely

Thanks for your interest in improving Parallely! This guide covers local setup and the
conventions the project follows.

## Prerequisites

- [Bun](https://bun.sh) v1.0+ (runtime, bundler, and test runner)
- At least one agent CLI for end-to-end runs (`codex`, `claude`, or `opencode`)

## Getting started

```bash
git clone https://github.com/MichaelTheMay/parallely.git
cd parallely
bun install
```

## Development workflow

| Task            | Command                | Notes                                        |
| --------------- | ---------------------- | -------------------------------------------- |
| Run from source | `bun run dev -- --help`| Runs `src/index.tsx` directly, no build step |
| Type-check      | `bun run type-check`   | `tsc --noEmit`, strict mode                   |
| Lint            | `bun run lint`         | ESLint (flat config)                          |
| Format          | `bun run format`       | Prettier (writes changes)                     |
| Test            | `bun test`             | Unit tests for the plan/util core             |
| Coverage        | `bun run test:coverage`| Coverage focuses on the non-TUI core          |
| Build           | `bun run build`        | Bundles to `dist/` with tsup                  |

Before opening a PR, make sure the full check passes — this is exactly what CI runs:

```bash
bun run type-check && bun run lint && bun run format:check && bun test && bun run build
```

## Testing philosophy

Tests target the deterministic core — plan parsing, validation, and utilities in
`src/plan/` and `src/utils.ts`. The interactive TUI (`src/tui/`) is intentionally left
out of the coverage target; it is exercised manually. When you add logic to the core,
add a co-located test under `test/`.

## Trying a real run

```bash
cd examples/demo          # a ready-made four-section plan
parallely validate
parallely run -b codex
```

See [`examples/demo/README.md`](examples/demo/README.md) for details.

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add opencode streaming support
fix: emit human-readable output during plan phase
docs: clarify worktree cleanup behaviour
chore: bump dependencies
```

Keep commits atomic and the working tree clean. Open a PR against `main`; CI must be
green before merge.

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a tour of how a run flows through
the orchestrator, backend drivers, and git worktrees.

## Code of conduct

Be respectful and constructive. By participating you agree to uphold a welcoming,
harassment-free environment for everyone.
