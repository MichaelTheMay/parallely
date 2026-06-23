/* ── Detail screen: single agent output (full-screen pane) ── */

import type { PaneState, RunSnapshot } from '../types.js';
import type { SectionOutputStream } from './output-stream.js';
import { PaneComponent } from './pane.js';

interface DetailScreenProps {
  snapshot: RunSnapshot;
  pane: PaneState;
  outputStream?: SectionOutputStream;
  termWidth: number;
  termHeight: number;
}

export function DetailScreen({
  snapshot,
  pane,
  outputStream,
  termWidth,
  termHeight,
}: DetailScreenProps): JSX.Element {
  return (
    <PaneComponent
      pane={pane}
      width={termWidth}
      height={termHeight}
      focused={true}
      snapshot={snapshot}
      outputStream={outputStream}
    />
  );
}
