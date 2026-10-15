/**
 * The market map's color, gate and label rules (map design study, 2026-10-15: area says how big, color is one signed
 * measure centered on the right baseline, "too few" and "no data" never look like "no change", labels fit their tile
 * whole or stay silent).
 *
 * Color: a brand's or family's Bring a Trailer sales over the last 12 months against the 12 before, relative to BaT's
 * own move over the same two years ((1 + move) / (1 + BaT move) - 1), so the map shows who gained or lost share of the
 * venue rather than the venue's own growth (+12.4%, 34,598 -> 38,879 sales, read 2026-10-15). Seven stops from -50%
 * to +50%, clamped; past the clamp a tile keeps the end color and its label prints the real value.
 * Gate: at least 20 BaT sales in each year, and BaT dated sales at least half of the tile's sales; else hatched.
 */
export interface MarketCounts {
  count: number;
  dated?: number | null;
  sold_12m?: number | null;
  sold_prior_12m?: number | null;
}

export type Move =
  | { kind: 'move'; rel: number; raw: number; sold: number; prior: number }
  | { kind: 'few'; sold: number; prior: number; why: 'count' | 'share' }
  | { kind: 'none' };

export interface Baseline { sold: number; prior: number; move: number }

export const GATE_MIN = 20;
export const STOPS = [-0.5, -1 / 3, -1 / 6, 0, 1 / 6, 1 / 3, 0.5] as const;

/** BaT's own move over the two years, summed over the tiles of one partition (the brands). */
export function batBaseline(nodes: readonly MarketCounts[] | null | undefined): Baseline | null {
  let sold = 0;
  let prior = 0;
  for (const n of nodes ?? []) {
    if (n.sold_12m == null || n.sold_prior_12m == null) continue;
    sold += n.sold_12m;
    prior += n.sold_prior_12m;
  }
  return prior > 0 ? { sold, prior, move: sold / prior - 1 } : null;
}

/** `allVenues`: the tile is sized by all venues' sales, so its BaT move stands for it only when BaT holds at least
 *  half of them; sized by BaT's own 12 months, the tile is BaT's and that test does not apply. */
export function relativeMove(n: MarketCounts, base: Baseline | null, allVenues = false): Move {
  if (n.sold_12m == null || n.sold_prior_12m == null || n.sold_12m + n.sold_prior_12m === 0) return { kind: 'none' };
  const sold = n.sold_12m;
  const prior = n.sold_prior_12m;
  if (sold < GATE_MIN || prior < GATE_MIN) return { kind: 'few', sold, prior, why: 'count' };
  if (allVenues && (!n.dated || n.dated < 0.5 * n.count)) return { kind: 'few', sold, prior, why: 'share' };
  const raw = sold / prior - 1;
  return { kind: 'move', raw, rel: base ? (1 + raw) / (1 + base.move) - 1 : raw, sold, prior };
}

/** The fill for a relative move: a CSS color between the two stops around it (tokens --map-1 .. --map-7). */
export function moveFill(rel: number): string {
  const v = Math.max(STOPS[0], Math.min(STOPS[STOPS.length - 1], rel));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (v > b) continue;
    const t = (v - a) / (b - a);
    if (t <= 0.001) return `var(--map-${i + 1})`;
    if (t >= 0.999) return `var(--map-${i + 2})`;
    return `color-mix(in oklch, var(--map-${i + 1}) ${Math.round((1 - t) * 100)}%, var(--map-${i + 2}))`;
  }
  return `var(--map-${STOPS.length})`;
}

export const pct = (v: number) => (Math.round(v * 100) === 0 ? '0%' : `${v > 0 ? '▲' : '▼'}${Math.abs(Math.round(v * 100))}%`);

/** What a tile says about its move: the relative move, or the count that is too few to say, or nothing. */
export function moveText(m: Move): string {
  if (m.kind === 'move') return `${pct(m.rel)} vs BaT`;
  if (m.kind === 'few') return m.why === 'share' ? 'other venues' : `n ${Math.min(m.sold, m.prior)}`;
  return '';
}

/** Short names a tile may print when the full name does not fit (the study's curated column; to move into
 *  canonical_makes). A name with no short form is left out instead. */
