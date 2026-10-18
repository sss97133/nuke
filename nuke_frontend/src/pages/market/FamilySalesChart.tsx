import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import './FamilySalesChart.css';
import { LikeForLike, useFamilyIndex } from './FamilyPriceIndex';
import { getFamilyEraCohorts, matchesEraRange } from '../../lib/market/familyEras';
import {
  classifyVehicleFacets,
  isGmTruckBrand,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
  type FamilyFacetAxis,
  type VehicleIdentityMark,
} from '../familyFacetsAndEmblems';

// One model family's market as a chart, the way classic.com draws a model: every confirmed sale of the last five years
// as a dot (price against date, colored by venue) and a rolling median through them, so the trading range, the volume
// and the outliers read at a glance (owner, 2026-10-15: show real examples of data expression; this is the model page
// to build first). Reads treemap_family_sales (mv_family_sales, 20261015213000) as one jsonb value (20261015234500): a
// set would stop at the API's 1,000 rows, and the 911 alone has over 10,000 sales in five years. A dot opens its record.
export type Sale = { vehicle_id: string; sale_date: string; usd: number; source: string | null; year: number | null; model: string | null };

export const VENUES: { key: string; label: string; short: string; color: string; sources: string[] }[] = [
  { key: 'bat', label: 'BaT', short: 'BaT', color: '#2A2A2A', sources: ['Bring a Trailer'] },
  { key: 'mecum', label: 'Mecum', short: 'Mecum', color: '#C8682A', sources: ['Mecum'] },
  { key: 'bj', label: 'Barrett-Jackson', short: 'B-J', color: '#7A57C9', sources: ['Barrett-Jackson'] },
  { key: 'house', label: 'RM · Gooding · Bonhams · Broad Arrow', short: 'Houses', color: '#2D6DB5', sources: ["RM Sotheby's", 'Gooding & Co', 'Bonhams', 'Broad Arrow'] },
  { key: 'online', label: 'Cars & Bids · PCarMarket · others online', short: 'Online', color: '#2E8B66', sources: ['Cars & Bids', 'PCarMarket', 'Collecting Cars', 'SBX Cars', 'Classic.com'] },
  { key: 'other', label: 'other', short: 'other', color: '#9A9A9A', sources: [] },
];
export function venueOf(source: string | null | undefined) {
  return VENUES.find((v) => source != null && v.sources.includes(source)) ?? VENUES[VENUES.length - 1];
}

