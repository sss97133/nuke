import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { pct } from './mapScale';
import './FamilyMovers.css';

// The families whose Bring a Trailer market moved most in the last 12 months against the 12 before, both ways, with
// BaT's own move beside them (treemap_family_movers, 20261015173000). Owner, 2026-10-15, on the brand map: "increase
// over 12 months is interesting, but needs expansion and clarity". A tile's color says one brand's move; this says
// which families moved most across every brand, and a pick drills the map to that family.
export type Mover = {
  direction: 'up' | 'down'; brand: string; family_key: string; family: string;
  sold_12m: number; sold_prior_12m: number; usd_12m: number; usd_prior_12m: number;
  bat_sold_12m: number; bat_sold_prior_12m: number; bat_usd_12m: number; bat_usd_prior_12m: number;
  eligible: number; families: number;
};

export type MoverHorizon = 'upcoming' | '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | '5y';
export type BaselineHorizon = 'prior' | Exclude<MoverHorizon, 'upcoming'>;

export type HorizonMeta = {
  key: MoverHorizon;
  label: string;
  days: number;
  shortWindowLabel: string;
  title: string;
  relativityLabel: string;
  windowLabel: string;
  priorUnit: string;
  recentUnit: string;
  eachWindowLabel: string;
  gainingTitle: string;
  losingTitle: string;
};

export const BASELINE_HORIZONS: { key: BaselineHorizon; label: string; title: string }[] = [
  { key: 'prior', label: 'PRIOR', title: 'Compare against the immediately preceding window of the same length' },
  { key: '1d', label: '1D', title: 'Compare against last 24 hours pace' },
  { key: '1w', label: '1W', title: 'Compare against last 7 days pace' },
  { key: '1m', label: '1M', title: 'Compare against last 30 days pace' },
  { key: '3m', label: '3M', title: 'Compare against last 3 months pace' },
  { key: '6m', label: '6M', title: 'Compare against last 6 months pace' },
  { key: '1y', label: '1Y', title: 'Compare against last 12 months pace' },
  { key: '5y', label: '5Y', title: 'Compare against last 5 years pace' },
];

export const MOVER_HORIZONS: HorizonMeta[] = [
  {
    key: 'upcoming',
    label: 'UPCOMING',
    days: 30,
    shortWindowLabel: 'NEXT 30D BLOCK',
    title: 'Next 30 days on the block (live Bring a Trailer + scheduled auction calendar) against past 30 days sold',
    relativityLabel: 'NEXT 30D BLOCK VS PAST 30D SOLD',
    windowLabel: 'Upcoming supply over the next 30 days against the last 30 days sold',
    priorUnit: 'the last 30 days',
    recentUnit: 'the next 30 days',
    eachWindowLabel: '30-day window',
    gainingTitle: 'Coming up more',
    losingTitle: 'Coming up less',
  },
  {
    key: '1d',
    label: '1D',
    days: 1,
    shortWindowLabel: 'LAST 24H',
    title: 'Last 24 hours against the prior 24 hours',
    relativityLabel: 'LAST 24H VS PRIOR 24H',
    windowLabel: 'Sales over the last 24 hours against the 24 hours before',
    priorUnit: 'the prior 24 hours',
    recentUnit: 'the last 24 hours',
    eachWindowLabel: '24-hour window',
    gainingTitle: 'Selling more',
    losingTitle: 'Selling less',
  },
  {
    key: '1w',
    label: '1W',
    days: 7,
    shortWindowLabel: 'LAST 7D',
    title: 'Last 7 days against the prior 7 days',
    relativityLabel: 'LAST 7D VS PRIOR 7D',
    windowLabel: 'Sales over the last 7 days against the 7 days before',
    priorUnit: 'the week before',
    recentUnit: 'this week',
    eachWindowLabel: 'week',
    gainingTitle: 'Selling more',
    losingTitle: 'Selling less',
  },
  {
    key: '1m',
    label: '1M',
    days: 30,
    shortWindowLabel: 'LAST 30D',
    title: 'Last 30 days against the prior 30 days',
    relativityLabel: 'LAST 30D VS PRIOR 30D',
    windowLabel: 'Sales over the last 30 days against the 30 days before',
    priorUnit: 'the month before',
    recentUnit: 'this month',
    eachWindowLabel: 'month',
    gainingTitle: 'Selling more',
    losingTitle: 'Selling less',
  },
  {
    key: '3m',
    label: '3M',
    days: 90,
    shortWindowLabel: 'LAST 3M',
    title: 'Last 90 days against the prior 90 days',
    relativityLabel: 'LAST 3M VS PRIOR 3M',
    windowLabel: 'Sales over the last 3 months against the 3 months before',
    priorUnit: 'the 3 months before',
    recentUnit: 'the last 3 months',
    eachWindowLabel: 'quarter',
    gainingTitle: 'Selling more',
    losingTitle: 'Selling less',
  },
  {
    key: '6m',
    label: '6M',
    days: 180,
    shortWindowLabel: 'LAST 6M',
    title: 'Last 180 days against the prior 180 days',
    relativityLabel: 'LAST 6M VS PRIOR 6M',
    windowLabel: 'Sales over the last 6 months against the 6 months before',
    priorUnit: 'the 6 months before',
    recentUnit: 'the last 6 months',
    eachWindowLabel: 'half-year',
    gainingTitle: 'Selling more',
    losingTitle: 'Selling less',
  },
  {
    key: '1y',
    label: '1Y',
    days: 365,
    shortWindowLabel: 'LAST 1Y',
    title: 'Last 12 months against the prior 12 months',
    relativityLabel: 'LAST 1Y VS PRIOR 1Y',
    windowLabel: 'Sales this year against last year',
    priorUnit: 'the year before',
    recentUnit: 'this year',
    eachWindowLabel: 'year',
    gainingTitle: 'Selling more',
    losingTitle: 'Selling less',
  },
  {
    key: '5y',
    label: '5Y',
    days: 1825,
    shortWindowLabel: 'LAST 5Y',
    title: 'Last 5 years against the prior 5 years',
    relativityLabel: 'LAST 5Y VS PRIOR 5Y',
    windowLabel: 'Sales over the last 5 years against the 5 years before',
    priorUnit: 'the 5 years before',
    recentUnit: 'the last 5 years',
    eachWindowLabel: '5-year window',
    gainingTitle: 'Selling more',
    losingTitle: 'Selling less',
  },
];

