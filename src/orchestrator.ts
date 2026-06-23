import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentExecResult,
  Backend,
  BackendDriver,
  OrchestratorConfig,
  Phase,
  PlanSection,
  RunResult,
  RunSnapshot,
  SectionSnapshot,
  TokenUsage,
} from './types.js';
import {
  EMPTY_USAGE,
  addUsage,
  generateRunId,
  nowIso,
  resolveSpawn,
  runCommand,
} from './utils.js';
import { getDriver } from './backends/driver.js';
import { parsePlanDir } from './plan/parser.js';
import { validatePlan } from './plan/validator.js';
import { WorktreeManager } from './git/worktree.js';
import { SectionOutputStream } from './tui/output-stream.js';

interface RunAgentOptions {
  sessionId?: string;
}

const MAX_SECTION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1_500;
const STDERR_TAIL_LEN = 320;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AeonOrchestrator {
  private config: OrchestratorConfig;
  private runId: string;
  private snapshot: RunSnapshot;
  private listeners = new Set<(snapshot: RunSnapshot) => void>();
  private lastEmitTime = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private driver: BackendDriver;
  private worktreeManager!: WorktreeManager;
  private repoRoot = '';
  private baseBranch = '';
  private gitMutationLock: Promise<void> = Promise.resolve();
  private outputStreams = new Map<string, SectionOutputStream>();
  private chatInFlight = new Set<string>();

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.runId = generateRunId();
    this.driver = getDriver(config.backend);

    this.snapshot = {
      runId: this.runId,
      phase: 'idle',
      statusMessage: 'Initializing...',
      startedAt: nowIso(),
      lastUpdatedAt: nowIso(),
      done: false,
      failed: false,
      backend: config.backend,
      model: config.model,
      repoRoot: '',
      baseBranch: '',
      planDir: config.planDir,
      sections: [],
      tokenUsage: { ...EMPTY_USAGE },
      logs: [],
    };
  }

  /* ── Public API ── */

  public getSnapshot(): RunSnapshot {
    return this.cloneSnapshot();
  }

  public subscribe(listener: (snapshot: RunSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.cloneSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getOutputStream(sectionId: string): SectionOutputStream | undefined {
    return this.outputStreams.get(sectionId);
  }

  public getOutputStreams(): Map<string, SectionOutputStream> {
    return this.outputStreams;
  }

  public async sendMessage(sectionId: string, text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;

    const section = this.snapshot.sections.find((s) => s.id === sectionId);
    if (!section) {
      throw new Error(`Unknown section: ${sectionId}`);
    }
    if (!section.worktreePath) {
      throw new Error('Section worktree is not ready yet');
    }
    if (section.status === 'pending') {
      throw new Error('Section has not started yet');
    }
    if (section.status === 'running') {
      throw new Error('Section is currently busy running');
    }
    if (this.chatInFlight.has(sectionId)) {
      throw new Error('A message is already in flight for this section');
    }

    this.chatInFlight.add(sectionId);
    this.updateSection(sectionId, { chatState: 'sending', chatError: undefined });
    this.outputStreams.get(sectionId)?.push(`You: ${message}`);
    this.addLog(`Message sent to "${section.title}"`);

    try {
      const result = await this.runAgent(
        sectionId,
        section.worktreePath,
        message,
        { sessionId: section.sessionId },
      );

      if (result.timedOut) {
        throw new Error('Agent timed out');
      }
      if (result.exitCode !== 0) {
        throw new Error(`Agent exited with code ${result.exitCode}`);
      }

      if (result.sessionId) {
        this.updateSection(sectionId, { sessionId: result.sessionId });
      }

      this.updateSection(sectionId, { chatState: 'idle', chatError: undefined });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      this.addLog(`Message failed for "${section.title}": ${messageText}`);
      this.updateSection(sectionId, {
        chatState: 'error',
        chatError: messageText,
        lastMessage: messageText,
      });
      throw err;
    } finally {
      this.chatInFlight.delete(sectionId);
    }
  }

  public async run(): Promise<RunResult> {
    try {
      await this.phaseParsing();
      await this.phaseWorktreeSetup();
      await this.phaseExecuting();
      await this.phaseMerging();
      await this.phaseConsolidateWorktrees();
      this.phaseDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setPhase('error', message);
      this.snapshot.failed = true;
      this.snapshot.error = message;
      this.snapshot.done = true;
      if (this.worktreeManager) {
        await this.phaseConsolidateWorktrees();
      }
      this.emitSnapshotNow();
    }

    // Persist results
    this.persistResults();

    // Cleanup worktrees unless --no-cleanup
    if (this.config.cleanup && this.worktreeManager) {
      this.addLog('Cleaning up worktrees...');
      await this.worktreeManager.cleanup();
    }

    return {
      success: !this.snapshot.failed,
      runId: this.runId,
      integrationBranch: this.snapshot.integrationBranch,
      sectionsCompleted: this.snapshot.sections.filter((s) => s.status === 'completed').length,
      sectionsTotal: this.snapshot.sections.length,
      error: this.snapshot.error,
    };
  }

  /* ── Phase: PARSING ── */

  private async phaseParsing(): Promise<void> {
    this.setPhase('parsing', 'Parsing plan...');

    // Discover repo root
    const gitRoot = await runCommand('git', ['rev-parse', '--show-toplevel'], {
      cwd: this.config.startCwd,
    });
    this.repoRoot = gitRoot.stdout.trim();
    this.snapshot.repoRoot = this.repoRoot;

    // Get current branch
    const branchResult = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: this.repoRoot,
    });
    this.baseBranch = branchResult.stdout.trim();
    this.snapshot.baseBranch = this.baseBranch;

    // Verify clean working tree
    const status = await runCommand('git', ['status', '--porcelain'], { cwd: this.repoRoot });
    if (status.stdout.trim()) {
      this.addLog('Warning: working tree has uncommitted changes');
    }

    // Check backend CLI is installed
    await this.driver.checkVersion();
    this.addLog(`Backend: ${this.config.backend} (verified)`);

    // Parse plan directory
    const planDir = path.resolve(this.config.startCwd, this.config.planDir);
    const sections = parsePlanDir(planDir);

    // Validate
    const validation = validatePlan(sections);
    for (const warn of validation.warnings) {
      this.addLog(`Warning: ${warn.file}: ${warn.message}`);
    }
    if (!validation.valid) {
      throw new Error(`Plan validation failed:\n${validation.errors.join('\n')}`);
    }

    // Initialize section snapshots
    this.snapshot.sections = sections.map((s) => ({
      id: s.slug,
      index: s.index,
      title: s.title,
      slug: s.slug,
      status: 'pending',
      filesChanged: 0,
      tokenUsage: { ...EMPTY_USAGE },
      chatState: 'idle',
    }));

    // Create output streams per section
    for (const s of sections) {
      this.outputStreams.set(s.slug, new SectionOutputStream());
    }

    this.addLog(`Parsed ${sections.length} sections from ${planDir}`);
    this.emitSnapshotNow();

    // Store sections for later
    (this as unknown as { _sections: PlanSection[] })._sections = sections;
  }

  /* ── Phase: WORKTREE_SETUP ── */

  private async phaseWorktreeSetup(): Promise<void> {
    this.setPhase('worktree_setup', 'Setting up shared worktree...');
    this.worktreeManager = new WorktreeManager(this.repoRoot, this.runId);

    const sections = (this as unknown as { _sections: PlanSection[] })._sections;

    // Create one shared integration worktree for all sections.
    const integration = await this.worktreeManager.create('integration', this.baseBranch);
    this.snapshot.integrationBranch = integration.branch;
    this.addLog(`Integration branch: ${integration.branch}`);

    for (const section of sections) {
      this.updateSection(section.slug, {
        branch: integration.branch,
        worktreePath: integration.path,
      });
    }

    this.addLog(`Shared workspace: ${integration.path}`);
    this.addLog(`Queued ${sections.length} sections in shared workspace`);
    this.emitSnapshotNow();
  }

  /* ── Phase: EXECUTING ── */

  private async phaseExecuting(): Promise<void> {
    this.setPhase('executing', 'Running sections concurrently in shared workspace...');
    const sections = (this as unknown as { _sections: PlanSection[] })._sections;

    this.addLog(`Launching ${sections.length} agents concurrently in shared workspace`);

    const results = await Promise.all(
      sections.map(async (section) => ({
        sectionId: section.slug,
        ok: await this.executeSection(section, sections),
      })),
    );

    const completed = results.filter((r) => r.ok).length;
    const failed = results.length - completed;

    this.addLog(`Execution complete: ${completed} succeeded, ${failed} failed`);

    if (completed === 0) {
      throw new Error('All sections failed during execution');
    }
  }

  private async executeSection(section: PlanSection, allSections: PlanSection[]): Promise<boolean> {
    const sectionSnap = this.snapshot.sections.find((s) => s.id === section.slug);
    if (!sectionSnap?.worktreePath) return false;
    const worktreePath = sectionSnap.worktreePath;

    this.updateSection(section.slug, { status: 'running', startedAt: nowIso() });

    try {
      const prompt = this.buildSectionPrompt(section, allSections);
      let sessionId = sectionSnap.sessionId;

      for (let attempt = 1; attempt <= MAX_SECTION_ATTEMPTS; attempt += 1) {
        if (attempt > 1) {
          this.addLog(`Retrying "${section.title}" (${attempt}/${MAX_SECTION_ATTEMPTS})...`);
          await sleep(RETRY_BACKOFF_MS * (attempt - 1));
        }

        const result = await this.runAgent(section.slug, worktreePath, prompt, {
          sessionId,
        });

        if (result.sessionId) {
          sessionId = result.sessionId;
          this.updateSection(section.slug, { sessionId });
        }

        const committed = await this.withGitMutationLock(() =>
          this.worktreeManager.commitIfDirty(
            worktreePath,
            `aeon: ${section.title}`,
          ),
        );

        if (result.timedOut) {
          const timeoutLabel =
            result.timeoutReason === 'overall' ? 'overall timeout' : 'inactivity timeout';

          if (attempt < MAX_SECTION_ATTEMPTS) {
            sessionId = undefined;
            this.addLog(`Section "${section.title}" hit ${timeoutLabel}; retrying`);
            continue;
          }

          this.updateSection(section.slug, {
            status: 'failed',
            error: timeoutLabel,
            endedAt: nowIso(),
            lastMessage: result.lastMessage,
          });
          this.addLog(`Section "${section.title}" failed (${timeoutLabel})`);
          return false;
        }

        if (result.exitCode !== 0 && !committed) {
          const stderrTail = this.getStderrTail(result.stderr);
          if (attempt < MAX_SECTION_ATTEMPTS) {
            sessionId = undefined;
            this.addLog(
              `Section "${section.title}" exited ${result.exitCode}; retrying` +
              (stderrTail ? ` (${stderrTail})` : ''),
            );
            continue;
          }

          this.updateSection(section.slug, {
            status: 'failed',
            error: stderrTail
              ? `exit ${result.exitCode}: ${stderrTail}`
              : `exit ${result.exitCode}`,
            endedAt: nowIso(),
            lastMessage: result.lastMessage,
          });
          this.addLog(`Section "${section.title}" failed (exit ${result.exitCode})`);
          return false;
        }

        const filesChanged = committed
          ? await this.withGitMutationLock(() =>
            this.worktreeManager.countChangedFiles(worktreePath),
          )
          : 0;

        if (result.exitCode !== 0 && committed) {
          this.addLog(
            `Section "${section.title}" exited ${result.exitCode} but produced commit; continuing`,
          );
        }

        this.updateSection(section.slug, {
          status: 'completed',
          filesChanged,
          endedAt: nowIso(),
          sessionId,
          chatState: 'idle',
          chatError: undefined,
          lastMessage: result.lastMessage,
        });
        this.addLog(`Section "${section.title}" completed (${filesChanged} files changed)`);
        return true;
      }

      this.updateSection(section.slug, {
        status: 'failed',
        error: 'exhausted retries',
        endedAt: nowIso(),
      });
      this.addLog(`Section "${section.title}" failed after retries`);
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateSection(section.slug, { status: 'failed', error: message, endedAt: nowIso() });
      this.addLog(`Section "${section.title}" error: ${message}`);
      return false;
    }
  }

  private buildSectionPrompt(section: PlanSection, allSections: PlanSection[]): string {
    const parts: string[] = [];
    parts.push(`# Task: ${section.title}\n`);
    parts.push(section.body);

    const otherSections = allSections.filter((s) => s.slug !== section.slug);
    if (otherSections.length > 0) {
      parts.push('\n## Parallel Context');
      parts.push('Other agents are running right now in the same branch/worktree:');
      for (const other of otherSections) {
        parts.push(`- [${other.index + 1}] ${other.title}`);
      }
    }

    if (section.acceptance.length > 0) {
      parts.push('\n## Acceptance Criteria');
      for (const criterion of section.acceptance) {
        parts.push(`- ${criterion}`);
      }
    }

    if (section.files.length > 0) {
      parts.push('\n## Files to focus on');
      for (const f of section.files) {
        parts.push(`- ${f}`);
      }
    }

    parts.push('\n## Rules');
    parts.push('- Write code directly. Do not ask questions.');
    parts.push('- Agents are running concurrently in this same branch/worktree.');
    parts.push('- Coordinate passively: expect neighboring files to change while you work.');
    parts.push('- Never undo or rewrite unrelated changes from other agents.');
    parts.push('- Re-read a file before final edits if it may be touched by another section.');
    parts.push('- Commit is not needed — changes will be auto-committed after your run.');
    parts.push('- Focus only on the task described above.');

    return parts.join('\n');
  }

  private async withGitMutationLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.gitMutationLock;
    let release: () => void = () => {};
    this.gitMutationLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private runAgent(
    sectionId: string,
    cwd: string,
    prompt: string,
    opts?: RunAgentOptions,
  ): Promise<AgentExecResult> {
    if (this.driver.execute) {
      return this.runAgentSdk(sectionId, cwd, prompt, opts);
    }
    return this.runAgentSpawn(sectionId, cwd, prompt, opts);
  }

  /** SDK-based execution — uses the driver's streaming SDK for real-time events. */
  private runAgentSdk(
    sectionId: string,
    cwd: string,
    prompt: string,
    opts?: RunAgentOptions,
  ): Promise<AgentExecResult> {
    const controller = new AbortController();
    const outputStream = this.outputStreams.get(sectionId);

    // Timeout handling via AbortController
    let timedOut = false;
    let timeoutReason: 'overall' | 'inactivity' | undefined;

    let overallTimer: ReturnType<typeof setTimeout> | null = null;
    if (this.config.timeoutMs > 0) {
      overallTimer = setTimeout(() => {
        if (timedOut) return;
        timedOut = true;
        timeoutReason = 'overall';
        this.addLog(`Killing agent for "${sectionId}": overall timeout`);
        controller.abort();
      }, this.config.timeoutMs);
    }

    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const resetInactivity = () => {
      if (this.config.inactivityTimeoutMs <= 0) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        if (timedOut) return;
        timedOut = true;
        timeoutReason = 'inactivity';
        this.addLog(`Killing agent for "${sectionId}": inactivity timeout`);
        controller.abort();
      }, this.config.inactivityTimeoutMs);
    };

    if (this.config.inactivityTimeoutMs > 0) {
      resetInactivity();
    }

    return this.driver.execute!(
      {
        yolo: true,
        model: this.config.model,
        prompt,
        cwd,
        sessionId: opts?.sessionId,
      },
      {
        onEvent: (event) => {
          resetInactivity();

          if (event.sessionId) {
            this.updateSection(sectionId, { sessionId: event.sessionId });
          }
          if (event.tokenIncrement) {
            this.addSectionUsage(sectionId, event.tokenIncrement);
          }
          if (event.message) {
            this.updateSection(sectionId, { lastMessage: event.message });
          }
          if (event.displayLines?.length) {
            for (const line of event.displayLines) {
              outputStream?.push(line, 'stdout');
            }
          }
        },
        onOutput: (line, source) => {
          resetInactivity();
          outputStream?.push(line, source);
        },
      },
      controller.signal,
    ).then((result) => {
      if (overallTimer) clearTimeout(overallTimer);
      if (inactivityTimer) clearTimeout(inactivityTimer);

      if (timedOut) {
        return { ...result, timedOut: true, timeoutReason };
      }
      return result;
    });
  }

  /** Spawn-based execution — parses stdout JSON lines from the CLI process. */
  private runAgentSpawn(
    sectionId: string,
    cwd: string,
    prompt: string,
    opts?: RunAgentOptions,
  ): Promise<AgentExecResult> {
    return new Promise((resolve) => {
      const { command, args } = this.driver.buildArgs({
        yolo: true,
        model: this.config.model,
        prompt,
        cwd,
        sessionId: opts?.sessionId,
      });

      const r = resolveSpawn(command, args);
      const child: ChildProcess = spawn(r.command, r.args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: r.command.toLowerCase().endsWith('.cmd'),
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      const usage: TokenUsage = { ...EMPTY_USAGE };
      let lastMessage: string | undefined;
      let sessionId: string | undefined = opts?.sessionId;
      let stderr = '';
      let timedOut = false;
      let timeoutReason: 'overall' | 'inactivity' | undefined;
      let buffered = '';
      const startMs = Date.now();

      // Timeout handling
      const killChild = (reason: 'overall' | 'inactivity') => {
        if (timedOut) return;
        timedOut = true;
        timeoutReason = reason;
        this.addLog(
          `Killing agent for "${sectionId}": ` +
          (reason === 'overall' ? 'overall timeout' : 'inactivity timeout'),
        );
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000);
      };

      let overallTimer: ReturnType<typeof setTimeout> | null = null;
      const overallEnabled = this.config.timeoutMs > 0;
      if (overallEnabled) {
        overallTimer = setTimeout(
          () => killChild('overall'),
          this.config.timeoutMs,
        );
      }

      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      const inactivityEnabled = this.config.inactivityTimeoutMs > 0;
      if (inactivityEnabled) {
        inactivityTimer = setTimeout(
          () => killChild('inactivity'),
          this.config.inactivityTimeoutMs,
        );
      }

      const resetInactivity = () => {
        if (!inactivityEnabled) return;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => killChild('inactivity'), this.config.inactivityTimeoutMs);
      };

      const outputStream = this.outputStreams.get(sectionId);

      child.stdout?.on('data', (chunk: Buffer) => {
        resetInactivity();
        buffered += chunk.toString();

        let newlineIdx: number;
        while ((newlineIdx = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newlineIdx).trim();
          buffered = buffered.slice(newlineIdx + 1);
          if (!line) continue;

          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const result = this.driver.parseStdoutLine(parsed);

            if (result.sessionId && result.sessionId !== sessionId) {
              sessionId = result.sessionId;
              this.updateSection(sectionId, { sessionId });
            }

            if (result.tokenIncrement) {
              usage.input += result.tokenIncrement.input;
              usage.cachedInput += result.tokenIncrement.cachedInput;
              usage.output += result.tokenIncrement.output;
              this.addSectionUsage(sectionId, result.tokenIncrement);
            }

            if (result.displayLines && result.displayLines.length > 0) {
              for (const displayLine of result.displayLines) {
                outputStream?.push(displayLine, 'stdout');
              }
            }

            if (result.message) {
              lastMessage = result.message;
              this.updateSection(sectionId, { lastMessage });
            }
          } catch {
            // Not JSON — treat as plain text message
            if (line.length > 0) {
              outputStream?.push(line, 'stdout');
              lastMessage = line.length > 200 ? line.slice(0, 200) + '...' : line;
              this.updateSection(sectionId, { lastMessage });
            }
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        resetInactivity();
        const text = chunk.toString();
        stderr += text;
        outputStream?.pushLines(text, 'stderr');
      });

      child.on('close', (code) => {
        if (overallTimer) clearTimeout(overallTimer);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        resolve({
          exitCode: code ?? 1,
          usage,
          timedOut,
          timeoutReason,
          durationMs: Date.now() - startMs,
          lastMessage,
          sessionId,
          stderr,
        });
      });

      child.on('error', (err) => {
        if (overallTimer) clearTimeout(overallTimer);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        resolve({
          exitCode: 1,
          usage,
          timedOut: false,
          durationMs: Date.now() - startMs,
          lastMessage: err.message,
          sessionId,
          stderr: err.message,
        });
      });
    });
  }

  /* ── Phase: MERGING ── */

  private async phaseMerging(): Promise<void> {
    this.setPhase('merging', 'Finalizing shared workspace...');
    this.addLog('Shared workspace mode: section merge step is not required');
  }

  private async phaseConsolidateWorktrees(): Promise<void> {
    if (!this.worktreeManager) return;
    this.addLog('Consolidating shared integration worktree...');
    await this.worktreeManager.cleanupSectionWorktrees();
  }

  /* ── Phase: DONE ── */

  private phaseDone(): void {
    const completed = this.snapshot.sections.filter((s) => s.status === 'completed').length;
    const failed = this.snapshot.sections.filter((s) => s.status === 'failed').length;
    const total = this.snapshot.sections.length;
    this.setPhase(
      'done',
      failed > 0
        ? `Completed ${completed}/${total} sections (${failed} failed)`
        : `Completed ${completed}/${total} sections`,
    );
    this.snapshot.failed = failed > 0;
    if (failed > 0) {
      this.snapshot.error = `${failed} section(s) failed`;
    }
    this.snapshot.done = true;
    this.emitSnapshotNow();
  }

  /* ── State management ── */

  private setPhase(phase: Phase, message: string): void {
    this.snapshot.phase = phase;
    this.snapshot.statusMessage = message;
    this.snapshot.lastUpdatedAt = nowIso();
    this.emitSnapshot();
  }

  private updateSection(id: string, patch: Partial<SectionSnapshot>): void {
    const section = this.snapshot.sections.find((s) => s.id === id);
    if (section) {
      Object.assign(section, patch);
      this.snapshot.lastUpdatedAt = nowIso();
      this.emitSnapshot();
    }
  }

  private addSectionUsage(id: string, increment: TokenUsage): void {
    const section = this.snapshot.sections.find((s) => s.id === id);
    if (section) {
      section.tokenUsage = addUsage(section.tokenUsage, increment);
      this.snapshot.tokenUsage = addUsage(this.snapshot.tokenUsage, increment);
      this.emitSnapshot();
    }
  }

  private getStderrTail(stderr: string): string {
    const compact = stderr.replace(/\s+/g, ' ').trim();
    if (compact.length <= STDERR_TAIL_LEN) return compact;
    return `...${compact.slice(-STDERR_TAIL_LEN)}`;
  }

  private addLog(message: string): void {
    this.snapshot.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    this.emitSnapshot();
  }

  /* ── Snapshot emission (throttled) ── */

  private cloneSnapshot(): RunSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot)) as RunSnapshot;
  }

  private emitSnapshot(): void {
    const now = Date.now();
    if (now - this.lastEmitTime >= 250) {
      this.lastEmitTime = now;
      this.flushSnapshot();
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => this.flushSnapshot(), 250 - (now - this.lastEmitTime));
    }
  }

  private emitSnapshotNow(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.lastEmitTime = Date.now();
    this.flushSnapshot();
  }

  private flushSnapshot(): void {
    this.emitTimer = null;
    const clone = this.cloneSnapshot();
    for (const listener of this.listeners) {
      listener(clone);
    }
  }

  /* ── Persistence ── */

  private persistResults(): void {
    try {
      const runsDir = path.join(this.repoRoot || this.config.startCwd, '.aeon', 'runs', this.runId);
      fs.mkdirSync(runsDir, { recursive: true });
      const resultsPath = path.join(runsDir, 'results.json');
      fs.writeFileSync(resultsPath, JSON.stringify(this.cloneSnapshot(), null, 2));
      this.addLog(`Results saved to ${resultsPath}`);
    } catch {
      // Non-fatal
    }
  }
}
