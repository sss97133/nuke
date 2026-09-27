/**
 * Deal read — the comp set behind a marketplace ask, built from what prod holds.
 *
 * Pure functions, no I/O, so the rule that turns database rows into "a sale"
 * can be unit-tested and read in one place.
 *
 * The rule (docs/features/ask-nuke/THEORY.md, .claude/ISSUES.md 2026-09-25):
 *   - SOLD is a STATUS: vehicles.sale_status = 'sold' OR vehicles.auction_outcome
 *     = 'sold', or bat_listings.listing_status = 'sold'. A price alone is never a
 *     sale — 30,470 unsold BaT lots carry a high bid in sale_price.
 *   - When both tables hold the lot, their sale prices must agree; a
 *     disagreement is a conflict and the lot is set aside, not averaged.
 *   - A sale needs a date to sit in a time window; undated sales are set aside.
 *   - Rows that carry a price but no outcome are UNRESOLVED. Their share of the
 *     cohort is the corpus-integrity gate: while it is high, the market figures
 *     (percentiles, medians, shares) are withheld — the rows themselves still
 *     render, because each row is a real, drillable sale record.
 *
 * Every number the deal read shows is derived here from rows it also shows.
 */

export interface VehicleCompRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  sale_price: number | null;
  sale_status: string | null;
  auction_outcome: string | null;
  sale_date: string | null;
  listing_url: string | null;
  bat_auction_url: string | null;
  discovery_url: string | null;
  bat_sold_price: number | null;
  high_bid: number | null;
  mileage: number | null;
  transmission: string | null;
  engine_size: string | null;
  engine_type: string | null;
  bat_listing_title: string | null;
  title: string | null;
  primary_image_url: string | null;
  // fetched in a second pass, only for rows that pass the sold rule
  description?: string | null;
}

export interface BatListingRow {
  id: string;
  vehicle_id: string | null;
  bat_listing_url: string | null;
  bat_listing_title: string | null;
  listing_status: string | null;
  sale_price: number | null;
  sale_date: string | null;
  auction_end_date: string | null;
}

export type EngineClass =
  | 'four_2_0'      // stock 2.0-litre flat-four (incl. replacement/rebuilt 2.0s, as the archive counts them)
  | 'four_1_7_1_8'  // stock 1.7 / 1.8 flat-four
  | 'four_other'    // a flat-four of another displacement (2.2, 2.3 … built motors)
  | 'six'           // 914/6 or a flat-six conversion
  | 'swap'          // Subaru / V8 / turbo / other conversion
  | 'unknown';      // engine not recorded in Nuke

export interface TextFeatures {
  /** false when Nuke holds only a truncated write-up (≈480 chars) — claims can't be read */
  readable: boolean;
  rustMention: boolean;
  /** project / non-running / race car — from the title even when the write-up is cut */
  project: boolean;
  restored: boolean;
  repaint: boolean;
  originalPaint: boolean;
  originalInterior: boolean;
  ac: boolean;
  cleanTitle: boolean;
  titleIssue: boolean;
}

export type SoldBasis = 'vehicles' | 'bat_listings' | 'both';

export interface Comp {
  slug: string;
  url: string;
  vehicleId: string | null;
  batListingId: string | null;
  title: string;
  year: number | null;
  price: number;
  /** ISO date (YYYY-MM-DD) — required for a comp */
  date: string;
  basis: SoldBasis;
  engine: EngineClass;
  engineText: string;
  mileage: number | null;
  transmission: string | null;
  text: TextFeatures | null;
  imageUrl: string | null;
}

export type ExclusionReason =
  | 'unresolved'          // price recorded, outcome never recorded (the contamination class)
  | 'not_sold'            // outcome recorded as unsold / reserve not met
  | 'status_conflict'     // one field says sold, another says reserve not met — the record contradicts itself
  | 'price_conflict'      // vehicles and bat_listings (or two vehicle rows) disagree on the sale price
  | 'date_conflict'       // vehicles and bat_listings disagree on the sale date by > 3 days
  | 'junk_price'          // sold under $1,000 — a parse artifact ($13 for a $13,500 car), not a car price
  | 'undated'             // sold, priced, no sale date — can't sit in a window
  | 'outside_years'       // outside the cohort's model years
  | 'title_not_model'     // a lot whose BaT title is another model (a 911 filed under 914)
  | 'six_cylinder'        // 914/6 or six conversion — a different market
  | 'engine_swap'         // Subaru / V8 / turbo conversion
  | 'engine_not_stock'    // flat-four of a non-stock displacement
  | 'engine_unknown';     // engine not recorded — can't place in the stock set

