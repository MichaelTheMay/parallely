/* ── Pane: bordered container for agent output ── */

import type { PaneState, RunSnapshot, SectionSnapshot } from '../types.js';
import type { SectionOutputStream } from './output-stream.js';
import {
  BG,
  GLOW,
  STATUS,
  STATUS_LABELS,
  STATUS_COLORS,
  STATUS_ICONS,
  SPINNER_FRAMES,
  TICK_INTERVAL_MS,
} from './theme.js';
import { OutputView } from './output-view.js';
import { useOutputStream, useTimer } from './hooks.js';
import { formatTokens } from '../utils.js';

interface PaneComponentProps {
  pane: PaneState;
  width: number;
  height: number;
  focused: boolean;
  snapshot: RunSnapshot;
  outputStream?: SectionOutputStream;
}

export function PaneComponent({
  pane,
  width,
  height,
  focused,
  snapshot,
  outputStream,
}: PaneComponentProps): JSX.Element {
  const tick = useTimer(TICK_INTERVAL_MS);

  // Viewport = total height minus header (1) and border (2)
  const viewportHeight = Math.max(1, height - 3);

  const { visibleLines, totalLines } = useOutputStream(
    outputStream,
    viewportHeight,
    pane.scrollOffset,
    pane.autoScroll,
  );

  // Resolve section
  const content = pane.content;
  let section: SectionSnapshot | undefined;
  let title = 'overview';
  if (content.type === 'agent') {
    section = snapshot.sections.find((s) => s.id === content.sectionId);
    title = section
      ? `${String(section.index + 1).padStart(2, '0')} ${section.title}`
      : content.sectionId;
  }

  const borderColor = focused ? GLOW.goldDim : BG.stone;
  const statusColor = section
    ? section.chatState === 'sending' ? GLOW.gold : STATUS_COLORS[section.status]
    : STATUS.muted;
  const statusLabel = section
    ? section.chatState === 'sending' ? 'chat' : STATUS_LABELS[section.status]
    : '';
  const statusIcon = section ? STATUS_ICONS[section.status] : '';
  const spinner = section && (section.status === 'running' || section.chatState === 'sending')
    ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length]
    : '';

  const totalTokens = section ? section.tokenUsage.input + section.tokenUsage.output : 0;
  const tokenStr = totalTokens > 0 ? formatTokens(totalTokens) : '';

  // Build right-side info
  const rightParts: string[] = [];
  if (spinner) rightParts.push(spinner);
  if (statusLabel) rightParts.push(statusLabel);
  if (tokenStr) rightParts.push(tokenStr);
  const rightStr = rightParts.join(' · ');

  const titleWithIcon = `${statusIcon} ${title}`;
  const gap = Math.max(1, width - titleWithIcon.length - rightStr.length - 6);

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      border={true}
      borderStyle="single"
      borderColor={borderColor}
    >
      <box backgroundColor={BG.stone}>
        <text>
          {focused
            ? <strong><span fg={GLOW.gold}> {titleWithIcon}</span></strong>
            : <span fg={STATUS.text}> {titleWithIcon}</span>
          }
          {' '.repeat(gap)}
          <span fg={statusColor}>{rightStr} </span>
        </text>
      </box>

      <OutputView
        visibleLines={visibleLines}
        totalLines={totalLines}
        scrollOffset={pane.scrollOffset}
        autoScroll={pane.autoScroll}
        viewportHeight={viewportHeight}
      />
    </box>
  );
}
