/* ── Ore theme — quiet stone, occasional gold, cyan accents ── */

import type { Phase, SectionStatus } from '../types.js';

/* ── Backgrounds ── */

export const BG = {
  void: '#0C0C0F',
  obsidian: '#111114',
  stone: '#1A1A1F',
  ember: '#1E1C17',
} as const;

/* ── Accents ── */

export const GLOW = {
  gold: '#C8A84E',
  goldDim: '#8B7535',
  taupe: '#9B8A70',
  taupeDim: '#6B5D4A',
  cyan: '#00FFCC',
  cyanDim: '#00B899',
  purple: '#B388FF',
  purpleDim: '#7C5CBF',
} as const;

/* ── Status ── */

export const STATUS = {
  success: '#7DAA5C',
  error: '#C9534A',
  warning: '#D4A035',
  muted: '#505058',
  text: '#C8C4BC',
} as const;

/* ── Spinner ── */

export const SPINNER_FRAMES = ['·', '•', '●', '•'];
export const RUNE_SPINNER_FRAMES = ['ᚠ', 'ᚨ', 'ᛊ', 'ᛟ', 'ᚲ', 'ᛏ'];
export const TICK_INTERVAL_MS = 300;

/* ── Scroll indicators ── */

export const SCROLL_INDICATOR = {
  up: '↑',
  down: '↓',
} as const;

/* ── Section status ── */

export const STATUS_ICONS: Record<SectionStatus, string> = {
  pending: '○',
  running: '●',
  completed: '✓',
  failed: '✗',
  skipped: '–',
  merge_conflict: '!',
};

export const STATUS_LABELS: Record<SectionStatus, string> = {
  pending: 'wait',
  running: 'run',
  completed: 'done',
  failed: 'fail',
  skipped: 'skip',
  merge_conflict: 'rift',
};

export const STATUS_COLORS: Record<SectionStatus, string> = {
  pending: STATUS.muted,
  running: GLOW.gold,
  completed: STATUS.success,
  failed: STATUS.error,
  skipped: STATUS.warning,
  merge_conflict: STATUS.warning,
};

/* ── Phase pipeline ── */

export const PHASE_ORDER = ['parsing', 'worktree_setup', 'executing', 'merging', 'done'] as const;

export const PHASE_LABEL: Record<string, string> = {
  idle: 'idle',
  parsing: 'parse',
  worktree_setup: 'setup',
  executing: 'forge',
  merging: 'merge',
  done: 'done',
  error: 'error',
};

export const BACKEND_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/* ── Context window limits (tokens) ── */

export const CONTEXT_LIMITS: Record<string, number> = {
  // Codex (OpenAI) — default model is o4-mini
  'codex': 200_000,
  'o4-mini': 200_000,
  'o3': 200_000,
  'o3-pro': 200_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  // Claude Code
  'claude-code': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // OpenCode — typically wraps various models
  'opencode': 200_000,
};

/** Look up context window size for a backend/model combo */
export function getContextLimit(backend: string, model?: string): number {
  if (model && CONTEXT_LIMITS[model]) return CONTEXT_LIMITS[model];
  return CONTEXT_LIMITS[backend] ?? 200_000;
}

/* ── Bar chart characters ── */

export const BAR = {
  full: '█',
  seven: '▉',
  six: '▊',
  five: '▋',
  four: '▌',
  three: '▍',
  two: '▎',
  one: '▏',
  empty: '░',
} as const;

/* ── Dynamic glow helpers ── */

/** Alternates between bright and dim cyan based on tick */
export function glowCyan(tick: number): string {
  return tick % 2 === 0 ? GLOW.cyan : GLOW.cyanDim;
}

/** Animated rune divider line */
export function runeDivider(width: number, tick: number): string {
  const runes = '━ᚨ━ᛊ━ᛟ━';
  const offset = tick % runes.length;
  const shifted = runes.slice(offset) + runes.slice(0, offset);
  return shifted.repeat(Math.ceil(width / runes.length)).slice(0, width);
}
