/* ── Help overlay: keybinding reference ── */

import { BG, GLOW, STATUS, TICK_INTERVAL_MS } from './theme.js';
import { useTimer } from './hooks.js';

interface HelpOverlayProps {
  termWidth: number;
  termHeight: number;
}

function HelpSection({ title, bindings }: { title: string; bindings: [string, string][] }): JSX.Element {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg={GLOW.gold}><strong>{title}</strong></text>
      {bindings.map(([key, desc]) => (
        <box key={key} gap={1}>
          <text fg={GLOW.taupe}>{`  ${key.padEnd(14)}`}</text>
          <text fg={STATUS.muted}>{desc}</text>
        </box>
      ))}
    </box>
  );
}

export function HelpOverlay({ termWidth, termHeight }: HelpOverlayProps): JSX.Element {
  useTimer(TICK_INTERVAL_MS);
  const divWidth = Math.min(50, termWidth - 6);

  return (
    <box
      flexDirection="column"
      width={termWidth}
      height={termHeight - 1}
      border={true}
      borderStyle="single"
      borderColor={GLOW.goldDim}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <box backgroundColor={BG.stone}>
        <text>
          <strong><span fg={GLOW.gold}>{' '}ᚲ AEON KEYBINDINGS</span></strong>
          {' '.repeat(Math.max(0, termWidth - 26))}
        </text>
      </box>
      <text fg={GLOW.taupeDim}>{'─'.repeat(divWidth)}</text>
      <box marginTop={1} />

      <HelpSection
        title="Global"
        bindings={[
          ['q', 'Quit aeon'],
          ['?', 'Toggle this help'],
        ]}
      />

      <HelpSection
        title="Overview"
        bindings={[
          ['j / ↓', 'Move cursor down'],
          ['k / ↑', 'Move cursor up'],
          ['1-9', 'Jump to section N'],
          ['Enter', 'Open detail view'],
          ['s', 'Open in split mode'],
        ]}
      />

      <HelpSection
        title="Detail"
        bindings={[
          ['Esc', 'Back to overview'],
          ['j / k', 'Scroll ±1 line'],
          ['d / u', 'Scroll ±half page'],
          ['g / G', 'Top / bottom'],
          ['f', 'Toggle auto-scroll'],
          ['i', 'Message this agent'],
          ['[ / ]', 'Previous / next agent'],
          ['v / h', 'Split vertical / horizontal'],
        ]}
      />

      <HelpSection
        title="Split"
        bindings={[
          ['Esc', 'Back to overview'],
          ['Tab / S-Tab', 'Focus next / previous pane'],
          ['j / k', 'Scroll focused pane'],
          ['d / u', 'Page scroll'],
          ['1-9', 'Show section N in pane'],
          ['i', 'Message focused agent'],
          ['v / h', 'Split pane'],
          ['x', 'Close pane'],
          ['+ / -', 'Resize split'],
        ]}
      />

      <HelpSection
        title="Chat (press i to open)"
        bindings={[
          ['Enter', 'Send message to agent'],
          ['Esc', 'Cancel / close input'],
          ['← / →', 'Move cursor'],
          ['Ctrl+← / →', 'Move by word'],
          ['↑ / ↓', 'Browse message history'],
          ['Ctrl+U', 'Clear line'],
          ['Ctrl+W', 'Delete word backward'],
          ['Ctrl+K', 'Delete to end of line'],
        ]}
      />

      <box flexGrow={1} />
      <text fg={STATUS.muted}>? close</text>
    </box>
  );
}
