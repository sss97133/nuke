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
  // fetched in a second pass, only for rows that pass the sold rule: the BaT
  // write-up (extraction_metadata raw_listing_description) or, failing that,
  // vehicles.description — a ~480-char summary by design
  description?: string | null;
  description_source?: WriteUpSource | null;
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

import type { WriteUpSource } from './writeUps';

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
  /** which text the claims were read from; null until write-ups are merged */
  textSource: WriteUpSource | null;
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
      textSource: v && v.description !== undefined ? (v.description_source ?? null) : null,
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

/** A published sale presentation, separate from a vehicle's mutable current price. */
export interface DatedSourceSale {
  vehicleId: string | null;
  sourceUrl: string | null;
  amount: number | null;
  outcome: 'sold' | 'not_sold' | 'unknown';
  /** Source event timestamp or ISO date; a date is an interval, never midnight testimony. */
  eventAt: string | null;
  /** When this specific sourced amount/outcome became available, not entity created_at. */
  knownAt: string | null;
  currency: string | null;
  priceBasis: 'published_bid_excluding_fees' | 'buyer_total' | null;
  /** Source attribution for currency and price basis; no platform-wide USD default. */
  unitSource: string | null;
  conditionEvidence: 'listing_claim' | 'structured' | 'visual' | 'unknown';
}

export interface SaleComparisonOptions {
  cohort: { key: string; label: string; basis: string; complete: boolean };
  subject: { amount: number | null; currency: string | null; priceBasis: DatedSourceSale['priceBasis']; sourceUrl?: string | null; vehicleId?: string | null };
  eventFrom: string;
  /** Exclusive source-event cutoff; do not include subject or later sales. */
  eventBefore: string;
  evidenceAsOf: string;
  computedAt: string;
  knowledgeMode: 'retrospective' | 'known_at';
  minimumSales?: number;
}

type SaleExclusion = 'subject' | 'source_unknown' | 'duplicate_conflict' | 'not_sold' | 'price_unknown'
  | 'event_unknown' | 'outside_event_window' | 'unknown_units' | 'different_units' | 'knowledge_unknown' | 'knowledge_conflicting' | 'learned_later';

/** Canonical source presentation key; aliases and fragments must not count twice. */
function saleSourceKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const rawPath = u.pathname.replace(/\/+$/, '');
    const path = host === 'bringatrailer.com' ? rawPath.toLowerCase() : rawPath;
    return host && path ? `${host}${path}` : null;
  } catch { return null; }
}

function sourceEventInterval(raw: string | null): [number, number] | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const start = Date.parse(`${raw}T00:00:00Z`);
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== raw) return null;
    return [start, start + 86_400_000];
  }
  // A source timestamp needs an explicit zone; browser-local time is not evidence.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const day = raw.slice(0, 10);
  const calendar = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? [time, time] : null;
}

/**
 * General cohort calculator; independent of the 914-specific buildCompSet recipe.
 * Returns the exact evidence rows and refusals behind an empirical mid-rank.
 * Nominal original currency, with no inflation/FX/fee or condition adjustment.
 * This is a price position in recorded sales, not a value estimate or bid advice.
 */