export interface Exclusion {
  slug: string;
  url: string;
  vehicleId: string | null;
  title: string;
  year: number | null;
  reason: ExclusionReason;
  detail: string;
  price: number | null;
  date: string | null;
}

export interface Gates {
  /** distinct BaT lots for the cohort years found in vehicles + bat_listings */
  lotCount: number;
  /** lots with a sale record under the sold rule (before engine filters) */
  soldCount: number;
  unresolvedCount: number;
  unresolvedShare: number;
  /** stock four-cylinder sales dated inside the trailing 12 months */
  last12moSales: number;
  maxUnresolvedShare: number;
  minLast12moSales: number;
  pass: boolean;
  reasons: string[];
}

export interface CompSet {
  /** stock four-cylinder sales that pass every rule, newest first */
  comps: Comp[];
  excluded: Exclusion[];
  gates: Gates;
  /** the model token every counted lot's title had to contain */
  modelToken: string;
  yearStart: number;
  yearEnd: number;
  asOf: string;
}

export const GATE_MAX_UNRESOLVED_SHARE = 0.05;
export const GATE_MIN_LAST_12MO_SALES = 10;

/** The lot slug of a Bring a Trailer URL, lower-cased; null for any other URL. */
export function batSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /bringatrailer\.com\/listing\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

export function batLotUrl(slug: string): string {
  return `https://bringatrailer.com/listing/${slug}/`;
}

/** Model year from a BaT slug ("1974-porsche-914-157" → 1974). */
export function yearFromSlug(slug: string): number | null {
  const m = /^(19[0-9]{2}|20[0-9]{2})-/.exec(slug);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Engine class from BaT's spec line ("2.0-Liter Flat-Four") with the lot title
 * as a tie-breaker ("914-6", "3.6L-Powered"). Same regexes the local archive
 * uses (scripts/bat-archive.sql comp_base), so the two agree lot for lot.
 */
export function classifyEngine(engineText: string | null | undefined, title: string | null | undefined): EngineClass {
  const eng = (engineText ?? '').toLowerCase();
  const ttl = (title ?? '').toLowerCase();
  if (/914[-/ ]6\b|914\/6|\bsix\b|flat-six|flat six/.test(ttl) || /six/.test(eng)) return 'six';
  if (/subaru|ej2\d|\bls\d|\bv-?8\b|chevrolet|chevy|turbo|conversion|converted/.test(eng)) return 'swap';
  if (/subaru|\bls\d|\bv-?8\b|turbo/.test(ttl)) return 'swap';
  if (eng === '') return 'unknown';
  // "2.0-Liter", "2.0L", "1,995cc" — but not "2,056cc" or "2.05", which are over-bored builds
  if (/\b2\.0(?![0-9])|1,?995\s*cc|\b1995\b/.test(eng)) return 'four_2_0';
  if (/\b1\.[78](?![0-9])/.test(eng)) return 'four_1_7_1_8';
  if (/four/.test(eng)) return 'four_other';
  return 'unknown';
}

/** Nuke holds some BaT write-ups cut at ~480 characters; those can't be read for claims. */
export const MIN_READABLE_DESCRIPTION = 600;

export function textFeatures(description: string | null | undefined, title?: string | null): TextFeatures {
  const d = (description ?? '');
  const readable = d.length >= MIN_READABLE_DESCRIPTION;
  const t = d.toLowerCase();
  // BaT titles name projects and race cars outright; that reads even when the write-up is cut
  const titleProject = /\b(project|race car|racecar|parts car)\b/.test((title ?? '').toLowerCase());
  return {
    readable,
    rustMention: readable && /rust|corrosion|corroded/.test(t),
    project: titleProject || (readable && /\b(project|non-running|not running|does not run|no longer runs|not currently running|parts car|race car)\b/.test(t)),
    restored: readable && /\b(restored|restoration|frame-off|rotisserie)\b/.test(t),
    repaint: readable && /\b(repaint|repainted|refinished|resprayed|repainting)\b/.test(t),
    originalPaint: readable && /original paint|unrestored|survivor|factory paint/.test(t),
    originalInterior: readable && /original (interior|upholstery|seats|seat upholstery)/.test(t),
    ac: readable && /air conditioning|air-conditioning|\ba\/c\b/.test(t),
    cleanTitle: readable && /clean (\w+ )?title/.test(t),
    titleIssue: readable && /salvage|rebuilt title|bill of sale|no title|lost title/.test(t),
  };
}

/** Price bracket used by the archive's comp weighting (comp_base.mbracket). */
export function mileageBracket(miles: number | null): '<25k' | '25–50k' | '50–100k' | '100k+' | null {
  if (miles == null || !isFinite(miles)) return null;
  if (miles < 25000) return '<25k';
  if (miles < 50000) return '25–50k';
  if (miles < 100000) return '50–100k';
  return '100k+';
}

const toIsoDate = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string): number =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

