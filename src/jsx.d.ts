// React 19's `@types/react` removed the global `JSX` namespace (it now lives at
// `React.JSX`), and this project sets `jsxImportSource` to `@opentui/react` for
// the automatic runtime. Components here annotate their return type with the
// bare global `JSX.Element`, so we re-expose OpenTUI's `JSX.Element` globally.
// This is types-only and has no runtime effect; it keeps `tsc --noEmit` honest
// without rewriting every component signature.
import type { JSX as OpenTUIJSX } from '@opentui/react/jsx-runtime';

declare global {
  namespace JSX {
    type Element = OpenTUIJSX.Element;
  }
}

export {};
