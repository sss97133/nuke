// Shared paper appearance for the wiring workspace and connector sheets.
// Alternate shop, CAD and ledger appearances are retired. Wire-insulation
// colours remain source data and do not change with presentation.
//
// TEXT-ON-CHIP LAW (adversarial review fix, 2026-06-11): cavity letters and
// labels ALWAYS render at full contrast against their chip — pure black on
// light fills, pure white on dark fills, picked per chip LUMINANCE via
// textOn(), never per state. De-emphasis (spare / filtered / direct-feed /
// overflow) is carried ONLY by fill saturation and outline weight (hollow or
// thin ring), never by dimming the text. Enforced by the module-load assert.
//
// EVERY chrome color/font the connector-inspector renders comes from these
// tokens. The only hex literals left outside this file are physical
// wire-insulation colors (colorCodes.ts → wiringTheme.ts WIRE_COLOR_HEX):
// a TAN/WHT wire is tan and white in every theme — insulation is DATA, not
// chrome, and must never be remapped.

import { createContext, useContext } from 'react';
import type { BuildState } from './useBuildState';

export type ColorwayId = 'paper';
export type GroupKey = 'sensor' | 'drive' | 'power' | 'can' | 'spare' | 'overflow';

// Legibility floors (Skylar's readability directive, receipt 2026-06-10):
export const MIN_BODY_PX = 14;          // nothing below 14px body text
export const MIN_CAVITY_LABEL_PX = 11;  // cavity labels exempt to 11px at fit
export const MIN_CONTRAST = 4.5;        // WCAG AA ink-on-bg, every colorway

export interface Colorway {
  id: ColorwayId;
  label: string;
  // ── chrome ──
  bg: string;
  surface: string;
  elevated: string;
  gridLine: string;                // graph-paper / cell-grid line color ('' = none)
  ink: string;                     // primary text
  inkMuted: string;                // secondary labels (≥4.5:1 on bg)
  inkFaint: string;                // tertiary / disabled (exempt from floor)
  border: string;
  swatchBorder: string;            // ring around wire-insulation swatches
  accent: string;                  // selection / active
  onAccent: string;                // text on accent fills
  danger: string;
  warn: string;
  ok: string;
  okTint: string;                  // verified-row background tint
  fontBody: string;
  fontMono: string;
  // ── face ──
  faceStroke: string;              // shell / outline line-art
  functionGroupPalette: Record<GroupKey, string>; // full per-theme group remap
  faceFillOpacity: number;         // occupied cavity fill opacity (LEDGER/SHOP restrained)
  faceOccupiedStroke: 'ink' | 'group'; // occupied-cavity ring source
  monochromeFace: boolean;         // CAD: group color ONLY on hover/selection
  faceCursor: string;              // 'grab' | 'crosshair'
  // ── table / build ──
  tableStripe: string;             // zebra row ('' = none)
  barUncut: string;                // progress-bar segment color for 'uncut'
  buildState: Record<BuildState, string>;
  borderStyle: 'hairline' | 'standard'; // frame border weight: 1px vs 2px
}

// De-emphasized (spare / unoccupied) cavity fill opacity — shared across
// themes so the assert below checks exactly what FaceSkin renders.
export const SPARE_FILL_OPACITY = 0.28;

// Shared build-state hues (status semantics stay constant across themes so the
// bench operator never re-learns what yellow means).
const BUILD_STATE_SHARED: Record<BuildState, string> = {
  uncut: '#666680', cut: '#eab308', terminated_a: '#e67300',
  terminated_b: '#00aabb', routed: '#2266cc', verified: '#22c55e',
};

// ── PAPER — printed connector sheet (DEFAULT) ───────────────────────────
const PAPER: Colorway = {
  id: 'paper',
  label: 'PAPER',
  bg: '#FFFFFF',
  surface: '#F4F4F2',
  elevated: '#E9E9E5',
  gridLine: '#D7DEEC',             // faint graph-paper blue, 0.5px lines
  ink: '#111111',
  inkMuted: '#3D3D3D',
  inkFaint: '#6B6B6B',
  border: '#8A8A8A',
  swatchBorder: '#8A8A8A',
  accent: '#0044CC',               // print blue
  onAccent: '#FFFFFF',
  danger: '#B91C1C',
  warn: '#8F4700',
  ok: '#166534',
  okTint: '#EAF4EC',
  fontBody: 'Arial, Helvetica, sans-serif',
  fontMono: "'Courier New', monospace",
  faceStroke: '#222222',
  // build-sheet palette, VALUE-SPREAD per adversarial review (2026-06-11):
  // the warm pastels sat within ~0.15 luminance of each other and were
  // indistinguishable across a bench. Same hues, lightness pulled apart —
  // drive mid-value salmon, power light wheat, spare near-white; the cool
  // pair (sensor/can) got the same spread. Letters are full black on all of
  // these (textOn picks per luminance).
  functionGroupPalette: {
    sensor: '#A8C6E8', drive: '#DE8B8B', power: '#F6D9A0',
    can: '#C9EDF2', spare: '#EFEFEC', overflow: '#E67300',
  },
  faceFillOpacity: 1,
  faceOccupiedStroke: 'ink',
  monochromeFace: false,
  faceCursor: 'grab',
  tableStripe: '',
  barUncut: '#E2E2DE',
  buildState: BUILD_STATE_SHARED,
  borderStyle: 'hairline',
};

