/* ── Core types for Aeon parallel agent orchestrator ── */

export type Backend = 'codex' | 'claude-code' | 'opencode';

export type Phase =
  | 'idle'
  | 'parsing'
  | 'worktree_setup'
  | 'executing'
  | 'merging'
  | 'done'
  | 'error';

export type SectionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'merge_conflict';

export interface TokenUsage {
  input: number;
  cachedInput: number;
  output: number;
}

export interface ParsedBackendEvent {
  tokenIncrement?: TokenUsage;
  message?: string;
  sessionId?: string;
  displayLines?: string[];
}

export interface PlanSection {
  /** Filename (e.g. "01-auth-system.md") */
  filename: string;
  /** Index in sorted order (0-based) */
  index: number;
  /** Frontmatter title */
  title: string;
  /** Glob patterns of files this section touches */
  files: string[];
  /** Acceptance criteria */
  acceptance: string[];
  /** Markdown body (agent prompt) */
  body: string;
  /** URL-safe slug derived from filename */
  slug: string;
}

export interface SectionSnapshot {
  id: string;
  index: number;
  title: string;
  slug: string;
  status: SectionStatus;
  filesChanged: number;
  tokenUsage: TokenUsage;
  lastMessage?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  branch?: string;
  worktreePath?: string;
  sessionId?: string;
  chatState?: 'idle' | 'sending' | 'error';
  chatError?: string;
}

export interface RunSnapshot {
  runId: string;
  phase: Phase;
  statusMessage: string;
  startedAt: string;
  lastUpdatedAt: string;
  done: boolean;
  failed: boolean;
  error?: string;
  backend: Backend;
  model?: string;
  repoRoot: string;
  baseBranch: string;
  planDir: string;
  integrationBranch?: string;
  sections: SectionSnapshot[];
  tokenUsage: TokenUsage;
  logs: string[];
}

export interface RunResult {
  success: boolean;
  runId: string;
  integrationBranch?: string;
  sectionsCompleted: number;
  sectionsTotal: number;
  error?: string;
}

export interface OrchestratorConfig {
  planDir: string;
  startCwd: string;
  backend: Backend;
  model?: string;
  cleanup: boolean;
  timeoutMs: number;
  inactivityTimeoutMs: number;
}

export interface BackendDriverInput {
  yolo: boolean;
  model?: string;
  prompt: string;
  cwd: string;
  sessionId?: string;
}

export interface BackendDriverCallbacks {
  onEvent: (event: ParsedBackendEvent) => void;
  onOutput: (line: string, source: 'stdout' | 'stderr') => void;
}

export interface BackendDriver {
  checkVersion(): Promise<void>;
  buildArgs(input: BackendDriverInput): { command: string; args: string[] };
  parseStdoutLine(parsed: Record<string, unknown>): ParsedBackendEvent;
  /** SDK-based execution — if present, the orchestrator uses this instead of spawn+parse. */
  execute?(
    input: BackendDriverInput,
    callbacks: BackendDriverCallbacks,
    signal: AbortSignal,
  ): Promise<AgentExecResult>;
}

export interface AgentExecResult {
  exitCode: number;
  usage: TokenUsage;
  timedOut: boolean;
  timeoutReason?: 'overall' | 'inactivity';
  durationMs: number;
  lastMessage?: string;
  sessionId?: string;
  stderr: string;
}

/* ── TUI types ── */

export type ViewMode = 'overview' | 'detail' | 'split';

export interface OutputLine {
  id: number;
  text: string;
  timestamp: number;
  source: 'stdout' | 'stderr';
}

export interface PaneState {
  id: string;
  content: PaneContent;
  scrollOffset: number;
  autoScroll: boolean;
}

export type PaneContent =
  | { type: 'overview' }
  | { type: 'agent'; sectionId: string };

export type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; ratio: number; first: LayoutNode; second: LayoutNode };

export interface ValidationWarning {
  file: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  sections: PlanSection[];
  errors: string[];
  warnings: ValidationWarning[];
}
