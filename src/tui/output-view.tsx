/* ── OutputView: virtual-scrolled output with new-line highlight ── */

import type { OutputLine } from '../types.js';
import { GLOW, STATUS, SCROLL_INDICATOR } from './theme.js';

/** Lines newer than this (ms) render highlighted */
const HIGHLIGHT_THRESHOLD_MS = 1500;

interface OutputViewProps {
  visibleLines: OutputLine[];
  totalLines: number;
  scrollOffset: number;
  autoScroll: boolean;
  viewportHeight: number;
}

export function OutputView({
  visibleLines,
  totalLines,
  scrollOffset,
  autoScroll,
  viewportHeight,
}: OutputViewProps): JSX.Element {
  const linesAbove = totalLines - scrollOffset - visibleLines.length;
  const linesBelow = scrollOffset;
  const now = Date.now();

  return (
    <box flexDirection="column" height={viewportHeight}>
      {linesAbove > 0 && (
        <box justifyContent="center">
          <text fg={STATUS.muted}>
            {SCROLL_INDICATOR.up} {linesAbove} more
          </text>
        </box>
      )}

      {visibleLines.map((line) => {
        const age = now - line.timestamp;
        const isRecent = age < HIGHLIGHT_THRESHOLD_MS;
        const color = line.source === 'stderr'
          ? STATUS.error
          : isRecent
            ? GLOW.gold
            : undefined;
        return (
          <box key={line.id}>
            <text fg={color}>{line.text}</text>
          </box>
        );
      })}

      {visibleLines.length < viewportHeight && <box flexGrow={1} />}

      {linesBelow > 0 && !autoScroll && (
        <box justifyContent="center">
          <text fg={STATUS.muted}>
            {SCROLL_INDICATOR.down} {linesBelow} more
          </text>
        </box>
      )}
    </box>
  );
}
