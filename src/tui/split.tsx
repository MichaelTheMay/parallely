/* ── SplitScreen: recursive binary split pane layout ── */

import type { LayoutNode, PaneState, RunSnapshot } from '../types.js';
import type { SectionOutputStream } from './output-stream.js';
import { PaneComponent } from './pane.js';
import { resolveLayout, type Rect } from './layout.js';

interface SplitScreenProps {
  snapshot: RunSnapshot;
  layout: LayoutNode;
  panes: Map<string, PaneState>;
  focusedPaneId: string;
  outputStreams: Map<string, SectionOutputStream>;
  termWidth: number;
  termHeight: number;
}

/**
 * Recursively render the layout tree as nested box components.
 * Uses flexbox with percentage-based sizing (via flexGrow ratios).
 */
function LayoutContainer({
  node,
  snapshot,
  panes,
  focusedPaneId,
  outputStreams,
  rect,
}: {
  node: LayoutNode;
  snapshot: RunSnapshot;
  panes: Map<string, PaneState>;
  focusedPaneId: string;
  outputStreams: Map<string, SectionOutputStream>;
  rect: Rect;
}): JSX.Element {
  if (node.type === 'leaf') {
    const pane = panes.get(node.paneId);
    if (!pane) return <box />;

    const stream = pane.content.type === 'agent'
      ? outputStreams.get(pane.content.sectionId)
      : undefined;

    return (
      <PaneComponent
        pane={pane}
        width={rect.width}
        height={rect.height}
        focused={node.paneId === focusedPaneId}
        snapshot={snapshot}
        outputStream={stream}
      />
    );
  }

  const isVertical = node.direction === 'vertical';

  if (isVertical) {
    const firstWidth = Math.floor(rect.width * node.ratio);
    const secondWidth = rect.width - firstWidth;
    const firstRect: Rect = { ...rect, width: firstWidth };
    const secondRect: Rect = { ...rect, x: rect.x + firstWidth, width: secondWidth };

    return (
      <box flexDirection="row" width={rect.width} height={rect.height}>
        <box width={firstWidth} height={rect.height}>
          <LayoutContainer
            node={node.first}
            snapshot={snapshot}
            panes={panes}
            focusedPaneId={focusedPaneId}
            outputStreams={outputStreams}
            rect={firstRect}
          />
        </box>
        <box width={secondWidth} height={rect.height}>
          <LayoutContainer
            node={node.second}
            snapshot={snapshot}
            panes={panes}
            focusedPaneId={focusedPaneId}
            outputStreams={outputStreams}
            rect={secondRect}
          />
        </box>
      </box>
    );
  }

  // Horizontal split (top/bottom)
  const firstHeight = Math.floor(rect.height * node.ratio);
  const secondHeight = rect.height - firstHeight;
  const firstRect: Rect = { ...rect, height: firstHeight };
  const secondRect: Rect = { ...rect, y: rect.y + firstHeight, height: secondHeight };

  return (
    <box flexDirection="column" width={rect.width} height={rect.height}>
      <box height={firstHeight} width={rect.width}>
        <LayoutContainer
          node={node.first}
          snapshot={snapshot}
          panes={panes}
          focusedPaneId={focusedPaneId}
          outputStreams={outputStreams}
          rect={firstRect}
        />
      </box>
      <box height={secondHeight} width={rect.width}>
        <LayoutContainer
          node={node.second}
          snapshot={snapshot}
          panes={panes}
          focusedPaneId={focusedPaneId}
          outputStreams={outputStreams}
          rect={secondRect}
        />
      </box>
    </box>
  );
}

export function SplitScreen({
  snapshot,
  layout,
  panes,
  focusedPaneId,
  outputStreams,
  termWidth,
  termHeight,
}: SplitScreenProps): JSX.Element {
  const availableHeight = termHeight - 1; // leave room for status bar
  const rect: Rect = { x: 0, y: 0, width: termWidth, height: availableHeight };

  return (
    <box width={termWidth} height={availableHeight}>
      <LayoutContainer
        node={layout}
        snapshot={snapshot}
        panes={panes}
        focusedPaneId={focusedPaneId}
        outputStreams={outputStreams}
        rect={rect}
      />
    </box>
  );
}