export const SHORT_NAMES: Record<string, string> = {
  'Mercedes-Benz': 'Mercedes', 'Aston Martin': 'Aston', 'Alfa Romeo': 'Alfa', 'Rolls-Royce': 'Rolls',
  Volkswagen: 'VW', 'Austin-Healey': 'Healey', Oldsmobile: 'Olds', Chevrolet: 'Chevy', Lamborghini: 'Lambo',
};

export type TileClass = 'XL' | 'L' | 'M' | 'S';
export function tileClass(w: number, h: number): TileClass {
  const short = Math.min(w, h);
  const area = w * h;
  if (short >= 110 && area >= 30_000) return 'XL';
  if (short >= 60 && area >= 9_000) return 'L';
  if (short >= 34 && area >= 2_500) return 'M';
  return 'S';
}

/** The smallest name size each class may use; a name that fits only smaller is left out, never cut. */
export const NAME_MIN: Record<TileClass, number> = { XL: 16, L: 13, M: 11, S: Infinity };

let ctx: CanvasRenderingContext2D | null | undefined;
/** Width of `text` in bold Arial at 1 px (uppercase, as the tiles print names). Canvas where available, else an
 *  average uppercase glyph width. */
export function textWidth(text: string): number {
  if (ctx === undefined) {
    try { ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { ctx = null; }
  }
  if (ctx) {
    ctx.font = 'bold 100px Arial, sans-serif';
    return ctx.measureText(text.toUpperCase()).width / 100;
  }
  return text.length * 0.72;
}

/** The name's size in a tile: whole on one line, growing with the tile (0.17 of the square root of its area, at most
 *  28 px) but never under its class minimum; null when the name only fits under that minimum. */
/** The name a tile prints and its size: the full name if it fits, else its short name, else nothing. */
export function tileName(name: string, w: number, h: number, measure: (t: string) => number = textWidth): { text: string; size: number } | null {
  for (const text of [name, SHORT_NAMES[name]]) {
    if (!text) continue;
    const size = fitName(text, w, h, measure);
    if (size != null) return { text, size };
  }
  return null;
}

export function fitName(name: string, w: number, h: number, measure: (t: string) => number = textWidth): number | null {
  const cls = tileClass(w, h);
  if (cls === 'S') return null;
  const width = measure(name);
  if (!(width > 0)) return null;
  const grow = Math.max(NAME_MIN[cls], Math.min(28, 0.17 * Math.sqrt(w * h)));
  const size = Math.floor(Math.min(grow, (w - 12) / width));
  return size >= NAME_MIN[cls] ? size : null;
}

/** The map's three counted callouts (annotation layer, map design study): the clearest gain against BaT, the clearest
 *  loss, and the largest tile's move. "Clear" is the movers' test: |ln(1 + move)| at least 2 standard errors
 *  (Poisson, sqrt(1/sold + 1/prior)). Each carries its counts; none is prose. */
export interface Callout { kind: 'gain' | 'loss' | 'largest'; name: string; rel: number; sold: number; prior: number }
export function callouts<T extends MarketCounts & { name: string; usd_12m?: number | null }>(nodes: readonly T[], base: Baseline | null): Callout[] {
  const moved = nodes.map((n) => ({ n, m: relativeMove(n, base) }))
    .filter((x): x is { n: T; m: Extract<Move, { kind: 'move' }> } => x.m.kind === 'move');
  const clear = moved.filter(({ m }) => Math.abs(Math.log(1 + m.rel)) >= 2 * Math.sqrt(1 / m.sold + 1 / m.prior));
  const out: Callout[] = [];
  const gain = clear.filter(({ m }) => m.rel > 0).sort((a, b) => b.m.rel - a.m.rel)[0];
  const loss = clear.filter(({ m }) => m.rel < 0).sort((a, b) => a.m.rel - b.m.rel)[0];
  const largest = [...moved].sort((a, b) => (b.n.usd_12m ?? 0) - (a.n.usd_12m ?? 0))[0];
  if (gain) out.push({ kind: 'gain', name: gain.n.name, rel: gain.m.rel, sold: gain.m.sold, prior: gain.m.prior });
  if (loss) out.push({ kind: 'loss', name: loss.n.name, rel: loss.m.rel, sold: loss.m.sold, prior: loss.m.prior });
  if (largest && largest.n.name !== gain?.n.name && largest.n.name !== loss?.n.name) {
    out.push({ kind: 'largest', name: largest.n.name, rel: largest.m.rel, sold: largest.m.sold, prior: largest.m.prior });
  }
  return out;
}
