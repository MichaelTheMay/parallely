/* ── StatusBar: 1-row bottom bar with mode label, key hints, token totals ── */

import type { ViewMode, RunSnapshot } from '../types.js';
import { BG, GLOW, STATUS } from './theme.js';
import { formatTokens } from '../utils.js';

const MODE_HINTS: Record<ViewMode, string> = {
  overview: 'j/k nav  Enter detail  s split  ? help  q quit',
  detail: 'Esc back  j/k scroll  d/u page  g/G top/end  f auto  i chat  [/] prev/next  v/h split',
  split: 'Esc back  Tab focus  j/k scroll  1-9 section  i chat  v/h split  x close  +/- resize',
};

const MODE_LABEL: Record<ViewMode, string> = {
  overview: 'SURVEY',
  detail: 'INSPECT',
  split: 'CLEAVE',
};

interface StatusBarProps {
  mode: ViewMode;
  snapshot: RunSnapshot;
  termWidth: number;
}

export function StatusBar({ mode, snapshot, termWidth }: StatusBarProps): JSX.Element {
  const totalTokens = snapshot.tokenUsage.input + snapshot.tokenUsage.output;
  const tokenStr = totalTokens > 0 ? formatTokens(totalTokens) : '0';

  const modeTag = MODE_LABEL[mode];
  const hints = MODE_HINTS[mode];
  const gap = Math.max(0, termWidth - modeTag.length - hints.length - tokenStr.length - 16);

  return (
    <box width={termWidth} backgroundColor={BG.stone}>
      <text>
        <strong><span fg={GLOW.gold}> ᚲ {modeTag} </span></strong>
        <span fg={STATUS.muted}>{hints}</span>
        {' '.repeat(gap)}
        <span fg={STATUS.muted}>{tokenStr} tok </span>
      </text>
    </box>
  );
}
