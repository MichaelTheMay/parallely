/* ── Ring-buffer output stream for agent output capture ── */

import type { OutputLine } from '../types.js';

export type OutputStreamListener = () => void;

const DEFAULT_MAX_LINES = 5000;
const NOTIFY_THROTTLE_MS = 250;

export class SectionOutputStream {
  private buffer: OutputLine[] = [];
  private maxLines: number;
  private nextId = 0;
  private listeners = new Set<OutputStreamListener>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNotify = false;

  constructor(maxLines = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
  }

  push(text: string, source: 'stdout' | 'stderr' = 'stdout'): void {
    const line: OutputLine = {
      id: this.nextId++,
      text,
      timestamp: Date.now(),
      source,
    };

    this.buffer.push(line);

    // Trim from front if over capacity
    if (this.buffer.length > this.maxLines) {
      this.buffer.splice(0, this.buffer.length - this.maxLines);
    }

    this.scheduleNotify();
  }

  pushLines(text: string, source: 'stdout' | 'stderr' = 'stdout'): void {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.length > 0) {
        this.push(line, source);
      }
    }
  }

  getLines(start = 0, count?: number): OutputLine[] {
    if (count === undefined) {
      return this.buffer.slice(start);
    }
    return this.buffer.slice(start, start + count);
  }

  getLineCount(): number {
    return this.buffer.length;
  }

  /** Get lines from the end (for viewport rendering) */
  getTail(count: number): OutputLine[] {
    if (count >= this.buffer.length) return [...this.buffer];
    return this.buffer.slice(this.buffer.length - count);
  }

  /** Get visible lines given viewport height and scroll offset from bottom */
  getVisibleLines(viewportHeight: number, scrollOffset: number): OutputLine[] {
    const total = this.buffer.length;
    if (total === 0) return [];

    const endIdx = total - scrollOffset;
    const startIdx = Math.max(0, endIdx - viewportHeight);
    return this.buffer.slice(startIdx, Math.max(startIdx, endIdx));
  }

  subscribe(listener: OutputStreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleNotify(): void {
    if (this.notifyTimer) {
      this.pendingNotify = true;
      return;
    }

    this.notifyListeners();

    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      if (this.pendingNotify) {
        this.pendingNotify = false;
        this.notifyListeners();
      }
    }, NOTIFY_THROTTLE_MS);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  destroy(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.listeners.clear();
    this.buffer = [];
  }
}