export interface BuildOptions {
  /** the token every lot title must contain — "914" */
  modelToken: string;
  yearStart: number;
  yearEnd: number;
  now?: Date;
}

interface LotAccumulator {
  slug: string;
  /** every live vehicle row for the lot (2,465 lots in prod have two) */
  vehicles: VehicleCompRow[];
  listings: BatListingRow[];
}

const UNSOLD_RE = /not_sold|reserve_not_met|no_sale|unsold|withdrawn|reserve not met/i;

const isUnsoldMarker = (v: VehicleCompRow): boolean =>
  UNSOLD_RE.test(v.auction_outcome ?? '') || /not_sold|unsold|withdrawn/i.test(v.sale_status ?? '');

/** Turn prod rows into the comp set plus every exclusion, one lot at a time. */
export function buildCompSet(vehicles: VehicleCompRow[], batListings: BatListingRow[], opts: BuildOptions): CompSet {
  const now = opts.now ?? new Date();
  const asOf = now.toISOString();
  const token = opts.modelToken.toLowerCase();
  const lots = new Map<string, LotAccumulator>();

  for (const v of vehicles) {
    const slug = batSlug(v.listing_url) ?? batSlug(v.bat_auction_url) ?? batSlug(v.discovery_url);
    if (!slug) continue;
    const acc = lots.get(slug) ?? { slug, vehicles: [], listings: [] };
    acc.vehicles.push(v);
    lots.set(slug, acc);
  }
  for (const b of batListings) {
    const slug = batSlug(b.bat_listing_url);
    if (!slug) continue;
    const acc = lots.get(slug) ?? { slug, vehicles: [], listings: [] };
    acc.listings.push(b);
    lots.set(slug, acc);
  }

  const comps: Comp[] = [];
  const excluded: Exclusion[] = [];
  let lotCount = 0;
  let soldCount = 0;
  let unresolvedCount = 0;

  for (const lot of lots.values()) {
    // The vehicle row that speaks for the lot: one with a sale record if any, else the first.
    const soldVehicles = lot.vehicles.filter(isSoldStatus);
    const v = soldVehicles[0] ?? lot.vehicles[0] ?? null;
    const soldListings = lot.listings.filter(l => l.listing_status === 'sold' && (l.sale_price ?? 0) > 0);
    const title = v?.bat_listing_title || v?.title || soldListings[0]?.bat_listing_title || lot.listings[0]?.bat_listing_title || '';
    const year = v?.year ?? yearFromSlug(lot.slug);
    const url = batLotUrl(lot.slug);
    const base = { slug: lot.slug, url, vehicleId: v?.id ?? null, title, year };

    // cohort years first — a 2005 Cayenne filed under "914" never counts anywhere
    if (year == null || year < opts.yearStart || year > opts.yearEnd) {
      excluded.push({ ...base, reason: 'outside_years', detail: `model year ${year ?? 'unknown'} outside ${opts.yearStart}–${opts.yearEnd}`, price: null, date: null });
      continue;
    }
    if (title && !title.toLowerCase().includes(token)) {
      excluded.push({ ...base, reason: 'title_not_model', detail: `BaT title does not say ${opts.modelToken}`, price: v?.sale_price ?? null, date: toIsoDate(v?.sale_date) });
      continue;
    }
    lotCount += 1;

    const vSold = v ? isSoldStatus(v) : false;
    const bSold = soldListings.length > 0;
    const vPrice = vSold ? (v?.sale_price ?? null) : null;
    const bPrices = Array.from(new Set(soldListings.map(l => l.sale_price as number)));
    const unsoldMarked = lot.vehicles.some(isUnsoldMarker)
      || lot.listings.some(l => UNSOLD_RE.test(l.listing_status ?? ''));

    if (!vSold && !bSold) {
      const outcome = (v?.auction_outcome ?? '').toLowerCase();
      const status = (v?.sale_status ?? '').toLowerCase();
      const priced = (v?.sale_price ?? 0) > 0 || (v?.high_bid ?? 0) > 0 || lot.listings.some(l => (l.sale_price ?? 0) > 0);
      const resolvedUnsold = unsoldMarked;
      if (resolvedUnsold) {
        excluded.push({ ...base, reason: 'not_sold', detail: `outcome ${outcome || status || 'unsold'}`, price: v?.sale_price ?? null, date: toIsoDate(v?.sale_date) });
      } else if (priced) {
        unresolvedCount += 1;
        excluded.push({ ...base, reason: 'unresolved', detail: `price recorded (${fmtMoney(v?.sale_price ?? v?.high_bid ?? lot.listings[0]?.sale_price ?? null)}), outcome not recorded — a price alone is never a sale`, price: v?.sale_price ?? v?.high_bid ?? null, date: toIsoDate(v?.sale_date) });
      }
      // no price, no outcome: an auction that never closed in Nuke — nothing to say
      continue;
    }
    soldCount += 1;

    // a record that says sold AND reserve not met contradicts itself — set aside, never averaged
    if (unsoldMarked) {
      const marker = lot.vehicles.find(isUnsoldMarker);
      excluded.push({ ...base, reason: 'status_conflict', detail: `sold per ${vSold ? 'vehicles.sale_status' : 'bat_listings'} but ${marker ? `auction_outcome ${marker.auction_outcome ?? marker.sale_status}` : 'bat_listings status'} says unsold`, price: v?.sale_price ?? bPrices[0] ?? null, date: toIsoDate(v?.sale_date) });
      continue;
    }
    // two vehicle rows for one lot must tell the same story
    if (soldVehicles.length > 1) {
      const prices = Array.from(new Set(soldVehicles.map(r => r.sale_price)));
      const dates = Array.from(new Set(soldVehicles.map(r => toIsoDate(r.sale_date)).filter((d): d is string => !!d)));
      if (prices.length > 1) {
        excluded.push({ ...base, reason: 'price_conflict', detail: `${soldVehicles.length} vehicle rows for this lot hold different sale prices: ${prices.map(fmtMoney).join(' / ')}`, price: null, date: null });
        continue;
      }
      if (dates.length > 1 && daysBetween(dates[0], dates[dates.length - 1]) > 3) {
        excluded.push({ ...base, reason: 'date_conflict', detail: `${soldVehicles.length} vehicle rows for this lot hold different sale dates: ${dates.join(' / ')}`, price: prices[0] ?? null, date: null });
        continue;
      }
    }

    // price agreement across sources
    if (bPrices.length > 1) {
      excluded.push({ ...base, reason: 'price_conflict', detail: `bat_listings holds ${bPrices.length} different sale prices: ${bPrices.map(fmtMoney).join(' / ')}`, price: null, date: null });
      continue;
    }
    if (vSold && bSold && vPrice !== bPrices[0]) {
      excluded.push({ ...base, reason: 'price_conflict', detail: `vehicles ${fmtMoney(vPrice)} vs bat_listings ${fmtMoney(bPrices[0])}`, price: null, date: null });
      continue;
    }
    const price = vSold ? vPrice : bPrices[0];
    if (price == null || price < 1000) {
      excluded.push({ ...base, reason: 'junk_price', detail: `sale price ${fmtMoney(price)} is not a car price`, price, date: toIsoDate(v?.sale_date) });
      continue;
    }

    // date agreement
    const vDate = vSold ? toIsoDate(v?.sale_date) : null;
    const bDate = bSold ? (toIsoDate(soldListings[0].sale_date) ?? toIsoDate(soldListings[0].auction_end_date)) : null;
    if (vDate && bDate && daysBetween(vDate, bDate) > 3) {
      excluded.push({ ...base, reason: 'date_conflict', detail: `vehicles ${vDate} vs bat_listings ${bDate}`, price, date: null });
      continue;
    }
    const date = vDate ?? bDate;
    if (!date) {
      excluded.push({ ...base, reason: 'undated', detail: 'sold and priced, sale date not recorded', price, date: null });
      continue;
    }

    const basis: SoldBasis = vSold && bSold ? 'both' : vSold ? 'vehicles' : 'bat_listings';
    const engineText = v?.engine_size || v?.engine_type || '';
    const engine = classifyEngine(engineText, title);
    const detailFor: Partial<Record<EngineClass, [ExclusionReason, string]>> = {
      six: ['six_cylinder', `${engineText || 'six-cylinder per title'} — 914/6 is a different market`],
      swap: ['engine_swap', engineText || 'conversion per title'],
      four_other: ['engine_not_stock', engineText],
      unknown: ['engine_unknown', 'engine not recorded in Nuke'],
    };
    const ex = detailFor[engine];
    if (ex) {
      excluded.push({ ...base, reason: ex[0], detail: ex[1], price, date });
      continue;
    }

    comps.push({
      slug: lot.slug, url, vehicleId: v?.id ?? null,
      batListingId: soldListings[0]?.id ?? null,
      title, year, price, date, basis, engine, engineText,
      mileage: v?.mileage ?? null,
      transmission: v?.transmission ?? null,
      text: v && v.description !== undefined ? textFeatures(v.description, title) : null,
      imageUrl: v?.primary_image_url ?? null,
    });
  }

  comps.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const cutoff12 = monthsAgo(now, 12);
  const last12moSales = comps.filter(c => c.date >= cutoff12).length;
  const unresolvedShare = lotCount > 0 ? unresolvedCount / lotCount : 0;
  const reasons: string[] = [];
  if (unresolvedShare > GATE_MAX_UNRESOLVED_SHARE) {
    reasons.push(`${unresolvedCount} of ${lotCount} lots (${Math.round(unresolvedShare * 100)}%) carry a price but no outcome; limit ${Math.round(GATE_MAX_UNRESOLVED_SHARE * 100)}%`);
  }
  if (last12moSales < GATE_MIN_LAST_12MO_SALES) {
    reasons.push(`${last12moSales} dated sales in the last 12 months; minimum ${GATE_MIN_LAST_12MO_SALES}`);
  }

  return {
    comps, excluded,
    gates: {
      lotCount, soldCount, unresolvedCount, unresolvedShare, last12moSales,
      maxUnresolvedShare: GATE_MAX_UNRESOLVED_SHARE, minLast12moSales: GATE_MIN_LAST_12MO_SALES,
      pass: reasons.length === 0, reasons,
    },
    modelToken: opts.modelToken, yearStart: opts.yearStart, yearEnd: opts.yearEnd, asOf,
  };
}