// One read per page lifetime; a failed read is forgotten so the next mount retries, and the strip stays away.
let moversRead: Promise<Mover[] | null> | null = null;
export function readFamilyMovers(): Promise<Mover[] | null> {
  if (typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return Promise.resolve(null);
  if (!moversRead) {
    moversRead = Promise.resolve(supabase.rpc('treemap_family_movers', { p_limit: 8 })).then(
      ({ data, error }) => { if (error || !Array.isArray(data)) { moversRead = null; return null; } return data as Mover[]; },
      () => { moversRead = null; return null; },
    );
  }
  return moversRead;
}

// The two years behind each mover: its BaT sales in 24 bins of about a month, oldest first (treemap_family_monthly,
// 20261016050000). Bins 12..23 add up to the chip's last-12-months count and 0..11 to the year before, so the bars show
// the shape behind "46→92 sold". One read per page lifetime; a failed or malformed read draws no bars.
let monthlyRead: Promise<Map<string, number[]>> | null = null;
export function readFamilyMonthly(rows: Mover[]): Promise<Map<string, number[]>> {
  if (typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return Promise.resolve(new Map());
  if (!monthlyRead) {
    monthlyRead = Promise.resolve(supabase.rpc('treemap_family_monthly',
      { p_families: rows.map((m) => ({ brand: m.brand, family_key: m.family_key })) })).then(
      ({ data, error }) => {
        const out = new Map<string, number[]>();
        const families = (data as { families?: unknown } | null)?.families;
        if (error || !Array.isArray(families)) { monthlyRead = null; return out; }
        for (const f of families as { brand?: unknown; family_key?: unknown; bins?: unknown }[]) {
          if (typeof f?.brand === 'string' && typeof f.family_key === 'string' && Array.isArray(f.bins) && f.bins.length === 24
            && f.bins.every((n) => typeof n === 'number' && n >= 0)) out.set(`${f.brand}|${f.family_key}`, f.bins as number[]);
        }
        return out;
      },
      () => { monthlyRead = null; return new Map(); },
    );
  }
  return monthlyRead;
}

// 24 bars, the prior window faint and the recent/upcoming window in the chip's direction, each scaled to the family's busiest bin.
export function Spark({ bins, direction }: { bins: number[]; direction: 'up' | 'down' }) {
  const max = Math.max(1, ...bins);
  return <svg className={`map-movers__spark map-movers__spark--${direction}`} width="48" height="14" viewBox="0 0 48 14" aria-hidden="true">
    {bins.map((n, i) => {
      const h = n > 0 ? Math.max(1, Math.round((n / max) * 13)) : 0;
      return <rect key={i} x={i * 2} y={14 - h} width="1.5" height={h} className={i < 12 ? 'map-movers__bar--prior' : 'map-movers__bar--recent'} />;
    })}
  </svg>;
}

export function move(now: number, before: number): string {
  if (!before) return '';
  const m = now / before - 1;
  return `${m >= 0 ? '▲' : '▼'}${Math.abs(Math.round(m * 100))}%`;
}

/** A family that gained or lost share of measured auction sales (treemap_family_share_movers): its move against the
 *  market overall with a ±2 standard error band, its counts in both windows, its average sale's move apart, and optional 24-bar bins. */
export type ShareMover = {
  brand: string; family_key: string; family: string; sold_12m: number; sold_prior_12m: number; usd_12m: number;
  usd_prior_12m: number; share_move: number; share_lo: number; share_hi: number; se: number; avg_price_move: number | null;
  bins?: number[];
};
export type HorizonMoveCounts = {
  sold_12m: number;
  sold_prior_12m: number;
  usd_12m: number;
  usd_prior_12m: number;
};
export type UpcomingSources = {
  bat_live: number;
  auction_calendar: number;
  facebook_marketplace: number;
};
export type ShareMovers = {
  as_of: string | null; horizon?: MoverHorizon; window_days?: number;
  min_sales: number; families: number; eligible: number; significant: number;
  bat: { sold_12m: number; sold_prior_12m: number; usd_12m: number; usd_prior_12m: number };
  sources?: UpcomingSources;
  brand_moves?: Record<string, HorizonMoveCounts>;
  family_moves?: Record<string, HorizonMoveCounts>;
  gaining: ShareMover[]; losing: ShareMover[];
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function parseMover(r: unknown): ShareMover | null {
  const m = r as Partial<ShareMover> & { bins?: unknown } | null;
  if (!m || typeof m.brand !== 'string' || typeof m.family_key !== 'string' || typeof m.family !== 'string') return null;
  if (![m.sold_12m, m.sold_prior_12m, m.share_move, m.share_lo, m.share_hi].every(isNum)) return null;
  const bins = Array.isArray(m.bins) && m.bins.length === 24 && m.bins.every((n) => isNum(n) && n >= 0)
    ? (m.bins as number[])
    : undefined;
  return {
    brand: m.brand, family_key: m.family_key, family: m.family,
    sold_12m: m.sold_12m!, sold_prior_12m: m.sold_prior_12m!,
    usd_12m: isNum(m.usd_12m) ? m.usd_12m : 0, usd_prior_12m: isNum(m.usd_prior_12m) ? m.usd_prior_12m : 0,
    share_move: m.share_move!, share_lo: m.share_lo!, share_hi: m.share_hi!, se: isNum(m.se) ? m.se : 0,
    avg_price_move: isNum(m.avg_price_move) ? m.avg_price_move : null,
    ...(bins ? { bins } : {}),
  };
}
function parseMoveOverlay(raw: unknown): Record<string, HorizonMoveCounts> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, HorizonMoveCounts> = {};
  let count = 0;
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(val) && val.length >= 4 && isNum(val[0]) && isNum(val[1])) {
      out[k] = {
        sold_12m: val[0],
        sold_prior_12m: val[1],
        usd_12m: isNum(val[2]) ? val[2] : 0,
        usd_prior_12m: isNum(val[3]) ? val[3] : 0,
      };
      count++;
    }
  }
  return count > 0 ? out : undefined;
}

