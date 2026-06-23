/* ── TUI state management (useReducer) ── */

import type { LayoutNode, PaneContent, PaneState, ViewMode } from '../types.js';

export interface TuiState {
  mode: ViewMode;
  layout: LayoutNode;
  panes: Map<string, PaneState>;
  focusedPaneId: string;
  nextPaneId: number;
  selectedSectionIndex: number;
  showHelp: boolean;
  sectionCount: number;
}

export type TuiAction =
  | { type: 'ENTER_OVERVIEW' }
  | { type: 'ENTER_DETAIL'; sectionId: string }
  | { type: 'ENTER_SPLIT'; sectionId: string }
  | { type: 'SPLIT_PANE'; direction: 'horizontal' | 'vertical'; content: PaneContent }
  | { type: 'CLOSE_PANE' }
  | { type: 'RESIZE_PANE'; delta: number }
  | { type: 'FOCUS_NEXT' }
  | { type: 'FOCUS_PREV' }
  | { type: 'SCROLL'; delta: number }
  | { type: 'PAGE_SCROLL'; delta: number; pageSize: number }
  | { type: 'SCROLL_TO_TOP' }
  | { type: 'SCROLL_TO_BOTTOM' }
  | { type: 'TOGGLE_AUTO_SCROLL' }
  | { type: 'SELECT_SECTION'; delta: number }
  | { type: 'SELECT_SECTION_INDEX'; index: number }
  | { type: 'TOGGLE_HELP' }
  | { type: 'SET_SECTION_COUNT'; count: number }
  | { type: 'SWITCH_PANE_CONTENT'; sectionId: string };

function createPane(id: string, content: PaneContent): PaneState {
  return { id, content, scrollOffset: 0, autoScroll: true };
}

export function createInitialState(): TuiState {
  const paneId = 'pane-0';
  return {
    mode: 'overview',
    layout: { type: 'leaf', paneId },
    panes: new Map([[paneId, createPane(paneId, { type: 'overview' })]]),
    focusedPaneId: paneId,
    nextPaneId: 1,
    selectedSectionIndex: 0,
    showHelp: false,
    sectionCount: 0,
  };
}

/** Collect all leaf pane IDs from the layout tree (left-to-right order) */
function collectPaneIds(node: LayoutNode): string[] {
  if (node.type === 'leaf') return [node.paneId];
  return [...collectPaneIds(node.first), ...collectPaneIds(node.second)];
}

/** Replace a leaf node in the layout tree */
function replaceLeaf(
  node: LayoutNode,
  targetPaneId: string,
  replacement: LayoutNode,
): LayoutNode {
  if (node.type === 'leaf') {
    return node.paneId === targetPaneId ? replacement : node;
  }
  return {
    ...node,
    first: replaceLeaf(node.first, targetPaneId, replacement),
    second: replaceLeaf(node.second, targetPaneId, replacement),
  };
}

/** Remove a leaf and collapse the parent split */
function removeLeaf(node: LayoutNode, targetPaneId: string): LayoutNode | null {
  if (node.type === 'leaf') {
    return node.paneId === targetPaneId ? null : node;
  }

  const firstResult = removeLeaf(node.first, targetPaneId);
  const secondResult = removeLeaf(node.second, targetPaneId);

  if (firstResult === null) return secondResult;
  if (secondResult === null) return firstResult;
  return { ...node, first: firstResult, second: secondResult };
}

