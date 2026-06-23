/* ── Overview screen ── */

import type { Phase, RunSnapshot, SectionSnapshot } from '../types.js';
import {
  BG, GLOW, STATUS,
  SPINNER_FRAMES, STATUS_ICONS, STATUS_LABELS, STATUS_COLORS,
  BACKEND_LABEL, PHASE_ORDER, PHASE_LABEL, TICK_INTERVAL_MS,
} from './theme.js';
import { DashboardPanel } from './dashboard-panel.js';
import { useTimer } from './hooks.js';
import { elapsed, formatTokens } from '../utils.js';

const MAX_VISIBLE_SECTIONS = 8;

function Spinner(): JSX.Element {
  const tick = useTimer(TICK_INTERVAL_MS);
  return <text fg={GLOW.gold}>{SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}</text>;
}

function StatusIcon({ section }: { section: SectionSnapshot }): JSX.Element {
  if (section.status === 'running' || section.chatState === 'sending') return <Spinner />;
  return <text fg={STATUS_COLORS[section.status]}>{STATUS_ICONS[section.status]}</text>;
}

function Header({ snapshot, termWidth }: { snapshot: RunSnapshot; termWidth: number }): JSX.Element {
  useTimer(1000);
  const el = elapsed(snapshot.startedAt);
  const backend = BACKEND_LABEL[snapshot.backend] ?? snapshot.backend;
  const model = snapshot.model ? ` · ${snapshot.model}` : '';
  const right = el;
  const left = `aeon · ${backend}${model}`;
  const fill = Math.max(1, termWidth - left.length - right.length - 4);

  return (
    <box backgroundColor={BG.stone} paddingLeft={1} paddingRight={1}>
      <text>
        <strong><span fg={GLOW.gold}>{left}</span></strong>
        {' '.repeat(fill)}
        <span fg={STATUS.muted}>{right}</span>
      </text>
    </box>
  );
}

function PhaseBar({ phase }: { phase: Phase }): JSX.Element {
  const activeIdx = PHASE_ORDER.indexOf(phase as typeof PHASE_ORDER[number]);

  return (
    <box paddingLeft={1} paddingRight={1}>
      <text fg={STATUS.muted}>
        {PHASE_ORDER.map((p, i) => {
          const label = PHASE_LABEL[p] ?? p;
          const sep = i < PHASE_ORDER.length - 1 ? ' → ' : '';
          if (phase === 'error' && i <= activeIdx) return <span key={p} fg={STATUS.error}>{label}{sep}</span>;
          if (i < activeIdx) return <span key={p} fg={STATUS.muted}>{label}{sep}</span>;
          if (i === activeIdx) return <span key={p} fg={GLOW.gold}><strong>{label}</strong>{sep}</span>;
          return <span key={p}>{label}{sep}</span>;
        })}
      </text>
    </box>
  );
}

function SectionTable({
  sections, termWidth, selectedIndex,
}: {
  sections: SectionSnapshot[];
  termWidth: number;
  selectedIndex: number;
}): JSX.Element {
  const infoWidth = Math.max(10, termWidth - 55);
  const visibleCount = Math.min(MAX_VISIBLE_SECTIONS, sections.length);
  const half = Math.floor(visibleCount / 2);
  const start = sections.length > visibleCount
    ? Math.max(0, Math.min(sections.length - visibleCount, selectedIndex - half))
    : 0;
  const visibleSections = sections.slice(start, start + visibleCount);
  const hasMoreAbove = start > 0;
  const hasMoreBelow = start + visibleCount < sections.length;

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text fg={STATUS.muted}>
        {'   #  section              status   tokens   info'}
      </text>
      {hasMoreAbove && (
        <text fg={STATUS.muted}>
          {'   ↑ '}
          {start}
          {' hidden above'}
        </text>
      )}
      {visibleSections.map((s, i) => {
        const absoluteIndex = start + i;
        const sel = absoluteIndex === selectedIndex;
        const title = s.title.length > 20 ? s.title.slice(0, 19) + '…' : s.title.padEnd(20);
        const label = (s.chatState === 'sending' ? 'chat' : STATUS_LABELS[s.status]).padEnd(8);
        const totalTokens = s.tokenUsage.input + s.tokenUsage.output;
        const tokens = totalTokens > 0 ? formatTokens(totalTokens).padStart(6) : '     –';
        const info = (s.lastMessage ?? (s.error ? s.error : '')).slice(0, infoWidth);

        return (
          <box key={s.id} backgroundColor={sel ? BG.ember : undefined}>
            <text>
              <span fg={sel ? GLOW.gold : STATUS.muted}>{sel ? ' › ' : '   '}</span>
            </text>
            <StatusIcon section={s} />
            <text>
              {' '}
              <span fg={sel ? GLOW.gold : STATUS.text}>{String(s.index + 1).padStart(2)}</span>
              {'  '}
              <span fg={sel ? STATUS.text : undefined}>{title}</span>
              {'  '}
              <span fg={s.status === 'failed' ? STATUS.error : STATUS.muted}>{label}</span>
              {tokens}
              {'   '}
              <span fg={STATUS.muted}>{info}</span>
            </text>
          </box>
        );
      })}
      {hasMoreBelow && (
        <text fg={STATUS.muted}>
          {'   ↓ '}
          {sections.length - (start + visibleCount)}
          {' hidden below'}
        </text>
      )}
    </box>
  );
}