/** The reader's value, or null when it is not one (the strip then stays away). */
export function parseShareMovers(raw: unknown): ShareMovers | null {
  const v = raw as Partial<ShareMovers> & { sources?: unknown; brand_moves?: unknown; family_moves?: unknown } | null;
  if (!v || typeof v !== 'object' || !Array.isArray(v.gaining) || !Array.isArray(v.losing)) return null;
  const b = v.bat as ShareMovers['bat'] | undefined;
  if (!b || !isNum(b.sold_12m) || !isNum(b.sold_prior_12m) || b.sold_prior_12m <= 0) return null;
  const gaining = v.gaining.map(parseMover).filter((m): m is ShareMover => m !== null);
  const losing = v.losing.map(parseMover).filter((m): m is ShareMover => m !== null);
  const validHorizons: MoverHorizon[] = ['upcoming', '1d', '1w', '1m', '3m', '6m', '1y', '5y'];
  const horizon = typeof v.horizon === 'string' && validHorizons.includes(v.horizon as MoverHorizon)
    ? (v.horizon as MoverHorizon)
    : undefined;
  const rawSources = v.sources as Partial<UpcomingSources> | undefined;
  const sources = rawSources && typeof rawSources === 'object'
    && isNum(rawSources.bat_live) && isNum(rawSources.auction_calendar)
    ? {
        bat_live: rawSources.bat_live,
        auction_calendar: rawSources.auction_calendar,
        facebook_marketplace: isNum(rawSources.facebook_marketplace) ? rawSources.facebook_marketplace : 0,
      }
    : undefined;
  const brand_moves = parseMoveOverlay(v.brand_moves);
  const family_moves = parseMoveOverlay(v.family_moves);
  return {
    as_of: typeof v.as_of === 'string' ? v.as_of : null,
    ...(horizon ? { horizon } : {}),
    ...(isNum(v.window_days) ? { window_days: v.window_days } : {}),
    min_sales: isNum(v.min_sales) ? v.min_sales : 30,
    families: isNum(v.families) ? v.families : 0,
    eligible: isNum(v.eligible) ? v.eligible : 0,
    significant: isNum(v.significant) ? v.significant : 0,
    bat: b,
    ...(sources ? { sources } : {}),
    ...(brand_moves ? { brand_moves } : {}),
    ...(family_moves ? { family_moves } : {}),
    gaining,
    losing,
  };
}

