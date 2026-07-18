/**
 * Brand identity — the R&D core of "rebrand the whole app around any entity".
 *
 * Hypothesis (Skylar, 2026-06-16): people don't want to use *your* app, they
 * want to point at *their own* icon and say "I built this". So the app shell is
 * a field-map and ANY entity (person, shop, vehicle) projects onto it — the same
 * projection primitive as a listing, turned inward at the app itself.
 *
 * A BrandIdentity is the minimal config needed to repaint the shell:
 *   - what it's called (in-app wordmark + installed home-screen name)
 *   - what icon it wears (a real logo, or a monogram we generate on the fly)
 *   - which racing livery it runs (reuses the existing 24-accent ThemeContext)
 *
 * This is the disposable SKIN. The graph underneath stays unified — dad's app
 * still reads the whole Nuke knowledge graph, he just sees it wearing his logo.
 */

import type { AccentId } from '../contexts/ThemeContext';

export type BrandSubjectKind = 'org' | 'vehicle' | 'person' | 'synthetic';

export interface BrandIdentity {
  /** What kind of entity is wearing the app. */
  kind: BrandSubjectKind;
  /** Stable id of the underlying entity (slug, uuid) — null for synthetic demos. */
  subjectId: string | null;
  /** In-app wordmark + window title (e.g. "DESERT PERFORMANCE"). */
  name: string;
  /** Short name for the installed home-screen label (<= ~12 chars looks best). */
  shortName: string;
  /** Optional real logo to render into the icon. If absent we draw a monogram. */
  logoUrl: string | null;
  /** Racing livery — drives both the in-app accent and the icon colorway. */
  accent: AccentId;
  /** One-line tagline used as the PWA description / under the wordmark. */
  tagline: string | null;
  /** Deep link the installed icon should open to (defaults to "/"). */
  startPath: string;
}

/**
 * Icon colorway per livery. The CSS `--accent` is intentionally muted in light
 * theme (dark grey), so we keep a dedicated vivid palette for the *icon* — the
 * icon is the trophy on the home screen and must read at a glance.
 * { bg, fg } — background fill and monogram/foreground color.
 */
export const LIVERY_ICON_COLORS: Record<AccentId, { bg: string; fg: string }> = {
  neutral: { bg: '#1e1e1e', fg: '#f5f5f5' },
  gulf: { bg: '#7ad0e6', fg: '#f15a22' },
  martini: { bg: '#0a2240', fg: '#e2261c' },
  ricard: { bg: '#0033a0', fg: '#ffd100' },
  rosso: { bg: '#d40000', fg: '#ffffff' },
  brg: { bg: '#004225', fg: '#f3c300' },
  jps: { bg: '#0a0a0a', fg: '#d4af37' },
  jaeger: { bg: '#1b3a2b', fg: '#f5f5f5' },
  alitalia: { bg: '#00824a', fg: '#e2261c' },
  'bmw-m': { bg: '#0a3161', fg: '#e2261c' },
  papaya: { bg: '#ff6a13', fg: '#0a0a0a' },
  americana: { bg: '#0a2240', fg: '#e2261c' },
  'route-66': { bg: '#c8102e', fg: '#ffd100' },
  denim: { bg: '#1d3557', fg: '#e0e1dd' },
  desert: { bg: '#b07d4f', fg: '#1e140a' },
  'camo-od': { bg: '#4b5320', fg: '#e8e2c0' },
  'camo-blaze': { bg: '#ff5a00', fg: '#1e1e1e' },
  'camo-snow': { bg: '#dfe4e8', fg: '#2a2a2a' },
  'mopar-plum': { bg: '#5c1a6b', fg: '#f5f5f5' },
  'mopar-sublime': { bg: '#7ec850', fg: '#0a0a0a' },
  'mopar-hemi': { bg: '#e4572e', fg: '#0a0a0a' },
  'mopar-b5': { bg: '#1f6fd0', fg: '#ffffff' },
  'flames-heat': { bg: '#1e1e1e', fg: '#ff6a13' },
  'flames-blue': { bg: '#1e1e1e', fg: '#4ea8ff' },
};

const VALID_ACCENTS = new Set<string>(Object.keys(LIVERY_ICON_COLORS));

export function coerceAccent(v: string | null | undefined): AccentId {
  if (v && VALID_ACCENTS.has(v)) return v as AccentId;
  return 'neutral';
}

/** Initials for a monogram icon — up to 2 chars, uppercased. */
export function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
