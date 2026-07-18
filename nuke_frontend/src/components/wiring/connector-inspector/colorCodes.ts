// connector-inspector/colorCodes.ts — cut-list color code → per-part hex for
// base/stripe swatches ('TAN/WHT' → [tan, white]). Delegates to the shared
// WIRE_COLOR_HEX registry in wiringTheme.ts (single source); only the
// split-into-parts presentation lives here.

import { WIRE_COLOR_HEX } from '../wiringTheme';

const EXTRA: Record<string, string> = {
  BARE: '#b0a890', NAT: '#ddddcc', CLR: '#ddddcc', BLACK: '#333333', WHITE: '#e0e0e0',
};

export function colorParts(code: string): string[] {
  const parts = (code || '')
    .split('/')
    .map(p => p.trim().toUpperCase())
    .filter(Boolean)
    .map(p => WIRE_COLOR_HEX[p] || EXTRA[p] || '#777788');
  return parts.length > 0 ? parts : ['#777788'];
}
