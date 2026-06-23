/* ── DashboardPanel: total-focused telemetry + trend sparkline ── */

import { useEffect, useMemo, useState } from 'react';
import type { RunSnapshot } from '../types.js';
import { GLOW, STATUS } from './theme.js';
import { formatTokens } from '../utils.js';
import { useTimer } from './hooks.js';

interface DashboardPanelProps {
  snapshot: RunSnapshot;
  termWidth: number;
}

type TokenPoint = { t: number; v: number };

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const HISTORY_CAP = 480;

function renderSparkline(points: TokenPoint[], width: number): string {
  if (width < 1) return '';
  if (points.length === 0) return '·'.repeat(width);

  const values = points.slice(-width).map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return '▁'.repeat(width);

  return values
    .map((value) => {
      const idx = Math.max(
        0,
        Math.min(SPARK_BLOCKS.length - 1, Math.floor(((value - min) / (max - min)) * SPARK_BLOCKS.length)),
      );
      return SPARK_BLOCKS[idx]!;
    })
    .join('');
}

function renderPulse(width: number, tick: number): string {
  if (width < 1) return '';
  const idx = tick % Math.max(1, width);
  return Array.from({ length: width }, (_, i) => (i === idx ? '◉' : '·')).join('');
}

export function DashboardPanel({ snapshot, termWidth }: DashboardPanelProps): JSX.Element | null {
  const totalTokens = snapshot.tokenUsage.input + snapshot.tokenUsage.output;
  const [history, setHistory] = useState<TokenPoint[]>([]);
  const pulseTick = useTimer(140);

  useEffect(() => {
    setHistory((prev) => {
      const nextPoint: TokenPoint = { t: Date.now(), v: totalTokens };
      if (prev.length > 0 && prev[prev.length - 1]!.v === totalTokens) return prev;
      const next = [...prev, nextPoint];
      if (next.length > HISTORY_CAP) {
        next.splice(0, next.length - HISTORY_CAP);
      }
      return next;
    });
  }, [totalTokens]);

  const active = snapshot.sections.filter((s) => s.status === 'running').length;
  const completed = snapshot.sections.filter((s) => s.status === 'completed').length;
  const failed = snapshot.sections.filter((s) => s.status === 'failed').length;

  const trendWidth = Math.max(18, termWidth - 14);
  const trend = useMemo(() => renderSparkline(history, trendWidth), [history, trendWidth]);
  const pulse = useMemo(() => renderPulse(trendWidth, pulseTick), [trendWidth, pulseTick]);

  const rate = useMemo(() => {
    if (history.length < 2) return 0;
    const tail = history.slice(-Math.min(40, history.length));
    const first = tail[0]!;
    const last = tail[tail.length - 1]!;
    const dtMs = Math.max(1, last.t - first.t);
    return ((last.v - first.v) / dtMs) * 1000;
  }, [history]);

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text>
        <span fg={GLOW.gold}> total </span>
        <span fg={STATUS.text}>{formatTokens(totalTokens)} tokens</span>
        <span fg={STATUS.muted}>  | in {formatTokens(snapshot.tokenUsage.input)}</span>
        <span fg={STATUS.muted}> cached {formatTokens(snapshot.tokenUsage.cachedInput)}</span>
        <span fg={STATUS.muted}> out {formatTokens(snapshot.tokenUsage.output)}</span>
      </text>
      <text>
        <span fg={STATUS.muted}> queue </span>
        <span fg={STATUS.text}>{snapshot.sections.length} sections</span>
        <span fg={GLOW.gold}>  active {active}</span>
        <span fg={STATUS.success}>  done {completed}</span>
        <span fg={failed > 0 ? STATUS.error : STATUS.muted}>  fail {failed}</span>
        <span fg={STATUS.muted}>  rate {Math.max(0, rate).toFixed(1)} tok/s</span>
      </text>
      <text>
        <span fg={STATUS.muted}> trend </span>
        <span fg={GLOW.taupe}>{trend}</span>
      </text>
      <text>
        <span fg={STATUS.muted}> pulse </span>
        <span fg={GLOW.cyan}>{pulse}</span>
      </text>
    </box>
  );
}
