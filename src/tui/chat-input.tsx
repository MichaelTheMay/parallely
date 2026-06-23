/* ── ChatInput: multi-feature chat input bar for agent messaging ── */

import { BG, GLOW, STATUS, SPINNER_FRAMES, TICK_INTERVAL_MS } from './theme.js';
import { useTimer } from './hooks.js';

export interface ChatInputState {
  active: boolean;
  sectionId?: string;
  sectionLabel?: string;
  draft: string;
  cursor: number;
  sending: boolean;
  error?: string;
  history: string[];
  historyIndex: number;
}

export const INITIAL_CHAT_STATE: ChatInputState = {
  active: false,
  sectionId: undefined,
  sectionLabel: undefined,
  draft: '',
  cursor: 0,
  sending: false,
  error: undefined,
  history: [],
  historyIndex: -1,
};

export function openChat(sectionId: string, sectionLabel: string, prev: ChatInputState): ChatInputState {
  return {
    ...prev,
    active: true,
    sectionId,
    sectionLabel,
    draft: '',
    cursor: 0,
    sending: false,
    error: undefined,
    historyIndex: -1,
  };
}

export function closeChat(prev: ChatInputState): ChatInputState {
  return { ...prev, active: false, draft: '', cursor: 0, sending: false, error: undefined, historyIndex: -1 };
}

export function chatSending(prev: ChatInputState): ChatInputState {
  return { ...prev, sending: true, error: undefined };
}

export function chatSent(prev: ChatInputState): ChatInputState {
  const history = prev.draft.trim() ? [...prev.history, prev.draft.trim()] : prev.history;
  return { ...INITIAL_CHAT_STATE, history };
}

export function chatError(prev: ChatInputState, message: string): ChatInputState {
  return { ...prev, sending: false, error: message };
}

/** Handle a key event, returns updated state or null if not handled */
export function handleChatKey(
  state: ChatInputState,
  key: { name: string; ctrl: boolean; meta: boolean; shift: boolean },
): ChatInputState | null {
  if (state.sending) return null;

  // Cursor movement
  if (key.name === 'left' && !key.ctrl && !key.meta) {
    return { ...state, cursor: Math.max(0, state.cursor - 1), error: undefined };
  }
  if (key.name === 'right' && !key.ctrl && !key.meta) {
    return { ...state, cursor: Math.min(state.draft.length, state.cursor + 1), error: undefined };
  }

  // Word jump: Ctrl+Left / Ctrl+Right
  if (key.name === 'left' && (key.ctrl || key.meta)) {
    let pos = state.cursor;
    while (pos > 0 && state.draft[pos - 1] === ' ') pos--;
    while (pos > 0 && state.draft[pos - 1] !== ' ') pos--;
    return { ...state, cursor: pos, error: undefined };
  }
  if (key.name === 'right' && (key.ctrl || key.meta)) {
    let pos = state.cursor;
    while (pos < state.draft.length && state.draft[pos] !== ' ') pos++;
    while (pos < state.draft.length && state.draft[pos] === ' ') pos++;
    return { ...state, cursor: pos, error: undefined };
  }

  // Home / End
  if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
    return { ...state, cursor: 0, error: undefined };
  }
  if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
    return { ...state, cursor: state.draft.length, error: undefined };
  }

  // Backspace
  if (key.name === 'backspace' || key.name === 'delete') {
    if (state.cursor === 0) return state;
    const before = state.draft.slice(0, state.cursor - 1);
    const after = state.draft.slice(state.cursor);
    return { ...state, draft: before + after, cursor: state.cursor - 1, error: undefined };
  }

  // Ctrl+W: delete word backward
  if (key.ctrl && key.name === 'w') {
    let pos = state.cursor;
    while (pos > 0 && state.draft[pos - 1] === ' ') pos--;
    while (pos > 0 && state.draft[pos - 1] !== ' ') pos--;
    const before = state.draft.slice(0, pos);
    const after = state.draft.slice(state.cursor);
    return { ...state, draft: before + after, cursor: pos, error: undefined };
  }

  // Ctrl+U: clear line
  if (key.ctrl && key.name === 'u') {
    return { ...state, draft: '', cursor: 0, error: undefined };
  }

  // Ctrl+K: delete to end
  if (key.ctrl && key.name === 'k') {
    return { ...state, draft: state.draft.slice(0, state.cursor), error: undefined };
  }

  // History: Up/Down
  if (key.name === 'up' && state.history.length > 0) {
    const newIdx = state.historyIndex < 0
      ? state.history.length - 1
      : Math.max(0, state.historyIndex - 1);
    const draft = state.history[newIdx] ?? '';
    return { ...state, draft, cursor: draft.length, historyIndex: newIdx, error: undefined };
  }
  if (key.name === 'down') {
    if (state.historyIndex < 0) return state;
    const newIdx = state.historyIndex + 1;
    if (newIdx >= state.history.length) {
      return { ...state, draft: '', cursor: 0, historyIndex: -1, error: undefined };
    }
    const draft = state.history[newIdx] ?? '';
    return { ...state, draft, cursor: draft.length, historyIndex: newIdx, error: undefined };
  }

  // Printable characters
  if (key.name.length === 1 && !key.ctrl && !key.meta) {
    const before = state.draft.slice(0, state.cursor);
    const after = state.draft.slice(state.cursor);
    return {
      ...state,
      draft: before + key.name + after,
      cursor: state.cursor + 1,
      error: undefined,
      historyIndex: -1,
    };
  }

  // Space (sometimes key.name is 'space')
  if (key.name === 'space') {
    const before = state.draft.slice(0, state.cursor);
    const after = state.draft.slice(state.cursor);
    return {
      ...state,
      draft: before + ' ' + after,
      cursor: state.cursor + 1,
      error: undefined,
      historyIndex: -1,
    };
  }

  return null;
}

