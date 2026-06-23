#!/usr/bin/env bun
// react-reconciler requires NODE_ENV=production for React 19 compat
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { AeonOrchestrator } from './orchestrator.js';
import { getDriver } from './backends/driver.js';
import { parsePlanDir } from './plan/parser.js';
import { validatePlan } from './plan/validator.js';
import { s } from './cli-style.js';
import { resolveSpawn } from './utils.js';
import type { Backend, OrchestratorConfig, PlanSection, RunSnapshot } from './types.js';

/* ── Helpers ── */

function parsePositiveInt(raw: string, label: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeInt(raw: string, label: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function parseBackend(raw: string): Backend {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'claude-code' || normalized === 'claude' || normalized === 'cc') return 'claude-code';
  if (normalized === 'codex') return 'codex';
  if (normalized === 'opencode' || normalized === 'oc') return 'opencode';
  throw new Error(`Unknown backend "${raw}". Supported: claude-code, codex, opencode`);
}

function ensureGitRepository(cwd: string): void {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  if (result.status === 0) return;

  const detail = (result.stderr || result.stdout || '').trim();
  if (detail) {
    throw new Error(`aeon run requires a git repository (${detail})`);
  }
  throw new Error('aeon run requires a git repository');
}

function ensureSingleReactRuntime(): void {
  const localRequire = createRequire(import.meta.url);
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  let aeonReactPath: string;
  try {
    aeonReactPath = localRequire.resolve('react');
  } catch {
    throw new Error(
      [
        'React is missing for aeon.',
        `Install dependencies from: ${packageDir}`,
        '  npm install --install-strategy=nested',
        '  bun run build',
      ].join('\n'),
    );
  }

  let openTuiReactPath: string;
  try {
    const openTuiEntry = localRequire.resolve('@opentui/react');
    const openTuiRequire = createRequire(openTuiEntry);
    openTuiReactPath = openTuiRequire.resolve('react');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to resolve @opentui/react runtime (${detail})`);
  }

  if (aeonReactPath === openTuiReactPath) return;

  throw new Error(
    [
      'Detected multiple React runtimes; OpenTUI cannot render reliably.',
      `aeon resolves react as: ${aeonReactPath}`,
      `@opentui/react resolves react as: ${openTuiReactPath}`,
      `Reinstall dependencies from: ${packageDir}`,
      '  npm install --install-strategy=nested',
      '  bun run build',
    ].join('\n'),
  );
}

interface AeonConfig {
  backend?: string;
}

function aeonConfigPath(cwd: string): string {
  return path.join(cwd, '.aeon', 'config.json');
}

function readAeonConfig(cwd: string): AeonConfig {
  const configPath = aeonConfigPath(cwd);
  if (!fs.existsSync(configPath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as AeonConfig;
    }
  } catch {
    // Ignore invalid config and fall back.
  }
  return {};
}

function writeAeonConfig(cwd: string, patch: Partial<AeonConfig>): void {
  const next = { ...readAeonConfig(cwd), ...patch };
  const configPath = aeonConfigPath(cwd);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

function latestRunBackend(cwd: string): Backend | undefined {
  const runsDir = path.join(cwd, '.aeon', 'runs');
  if (!fs.existsSync(runsDir)) return undefined;

  const runs = fs.readdirSync(runsDir).sort().reverse();
  for (const runId of runs) {
    const resultsPath = path.join(runsDir, runId, 'results.json');
    if (!fs.existsSync(resultsPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(resultsPath, 'utf-8')) as Record<string, unknown>;
      if (typeof parsed.backend === 'string') {
        return parseBackend(parsed.backend);
      }
    } catch {
      // Ignore malformed run metadata and continue searching.
    }
  }

  return undefined;
}

function resolveBackend(cwd: string, requestedBackend?: string): Backend {
  if (requestedBackend) {
    const parsed = parseBackend(requestedBackend);
    writeAeonConfig(cwd, { backend: parsed });
    return parsed;
  }

  const cfg = readAeonConfig(cwd);
  if (typeof cfg.backend === 'string') {
    try {
      return parseBackend(cfg.backend);
    } catch {
      // Ignore invalid config values and fall through.
    }
  }

  return latestRunBackend(cwd) ?? 'codex';
}

/* ── Setup helpers ── */

type Harness = 'claude-code' | 'cursor' | 'codex' | 'opencode';

const ALL_HARNESSES: Harness[] = ['claude-code', 'cursor', 'codex', 'opencode'];

function resolveSkillFile(filename: string): string {
  // Resolve relative to the package directory (bin/aeon.js → ../)
  const packageDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const skillPath = path.join(packageDir, 'skill', filename);
  if (!fs.existsSync(skillPath)) {
    // Fallback: resolve from cwd (dev mode)
    const cwdSkillPath = path.join(process.cwd(), 'aeon', 'skill', filename);
    if (fs.existsSync(cwdSkillPath)) return cwdSkillPath;
    throw new Error(
      `Cannot find ${filename} at ${skillPath} or ${cwdSkillPath}`,
    );
  }
  return skillPath;
}

function readSkillContent(): string {
  return fs.readFileSync(resolveSkillFile('SKILL.md'), 'utf-8');
}

function readImplementSkillContent(): string {
  return fs.readFileSync(resolveSkillFile('IMPLEMENT.md'), 'utf-8');
}

const AEON_SECTION_MARKER = '## Aeon';

function appendSectionToFile(
  filePath: string,
  sectionContent: string,
): { action: 'created' | 'updated' | 'skipped' } {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing.includes(AEON_SECTION_MARKER)) {
      // Replace the existing Aeon section (marker to next same-level heading or EOF)
      const markerIdx = existing.indexOf(AEON_SECTION_MARKER);
      const afterMarker = existing.indexOf('\n## ', markerIdx + AEON_SECTION_MARKER.length);
      const before = existing.slice(0, markerIdx).trimEnd();
      const after = afterMarker !== -1 ? existing.slice(afterMarker) : '';
      const updated = (before ? before + '\n\n' : '') + sectionContent + after;
      if (updated.trimEnd() === existing.trimEnd()) {
        return { action: 'skipped' };
      }
      fs.writeFileSync(filePath, updated);
      return { action: 'updated' };
    }
    fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + sectionContent);
    return { action: 'updated' };
  }
  fs.writeFileSync(filePath, sectionContent);
  return { action: 'created' };
}

interface SetupResult {
  harness: string;
  target: string;
  action: 'created' | 'updated' | 'skipped';
}

function installSkillFile(
  targetPath: string,
  content: string,
  harness: string,
): SetupResult {
  const relTarget = path.relative(process.cwd(), targetPath);
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf-8');
    if (existing.trimEnd() === content.trimEnd()) {
      return { harness, target: relTarget, action: 'skipped' };
    }
    fs.writeFileSync(targetPath, content);
    return { harness, target: relTarget, action: 'updated' };
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  return { harness, target: relTarget, action: 'created' };
}

function setupClaudeCode(cwd: string, skillBody: string, implementBody: string): SetupResult[] {
  const results: SetupResult[] = [];

  // Install planning skill
  const planSkill = `---\nname: aeon-plan\ndescription: Create an Aeon parallel execution plan that splits work across multiple AI agents running concurrently in separate worktrees.\n---\n\n${skillBody}`;
  results.push(installSkillFile(
    path.join(cwd, '.claude', 'skills', 'aeon-plan', 'SKILL.md'),
    planSkill,
    'Claude Code',
  ));

  // Install implementation skill
  const implSkill = `---\nname: aeon-implement\ndescription: Execute a single Aeon plan section in an isolated worktree — stay in scope, follow acceptance criteria, commit when done.\n---\n\n${implementBody}`;
  results.push(installSkillFile(
    path.join(cwd, '.claude', 'skills', 'aeon-implement', 'SKILL.md'),
    implSkill,
    'Claude Code',
  ));

  // Also keep CLAUDE.md reference for context
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const section = `${AEON_SECTION_MARKER}\n\nThis repo uses [Aeon](aeon/) for parallel agent orchestration.\n- **Planning:** \`/aeon-plan\` — create an execution plan for parallel work\n- **Implementation:** \`/aeon-implement\` — execute a single plan section\n`;
  const { action } = appendSectionToFile(claudeMdPath, section);
  results.push({ harness: 'Claude Code', target: 'CLAUDE.md', action });

  return results;
}

function setupCursorSkill(cwd: string, skillBody: string, implementBody: string): SetupResult[] {
  const results: SetupResult[] = [];

  // Planning skill
  const planSkill = `---\nname: aeon\ndescription: Parallel agent orchestration — create Aeon execution plans that split work across multiple AI agents running concurrently.\n---\n\n${skillBody}`;
  results.push(installSkillFile(
    path.join(cwd, '.cursor', 'skills', 'aeon', 'SKILL.md'),
    planSkill,
    'Cursor',
  ));

  // Implementation skill
  const implSkill = `---\nname: aeon-implement\ndescription: Implementation skill for executing a single Aeon plan section in an isolated worktree.\n---\n\n${implementBody}`;
  results.push(installSkillFile(
    path.join(cwd, '.cursor', 'skills', 'aeon', 'IMPLEMENT.md'),
    implSkill,
    'Cursor',
  ));

  return results;
}

function setupCursorRule(cwd: string): SetupResult {
  const rulesDir = path.join(cwd, '.cursor', 'rules');
  const ruleFile = path.join(rulesDir, 'aeon-parallel-plans.mdc');

  if (fs.existsSync(ruleFile)) {
    return { harness: 'Cursor', target: '.cursor/rules/aeon-parallel-plans.mdc', action: 'skipped' };
  }

  fs.mkdirSync(rulesDir, { recursive: true });

  const content = `---
description: When asked to create a parallel execution plan or split work across agents, follow the Aeon skill
alwaysApply: false
globs: .aeon/plan/**
---

# Aeon Parallel Plans

When creating or editing Aeon execution plans, follow the full skill at \`.cursor/skills/aeon/SKILL.md\`.
`;
  fs.writeFileSync(ruleFile, content);
  return { harness: 'Cursor', target: '.cursor/rules/aeon-parallel-plans.mdc', action: 'created' };
}

function setupCodexOpenCode(cwd: string, skillBody: string, implementBody: string): SetupResult[] {
  const results: SetupResult[] = [];

  // Install planning skill to .codex/skills/ (Codex discovers these)
  const planSkill = `---\nname: aeon-plan\ndescription: Create an Aeon parallel execution plan that splits work across multiple AI agents running concurrently in separate worktrees.\n---\n\n${skillBody}`;
  results.push(installSkillFile(
    path.join(cwd, '.codex', 'skills', 'aeon-plan', 'SKILL.md'),
    planSkill,
    'Codex',
  ));

  // Install implementation skill
  const implSkill = `---\nname: aeon-implement\ndescription: Execute a single Aeon plan section in an isolated worktree — stay in scope, follow acceptance criteria, commit when done.\n---\n\n${implementBody}`;
  results.push(installSkillFile(
    path.join(cwd, '.codex', 'skills', 'aeon-implement', 'SKILL.md'),
    implSkill,
    'Codex',
  ));

  // Also keep AGENTS.md reference for context
  const agentsMdPath = path.join(cwd, 'AGENTS.md');
  const section = `${AEON_SECTION_MARKER}\n\nThis repo uses [Aeon](aeon/) for parallel agent orchestration.\n- **Planning:** \`/aeon-plan\` — create an execution plan for parallel work\n- **Implementation:** \`/aeon-implement\` — execute a single plan section\n`;
  const { action } = appendSectionToFile(agentsMdPath, section);
  results.push({ harness: 'Codex/OpenCode', target: 'AGENTS.md', action });

  return results;
}

function detectHarnesses(cwd: string): Harness[] {
  const detected: Harness[] = [];
  // Claude Code: always available (CLAUDE.md is standard)
  detected.push('claude-code');
  // Cursor: detect .cursor/ directory
  if (fs.existsSync(path.join(cwd, '.cursor'))) {
    detected.push('cursor');
  }
  // Codex/OpenCode: always available (AGENTS.md is standard)
  detected.push('codex');
  detected.push('opencode');
  return detected;
}

function parseHarness(raw: string): Harness[] {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'all') return ALL_HARNESSES;
  if (normalized === 'claude-code' || normalized === 'claude' || normalized === 'cc') return ['claude-code'];
  if (normalized === 'cursor') return ['cursor'];
  if (normalized === 'codex') return ['codex'];
  if (normalized === 'opencode' || normalized === 'oc') return ['opencode'];
  throw new Error(`Unknown harness "${raw}". Supported: claude-code, cursor, codex, opencode, all`);
}

function readFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function resolvePlanPrompt(rawPromptParts: string[] | undefined): Promise<string> {
  const inlinePrompt = (rawPromptParts ?? []).join(' ').trim();
  if (inlinePrompt) return inlinePrompt;

  if (!process.stdin.isTTY) {
    return (await readFromStdin()).trim();
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    process.stdout.write(`\n  ${s.stone('Enter plan prompt:')}\n\n`);
    return (await rl.question(`  ${s.gold('›')} `)).trim();
  } finally {
    rl.close();
  }
}

function buildPlanningPrompt(input: {
  skillBody: string;
  userPrompt: string;
  repoRoot: string;
  planDir: string;
}): string {
  return [
    `You are operating in the repository at: ${input.repoRoot}`,
    '',
    'Create an Aeon execution plan for the user request below.',
    `Write plan section files directly into: ${input.planDir}`,
    '',
    '## User Request',
    input.userPrompt,
    '',
    '## Requirements',
    '- Follow the Aeon planning skill exactly.',
    '- Create or update numbered markdown files (01-*.md, 02-*.md, ...).',
    '- Ensure each section has frontmatter with title/files/acceptance plus a detailed markdown body.',
    '- Keep sections parallel-friendly with minimal file overlap.',
    '- Do not ask follow-up questions; make reasonable assumptions and proceed.',
    '- Do not run `aeon run` yourself; stop after writing the plan files.',
    '',
    '## Aeon Planning Skill',
    input.skillBody.trim(),
  ].join('\n');
}

async function runPlanningHarness(input: {
  backend: Backend;
  model?: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
}): Promise<void> {
  const driver = getDriver(input.backend);
  await driver.checkVersion();
  const { command, args } = driver.buildArgs({
    yolo: true,
    model: input.model,
    prompt: input.prompt,
    cwd: input.cwd,
  });

  await new Promise<void>((resolve, reject) => {
    const r = resolveSpawn(command, args);
    const child = spawn(r.command, r.args, {
      cwd: input.cwd,
      stdio: 'inherit',
      shell: r.command.toLowerCase().endsWith('.cmd'),
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (input.timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5_000);
          reject(new Error(`Planning agent timed out after ${input.timeoutMs}ms`));
        });
      }, input.timeoutMs);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      finish(() => reject(err));
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        finish(() => resolve());
        return;
      }
      finish(() => reject(new Error(`Planning agent exited with code ${code ?? 1}`)));
    });
  });
}