export function isSoldStatus(v: Pick<VehicleCompRow, 'sale_status' | 'auction_outcome'>): boolean {
  return v.sale_status === 'sold' || v.auction_outcome === 'sold';
}

export function monthsAgo(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/** Comps dated inside the trailing window, newest first. */
export function windowComps(comps: Comp[], months: number, now: Date = new Date()): Comp[] {
  const cutoff = monthsAgo(now, months);
  return comps.filter(c => c.date >= cutoff);
}

/** Discrete quantile (lower interpolation on an ascending array) — the archive's quantile_disc. */
export function quantile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Median with the even-n midpoint (DuckDB's median()) so it matches the archive figures. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Summary {
  n: number;
  min: number | null; p10: number | null; p25: number | null; p50: number | null;
  p75: number | null; p90: number | null; max: number | null;
}

export function summarize(prices: number[]): Summary {
  const s = [...prices].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0] ?? null,
    p10: quantile(s, 0.10), p25: quantile(s, 0.25), p50: median(s),
    p75: quantile(s, 0.75), p90: quantile(s, 0.90),
    max: s[s.length - 1] ?? null,
  };
}

/** Share of sales that closed below an ask (0–1); null when there are no sales. */
export function shareBelow(prices: number[], ask: number): number | null {
  if (prices.length === 0) return null;
  return prices.filter(p => p < ask).length / prices.length;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return 'n/a';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
