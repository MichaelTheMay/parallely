# Security Policy

## Supported versions

Parallely is pre-1.0. Security fixes land on the latest published `0.x` release.

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than opening a public issue.

- Use GitHub's [private vulnerability reporting](https://github.com/MichaelTheMay/parallely/security/advisories/new), or
- open a minimal issue asking for a private contact channel (no exploit details).

You can expect an initial acknowledgement within a few days. Once a fix is available,
we'll credit you in the release notes unless you prefer to remain anonymous.

## Scope & handling notes

Parallely spawns third-party agent CLIs (Codex, Claude Code, OpenCode) and runs git
against your repository. Keep in mind:

- **Agents execute with your permissions.** Run Parallely on repositories and with
  backends you trust. Prefer a clean, committed working tree before a run.
- **Secrets** (e.g. `JWT_SECRET`, API keys) are read from your environment and never
  committed by Parallely itself. Do not paste secrets into plan files.
- Parallely sets `GIT_TERMINAL_PROMPT=0` when shelling out so git never blocks on an
  interactive credential prompt during a run.
