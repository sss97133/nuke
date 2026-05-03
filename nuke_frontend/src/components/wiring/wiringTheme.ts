// wiringTheme.ts — Shared design tokens for all wiring tabs
// Consolidates wire colors, zone colors, typography, and UI colors into one registry.
// Import from here instead of defining local copies in individual components.

import { ZONE_COLORS } from './harnessConstants';

// ── Wire color codes → hex ─────────────────────────────────────────────
// Supports direct matches (RED, BLK) and compound codes (WHT/ORG, GRN/BLK).
// When a compound code is not found directly, callers should split on '/' and
// fall back to the base color.
export const WIRE_COLOR_HEX: Record<string, string> = {
  RED: '#dc2626', BLK: '#333', WHT: '#e0e0e0', GRN: '#22c55e', BLU: '#3b82f6',
  YEL: '#eab308', ORG: '#f97316', BRN: '#92400e', VIO: '#8b5cf6', PNK: '#ec4899',
  GRY: '#9ca3af', TAN: '#d4a574',
  'LT GRN': '#86efac', 'DK GRN': '#166534', 'LT BLU': '#93c5fd', 'DK BLU': '#1e3a5f',
  'RED/WHT': '#dc2626', 'RED/BLK': '#b91c1c', 'RED/VIO': '#c026d3',
  'WHT/RED': '#fca5a5', 'WHT/GRN': '#86efac', 'WHT/BLK': '#d1d5db',
  'GRN/WHT': '#4ade80', 'GRN/BLK': '#15803d',
  'BLU/WHT': '#60a5fa', 'BLU/BLK': '#1e40af',
  'YEL/BLK': '#ca8a04',
  'BRN/WHT': '#a16207', 'ORG/WHT': '#ea580c', 'VIO/WHT': '#a78bfa',
  'PNK/BLK': '#be185d', 'GRY/BLK': '#6b7280',
  'DK BLU/WHT': '#1e3a8a', 'TAN/WHT': '#b8860b',
  'ORN': '#f97316', 'ORN/BLK': '#c2410c',
  'PPL': '#7c3aed',
  'VIO/BLU': '#6d28d9',
  'WHT/ORG': '#ea580c', 'GRN/YEL': '#84cc16', 'BLU/RED': '#7c3aed',
  'YEL/RED': '#f59e0b', 'BRN/BLK': '#78350f', 'ORG/BLK': '#c2410c',
  'PNK/WHT': '#f9a8d4', 'GRY/WHT': '#d1d5db', 'TAN/BLK': '#92400e',
};

/** Resolve wire color code to hex with compound fallback. Returns undefined on miss. */
export function wireColorHex(code: string): string | undefined {
  if (!code) return undefined;
  const direct = WIRE_COLOR_HEX[code];
  if (direct) return direct;
  const base = code.split('/')[0];
  return WIRE_COLOR_HEX[base] || undefined;
}

// ── Zone colors (re-exported from harnessConstants) ────────────────────
// Canonical source is harnessConstants.ts. Re-exported here so all wiring
// components can pull from a single import.
export { ZONE_COLORS };

// ── UI palette (matches WiringWorkspace.css dark theme) ────────────────
export const UI_COLORS = {
  bg:         '#1a1a2e',   // root background
  surface:    '#16213e',   // panel / header background
  surfaceAlt: '#111122',   // canvas viewport background
  surface2:   '#222244',   // hover row
  surface3:   '#2a2a5e',   // selected row
  text:       '#e0e0e8',   // primary text
  textDim:    '#8888aa',   // dim text
  textMuted:  '#555577',   // muted text
  border:     '#333355',   // subtle divider
  borderStrong: '#0f3460', // 2px panel borders
  accent:     '#6c8cff',   // primary accent (tab-bar active, selected)
  accentLasso:'#a78bfa',   // lasso / multi-select highlight
  accentMove: '#f97316',   // move tool
  danger:     '#dc2626',
  warn:       '#eab308',
  success:    '#22c55e',
} as const;

// ── Typography ─────────────────────────────────────────────────────────
export const TYPOGRAPHY = {
  fontFamily: 'Arial, sans-serif',
  fontMono:   '"JetBrains Mono", "Fira Code", "Courier New", monospace',
  // Size scale
  size: {
    caps:    '7px',   // smallest all-caps labels
    capsMd:  '8px',   // toolbar button labels
    capsLg:  '9px',   // stat labels
    body:    '11px',  // filter input, tooltips
    bodyMd:  '13px',  // stat values
    heading: '14px',  // section headers
  },
  letterSpacing: {
    caps: '0.5px',
    capsTight: '0.3px',
  },
} as const;

// ── Borders & spacing (per frontend.md design rules) ───────────────────
export const BORDERS = {
  width: '2px',
  widthThin: '1px',
  radius: 0,           // ZERO border-radius per design system
} as const;

export const ANIMATION = {
  transition: '180ms cubic-bezier(0.16, 1, 0.3, 1)',
} as const;
