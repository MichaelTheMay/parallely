/* ── ANSI true-color CLI helpers ── */

const RST = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function rgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const C = {
  gold: rgb('#C8A84E'),
  goldDim: rgb('#8B7535'),
  taupe: rgb('#9B8A70'),
  stone: rgb('#505058'),
  text: rgb('#C8C4BC'),
  jade: rgb('#7DAA5C'),
  crimson: rgb('#C9534A'),
} as const;

export const s = {
  gold: (t: string) => `${C.gold}${t}${RST}`,
  goldBold: (t: string) => `${BOLD}${C.gold}${t}${RST}`,
  stone: (t: string) => `${C.taupe}${t}${RST}`,
  dim: (t: string) => `${DIM}${C.stone}${t}${RST}`,
  text: (t: string) => `${C.text}${t}${RST}`,
  jade: (t: string) => `${C.jade}${t}${RST}`,
  crimson: (t: string) => `${C.crimson}${t}${RST}`,
  warn: (t: string) => `${C.goldDim}${t}${RST}`,
  bold: (t: string) => `${BOLD}${C.text}${t}${RST}`,
  rule: (w: number) => `${C.goldDim}${'─'.repeat(w)}${RST}`,
  header: () => `${BOLD}${C.gold}ᚲ AEON${RST}`,
};
