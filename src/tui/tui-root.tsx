/* ── AeonTui: root component for the fullscreen TUI ── */

import { useEffect, useReducer, useState } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';
import type { RunSnapshot } from '../types.js';
import type { AeonOrchestrator } from '../orchestrator.js';
import { useTerminalSize } from './hooks.js';
import { tuiReducer, createInitialState } from './tui-state.js';
import { OverviewScreen } from './overview.js';
import { DetailScreen } from './detail.js';
import { SplitScreen } from './split.js';
import { StatusBar } from './status-bar.js';
import { HelpOverlay } from './help.js';
import { ChatInputBar, INITIAL_CHAT_STATE, openChat, closeChat, chatSending, chatSent, chatError, handleChatKey } from './chat-input.js';
import type { ChatInputState } from './chat-input.js';
import { BG } from './theme.js';

interface AeonTuiProps {
  orchestrator: AeonOrchestrator;
}

export function AeonTui({ orchestrator }: AeonTuiProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<RunSnapshot>(orchestrator.getSnapshot());
  const [state, dispatch] = useReducer(tuiReducer, undefined, createInitialState);
  const [chat, setChat] = useState<ChatInputState>(INITIAL_CHAT_STATE);
  const { columns, rows } = useTerminalSize();
  const renderer = useRenderer();

  // Subscribe to orchestrator snapshots
  useEffect(() => {
    return orchestrator.subscribe(setSnapshot);
  }, [orchestrator]);

  // Keep section count in sync
  useEffect(() => {
    if (snapshot.sections.length !== state.sectionCount) {
      dispatch({ type: 'SET_SECTION_COUNT', count: snapshot.sections.length });
    }
  }, [snapshot.sections.length, state.sectionCount]);

  const activateChat = (sectionId: string): void => {
    const section = snapshot.sections.find((s) => s.id === sectionId);
    const label = section ? `[${section.index + 1}] ${section.title}` : sectionId;
    setChat((prev) => openChat(sectionId, label, prev));
  };

  const sendMessage = (): void => {
    if (!chat.sectionId || chat.sending) return;
    const trimmed = chat.draft.trim();
    if (!trimmed) {
      setChat((prev) => chatError(prev, 'empty message'));
      return;
    }

    setChat((prev) => chatSending(prev));

    void orchestrator
      .sendMessage(chat.sectionId, trimmed)
      .then(() => {
        setChat((prev) => chatSent(prev));
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setChat((prev) => chatError(prev, message));
      });
  };

  // Handle keyboard input
  useKeyboard((key) => {
    // ── Chat input mode ──
    if (chat.active) {
      if (key.name === 'escape') {
        setChat((prev) => closeChat(prev));
        return;
      }
      if (key.name === 'return') {
        sendMessage();
        return;
      }
      const updated = handleChatKey(chat, key);
      if (updated) setChat(updated);
      return;
    }

    // ── Global: quit ──
    if (key.name === 'q' && !key.ctrl && !key.meta && !state.showHelp) {
      renderer.destroy();
      return;
    }

    // ── Global: toggle help ──
    if (key.name === '?' || (key.name === '/' && key.shift)) {
      dispatch({ type: 'TOGGLE_HELP' });
      return;
    }

    if (state.showHelp) return;

    const sections = snapshot.sections;

    // ── Overview mode ──
    if (state.mode === 'overview') {
      if (key.name === 'j' || key.name === 'down') {
        dispatch({ type: 'SELECT_SECTION', delta: 1 });
        return;
      }
      if (key.name === 'k' || key.name === 'up') {
        dispatch({ type: 'SELECT_SECTION', delta: -1 });
        return;
      }
      if (key.name === 'return') {
        const section = sections[state.selectedSectionIndex];
        if (section) dispatch({ type: 'ENTER_DETAIL', sectionId: section.id });
        return;
      }
      if (key.name === 's' && !key.ctrl && !key.meta) {
        const section = sections[state.selectedSectionIndex];
        if (section) dispatch({ type: 'ENTER_SPLIT', sectionId: section.id });
        return;
      }
      const num = Number.parseInt(key.name, 10);
      if (num >= 1 && num <= 9) {
        dispatch({ type: 'SELECT_SECTION_INDEX', index: num - 1 });
      }
      return;
    }

    // ── Detail mode ──
    if (state.mode === 'detail') {
      if (key.name === 'escape') {
        dispatch({ type: 'ENTER_OVERVIEW' });
        return;
      }
      if (key.name === 'j' || key.name === 'down') {
        dispatch({ type: 'SCROLL', delta: -1 });
        return;
      }
      if (key.name === 'k' || key.name === 'up') {
        dispatch({ type: 'SCROLL', delta: 1 });
        return;
      }
      if (key.name === 'd' && !key.ctrl && !key.meta) {
        dispatch({ type: 'PAGE_SCROLL', delta: -1, pageSize: rows });
        return;
      }
      if (key.name === 'u' && !key.ctrl && !key.meta) {
        dispatch({ type: 'PAGE_SCROLL', delta: 1, pageSize: rows });
        return;
      }
      if (key.name === 'g' && !key.ctrl && !key.meta && !key.shift) {
        dispatch({ type: 'SCROLL_TO_TOP' });
        return;
      }
      if (key.name === 'G' || (key.name === 'g' && key.shift)) {
        dispatch({ type: 'SCROLL_TO_BOTTOM' });
        return;
      }
      if (key.name === 'f' && !key.ctrl && !key.meta) {
        dispatch({ type: 'TOGGLE_AUTO_SCROLL' });
        return;
      }
      if (key.name === 'i' && !key.ctrl && !key.meta) {
        const pane = state.panes.get(state.focusedPaneId);
        if (pane?.content.type === 'agent') activateChat(pane.content.sectionId);
        return;
      }
      if (key.name === '[' || key.name === ']') {
        const pane = state.panes.get(state.focusedPaneId);
        if (pane?.content.type === 'agent') {
          const currentSectionId = pane.content.sectionId;
          const idx = sections.findIndex((s) => s.id === currentSectionId);
          const delta = key.name === '[' ? -1 : 1;
          const newIdx = idx + delta;
          if (newIdx >= 0 && newIdx < sections.length) {
            dispatch({ type: 'ENTER_DETAIL', sectionId: sections[newIdx]!.id });
          }
        }
        return;
      }
      if ((key.name === 'v' || key.name === 'h') && !key.ctrl && !key.meta) {
        const pane = state.panes.get(state.focusedPaneId);
        if (pane?.content.type === 'agent') {
          dispatch({
            type: 'SPLIT_PANE',
            direction: key.name === 'v' ? 'vertical' : 'horizontal',
            content: pane.content,
          });
        }
        return;
      }
      return;
    }

    // ── Split mode ──
    if (state.mode === 'split') {
      if (key.name === 'escape') {
        dispatch({ type: 'ENTER_OVERVIEW' });
        return;
      }
      if (key.name === 'tab' && !key.shift) {
        dispatch({ type: 'FOCUS_NEXT' });
        return;
      }
      if (key.name === 'tab' && key.shift) {
        dispatch({ type: 'FOCUS_PREV' });
        return;
      }
      if (key.name === 'j' || key.name === 'down') {
        dispatch({ type: 'SCROLL', delta: -1 });
        return;
      }
      if (key.name === 'k' || key.name === 'up') {
        dispatch({ type: 'SCROLL', delta: 1 });
        return;
      }
      if (key.name === 'd' && !key.ctrl && !key.meta) {
        dispatch({ type: 'PAGE_SCROLL', delta: -1, pageSize: rows });
        return;
      }
      if (key.name === 'u' && !key.ctrl && !key.meta) {
        dispatch({ type: 'PAGE_SCROLL', delta: 1, pageSize: rows });
        return;
      }
      if (key.name === 'i' && !key.ctrl && !key.meta) {
        const pane = state.panes.get(state.focusedPaneId);
        if (pane?.content.type === 'agent') activateChat(pane.content.sectionId);
        return;
      }
      if (key.name === 'x' && !key.ctrl && !key.meta) {
        dispatch({ type: 'CLOSE_PANE' });
        return;
      }
      if (key.name === '+' || key.name === '=') {
        dispatch({ type: 'RESIZE_PANE', delta: 0.05 });
        return;
      }
      if (key.name === '-') {
        dispatch({ type: 'RESIZE_PANE', delta: -0.05 });
        return;
      }
      if ((key.name === 'v' || key.name === 'h') && !key.ctrl && !key.meta) {
        const pane = state.panes.get(state.focusedPaneId);
        const content = pane?.content ?? { type: 'overview' as const };
        dispatch({
          type: 'SPLIT_PANE',
          direction: key.name === 'v' ? 'vertical' : 'horizontal',
          content,
        });
        return;
      }
      const num = Number.parseInt(key.name, 10);
      if (num >= 1 && num <= 9) {
        const section = sections[num - 1];
        if (section) dispatch({ type: 'SWITCH_PANE_CONTENT', sectionId: section.id });
      }
      return;
    }
  });

  const outputStreams = orchestrator.getOutputStreams();

  // Chat input occupies rows at the bottom of detail/split views
  const chatHeight = chat.active ? (chat.sending ? 3 : 2) : 0;

  // Help overlay
  if (state.showHelp) {
    return (
      <box flexDirection="column" width={columns} height={rows} backgroundColor={BG.void}>
        <HelpOverlay termWidth={columns} termHeight={rows} />
        <StatusBar mode={state.mode} snapshot={snapshot} termWidth={columns} />
      </box>
    );
  }

  // Render based on mode
  let content: JSX.Element;
  const contentHeight = Math.max(1, rows - 1 - chatHeight); // minus status bar and chat

  switch (state.mode) {
    case 'overview':
      content = (
        <OverviewScreen
          snapshot={snapshot}
          selectedIndex={state.selectedSectionIndex}
          termWidth={columns}
          termHeight={contentHeight}
        />
      );
      break;

    case 'detail': {
      const focusedPane = state.panes.get(state.focusedPaneId);
      if (!focusedPane) {
        content = (
          <OverviewScreen
            snapshot={snapshot}
            selectedIndex={state.selectedSectionIndex}
            termWidth={columns}
            termHeight={contentHeight}
          />
        );
        break;
      }
      const stream = focusedPane.content.type === 'agent'
        ? outputStreams.get(focusedPane.content.sectionId)
        : undefined;
      content = (
        <DetailScreen
          snapshot={snapshot}
          pane={focusedPane}
          outputStream={stream}
          termWidth={columns}
          termHeight={contentHeight}
        />
      );
      break;
    }

    case 'split':
      content = (
        <SplitScreen
          snapshot={snapshot}
          layout={state.layout}
          panes={state.panes}
          focusedPaneId={state.focusedPaneId}
          outputStreams={outputStreams}
          termWidth={columns}
          termHeight={contentHeight}
        />
      );
      break;
  }

  return (
    <box flexDirection="column" width={columns} height={rows} backgroundColor={BG.void}>
      {content}
      {chat.active && <ChatInputBar state={chat} termWidth={columns} />}
      <StatusBar mode={state.mode} snapshot={snapshot} termWidth={columns} />
    </box>
  );
}