export function comparePriceToSourceSales(rows: readonly DatedSourceSale[], opts: SaleComparisonOptions) {
  const from = sourceEventInterval(opts.eventFrom)?.[0];
  const before = sourceEventInterval(opts.eventBefore)?.[0];
  const knownBefore = sourceEventInterval(opts.evidenceAsOf)?.[0];
  const computed = sourceEventInterval(opts.computedAt)?.[0];
  const reasons: string[] = [];
  if (!opts.cohort.complete) reasons.push('cohort_incomplete');
  if (from == null || before == null || knownBefore == null || computed == null || from >= before || knownBefore > computed || before > computed) reasons.push('invalid_cutoffs');
  if (opts.knowledgeMode === 'known_at' && before != null && knownBefore != null && knownBefore > before) reasons.push('knowledge_after_comparison');
  const subject = opts.subject;
  if (subject.amount == null || !Number.isFinite(subject.amount) || subject.amount <= 0 || !subject.currency || !subject.priceBasis) reasons.push('subject_price_or_units_unknown');
  const groups = new Map<string, DatedSourceSale[]>();
  const excluded: Array<{ sourceKey: string | null; vehicleIds: Array<string | null>; reason: SaleExclusion }> = [];
  const eligible: Array<DatedSourceSale & { sourceKey: string }> = [];
  const subjectKey = saleSourceKey(subject.sourceUrl);
  for (const row of rows) {
    const key = saleSourceKey(row.sourceUrl);
    if (!key) { excluded.push({ sourceKey: null, vehicleIds: [row.vehicleId], reason: 'source_unknown' }); continue; }
    const group = groups.get(key) || []; group.push(row); groups.set(key, group);
  }
  for (const [sourceKey, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const exclude = (reason: SaleExclusion) => excluded.push({ sourceKey, vehicleIds: group.map(r => r.vehicleId), reason });
    if (sourceKey === subjectKey || (subject.vehicleId && group.some(r => r.vehicleId === subject.vehicleId))) { exclude('subject'); continue; }
    const boundaryClaims = group.filter(r => {
      const event = sourceEventInterval(r.eventAt), clock = sourceEventInterval(r.knownAt)?.[0];
      return event && from != null && before != null && event[0] >= from && event[0] < before && event[1] <= before
        && clock != null && clock >= event[0] && knownBefore != null && clock <= knownBefore
        && r.currency && r.priceBasis && saleSourceKey(r.unitSource) === sourceKey;
    });
    // Later evidence cannot change a historical receipt by introducing an alias conflict.
    const claims = boundaryClaims.length ? boundaryClaims : group;
    // A duplicate never wins by row ordering; different known price/date/unit/outcome evidence is unresolved.
    const values = <K extends keyof DatedSourceSale>(key: K) => new Set(claims.map(r => r[key]).filter(v => v != null));
    if (['amount', 'eventAt', 'currency', 'priceBasis', 'outcome'].some(k => values(k as keyof DatedSourceSale).size > 1)) { exclude('duplicate_conflict'); continue; }
    const preferred = [...claims].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const row = { ...(preferred.find(r => r.amount != null && r.eventAt) || preferred[0]) };
    if (row.outcome !== 'sold') { exclude('not_sold'); continue; }
    if (row.amount == null || !Number.isFinite(row.amount) || row.amount <= 0) { exclude('price_unknown'); continue; }
    const interval = sourceEventInterval(row.eventAt);
    if (!interval) { exclude('event_unknown'); continue; }
    if (from == null || before == null || interval[0] < from || interval[0] >= before || interval[1] > before) { exclude('outside_event_window'); continue; }
    // Use a complete, attributed unit record; never combine partial unit guesses across rows.
    const attributedRows = preferred.filter(r => r.amount === row.amount && r.eventAt === row.eventAt && r.currency && r.priceBasis && saleSourceKey(r.unitSource) === sourceKey);
    const attributed = attributedRows[0];
    if (!attributed) { exclude('unknown_units'); continue; }
    Object.assign(row, { currency: attributed.currency, priceBasis: attributed.priceBasis, unitSource: attributed.unitSource });
    if (row.currency !== subject.currency || row.priceBasis !== subject.priceBasis) { exclude('different_units'); continue; }
    const knownTimes = attributedRows.map(r => sourceEventInterval(r.knownAt)?.[0]).filter((t): t is number => t != null);
    if (knownTimes.some(t => t < interval[0])) { exclude('knowledge_conflicting'); continue; }
    if (!knownTimes.length) { exclude('knowledge_unknown'); continue; }
    // Even retrospective reports cannot use evidence learned after their declared knowledge cutoff.
    if (knownTimes.length && (knownBefore == null || Math.min(...knownTimes) > knownBefore)) { exclude('learned_later'); continue; }
    row.knownAt = knownTimes.length ? new Date(Math.min(...knownTimes)).toISOString() : null;
    eligible.push({ ...row, sourceKey });
  }
  const minimum = opts.minimumSales ?? 10;
  if (!Number.isInteger(minimum) || minimum < 2) reasons.push('invalid_minimum');
  if (eligible.length < minimum) reasons.push('insufficient_sales');
  const prices = eligible.map(r => r.amount!);
  const below = prices.filter(p => p < (subject.amount ?? NaN)).length;
  const equal = prices.filter(p => p === subject.amount).length;
  const ordered = [...prices].sort((a,b) => a-b);
  const continuous = (p: number) => {
    if (!ordered.length) return null;
    const rank = (ordered.length-1)*p, lower = Math.floor(rank), upper = Math.ceil(rank);
    return ordered[lower]+(ordered[upper]-ordered[lower])*(rank-lower);
  };
  const summary: Summary = { n: prices.length, min: ordered[0] ?? null, max: ordered[ordered.length-1] ?? null,
    p10: continuous(.1), p25: continuous(.25), p50: continuous(.5), p75: continuous(.75), p90: continuous(.9) };
  return {
    method: 'source_sale_price_midrank_v1' as const,
    quantileMethod: 'continuous_linear_interpolation' as const,
    cohort: { ...opts.cohort },
    subject: { ...subject },
    eventFrom: opts.eventFrom, eventBefore: opts.eventBefore, evidenceAsOf: opts.evidenceAsOf, computedAt: opts.computedAt,
    knowledgeMode: opts.knowledgeMode,
    priceAdjustment: 'nominal_original_currency_no_fees_fx_or_inflation' as const,
    conditionAdjustedAssessment: 'unmeasured' as const,
    reasons,
    counts: { inputRows: rows.length, sourceLots: groups.size, eligibleSales: eligible.length, below, equal, above: eligible.length - below - equal,
      knowledgeUnknown: eligible.filter(r => !r.knownAt).length,
      conditionListingClaims: eligible.filter(r => r.conditionEvidence === 'listing_claim').length,
      conditionStructured: eligible.filter(r => r.conditionEvidence === 'structured').length,
      conditionVisual: eligible.filter(r => r.conditionEvidence === 'visual').length,
      conditionUnknown: eligible.filter(r => r.conditionEvidence === 'unknown').length },
    percentile: reasons.length ? null : 100 * (below + equal / 2) / eligible.length,
    distribution: reasons.length ? null : summary,
    eligible, excluded,
  };
}

export interface SaleCaptureRef { table: string; id: string }

export const SALE_RELEVANCE_DIMENSIONS = [
  'make', 'model', 'comparison_group', 'model_year', 'engine', 'transmission',
  'body_style', 'condition', 'region', 'provenance',
] as const;
export type SaleRelevanceDimension = typeof SALE_RELEVANCE_DIMENSIONS[number];

/** An attributed fact about this listing episode, not a current vehicle-row fact. */
export interface SaleRelevanceClaim {
  dimension: SaleRelevanceDimension;
  value: string | null;
  sourcePlatform: string | null;
  sourceEpisodeKey: string | null;
  knownAt: string | null;
  basis: string | null;
  evidenceRefs: readonly SaleCaptureRef[];
}

/**
 * Existing readers supply candidates and independently supported qualifications.
 * The pure selector neither admits archived material nor promotes a native row.
 * Native created_at/updated_at do not establish the claim's knownAt.
 */
export interface SourceSaleCapture extends DatedSourceSale {
  capture: SaleCaptureRef;
  sourcePlatform: string | null;
  sourceEpisodeKey: string | null;
  eventGrain: 'day' | 'instant' | null;
  eventTimeBasis: string | null;
  knownAtEvidence: string | null;
  qualification: {
    status: 'qualified' | 'candidate' | 'refused';
    basis: string | null;
    evidenceRefs: readonly SaleCaptureRef[];
  };
  relevance: readonly SaleRelevanceClaim[];
}

export interface SalePopulationOptions {
  population: { key: string; label: string; basis: string; complete: boolean };
  subject: {
    sourcePlatform: string | null;
    sourceEpisodeKey: string | null;
    vehicleId: string | null;
    currency: string | null;
    priceBasis: DatedSourceSale['priceBasis'];
    relevance: readonly SaleRelevanceClaim[];
  };
  /** Explicit matching policy; no default year-first trim or inferred weights. */
  policy: { key: string; basis: string; requiredDimensions: readonly SaleRelevanceDimension[] };
  eventFrom: string;
  eventBefore: string;
  evidenceAsOf: string;
  computedAt: string;
  knowledgeMode: 'retrospective' | 'known_at';
  minimumMatchedSales: number;
}

export type SalePopulationExclusion = 'capture_ref_unknown' | 'source_unknown' | 'candidate_unqualified'
  | 'qualification_refused' | 'qualification_evidence_unknown' | 'event_unknown' | 'event_grain_conflict'
  | 'outside_event_window' | 'knowledge_unknown' | 'knowledge_conflicting' | 'learned_later'
  | 'outcome_unknown' | 'not_sold' | 'price_unknown' | 'unknown_units' | 'invalid_cutoffs';

export interface QualifiedSaleEpisode {
  sourceKey: string;
  sourcePlatform: string;
  sourceEpisodeKey: string;
  vehicleId: string | null;
  sourceUrls: string[];
  amount: number;
  currency: string;
  priceBasis: NonNullable<DatedSourceSale['priceBasis']>;
  eventAt: string;
  eventGrain: 'day' | 'instant';
  eventInterval: { from: string; before: string };
  knownAt: string;
  /** Every agreeing presentation, including independent snapshot refs. */
  captures: SourceSaleCapture[];
}

const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const refKey = (r: SaleCaptureRef): string => JSON.stringify([r.table, r.id]);
const validRef = (r: SaleCaptureRef): boolean => !!r.table?.trim() && !!r.id?.trim();
const episodeKey = (platform: string | null, key: string | null): string | null =>
  platform?.trim() && key?.trim() ? JSON.stringify([platform, key]) : null;

/** Object property order must not decide which capture is displayed first. */
function saleStableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(saleStableKey).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => lexical(a, b))
    .map(([k, v]) => `${JSON.stringify(k)}:${saleStableKey(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

/** BaT's known aliases collapse; other sources retain query-based lot identity. */
function populationSourceKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    if (!path) return null;
    if (host === 'bringatrailer.com' && /^\/listing\/[^/]+$/i.test(path)) return `${host}${path.toLowerCase()}`;
    url.searchParams.sort();
    return `${host}${url.port ? `:${url.port}` : ''}${path}${url.search}`;
  } catch { return null; }
}

function saleInstant(raw: string | null): number | null {
  const interval = sourceEventInterval(raw);
  return interval && interval[0] === interval[1] ? interval[0] : null;
}

function continuousSaleSummary(values: readonly number[]): Summary {
  const ordered = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    if (!ordered.length) return null;
    const rank = (ordered.length - 1) * p, lower = Math.floor(rank), upper = Math.ceil(rank);
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (rank - lower);
  };
  return { n: ordered.length, min: ordered[0] ?? null, max: ordered[ordered.length - 1] ?? null,
    p10: q(.1), p25: q(.25), p50: q(.5), p75: q(.75), p90: q(.9) };
}

/**
 * V2 population contract, deliberately not wired to /valuation yet.
 * No input cap, price floor, inferred cohort, weighting or under/over conclusion.
 * Broad unit strata and explicitly matched sales are different denominators.
 */
export function selectSourceSalePopulation(rows: readonly SourceSaleCapture[], opts: SalePopulationOptions) {
  const from = sourceEventInterval(opts.eventFrom)?.[0], before = sourceEventInterval(opts.eventBefore)?.[0];
  const asOf = saleInstant(opts.evidenceAsOf), computed = saleInstant(opts.computedAt);
  const reasons: string[] = [];
  const validCutoffs = from != null && before != null && asOf != null && computed != null
    && from < before && before <= computed && asOf <= computed
    && (opts.knowledgeMode !== 'known_at' || asOf <= before);
  if (!validCutoffs) reasons.push('invalid_cutoffs');
  if (!opts.population.complete) reasons.push('population_incomplete');
  if (!opts.population.key.trim() || !opts.population.basis.trim()) reasons.push('population_scope_unknown');
  const required = [...new Set(opts.policy.requiredDimensions)].sort(lexical);
  const validPolicy = !!opts.policy.key.trim() && !!opts.policy.basis.trim() && required.length > 0
    && required.every(d => SALE_RELEVANCE_DIMENSIONS.includes(d));
  if (!validPolicy) reasons.push('matching_policy_unknown');
  if (!Number.isInteger(opts.minimumMatchedSales) || opts.minimumMatchedSales < 2) reasons.push('invalid_minimum');
  const subjectKey = episodeKey(opts.subject.sourcePlatform, opts.subject.sourceEpisodeKey);
  if (!subjectKey) reasons.push('subject_episode_unknown');
  if (!opts.subject.currency || !opts.subject.priceBasis) reasons.push('subject_units_unknown');

  const ordered = [...rows].sort((a, b) => lexical(refKey(a.capture), refKey(b.capture)) || lexical(saleStableKey(a), saleStableKey(b)));
  const candidates = new Map<string, { sourceKey: string; captures: SourceSaleCapture[];
    excluded: Array<{ capture: SaleCaptureRef; reason: SalePopulationExclusion }> }>();
  const admitted = new Map<string, SourceSaleCapture[]>();
  for (const row of ordered) {
    const key = episodeKey(row.sourcePlatform, row.sourceEpisodeKey);
    // Unknown identity stays separate by presentation; no invented vehicle episode.
    const auditKey = key ?? `unresolved:${refKey(row.capture)}`;
    const candidate = candidates.get(auditKey) ?? { sourceKey: auditKey, captures: [], excluded: [] };
    candidate.captures.push(row); candidates.set(auditKey, candidate);
    const reject = (reason: SalePopulationExclusion) => candidate.excluded.push({ capture: { ...row.capture }, reason });
    if (!validRef(row.capture)) { reject('capture_ref_unknown'); continue; }
    if (!key || !populationSourceKey(row.sourceUrl)) { reject('source_unknown'); continue; }
    if (!validCutoffs) { reject('invalid_cutoffs'); continue; }
    if (row.qualification.status !== 'qualified') {
      reject(row.qualification.status === 'refused' ? 'qualification_refused' : 'candidate_unqualified'); continue;
    }
    if (!row.qualification.basis?.trim() || !row.qualification.evidenceRefs.length
      || row.qualification.evidenceRefs.some(r => !validRef(r))) { reject('qualification_evidence_unknown'); continue; }
    const interval = sourceEventInterval(row.eventAt);
    if (!interval || !row.eventTimeBasis?.trim()) { reject('event_unknown'); continue; }
    if (row.eventGrain !== (interval[0] === interval[1] ? 'instant' : 'day')) { reject('event_grain_conflict'); continue; }
    const known = saleInstant(row.knownAt);
    if (known == null || !row.knownAtEvidence?.trim()) { reject('knowledge_unknown'); continue; }
    if (known < interval[0]) { reject('knowledge_conflicting'); continue; }
    if (known > asOf!) { reject('learned_later'); continue; }
    if (interval[0] < from! || interval[0] >= before! || interval[1] > before!) { reject('outside_event_window'); continue; }
    if (row.outcome === 'unknown') { reject('outcome_unknown'); continue; }
    if (row.amount == null || !Number.isFinite(row.amount) || row.amount <= 0) { reject('price_unknown'); continue; }
    if (!row.currency || !/^[A-Z]{3}$/.test(row.currency) || !row.priceBasis
      || populationSourceKey(row.unitSource) !== populationSourceKey(row.sourceUrl)) { reject('unknown_units'); continue; }
    const group = admitted.get(key) ?? []; group.push(row); admitted.set(key, group);
  }

  const conflicts: Array<{ sourceKey: string; dimensions: string[]; captures: SourceSaleCapture[] }> = [];
  const qualified: QualifiedSaleEpisode[] = [];
  for (const [sourceKey, captures] of [...admitted].sort(([a], [b]) => lexical(a, b))) {
    const changed: string[] = [];
    for (const field of ['outcome', 'amount', 'currency', 'priceBasis'] as const) {
      if (new Set(captures.map(r => r[field])).size > 1) changed.push(field);
    }
    if (new Set(captures.map(r => JSON.stringify(sourceEventInterval(r.eventAt)))).size > 1) changed.push('event');
    if (new Set(captures.map(r => populationSourceKey(r.sourceUrl))).size > 1) changed.push('source_url');
    const vehicles = [...new Set(captures.map(r => r.vehicleId).filter((id): id is string => !!id))].sort(lexical);
    if (vehicles.length > 1) changed.push('vehicle_identity');
    if (changed.length) { conflicts.push({ sourceKey, dimensions: changed, captures }); continue; }
    const first = captures[0];
    if (first.outcome !== 'sold') {
      for (const row of captures) candidates.get(sourceKey)!.excluded.push({ capture: { ...row.capture }, reason: 'not_sold' });
      continue;
    }
    const interval = sourceEventInterval(first.eventAt)!;
    qualified.push({ sourceKey, sourcePlatform: first.sourcePlatform!, sourceEpisodeKey: first.sourceEpisodeKey!,
      vehicleId: vehicles[0] ?? null, sourceUrls: [...new Set(captures.map(r => r.sourceUrl!))].sort(lexical),
      amount: first.amount!, currency: first.currency!, priceBasis: first.priceBasis!,
      eventAt: first.eventGrain === 'day' ? first.eventAt! : new Date(interval[0]).toISOString(), eventGrain: first.eventGrain!,
      eventInterval: { from: new Date(interval[0]).toISOString(), before: new Date(interval[1]).toISOString() },
      knownAt: new Date(captures.reduce((earliest, r) => Math.min(earliest, saleInstant(r.knownAt)!), Infinity)).toISOString(), captures });
  }

  const claimsFor = (claims: readonly SaleRelevanceClaim[], platform: string | null, key: string | null, dimension: SaleRelevanceDimension) => {
    const sourceClaims = claims.filter(c => c.dimension === dimension).sort((a, b) => lexical(saleStableKey(a), saleStableKey(b)));
    const available: SaleRelevanceClaim[] = [], unavailable: Array<{ claim: SaleRelevanceClaim; reason: string }> = [];
    for (const claim of sourceClaims) {
      const known = saleInstant(claim.knownAt);
      const reason = !platform || !key || claim.sourcePlatform !== platform || claim.sourceEpisodeKey !== key ? 'episode_unbound'
        : !claim.value?.trim() ? 'value_unknown'
        : !claim.basis?.trim() || !claim.evidenceRefs.length || claim.evidenceRefs.some(r => !validRef(r)) ? 'evidence_unknown'
        : known == null ? 'knowledge_unknown' : asOf == null || known > asOf ? 'learned_later' : null;
      if (reason) unavailable.push({ claim, reason }); else available.push(claim);
    }
    const values = [...new Set(available.map(c => c.value!))].sort(lexical);
    return { values, available, unavailable };
  };
  const comparisons = qualified.map(event => {
    const dimensions = SALE_RELEVANCE_DIMENSIONS.map(dimension => {
      const subject = claimsFor(opts.subject.relevance, opts.subject.sourcePlatform, opts.subject.sourceEpisodeKey, dimension);
      const candidate = claimsFor(event.captures.flatMap(c => [...c.relevance]), event.sourcePlatform, event.sourceEpisodeKey, dimension);
      const state = subject.values.length > 1 || candidate.values.length > 1 ? 'conflict'
        : !subject.values.length || !candidate.values.length ? 'unknown'
        : subject.values[0] === candidate.values[0] ? 'match' : 'mismatch';
      return { dimension, required: required.includes(dimension), state, subject, candidate };
    });
    const refusal: string[] = [];
    if (!validPolicy) refusal.push('matching_policy_unknown');
    if (event.sourceKey === subjectKey) refusal.push('subject_episode');
    if (event.currency !== opts.subject.currency || event.priceBasis !== opts.subject.priceBasis) refusal.push('different_units');
    for (const dimension of dimensions.filter(d => d.required && d.state !== 'match')) refusal.push(`${dimension.dimension}:${dimension.state}`);
    return { event, dimensions, reasons: refusal, matched: refusal.length === 0 };
  });
  const matched = comparisons.filter(c => c.matched).map(c => c.event);
  if (matched.length < opts.minimumMatchedSales) reasons.push('insufficient_matched_sales');

  const strata = new Map<string, { currency: string; priceBasis: QualifiedSaleEpisode['priceBasis']; events: QualifiedSaleEpisode[] }>();
  for (const event of qualified.filter(e => e.sourceKey !== subjectKey)) {
    const key = JSON.stringify([event.currency, event.priceBasis]);
    const stratum = strata.get(key) ?? { currency: event.currency, priceBasis: event.priceBasis, events: [] };
    stratum.events.push(event); strata.set(key, stratum);
  }
  const baselineRefusals = reasons.filter(r => ['invalid_cutoffs', 'population_incomplete', 'population_scope_unknown', 'subject_episode_unknown'].includes(r));
  const broadMarket = [...strata].sort(([a], [b]) => lexical(a, b)).map(([, stratum]) => ({ ...stratum,
    reasons: [...baselineRefusals], distribution: baselineRefusals.length ? null : continuousSaleSummary(stratum.events.map(e => e.amount)) }));

  const byVehicle = new Map<string, QualifiedSaleEpisode[]>();
  for (const event of qualified) if (event.vehicleId) {
    const group = byVehicle.get(event.vehicleId) ?? []; group.push(event); byVehicle.set(event.vehicleId, group);
  }
  const repeatSales: Array<{ vehicleId: string; from: QualifiedSaleEpisode; to: QualifiedSaleEpisode;
    reasons: string[]; nominalAmountChange: number | null; nominalPercentChange: number | null }> = [];
  for (const [vehicleId, group] of [...byVehicle].sort(([a], [b]) => lexical(a, b))) {
    group.sort((a, b) => lexical(a.eventInterval.from, b.eventInterval.from) || lexical(a.sourceKey, b.sourceKey));
    for (let i = 1; i < group.length; i++) {
      const earlier = group[i - 1], later = group[i], refusal: string[] = [];
      if (earlier.eventInterval.before > later.eventInterval.from || earlier.eventInterval.from === later.eventInterval.from) refusal.push('event_order_unknown');
      if (earlier.currency !== later.currency || earlier.priceBasis !== later.priceBasis) refusal.push('different_units');
      const change = refusal.length ? null : later.amount - earlier.amount;
      repeatSales.push({ vehicleId, from: earlier, to: later, reasons: refusal, nominalAmountChange: change,
        nominalPercentChange: change == null ? null : 100 * change / earlier.amount });
    }
  }

  return { method: 'source_sale_population_selection_v2' as const,
    population: { ...opts.population }, policy: { ...opts.policy, requiredDimensions: required }, subject: opts.subject,
    eventFrom: opts.eventFrom, eventBefore: opts.eventBefore, evidenceAsOf: opts.evidenceAsOf, computedAt: opts.computedAt, knowledgeMode: opts.knowledgeMode,
    priceAdjustment: 'nominal_original_currency_no_fees_fx_or_inflation' as const,
    conditionAdjustedAssessment: 'unmeasured' as const, repeatSaleInterpretation: 'observed_episode_price_change_not_market_index_return' as const,
    reasons, counts: { inputCaptures: rows.length, candidateEpisodes: candidates.size, qualifiedEpisodes: qualified.length,
      conflictedEpisodes: conflicts.length, matchedEpisodes: matched.length },
    candidates: [...candidates.values()].sort((a, b) => lexical(a.sourceKey, b.sourceKey)), conflicts, qualified,
    broadMarket, comparisons, matched, matchedDistribution: reasons.length ? null : continuousSaleSummary(matched.map(e => e.amount)), repeatSales };
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return 'n/a';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