const knownFamilyLabels = new Map<string, string>();
function rememberFamilyLabels(m: ShareMovers | null): ShareMovers | null {
  if (!m) return null;
  for (const row of [...m.gaining, ...m.losing]) {
    knownFamilyLabels.set(`${row.brand}|${row.family_key}`, row.family);
  }
  return m;
}

function formatFallbackFamilyName(familyKey: string): string {
  const clean = familyKey.trim();
  if (!clean) return familyKey;
  if (clean.length <= 3 || /^[0-9a-z-]+$/i.test(clean) && /\d/.test(clean)) {
    return clean.toUpperCase();
  }
  return clean
    .split(/[-_\s]+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Combine a recent/target window ShareMovers payload with an independently chosen baseline window ShareMovers payload
 *  so any two horizons (e.g. 1D vs 1W, 1W vs 1M, 1M vs 1Y) can be compared directly on the log-share axis. */
export function combineShareMovers(
  recent: ShareMovers,
  base: ShareMovers,
  recentKey: MoverHorizon,
  baseKey: Exclude<MoverHorizon, 'upcoming'>,
): ShareMovers {
  rememberFamilyLabels(recent);
  rememberFamilyLabels(base);

  const batRecent = recent.bat.sold_12m;
  const batBase = base.bat.sold_12m;
  if (batRecent <= 0 || batBase <= 0) return recent;

  const recentMap = new Map<string, { brand: string; family_key: string; family: string; s: number; u: number; bins?: number[] }>();
  const baseMap = new Map<string, { brand: string; family_key: string; family: string; s: number; u: number }>();

  for (const r of [...recent.gaining, ...recent.losing]) {
    const k = `${r.brand}|${r.family_key}`;
    recentMap.set(k, { brand: r.brand, family_key: r.family_key, family: r.family, s: r.sold_12m, u: r.usd_12m, bins: r.bins });
  }
  if (recent.family_moves) {
    for (const [k, v] of Object.entries(recent.family_moves)) {
      const idx = k.indexOf('|');
      if (idx <= 0) continue;
      const brand = k.slice(0, idx);
      const family_key = k.slice(idx + 1);
      const prev = recentMap.get(k);
      recentMap.set(k, {
        brand,
        family_key,
        family: prev?.family ?? knownFamilyLabels.get(k) ?? formatFallbackFamilyName(family_key),
        s: v.sold_12m,
        u: v.usd_12m,
        bins: prev?.bins,
      });
    }
  }

  for (const r of [...base.gaining, ...base.losing]) {
    const k = `${r.brand}|${r.family_key}`;
    baseMap.set(k, { brand: r.brand, family_key: r.family_key, family: r.family, s: r.sold_12m, u: r.usd_12m });
  }
  if (base.family_moves) {
    for (const [k, v] of Object.entries(base.family_moves)) {
      const idx = k.indexOf('|');
      if (idx <= 0) continue;
      const brand = k.slice(0, idx);
      const family_key = k.slice(idx + 1);
      const prev = baseMap.get(k);
      baseMap.set(k, {
        brand,
        family_key,
        family: prev?.family ?? knownFamilyLabels.get(k) ?? formatFallbackFamilyName(family_key),
        s: v.sold_12m,
        u: v.usd_12m,
      });
    }
  }

  const allKeys = new Set<string>([...recentMap.keys(), ...baseMap.keys()]);
  const minRecent = Math.max(1, recent.min_sales);
  const minBase = Math.max(1, base.min_sales);
  const minZ = recentKey === '1d' ? 0.8 : recentKey === '1w' ? 1.0 : recentKey === 'upcoming' ? 1.28 : 1.5;

  const combinedFamilyMoves: Record<string, HorizonMoveCounts> = {};
  const candidates: (ShareMover & { lm: number })[] = [];
  let familiesCount = 0;
  let eligibleCount = 0;

  for (const k of allKeys) {
    const rec = recentMap.get(k);
    const bas = baseMap.get(k);
    const s12 = rec?.s ?? 0;
    const sp = bas?.s ?? 0;
    const u12 = rec?.u ?? 0;
    const up = bas?.u ?? 0;
    if (s12 <= 0 && sp <= 0) continue;
    familiesCount++;
    combinedFamilyMoves[k] = { sold_12m: s12, sold_prior_12m: sp, usd_12m: u12, usd_prior_12m: up };

    if (s12 < minRecent || sp < minBase) continue;
    eligibleCount++;

    const lm = Math.log((s12 / sp) / (batRecent / batBase));
    const se = Math.sqrt(1 / s12 + 1 / sp);
    if (Math.abs(lm) < minZ * se) continue;

    const brand = rec?.brand ?? bas!.brand;
    const family_key = rec?.family_key ?? bas!.family_key;
    const family = rec?.family ?? bas?.family ?? knownFamilyLabels.get(k) ?? formatFallbackFamilyName(family_key);
    const avg_price_move = u12 > 0 && up > 0 ? Number(((u12 / s12) / (up / sp) - 1).toFixed(4)) : null;

    candidates.push({
      brand,
      family_key,
      family,
      sold_12m: s12,
      sold_prior_12m: sp,
      usd_12m: u12,
      usd_prior_12m: up,
      share_move: Number((Math.exp(lm) - 1).toFixed(4)),
      share_lo: Number((Math.exp(lm - 2 * se) - 1).toFixed(4)),
      share_hi: Number((Math.exp(lm + 2 * se) - 1).toFixed(4)),
      se: Number(se.toFixed(4)),
      avg_price_move,
      ...(rec?.bins ? { bins: rec.bins } : {}),
      lm,
    });
  }

  const combinedBrandMoves: Record<string, HorizonMoveCounts> = {};
  if (recent.brand_moves || base.brand_moves) {
    const brandKeys = new Set<string>([
      ...Object.keys(recent.brand_moves ?? {}),
      ...Object.keys(base.brand_moves ?? {}),
    ]);
    for (const b of brandKeys) {
      const rB = recent.brand_moves?.[b];
      const bB = base.brand_moves?.[b];
      combinedBrandMoves[b] = {
        sold_12m: rB?.sold_12m ?? 0,
        sold_prior_12m: bB?.sold_12m ?? 0,
        usd_12m: rB?.usd_12m ?? 0,
        usd_prior_12m: bB?.usd_12m ?? 0,
      };
    }
  }

  const gaining = candidates
    .filter((c) => c.lm > 0)
    .sort((a, b) => b.lm - a.lm || a.brand.localeCompare(b.brand) || a.family_key.localeCompare(b.family_key))
    .slice(0, 5)
    .map(({ lm: _lm, ...rest }) => rest);

  const losing = candidates
    .filter((c) => c.lm < 0)
    .sort((a, b) => a.lm - b.lm || a.brand.localeCompare(b.brand) || a.family_key.localeCompare(b.family_key))
    .slice(0, 5)
    .map(({ lm: _lm, ...rest }) => rest);

  return {
    as_of: recent.as_of ?? base.as_of,
    horizon: recentKey,
    window_days: recent.window_days,
    min_sales: minRecent,
    families: familiesCount,
    eligible: eligibleCount,
    significant: candidates.length,
    bat: {
      sold_12m: batRecent,
      sold_prior_12m: batBase,
      usd_12m: recent.bat.usd_12m,
      usd_prior_12m: base.bat.usd_12m,
    },
    ...(recent.sources ? { sources: recent.sources } : {}),
    ...(Object.keys(combinedBrandMoves).length > 0 ? { brand_moves: combinedBrandMoves } : {}),
    ...(Object.keys(combinedFamilyMoves).length > 0 ? { family_moves: combinedFamilyMoves } : {}),
    gaining,
    losing,
  };
}

let shareRead: Promise<ShareMovers | null> | null = null;
const horizonReads = new Map<MoverHorizon, Promise<ShareMovers | null>>();

export function readShareMovers(horizon: MoverHorizon = '1y'): Promise<ShareMovers | null> {
  if (typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return Promise.resolve(null);
  if (horizon === '1y') {
    if (!shareRead) {
      shareRead = Promise.resolve(supabase.rpc('treemap_family_share_movers', { p_limit: 5 })).then(
        ({ data, error }) => { const v = error ? null : rememberFamilyLabels(parseShareMovers(data)); if (!v) shareRead = null; return v; },
        () => { shareRead = null; return null; },
      );
    }
    return shareRead;
  }
  const cached = horizonReads.get(horizon);
  if (cached) return cached;
  const req = Promise.resolve(
    supabase.rpc('treemap_family_share_movers', { p_limit: 5, p_min_sales: 0, p_horizon: horizon }),
  ).then(
    ({ data, error }) => {
      const v = error ? null : rememberFamilyLabels(parseShareMovers(data));
      if (!v) horizonReads.delete(horizon);
      return v;
    },
    () => { horizonReads.delete(horizon); return null; },
  );
  horizonReads.set(horizon, req);
  return req;
}

// A share move on one log axis, -50% to +100% (a halving and a doubling sit at equal distances from no change).
const LO = Math.log(0.5);
const HI = Math.log(2);
export function axisX(m: number, width: number): number {
  const v = Math.log(Math.max(1e-6, 1 + m));
  return ((Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)) * width;
}
const W = 120;
export function MoveDot({ m }: { m: ShareMover }) {
  const x = axisX(m.share_move, W);
  const clamped = m.share_move > 1 || m.share_move < -0.5;
  const dir = m.share_move >= 0 ? 'up' : 'down';
  return <svg className={`map-movers2__dot map-movers2__dot--${dir}`} width={W} height="14" viewBox={`0 0 ${W} 14`} aria-hidden="true">
    <line className="map-movers2__axis" x1="0" y1="7" x2={W} y2="7" />
    <line className="map-movers2__zero" x1={axisX(0, W)} y1="2" x2={axisX(0, W)} y2="12" />
    <line className="map-movers2__band" x1={axisX(m.share_lo, W)} y1="7" x2={axisX(m.share_hi, W)} y2="7" />
    {clamped
      ? <path className="map-movers2__mark" d={m.share_move > 0 ? `M${W - 7} 3L${W} 7L${W - 7} 11Z` : 'M7 3L0 7L7 11Z'} />
      : <circle className="map-movers2__mark" cx={x} cy="7" r="3.5" />}
  </svg>;
}

export default function FamilyMovers({
  onPick,
  horizon: controlledHorizon,
  onHorizonChange,
  baselineHorizon: controlledBaseline,
  onBaselineHorizonChange,
  onMoversData,
}: {
  onPick: (m: Pick<Mover, 'brand' | 'family_key' | 'family'>) => void;
  horizon?: MoverHorizon;
  onHorizonChange?: (h: MoverHorizon) => void;
  baselineHorizon?: BaselineHorizon;
  onBaselineHorizonChange?: (b: BaselineHorizon) => void;
  onMoversData?: (data: ShareMovers | null, horizon: MoverHorizon, baseline: BaselineHorizon) => void;
}) {
  const [internalHorizon, setInternalHorizon] = useState<MoverHorizon>(controlledHorizon ?? '1y');
  const horizon = controlledHorizon ?? internalHorizon;
  const setHorizon = (h: MoverHorizon) => {
    setInternalHorizon(h);
    onHorizonChange?.(h);
  };
  const [internalBaseline, setInternalBaseline] = useState<BaselineHorizon>(controlledBaseline ?? 'prior');
  const baselineHorizon = controlledBaseline ?? internalBaseline;
  const setBaselineHorizon = (b: BaselineHorizon) => {
    setInternalBaseline(b);
    onBaselineHorizonChange?.(b);
  };

  const [infoOpen, setInfoOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!infoOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfoOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [infoOpen]);

  const [data, setData] = useState<ShareMovers | null>(null);
  const [initialReady, setInitialReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bins, setBins] = useState<Map<string, number[]>>(new Map());

  const isCustomBase = baselineHorizon !== 'prior' && baselineHorizon !== horizon && !(horizon === 'upcoming' && baselineHorizon === '1m');

  useEffect(() => {
    let live = true;
    setLoading(true);
    if (!isCustomBase) {
      readShareMovers(horizon).then((r) => {
        if (!live) return;
        setData(r);
        onMoversData?.(r, horizon, baselineHorizon);
        if (horizon === '1y' && r && (r.gaining.length > 0 || r.losing.length > 0)) {
          setInitialReady(true);
        } else if (r) {
          setInitialReady(true);
        }
        setLoading(false);
      });
    } else {
      const baseKey = baselineHorizon as Exclude<MoverHorizon, 'upcoming'>;
      Promise.all([readShareMovers(horizon), readShareMovers(baseKey)]).then(([recentRes, baseRes]) => {
        if (!live) return;
        const combined = recentRes && baseRes ? combineShareMovers(recentRes, baseRes, horizon, baseKey) : recentRes;
        setData(combined);
        onMoversData?.(combined, horizon, baselineHorizon);
        if (combined) setInitialReady(true);
        setLoading(false);
      });
    }
    return () => { live = false; };
  }, [horizon, baselineHorizon, isCustomBase]);

  useEffect(() => {
    if (horizon !== '1y' || isCustomBase) return;
    const rows = data ? [...data.gaining, ...data.losing] : [];
    if (!rows.length || rows.every((r) => Array.isArray(r.bins) && r.bins.length === 24)) return;
    let live = true;
    readFamilyMonthly(rows as unknown as Mover[]).then((b) => { if (live) setBins(b); });
    return () => { live = false; };
  }, [data, horizon, isCustomBase]);

  if (!initialReady && (!data || (!data.gaining.length && !data.losing.length))) return null;
  if (!data) return null;

  const meta = MOVER_HORIZONS.find((h) => h.key === horizon) ?? MOVER_HORIZONS[6];
  const baseMeta = isCustomBase
    ? (MOVER_HORIZONS.find((h) => h.key === baselineHorizon) ?? MOVER_HORIZONS[6])
    : null;
  const isUpcoming = horizon === 'upcoming';
  const rawBatRatio = data.bat.sold_12m / data.bat.sold_prior_12m;
  const paceBatMove = isCustomBase && baseMeta
    ? (data.bat.sold_12m / Math.max(1e-6, data.bat.sold_prior_12m * (meta.days / baseMeta.days))) - 1
    : rawBatRatio - 1;
  const activeRelativityLabel = isCustomBase && baseMeta
    ? `${meta.shortWindowLabel} VS ${baseMeta.label} BASELINE`
    : meta.relativityLabel;
  const activeWindowProse = isCustomBase && baseMeta
    ? `${isUpcoming ? 'Upcoming supply' : 'Sales'} in ${meta.recentUnit} (${meta.label}) against ${baseMeta.recentUnit} (${baseMeta.label}) baseline`
    : meta.windowLabel;

  const row = (m: ShareMover, dir: 'up' | 'down') => {
    const key = `${m.brand}|${m.family_key}`;
    const rowBins = m.bins ?? (horizon === '1y' && !isCustomBase ? bins.get(key) : undefined);
    const countsText = isCustomBase && baseMeta
      ? `${m.sold_prior_12m.toLocaleString('en-US')} (${baseMeta.label}) → ${m.sold_12m.toLocaleString('en-US')} (${meta.label})`
      : isUpcoming
        ? `${m.sold_prior_12m.toLocaleString('en-US')} sold → ${m.sold_12m.toLocaleString('en-US')} up`
        : `${m.sold_prior_12m.toLocaleString('en-US')} → ${m.sold_12m.toLocaleString('en-US')} sold`;
    const priceLabel = isUpcoming ? 'avg ask' : 'avg sale';
    const priorPhrase = isCustomBase && baseMeta ? `in ${baseMeta.recentUnit} (${baseMeta.label})` : meta.priorUnit;
    const titleText = isUpcoming
      ? `${m.brand} ${m.family}: ${m.sold_prior_12m} sold ${priorPhrase}, ${m.sold_12m} upcoming in ${meta.recentUnit}; ${pct(m.share_move)} after taking out overall supply pace (likely range ${pct(m.share_lo)} to ${pct(m.share_hi)})`
      : `${m.brand} ${m.family}: ${m.sold_prior_12m} sold ${priorPhrase}, ${m.sold_12m} ${meta.recentUnit}; ${pct(m.share_move)} after taking out the market's own growth (likely range ${pct(m.share_lo)} to ${pct(m.share_hi)})`;

    return <button key={key} type="button" className="map-movers2__row" onClick={() => onPick(m)} title={titleText}>
      <span className="map-movers2__name">{m.brand} {m.family}</span>
      <MoveDot m={m} />
      <span className={`map-movers2__move map-movers2__move--${dir}`}>{pct(m.share_move)}</span>
      <span className="map-movers2__counts">{countsText}</span>
      <span className="map-movers2__price">{m.avg_price_move == null ? '' : `${priceLabel} ${pct(m.avg_price_move)}`}</span>
      {rowBins ? <Spark bins={rowBins} direction={dir} /> : <span />}
    </button>;
  };

  const side = (title: string, list: ShareMover[], dir: 'up' | 'down') => <div className="map-movers2__side">
    <div className="map-movers2__title">{title}</div>
    {list.length ? list.map((m) => row(m, dir)) : <div className="map-movers2__none">{loading ? 'reading window…' : 'no real changes'}</div>}
  </div>;

  return <div className="map-movers2" role="group" aria-label="Model families selling more and less">
    <div className="map-movers2__head">
      <div className="map-movers2__relativity" aria-label="Relativity indicator">
        <div className="map-movers2__rel-wrap" ref={popoverRef}>
          <button
            type="button"
            className={`map-movers2__rel-badge${infoOpen ? ' map-movers2__rel-badge--open' : ''}`}
            aria-expanded={infoOpen}
            aria-haspopup="dialog"
            title="Click to read how Relativity & market par are calculated"
            onClick={() => setInfoOpen((v) => !v)}
          >
            RELATIVITY <span className="map-movers2__rel-badge-icon" aria-hidden="true">ⓘ</span>
          </button>
          <div
            className={`map-movers2__popover${infoOpen ? ' map-movers2__popover--open' : ''}`}
            role="dialog"
            aria-label="Relativity methodology"
            aria-hidden={!infoOpen}
          >
            <div className="map-movers2__popover-head">
              <span className="map-movers2__popover-title">RELATIVITY · {activeRelativityLabel}</span>
              <button
                type="button"
                className="map-movers2__popover-close"
                aria-label="Close Relativity explanation"
                onClick={() => setInfoOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="map-movers2__base">
              {isUpcoming ? (
                <>
                  {activeWindowProse}, after taking out overall upcoming supply pace ({pct(paceBatMove)},{' '}
                  {data.bat.sold_prior_12m.toLocaleString('en-US')} sold → {data.bat.sold_12m.toLocaleString('en-US')} upcoming). A family is
                  listed only when its upcoming wave is bigger than luck explains; the bar is the likely range, from half the pace (−50%) to
                  twice the pace (+100%). {data.significant.toLocaleString('en-US')} of {data.eligible.toLocaleString('en-US')} families with{' '}
                  {data.min_sales}+ lots each {meta.eachWindowLabel} shifted for real ({data.families.toLocaleString('en-US')} families read).
                  Avg ask = live current bids, catalog mid-estimates, and active classified asks against recent sold prices. Sources:{' '}
                  {data.sources
                    ? `${data.sources.bat_live.toLocaleString('en-US')} live Bring a Trailer auctions, ${data.sources.auction_calendar.toLocaleString('en-US')} scheduled auction calendar lots${data.sources.facebook_marketplace > 0 ? `, and ${data.sources.facebook_marketplace.toLocaleString('en-US')} active Facebook Marketplace captures` : ''}.`
                    : 'live Bring a Trailer auctions, scheduled auction calendar lots, and active Facebook Marketplace captures.'}
                </>
              ) : (
                <>
                  {activeWindowProse}, after taking out the market's own growth ({pct(paceBatMove)},{' '}
                  {data.bat.sold_prior_12m.toLocaleString('en-US')} → {data.bat.sold_12m.toLocaleString('en-US')}). A family is listed only when its
                  change is bigger than luck explains; the bar is the likely range, from half as many sales (−50%) to twice as many (+100%).
                  {' '}{data.significant.toLocaleString('en-US')} of {data.eligible.toLocaleString('en-US')} families with {data.min_sales}+ measured sales each
                  {' '}{meta.eachWindowLabel} changed for real ({data.families.toLocaleString('en-US')} families read). Avg sale = dollars divided by cars sold, so it
                  moves with which cars sold. Measured at auction houses we hold in full both years: today Bring a Trailer.
                </>
              )}
            </div>
          </div>
        </div>
        <span className="map-movers2__rel-window">{activeRelativityLabel}</span>
        <span className="map-movers2__rel-baseline">
          {isUpcoming ? 'SUPPLY PAR' : isCustomBase ? 'PACE PAR' : 'MARKET PAR'} {pct(paceBatMove)} ({data.bat.sold_prior_12m.toLocaleString('en-US')}{isCustomBase && baseMeta ? `/${baseMeta.label}` : ''} → {data.bat.sold_12m.toLocaleString('en-US')}{isCustomBase ? `/${meta.label}` : ''})
        </span>
        <span className="map-movers2__rel-scale" aria-hidden="true">
          <span>0.5× (−50%)</span>
          <span className="map-movers2__rel-tick">| 1× PAR</span>
          <span>2× (+100%)</span>
        </span>
      </div>
      <div className="map-movers2__controls">
        <div className="map-movers2__dial" role="tablist" aria-label="Relativity time horizon">
          <span className="map-movers2__dial-tag" aria-hidden="true">WINDOW</span>
          {MOVER_HORIZONS.map((h) => {
            const active = h.key === horizon;
            return (
              <button
                key={h.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`map-movers2__dial-btn${active ? ' map-movers2__dial-btn--active' : ''}${h.key === 'upcoming' ? ' map-movers2__dial-btn--upcoming' : ''}`}
                title={h.title}
                onClick={() => setHorizon(h.key)}
              >
                {h.label}
              </button>
            );
          })}
        </div>
        <div className="map-movers2__vs-dial" role="group" aria-label="Relativity baseline window">
          <span className="map-movers2__dial-tag" aria-hidden="true">VS</span>
          {BASELINE_HORIZONS.map((b) => {
            const isMatchedPrior = b.key === 'prior' && (!isCustomBase);
            const active = isMatchedPrior || (isCustomBase && b.key === baselineHorizon);
            const disabled = b.key !== 'prior' && b.key === horizon;
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                className={`map-movers2__vs-btn${active ? ' map-movers2__vs-btn--active' : ''}`}
                title={disabled ? `Already comparing ${b.label} against its prior ${b.label} window` : b.title}
                onClick={() => setBaselineHorizon(b.key)}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
    <div className="map-movers2__sides">
      {side(meta.gainingTitle, data.gaining, 'up')}
      {side(meta.losingTitle, data.losing, 'down')}
    </div>
  </div>;
}