function CompletionPanel({ snapshot }: { snapshot: RunSnapshot }): JSX.Element | null {
  if (!snapshot.done) return null;
  const done = snapshot.sections.filter((s) => s.status === 'completed').length;
  const fail = snapshot.sections.filter((s) => s.status === 'failed').length;
  const color = snapshot.failed ? STATUS.error : STATUS.success;
  const label = snapshot.failed ? 'failed' : 'complete';

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} marginTop={1}>
      <text fg={color}><strong>{label}</strong></text>
      <text fg={STATUS.muted}>{done} done, {fail} failed</text>
      {snapshot.integrationBranch && (
        <text fg={STATUS.muted}>branch: <span fg={STATUS.text}>{snapshot.integrationBranch}</span></text>
      )}
    </box>
  );
}

function LogPanel({ logs, maxLines }: { logs: string[]; maxLines: number }): JSX.Element | null {
  if (logs.length === 0) return null;
  const visible = logs.slice(-maxLines);
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} marginTop={1}>
      {visible.map((log, i) => (
        <text key={i} fg={STATUS.muted}>{log}</text>
      ))}
    </box>
  );
}

/* ── Main ── */

interface OverviewScreenProps {
  snapshot: RunSnapshot;
  selectedIndex: number;
  termWidth: number;
  termHeight: number;
}

export function OverviewScreen({
  snapshot, selectedIndex, termWidth, termHeight,
}: OverviewScreenProps): JSX.Element {
  const frameWidth = Math.max(20, termWidth);
  const frameHeight = Math.max(3, termHeight - 1);
  const visibleSectionRows = Math.min(MAX_VISIBLE_SECTIONS, snapshot.sections.length);
  const sectionOverflow = snapshot.sections.length > visibleSectionRows;
  const dashboardLines = snapshot.sections.length > 0 ? 4 : 0;
  const headerLines = 3; // header bar + phase bar + divider
  const tableLines = 1 + visibleSectionRows + (sectionOverflow ? 2 : 0);
  const completionLines = snapshot.done ? 3 : 0;
  const dividers = 2; // dividers between sections
  const used = headerLines + dashboardLines + dividers + tableLines + completionLines + 4;
  const availableLogLines = Math.max(0, termHeight - used);

  const innerWidth = Math.max(1, frameWidth - 4); // account for border

  return (
    <box
      flexDirection="column"
      border={true}
      borderStyle="single"
      borderColor={GLOW.goldDim}
      width={frameWidth}
      height={frameHeight}
    >
      <Header snapshot={snapshot} termWidth={frameWidth} />
      <PhaseBar phase={snapshot.phase} />

      {/* Dashboard: total usage + trend */}
      {snapshot.sections.length > 0 && (
        <>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={GLOW.taupeDim}>{'─'.repeat(innerWidth)}</text>
          </box>
          <DashboardPanel snapshot={snapshot} termWidth={frameWidth} />
        </>
      )}

      <box paddingLeft={1} paddingRight={1}>
        <text fg={GLOW.taupeDim}>{'─'.repeat(innerWidth)}</text>
      </box>

      <SectionTable sections={snapshot.sections} termWidth={frameWidth} selectedIndex={selectedIndex} />
      <CompletionPanel snapshot={snapshot} />
      <LogPanel logs={snapshot.logs} maxLines={availableLogLines} />
      <box flexGrow={1} />
    </box>
  );
}
