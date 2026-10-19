// Where a classified ask lands against its own market: its model family's prices around its model year, from
// classified_ask_board's position (the listing-merit fold, mv_family_year_prices, 20261015150000): the share of those
// prices at or below the ask, read against other asks when ten exist, else against recorded sales.
// Owner, 2026-10-15: "why is that not expressed in the visualizer, cause that's our goal is to teach people the market".
// His read of three asks is the acceptance case: a $29,500 1965 Barracuda is top dollar, a $14,000 1999 Wrangler with
// 178,000 miles lands in the middle, a $3,500 1995 K1500 with 300,000 miles is at the bottom.
export type PricePopulation = {
  n: number; year_from: number | null; year_to: number | null; thin: boolean;
  p25: number | null; p50: number | null; p75: number | null; at_or_below: number | null;
  by_source?: Record<string, number> | null;
  // The odometer (20261015160000): n readings among the same rows, their median, and how many read at or below this
  // listing's miles (null under 10 readings, or when the seller disclosed a broken or rolled-over odometer).
  miles?: { n: number; p50: number | null; at_or_below: number | null } | null;
  // Each venue's count and median in the window (20261015215000; a median from 5 prices).
  venues?: Record<string, { n: number; p50: number | null }> | null;
};
export type PositionRead = {
  family: string | null;
  share?: number | null; basis?: 'asked' | 'sold' | null;
  sold?: PricePopulation | null; asked?: PricePopulation | null;
};

// The words for a share of prices at or below the ask. Measured, never a judgment of the car: the photos and the
// listing decide whether a high ask is earned.
export function placement(share: number): string {
  if (share >= 0.9) return 'top of the market';
  if (share >= 0.75) return 'upper end';
  if (share > 0.25) return 'middle of the market';
  if (share > 0.1) return 'lower end';
  return 'bottom of the market';
}

const years = (s: PricePopulation | null | undefined) => s?.year_from && s.year_to
  ? (s.year_from === s.year_to ? String(s.year_from) : `${s.year_from}–${String(s.year_to).slice(-2)}`) : null;
const money = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K` : `$${Math.round(v)}`;

// One line per population: how many of its prices the ask sits over or under, and the middle price. A thin population
// (under 10) is counted, not placed.
export function spreadLine(s: PricePopulation | null | undefined, noun: 'sales' | 'asks'): string | null {
  if (!s || s.n <= 0) return null;
  if (s.thin || s.at_or_below == null) return `only ${s.n.toLocaleString('en-US')} recorded ${s.n === 1 ? noun.slice(0, -1) : noun}`;
  const k = s.at_or_below;
  const where = k / s.n < 0.5 ? `under ${(s.n - k).toLocaleString('en-US')} of ${s.n.toLocaleString('en-US')} ${noun}`
    : `at or above ${k.toLocaleString('en-US')} of ${s.n.toLocaleString('en-US')} ${noun}`;
  return `${where}${s.p50 != null ? `, median ${money(s.p50)}` : ''}`;
}

// The headline: the reader's share and basis when it gives them, else the first population that is not thin.
export function headline(p: PositionRead | null | undefined): { word: string; basis: 'sales' | 'asks'; span: string | null } | null {
  if (!p) return null;
  if (p.share != null && p.basis) {
    const s = p.basis === 'sold' ? p.sold : p.asked;
    return { word: placement(p.share), basis: p.basis === 'sold' ? 'sales' : 'asks', span: [years(s), p.family].filter(Boolean).join(' ') || null };
  }
  for (const [s, basis] of [[p.asked, 'asks'], [p.sold, 'sales']] as const) {
    if (s && !s.thin && s.n > 0 && s.at_or_below != null) {
      return { word: placement(s.at_or_below / s.n), basis, span: [years(s), p.family].filter(Boolean).join(' ') || null };
    }
  }
  return null;
}

// How the listing's miles sit among the readings of the same population: "more miles than 55 of 62 recorded sales".
export function milesLine(s: PricePopulation | null | undefined, noun: 'sales' | 'asks'): string | null {
  const m = s?.miles;
  if (!m || m.at_or_below == null || m.n <= 0) return null;
  const k = m.at_or_below;
  const where = k / m.n >= 0.5 ? `more miles than ${k.toLocaleString('en-US')} of ${m.n.toLocaleString('en-US')} recorded ${noun}`
    : `fewer miles than ${(m.n - k).toLocaleString('en-US')} of ${m.n.toLocaleString('en-US')} recorded ${noun}`;
  return `${where}${m.p50 != null ? `, median ${Math.round(m.p50).toLocaleString('en-US')} mi` : ''}`;
}

// The venues a population's prices come from, largest first, each with its median where five prices give one:
// "BaT $14.5K (34) · Mecum $12K (9)". The comparison names its venue.
const VENUE_SHORT: Record<string, string> = {
  bat: 'BaT', bring_a_trailer: 'BaT', 'Bring a Trailer': 'BaT', facebook_marketplace: 'Facebook', 'Facebook Marketplace': 'Facebook',
  craigslist: 'Craigslist', ksl: 'KSL', mecum: 'Mecum', barrett_jackson: 'Barrett-Jackson', cars_and_bids: 'Cars & Bids',
};
export function venuesLine(s: PricePopulation | null | undefined, max = 3): string | null {
  const v = s?.venues;
  if (!v) return null;
  const parts = Object.entries(v).filter(([, x]) => x && x.n > 0).sort((a, b) => b[1].n - a[1].n).slice(0, max)
    .map(([k, x]) => `${VENUE_SHORT[k] ?? k} ${x.p50 != null ? money(x.p50) + ' ' : ''}(${x.n.toLocaleString('en-US')})`);
  return parts.length ? parts.join(' · ') : null;
}