/** Adjust ratio of the split containing the focused pane */
function adjustRatio(node: LayoutNode, targetPaneId: string, delta: number): LayoutNode {
  if (node.type === 'leaf') return node;
  if (node.type === 'split') {
    const leafIds = collectPaneIds(node);
    if (leafIds.includes(targetPaneId)) {
      // Check if target is in first or second
      const firstIds = collectPaneIds(node.first);
      if (firstIds.includes(targetPaneId) || collectPaneIds(node.second).includes(targetPaneId)) {
        const newRatio = Math.max(0.15, Math.min(0.85, node.ratio + delta));
        return {
          ...node,
          ratio: newRatio,
          first: adjustRatio(node.first, targetPaneId, delta),
          second: adjustRatio(node.second, targetPaneId, delta),
        };
      }
    }
  }
  return node;
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'ENTER_OVERVIEW': {
      return {
        ...state,
        mode: 'overview',
        showHelp: false,
      };
    }

    case 'ENTER_DETAIL': {
      const paneId = `pane-${state.nextPaneId}`;
      const pane = createPane(paneId, { type: 'agent', sectionId: action.sectionId });
      const panes = new Map(state.panes);
      panes.set(paneId, pane);
      return {
        ...state,
        mode: 'detail',
        layout: { type: 'leaf', paneId },
        panes,
        focusedPaneId: paneId,
        nextPaneId: state.nextPaneId + 1,
      };
    }

    case 'ENTER_SPLIT': {
      const paneId = `pane-${state.nextPaneId}`;
      const pane = createPane(paneId, { type: 'agent', sectionId: action.sectionId });
      const panes = new Map(state.panes);
      panes.set(paneId, pane);
      return {
        ...state,
        mode: 'split',
        layout: { type: 'leaf', paneId },
        panes,
        focusedPaneId: paneId,
        nextPaneId: state.nextPaneId + 1,
      };
    }

    case 'SPLIT_PANE': {
      const newPaneId = `pane-${state.nextPaneId}`;
      const newPane = createPane(newPaneId, action.content);
      const panes = new Map(state.panes);
      panes.set(newPaneId, newPane);

      const newLayout = replaceLeaf(state.layout, state.focusedPaneId, {
        type: 'split',
        direction: action.direction,
        ratio: 0.5,
        first: { type: 'leaf', paneId: state.focusedPaneId },
        second: { type: 'leaf', paneId: newPaneId },
      });

      return {
        ...state,
        mode: 'split',
        layout: newLayout,
        panes,
        focusedPaneId: newPaneId,
        nextPaneId: state.nextPaneId + 1,
      };
    }

    case 'CLOSE_PANE': {
      const paneIds = collectPaneIds(state.layout);
      if (paneIds.length <= 1) {
        // Last pane — go back to overview
        return { ...state, mode: 'overview' };
      }

      const newLayout = removeLeaf(state.layout, state.focusedPaneId);
      if (!newLayout) return { ...state, mode: 'overview' };

      const panes = new Map(state.panes);
      panes.delete(state.focusedPaneId);

      const remainingIds = collectPaneIds(newLayout);
      const newFocused = remainingIds[0] ?? state.focusedPaneId;

      // If only one pane left, switch to detail mode
      const newMode = remainingIds.length === 1 ? 'detail' : 'split';

      return {
        ...state,
        mode: newMode,
        layout: newLayout,
        panes,
        focusedPaneId: newFocused,
      };
    }

    case 'RESIZE_PANE': {
      return {
        ...state,
        layout: adjustRatio(state.layout, state.focusedPaneId, action.delta),
      };
    }

    case 'FOCUS_NEXT':
    case 'FOCUS_PREV': {
      const paneIds = collectPaneIds(state.layout);
      if (paneIds.length <= 1) return state;
      const currentIdx = paneIds.indexOf(state.focusedPaneId);
      const delta = action.type === 'FOCUS_NEXT' ? 1 : -1;
      const nextIdx = (currentIdx + delta + paneIds.length) % paneIds.length;
      return { ...state, focusedPaneId: paneIds[nextIdx]! };
    }

    case 'SCROLL': {
      const pane = state.panes.get(state.focusedPaneId);
      if (!pane) return state;
      const newOffset = Math.max(0, pane.scrollOffset + action.delta);
      const panes = new Map(state.panes);
      panes.set(pane.id, { ...pane, scrollOffset: newOffset, autoScroll: false });
      return { ...state, panes };
    }

    case 'PAGE_SCROLL': {
      const pane = state.panes.get(state.focusedPaneId);
      if (!pane) return state;
      const jump = Math.floor(action.pageSize / 2) * action.delta;
      const newOffset = Math.max(0, pane.scrollOffset + jump);
      const panes = new Map(state.panes);
      panes.set(pane.id, { ...pane, scrollOffset: newOffset, autoScroll: false });
      return { ...state, panes };
    }

    case 'SCROLL_TO_TOP': {
      const pane = state.panes.get(state.focusedPaneId);
      if (!pane) return state;
      const panes = new Map(state.panes);
      panes.set(pane.id, { ...pane, scrollOffset: 999999, autoScroll: false });
      return { ...state, panes };
    }

    case 'SCROLL_TO_BOTTOM': {
      const pane = state.panes.get(state.focusedPaneId);
      if (!pane) return state;
      const panes = new Map(state.panes);
      panes.set(pane.id, { ...pane, scrollOffset: 0, autoScroll: true });
      return { ...state, panes };
    }

    case 'TOGGLE_AUTO_SCROLL': {
      const pane = state.panes.get(state.focusedPaneId);
      if (!pane) return state;
      const panes = new Map(state.panes);
      const newAutoScroll = !pane.autoScroll;
      panes.set(pane.id, {
        ...pane,
        autoScroll: newAutoScroll,
        scrollOffset: newAutoScroll ? 0 : pane.scrollOffset,
      });
      return { ...state, panes };
    }

    case 'SELECT_SECTION': {
      const newIdx = Math.max(0, Math.min(state.sectionCount - 1, state.selectedSectionIndex + action.delta));
      return { ...state, selectedSectionIndex: newIdx };
    }

    case 'SELECT_SECTION_INDEX': {
      if (action.index < 0 || action.index >= state.sectionCount) return state;
      return { ...state, selectedSectionIndex: action.index };
    }

    case 'TOGGLE_HELP':
      return { ...state, showHelp: !state.showHelp };

    case 'SET_SECTION_COUNT':
      return {
        ...state,
        sectionCount: action.count,
        selectedSectionIndex: Math.min(state.selectedSectionIndex, Math.max(0, action.count - 1)),
      };

    case 'SWITCH_PANE_CONTENT': {
      const pane = state.panes.get(state.focusedPaneId);
      if (!pane) return state;
      const panes = new Map(state.panes);
      panes.set(pane.id, {
        ...pane,
        content: { type: 'agent', sectionId: action.sectionId },
        scrollOffset: 0,
        autoScroll: true,
      });
      return { ...state, panes };
    }

    default:
      return state;
  }
}