export const COLORWAYS: Record<ColorwayId, Colorway> = {
  paper: PAPER,
};
export const COLORWAY_LIST: Colorway[] = [PAPER];
export const DEFAULT_COLORWAY: ColorwayId = 'paper';
export const COLORWAY_STORAGE_KEY = 'nuke_ci_colorway';

export function isColorwayId(v: unknown): v is ColorwayId {
  return v === 'paper';
}

// ── context ─────────────────────────────────────────────────────────────
export const ColorwayContext = createContext<Colorway>(COLORWAYS[DEFAULT_COLORWAY]);
export function useColorway(): Colorway {
  return useContext(ColorwayContext);
}

// ── border helpers — borderStyle token → CSS shorthand ─────────────────
export function frameWidth(cw: Colorway): number {
  return cw.borderStyle === 'standard' ? 2 : 1;
}
export function frame(cw: Colorway): string {      // panel / control frames
  return `${frameWidth(cw)}px solid ${cw.border}`;
}
export function rule(cw: Colorway): string {       // row separators, hairlines
  return `1px solid ${cw.border}`;
}

// ── legibility floor: contrast ≥ 4.5:1, constant-time check at load ─────
function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ── text-on-chip law (adversarial review fix 2026-06-11) ────────────────
// sRGB alpha blend — what the browser actually composites for fillOpacity.
export function compositeOver(fg: string, bg: string, alpha: number): string {
  const h = (x: string) => x.replace('#', '');
  const f = h(fg), b = h(bg);
  const ch = (i: number) => Math.round(
    alpha * parseInt(f.slice(i, i + 2), 16) + (1 - alpha) * parseInt(b.slice(i, i + 2), 16),
  );
  return `#${[ch(0), ch(2), ch(4)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Pure black on light fills, pure white on dark fills — picked per chip
// LUMINANCE, never per state. Every letter/label sitting ON a colored chip
// goes through this; de-emphasis lives in the fill and the ring, not text.
export function textOn(fill: string): string {
  return contrastRatio('#000000', fill) >= contrastRatio('#ffffff', fill) ? '#000000' : '#ffffff';
}

// Text-bearing token pairs that must clear the floor in EVERY colorway.
// (inkFaint is tertiary/disabled and exempt from the floor.)
const CONTRAST_PAIRS: [keyof Colorway, keyof Colorway][] = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'elevated'],
  ['inkMuted', 'bg'], ['inkMuted', 'surface'], ['inkMuted', 'elevated'],
  ['accent', 'bg'], ['danger', 'bg'], ['warn', 'bg'], ['ok', 'bg'],
  ['onAccent', 'accent'],
];

export function assertColorwayLegibility(strict = false): string[] {
  const failures: string[] = [];
  for (const cw of COLORWAY_LIST) {
    for (const [fg, bg] of CONTRAST_PAIRS) {
      const r = contrastRatio(cw[fg] as string, cw[bg] as string);
      if (r < MIN_CONTRAST) {
        failures.push(`${cw.id}: ${fg} on ${bg} = ${r.toFixed(2)}:1 (< ${MIN_CONTRAST}:1)`);
      }
    }
    // Cavity letter vs chip fill — every group color, at every fill strength
    // FaceSkin actually renders (occupied faceFillOpacity, de-emphasized
    // SPARE_FILL_OPACITY, full-strength hover/selection reveal).
    for (const g of Object.keys(cw.functionGroupPalette) as GroupKey[]) {
      for (const alpha of [cw.faceFillOpacity, SPARE_FILL_OPACITY, 1]) {
        const chip = compositeOver(cw.functionGroupPalette[g], cw.bg, alpha);
        const r = contrastRatio(textOn(chip), chip);
        if (r < MIN_CONTRAST) {
          failures.push(`${cw.id}: cavity letter on ${g} chip (${chip} @ a=${alpha}) = ${r.toFixed(2)}:1 (< ${MIN_CONTRAST}:1)`);
        }
      }
    }
    // Build-state badge text vs badge fill (badges render on every skin).
    for (const [state, fill] of Object.entries(cw.buildState)) {
      const r = contrastRatio(textOn(fill), fill);
      if (r < MIN_CONTRAST) {
        failures.push(`${cw.id}: badge text on buildState.${state} (${fill}) = ${r.toFixed(2)}:1 (< ${MIN_CONTRAST}:1)`);
      }
    }
  }
  if (failures.length > 0) {
    if (strict) throw new Error(`Colorway legibility floor violated:\n${failures.join('\n')}`);
    // eslint-disable-next-line no-console
    console.error('Colorway legibility floor violated:', failures);
  }
  return failures;
}

// constant-time check on module load — dev console screams if a token drifts
assertColorwayLegibility(false);