/* ── Visual component ── */

interface ChatInputBarProps {
  state: ChatInputState;
  termWidth: number;
  /** Extra height rows for the input (1 = single line, 3 = with context) */
  height?: number;
}

export function ChatInputBar({ state, termWidth, height = 3 }: ChatInputBarProps): JSX.Element {
  const tick = useTimer(TICK_INTERVAL_MS);

  if (!state.active) return <box />;

  const target = state.sectionLabel ?? state.sectionId ?? '';
  const promptPrefix = state.sending ? '  sending...' : `  ${target} ›`;
  const cursorChar = tick % 2 === 0 ? '▍' : ' ';

  // Render the draft with a visible cursor
  const maxDraftWidth = Math.max(1, termWidth - promptPrefix.length - 6);
  let visibleDraft: string;
  let visibleCursor: number;

  if (state.draft.length <= maxDraftWidth) {
    visibleDraft = state.draft;
    visibleCursor = state.cursor;
  } else {
    // Scroll the view to keep cursor visible
    const scrollStart = Math.max(0, state.cursor - maxDraftWidth + 4);
    visibleDraft = state.draft.slice(scrollStart, scrollStart + maxDraftWidth);
    visibleCursor = state.cursor - scrollStart;
  }

  const beforeCursor = visibleDraft.slice(0, visibleCursor);
  const afterCursor = visibleDraft.slice(visibleCursor);

  const hints = state.sending
    ? ''
    : state.error
      ? state.error
      : state.history.length > 0
        ? 'Enter send  Esc cancel  ↑↓ history'
        : 'Enter send  Esc cancel';

  const hintGap = Math.max(0, termWidth - promptPrefix.length - visibleDraft.length - hints.length - 6);

  return (
    <box flexDirection="column" width={termWidth}>
      {/* Separator */}
      <box paddingLeft={1} paddingRight={1}>
        <text fg={GLOW.taupeDim}>{'─'.repeat(Math.max(1, termWidth - 2))}</text>
      </box>

      {/* Input row */}
      <box backgroundColor={BG.obsidian} paddingLeft={0} paddingRight={1}>
        <text>
          <span fg={state.sending ? STATUS.muted : GLOW.gold}>{promptPrefix} </span>
          <span fg={STATUS.text}>{beforeCursor}</span>
          {!state.sending && <span fg={GLOW.gold}>{cursorChar}</span>}
          <span fg={STATUS.text}>{afterCursor}</span>
          {' '.repeat(Math.max(0, hintGap))}
          <span fg={state.error ? STATUS.error : STATUS.muted}>{hints}</span>
        </text>
      </box>

      {/* Spinner row when sending */}
      {state.sending && (
        <box backgroundColor={BG.obsidian} paddingLeft={2}>
          <text fg={GLOW.gold}>
            {SPINNER_FRAMES[tick % SPINNER_FRAMES.length]} agent is responding...
          </text>
        </box>
      )}
    </box>
  );
}