const DAY = 86_400_000;
const money = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  : v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`;

// Price ticks on a log axis: the 1-2.5-5 ladder inside the domain.
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let p = 2; p <= 8; p++) for (const m of [1, 2.5, 5]) { const v = m * 10 ** p; if (v >= lo && v <= hi) out.push(v); }
  return out;
}

// The rolling median: every 14 days, the median price of the sales within 60 days either side, where there are at
// least 5. Sales sorted by date.
/** The family's median sale over the last 365 days against the 365 before it, every venue, priced sales (null under 5 a year):
 *  what a plain median line would say, to set beside the like-for-like answer. */
export function plainMedianChange(sales: Sale[], now = Date.now()): number | null {
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const last: number[] = [], prior: number[] = [];
  for (const x of sales) {
    const t = Date.parse(x.sale_date);
    if (!Number.isFinite(t) || !(x.usd >= PRICE_FLOOR) || t > now) continue;
    if (t > now - 365 * DAY) last.push(x.usd); else if (t > now - 730 * DAY) prior.push(x.usd);
  }
  return last.length >= 5 && prior.length >= 5 ? med(last) / med(prior) - 1 : null;
}

export function rollingMedian(points: { t: number; usd: number }[], stepDays = 14, halfDays = 60, min = 5): { t: number; usd: number }[] {
  if (!points.length) return [];
  const out: { t: number; usd: number }[] = [];
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  let lo = 0, hi = 0;
  for (let t = t0; t <= t1; t += stepDays * DAY) {
    while (lo < points.length && points[lo].t < t - halfDays * DAY) lo++;
    while (hi < points.length && points[hi].t <= t + halfDays * DAY) hi++;
    if (hi - lo < min) continue;
    const w = points.slice(lo, hi).map((p) => p.usd).sort((a, b) => a - b);
    const m = w.length % 2 ? w[(w.length - 1) / 2] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2;
    out.push({ t, usd: m });
  }
  return out;
}

// BaT's median in the last 12 months against the 12 before, the move the map reads (BaT only: the venue held in full
// both years). Null when either year has under 5 BaT sales.
export function batMove(sales: Sale[], now = Date.now()): { last: number; prior: number; nLast: number; nPrior: number } | null {
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const last: number[] = [], prior: number[] = [];
  for (const s of sales) {
    if (s.source !== 'Bring a Trailer') continue;
    const age = (now - Date.parse(s.sale_date)) / DAY;
    if (age >= 0 && age < 365) last.push(s.usd); else if (age >= 365 && age < 730) prior.push(s.usd);
  }
  return last.length >= 5 && prior.length >= 5 ? { last: med(last), prior: med(prior), nLast: last.length, nPrior: prior.length } : null;
}

/** Rows asked of treemap_family_sales: its ceiling. Since 20261018183000 an absent p_limit caps the reader at 100. */
export const FAMILY_SALES_LIMIT = 15000;

function parseSaleRows(rows: unknown[]): Sale[] | null {
  const sales: Sale[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 6 || typeof r[0] !== 'string' || typeof r[1] !== 'string' || typeof r[2] !== 'number') return null;
    sales.push({ vehicle_id: r[0], sale_date: r[1], usd: r[2], source: r[3] ?? null, year: r[4] ?? null, model: r[5] ?? null });
  }
  return sales;
}

/** The reader's one value: n sales in the window, the newest `returned` of them as [vehicle_id, sale_date, usd, source,
 *  year, model] rows, and whether it held back older ones. The reader of 20261018183000 returns the rows alone (no
 *  count, no truncation flag), so a bare array of rows is read as every sale it holds. Anything else is not a read. */
export function parseFamilySales(data: unknown): { sales: Sale[]; n: number; truncated: boolean } | null {
  if (Array.isArray(data)) {
    const sales = parseSaleRows(data);
    return sales ? { sales, n: sales.length, truncated: false } : null;
  }
  const v = data as { n?: unknown; truncated?: unknown; rows?: unknown } | null;
  if (!v || typeof v !== 'object' || typeof v.n !== 'number' || !Array.isArray(v.rows)) return null;
  const sales = parseSaleRows(v.rows);
  return sales ? { sales, n: v.n, truncated: v.truncated === true } : null;
}

export type UpcomingLiveLot = {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  title: string;
  current_bid: number | null;
  ends_at: string | null;
  source_url: string | null;
  no_reserve: boolean;
  band_p10: number | null;
  band_p50: number | null;
  band_p90: number | null;
  finish_estimate: number | null;
  finish_low: number | null;
  finish_high: number | null;
  finish_grade: string | null;
  finish_model: number | null;
};

export type UpcomingCalendarLot = {
  vehicle_id: string | null;
  event_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  title: string;
  house: string | null;
  sale_name: string | null;
  run_on: string | null;
  source_url: string | null;
  estimate_low: number | null;
  estimate_high: number | null;
};

export type UpcomingClassifiedLot = {
  id: string;
  vehicle_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  title: string;
  price: number | null;
  location: string | null;
  source_url: string | null;
  scraped_at: string | null;
};

export type FamilyUpcomingSupply = {
  finish_model: number | null;
  finish_fresh: boolean;
  counts: { bat_live: number; auction_calendar: number; facebook_marketplace: number; total: number };
  live_lots: UpcomingLiveLot[];
  calendar_lots: UpcomingCalendarLot[];
  classified_lots: UpcomingClassifiedLot[];
};

const optNum = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const optStr = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);

export function parseFamilyUpcomingSupply(raw: unknown): FamilyUpcomingSupply | null {
  const v = raw as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const countsObj = v.counts as Record<string, unknown> | undefined;
  if (!countsObj || typeof countsObj !== 'object') return null;
  const liveRaw = Array.isArray(v.live_lots) ? v.live_lots : [];
  const calRaw = Array.isArray(v.calendar_lots) ? v.calendar_lots : [];
  const fbRaw = Array.isArray(v.classified_lots) ? v.classified_lots : [];

  const live_lots: UpcomingLiveLot[] = liveRaw.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const vehicle_id = optStr(o.vehicle_id);
    if (!vehicle_id) return [];
    return [{
      vehicle_id,
      year: optNum(o.year),
      make: optStr(o.make),
      model: optStr(o.model),
      title: optStr(o.title) ?? vehicle_id,
      current_bid: optNum(o.current_bid),
      ends_at: optStr(o.ends_at),
      source_url: optStr(o.source_url),
      no_reserve: o.no_reserve === true,
      band_p10: optNum(o.band_p10),
      band_p50: optNum(o.band_p50),
      band_p90: optNum(o.band_p90),
      finish_estimate: optNum(o.finish_estimate),
      finish_low: optNum(o.finish_low),
      finish_high: optNum(o.finish_high),
      finish_grade: optStr(o.finish_grade),
      finish_model: optNum(o.finish_model),
    }];
  });

  const calendar_lots: UpcomingCalendarLot[] = calRaw.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return [{
      vehicle_id: optStr(o.vehicle_id),
      event_id: optStr(o.event_id),
      year: optNum(o.year),
      make: optStr(o.make),
      model: optStr(o.model),
      title: optStr(o.title) ?? 'Scheduled lot',
      house: optStr(o.house),
      sale_name: optStr(o.sale_name),
      run_on: optStr(o.run_on),
      source_url: optStr(o.source_url),
      estimate_low: optNum(o.estimate_low),
      estimate_high: optNum(o.estimate_high),
    }];
  });

  const classified_lots: UpcomingClassifiedLot[] = fbRaw.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = optStr(o.id);
    if (!id) return [];
    return [{
      id,
      vehicle_id: optStr(o.vehicle_id),
      year: optNum(o.year),
      make: optStr(o.make),
      model: optStr(o.model),
      title: optStr(o.title) ?? 'Classified listing',
      price: optNum(o.price),
      location: optStr(o.location),
      source_url: optStr(o.source_url),
      scraped_at: optStr(o.scraped_at),
    }];
  });

  return {
    finish_model: optNum(v.finish_model),
    finish_fresh: v.finish_fresh === true,
    counts: {
      bat_live: optNum(countsObj.bat_live) ?? live_lots.length,
      auction_calendar: optNum(countsObj.auction_calendar) ?? calendar_lots.length,
      facebook_marketplace: optNum(countsObj.facebook_marketplace) ?? classified_lots.length,
      total: optNum(countsObj.total) ?? (live_lots.length + calendar_lots.length + classified_lots.length),
    },
    live_lots,
    calendar_lots,
    classified_lots,
  };
}

export function useFamilyUpcomingSupply(brand: string | null, familyKey: string | null) {
  const [supply, setSupply] = useState<FamilyUpcomingSupply | null>(null);
  useEffect(() => {
    setSupply(null);
    if (!brand || !familyKey || typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return;
    let live = true;
    Promise.resolve(supabase.rpc('treemap_family_upcoming_supply', { p_brand: brand, p_family_key: familyKey })).then(
      ({ data, error }) => {
        if (!live || error) return;
        setSupply(parseFamilyUpcomingSupply(data));
      },
      () => {},
    );
    return () => { live = false; };
  }, [brand, familyKey]);
  return supply;
}

// One read per family per page lifetime, shared by the map, the chart and the Sources board; a failed read is
// forgotten so the next mount retries.
const familySalesReads = new Map<string, Promise<{ sales: Sale[]; n: number; truncated: boolean } | null>>();
export function clearFamilySalesReads() { familySalesReads.clear(); }
export function readFamilySales(brand: string, familyKey: string): Promise<{ sales: Sale[]; n: number; truncated: boolean } | null> {
  const key = `${brand}|${familyKey}`;
  let read = familySalesReads.get(key);
  if (!read) {
    read = Promise.resolve(supabase.rpc('treemap_family_sales', { p_brand: brand, p_family_key: familyKey, p_limit: FAMILY_SALES_LIMIT })).then(
      ({ data, error }) => {
        const v = error ? null : parseFamilySales(data);
        if (!v) familySalesReads.delete(key);
        return v;
      },
      () => { familySalesReads.delete(key); return null; },
    );
    familySalesReads.set(key, read);
  }
  return read;
}

export function useFamilySales(brand: string | null, familyKey: string | null) {
  const [state, setState] = useState<{ sales: Sale[] | null; n: number; truncated: boolean; failed: boolean }>({ sales: null, n: 0, truncated: false, failed: false });
  useEffect(() => {
    setState({ sales: null, n: 0, truncated: false, failed: false });
    if (!brand || !familyKey || typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return;
    let live = true;
    readFamilySales(brand, familyKey).then((v) => {
      if (!live) return;
      setState(v ? { ...v, failed: false } : { sales: null, n: 0, truncated: false, failed: true });
    });
    return () => { live = false; };
  }, [brand, familyKey]);
  return state;
}

// The price axis starts at $500. A sale recorded under it (27 of 169,682 dated sales in five years on 2026-10-15, the
// lowest $1; for the 911 a 1989 Carrera 4 at $320) is counted in the caption and not drawn: it fell below the axis,
// and stretching the axis to it would flatten every real price.
export const PRICE_FLOOR = 500;
// Under this width the head stacks (title over the headline) and the legend takes short venue names (a 390 px phone
// wrapped the one-line head over the legend and the dots, 2026-10-15).
const NARROW = 640;

/** A sale's model-year band. Generation bounds are not in the data yet (canonical_models holds whole-model year ranges),
 *  so bands are decades, labeled as years, never with generation names. */
export function eraOf(year: number | null | undefined): string {
  return year && year >= 1886 && year <= 2100 ? `${Math.floor(year / 10) * 10}s` : 'year unknown';
}

export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** The rolling 25th, 50th and 75th percentiles: every 14 days, of the sales within 60 days either side, where at
 *  least `min` stand. Points sorted by date. */
export function rollingBand(points: { t: number; usd: number }[], stepDays = 14, halfDays = 60, min = 8) {
  const out: { t: number; p25: number; p50: number; p75: number }[] = [];
  if (!points.length) return out;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  let lo = 0, hi = 0;
  for (let t = t0; t <= t1; t += stepDays * DAY) {
    while (lo < points.length && points[lo].t < t - halfDays * DAY) lo++;
    while (hi < points.length && points[hi].t <= t + halfDays * DAY) hi++;
    if (hi - lo < min) continue;
    const w = points.slice(lo, hi).map((p) => p.usd).sort((a, b) => a - b);
    out.push({ t, p25: quantile(w, 0.25), p50: quantile(w, 0.5), p75: quantile(w, 0.75) });
  }
  return out;
}

export interface EraMove { era: string; last: number; prior: number; nLast: number; nPrior: number }
/** Each band's BaT median, last 12 months against the 12 before, where both years hold at least `min` sales. */
export function eraMoves(sales: Sale[], now = Date.now(), min = 15): EraMove[] {
  const med = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);
  const by = new Map<string, { last: number[]; prior: number[] }>();
  for (const s of sales) {
    if (s.source !== 'Bring a Trailer' || !(s.usd >= PRICE_FLOOR)) continue;
    const age = (now - Date.parse(s.sale_date)) / DAY;
    const era = eraOf(s.year);
    if (era === 'year unknown') continue;
    const b = by.get(era) ?? { last: [], prior: [] };
    if (age >= 0 && age < 365) b.last.push(s.usd); else if (age >= 365 && age < 730) b.prior.push(s.usd);
    by.set(era, b);
  }
  return [...by.entries()].filter(([, b]) => b.last.length >= min && b.prior.length >= min)
    .map(([era, b]) => ({ era, last: med(b.last), prior: med(b.prior), nLast: b.last.length, nPrior: b.prior.length }))
    .sort((a, b) => a.era.localeCompare(b.era));
}

/** The family's price move with its mix of bands held at last year's: each band's median ratio, weighted by its sales
 *  the year before. Null under two bands, where holding the mix says nothing the raw median does not. */
export function mixFixed(moves: EraMove[]): { change: number; nLast: number; nPrior: number; eras: number } | null {
  if (moves.length < 2) return null;
  const w = moves.reduce((a, m) => a + m.nPrior, 0);
  if (w <= 0) return null;
  const change = moves.reduce((a, m) => a + (m.nPrior / w) * (m.last / m.prior), 0) - 1;
  return { change, nLast: moves.reduce((a, m) => a + m.nLast, 0), nPrior: w, eras: moves.length };
}

const signed = (v: number) => (Math.round(v * 100) === 0 ? '0%' : `${v > 0 ? '▲' : '▼'}${Math.abs(Math.round(v * 100))}%`);
const P = { left: 50, right: 8, top: 18, bottom: 18 };
const MIN_BAND = 8;

const FACET_AXIS_SET = new Set<string>(['raw', 'series', 'trim', 'body']);

export interface SaleTooltipFacetPill {
  axis: 'series' | 'trim' | 'body';
  axisLabel: 'SERIES' | 'TRIM' | 'BODY';
  value: string;
}

export interface SaleTooltipFacetSummary {
  rawSubModel: string | null;
  series: string | null;
  trim: string | null;
  body: string | null;
  pills: SaleTooltipFacetPill[];
  identityMark: VehicleIdentityMark | null;
  badgeSvg: string | null;
}

export interface FacetCohortBucket {
  label: string;
  count: number;
  shareRatio: number;
  medianUsd: number | null;
  sellThroughRate: number | null;
  offeredCount: number | null;
  soldCount: number | null;
}

export interface FacetDistributionSummary {
  axis: Exclude<FamilyFacetAxis, 'raw'>;
  axisLabel: 'SERIES' | 'TRIM' | 'BODY STYLE';
  activeFacet: string | null;
  matchedCount: number;
  familyCount: number;
  shareRatio: number;
  matchedMedianUsd: number | null;
  familyMedianUsd: number | null;
  medianDeltaRatio: number | null;
  matchedSellThroughRate: number | null;
  familySellThroughRate: number | null;
  matchedOffered: number | null;
  familyOffered: number | null;
  buckets: FacetCohortBucket[];
}

export function inferActiveFacetAxis(
  selectedModel: string | null | undefined,
  explicitAxis?: FamilyFacetAxis | null,
  context?: { brand?: string | null; family?: string | null; year?: number | null },
): Exclude<FamilyFacetAxis, 'raw'> | null {
  if (explicitAxis && explicitAxis !== 'raw') return explicitAxis;
  if (!selectedModel || !selectedModel.trim()) return null;
  const trimmed = selectedModel.trim();
  const tLower = trimmed.toLowerCase();
  const cls = classifyVehicleFacets(context?.brand, context?.family, trimmed, context?.year);
  if (cls.trim && cls.trim.toLowerCase() === tLower) return 'trim';
  if (cls.body && cls.body.toLowerCase() === tLower) return 'body';
  if (cls.series && cls.series.toLowerCase() === tLower) return 'series';
  return null;
}

export function computeFacetDistributionSummary(params: {
  allSales: readonly Sale[];
  brand: string;
  family: string;
  facetAxis?: FamilyFacetAxis | null;
  selectedFacet?: string | null;
  selectedEra?: string | null;
  selectedYear?: number | null;
  familyModels?: readonly {
    name: string;
    count?: number;
    sold_any?: number | null;
    offered?: number | null;
  }[] | null;
}): FacetDistributionSummary | null {
  const {
    allSales,
    brand,
    family,
    facetAxis,
    selectedFacet,
    selectedEra,
    selectedYear,
    familyModels,
  } = params;

  const axis = inferActiveFacetAxis(selectedFacet, facetAxis, { brand, family, year: selectedYear });
  if (!axis) return null;

  // Scope family baseline sales to the same era/year window so the facet vs. family comparison is apples-to-apples
  const scopedFamilySales = allSales.filter((s) => {
    const t = Date.parse(s.sale_date);
    if (!Number.isFinite(t) || !(s.usd >= PRICE_FLOOR)) return false;
    if (selectedEra && !matchesEraRange(s.year, selectedEra)) return false;
    if (selectedYear != null && s.year !== selectedYear) return false;
    return true;
  });

  if (scopedFamilySales.length === 0) return null;

  const fallbackLabel =
    axis === 'series' ? 'Standard Series' : axis === 'trim' ? 'Base / Unbadged Trim' : 'Standard Body';

  const pickAxisFacet = (s: { model: string | null; year?: number | null }): string => {
    const cls = classifyVehicleFacets(brand, family, s.model, s.year);
    const val = axis === 'series' ? cls.series : axis === 'trim' ? cls.trim : cls.body;
    return val ?? fallbackLabel;
  };

  // Aggregate sell-through from familyModels when offered/sold_any counts are present
  const modelOutcomesByBucket = new Map<string, { sold: number; offered: number }>();
  let totalFamilySoldOutcomes = 0;
  let totalFamilyOfferedOutcomes = 0;
  if (familyModels && familyModels.length > 0) {
    for (const m of familyModels) {
      const offered = m.offered ?? null;
      const sold = m.sold_any ?? m.count ?? null;
      if (offered != null && offered > 0 && sold != null && sold >= 0) {
        totalFamilySoldOutcomes += sold;
        totalFamilyOfferedOutcomes += offered;
        const cls = classifyVehicleFacets(brand, family, m.name);
        const bLabel = (axis === 'series' ? cls.series : axis === 'trim' ? cls.trim : cls.body) ?? fallbackLabel;
        const prev = modelOutcomesByBucket.get(bLabel) ?? { sold: 0, offered: 0 };
        prev.sold += sold;
        prev.offered += offered;
        modelOutcomesByBucket.set(bLabel, prev);
      }
    }
  }

  const bucketPrices = new Map<string, number[]>();
  for (const s of scopedFamilySales) {
    const bLabel = pickAxisFacet(s);
    const arr = bucketPrices.get(bLabel) ?? [];
    arr.push(s.usd);
    bucketPrices.set(bLabel, arr);
  }

  const medianOf = (vals: readonly number[]): number | null => {
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    return Math.round(quantile(sorted, 0.5));
  };

  const familyPrices = scopedFamilySales.map((s) => s.usd);
  const familyCount = scopedFamilySales.length;
  const familyMedianUsd = medianOf(familyPrices);
  const familySellThroughRate =
    totalFamilyOfferedOutcomes > 0 ? totalFamilySoldOutcomes / totalFamilyOfferedOutcomes : null;

  const buckets: FacetCohortBucket[] = [...bucketPrices.entries()]
    .map(([label, prices]) => {
      const outcomes = modelOutcomesByBucket.get(label);
      const sellThroughRate =
        outcomes && outcomes.offered > 0 ? outcomes.sold / outcomes.offered : null;
      return {
        label,
        count: prices.length,
        shareRatio: prices.length / familyCount,
        medianUsd: medianOf(prices),
        sellThroughRate,
        offeredCount: outcomes?.offered ?? null,
        soldCount: outcomes?.sold ?? null,
      };
    })
    .sort((a, b) => b.count - a.count || (b.medianUsd ?? 0) - (a.medianUsd ?? 0));

  const trimmedFacet = selectedFacet?.trim() || null;
  const matchedBucket = trimmedFacet
    ? buckets.find((b) => b.label.toLowerCase() === trimmedFacet.toLowerCase()) ?? null
    : null;

  let matchedSales: Sale[];
  let activeFacetLabel: string | null = null;
  if (matchedBucket) {
    activeFacetLabel = matchedBucket.label;
    matchedSales = scopedFamilySales.filter(
      (s) => pickAxisFacet(s).toLowerCase() === matchedBucket.label.toLowerCase(),
    );
  } else if (trimmedFacet) {
    activeFacetLabel = trimmedFacet;
    matchedSales = filterSalesBySubModel(scopedFamilySales, trimmedFacet, { brand, family });
  } else {
    activeFacetLabel = null;
    matchedSales = scopedFamilySales;
  }

  const matchedPrices = matchedSales.map((s) => s.usd);
  const matchedCount = matchedSales.length;
  const matchedMedianUsd = medianOf(matchedPrices);
  const medianDeltaRatio =
    matchedMedianUsd != null && familyMedianUsd != null && familyMedianUsd > 0
      ? matchedMedianUsd / familyMedianUsd - 1
      : null;

  const matchedOutcomes = activeFacetLabel ? modelOutcomesByBucket.get(activeFacetLabel) : null;
  const matchedSellThroughRate =
    matchedOutcomes && matchedOutcomes.offered > 0
      ? matchedOutcomes.sold / matchedOutcomes.offered
      : familySellThroughRate;

  const axisLabel =
    axis === 'series' ? 'SERIES' : axis === 'trim' ? 'TRIM' : 'BODY STYLE';

  return {
    axis,
    axisLabel,
    activeFacet: activeFacetLabel,
    matchedCount,
    familyCount,
    shareRatio: familyCount > 0 ? matchedCount / familyCount : 0,
    matchedMedianUsd,
    familyMedianUsd,
    medianDeltaRatio,
    matchedSellThroughRate,
    familySellThroughRate,
    matchedOffered: matchedOutcomes?.offered ?? null,
    familyOffered: totalFamilyOfferedOutcomes > 0 ? totalFamilyOfferedOutcomes : null,
    buckets,
  };
}

/**
 * Derives a sale record's sub-model label along the requested facet axis ('raw' | 'series' | 'trim' | 'body').
 * - 'raw': strips any enriched " · <listing_title>" suffix and returns the base model token (or family fallback).
 * - 'series' | 'trim' | 'body': classifies the sale via `classifyVehicleFacets` and returns that axis's facet
 *   when present, falling back to the raw sub-model string when the sale has no distinct facet on that axis.
 */
export function deriveSaleSubModel(
  saleOrModel: { model: string | null; year?: number | null } | string | null | undefined,
  axis: FamilyFacetAxis = 'raw',
  context?: { brand?: string | null; family?: string | null; year?: number | null } | string | null,
  familyArg?: string | null,
  yearArg?: number | null,
): string | null {
  let resolvedAxis: FamilyFacetAxis = 'raw';
  let targetSaleOrModel = saleOrModel;

  if (
    typeof saleOrModel === 'string' &&
    FACET_AXIS_SET.has(saleOrModel) &&
    (axis === undefined ||
      typeof axis === 'object' ||
      (typeof axis === 'string' && !FACET_AXIS_SET.has(axis)))
  ) {
    resolvedAxis = saleOrModel as FamilyFacetAxis;
    targetSaleOrModel = axis as { model: string | null; year?: number | null } | string | null | undefined;
  } else if (typeof axis === 'string' && FACET_AXIS_SET.has(axis)) {
    resolvedAxis = axis;
  }

  const ctx =
    typeof context === 'string' || context === null
      ? { brand: context, family: familyArg ?? null, year: yearArg ?? null }
      : context;

  const rawModel =
    typeof targetSaleOrModel === 'object' && targetSaleOrModel !== null
      ? (targetSaleOrModel.model ?? '')
      : (targetSaleOrModel ?? '');
  const year =
    (typeof targetSaleOrModel === 'object' && targetSaleOrModel !== null && 'year' in targetSaleOrModel
      ? targetSaleOrModel.year
      : undefined) ??
    ctx?.year ??
    null;

  const trimmed = rawModel.trim();
  const canonicalRaw = trimmed ? trimmed.split(' · ')[0].trim() : ((ctx?.family ?? '').trim() || null);
  if (resolvedAxis === 'raw') {
    return canonicalRaw || null;
  }

  const facets = classifyVehicleFacets(ctx?.brand, ctx?.family, trimmed, year);
  const picked =
    resolvedAxis === 'series'
      ? facets.series
      : resolvedAxis === 'trim'
        ? facets.trim
        : facets.body;

  return picked ?? canonicalRaw ?? null;
}

/**
 * Resolves the most specific period-accurate SVG identity mark for a single sale dot.
 */
export function resolveSaleIdentityMark(
  saleOrModel: { model: string | null; year?: number | null } | string | null | undefined,
  context?: { brand?: string | null; family?: string | null; year?: number | null },
): VehicleIdentityMark | null {
  const rawModel =
    typeof saleOrModel === 'object' && saleOrModel !== null
      ? (saleOrModel.model ?? '')
      : (saleOrModel ?? '');
  const year =
    (typeof saleOrModel === 'object' && saleOrModel !== null && 'year' in saleOrModel
      ? saleOrModel.year
      : undefined) ??
    context?.year ??
    null;
  const brand = context?.brand ?? null;
  const family = context?.family ?? null;
  if (!brand) return null;

  const cls = classifyVehicleFacets(brand, family, rawModel, year);
  const rawLower = rawModel.toLowerCase();
  const candidates = resolveVettedIdentityMarks({
    make: brand,
    familyLabel: family,
    model: rawModel,
    year,
  });

  const matched = candidates.filter((mark) => {
    if (mark.trimPackage) {
      const tLower = mark.trimPackage.toLowerCase();
      if (cls.trim?.toLowerCase() !== tLower && !rawLower.includes(tLower)) return false;
    }
    if (mark.bodyStyle) {
      const bLower = mark.bodyStyle.toLowerCase();
      if (!cls.body?.toLowerCase().includes(bLower) && !rawLower.includes(bLower)) return false;
    }
    if (mark.seriesCode && !mark.trimPackage) {
      const sLower = mark.seriesCode.toLowerCase();
      const clsSeries = (cls.series ?? '').toLowerCase();
      const seriesMatches =
        (clsSeries.length > 0 && (clsSeries.includes(sLower) || sLower.includes(clsSeries))) ||
        rawLower.includes(sLower);
      if (!seriesMatches) return false;
    }
    return true;
  });

  const kindPriority: Record<VehicleIdentityMark['markKind'], number> = {
    trim_badge: 1,
    series_badge: 2,
    body_silhouette: 3,
    model_wordmark: 4,
    marque_emblem: 5,
  };

  matched.sort((a, b) => {
    const pa = kindPriority[a.markKind] ?? 9;
    const pb = kindPriority[b.markKind] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.trimPackage?.length ?? 0) - (a.trimPackage?.length ?? 0);
  });

  return matched[0] ?? null;
}

/**
 * Derives the orthogonal SERIES, TRIM, and BODY facet pills (when distinct from the raw sub-model)
 * and the matching period SVG identity mark for a hovered/selected sale dot tooltip card.
 */
export function deriveSaleTooltipFacets(
  saleOrModel: { model: string | null; year?: number | null } | string | null | undefined,
  context?: { brand?: string | null; family?: string | null; year?: number | null },
): SaleTooltipFacetSummary {
  const rawModel =
    typeof saleOrModel === 'object' && saleOrModel !== null
      ? (saleOrModel.model ?? '')
      : (saleOrModel ?? '');
  const year =
    (typeof saleOrModel === 'object' && saleOrModel !== null && 'year' in saleOrModel
      ? saleOrModel.year
      : undefined) ??
    context?.year ??
    null;
  const brand = context?.brand ?? null;
  const family = context?.family ?? null;

  const rawSubModel = deriveSaleSubModel(saleOrModel, 'raw', { brand, family, year });
  const rawNorm = (rawSubModel ?? '').trim().toLowerCase();

  const seriesVal = deriveSaleSubModel(saleOrModel, 'series', { brand, family, year });
  const trimVal = deriveSaleSubModel(saleOrModel, 'trim', { brand, family, year });
  const bodyVal = deriveSaleSubModel(saleOrModel, 'body', { brand, family, year });

  const series = seriesVal && seriesVal.trim().toLowerCase() !== rawNorm ? seriesVal : null;
  const trim = trimVal && trimVal.trim().toLowerCase() !== rawNorm ? trimVal : null;
  const body = bodyVal && bodyVal.trim().toLowerCase() !== rawNorm ? bodyVal : null;

  const pills: SaleTooltipFacetPill[] = [];
  if (series) pills.push({ axis: 'series', axisLabel: 'SERIES', value: series });
  if (trim) pills.push({ axis: 'trim', axisLabel: 'TRIM', value: trim });
  if (body) pills.push({ axis: 'body', axisLabel: 'BODY', value: body });

  const identityMark = resolveSaleIdentityMark(saleOrModel, { brand, family, year });
  const trimSvg = trim ? resolveTileBadgeSvg(brand, family, trim, year) : undefined;
  const seriesSvg = series ? resolveTileBadgeSvg(brand, family, series, year) : undefined;
  const bodySvg = body ? resolveTileBadgeSvg(brand, family, body, year) : undefined;
  const rawSvg = resolveTileBadgeSvg(brand, family, rawModel, year);
  const badgeSvg = identityMark?.svgMarkup ?? trimSvg ?? seriesSvg ?? bodySvg ?? rawSvg ?? null;

  return {
    rawSubModel,
    series,
    trim,
    body,
    pills,
    identityMark,
    badgeSvg,
  };
}

export function matchesSaleSubModel(
  saleModel: string | null | undefined,
  selectedModel: string | null | undefined,
  context?: { brand?: string | null; family?: string | null; year?: number | null },
): boolean {
  if (!selectedModel) return true;
  const target = selectedModel.trim().toLowerCase();
  if (!target) return true;
  const raw = (saleModel ?? '').trim();
  const m = raw.toLowerCase();
  // Strip any enriched " · <listing_title>" suffix when checking exact/prefix model name
  const canonicalModel = m.split(' · ')[0].trim();
  if (
    m === target ||
    canonicalModel === target ||
    m.startsWith(`${target} `) ||
    m.startsWith(`${target}-`) ||
    canonicalModel.startsWith(`${target} `) ||
    canonicalModel.startsWith(`${target}-`)
  ) {
    return true;
  }
  // Check orthogonal Series / Trim / Body Style facets (e.g. "C10 (1/2-Ton 2WD)", "Silverado", "Fastback", "Stepside / Flareside")
  const facets = classifyVehicleFacets(context?.brand, context?.family, raw, context?.year);
  if (
    facets.series?.toLowerCase() === target ||
    facets.trim?.toLowerCase() === target ||
    facets.body?.toLowerCase() === target
  ) {
    return true;
  }
  return false;
}

export function filterSalesBySubModel<T extends { model: string | null; year?: number | null }>(
  sales: readonly T[],
  selectedModel: string | null | undefined,
  context?: { brand?: string | null; family?: string | null },
): T[] {
  if (!selectedModel) return [...sales];
  const target = selectedModel.trim().toLowerCase();
  if (!target) return [...sales];
  const exact = sales.filter((s) => {
    const raw = (s.model ?? '').trim().toLowerCase();
    const canonical = raw.split(' · ')[0].trim();
    return raw === target || canonical === target;
  });
  if (exact.length > 0) return exact;
  return sales.filter((s) =>
    matchesSaleSubModel(s.model, selectedModel, {
      brand: context?.brand,
      family: context?.family,
      year: s.year ?? null,
    }),
  );
}

export default function FamilySalesChart({
  brand,
  familyKey,
  family,
  width,
  height,
  onOpen,
  selectedEra = null,
  onSelectEra,
  selectedModel = null,
  selectedYear = null,
  facetAxis = null,
  onSelectFacet,
  familyModels = null,
}: {
  brand: string;
  familyKey: string;
  family: string;
  width: number;
  height: number;
  onOpen: (vehicleId: string) => void;
  selectedEra?: string | null;
  onSelectEra?: (era: string | null) => void;
  selectedModel?: string | null;
  selectedYear?: number | null;
  facetAxis?: FamilyFacetAxis | null;
  onSelectFacet?: (facet: string | null) => void;
  familyModels?: readonly {
    name: string;
    count?: number;
    sold_any?: number | null;
    offered?: number | null;
  }[] | null;
}) {
  const { sales: allSales, n: windowCount, truncated, failed } = useFamilySales(brand, familyKey);
  // These readers still measure one underlying family; the Truck umbrella spans several.
  const singleFamilyBrand = isGmTruckBrand(brand) && family === 'Truck' ? null : brand;
  const upcomingSupply = useFamilyUpcomingSupply(singleFamilyBrand, familyKey);
  const [localSelectedFacet, setLocalSelectedFacet] = useState<string | null>(null);
  useEffect(() => {
    setLocalSelectedFacet(null);
  }, [brand, familyKey, facetAxis, selectedModel]);
  const effectiveSelectedModel = selectedModel ?? localSelectedFacet;
  const handleSelectFacet = (nextFacet: string | null) => {
    if (onSelectFacet) {
      onSelectFacet(nextFacet);
    } else {
      setLocalSelectedFacet(nextFacet);
    }
  };
  const filteredSupply = useMemo(() => {
    if (!upcomingSupply) return null;
    const matchFilter = (yr: number | null, mdl: string | null) => {
      if (effectiveSelectedModel && !matchesSaleSubModel(mdl, effectiveSelectedModel, { brand, family, year: yr })) return false;
      if (selectedEra && !matchesEraRange(yr, selectedEra)) return false;
      if (selectedYear != null && yr !== selectedYear) return false;
      return true;
    };
    const live_lots = upcomingSupply.live_lots.filter((l) => matchFilter(l.year, l.model));
    const calendar_lots = upcomingSupply.calendar_lots.filter((l) => matchFilter(l.year, l.model));
    const classified_lots = upcomingSupply.classified_lots.filter((l) => matchFilter(l.year, l.model));
    const total = live_lots.length + calendar_lots.length + classified_lots.length;
    if (total === 0) return null;
    return {
      ...upcomingSupply,
      live_lots,
      calendar_lots,
      classified_lots,
      counts: {
        bat_live: live_lots.length,
        auction_calendar: calendar_lots.length,
        facebook_marketplace: classified_lots.length,
        total,
      },
    };
  }, [upcomingSupply, effectiveSelectedModel, selectedEra, selectedYear, brand, family]);
  const modelSales = useMemo(
    () => (allSales && effectiveSelectedModel ? filterSalesBySubModel(allSales, effectiveSelectedModel, { brand, family }) : null),
    [allSales, effectiveSelectedModel, brand, family],
  );
  const facetSummary = useMemo(
    () =>
      allSales
        ? computeFacetDistributionSummary({
            allSales,
            brand,
            family,
            facetAxis,
            selectedFacet: effectiveSelectedModel,
            selectedEra,
            selectedYear,
            familyModels,
          })
        : null,
    [allSales, brand, family, facetAxis, effectiveSelectedModel, selectedEra, selectedYear, familyModels],
  );
  const baseSales = modelSales && modelSales.length > 0 ? modelSales : allSales;
  const eraCohorts = useMemo(
    () => (baseSales ? getFamilyEraCohorts(brand, family, baseSales.map((s) => s.year)) : []),
    [brand, family, baseSales],
  );
  const eraFilteredSales = useMemo(
    () => (baseSales && selectedEra ? baseSales.filter((s) => matchesEraRange(s.year, selectedEra)) : baseSales),
    [baseSales, selectedEra],
  );
  const yearFilteredSales = useMemo(
    () => (eraFilteredSales && selectedYear != null ? eraFilteredSales.filter((s) => s.year === selectedYear) : null),
    [eraFilteredSales, selectedYear],
  );
  const sales = yearFilteredSales && yearFilteredSales.length > 0 ? yearFilteredSales : eraFilteredSales;
  // Same car, same miles (family_price_index_read): when the family has a fitted index, the chart is one panel of every
  // sale with the like-for-like line over it, and the head answers with its 12-month change instead of a median.
  const ix = useFamilyIndex(singleFamilyBrand, familyKey);
  const indexed = !selectedEra && !(yearFilteredSales && yearFilteredSales.length > 0) && !(modelSales && modelSales.length > 0) && !!ix && ix.series.length > 1;
  // The plain median's own 12-month change over every venue, for the sentence beside the answer when the reader has none.
  const plain = useMemo(() => (sales ? plainMedianChange(sales) : null), [sales]);
  const [hover, setHover] = useState<{ band: number; dot: number } | null>(null);
  const [refHover, setRefHover] = useState<number | null>(null);
  // Venues hidden from the legend: their dots and their share of the medians go, the axes stay.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setHidden(new Set()); }, [brand, familyKey]);
  const toggle = (key: string) => setHidden((h) => { const next = new Set(h); if (!next.delete(key)) next.add(key); return next; });
  const narrow = width < NARROW;
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const [measuredHead, setMeasuredHead] = useState(0);
  useEffect(() => {
    const el = panelsRef.current;
    if (!el) return;
    const update = () => {
      const top = el.offsetTop;
      if (top > 0) setMeasuredHead((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [sales, width, height, narrow, ix, eraCohorts.length, selectedEra]);
  const plot = useMemo(() => {
    if (!sales?.length || width < 200 || height < 160) return null;
    const dated = sales.map((s) => ({ ...s, t: Date.parse(s.sale_date) })).filter((s) => Number.isFinite(s.t) && s.usd > 0).sort((a, b) => a.t - b.t);
    const pts = dated.filter((s) => s.usd >= PRICE_FLOOR);
    if (!pts.length) return null;
    // One price axis for every panel, from the family's 1st to its 99th percentile: a few sales at the extremes no
    // longer squeeze the middle (the 911's middle 80% used 24% of the height, 2026-10-15). Sales past it sit on the
    // panel's edge as marks and are counted.
    const sorted = pts.map((p) => p.usd).sort((a, b) => a - b);
    const lo = Math.max(PRICE_FLOOR, quantile(sorted, 0.01) * 0.9), hi = quantile(sorted, 0.99) * 1.1;
    const t0 = Math.min(pts[0].t, Date.now() - 1826 * DAY), t1 = Date.now();
    const shown = hidden.size ? pts.filter((p) => !hidden.has(venueOf(p.source).key)) : pts;
    // Bands with at least MIN_BAND sales get a panel; the rest share one.
    const groups = new Map<string, typeof shown>();
    for (const p of shown) { const e = eraOf(p.year); groups.set(e, [...(groups.get(e) ?? []), p]); }
    let bands = [...groups.entries()].filter(([e, g]) => e !== 'year unknown' && g.length >= MIN_BAND).sort((a, b) => a[0].localeCompare(b[0]));
    const rest = shown.filter((p) => !bands.some(([e]) => e === eraOf(p.year)));
    // The rest (a decade with under MIN_BAND sales, or no model year) get a panel of their own only when they fill one;
    // a family with no decade that fills a panel is drawn as one panel of all its years.
    let unpanelled = 0;
    if (indexed) bands = [['all years', shown]];
    else if (!bands.length) bands = [['all years', shown]];
    else if (rest.length >= MIN_BAND) bands = [...bands, ['other years', rest]];
    else unpanelled = rest.length;
    const hasEras = Boolean(onSelectEra && eraCohorts.length >= 2);
    const readableChips = ix ? ix.segments.filter((s) => s.verdict !== 'too few to tell' && s.change != null).length : 0;
    const chipExtra = !narrow && ix && readableChips >= 2 ? (ix.segments.length > 5 ? 44 : 22) : 0;
    const eraExtra = hasEras ? (narrow ? 48 : 28) : 0;
    const fallbackHead = (ix ? (narrow ? 132 : 92) : (narrow ? 96 : 54)) + chipExtra + eraExtra;
    const head = measuredHead > 0 ? measuredHead : fallbackHead;
    const cols = narrow ? 1 : Math.min(4, bands.length);
    const rows = Math.ceil(bands.length / cols);
    const pw = Math.floor((width - (cols - 1) * 6) / cols);
    const ph = narrow ? 150 : Math.max(120, Math.floor((height - head - (rows - 1) * 6) / rows));
    const w = pw - P.left - P.right, h = ph - P.top - P.bottom;
    const x = (t: number) => P.left + ((t - t0) / (t1 - t0)) * w;
    const y = (v: number) => P.top + h - ((Math.log10(Math.min(hi, Math.max(lo, v))) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * h;
    const years: { x: number; label: string }[] = [];
    for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) years.push({ x: x(Date.UTC(yr, 0, 1)), label: `’${String(yr).slice(2)}` });
    const ticks = logTicks(lo, hi).map((v) => ({ y: y(v), label: money(v) }));
    const moves = new Map(eraMoves(sales).map((m) => [m.era, m]));
    const panels = bands.map(([era, g], i) => {
      const dots = g.map((p) => ({ ...p, cx: x(p.t), cy: y(p.usd), color: venueOf(p.source).color, out: p.usd < lo ? -1 : p.usd > hi ? 1 : 0 }));
      const band = g.length >= 40 ? rollingBand(g) : g.length >= 15 ? rollingBand(g, 14, 120, 5) : rollingBand(g, 21, 180, 3);
      const mid = band.map((b) => `${x(b.t).toFixed(1)},${y(b.p50).toFixed(1)}`);
      const area = band.length > 1 ? 'M' + band.map((b) => `${x(b.t).toFixed(1)},${y(b.p75).toFixed(1)}`).join('L')
        + 'L' + [...band].reverse().map((b) => `${x(b.t).toFixed(1)},${y(b.p25).toFixed(1)}`).join('L') + 'Z' : '';
      const liveForPanel = (filteredSupply?.live_lots ?? []).filter((l) => {
        const val = l.finish_estimate ?? l.band_p50 ?? l.current_bid;
        if (!val || val < PRICE_FLOOR) return false;
        if (era === 'all years') return true;
        if (era === 'other years') return !bands.some(([e]) => e !== 'other years' && e === eraOf(l.year));
        return eraOf(l.year) === era;
      }).slice(0, 8).map((l, idx) => {
        const est = (l.finish_estimate ?? l.band_p50 ?? l.current_bid)!;
        const loEst = l.finish_low ?? l.band_p10 ?? null;
        const hiEst = l.finish_high ?? l.band_p90 ?? null;
        const cx = P.left + w - Math.min(18, idx * 2.5);
        return {
          ...l,
          cx,
          cy: y(est),
          yLo: loEst ? y(loEst) : null,
          yHi: hiEst ? y(hiEst) : null,
          yBid: l.current_bid && l.current_bid >= PRICE_FLOOR ? y(l.current_bid) : null,
        };
      });
      return { era, dots, liveDots: liveForPanel, line: mid.length > 1 ? 'M' + mid.join('L') : '', area, move: moves.get(era) ?? null,
        firstCol: i % cols === 0, lastRow: cols === 1 || Math.floor(i / cols) === rows - 1, n: g.length };
    });
    const refPts = indexed && ix ? ix.series.filter((r) => r.t >= t0 && r.t <= t1).map((r) => ({ ...r, cx: x(r.t), cy: y(r.usd) })) : [];
    const ref = refPts.length > 1 ? {
      points: refPts,
      line: 'M' + refPts.map((r) => `${r.cx.toFixed(1)},${r.cy.toFixed(1)}`).join('L'),
      area: 'M' + refPts.map((r) => `${r.cx.toFixed(1)},${y(r.hi).toFixed(1)}`).join('L')
        + 'L' + [...refPts].reverse().map((r) => `${r.cx.toFixed(1)},${y(r.lo).toFixed(1)}`).join('L') + 'Z',
    } : null;
    const counts = VENUES.map((v) => ({ ...v, n: pts.filter((p) => venueOf(p.source).key === v.key).length })).filter((v) => v.n > 0);
    const outside = shown.filter((p) => p.usd < lo || p.usd > hi).length;
    const p25 = Math.round(quantile(sorted, 0.25));
    const p50 = Math.round(quantile(sorted, 0.5));
    const p75 = Math.round(quantile(sorted, 0.75));
    return { panels, years, ticks, counts, head, cols, pw, ph, ref, n: dated.length, under: dated.length - pts.length,
      shown: shown.length, outside, unpanelled, lo, hi, p25, p50, p75, since: new Date(dated[0].t) };
  }, [sales, width, height, hidden, narrow, ix, indexed, onSelectEra, eraCohorts.length, measuredHead, filteredSupply]);
  const move = useMemo(() => (sales ? batMove(sales) : null), [sales]);
  const held = useMemo(() => (sales ? mixFixed(eraMoves(sales)) : null), [sales]);
  const allVenueMove = useMemo(() => {
    if (!sales || move) return null;
    const now = Date.now();
    const last = sales.filter((s) => {
      const t = Date.parse(s.sale_date);
      return s.usd > 0 && t > now - 365 * DAY && t <= now;
    }).map((s) => s.usd).sort((a, b) => a - b);
    const prior = sales.filter((s) => {
      const t = Date.parse(s.sale_date);
      return s.usd > 0 && t > now - 730 * DAY && t <= now - 365 * DAY;
    }).map((s) => s.usd).sort((a, b) => a - b);
    if (last.length < 5 || prior.length < 5) return null;
    return {
      last: Math.round(quantile(last, 0.5)),
      prior: Math.round(quantile(prior, 0.5)),
      nLast: last.length,
      nPrior: prior.length,
    };
  }, [sales, move]);

  const onMove = (band: number) => (e: React.MouseEvent<SVGSVGElement>) => {
    if (!plot) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bestD = 14 * 14;
    plot.panels[band].dots.forEach((d, i) => { const dd = (d.cx - mx) ** 2 + (d.cy - my) ** 2; if (dd < bestD) { bestD = dd; best = i; } });
    let ref = -1, refD = 16 * 16;
    plot.ref?.points.forEach((r, i) => { const dd = (r.cx - mx) ** 2 + (r.cy - my) ** 2; if (dd < refD) { refD = dd; ref = i; } });
    if (ref >= 0 && refD <= bestD) { setRefHover(ref); setHover(null); return; }
    setRefHover(null);
    setHover(best >= 0 ? { band, dot: best } : null);
  };

  if (failed) return <div className="family-sales__empty"><Text role="caption">The sales of this family could not be read.</Text></div>;
  if (!sales) return <div className="family-sales__empty"><Text role="caption">Reading sales…</Text></div>;
  if (!plot) return <div className="family-sales__empty"><Text role="caption">No dated sales of this family in the last five years.</Text></div>;
  const hp = hover ? plot.panels[hover.band] : null;
  const hd = hp && hover ? hp.dots[hover.dot] : null;
  const since = plot.since.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const count = truncated ? `newest ${plot.n.toLocaleString('en-US')} of ${windowCount.toLocaleString('en-US')}` : plot.n.toLocaleString('en-US');
  const raw = move ? `${money(move.last)} vs ${money(move.prior)} (${signed(move.last / move.prior - 1)})` : '';
  return <div className={['family-sales', narrow ? 'family-sales--narrow' : '', ix ? 'family-sales--indexed' : ''].filter(Boolean).join(' ')}>
    <div className="family-sales__head">
      <div className="family-sales__title">
        <Text role="entity" dense>{(() => {
          const parts = [family];
          if (effectiveSelectedModel && effectiveSelectedModel.toLowerCase() !== family.toLowerCase() && modelSales?.length) parts.push(effectiveSelectedModel);
          if (selectedYear != null && yearFilteredSales?.length) parts.push(String(selectedYear));
          return parts.join(' · ');
        })()}</Text>
        <Text role="caption">{(narrow ? `${count} sales since ${since}` : indexed
          ? `${count} sales with a date since ${since} · one dot each · blue = the same car, same miles (95% band) · gray = plain median, which mixes different cars`
          : `${count} sales with a date since ${since} · one dot each · panels by model-year decade · line = rolling median, band = middle half`)
          + (plot.under ? ` · ${plot.under.toLocaleString('en-US')} under ${money(PRICE_FLOOR)} not drawn` : '')
          + (plot.outside ? ` · ${plot.outside.toLocaleString('en-US')} outside ${money(plot.lo)}–${money(plot.hi)} on the edge` : '')
          + (plot.unpanelled ? ` · ${plot.unpanelled.toLocaleString('en-US')} with a rare or unknown model year not drawn` : '')
          + (hidden.size ? ` · ${plot.shown.toLocaleString('en-US')} shown` : '')}</Text>
      </div>
      {!selectedEra && ix ? <LikeForLike ix={plain != null && ix.rawChange == null ? { ...ix, rawChange: plain } : ix} narrow={narrow} /> : (held || move || allVenueMove || plot.p50 > 0) && <div className="family-sales__move">
        {held ? <>
          <Text role="measure">{signed(held.change)}</Text>
          <Text role="caption">{narrow ? `BaT price, decades held at last year's mix · raw median ${raw}`
            : `BaT price, last 12 mo against the 12 before, each decade's median weighted by its sales a year earlier (${held.nPrior.toLocaleString('en-US')} → ${held.nLast.toLocaleString('en-US')} in ${held.eras} decades) · raw median ${raw}`}</Text>
        </> : move ? <>
          <Text role="measure">{money(move.last)}</Text>
          <Text role="caption">{narrow ? `BaT median, 12 mo · ${money(move.prior)} the 12 before · ${signed(move.last / move.prior - 1)}`
            : `BaT median, last 12 mo (${move.nLast}) · ${money(move.prior)} the 12 before (${move.nPrior}) · ${signed(move.last / move.prior - 1)}`}</Text>
        </> : allVenueMove ? <>
          <Text role="measure">{money(allVenueMove.last)}</Text>
          <Text role="caption">{narrow ? `Median, 12 mo · ${money(allVenueMove.prior)} the 12 before · ${signed(allVenueMove.last / allVenueMove.prior - 1)}`
            : `Median across venues, last 12 mo (${allVenueMove.nLast}) · ${money(allVenueMove.prior)} the 12 before (${allVenueMove.nPrior}) · ${signed(allVenueMove.last / allVenueMove.prior - 1)}`}</Text>
        </> : <>
          <Text role="measure">{money(plot.p50)}</Text>
          <Text role="caption">{narrow ? `Median · middle half ${money(plot.p25)}–${money(plot.p75)}`
            : `Median sale across ${plot.n.toLocaleString('en-US')} sales · middle half ${money(plot.p25)}–${money(plot.p75)}`}</Text>
        </>}
      </div>}
    </div>
    <div className="family-sales__legend">
      {plot.counts.map((v) => <button key={v.key} type="button" className="family-sales__venue" aria-pressed={!hidden.has(v.key)}
        title={hidden.has(v.key) ? `Show ${v.label}` : `Hide ${v.label}`} onClick={() => toggle(v.key)}>
        <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={v.color} /></svg>
        <Text role="caption">{narrow ? v.short : v.label} {v.n.toLocaleString('en-US')}</Text></button>)}
      {facetSummary && (
        <div
          className="family-sales__facet-summary"
          role="region"
          aria-label={`${facetSummary.axisLabel} facet cohort comparison`}
          data-testid="family-sales-facet-summary"
          data-facet-axis={facetSummary.axis}
        >
          <span className="family-sales__facet-badge" data-testid="family-sales-facet-badge">
            {facetSummary.axisLabel}
          </span>
          <span className="family-sales__facet-metrics" data-testid="family-sales-facet-metrics">
            {facetSummary.activeFacet ? (
              <>
                <strong data-testid="family-sales-facet-active">{facetSummary.activeFacet}</strong>
                {' · '}
                <span data-testid="family-sales-facet-counts">
                  {facetSummary.matchedCount.toLocaleString('en-US')} of {facetSummary.familyCount.toLocaleString('en-US')} dots ({Math.round(facetSummary.shareRatio * 100)}%)
                </span>
                {facetSummary.matchedMedianUsd != null && facetSummary.familyMedianUsd != null && (
                  <>
                    {' · '}
                    <span data-testid="family-sales-facet-medians">
                      median {money(facetSummary.matchedMedianUsd)} vs {money(facetSummary.familyMedianUsd)} {family}
                      {facetSummary.medianDeltaRatio != null ? ` (${signed(facetSummary.medianDeltaRatio)})` : ''}
                    </span>
                  </>
                )}
                {(facetSummary.matchedSellThroughRate != null || facetSummary.familySellThroughRate != null) && (
                  <>
                    {' · '}
                    <span data-testid="family-sales-facet-sellthrough">
                      {facetSummary.matchedSellThroughRate != null &&
                      facetSummary.familySellThroughRate != null &&
                      Math.round(facetSummary.matchedSellThroughRate * 100) !== Math.round(facetSummary.familySellThroughRate * 100)
                        ? `${Math.round(facetSummary.matchedSellThroughRate * 100)}% vs ${Math.round(facetSummary.familySellThroughRate * 100)}% sold`
                        : `${Math.round((facetSummary.matchedSellThroughRate ?? facetSummary.familySellThroughRate!) * 100)}% sold`}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                <span data-testid="family-sales-facet-counts">
                  {facetSummary.buckets.length} {facetSummary.axisLabel.toLowerCase()} cohorts across {facetSummary.familyCount.toLocaleString('en-US')} dots
                </span>
                {facetSummary.familyMedianUsd != null && (
                  <>
                    {' · '}
                    <span data-testid="family-sales-facet-medians">
                      {family} median {money(facetSummary.familyMedianUsd)}
                    </span>
                  </>
                )}
                {facetSummary.familySellThroughRate != null && (
                  <>
                    {' · '}
                    <span data-testid="family-sales-facet-sellthrough">
                      {Math.round(facetSummary.familySellThroughRate * 100)}% sold
                    </span>
                  </>
                )}
              </>
            )}
          </span>
          <div className="family-sales__facet-pills" role="group" aria-label={`Filter by ${facetSummary.axisLabel.toLowerCase()} cohort`}>
            <button
              type="button"
              className="family-sales__facet-pill"
              data-testid="family-sales-facet-pill-all"
              aria-pressed={!facetSummary.activeFacet}
              onClick={() => handleSelectFacet(null)}
            >
              ALL ({facetSummary.familyCount.toLocaleString('en-US')})
            </button>
            {facetSummary.buckets.slice(0, narrow ? 4 : 6).map((b) => {
              const active =
                facetSummary.activeFacet != null &&
                facetSummary.activeFacet.toLowerCase() === b.label.toLowerCase();
              return (
                <button
                  key={b.label}
                  type="button"
                  className="family-sales__facet-pill"
                  data-testid={`family-sales-facet-pill-${b.label}`}
                  data-facet-bucket={b.label}
                  aria-pressed={active}
                  onClick={() => handleSelectFacet(active ? null : b.label)}
                  title={`${b.label}: ${b.count.toLocaleString('en-US')} dots (${Math.round(b.shareRatio * 100)}%)${b.medianUsd != null ? ` · median ${money(b.medianUsd)}` : ''}${b.sellThroughRate != null ? ` · ${Math.round(b.sellThroughRate * 100)}% sold` : ''}`}
                >
                  <span>{b.label}</span>
                  <span className="family-sales__facet-pill-meta">
                    {b.count.toLocaleString('en-US')}
                    {b.medianUsd != null ? ` · ${money(b.medianUsd)}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {onSelectEra && eraCohorts.length >= 2 && (
        <div className="family-sales__eras" role="group" aria-label="Filter by generation">
          <button
            type="button"
            className="family-sales__era"
            aria-pressed={!selectedEra}
            onClick={() => onSelectEra(null)}
          >
            <Text role="caption">All eras</Text>
          </button>
          {eraCohorts.map((c) => (
            <button
              key={c.id}
              type="button"
              className="family-sales__era"
              aria-pressed={selectedEra === c.id}
              onClick={() => onSelectEra(selectedEra === c.id ? null : c.id)}
            >
              <Text role="caption">{narrow ? c.shortLabel : c.label} ({c.count.toLocaleString('en-US')})</Text>
            </button>
          ))}
        </div>
      )}
      {filteredSupply && (
        <div className="family-sales__supply" role="region" aria-label="Upcoming supply and finish estimates">
          <span className="family-sales__supply-badge">
            UPCOMING {filteredSupply.counts.total}
          </span>
          {filteredSupply.counts.bat_live > 0 && (
            <span className="family-sales__supply-meta">
              {filteredSupply.counts.bat_live} BaT live
              {filteredSupply.finish_model ? ` · M${filteredSupply.finish_model}` : ''}
            </span>
          )}
          {filteredSupply.counts.auction_calendar > 0 && (
            <span className="family-sales__supply-meta">
              {filteredSupply.counts.auction_calendar} calendar
            </span>
          )}
          {filteredSupply.counts.facebook_marketplace > 0 && (
            <span className="family-sales__supply-meta">
              {filteredSupply.counts.facebook_marketplace} FB
            </span>
          )}
          {!narrow && filteredSupply.live_lots.slice(0, 3).map((lot) => {
            const est = lot.finish_estimate ?? lot.band_p50;
            const lo = lot.finish_low ?? lot.band_p10;
            const hi = lot.finish_high ?? lot.band_p90;
            return (
              <button
                key={lot.vehicle_id}
                type="button"
                className="family-sales__supply-chip"
                onClick={() => onOpen(lot.vehicle_id)}
                title={`${lot.title}${lot.current_bid ? ` · bid ${money(lot.current_bid)}` : ''}${est ? ` · finish est ${money(est)}${lo && hi ? ` (80% ${money(lo)}–${money(hi)})` : ''}` : ''}`}
              >
                <span>{[lot.year, lot.model].filter(Boolean).join(' ') || family}</span>
                {lot.current_bid ? <span className="family-sales__supply-bid">bid {money(lot.current_bid)}</span> : null}
                {est ? <span className="family-sales__supply-est">→ est {money(est)}{lo && hi ? ` (${money(lo)}–${money(hi)})` : ''}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
    <div ref={panelsRef} className="family-sales__panels" style={{ gridTemplateColumns: `repeat(${plot.cols}, ${plot.pw}px)` }}>
      {plot.panels.map((pn, bi) => <svg key={pn.era} className="family-sales__plot" width={plot.pw} height={plot.ph}
        role="img" aria-label={`${family} ${pn.era}: ${pn.n} sales over five years, price against date`}
        onMouseMove={onMove(bi)} onMouseLeave={() => { setHover(null); setRefHover(null); }} onClick={() => { if (hd && hover?.band === bi) onOpen(hd.vehicle_id); }}>
        <text x={P.left} y={12} className="family-sales__panel-title">{pn.era} · {pn.n.toLocaleString('en-US')}
          {pn.move && !plot.ref ? ` · median ${money(pn.move.last)} ${signed(pn.move.last / pn.move.prior - 1)} (${pn.move.nPrior}→${pn.move.nLast})` : ''}</text>
        {plot.ticks.map((t) => <g key={t.label}>
          <line x1={P.left} x2={plot.pw - P.right} y1={t.y} y2={t.y} className="family-sales__grid" />
          {pn.firstCol && <text x={P.left - 6} y={t.y + 3} textAnchor="end" className="family-sales__axis">{t.label}</text>}
        </g>)}
        {plot.years.map((t) => <g key={t.label}>
          <line x1={t.x} x2={t.x} y1={P.top} y2={plot.ph - P.bottom} className="family-sales__grid" />
          {pn.lastRow && <text x={t.x + 3} y={plot.ph - 5} className="family-sales__axis">{t.label}</text>}
        </g>)}
        {pn.area && <path d={pn.area} className="family-sales__iqr" />}
        {pn.dots.map((d, di) => d.out
          ? <path key={d.vehicle_id} data-vehicle-id={d.vehicle_id} d={d.out > 0 ? `M${d.cx - 3} ${d.cy + 4}L${d.cx} ${d.cy - 1}L${d.cx + 3} ${d.cy + 4}Z` : `M${d.cx - 3} ${d.cy - 4}L${d.cx} ${d.cy + 1}L${d.cx + 3} ${d.cy - 4}Z`} className="family-sales__edge"
              onMouseEnter={() => { setRefHover(null); setHover({ band: bi, dot: di }); }} />
          : <circle key={d.vehicle_id} data-vehicle-id={d.vehicle_id} cx={d.cx} cy={d.cy} r={pn.n > 1500 ? 1.4 : pn.n > 400 ? 2 : 2.6} fill={d.color} fillOpacity={pn.n > 1500 ? 0.35 : 0.55}
              onMouseEnter={() => { setRefHover(null); setHover({ band: bi, dot: di }); }} />)}
        {pn.line && !plot.ref && <path d={pn.line} className="family-sales__median-halo" />}
        {pn.line && <path d={pn.line} className={plot.ref ? 'family-sales__median family-sales__median--plain' : 'family-sales__median'} />}
        {pn.liveDots.map((ld) => (
          <g key={`live-${ld.vehicle_id}`} className="family-sales__live-whisker">
            {ld.yLo != null && ld.yHi != null && (
              <line x1={ld.cx} x2={ld.cx} y1={ld.yHi} y2={ld.yLo} className="family-sales__live-band" />
            )}
            <path d={`M${ld.cx} ${ld.cy - 3.2}L${ld.cx + 3.2} ${ld.cy}L${ld.cx} ${ld.cy + 3.2}L${ld.cx - 3.2} ${ld.cy}Z`} className="family-sales__live-diamond" />
          </g>
        ))}
        {plot.ref && <path d={plot.ref.area} className="family-sales__ref-band" />}
        {plot.ref && <path d={plot.ref.line} className="family-sales__ref" />}
        {plot.ref && refHover != null && plot.ref.points[refHover]
          && <circle cx={plot.ref.points[refHover].cx} cy={plot.ref.points[refHover].cy} r={5} className="family-sales__ref-hit" />}
        {hd && hover?.band === bi && <circle cx={hd.cx} cy={hd.cy} r={6} className="family-sales__hit" />}
      </svg>)}
    </div>
    {(() => {
      // One tip: the like-for-like point when the pointer is nearest it, else the sale under the pointer.
      const r = plot.ref && refHover != null ? plot.ref.points[refHover] : null;
      const saleFacets = !r && hd && hover ? deriveSaleTooltipFacets(hd, { brand, family, year: hd.year }) : null;
      const tip = r ? {
        left: Math.min(r.cx + 12, width - 260), top: plot.head + r.cy + 12,
        label: `${ix?.periodKind === 'month'
          ? new Date(r.t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
          : `${new Date(r.t).getUTCFullYear()} Q${Math.floor(new Date(r.t).getUTCMonth() / 3) + 1}`} · the same car`,
        measure: money(r.usd),
        caption: `${r.n.toLocaleString('en-US')} sales · 95% ${money(r.lo)}–${money(r.hi)}${r.median ? ` · plain median ${money(r.median)}` : ''}`,
        pills: [] as SaleTooltipFacetPill[],
        identityMark: null as VehicleIdentityMark | null,
        badgeSvg: null as string | null,
      } : hd && hover ? {
        left: Math.min((hover.band % plot.cols) * (plot.pw + 6) + hd.cx + 12, width - 260),
        top: plot.head + Math.floor(hover.band / plot.cols) * (plot.ph + 6) + hd.cy + 12,
        label: [hd.year, saleFacets?.rawSubModel ?? hd.model].filter(Boolean).join(' ') || family,
        measure: `$${hd.usd.toLocaleString('en-US')}`,
        caption: `${venueOf(hd.source).key === 'other' ? hd.source ?? 'venue unrecorded' : hd.source} · ${new Date(hd.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · click to open`,
        pills: saleFacets?.pills ?? [],
        identityMark: saleFacets?.identityMark ?? null,
        badgeSvg: saleFacets?.badgeSvg ?? null,
      } : null;
      return tip && <div className="family-sales__tip" data-testid="family-sales-tooltip" style={{ left: tip.left, top: tip.top }}>
        <div className="family-sales__tip-head">
          <Text role="label" as="div">{tip.label}</Text>
          {tip.badgeSvg && (
            <span
              className="family-sales__tip-mark"
              data-testid="family-sales-tip-mark"
              data-mark-id={tip.identityMark?.id}
              title={tip.identityMark ? `${tip.identityMark.displayLabel} — ${tip.identityMark.subLabel}${tip.identityMark.rpoCode ? ` (${tip.identityMark.rpoCode})` : ''}` : undefined}
              dangerouslySetInnerHTML={{ __html: tip.badgeSvg }}
            />
          )}
        </div>
        <Text role="measure" as="div">{tip.measure}</Text>
        {tip.pills.length > 0 && (
          <div className="family-sales__tip-facets" data-testid="family-sales-tip-facets">
            {tip.pills.map((pill) => (
              <span
                key={`${pill.axis}-${pill.value}`}
                className={`family-sales__tip-facet family-sales__tip-facet--${pill.axis}`}
                data-testid={`family-sales-tip-facet-${pill.axis}`}
                data-facet-axis={pill.axis}
                data-facet-value={pill.value}
              >
                <span className="family-sales__tip-facet-axis">{pill.axisLabel}</span>
                <span className="family-sales__tip-facet-sep"> · </span>
                <span className="family-sales__tip-facet-val">{pill.value}</span>
              </span>
            ))}
          </div>
        )}
        <Text role="caption" as="div">{tip.caption}</Text>
      </div>;
    })()}
  </div>;
}

// The family level's two views: the sales chart (default) and the model names as tiles.
export function FamilyViewSwitch({ value, onChange }: { value: 'sales' | 'names'; onChange: (v: 'sales' | 'names') => void }) {
  return <div className="family-view" role="group" aria-label="Family view">
    {(['sales', 'names'] as const).map((v) => <button key={v} type="button" className="family-view__option" aria-pressed={value === v} onClick={() => onChange(v)}>
      <Text role="label">{v === 'sales' ? 'Sales' : 'Names'}</Text>
    </button>)}
  </div>;
}
