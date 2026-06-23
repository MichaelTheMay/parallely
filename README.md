# Parallely

Parallel agent orchestration CLI — split large tasks into sections that execute concurrently via AI coding agents, each working in a shared git worktree.

Parallely works with **[Codex](https://github.com/openai/codex)**, **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, and **[OpenCode](https://github.com/opencode-ai/opencode)** as backends.

## How It Works

1. **Plan** — Define (or AI-generate) a set of parallel sections, each with its own scope and acceptance criteria
2. **Execute** — Parallely launches one agent per section in a shared git worktree, all running concurrently
3. **Monitor** — A fullscreen interactive TUI shows real-time progress, output, and token usage for every agent
4. **Merge** — Changes are auto-committed to a shared integration branch

```
┌──────────────────────────────────────────┐
│  parallely · Codex · o4-mini           2m 34s │
│  parse → setup → forge → merge → done    │
│──────────────────────────────────────────│
│  › ✓  1  Auth system        done   12.4K │
│    ●  2  API endpoints      run     8.2K │
│    ●  3  Database layer     run     6.1K │
│    ○  4  Tests              wait       – │
└──────────────────────────────────────────┘
```

## Installation

### Prerequisites

- **[Bun](https://bun.sh)** v1.0+ (runtime & bundler)
- **Node.js** 20+ (for npm global install)
- At least one agent CLI installed:
  - `codex` — `npm install -g @openai/codex`
  - `claude` — `npm install -g @anthropic-ai/claude-code`
  - `opencode` — See [opencode-ai/opencode](https://github.com/opencode-ai/opencode)

### Install from source

```bash
git clone https://github.com/MichaelTheMay/parallely.git
cd parallely
npm install --install-strategy=nested
bun run build
npm install -g .
```

Verify:

```bash
parallely --help
```

> **Why `--install-strategy=nested`?** Parallely uses React 19 with OpenTUI. Nested installs ensure both packages resolve the same React runtime, preventing the "multiple React runtimes" error.

## Quick Start

### Option A: AI-generated plan (one command)

```bash
cd your-project
parallely plan "Build a REST API with auth, CRUD endpoints, and tests"
```

This invokes an agent to write a parallel plan, validates it, then immediately launches all sections.

### Option B: Manual plan

```bash
cd your-project
parallely init                  # creates .parallely/plan/ with a template
# edit .parallely/plan/*.md files
parallely validate              # check for errors
parallely run                   # launch agents
```

## Commands

| Command | Description |
|---------|-------------|
| `parallely init` | Create `.parallely/plan/` with an example template |
| `parallely plan [prompt]` | AI-generate a plan from natural language, then run it |
| `parallely validate` | Check plan files for errors and warnings |
| `parallely run` | Execute the plan with an interactive TUI |
| `parallely prompt [section]` | Output agent prompts to stdout (for manual use) |
| `parallely setup` | Install Parallely skills into Claude Code / Cursor / Codex / OpenCode |
| `parallely status` | Show results of the last run |
| `parallely help` | Display help |

### Common options

```bash
parallely run -b claude-code          # use Claude Code backend
parallely run -b codex -m gpt-4.1    # use Codex with a specific model
parallely run --timeout 300000        # 5 minute timeout per agent
parallely run --no-cleanup            # keep the integration worktree after run
parallely plan "..." --no-run         # generate plan only, don't execute
```

## Plan Format

Each `.md` file in `.parallely/plan/` is one parallel section:

```markdown
---
title: Auth System
files:
  - src/auth/**
  - src/middleware/auth.ts
acceptance:
  - JWT login/register endpoints work
  - Auth middleware protects routes
  - Tests pass
---

# Auth System

Implement JWT-based authentication with login and register endpoints.

## Details

- Use bcrypt for password hashing
- Store sessions in Redis
- Add auth middleware that validates JWT tokens
```

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Short human-readable name |
| `files` | Recommended | Glob patterns of files this section touches (for overlap detection) |
| `acceptance` | Recommended | Concrete acceptance criteria the agent must satisfy |

## TUI Keybindings

### Overview

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate sections |
| `Enter` | Open detail view |
| `s` | Open split view |
| `1-9` | Jump to section |
| `?` | Toggle help |
| `q` | Quit |

### Detail View

| Key | Action |
|-----|--------|
| `Esc` | Back to overview |
| `j` / `k` | Scroll output |
| `d` / `u` | Page scroll |
| `g` / `G` | Top / bottom |
| `f` | Toggle auto-scroll |
| `i` | Send message to agent |
| `[` / `]` | Previous / next agent |
| `v` / `h` | Split vertical / horizontal |

### Split View

| Key | Action |
|-----|--------|
| `Tab` | Focus next pane |
| `1-9` | Show section N in pane |
| `x` | Close pane |
| `+` / `-` | Resize split |
| `i` | Message focused agent |

## Backends

| Backend | CLI | Install |
|---------|-----|---------|
| **Codex** (default) | `codex` | `npm install -g @openai/codex` |
| **Claude Code** | `claude` | `npm install -g @anthropic-ai/claude-code` |
| **OpenCode** | `opencode` | [github.com/opencode-ai/opencode](https://github.com/opencode-ai/opencode) |

Parallely remembers your last-used backend. Override with `-b`:

```bash
parallely run -b claude-code
parallely run -b codex
parallely run -b opencode
```

## Setting Up Skills

Install Parallely planning/implementation skills into your editor's agent harness:

```bash
parallely setup                        # all detected harnesses
parallely setup --harness claude-code  # Claude Code only
parallely setup --harness cursor       # Cursor only
```

This installs skills so agents know how to create and execute Parallely plans when you invoke `/parallely-plan` or `/parallely-implement`.

## Architecture

```
parallely/
├── bin/parallely.js              # Entry point
├── src/
│   ├── index.tsx            # CLI commands (Commander.js)
│   ├── orchestrator.ts      # Core orchestration engine
│   ├── types.ts             # TypeScript type definitions
│   ├── utils.ts             # Utilities
│   ├── cli-style.ts         # ANSI color helpers
│   ├── plan/
│   │   ├── parser.ts        # Plan file parser (YAML frontmatter + markdown)
│   │   └── validator.ts     # Plan validation & overlap detection
│   ├── backends/
│   │   ├── driver.ts        # Backend abstraction layer
│   │   ├── claude-code.ts   # Claude Code driver
│   │   ├── codex.ts         # Codex driver (with SDK streaming)
│   │   └── opencode.ts      # OpenCode driver
│   ├── git/
│   │   └── worktree.ts      # Git worktree management
│   └── tui/                 # Interactive terminal UI (React + OpenTUI)
│       ├── tui-root.tsx     # Root component & keyboard handling
│       ├── tui-state.ts     # State management (useReducer)
│       ├── overview.tsx     # Overview screen
│       ├── detail.tsx       # Detail view
│       ├── split.tsx        # Split pane layout
│       └── ...              # Additional TUI components
├── skill/
│   ├── SKILL.md             # Planning skill (agent instructions)
│   └── IMPLEMENT.md         # Implementation skill
├── package.json
└── tsconfig.json
```

## License

MIT
