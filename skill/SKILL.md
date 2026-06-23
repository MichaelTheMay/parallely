# Aeon Plan Creation Skill

You are creating an **Aeon execution plan** — a set of markdown files that will each be executed in parallel by an independent AI coding agent in its own git worktree.

## Output format

Create a directory of numbered markdown files. Each file = one agent = one parallel task.

```
.aeon/plan/
├── 01-section-name.md
├── 02-section-name.md
├── 03-section-name.md
└── ...
```

## File format

Each `.md` file has YAML-like frontmatter and a markdown body:

```markdown
---
title: Human-readable Section Title
files:
  - src/path/to/files/**
  - src/specific-file.ts
acceptance:
  - First acceptance criterion
  - Second acceptance criterion
---

# Section Title

Full implementation instructions here. Be specific and detailed.
The agent will receive this as its complete prompt.
```

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Short human-readable name |
| `files` | Recommended | Glob patterns of files this section will touch (used for overlap detection) |
| `acceptance` | Recommended | Concrete acceptance criteria |

### Body

The markdown body is the agent's complete prompt. Include:
- What to build/change and why
- Technical approach and constraints
- Specific file paths when known
- Example code or API signatures when helpful
- Any rules the agent should follow

## Planning principles

1. **Minimize file overlap** — Each section should touch different files. If two sections must modify the same file, note it in `files:` so overlap warnings fire.

2. **Self-contained sections** — Each agent works in isolation. It cannot see other agents' work. Include all context needed.

3. **Order for merge priority** — Files are processed in lexicographic order. Earlier sections merge first. Put foundational work (types, schemas, shared utils) in lower-numbered files.

4. **Right-size sections** — Each section should be 10-60 minutes of agent work. Too small = overhead. Too large = timeout risk.

5. **Include acceptance criteria** — These help verify the agent did its job. Be concrete: "tests pass", "API returns 200", "type-checks clean".

## Example plan

For a task "Build a REST API with auth, endpoints, and tests":

**01-types-and-schema.md** — Define TypeScript types, Zod schemas, database schema
**02-auth-system.md** — JWT auth, middleware, login/register endpoints
**03-api-endpoints.md** — CRUD endpoints for the main resources
**04-tests.md** — Integration tests for all endpoints

## Anti-patterns

- Sections that depend on each other's runtime output (they run in parallel!)
- Sections that modify the same files extensively (merge conflicts)
- Vague instructions ("make it good") — be specific
- Giant monolithic sections (split into focused tasks)

## Running the plan

```bash
aeon validate          # Check plan for errors
aeon run               # Execute with Codex (default)
aeon run -b codex      # Execute with Codex
aeon run -b opencode   # Execute with OpenCode
```

## After creating the plan

Once all plan files are written to `.aeon/plan/`, output a fenced command block:

```bash
cd /absolute/path/to/repo && aeon validate && aeon run
```

Replace the path with the actual repo root. Tell the user:
"Open a terminal and run the command above to start parallel execution.
The Aeon TUI will show real-time progress of all agents."

If the user specifies a backend preference, include it:
```bash
cd /absolute/path/to/repo && aeon validate && aeon run -b codex
```