/* ── Commands ── */

async function cmdRun(opts: {
  backend?: string;
  model?: string;
  planDir?: string;
  cleanup: boolean;
  timeout?: string;
  inactivityTimeout?: string;
}): Promise<void> {
  ensureGitRepository(process.cwd());
  ensureSingleReactRuntime();

  const backend = resolveBackend(process.cwd(), opts.backend);
  const config: OrchestratorConfig = {
    planDir: opts.planDir ?? '.aeon/plan',
    startCwd: process.cwd(),
    backend,
    model: opts.model?.trim() || undefined,
    cleanup: opts.cleanup,
    timeoutMs: opts.timeout ? parseNonNegativeInt(opts.timeout, 'timeout') : 0,
    inactivityTimeoutMs: opts.inactivityTimeout
      ? parseNonNegativeInt(opts.inactivityTimeout, 'inactivity-timeout')
      : 0,
  };

  const orchestrator = new AeonOrchestrator(config);

  // Lazy-load OpenTUI only when the TUI is actually needed
  const { createCliRenderer } = await import('@opentui/core');
  const { createRoot } = await import('@opentui/react');
  const { AeonTui } = await import('./tui/tui-root.js');

  // OpenTUI manages alternate screen, cursor visibility, and cleanup internally
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const root = createRoot(renderer);
  root.render(<AeonTui orchestrator={orchestrator} />);

  const result = await orchestrator.run();

  // Let final render flush
  await new Promise((resolve) => setTimeout(resolve, 500));
  renderer.destroy();

  if (result.success) {
    process.stdout.write(`\n  ${s.jade('✦')} ${s.text(`Run ${result.runId}:`)} ${s.jade(`${result.sectionsCompleted}/${result.sectionsTotal} sections hewn`)}\n`);
    if (result.integrationBranch) {
      process.stdout.write(`  ${s.stone('Branch:')} ${s.text(result.integrationBranch)}\n`);
    }
    process.stdout.write('\n');
  } else {
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(`Shattered: ${result.error ?? 'unknown fracture'}`)}\n\n`);
    process.exitCode = 1;
  }
}

function cmdInit(): void {
  const planDir = path.join(process.cwd(), '.aeon', 'plan');
  fs.mkdirSync(planDir, { recursive: true });

  const example = `---
title: Example Section
files:
  - src/example/**
acceptance:
  - Feature works as described
  - Tests pass
---

# Example Section

Implement the example feature.

## Details

Replace this with your actual implementation instructions.
The agent will receive this entire markdown body as its prompt.
`;

  const examplePath = path.join(planDir, '01-example.md');
  if (fs.existsSync(examplePath)) {
    process.stdout.write(`\n  ${s.stone('◫')} Plan directory already exists at ${s.dim(planDir)}\n\n`);
    return;
  }

  fs.writeFileSync(examplePath, example);
  process.stdout.write(`\n  ${s.header()}\n\n`);
  process.stdout.write(`  ${s.jade('✦')} Quarried plan directory: ${s.text(planDir)}\n`);
  process.stdout.write(`  ${s.jade('✦')} Template: ${s.text(examplePath)}\n\n`);
  process.stdout.write(`  ${s.stone('Edit the template and add more .md files, then run:')} ${s.gold('aeon validate')}\n\n`);
}

function cmdValidate(opts: { planDir?: string }): void {
  const planDir = path.resolve(process.cwd(), opts.planDir ?? '.aeon/plan');

  try {
    const sections = parsePlanDir(planDir);
    const result = validatePlan(sections);

    process.stdout.write(`\n  ${s.header()}\n`);
    process.stdout.write(`  ${s.rule(44)}\n`);
    process.stdout.write(`  ${s.stone('Plan')}  ${s.dim(planDir)}\n`);
    process.stdout.write(`  ${s.stone('Sections')}  ${s.text(String(sections.length))}\n\n`);

    for (const section of sections) {
      process.stdout.write(`  ${s.gold(String(section.index + 1).padStart(2))}  ${s.text(section.title)} ${s.dim(`(${section.filename})`)}\n`);
      process.stdout.write(`      ${s.stone('Files:')} ${s.dim(section.files.length > 0 ? section.files.join(', ') : '(none)')}\n`);
      process.stdout.write(`      ${s.stone('Acceptance:')} ${s.dim(`${section.acceptance.length} criteria`)}\n`);
    }

    if (result.warnings.length > 0) {
      process.stdout.write(`\n  ${s.warn('⚠ FISSURES')}\n`);
      for (const w of result.warnings) {
        process.stdout.write(`    ${s.warn('⚠')} ${s.text(w.file)}: ${s.dim(w.message)}\n`);
      }
    }

    if (result.errors.length > 0) {
      process.stderr.write(`\n  ${s.crimson('✗ FRACTURES')}\n`);
      for (const e of result.errors) {
        process.stderr.write(`    ${s.crimson('✗')} ${s.text(e)}\n`);
      }
      process.exitCode = 1;
    } else {
      process.stdout.write(`\n  ${s.jade('✦')} ${s.jade('Plan is sealed')}\n`);
    }
    process.stdout.write('\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(`Validation shattered: ${message}`)}\n\n`);
    process.exitCode = 1;
  }
}

function cmdStatus(): void {
  const runsDir = path.join(process.cwd(), '.aeon', 'runs');
  if (!fs.existsSync(runsDir)) {
    process.stdout.write(`\n  ${s.stone('◫')} No inscriptions found. Run: ${s.gold('aeon run')}\n\n`);
    return;
  }

  const runs = fs.readdirSync(runsDir).sort().reverse();
  if (runs.length === 0) {
    process.stdout.write(`\n  ${s.stone('◫')} No inscriptions found. Run: ${s.gold('aeon run')}\n\n`);
    return;
  }

  const latestRun = runs[0]!;
  const resultsPath = path.join(runsDir, latestRun, 'results.json');

  if (!fs.existsSync(resultsPath)) {
    process.stdout.write(`\n  ${s.stone('◫')} Latest run: ${s.text(latestRun)} ${s.dim('(no results)')}\n\n`);
    return;
  }

  const snap: RunSnapshot = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  const phaseColor = snap.phase === 'done' ? s.jade : snap.phase === 'error' ? s.crimson : s.gold;

  process.stdout.write(`\n  ${s.header()}\n`);
  process.stdout.write(`  ${s.rule(44)}\n`);
  process.stdout.write(`  ${s.stone('Run')}      ${s.text(snap.runId)}\n`);
  process.stdout.write(`  ${s.stone('Phase')}    ${phaseColor(snap.phase.toUpperCase())}\n`);
  process.stdout.write(`  ${s.stone('Backend')}  ${s.text(snap.backend)}\n`);
  process.stdout.write(`  ${s.stone('Started')}  ${s.dim(snap.startedAt)}\n`);
  if (snap.integrationBranch) {
    process.stdout.write(`  ${s.stone('Branch')}   ${s.text(snap.integrationBranch)}\n`);
  }

  process.stdout.write(`\n  ${s.stone('Sections:')}\n`);
  for (const sec of snap.sections) {
    const icon = sec.status === 'completed' ? s.jade('✦') :
                 sec.status === 'failed' ? s.crimson('✗') :
                 sec.status === 'running' ? s.gold('✧') : s.stone('◫');
    const tokens = sec.tokenUsage.input + sec.tokenUsage.output;
    const tokenStr = tokens > 0 ? s.dim(`${tokens} tokens`) : '';
    process.stdout.write(`    ${icon} ${s.gold(String(sec.index + 1).padStart(2))}  ${s.text(sec.title.padEnd(25))} ${s.stone(sec.status.padEnd(12))} ${tokenStr}\n`);
  }

  if (runs.length > 1) {
    process.stdout.write(`\n  ${s.dim(`${runs.length - 1} older run(s) in .aeon/runs/`)}\n`);
  }
  process.stdout.write('\n');
}

function cmdSetup(opts: { harness?: string }): void {
  const cwd = process.cwd();
  const requested = opts.harness ? parseHarness(opts.harness) : ALL_HARNESSES;
  const detected = detectHarnesses(cwd);
  const targets = requested.filter((h) => detected.includes(h));

  let skillBody: string;
  let implementBody: string;
  try {
    skillBody = readSkillContent();
    implementBody = readImplementSkillContent();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(`Setup shattered: ${message}`)}\n\n`);
    process.exitCode = 1;
    return;
  }

  const results: SetupResult[] = [];

  for (const harness of targets) {
    switch (harness) {
      case 'claude-code':
        results.push(...setupClaudeCode(cwd, skillBody, implementBody));
        break;
      case 'cursor':
        results.push(...setupCursorSkill(cwd, skillBody, implementBody));
        results.push(setupCursorRule(cwd));
        break;
      case 'codex':
      case 'opencode':
        // Both use AGENTS.md — only write once
        if (!results.some((r) => r.target === 'AGENTS.md')) {
          results.push(...setupCodexOpenCode(cwd, skillBody, implementBody));
        }
        break;
    }
  }

  process.stdout.write(`\n  ${s.header()} ${s.stone('setup')}\n`);
  process.stdout.write(`  ${s.rule(44)}\n\n`);
  for (const r of results) {
    const icon = r.action === 'skipped' ? s.stone('◫') : s.jade('✦');
    const verb =
      r.action === 'created' ? s.jade('quarried') :
      r.action === 'updated' ? s.gold('reforged') :
      s.dim('already inscribed');
    process.stdout.write(`  ${icon} ${s.text(r.harness.padEnd(16))} ${s.stone('━')} ${verb} ${s.dim(r.target)}\n`);
  }

  const installed = results.filter((r) => r.action !== 'skipped');
  if (installed.length > 0) {
    process.stdout.write(`\n  ${s.jade('✦')} ${s.text('Skills inscribed. Agents will know the way.')}\n\n`);
  } else {
    process.stdout.write(`\n  ${s.stone('Skills already inscribed in all harnesses.')}\n\n`);
  }
}

async function cmdPlan(
  promptParts: string[] | undefined,
  opts: {
    backend?: string;
    model?: string;
    planDir?: string;
    planTimeout?: string;
    run: boolean;
    cleanup: boolean;
    timeout?: string;
    inactivityTimeout?: string;
  },
): Promise<void> {
  const cwd = process.cwd();
  const backend = resolveBackend(cwd, opts.backend);
  const model = opts.model?.trim() || undefined;
  const planDir = opts.planDir ?? '.aeon/plan';
  const planDirAbs = path.resolve(cwd, planDir);
  const planTimeoutMs = opts.planTimeout
    ? parseNonNegativeInt(opts.planTimeout, 'plan-timeout')
    : 0;

  const userPrompt = await resolvePlanPrompt(promptParts);
  if (!userPrompt) {
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson('Plan prompt is required.')}\n\n`);
    process.exitCode = 1;
    return;
  }

  let skillBody: string;
  try {
    skillBody = readSkillContent();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(`Could not load planning skill: ${message}`)}\n\n`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(planDirAbs, { recursive: true });
  const planningPrompt = buildPlanningPrompt({
    skillBody,
    userPrompt,
    repoRoot: cwd,
    planDir: planDirAbs,
  });

  process.stdout.write(`\n  ${s.header()} ${s.stone('plan')}\n`);
  process.stdout.write(`  ${s.rule(44)}\n`);
  process.stdout.write(`  ${s.stone('Backend')}  ${s.text(backend)}\n`);
  process.stdout.write(`  ${s.stone('Plan dir')} ${s.dim(planDirAbs)}\n`);
  process.stdout.write(`  ${s.stone('Model')}    ${s.dim(model ?? '(default)')}\n\n`);
  process.stdout.write(`  ${s.jade('✦')} ${s.text('Invoking harness to write the plan...')}\n\n`);

  try {
    await runPlanningHarness({
      backend,
      model,
      prompt: planningPrompt,
      cwd,
      timeoutMs: planTimeoutMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(`Planning failed: ${message}`)}\n\n`);
    process.exitCode = 1;
    return;
  }

  let sections: PlanSection[];
  try {
    sections = parsePlanDir(planDirAbs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(`Plan parsing failed: ${message}`)}\n\n`);
    process.exitCode = 1;
    return;
  }

  const validation = validatePlan(sections);
  if (validation.warnings.length > 0) {
    process.stdout.write(`\n  ${s.warn('⚠ FISSURES')}\n`);
    for (const w of validation.warnings) {
      process.stdout.write(`    ${s.warn('⚠')} ${s.text(w.file)}: ${s.dim(w.message)}\n`);
    }
  }

  if (!validation.valid) {
    process.stderr.write(`\n  ${s.crimson('✗ FRACTURES')}\n`);
    for (const error of validation.errors) {
      process.stderr.write(`    ${s.crimson('✗')} ${s.text(error)}\n`);
    }
    process.stderr.write(`\n  ${s.crimson('Fix the generated plan, then run:')} ${s.gold(`aeon run -b ${backend}`)}\n\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n  ${s.jade('✦')} ${s.jade(`Plan ready with ${sections.length} section(s).`)}\n`);

  if (!opts.run) {
    process.stdout.write(`  ${s.stone('Auto-run skipped (--no-run).')}\n\n`);
    return;
  }

  process.stdout.write(`  ${s.jade('✦')} ${s.text('Starting aeon run...')}\n\n`);
  await cmdRun({
    backend,
    model,
    planDir,
    cleanup: opts.cleanup,
    timeout: opts.timeout,
    inactivityTimeout: opts.inactivityTimeout,
  });
}

function cmdPrompt(section: string | undefined, opts: { planDir?: string }): void {
  const planDir = path.resolve(process.cwd(), opts.planDir ?? '.aeon/plan');

  let sections: PlanSection[];
  try {
    sections = parsePlanDir(planDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(message)}\n\n`);
    process.exitCode = 1;
    return;
  }

  let implementSkill: string;
  try {
    implementSkill = readImplementSkillContent();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(message)}\n\n`);
    process.exitCode = 1;
    return;
  }

  if (section !== undefined) {
    const idx = Number.parseInt(section, 10);
    if (!Number.isFinite(idx) || idx < 1 || idx > sections.length) {
      process.stderr.write(
        `\n  ${s.crimson('✗')} ${s.crimson(`Invalid section: ${section}. Must be 1-${sections.length}.`)}\n\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(formatSectionPrompt(sections[idx - 1]!, implementSkill));
  } else {
    // All sections
    for (let i = 0; i < sections.length; i++) {
      if (i > 0) {
        process.stdout.write(
          '\n\n' +
          `${s.rule(52)}\n` +
          `${s.gold(`✦ Section ${i + 1}:`)} ${s.text(sections[i]!.title)} ${s.dim(`(${sections[i]!.filename})`)}\n` +
          `${s.rule(52)}\n\n`,
        );
      }
      process.stdout.write(formatSectionPrompt(sections[i]!, implementSkill));
    }
  }
}

function formatSectionPrompt(section: PlanSection, implementSkill: string): string {
  const parts: string[] = [];

  parts.push(`# Aeon Section: ${section.title}\n`);
  parts.push(implementSkill.trim());
  parts.push('\n\n---\n');
  parts.push(section.body);

  if (section.acceptance.length > 0) {
    parts.push('\n\n## Acceptance Criteria\n');
    for (const criterion of section.acceptance) {
      parts.push(`- ${criterion}\n`);
    }
  }

  if (section.files.length > 0) {
    parts.push('\n## Scope\n');
    parts.push('Files this section touches:\n');
    for (const file of section.files) {
      parts.push(`- ${file}\n`);
    }
  }

  return parts.join('\n');
}

function cmdHelp(): void {
  const cmd = (name: string, desc: string) =>
    `  ${s.gold(name.padEnd(28))} ${s.stone(desc)}`;

  process.stdout.write(`
  ${s.header()} ${s.dim('— parallel agent orchestration')}
  ${s.rule(52)}

  ${s.bold('COMMANDS')}
${cmd('aeon init', 'Quarry a new plan directory')}
${cmd('aeon plan [prompt]', 'Generate a plan from a prompt, then run')}
${cmd('aeon validate', 'Inspect plan for fractures')}
${cmd('aeon run [-b backend]', 'Forge the plan in the TUI')}
${cmd('aeon prompt [section]', 'Inscribe prompts to stdout')}
${cmd('aeon setup [--harness name]', 'Install skills into harnesses')}
${cmd('aeon status', 'Read the last inscription')}
${cmd('aeon help', 'Show this stone tablet')}

  ${s.bold('WORKFLOW')}
  ${s.gold('1.')} ${s.text('aeon plan "..."')} ${s.stone('━')} ${s.dim('auto-generate plan + run')}
  ${s.stone('or')}
  ${s.gold('1.')} ${s.text('aeon init')}       ${s.stone('━')} ${s.dim('quarry plan files')}
  ${s.gold('2.')} ${s.text('aeon validate')}   ${s.stone('━')} ${s.dim('inspect for fractures')}
  ${s.gold('3.')} ${s.text('aeon run')}        ${s.stone('━')} ${s.dim('forge with parallel agents')}
  ${s.stone('or')}
  ${s.gold('3.')} ${s.text('aeon prompt')}     ${s.stone('━')} ${s.dim('inscribe prompts manually')}

  ${s.bold('INSTALL')}
  ${s.gold('1.')} ${s.text('Install Bun')}     ${s.stone('━')} ${s.dim('curl -fsSL https://bun.sh/install | bash')}
  ${s.gold('2.')} ${s.text('Set PATH')}        ${s.stone('━')} ${s.dim('export PATH="$HOME/.bun/bin:$PATH"')}
  ${s.gold('3.')} ${s.text('Install deps')}    ${s.stone('━')} ${s.dim('cd aeon && npm install --install-strategy=nested')}
  ${s.gold('4.')} ${s.text('Build aeon')}      ${s.stone('━')} ${s.dim('bun run build')}
  ${s.gold('5.')} ${s.text('Install global')}  ${s.stone('━')} ${s.dim('npm install -g /abs/path/to/aeon')}
  ${s.gold('6.')} ${s.text('Verify')}          ${s.stone('━')} ${s.dim('aeon --help')}

`);
}

/* ── Main ── */

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('aeon')
    .description('Parallel agent orchestration — execute plan sections concurrently via AI coding agents')
    .version('0.1.0');

  program
    .command('run')
    .description('Execute the plan')
    .option('-b, --backend <name>', 'Agent backend: codex, claude-code, opencode (default: configured backend)')
    .option('-m, --model <name>', 'Model override for the backend')
    .option('--plan-dir <path>', 'Path to plan directory (default: .aeon/plan)')
    .option('--no-cleanup', 'Keep the shared integration worktree after run finishes')
    .option('--timeout <ms>', 'Overall timeout per agent in ms (0 disables; default: 0)')
    .option('--inactivity-timeout <ms>', 'Inactivity timeout per agent in ms (0 disables; default: 0)')
    .action(cmdRun);

  program
    .command('init')
    .description('Create .aeon/plan/ with an example template')
    .action(cmdInit);

  program
    .command('plan [prompt...]')
    .description('Generate a plan from a prompt via the configured backend, then run it')
    .option('-b, --backend <name>', 'Planning backend: codex, claude-code, opencode (default: configured backend)')
    .option('-m, --model <name>', 'Model override for planning and run')
    .option('--plan-dir <path>', 'Path to plan directory (default: .aeon/plan)')
    .option('--plan-timeout <ms>', 'Timeout for plan generation in ms (0 disables; default: 0)')
    .option('--no-run', 'Generate and validate the plan only (skip automatic aeon run)')
    .option('--no-cleanup', 'Keep the shared integration worktree after run finishes')
    .option('--timeout <ms>', 'Overall timeout per agent in ms for aeon run (0 disables; default: 0)')
    .option('--inactivity-timeout <ms>', 'Inactivity timeout per agent in ms for aeon run (0 disables; default: 0)')
    .action(cmdPlan);

  program
    .command('validate')
    .description('Check plan files for errors and warnings')
    .option('--plan-dir <path>', 'Path to plan directory (default: .aeon/plan)')
    .action(cmdValidate);

  program
    .command('status')
    .description('Show last run results')
    .action(cmdStatus);

  program
    .command('prompt [section]')
    .description('Output prompts for plan sections (pipe into any agent CLI)')
    .option('--plan-dir <path>', 'Path to plan directory (default: .aeon/plan)')
    .action(cmdPrompt);

  program
    .command('setup')
    .description('Install the Aeon skill into agent harnesses')
    .option('--harness <name>', 'Specific harness: claude-code, cursor, codex, opencode, all', 'all')
    .action(cmdSetup);

  program
    .command('help')
    .description('Show help message with examples')
    .action(cmdHelp);

  // Default to help when no command is given
  if (process.argv.length <= 2) {
    cmdHelp();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n  ${s.crimson('✗')} ${s.crimson(`Shattered: ${message}`)}\n\n`);
  process.exitCode = 1;
});
