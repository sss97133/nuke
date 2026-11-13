/**
 * The vehicle's own theme, read from its profile row: the recorded paint sets the page accent, the make and era set
 * the motif. Rendered through the kit's existing tokens (--accent, --accent-alt, --accent-dim, --border-focus) on the
 * page container, so every kit component on that page follows without a page-local fork. Type stays Arial; the car's
 * lettering and badges come from VehicleIdentity artwork and the car's own frames, never from a substitute font.
 *
 * The tables are data with their sources. A vehicle with no matching paint keeps the site accent: no colour is guessed.
 */

export type Motif = 'none' | 'hood-bars' | 'side-stripe';
export type VehicleTheme = {
  /** 'site' when nothing matched; otherwise "<make>-<era>" or the paint's key. */
  key: string;
  accent: string | null;
  accentAlt: string | null;
  /** The recorded paint that set the accent, with its source, or null. */
  paint: { code: string | null; name: string; hex: string; source: string } | null;
  motif: Motif;
  /** How the headline treats the recorded name: a period lockup is uppercase and tight for 1960s-70s American muscle. */
  display: 'plain' | 'block';
};

type PaintRow = { make: string; years: [number, number]; code: string | null; name: string; hex: string; alt?: string; source: string };
type EraRow = { make: string; years: [number, number]; motif: Motif; display: VehicleTheme['display'] };

/**
 * Factory paints keyed by make, year range and the code or name as the row records it. hex is an approximate digital
 * reference from the cited catalogue, not a formula; the row's recorded colour text or paint code must match before
 * it is used.
 */
export const PAINTS: PaintRow[] = [
  // Pontiac code 75 (GM WA4330) Buccaneer Red, 1973-1975; approximate hex per petroljunky.com/paint-codes/pontiac/color/75-1973/buccaneer-red/
  // and paintref.com (1973 GM 75). 1975 is listed at paintscratch.com/colors/pontiac/buccaneer-red-75-1973/.
  { make: 'pontiac', years: [1973, 1975], code: '75', name: 'Buccaneer Red', hex: '#ef1707', alt: '#1c1a18', source: 'https://petroljunky.com/paint-codes/pontiac/color/75-1973/buccaneer-red/' },
];

/** Era treatments by make. A make outside its listed years gets the default. */
export const ERAS: EraRow[] = [
  { make: 'pontiac', years: [1967, 1981], motif: 'hood-bars', display: 'block' },
  { make: 'chevrolet', years: [1964, 1981], motif: 'hood-bars', display: 'block' },
  { make: 'ford', years: [1964, 1978], motif: 'hood-bars', display: 'block' },
  { make: 'dodge', years: [1966, 1974], motif: 'hood-bars', display: 'block' },
  { make: 'plymouth', years: [1966, 1974], motif: 'hood-bars', display: 'block' },
  { make: 'porsche', years: [1963, 1989], motif: 'side-stripe', display: 'plain' },
  { make: 'alfa romeo', years: [1954, 1993], motif: 'side-stripe', display: 'plain' },
];

export const SITE_THEME: VehicleTheme = { key: 'site', accent: null, accentAlt: null, paint: null, motif: 'none', display: 'plain' };

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const yearOf = (y: unknown) => { const n = typeof y === 'string' ? Number(y) : y; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const inRange = (y: number | null, r: [number, number]) => y !== null && y >= r[0] && y <= r[1];

export type ThemeSource = { make?: unknown; year?: unknown; color?: unknown; paint_code?: unknown };

/** The theme for one vehicle row. Pure, so it is testable and cheap to call in render. */
export function vehicleTheme(v: ThemeSource | null | undefined): VehicleTheme {
  if (!v) return SITE_THEME;
  const make = norm(v.make); const year = yearOf(v.year);
  const color = norm(v.color); const code = norm(v.paint_code);
  const era = ERAS.find(e => e.make === make && inRange(year, e.years));
  const paint = PAINTS.find(p => p.make === make && inRange(year, p.years)
    && ((p.code !== null && code !== '' && code === p.code.toLowerCase()) || (color !== '' && color === p.name.toLowerCase())));
  if (!era && !paint) return SITE_THEME;
  return {
    key: paint ? `${make}-${(paint.code ?? paint.name).toLowerCase().replace(/\s+/g, '-')}` : `${make}-${era!.years[0]}`,
    accent: paint?.hex ?? null,
    accentAlt: paint?.alt ?? null,
    paint: paint ? { code: paint.code, name: paint.name, hex: paint.hex, source: paint.source } : null,
    motif: era?.motif ?? 'none',
    display: era?.display ?? 'plain',
  };
}

/** The kit tokens for a container's style attribute. Nothing when the theme is the site's. */
export function themeVars(t: VehicleTheme): Record<string, string> {
  if (!t.accent) return {};
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t.accent);
  const rgb = m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
  const vars: Record<string, string> = { '--accent': t.accent, '--accent-alt': t.accentAlt ?? t.accent, '--border-focus': t.accent };
  if (rgb) { vars['--accent-dim'] = `rgba(${rgb}, 0.12)`; vars['--accent-rgb'] = rgb; }
  return vars;
}
