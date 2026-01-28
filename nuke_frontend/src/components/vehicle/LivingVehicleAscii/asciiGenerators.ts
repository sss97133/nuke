/**
 * ASCII generators for living vehicle profile.
 * Cursor CLI + Firecrawl style: terminal frames, [ badge ] lines, . : - = + X texture.
 * See docs/design/LIVING_ASCII_VEHICLE_PROFILE.md.
 */

import type { ShapeKey, VehicleAsciiSlice, AuctionPulseSlice } from './types';
import { getDisplayState, getShapeKey, getIdentityLine, getPulseLine } from './interpretation';

// ─── Legacy (kept for compat); prefer Cursor/Firecrawl output via getLinesForState ───
const SHAPES: Record<ShapeKey, string[]> = {
  sedan: ['    ___________', '   /           \\___', '  |  o         o   \\', '  |     [____]      \\___', '   \\__________________/'],
  suv: ['      __________', '     /          \\___', '    | o    o       \\', '    |   [____]       \\___', '    |  ___________   ___/', '     \\_____________/'],
  truck: ['    _____', '   /     \\__________', '  | o   o           \\___', '  |    [____]            \\', '   \\_____________________/'],
  coupe: ['      ___________', '     /             \\', '    | o           o \\___', '     \\ [____] _________/'],
  default: ['    ___________', '   /           \\___', '  |  o         o   \\', '  |     [____]      \\___', '   \\__________________/'],
};

export function getShapeLines(key: ShapeKey): string[] {
  return SHAPES[key] ?? SHAPES.default;
}

export function getIdentityBlock(line: string, width: number = 24): string[] {
  const w = Math.max(width, line.length);
  const padded = line.length >= w ? line.slice(0, w) : line.padStart((w + line.length) / 2).padEnd(w);
  return ['', padded, ''];
}

export function getPulseBlock(line: string, width: number = 24): string[] {
  if (!line) return [];
  const w = Math.max(width, line.length);
  const padded = line.length >= w ? line.slice(0, w) : line.padStart((w + line.length) / 2).padEnd(w);
  return ['', padded];
}

// ─── Cursor CLI + Firecrawl style (expectation: cursor.com/cli, firecrawl.dev) ───

const FIRECRAWL_CHARS = ['.', ' ', ':', '-', '=', '+', 'X'];
const BOX_W = 36;

function firecrawlTextureStrip(length: number, seed: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    const t = Math.sin(seed + i * 1.3) * 0.5 + 0.5;
    s += FIRECRAWL_CHARS[Math.min(Math.floor(t * FIRECRAWL_CHARS.length), FIRECRAWL_CHARS.length - 1)];
  }
  return s;
}

/** Cursor-style terminal frame: +-- title ---+ / | body     | / +----------+ */
function cursorTerminalFrame(title: string, bodyLine: string): string[] {
  const inner = BOX_W - 4;
  const t = (' ' + (title || '')).slice(0, inner - 2);
  const top = '+--' + t.padEnd(inner - 2, '-') + '+';
  const body = '| ' + bodyLine.slice(0, inner - 2).padEnd(inner - 2) + ' |';
  const bot = '+' + '-'.repeat(inner) + '+';
  return [top, body, bot];
}

/** Firecrawl-style badge: [ LIVE · $42,000 ] */
function firecrawlBadge(line: string): string[] {
  if (!line) return [];
  const inner = ' ' + line.trim().slice(0, BOX_W - 8) + ' ';
  return ['', '  [ ' + inner.padEnd(Math.max(0, BOX_W - 8)) + ' ]', ''];
}

/** Shape state: terminal “vehicle” + type + Firecrawl texture strip */
function cursorStyleShape(identityLine: string, shapeKey: ShapeKey): string[] {
  const strip = firecrawlTextureStrip(BOX_W - 4, (shapeKey.length + identityLine.length) * 7);
  const body = identityLine ? identityLine.slice(0, BOX_W - 4) : shapeKey;
  return [
    '',
    ...cursorTerminalFrame('vehicle', body),
    '  ' + strip.slice(0, BOX_W - 4),
    '',
  ];
}

/** Identity state: Cursor terminal frame only */
function cursorStyleIdentity(identityLine: string): string[] {
  return ['', ...cursorTerminalFrame('identity', identityLine), ''];
}

/** Pulse state: Firecrawl [ badge ] + optional texture */
function cursorStylePulse(pulseLine: string): string[] {
  const strip = firecrawlTextureStrip(BOX_W - 4, pulseLine.length * 11);
  return [...firecrawlBadge(pulseLine), '  ' + strip.slice(0, BOX_W - 4)];
}

/** State for the living ASCII profile rotation */
export type LivingAsciiState = 'shape' | 'identity' | 'pulse';

/** Get lines for a given state. Uses Cursor + Firecrawl style (terminal frames, [ badge ], texture). */
export function getLinesForState(
  state: LivingAsciiState,
  slice: VehicleAsciiSlice,
  pulse?: AuctionPulseSlice | null,
  formatCurrency?: (n: number | null | undefined) => string
): string[] {
  const identityLine = getIdentityLine(slice);
  const shapeKey = getShapeKey(slice);
  switch (state) {
    case 'shape':
      return cursorStyleShape(identityLine, shapeKey);
    case 'identity':
      return cursorStyleIdentity(identityLine);
    case 'pulse': {
      const displayState = getDisplayState(slice, pulse);
      const line = getPulseLine(slice, displayState, pulse, formatCurrency);
      return cursorStylePulse(line ? line : '—');
    }
    default:
      return cursorStyleShape(identityLine, shapeKey);
  }
}
