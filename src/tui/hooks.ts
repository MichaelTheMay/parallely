/* ── Custom hooks for TUI ── */

import { useEffect, useState } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { SectionOutputStream } from './output-stream.js';
import type { OutputLine } from '../types.js';

/** Terminal dimensions with resize tracking */
export function useTerminalSize(): { columns: number; rows: number } {
  const { width, height } = useTerminalDimensions();
  const fallbackColumns = process.stdout.columns ?? 80;
  const fallbackRows = process.stdout.rows ?? 24;
  const columns = Number.isFinite(width) && width > 0 ? Math.floor(width) : fallbackColumns;
  const rows = Number.isFinite(height) && height > 0 ? Math.floor(height) : fallbackRows;
  return {
    columns: Math.max(20, columns),
    rows: Math.max(8, rows),
  };
}

/** Subscribe to an output stream and return visible lines */
export function useOutputStream(
  stream: SectionOutputStream | undefined,
  viewportHeight: number,
  scrollOffset: number,
  autoScroll: boolean,
): { visibleLines: OutputLine[]; totalLines: number; isAtBottom: boolean } {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!stream) return;
    return stream.subscribe(() => {
      forceUpdate((n) => n + 1);
    });
  }, [stream]);

  if (!stream) {
    return { visibleLines: [], totalLines: 0, isAtBottom: true };
  }

  const totalLines = stream.getLineCount();
  const effectiveOffset = autoScroll ? 0 : scrollOffset;
  const visibleLines = stream.getVisibleLines(viewportHeight, effectiveOffset);
  const isAtBottom = effectiveOffset === 0;

  return { visibleLines, totalLines, isAtBottom };
}

/** Simple interval timer that returns an incrementing tick */
export function useTimer(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
