/* ── Layout engine: resolves binary split tree → pane rectangles ── */

import type { LayoutNode } from '../types.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Resolve a LayoutNode tree into a map of paneId → Rect.
 * The tree is recursively split, with each node's ratio determining
 * how space is divided between its two children.
 */
export function resolveLayout(
  node: LayoutNode,
  rect: Rect,
): Map<string, Rect> {
  const result = new Map<string, Rect>();

  if (node.type === 'leaf') {
    result.set(node.paneId, rect);
    return result;
  }

  if (node.direction === 'vertical') {
    // Split left/right
    const firstWidth = Math.floor(rect.width * node.ratio);
    const secondWidth = rect.width - firstWidth;

    const firstRect: Rect = { x: rect.x, y: rect.y, width: firstWidth, height: rect.height };
    const secondRect: Rect = { x: rect.x + firstWidth, y: rect.y, width: secondWidth, height: rect.height };

    for (const [id, r] of resolveLayout(node.first, firstRect)) {
      result.set(id, r);
    }
    for (const [id, r] of resolveLayout(node.second, secondRect)) {
      result.set(id, r);
    }
  } else {
    // Split top/bottom
    const firstHeight = Math.floor(rect.height * node.ratio);
    const secondHeight = rect.height - firstHeight;

    const firstRect: Rect = { x: rect.x, y: rect.y, width: rect.width, height: firstHeight };
    const secondRect: Rect = { x: rect.x, y: rect.y + firstHeight, width: rect.width, height: secondHeight };

    for (const [id, r] of resolveLayout(node.first, firstRect)) {
      result.set(id, r);
    }
    for (const [id, r] of resolveLayout(node.second, secondRect)) {
      result.set(id, r);
    }
  }

  return result;
}
