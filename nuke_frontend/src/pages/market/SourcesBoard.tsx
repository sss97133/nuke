import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { OrgLogo } from '../../components/common/OrgLogo';
import {
  buildFacetDrilldownUrl,
  classifyVehicleFacet,
  resolveVehicleIdentityMark,
} from '../../lib/market/vehicleTaxonomy';
import './SourcesBoard.css';

// Every source on one board with the same measures, ranked by the lots we hold for it (market_sources_read,
// 20261018034000). Owner, 2026-10-15: "when are we gonna see the site treat all sources the same? the sources should be
// rising based on their data". No source is named in this file: the order, the bars and the counts all come from the
// reader, so a source moves up as more of its data lands. Held counts carry the time their fold was measured.
const COLUMNS = ['source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population', 'population_method',
  'population_confidence', 'population_at', 'map_sales', 'map_usd', 'sales_12m', 'usd_12m', 'sales_prior_12m',
  'usd_prior_12m', 'months', 'live_lots', 'live_at', 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d',
  'last_landed', 'days14', 'logo_url', 'business_type'] as const;
type Column = typeof COLUMNS[number];
const SHOWN = 10;

export type LandingHorizon = '14d' | '24h' | '1h';

export type LandingRecentEvent = {
  id: string;
  source: string;
  eventType: string | null;
  eventStatus: string | null;
  reserve: string | null;
  price: number | null;
  bidCount: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  series?: string | null;
  trim: string | null;
  bodyStyle?: string | null;
  vin: string | null;
  mileage: number | null;
  recordDate: string | null;
  title: string | null;
  rawTitle: string | null;
  lot: string | null;
  vehicleId: string | null;
  sourceUrl: string | null;
  createdAt: string;
};

export type SourceTopMakeEntry = {
  make: string;
  count: number;
};

export type SourceTopModelEntry = {
  make: string | null;
  model: string;
  count: number;
};

export type StreamFacetDistributionPill = {
  axis: 'series' | 'trim' | 'body';
  prefix: 'SER' | 'TRM' | 'BDY';
  value: string;
  count: number;
};

export type DrillStreamSortMode = 'latest' | 'price' | 'year';

export type DrillCohortSummary = {
  totalStreamCount: number;
  filteredCount: number;
  soldCount: number;
  sellThroughPct: number | null;
  medianSoldPrice: number | null;
};

export type SourceDrillStats = {
  source: string | null;
  name: string | null;
  category: string | null;
  house: string | null;
  held: number | null;
  heldAt: string | null;
  population: number | null;
  populationMethod: string | null;
  populationConfidence: number | null;
  populationAt: string | null;
  coverageShare: number | null;
  mapSales: number | null;
  mapUsd: number | null;
  sales12: number | null;
  usd12: number | null;
  salesPrior12: number | null;
  usdPrior12: number | null;
  topMakes?: SourceTopMakeEntry[];
  topModels?: SourceTopModelEntry[];
};

export type SourceLandingDetail = {
  asOf: string;
  source: string | null;
  hour: string | null;
  selectedHour: string | null;
  bucket5m: string | null;
  landed15m: number;
  landed1h: number;
  landed24: number;
  landed7: number;
  lastLanded: string | null;
  hours24: number[];
  mins60: number[];
  days14: number[];
  stats: SourceDrillStats | null;
  topMakes?: SourceTopMakeEntry[];
  topModels?: SourceTopModelEntry[];
  recent: LandingRecentEvent[];
};

export type SourceRow = {
  source: string; name: string; category: string | null; house: string | null;
  held: number | null; heldAt: string | null;
  population: number | null; populationMethod: string | null; populationConfidence: number | null; populationAt: string | null;
  mapSales: number | null; mapUsd: number | null;
  sales12: number | null; usd12: number | null; salesPrior12: number | null; usdPrior12: number | null;
  /** [YYYY-MM, sales, dollars], oldest first, the last 24 months. */
  months: [string, number, number][];
  live: number; liveAt: string | null;
  heldBefore: number | null; beforeDay: string | null;
  /** Records landed (vehicle_events) in the last 15m, 1h, 24h, and 7d, the last timestamp any landed, and 14d / 24h / 60m bins. */
  landed15m: number; landed1h: number; landed24: number; landed7: number; lastLanded: string | null;
  days14: number[]; hours24: number[]; mins60: number[];
  /** The source's organization's recorded identity (organizations.logo_url, business_type), drawn by OrgLogo. */
  logoUrl: string | null; businessType: string | null;
  /** Optional dealer organization identifier/slug and headquarters city/state metadata when provided. */
  organizationId?: string | null;
  hqCity?: string | null;
  hqState?: string | null;
  hqLocation?: string | null;
};

export type BoardLandingMeta = {
  hour: string | null;
  bucket5m: string | null;
  landed15m: number;
  landed1h: number;
  landed24: number;
  landed7: number;
  hours24: number[];
  mins60: number[];
};

export type SourcesBoardData = {
  asOf: string;
  day: string | null;
  rows: SourceRow[];
  notRanked: Record<string, number>;
  landing: BoardLandingMeta;
};

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x
  : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
const numArray = (x: unknown, len?: number): number[] => {
  if (!Array.isArray(x)) return len ? Array(len).fill(0) : [];
  const parsed = x.map((item) => num(item) ?? 0);
  if (len && parsed.length < len) return [...Array(len - parsed.length).fill(0), ...parsed];
  return parsed;
};
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The reader's value as typed rows, decoded by column name; anything else is null. */
export function parseSources(value: unknown): SourcesBoardData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as {
    as_of?: unknown;
    day?: unknown;
    columns?: unknown;
    rows?: unknown;
    not_ranked?: unknown;
    landing?: unknown;
  };
  if (typeof v.as_of !== 'string' || !Array.isArray(v.columns) || !Array.isArray(v.rows)) return null;
  const columns = v.columns as unknown[];
  const at = Object.fromEntries(COLUMNS.map((c) => [c, columns.indexOf(c)])) as Record<Column, number>;
  if (at.source < 0 || at.name < 0 || at.held_lots < 0) return null;

  const rawLanding = v.landing && typeof v.landing === 'object' && !Array.isArray(v.landing)
    ? (v.landing as { hour?: unknown; bucket_5m?: unknown; totals?: unknown; sources?: unknown })
    : null;
  const rawSourcesLanding = rawLanding?.sources && typeof rawLanding.sources === 'object' && !Array.isArray(rawLanding.sources)
    ? (rawLanding.sources as Record<string, unknown>)
    : {};
  const rawTotals = rawLanding?.totals && typeof rawLanding.totals === 'object' && !Array.isArray(rawLanding.totals)
    ? (rawLanding.totals as Record<string, unknown>)
    : {};

  const rows: SourceRow[] = [];
  for (const r of v.rows) {
    if (!Array.isArray(r)) continue;
    const get = (c: Column) => (at[c] >= 0 ? r[at[c]] : null);
    const source = str(get('source')), name = str(get('name'));
    if (!source || !name) continue;
    const months = (Array.isArray(get('months')) ? get('months') as unknown[] : [])
      .filter((m): m is unknown[] => Array.isArray(m) && typeof m[0] === 'string')
      .map((m) => [m[0] as string, num(m[1]) ?? 0, num(m[2]) ?? 0] as [string, number, number]);

    const srcLand = rawSourcesLanding[source] && typeof rawSourcesLanding[source] === 'object' && !Array.isArray(rawSourcesLanding[source])
      ? (rawSourcesLanding[source] as Record<string, unknown>)
      : null;

    const landed24 = num(srcLand?.landed_24h) ?? num(get('landed_24h')) ?? 0;
    const landed7 = num(srcLand?.landed_7d) ?? num(get('landed_7d')) ?? 0;
    const landed15m = num(srcLand?.landed_15m) ?? 0;
    const landed1h = num(srcLand?.landed_1h) ?? 0;
    const lastLanded = str(srcLand?.last_at) ?? str(get('last_landed'));
    const days14 = Array.isArray(get('days14')) ? (get('days14') as unknown[]).map((x) => num(x) ?? 0) : [];
    const hours24 = Array.isArray(srcLand?.hours24)
      ? numArray(srcLand.hours24, 24)
      : [...Array(23).fill(0), landed24];
    const mins60 = Array.isArray(srcLand?.mins60)
      ? numArray(srcLand.mins60, 12)
      : [...Array(11).fill(0), landed1h];

    const rawLogo = str(get('logo_url'));
    const logoUrl = rawLogo ? rawLogo.replace(/^https:\/\/nuke\.ag\/source-logos\//, '/source-logos/') : null;
    const getOptional = (...names: string[]): unknown => {
      for (const n of names) {
        const idx = columns.indexOf(n);
        if (idx >= 0 && r[idx] != null) return r[idx];
      }
      return null;
    };
    const organizationId = str(getOptional('organization_id', 'org_id', 'business_id', 'org_slug', 'organization_slug'));
    const hqCity = str(getOptional('hq_city', 'city'));
    const hqState = str(getOptional('hq_state', 'state'));
    const hqLocation = str(getOptional('hq_location', 'location'));

    rows.push({
      source, name, category: str(get('category')), house: str(get('house')),
      held: num(get('held_lots')), heldAt: str(get('held_at')),
      population: num(get('population')), populationMethod: str(get('population_method')),
      populationConfidence: num(get('population_confidence')), populationAt: str(get('population_at')),
      mapSales: num(get('map_sales')), mapUsd: num(get('map_usd')),
      sales12: num(get('sales_12m')), usd12: num(get('usd_12m')), salesPrior12: num(get('sales_prior_12m')),
      usdPrior12: num(get('usd_prior_12m')), months,
      live: num(get('live_lots')) ?? 0, liveAt: str(get('live_at')),
      heldBefore: num(get('held_lots_before')), beforeDay: str(get('before_day')),
      landed15m, landed1h, landed24, landed7, lastLanded,
      days14, hours24, mins60,
      logoUrl, businessType: str(get('business_type')),
      organizationId, hqCity, hqState, hqLocation,
    });
  }
  const notRanked: Record<string, number> = {};
  if (v.not_ranked && typeof v.not_ranked === 'object' && !Array.isArray(v.not_ranked)) {
    for (const [k, n] of Object.entries(v.not_ranked as Record<string, unknown>)) { const c = num(n); if (c) notRanked[k] = c; }
  }

  const landing: BoardLandingMeta = {
    hour: str(rawLanding?.hour) ?? str(v.as_of),
    bucket5m: str(rawLanding?.bucket_5m) ?? str(v.as_of),
    landed15m: num(rawTotals.landed_15m) ?? rows.reduce((acc, r) => acc + r.landed15m, 0),
    landed1h: num(rawTotals.landed_1h) ?? rows.reduce((acc, r) => acc + r.landed1h, 0),
    landed24: num(rawTotals.landed_24h) ?? rows.reduce((acc, r) => acc + r.landed24, 0),
    landed7: num(rawTotals.landed_7d) ?? rows.reduce((acc, r) => acc + r.landed7, 0),
    hours24: Array.isArray(rawTotals.hours24) ? numArray(rawTotals.hours24, 24) : Array(24).fill(0),
    mins60: Array.isArray(rawTotals.mins60) ? numArray(rawTotals.mins60, 12) : Array(12).fill(0),
  };

  return { asOf: v.as_of, day: str(v.day), rows, notRanked, landing };
}

function parseTopMakesList(raw: unknown): SourceTopMakeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceTopMakeEntry[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      const mk = str(item[0]);
      const cnt = num(item[1]) ?? 1;
      if (mk) out.push({ make: mk, count: cnt });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const mk = str(obj.make) ?? str(obj.name) ?? str(obj.label);
      const cnt = num(obj.count) ?? num(obj.lots) ?? num(obj.vehicles) ?? num(obj.total) ?? 1;
      if (mk) out.push({ make: mk, count: cnt });
    } else if (typeof item === 'string' && item.trim()) {
      out.push({ make: item.trim(), count: 1 });
    }
  }
  return out;
}

function parseTopModelsList(raw: unknown): SourceTopModelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceTopModelEntry[] = [];
  for (const item of raw) {
    if (Array.isArray(item)) {
      if (item.length >= 3) {
        const mk = str(item[0]);
        const md = str(item[1]);
        const cnt = num(item[2]) ?? 1;
        if (md) out.push({ make: mk, model: md, count: cnt });
      } else {
        const md = str(item[0]);
        const cnt = num(item[1]) ?? 1;
        if (md) out.push({ make: null, model: md, count: cnt });
      }
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const mk = str(obj.make) ?? str(obj.brand) ?? null;
      const md = str(obj.model) ?? str(obj.name) ?? str(obj.label);
      const cnt = num(obj.count) ?? num(obj.lots) ?? num(obj.vehicles) ?? num(obj.total) ?? 1;
      if (md) out.push({ make: mk, model: md, count: cnt });
    } else if (typeof item === 'string' && item.trim()) {
      out.push({ make: null, model: item.trim(), count: 1 });
    }
  }
  return out;
}

/** Decodes public.market_source_landing_read(p_source, p_hour). */
export function parseSourceLanding(value: unknown): SourceLandingDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.as_of !== 'string') return null;
  const recent: LandingRecentEvent[] = [];
  const rawRecentList =
    Array.isArray(v.recent_vehicles) && v.recent_vehicles.length > 0
      ? v.recent_vehicles
      : Array.isArray(v.recent)
        ? v.recent
        : Array.isArray(v.recent_vehicles)
          ? v.recent_vehicles
          : [];
  for (let idx = 0; idx < rawRecentList.length; idx += 1) {
    const item = rawRecentList[idx];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const ev = item as Record<string, unknown>;
    const id = str(ev.id) ?? str(ev.vehicle_id) ?? `ev-${idx}`;
    const source = str(ev.source) ?? str(v.source) ?? 'unknown';
    const createdAt = str(ev.created_at) ?? str(ev.createdAt) ?? v.as_of;
    if (!id || !source || !createdAt) continue;
    recent.push({
      id,
      source,
      eventType: str(ev.event_type) ?? str(ev.eventType),
      eventStatus: str(ev.event_status) ?? str(ev.eventStatus),
      reserve: str(ev.reserve),
      price: num(ev.price),
      bidCount: num(ev.bid_count) ?? num(ev.bidCount),
      year: num(ev.year),
      make: str(ev.make),
      model: str(ev.model),
      series: str(ev.series),
      trim: str(ev.trim),
      bodyStyle: str(ev.body_style) ?? str(ev.bodyStyle),
      vin: str(ev.vin),
      mileage: num(ev.mileage),
      recordDate: str(ev.record_date) ?? str(ev.recordDate),
      title: str(ev.title),
      rawTitle: str(ev.raw_title) ?? str(ev.rawTitle),
      lot: str(ev.lot),
      vehicleId: str(ev.vehicle_id) ?? str(ev.vehicleId),
      sourceUrl: str(ev.source_url) ?? str(ev.sourceUrl),
      createdAt,
    });
  }
  const rawStats = v.stats && typeof v.stats === 'object' && !Array.isArray(v.stats)
    ? (v.stats as Record<string, unknown>)
    : null;
  const parsedTopMakes = parseTopMakesList(
    v.top_makes ?? v.topMakes ?? rawStats?.top_makes ?? rawStats?.topMakes,
  );
  const parsedTopModels = parseTopModelsList(
    v.top_models ?? v.topModels ?? rawStats?.top_models ?? rawStats?.topModels,
  );
  const stats: SourceDrillStats | null = rawStats
    ? {
        source: str(rawStats.source),
        name: str(rawStats.name),
        category: str(rawStats.category),
        house: str(rawStats.house),
        held: num(rawStats.held_lots),
        heldAt: str(rawStats.held_at),
        population: num(rawStats.population),
        populationMethod: str(rawStats.population_method),
        populationConfidence: num(rawStats.population_confidence),
        populationAt: str(rawStats.population_at),
        coverageShare: num(rawStats.coverage_share),
        mapSales: num(rawStats.map_sales),
        mapUsd: num(rawStats.map_usd),
        sales12: num(rawStats.sales_12m),
        usd12: num(rawStats.usd_12m),
        salesPrior12: num(rawStats.sales_prior_12m),
        usdPrior12: num(rawStats.usd_prior_12m),
        topMakes: parsedTopMakes.length > 0 ? parsedTopMakes : undefined,
        topModels: parsedTopModels.length > 0 ? parsedTopModels : undefined,
      }
    : null;
  return {
    asOf: v.as_of,
    source: str(v.source),
    hour: str(v.hour),
    selectedHour: str(v.selected_hour),
    bucket5m: str(v.bucket_5m),
    landed15m: num(v.landed_15m) ?? 0,
    landed1h: num(v.landed_1h) ?? 0,
    landed24: num(v.landed_24h) ?? 0,
    landed7: num(v.landed_7d) ?? 0,
    lastLanded: str(v.last_landed),
    hours24: numArray(v.hours24, 24),
    mins60: numArray(v.mins60, 12),
    days14: numArray(v.days14, 14),
    stats,
    topMakes: parsedTopMakes.length > 0 ? parsedTopMakes : undefined,
    topModels: parsedTopModels.length > 0 ? parsedTopModels : undefined,
    recent,
  };
}

const count = (n: number) => Math.round(n).toLocaleString('en-US');
const compactCount = (n: number) => {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
};
export function money(n: number | null): string {
  if (n == null || !(n > 0)) return '';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
/** What share of the source's own total we hold, in words that keep the total's method. */
export function heldShare(row: Pick<SourceRow, 'held' | 'population' | 'populationMethod'>): { share: number | null; text: string } {
  if (row.held == null) return { share: null, text: '' };
  if (!(row.population != null && row.population > 0)) return { share: null, text: 'their total unknown' };
  const share = row.held / row.population;
  const pct = share >= 0.995 ? '100%' : share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
  const of = row.populationMethod === 'enumerated' ? 'of' : 'of about';
  return { share: Math.min(1, share), text: `${pct} ${of} ${count(row.population)}` };
}
const METHOD: Record<string, string> = {
  enumerated: 'counted from their own listings',
  bounded: 'estimated within a range',
  search_index: 'from their search index',
  api_count: 'from their API total',
  sitemap: 'from their sitemap index',
  docket_and_broadcast_census: 'from docket & broadcast census',
  window_extrapolated: 'extrapolated from cohort window & gap density',
  turnover_model: 'modeled from active inventory & daily turnover',
  capture_model: 'modeled from capture velocity & unseen-mass prior',
};
function shortDay(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function heldWhen(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit',
    minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
}
export function formatAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ${min % 60}m ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** 24 monthly bars ending at the board's month: the earlier 12 faint, the last 12 solid. */
export function monthBars(months: SourceRow['months'], day: string | null): number[] {
  const end = day ? new Date(`${day}T00:00:00Z`) : new Date();
  const keys: string[] = [];
  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const by = new Map(months.map(([m, n]) => [m, n]));
  return keys.map((k) => by.get(k) ?? 0);
}
function Spark({ bars }: { bars: number[] }) {
  const max = Math.max(...bars);
  if (!(max > 0)) return null;
  const w = 3, gap = 1, h = 18;
  return (
    <svg className="market-sources__spark" width={bars.length * (w + gap)} height={h} viewBox={`0 0 ${bars.length * (w + gap)} ${h}`}
      aria-hidden="true">
      {bars.map((n, i) => {
        const bh = n > 0 ? Math.max(1, (n / max) * h) : 0;
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh}
          className={i < 12 ? 'market-sources__bar--prior' : 'market-sources__bar--recent'} />;
      })}
    </svg>
  );
}

/** Landing now: records in the selected horizon (14d / 24h / 1h), a dot that says whether any landed, idle since when if not. */
export function landingState(
  row: Pick<SourceRow, 'landed24' | 'lastLanded'> & Partial<Pick<SourceRow, 'landed1h' | 'landed15m'>>,
  horizon: LandingHorizon | number = '14d',
): { active: boolean; text: string } {
  const mode: LandingHorizon = typeof horizon === 'string' ? horizon : '14d';
  const l15 = row.landed15m ?? 0;
  const l1h = row.landed1h ?? 0;

  if (mode === '1h') {
    if (l15 > 0) return { active: true, text: `+${count(l15)}/15m · ${count(l1h)} 1h` };
    if (l1h > 0) return { active: true, text: `+${count(l1h)} in 1h` };
    if (row.landed24 > 0) return { active: false, text: `0 in 1h · +${count(row.landed24)} today` };
  } else if (mode === '24h') {
    if (l1h > 0) return { active: true, text: `+${count(l1h)}/hr · ${count(row.landed24)} 24h` };
    if (row.landed24 > 0) return { active: true, text: `+${count(row.landed24)} / 24h` };
  } else if (row.landed24 > 0) {
    return { active: true, text: `+${count(row.landed24)} today` };
  }

  if (!row.lastLanded) return { active: false, text: 'idle 14+ days' };   // the landing log keeps 14 days
  const t = Date.parse(row.lastLanded);
  if (Number.isNaN(t)) return { active: false, text: 'idle' };
  return { active: false, text: `idle since ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` };
}

function DayBars({ days, mode = '14d' }: { days: number[]; mode?: LandingHorizon }) {
  const max = Math.max(0, ...days);
  if (!(max > 0) || days.length === 0) return null;
  const w = mode === '24h' ? 2.5 : mode === '1h' ? 4.5 : 4;
  const gap = 1;
  const h = 16;
  const totalW = days.length * (w + gap);
  return (
    <svg className="market-sources__days" width={totalW} height={h} viewBox={`0 0 ${totalW} ${h}`}
      aria-hidden="true">
      {days.map((n, i) => {
        const bh = n > 0 ? Math.max(1, (Math.sqrt(n) / Math.sqrt(max)) * h) : 0;
        const isCurrent = i === days.length - 1 || (mode === '1h' && i >= days.length - 3 && n > 0);
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh}
          className={isCurrent ? 'market-sources__day--today' : 'market-sources__day'} />;
      })}
    </svg>
  );
}

/** A source's name without the registry's method note in parentheses ("eBay Motors (Browse API)" reads "eBay Motors"). */
export const shortName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '') || name;

export type SourceCategory = 'auction' | 'marketplace' | 'dealer';

export const CATEGORY_BADGE_LABELS: Record<SourceCategory, string> = {
  auction: 'AUCTION HOUSE',
  marketplace: 'MARKETPLACE',
  dealer: 'DEALER / CONSIGNOR',
};

export function resolveSourceCategory(row: Pick<SourceRow, 'category' | 'businessType'>): SourceCategory | null {
  if (row.category === 'dealer' || row.businessType === 'dealer') return 'dealer';
  if (row.category === 'auction' || row.businessType === 'auction_house') return 'auction';
  if (row.category === 'marketplace' || row.businessType === 'marketplace') return 'marketplace';
  return null;
}

export function categoryBadgeLabel(row: Pick<SourceRow, 'category' | 'businessType'>): string | null {
  const cat = resolveSourceCategory(row);
  return cat ? CATEGORY_BADGE_LABELS[cat] : null;
}

export const KNOWN_DEALER_ORGANIZATIONS: Record<string, string> = {
  'avant-garde-collection': 'avant-garde-collection',
  avantgardecollection: 'avant-garde-collection',
  beverlyhillscarclub: 'beverlyhillscarclub',
  'beverly-hills-car-club': 'beverlyhillscarclub',
  wob: 'wob',
  'collectible-classics': 'collectible-classics',
  collectibleclassics: 'collectible-classics',
  '1600veloce': '1600veloce',
  'vantage-auto': 'vantage-auto',
  vantageauto: 'vantage-auto',
  'geneva-motorcars': 'geneva-motorcars',
  genevamotorcars: 'geneva-motorcars',
  'aeg-motorsports': 'aeg-motorsports',
  aegmotorsports: 'aeg-motorsports',
  'lart-de-lautomobile': 'lart-de-lautomobile',
  lartdelautomobile: 'lart-de-lautomobile',
  'michaels-motor-cars': 'michaels-motor-cars',
  michaelsmotorcars: 'michaels-motor-cars',
  'private-collection-motors': 'private-collection-motors',
  privatecollectionmotors: 'private-collection-motors',
  'bullet-motorsports': 'bullet-motorsports',
  bulletmotorsports: 'bullet-motorsports',
  'mohr-imports': 'mohr-imports',
  mohrimports: 'mohr-imports',
  'dean-laumbach': 'dean-laumbach',
  deanlaumbach: 'dean-laumbach',
  'silver-arrow-cars': 'silver-arrow-cars',
  silverarrowcars: 'silver-arrow-cars',
  mcqueens: 'mcqueens',
  'fantasy-junction': 'fantasy-junction',
  fantasyjunction: 'fantasy-junction',
  'tactical-fleet': 'tactical-fleet',
  tacticalfleet: 'tactical-fleet',
  'streetside-classics': 'streetside-classics',
  streetsideclassics: 'streetside-classics',
  'grand-prix-classics': 'grand-prix-classics',
  grandprixclassics: 'grand-prix-classics',
  'vanguard-motor-sales': 'vanguard-motor-sales',
  vanguardmotorsales: 'vanguard-motor-sales',
  'gateway-classic-cars': 'gateway-classic-cars',
  gatewayclassiccars: 'gateway-classic-cars',
  'blue-chip-fleet': 'blue-chip-fleet',
  bluechipfleet: 'blue-chip-fleet',
  'velocity-restorations': 'velocity-restorations',
  velocityrestorations: 'velocity-restorations',
  'volo-auto-museum': 'volo-auto-museum',
  voloautomuseum: 'volo-auto-museum',
};

/**
 * Resolves a direct `/organization/<slug_or_id>` profile URL when a dealer source row
 * maps to a known dealer organization ID or slug.
 */
export function resolveDealerProfileHref(
  row: Pick<SourceRow, 'source' | 'category' | 'businessType'> & Partial<Pick<SourceRow, 'organizationId'>>,
): string | null {
  if (resolveSourceCategory(row) !== 'dealer') return null;
  const explicitId = row.organizationId?.trim();
  if (explicitId) return `/organization/${explicitId}`;
  const rawSource = row.source?.trim();
  if (!rawSource) return null;
  const known = KNOWN_DEALER_ORGANIZATIONS[rawSource.toLowerCase()] ?? KNOWN_DEALER_ORGANIZATIONS[normKey(rawSource)];
  if (known) return `/organization/${known}`;
  if (/^[a-z0-9][a-z0-9-_]*$/i.test(rawSource)) return `/organization/${rawSource}`;
  return null;
}

/**
 * Formats the dealer headquarters city/state badge when present in row metadata.
 */
export function formatDealerHqBadge(
  row: Partial<Pick<SourceRow, 'hqCity' | 'hqState' | 'hqLocation'>>,
): string | null {
  const loc = row.hqLocation?.trim();
  if (loc) return loc;
  const city = row.hqCity?.trim();
  const state = row.hqState?.trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return null;
}

export type DealerConsignmentBreakdown = {
  consignedCount: number;
  directCount: number;
  totalRecent: number;
  consignedPct: number | null;
  directPct: number | null;
  heldVehicles: number;
  liveVehicles: number;
  confirmedSales: number;
  sales12m: number;
  usd12m: number | null;
  modeLabel: string;
  summaryText: string;
  hqBadge: string | null;
  profileHref: string | null;
};

/**
 * Computes a dealer's consigned vs. direct inventory breakdown from its recent event stream
 * and source-day inventory/sales metrics so the expanded inspector shows clear dealer context.
 */
export function describeDealerConsignment(
  row: Pick<SourceRow, 'held' | 'live' | 'mapSales' | 'sales12' | 'usd12'> &
    Partial<Pick<SourceRow, 'source' | 'category' | 'businessType' | 'organizationId' | 'hqCity' | 'hqState' | 'hqLocation'>>,
  recent: ReadonlyArray<Pick<LandingRecentEvent, 'eventType' | 'eventStatus' | 'reserve' | 'bidCount'>>,
): DealerConsignmentBreakdown {
  let consignedCount = 0;
  let directCount = 0;
  for (const ev of recent) {
    const et = (ev.eventType ?? '').toLowerCase();
    const isAuctionOrConsigned =
      et === 'auction' ||
      et === 'consignment' ||
      (ev.bidCount != null && ev.bidCount > 0) ||
      ev.reserve === 'no_reserve' ||
      ev.reserve === 'reserve';
    if (isAuctionOrConsigned) consignedCount += 1;
    else directCount += 1;
  }
  const totalRecent = recent.length;
  const consignedPct = totalRecent > 0 ? Math.round((consignedCount / totalRecent) * 100) : null;
  const directPct = totalRecent > 0 ? 100 - (consignedPct ?? 0) : null;
  const heldVehicles = row.held ?? 0;
  const liveVehicles = row.live ?? 0;
  const confirmedSales = row.mapSales ?? 0;
  const sales12m = row.sales12 ?? 0;
  const usd12m = row.usd12 ?? null;

  let modeLabel = 'Consignment & direct inventory';
  if (totalRecent > 0) {
    if (consignedCount > 0 && directCount > 0) {
      modeLabel = `Mixed · ${consignedPct}% consigned / ${directPct}% direct`;
    } else if (consignedCount > 0) {
      modeLabel = `Auction consignment (${consignedCount}/${totalRecent} recent lots)`;
    } else {
      modeLabel = `Direct dealer listings (${directCount}/${totalRecent} recent listings)`;
    }
  } else if (confirmedSales > 0 && liveVehicles > 0) {
    modeLabel = 'Consignment & direct showroom';
  } else if (confirmedSales > 0) {
    modeLabel = 'Auction consignor';
  } else if (liveVehicles > 0) {
    modeLabel = 'Direct dealer showroom';
  }

  const parts: string[] = [`${count(heldVehicles)} vehicles held`];
  if (liveVehicles > 0) parts.push(`${count(liveVehicles)} live`);
  if (sales12m > 0) {
    parts.push(`${count(sales12m)} sales (12m)${usd12m ? ` · ${money(usd12m)}` : ''}`);
  } else if (confirmedSales > 0) {
    parts.push(`${count(confirmedSales)} confirmed sales`);
  }
  if (totalRecent > 0) {
    parts.push(`${consignedCount} consigned · ${directCount} direct in stream`);
  }

  const hqBadge = formatDealerHqBadge(row);
  const profileHref = row.source
    ? resolveDealerProfileHref({
        source: row.source,
        category: row.category ?? 'dealer',
        businessType: row.businessType ?? 'dealer',
        organizationId: row.organizationId,
      })
    : null;

  return {
    consignedCount,
    directCount,
    totalRecent,
    consignedPct,
    directPct,
    heldVehicles,
    liveVehicles,
    confirmedSales,
    sales12m,
    usd12m,
    modeLabel,
    summaryText: parts.join(' · '),
    hqBadge,
    profileHref,
  };
}

const GROUPS: [SourceCategory, string, string][] = [
  ['auction', 'Auction houses', 'lots held'],
  ['marketplace', 'Marketplaces', 'listings held'],
  ['dealer', 'Dealers', 'vehicles held'],
];
const NOT_RANKED_WORDS: Record<string, string> = {
  'capture channels': 'capture channel', aggregator: 'aggregator', dealer: 'dealer', shop: 'shop', registry: 'registry',
  social_media: 'social channel', forum: 'forum', documentation: 'archive', owner: 'owner source', internal: 'internal source',
};

const HORIZON_LABELS: Record<LandingHorizon, string> = {
  '14d': 'landing, last 14 days',
  '24h': 'landing, last 24 hours',
  '1h': 'landing, live 60m',
};

const NEXT_HORIZON: Record<LandingHorizon, LandingHorizon> = {
  '14d': '24h',
  '24h': '1h',
  '1h': '14d',
};

function hourSlotIso(endHourIso: string | null, indexFromStart: number, total = 24): string | null {
  const base = endHourIso ? Date.parse(endHourIso) : Date.now();
  if (Number.isNaN(base)) return null;
  const slotMs = base - (total - 1 - indexFromStart) * 3600_000;
  return new Date(Math.floor(slotMs / 3600_000) * 3600_000).toISOString();
}

function daySlotIso(endDayIso: string | null, indexFromStart: number, total = 14): string {
  const base = endDayIso ? Date.parse(`${endDayIso.slice(0, 10)}T00:00:00Z`) : Date.now();
  if (Number.isNaN(base)) return '';
  return new Date(base - (total - 1 - indexFromStart) * 86400_000).toISOString().slice(0, 10);
}

function formatHourLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

function formatExactTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }) + ' UTC';
}

export type RecordDateSummary = {
  dateText: string;
  ageText: string;
  kind: 'live' | 'fresh' | 'backfill' | 'missing';
  fullTitle: string;
};

/**
 * Formats the record's own event/listing/sale date alongside its age so historical
 * backfills (e.g. 2021–2024 auctions ingested today) never look like brand-new live records.
 */
export function describeRecordDate(recordDate: string | null, now = Date.now()): RecordDateSummary {
  if (!recordDate || !recordDate.trim()) {
    return {
      dateText: 'no date',
      ageText: 'missing',
      kind: 'missing',
      fullTitle: 'Record event/listing date not extracted by ingestion pipeline',
    };
  }
  const raw = recordDate.trim();
  if (/^\d{4}$/.test(raw)) {
    const yr = Number(raw);
    const nowYr = new Date(now).getUTCFullYear();
    const diffYr = Math.max(0, nowYr - yr);
    return {
      dateText: String(yr),
      ageText: diffYr === 0 ? 'this yr' : `${diffYr}y old`,
      kind: diffYr === 0 ? 'fresh' : 'backfill',
      fullTitle: `Record year ${yr} (${diffYr === 0 ? 'current year' : `${diffYr}y old historical backfill`})`,
    };
  }
  const norm = raw.length === 10
    ? `${raw}T00:00:00Z`
    : raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T').replace(/([+-]\d{2})$/, '$1:00');
  const t = Date.parse(norm);
  if (Number.isNaN(t)) {
    return {
      dateText: raw.slice(0, 10),
      ageText: '',
      kind: 'backfill',
      fullTitle: raw,
    };
  }
  const d = new Date(t);
  const dateText = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (t > now + 60_000) {
    const remHrs = (t - now) / 3600_000;
    const ageText = remHrs >= 24 ? `ends +${Math.round(remHrs / 24)}d` : `ends +${Math.max(1, Math.round(remHrs))}h`;
    return {
      dateText,
      ageText,
      kind: 'live',
      fullTitle: `Live event closing ${dateText} (${ageText})`,
    };
  }
  const ageDays = Math.max(0, (now - t) / 86400_000);
  if (ageDays < 1) {
    return {
      dateText,
      ageText: 'today',
      kind: 'fresh',
      fullTitle: `Current-day record (${dateText})`,
    };
  }
  if (ageDays <= 14) {
    const dCount = Math.max(1, Math.round(ageDays));
    return {
      dateText,
      ageText: `${dCount}d old`,
      kind: 'fresh',
      fullTitle: `Recent record from ${dateText} (${dCount}d old)`,
    };
  }
  if (ageDays < 60) {
    const wCount = Math.max(2, Math.round(ageDays / 7));
    return {
      dateText,
      ageText: `${wCount}w old`,
      kind: 'backfill',
      fullTitle: `Historical backfill from ${dateText} (${wCount} weeks old)`,
    };
  }
  if (ageDays < 365) {
    const mCount = Math.max(2, Math.round(ageDays / 30.44));
    return {
      dateText,
      ageText: `${mCount}mo old`,
      kind: 'backfill',
      fullTitle: `Historical backfill from ${dateText} (${mCount} months old)`,
    };
  }
  const yrs = ageDays / 365.25;
  const yrStr = yrs >= 9.5 ? `${Math.round(yrs)}y old` : `${yrs.toFixed(1).replace(/\.0$/, '')}y old`;
  return {
    dateText,
    ageText: yrStr,
    kind: 'backfill',
    fullTitle: `Historical backfill from ${dateText} (${yrStr})`,
  };
}

function formatVinOrLot(ev: LandingRecentEvent): { text: string; isVin: boolean; isMissing: boolean; title: string } {
  if (ev.vin) {
    return {
      text: ev.vin,
      isVin: true,
      isMissing: false,
      title: `Structured VIN / Chassis: ${ev.vin}`,
    };
  }
  if (ev.lot) {
    const raw = ev.lot.trim();
    const isUrlSlug = raw.includes('/') || raw.includes('.com');
    if (!isUrlSlug && raw.length <= 18) {
      return {
        text: `Lot ${raw}`,
        isVin: false,
        isMissing: false,
        title: `No VIN extracted · Source lot/listing ID: ${raw}`,
      };
    }
  }
  return {
    text: '—',
    isVin: false,
    isMissing: true,
    title: 'VIN not extracted',
  };
}

function formatStatusCell(ev: LandingRecentEvent): { primary: string; meta: string; statusClass: string } {
  const rawStatus = ev.eventStatus && ev.eventStatus !== 'unknown' ? ev.eventStatus : null;
  const primary = rawStatus === 'reserve_not_met'
    ? 'RNM'
    : rawStatus
      ? rawStatus.replace(/_/g, ' ')
      : (ev.eventType ?? 'record');
  const statusClass = rawStatus === 'sold'
    ? 'is-sold'
    : rawStatus === 'active' || rawStatus === 'live'
      ? 'is-live'
      : rawStatus === 'reserve_not_met' || rawStatus === 'unsold'
        ? 'is-rnm'
        : '';
  const parts: string[] = [];
  if (ev.reserve === 'no_reserve') parts.push('NR');
  else if (ev.reserve === 'reserve') parts.push('R');
  if (ev.bidCount != null && ev.bidCount > 0) parts.push(`${ev.bidCount}b`);
  else if (rawStatus && ev.eventType && ev.eventType !== rawStatus) parts.push(ev.eventType);
  return { primary, meta: parts.join(' · '), statusClass };
}

export function resolveDrillTopMakes(
  detail: SourceLandingDetail | null,
  recent: ReadonlyArray<LandingRecentEvent>,
): SourceTopMakeEntry[] {
  const explicit = detail?.topMakes ?? detail?.stats?.topMakes ?? [];
  if (explicit.length > 0) return explicit.slice(0, 10);
  const counts = new Map<string, { make: string; count: number }>();
  for (const ev of recent) {
    const mk = ev.make?.trim();
    if (!mk) continue;
    const key = mk.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else counts.set(key, { make: mk, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.make.localeCompare(b.make))
    .slice(0, 10);
}

export function resolveDrillTopModels(
  detail: SourceLandingDetail | null,
  recent: ReadonlyArray<LandingRecentEvent>,
): SourceTopModelEntry[] {
  const explicit = detail?.topModels ?? detail?.stats?.topModels ?? [];
  if (explicit.length > 0) {
    return explicit.slice(0, 10).map((entry) => {
      if (entry.make) return entry;
      const matched = recent.find(
        (ev) =>
          ev.make &&
          ev.model &&
          (ev.model.toLowerCase() === entry.model.toLowerCase() ||
            ev.model.toLowerCase().startsWith(`${entry.model.toLowerCase()} `)),
      );
      return {
        ...entry,
        make: matched?.make ?? null,
      };
    });
  }
  const counts = new Map<string, { make: string | null; model: string; count: number }>();
  for (const ev of recent) {
    const md = ev.model?.trim();
    if (!md) continue;
    const mk = ev.make?.trim() || null;
    const key = `${(mk ?? '').toLowerCase()}::${md.toLowerCase()}`;
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else counts.set(key, { make: mk, model: md, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model))
    .slice(0, 10);
}

export function computeStreamFacetDistribution(
  recent: ReadonlyArray<LandingRecentEvent>,
): StreamFacetDistributionPill[] {
  const byAxis: Record<
    'series' | 'trim' | 'body',
    Map<string, { value: string; count: number }>
  > = {
    series: new Map(),
    trim: new Map(),
    body: new Map(),
  };

  for (const ev of recent) {
    const facet = classifyVehicleFacet({
      make: ev.make,
      model: ev.model,
      series: ev.series,
      trim: ev.trim,
      bodyStyle: ev.bodyStyle,
      title: ev.title,
      rawTitle: ev.rawTitle,
      year: ev.year,
    });
    const axes: Array<['series' | 'trim' | 'body', string | null]> = [
      ['series', facet.series],
      ['trim', facet.trim],
      ['body', facet.body],
    ];
    for (const [axis, rawVal] of axes) {
      const val = rawVal?.trim();
      if (!val) continue;
      const key = val.toLowerCase();
      const cur = byAxis[axis].get(key);
      if (cur) cur.count += 1;
      else byAxis[axis].set(key, { value: val, count: 1 });
    }
  }

  const toSortedPills = (
    axis: 'series' | 'trim' | 'body',
    prefix: 'SER' | 'TRM' | 'BDY',
  ): StreamFacetDistributionPill[] =>
    [...byAxis[axis].values()]
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 5)
      .map((entry) => ({
        axis,
        prefix,
        value: entry.value,
        count: entry.count,
      }));

  return [
    ...toSortedPills('series', 'SER'),
    ...toSortedPills('trim', 'TRM'),
    ...toSortedPills('body', 'BDY'),
  ];
}

function isSoldDrillEvent(ev: Pick<LandingRecentEvent, 'eventStatus' | 'eventType'>): boolean {
  const status = (ev.eventStatus ?? '').trim().toLowerCase();
  if (status === 'sold') return true;
  if (status === 'active' || status === 'live' || status === 'reserve_not_met' || status === 'unsold' || status === 'withdrawn') {
    return false;
  }
  const et = (ev.eventType ?? '').trim().toLowerCase();
  return et === 'sold' || et === 'sale';
}

export function sortDrillStreamEvents(
  events: ReadonlyArray<LandingRecentEvent>,
  sortMode: DrillStreamSortMode,
): LandingRecentEvent[] {
  const copy = [...events];
  if (sortMode === 'price') {
    return copy.sort((a, b) => {
      const pa = a.price != null && a.price > 0 ? a.price : -1;
      const pb = b.price != null && b.price > 0 ? b.price : -1;
      if (pb !== pa) return pb - pa;
      const ya = a.year ?? -1;
      const yb = b.year ?? -1;
      if (yb !== ya) return yb - ya;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  if (sortMode === 'year') {
    return copy.sort((a, b) => {
      const ya = a.year ?? -1;
      const yb = b.year ?? -1;
      if (yb !== ya) return yb - ya;
      const pa = a.price != null && a.price > 0 ? a.price : -1;
      const pb = b.price != null && b.price > 0 ? b.price : -1;
      if (pb !== pa) return pb - pa;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  // 'latest' — preserve arrival / createdAt DESC order
  return copy.sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && tb !== ta) return tb - ta;
    return 0;
  });
}

export function computeDrillCohortSummary(
  filtered: ReadonlyArray<LandingRecentEvent>,
  totalStreamCount = filtered.length,
): DrillCohortSummary {
  const filteredCount = filtered.length;
  let soldCount = 0;
  const soldPrices: number[] = [];
  for (const ev of filtered) {
    if (isSoldDrillEvent(ev)) {
      soldCount += 1;
      if (ev.price != null && Number.isFinite(ev.price) && ev.price > 0) {
        soldPrices.push(ev.price);
      }
    }
  }
  const sellThroughPct =
    filteredCount > 0 ? Math.round((soldCount / filteredCount) * 100) : null;
  let medianSoldPrice: number | null = null;
  if (soldPrices.length > 0) {
    const sorted = [...soldPrices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianSoldPrice =
      sorted.length % 2 === 1
        ? Math.round(sorted[mid])
        : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return {
    totalStreamCount,
    filteredCount,
    soldCount,
    sellThroughPct,
    medianSoldPrice,
  };
}

function SourceLandingInspector({
  row,
  boardLanding,
  boardDay,
  sourceNames,
  onClose,
  asBlock = false,
}: {
  row: SourceRow | null;
  boardLanding: BoardLandingMeta;
  boardDay: string | null;
  sourceNames: ReadonlyMap<string, string>;
  onClose: () => void;
  asBlock?: boolean;
}) {
  const [selectedHour, setSelectedHour] = useState<string | null>(null);
  const [selectedDrillMake, setSelectedDrillMake] = useState<string | null>(null);
  const [selectedDrillModel, setSelectedDrillModel] = useState<string | null>(null);
  const [selectedDrillFacet, setSelectedDrillFacet] = useState<{
    axis: 'series' | 'trim' | 'body';
    value: string;
  } | null>(null);
  const [sortMode, setSortMode] = useState<DrillStreamSortMode>('latest');
  const [detail, setDetail] = useState<SourceLandingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const sourceKey = row?.source ?? null;
  const displayName = row ? shortName(row.name) : 'All sources';

  useEffect(() => {
    setSelectedDrillMake(null);
    setSelectedDrillModel(null);
    setSelectedDrillFacet(null);
    setSortMode('latest');
  }, [sourceKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params: { p_source?: string; p_hour?: string } = {};
    if (sourceKey) params.p_source = sourceKey;
    if (selectedHour) params.p_hour = selectedHour;

    Promise.resolve()
      .then(() => supabase.rpc('market_source_landing_read', params))
      .then(({ data: raw, error }) => {
        if (!active) return;
        if (!error) {
          const parsed = parseSourceLanding(raw);
          if (parsed) setDetail(parsed);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [sourceKey, selectedHour, refreshTick]);

  // Auto-refresh live ingestion telemetry every 10s when inspecting live stream
  useEffect(() => {
    if ((globalThis as any).IS_REACT_ACT_ENVIRONMENT || selectedHour) return;
    const id = window.setInterval(() => setRefreshTick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, [selectedHour]);

  const fallbackHours = row ? row.hours24 : boardLanding.hours24;
  const fallbackMins = row ? row.mins60 : boardLanding.mins60;
  const fallbackDays = row ? row.days14 : [];
  const hours24 = detail?.hours24?.length === 24 ? detail.hours24 : fallbackHours;
  const mins60 = detail?.mins60?.length === 12 ? detail.mins60 : fallbackMins;
  const days14 = detail?.days14?.length === 14 ? detail.days14 : fallbackDays;
  const endHourIso = detail?.hour ?? boardLanding.hour ?? null;
  const landed15m = detail?.landed15m ?? (row ? row.landed15m : boardLanding.landed15m);
  const landed1h = detail?.landed1h ?? (row ? row.landed1h : boardLanding.landed1h);
  const landed24 = detail?.landed24 ?? (row ? row.landed24 : boardLanding.landed24);
  const landed7 = detail?.landed7 ?? (row ? row.landed7 : boardLanding.landed7);
  const lastLanded = detail?.lastLanded ?? (row ? row.lastLanded : null);
  const recent = detail?.recent ?? [];

  const maxHour = Math.max(1, ...hours24);
  const maxMin = Math.max(1, ...mins60);
  const maxDay = Math.max(1, ...days14);
  const show14dFallback = landed24 === 0 && days14.some((d) => d > 0);
  const Tag = asBlock ? 'div' : 'li';

  const resolveSourceName = (rawSource: string) =>
    sourceNames.get(rawSource) ?? sourceNames.get(normKey(rawSource)) ?? rawSource;

  const totalRecent = recent.length;
  const refNow = detail?.asOf && !Number.isNaN(Date.parse(detail.asOf)) ? Date.parse(detail.asOf) : Date.now();
  const ymmStructured = recent.filter((e) => e.year != null && !!e.make && !!e.model).length;
  const datedCount = recent.filter((e) => !!e.recordDate).length;
  const vinCount = recent.filter((e) => !!e.vin).length;
  const pricedCount = recent.filter((e) => e.price != null && e.price > 0).length;
  const dateSummaries = recent.map((e) => describeRecordDate(e.recordDate, refNow));
  const currentCount = dateSummaries.filter((d) => d.kind === 'live' || d.kind === 'fresh').length;
  const backfillCount = dateSummaries.filter((d) => d.kind === 'backfill').length;
  const rowCategory = row ? resolveSourceCategory(row) : null;
  const rowBadge = row ? categoryBadgeLabel(row) : null;
  const dealerBreakdown = row && rowCategory === 'dealer' ? describeDealerConsignment(row, recent) : null;
  const dealerProfileHref = row ? resolveDealerProfileHref(row) : null;
  const topMakes = resolveDrillTopMakes(detail, recent);
  const topModels = resolveDrillTopModels(detail, recent);
  const facetDistribution = computeStreamFacetDistribution(recent);
  const hasActiveDrillFilter = Boolean(selectedDrillMake || selectedDrillModel || selectedDrillFacet);

  const filteredRecent = recent.filter((ev) => {
    if (selectedDrillMake) {
      const evMake = (ev.make ?? '').trim().toLowerCase();
      if (evMake !== selectedDrillMake.trim().toLowerCase()) return false;
    }
    if (selectedDrillModel) {
      const targetModel = selectedDrillModel.trim().toLowerCase();
      const evModel = (ev.model ?? '').trim().toLowerCase();
      const evTitle = (ev.title ?? ev.rawTitle ?? '').trim().toLowerCase();
      if (
        evModel !== targetModel &&
        !evModel.startsWith(`${targetModel} `) &&
        !evTitle.includes(targetModel)
      ) {
        return false;
      }
    }
    if (selectedDrillFacet) {
      const f = classifyVehicleFacet({
        make: ev.make,
        model: ev.model,
        series: ev.series,
        trim: ev.trim,
        bodyStyle: ev.bodyStyle,
        title: ev.title,
        rawTitle: ev.rawTitle,
        year: ev.year,
      });
      const picked = f[selectedDrillFacet.axis];
      if (!picked || picked.toLowerCase() !== selectedDrillFacet.value.toLowerCase()) {
        return false;
      }
    }
    return true;
  });

  const sortedRecent = sortDrillStreamEvents(filteredRecent, sortMode);
  const cohortSummary = computeDrillCohortSummary(filteredRecent, totalRecent);
  const activeFilterParts: string[] = [];
  if (selectedDrillMake) activeFilterParts.push(selectedDrillMake);
  if (selectedDrillModel) activeFilterParts.push(selectedDrillModel);
  if (selectedDrillFacet) {
    const pfx =
      selectedDrillFacet.axis === 'series'
        ? 'SER'
        : selectedDrillFacet.axis === 'trim'
          ? 'TRM'
          : 'BDY';
    activeFilterParts.push(`${pfx} ${selectedDrillFacet.value}`);
  }
  const activeFilterLabel =
    activeFilterParts.length > 0 ? activeFilterParts.join(' · ') : 'All in stream';

  const statsHeld = detail?.stats?.held ?? row?.held ?? null;
  const statsPop = detail?.stats?.population ?? row?.population ?? null;
  const statsMethod = detail?.stats?.populationMethod ?? row?.populationMethod ?? null;
  const statsConf = detail?.stats?.populationConfidence ?? row?.populationConfidence ?? null;
  const statsMapSales = detail?.stats?.mapSales ?? row?.mapSales ?? null;
  const statsMapUsd = detail?.stats?.mapUsd ?? row?.mapUsd ?? null;
  const statsSales12 = detail?.stats?.sales12 ?? row?.sales12 ?? null;
  const statsUsd12 = detail?.stats?.usd12 ?? row?.usd12 ?? null;
  const statsShare = row
    ? heldShare({
        held: statsHeld,
        population: statsPop,
        populationMethod: statsMethod,
      })
    : null;
  const statsMethodNote = statsMethod
    ? `${METHOD[statsMethod] ?? statsMethod}${statsConf != null ? ` (${Math.round(statsConf * 100)}% conf)` : ''}`
    : undefined;

  return (
    <Tag className="market-sources__drill" aria-label={`Live ingestion for ${displayName}`}>
      <div className="market-sources__drill-head">
        <div className="market-sources__drill-title">
          <i className={landed1h > 0 ? 'on live' : landed24 > 0 ? 'on' : 'off'} aria-hidden="true" />
          <strong>{displayName}</strong>
          {rowBadge && rowCategory ? (
            <span className={`market-sources__badge market-sources__badge--${rowCategory}`}>
              {rowBadge}
            </span>
          ) : null}
          <span>{row ? 'vehicles, stats & live ingestion' : 'live & hourly ingestion'}</span>
          {selectedHour ? (
            <button
              type="button"
              className="market-sources__drill-filter"
              onClick={() => setSelectedHour(null)}
            >
              Hour {formatHourLabel(selectedHour)} UTC ×
            </button>
          ) : (
            <span className="market-sources__drill-live-tag">
              {loading ? 'syncing…' : landed1h > 0 ? 'live stream' : landed24 > 0 ? 'active today' : 'historical log'}
            </span>
          )}
        </div>
        <div className="market-sources__drill-actions">
          {dealerProfileHref ? (
            <a
              href={dealerProfileHref}
              className="market-sources__drill-btn market-sources__org-link"
              title={`Open ${displayName} organization profile`}
            >
              Organization Profile →
            </a>
          ) : null}
          {row ? (
            <a
              href={`/browse?source=${encodeURIComponent(row.source)}`}
              className="market-sources__drill-btn"
            >
              Browse vehicles →
            </a>
          ) : null}
          <button
            type="button"
            className="market-sources__drill-btn"
            onClick={() => setRefreshTick((t) => t + 1)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="market-sources__drill-btn"
            onClick={onClose}
            aria-label={`Close ${displayName} ingestion inspector`}
          >
            Close ×
          </button>
        </div>
      </div>

      {dealerBreakdown ? (
        <div className="market-sources__dealer-context" aria-label={`Consignment breakdown for ${displayName}`}>
          <div className="market-sources__dealer-context-main">
            <span className="market-sources__dealer-context-label">INVENTORY &amp; CONSIGNMENT BREAKDOWN</span>
            {dealerBreakdown.hqBadge ? (
              <span className="market-sources__dealer-hq" title={`Dealer headquarters: ${dealerBreakdown.hqBadge}`}>
                {dealerBreakdown.hqBadge}
              </span>
            ) : null}
            <strong className="market-sources__dealer-context-mode">{dealerBreakdown.modeLabel}</strong>
            <span className="market-sources__dealer-context-summary">{dealerBreakdown.summaryText}</span>
          </div>
          {dealerBreakdown.totalRecent > 0 ? (
            <div className="market-sources__dealer-context-split">
              <svg className="market-sources__dealer-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                {dealerBreakdown.consignedPct != null && dealerBreakdown.consignedPct > 0 ? (
                  <rect className="market-sources__dealer-bar-consigned" x="0" y="0" height="6" width={dealerBreakdown.consignedPct} />
                ) : null}
                {dealerBreakdown.directPct != null && dealerBreakdown.directPct > 0 ? (
                  <rect
                    className="market-sources__dealer-bar-direct"
                    x={dealerBreakdown.consignedPct ?? 0}
                    y="0"
                    height="6"
                    width={dealerBreakdown.directPct}
                  />
                ) : null}
              </svg>
              <span className="market-sources__dealer-split-text">
                {dealerBreakdown.consignedCount} consigned ({dealerBreakdown.consignedPct}%) · {dealerBreakdown.directCount} direct ({dealerBreakdown.directPct}%)
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {row ? (
        <div className="market-sources__drill-stats" aria-label={`Source stats for ${displayName}`}>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">{row.category === 'marketplace' ? 'Listings held' : 'Lots held'}</span>
            <strong>{statsHeld != null ? count(statsHeld) : '—'}</strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">Census &amp; coverage</span>
            <strong title={statsMethodNote}>
              {statsShare?.text || '—'}
            </strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">Confirmed map sales</span>
            <strong>
              {statsMapSales != null && statsMapSales > 0
                ? `${count(statsMapSales)}${statsMapUsd ? ` · ${money(statsMapUsd)}` : ''}`
                : '—'}
            </strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">Sales (last 12m)</span>
            <strong>
              {statsSales12 != null && statsSales12 > 0
                ? `${count(statsSales12)}${statsUsd12 ? ` · ${money(statsUsd12)}` : ''}`
                : '—'}
            </strong>
          </div>
          <div className="market-sources__kpi">
            <span className="market-sources__kpi-label">Live now</span>
            <strong className={row.live > 0 ? 'up' : ''}>{row.live > 0 ? `${count(row.live)} live` : '0 live'}</strong>
          </div>
        </div>
      ) : null}

      <div className="market-sources__drill-kpis">
        <div className="market-sources__kpi">
          <span className="market-sources__kpi-label">Last 15 min</span>
          <strong className={landed15m > 0 ? 'up' : ''}>+{count(landed15m)}</strong>
        </div>
        <div className="market-sources__kpi">
          <span className="market-sources__kpi-label">Last 60 min</span>
          <strong className={landed1h > 0 ? 'up' : ''}>+{count(landed1h)}</strong>
        </div>
        <div className="market-sources__kpi">
          <span className="market-sources__kpi-label">Last 24 hours</span>
          <strong>+{count(landed24)}</strong>
        </div>
        <div className="market-sources__kpi">
          <span className="market-sources__kpi-label">Last 7 days</span>
          <strong>+{count(landed7)}</strong>
        </div>
        <div className="market-sources__kpi market-sources__kpi--wide">
          <span className="market-sources__kpi-label">Last record landed</span>
          <strong>{lastLanded ? `${formatAgo(lastLanded)} · ${formatExactTime(lastLanded)}` : 'idle 14+ days'}</strong>
        </div>
      </div>

      <div className="market-sources__drill-charts">
        <div className="market-sources__chart-box">
          <div className="market-sources__chart-head">
            <span>Hourly ingestion · last 24 hours (UTC)</span>
            <small>{selectedHour ? `Inspecting ${formatHourLabel(selectedHour)} UTC — click bar again for live` : 'Click any hour bar to inspect records from that hour'}</small>
          </div>
          <div className="market-sources__hour-grid" role="group" aria-label="24 hourly ingestion bars">
            {hours24.map((n, idx) => {
              const slotIso = hourSlotIso(endHourIso, idx, 24);
              const hourLabel = formatHourLabel(slotIso) || `${23 - idx}h`;
              const isSelected = !!selectedHour && slotIso === selectedHour;
              const isNow = idx === hours24.length - 1;
              const pct = n > 0 ? Math.max(8, Math.round((Math.sqrt(n) / Math.sqrt(maxHour)) * 100)) : 0;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`market-sources__hour-col${isSelected ? ' is-selected' : ''}${isNow ? ' is-now' : ''}`}
                  onClick={() => slotIso && setSelectedHour((cur) => (cur === slotIso ? null : slotIso))}
                  title={`${hourLabel} UTC: +${count(n)} landed`}
                >
                  <span className="market-sources__hour-val">{n > 0 ? compactCount(n) : ''}</span>
                  <svg className="market-sources__hour-track" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                    {pct > 0 ? <rect className="market-sources__hour-fill" x="0" y={100 - pct} width="10" height={pct} /> : null}
                  </svg>
                  <span className="market-sources__hour-lbl">{idx % 3 === 0 || isNow ? hourLabel.slice(0, 2) : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

        {show14dFallback ? (
          <div className="market-sources__chart-box market-sources__chart-box--mins">
            <div className="market-sources__chart-head">
              <span>Daily ingestion · last 14 days</span>
              <small>+{count(days14.reduce((a, b) => a + b, 0))} in 14d</small>
            </div>
            <div className="market-sources__day-grid" role="group" aria-label="14 daily ingestion bars">
              {days14.map((n, idx) => {
                const dayIso = daySlotIso(boardDay, idx, 14);
                const lbl = shortDay(dayIso);
                const pct = n > 0 ? Math.max(10, Math.round((Math.sqrt(n) / Math.sqrt(maxDay)) * 100)) : 0;
                return (
                  <div key={idx} className={`market-sources__min-col${idx === 13 ? ' is-now' : ''}`} title={`${lbl}: +${count(n)} landed`}>
                    <span className="market-sources__hour-val">{n > 0 ? compactCount(n) : ''}</span>
                    <svg className="market-sources__hour-track" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                      {pct > 0 ? <rect className="market-sources__hour-fill" x="0" y={100 - pct} width="10" height={pct} /> : null}
                    </svg>
                    <span className="market-sources__hour-lbl">{idx % 3 === 0 || idx === 13 ? lbl.replace(' ', '\u00a0') : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="market-sources__chart-box market-sources__chart-box--mins">
            <div className="market-sources__chart-head">
              <span>Live 60m burst · 5-min windows</span>
              <small>{landed1h > 0 ? `${(landed1h / 60).toFixed(1)}/min avg` : 'no arrivals in last 60m'}</small>
            </div>
            <div className="market-sources__min-grid" role="group" aria-label="12 five-minute ingestion bars">
              {mins60.map((n, idx) => {
                const minsAgo = (11 - idx) * 5;
                const lbl = minsAgo === 0 ? 'now' : `-${minsAgo}m`;
                const pct = n > 0 ? Math.max(10, Math.round((Math.sqrt(n) / Math.sqrt(maxMin)) * 100)) : 0;
                return (
                  <div key={idx} className={`market-sources__min-col${idx === 11 ? ' is-now' : ''}`} title={`${lbl}: +${count(n)} landed`}>
                    <span className="market-sources__hour-val">{n > 0 ? compactCount(n) : ''}</span>
                    <svg className="market-sources__hour-track" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                      {pct > 0 ? <rect className="market-sources__hour-fill" x="0" y={100 - pct} width="10" height={pct} /> : null}
                    </svg>
                    <span className="market-sources__hour-lbl">{idx % 2 === 1 || idx === 0 ? lbl : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="market-sources__drill-feed">
        <div className="market-sources__chart-head market-sources__feed-head">
          <div className="market-sources__feed-title">
            <span>
              {selectedHour
                ? `Structured records landed in ${formatHourLabel(selectedHour)} UTC`
                : `Structured ingestion stream · ${displayName}`}
            </span>
            <small>
              {totalRecent
                ? hasActiveDrillFilter
                  ? `showing ${filteredRecent.length} of ${totalRecent} arriving records`
                  : `showing ${totalRecent} arriving records`
                : loading
                  ? 'loading…'
                  : 'no recent records in window'}
            </small>
            {hasActiveDrillFilter ? (
              <button
                type="button"
                className="market-sources__drill-clear"
                data-testid="drill-filter-clear"
                onClick={() => {
                  setSelectedDrillMake(null);
                  setSelectedDrillModel(null);
                  setSelectedDrillFacet(null);
                }}
              >
                CLEAR
              </button>
            ) : null}
          </div>
          {totalRecent > 0 ? (
            <div className="market-sources__schema-pills" aria-label="Ingestion structuring quality">
              <span
                className={`market-sources__schema-pill${ymmStructured === totalRecent ? ' is-good' : ymmStructured < totalRecent * 0.7 ? ' is-warn' : ''}`}
                title="Records with Year, Make, and Model structured into separate columns"
              >
                Y·M·M {ymmStructured}/{totalRecent}
              </span>
              <span
                className={`market-sources__schema-pill${datedCount === totalRecent ? ' is-good' : ' is-warn'}`}
                title="Records carrying their own event/sale/listing date"
              >
                Dated {datedCount}/{totalRecent}
              </span>
              <span
                className="market-sources__schema-pill"
                title="Live/current market events vs. historical backfill records being ingested now"
              >
                {currentCount} current · {backfillCount} backfill
              </span>
              <span
                className="market-sources__schema-pill"
                title="Records with a structured VIN or chassis number"
              >
                VIN {vinCount}/{totalRecent}
              </span>
              <span
                className="market-sources__schema-pill"
                title="Records with a bid, hammer, or asking price"
              >
                Price {pricedCount}/{totalRecent}
              </span>
            </div>
          ) : null}
        </div>
        {topMakes.length > 0 || topModels.length > 0 ? (
          <div className="market-sources__drill-taxonomy-bars" data-testid="drill-make-model-bars">
            {topMakes.length > 0 ? (
              <div
                className="market-sources__drill-top-makes"
                data-testid="drill-top-makes"
                role="group"
                aria-label="Top Makes"
              >
                <span className="market-sources__drill-bar-label">Top Makes</span>
                <div className="market-sources__drill-pill-list">
                  {topMakes.map((item) => {
                    const isMakeActive =
                      selectedDrillMake != null &&
                      selectedDrillMake.toLowerCase() === item.make.toLowerCase();
                    const makeHref = `/?make=${encodeURIComponent(item.make)}`;
                    return (
                      <span
                        key={item.make}
                        className={`market-sources__drill-pill-wrap${isMakeActive ? ' is-active' : ''}`}
                      >
                        <button
                          type="button"
                          className={`market-sources__drill-pill market-sources__top-make-pill${isMakeActive ? ' is-active' : ''}`}
                          data-testid={`drill-make-pill-${item.make}`}
                          data-make={item.make}
                          aria-pressed={isMakeActive}
                          onClick={() =>
                            setSelectedDrillMake((cur) =>
                              cur && cur.toLowerCase() === item.make.toLowerCase() ? null : item.make,
                            )
                          }
                        >
                          {item.make} <span className="market-sources__drill-pill-count">({count(item.count)})</span>
                        </button>
                        <a
                          href={makeHref}
                          className="market-sources__pill-jump"
                          data-testid={`drill-make-jump-${item.make}`}
                          title={`Open ${item.make} on Market Treemap`}
                          aria-label={`Open ${item.make} on Market Treemap`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗
                        </a>
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {topModels.length > 0 ? (
              <div
                className="market-sources__drill-top-models"
                data-testid="drill-top-models"
                role="group"
                aria-label="Top Models"
              >
                <span className="market-sources__drill-bar-label">Top Models</span>
                <div className="market-sources__drill-pill-list">
                  {topModels.map((item) => {
                    const isModelActive =
                      selectedDrillModel != null &&
                      selectedDrillModel.toLowerCase() === item.model.toLowerCase();
                    const effectiveMake = item.make ?? selectedDrillMake;
                    const modelHref = effectiveMake
                      ? `/?make=${encodeURIComponent(effectiveMake)}&model=${encodeURIComponent(item.model)}`
                      : `/?model=${encodeURIComponent(item.model)}`;
                    return (
                      <span
                        key={`${item.make ?? ''}:${item.model}`}
                        className={`market-sources__drill-pill-wrap${isModelActive ? ' is-active' : ''}`}
                      >
                        <button
                          type="button"
                          className={`market-sources__drill-pill market-sources__top-model-pill${isModelActive ? ' is-active' : ''}`}
                          data-testid={`drill-model-pill-${item.model}`}
                          data-model={item.model}
                          data-make={effectiveMake ?? undefined}
                          aria-pressed={isModelActive}
                          onClick={() =>
                            setSelectedDrillModel((cur) =>
                              cur && cur.toLowerCase() === item.model.toLowerCase() ? null : item.model,
                            )
                          }
                        >
                          {item.model} <span className="market-sources__drill-pill-count">({count(item.count)})</span>
                        </button>
                        <a
                          href={modelHref}
                          className="market-sources__pill-jump"
                          data-testid={`drill-model-jump-${item.model}`}
                          title={`Open ${effectiveMake ? `${effectiveMake} ` : ''}${item.model} on Market Treemap`}
                          aria-label={`Open ${effectiveMake ? `${effectiveMake} ` : ''}${item.model} on Market Treemap`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗
                        </a>
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {facetDistribution.length > 0 ? (
          <div
            className="market-sources__facet-breakdown"
            data-testid="drill-facet-breakdown"
            role="group"
            aria-label="Facet breakdown"
          >
            <span className="market-sources__drill-bar-label">FACET BREAKDOWN</span>
            <div className="market-sources__facet-breakdown-pills">
              {facetDistribution.map((fp) => {
                const isFacetActive =
                  selectedDrillFacet != null &&
                  selectedDrillFacet.axis === fp.axis &&
                  selectedDrillFacet.value.toLowerCase() === fp.value.toLowerCase();
                return (
                  <button
                    key={`${fp.axis}:${fp.value}`}
                    type="button"
                    className={`market-sources__facet-breakdown-pill market-sources__facet-breakdown-pill--${fp.axis}${isFacetActive ? ' is-active' : ''}`}
                    data-testid={`drill-facet-pill-${fp.prefix}-${fp.value}`}
                    data-axis={fp.axis}
                    data-prefix={fp.prefix}
                    data-facet={fp.value}
                    aria-pressed={isFacetActive}
                    onClick={() =>
                      setSelectedDrillFacet((cur) =>
                        cur &&
                        cur.axis === fp.axis &&
                        cur.value.toLowerCase() === fp.value.toLowerCase()
                          ? null
                          : { axis: fp.axis, value: fp.value },
                      )
                    }
                  >
                    <em className="market-sources__facet-prefix">{fp.prefix}</em> {fp.value} ({count(fp.count)})
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {totalRecent > 0 ? (
          <div className="market-sources__cohort-bar" data-testid="drill-cohort-summary-bar" aria-label="Cohort summary KPI bar">
            <div className="market-sources__cohort-kpis" data-testid="drill-cohort-kpis">
              <div className="market-sources__cohort-kpi" data-testid="drill-cohort-filtered-count">
                <span className="market-sources__kpi-label">Filtered Count</span>
                <strong>
                  {hasActiveDrillFilter
                    ? `${count(cohortSummary.filteredCount)} of ${count(cohortSummary.totalStreamCount)}`
                    : count(cohortSummary.filteredCount)}
                </strong>
                <small className="market-sources__cohort-scope">{activeFilterLabel}</small>
              </div>
              <div className="market-sources__cohort-kpi" data-testid="drill-cohort-sold-sellthrough">
                <span className="market-sources__kpi-label">Sold Count &amp; Sell-Through %</span>
                <strong>
                  {cohortSummary.filteredCount > 0 && cohortSummary.sellThroughPct != null
                    ? `${count(cohortSummary.soldCount)} sold · ${cohortSummary.sellThroughPct}%`
                    : '0 sold · —'}
                </strong>
              </div>
              <div className="market-sources__cohort-kpi" data-testid="drill-cohort-median-sold-price">
                <span className="market-sources__kpi-label">Median Sold Price</span>
                <strong>
                  {cohortSummary.medianSoldPrice != null && cohortSummary.medianSoldPrice > 0
                    ? `$${count(cohortSummary.medianSoldPrice)}`
                    : '—'}
                </strong>
              </div>
            </div>
            <div
              className="market-sources__sort-pills"
              data-testid="drill-sort-selector"
              role="group"
              aria-label="Sort recent vehicles stream"
            >
              <span className="market-sources__drill-bar-label">SORT</span>
              {(
                [
                  ['latest', 'LATEST'],
                  ['price', 'HIGHEST PRICE'],
                  ['year', 'YEAR'],
                ] as const
              ).map(([mode, label]) => {
                const isSortActive = sortMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`market-sources__sort-pill${isSortActive ? ' is-active' : ''}`}
                    data-testid={`drill-sort-${mode}`}
                    data-sort={mode}
                    aria-pressed={isSortActive}
                    onClick={() => setSortMode(mode)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {totalRecent > 0 ? (
          <div className="market-sources__events-wrap">
            <div className="market-sources__events-cols" aria-hidden="true">
              <span>Landed</span>
              <span>Record date · age</span>
              <span className="n">Year</span>
              <span>Make</span>
              <span>Model &amp; trim</span>
              <span>VIN / Lot</span>
              <span className="n">Miles</span>
              <span>Status</span>
              <span className="n">Price</span>
              <span className="n">Source</span>
            </div>
            <ul className="market-sources__events">
              {sortedRecent.map((ev) => {
                const recDate = describeRecordDate(ev.recordDate, refNow);
                const vinLot = formatVinOrLot(ev);
                const st = formatStatusCell(ev);
                const srcDisplay = resolveSourceName(ev.source);
                const modelPrimary = ev.model || ev.rawTitle || ev.title || ev.lot || ev.id;
                const showTrim = !!ev.trim && (!ev.model || !ev.model.toLowerCase().includes(ev.trim.toLowerCase()));
                const showRawHint = !!ev.rawTitle && (!ev.make || !ev.year) && ev.rawTitle !== modelPrimary;
                const href = ev.vehicleId ? `/vehicle/${ev.vehicleId}` : ev.sourceUrl;
                const facetInfo = classifyVehicleFacet({
                  make: ev.make,
                  model: ev.model,
                  series: ev.series,
                  trim: ev.trim,
                  bodyStyle: ev.bodyStyle,
                  title: ev.title,
                  rawTitle: ev.rawTitle,
                  year: ev.year,
                });
                const identityMark = resolveVehicleIdentityMark({
                  make: ev.make,
                  family: facetInfo.family,
                  model: ev.model,
                  trim: ev.trim,
                  title: ev.title,
                  rawTitle: ev.rawTitle,
                  year: ev.year,
                });
                const facetEntries = ([
                  ['series', 'SERIES', facetInfo.series],
                  ['trim', 'TRIM', facetInfo.trim],
                  ['body', 'BODY', facetInfo.body],
                ] as const).filter((entry): entry is ['series' | 'trim' | 'body', string, string] => !!entry[2]);

                return (
                  <li key={ev.id} className="market-sources__event">
                    <span className="market-sources__event-time" title={`Ingested into Nuke at ${formatExactTime(ev.createdAt)}`}>
                      {formatAgo(ev.createdAt)}
                    </span>
                    <span className="market-sources__event-recdate" title={recDate.fullTitle}>
                      <span className={`market-sources__recdate-val${recDate.kind === 'missing' ? ' is-missing' : ''}`}>
                        {recDate.dateText}
                      </span>
                      {recDate.ageText ? (
                        <em className={`market-sources__age-tag is-${recDate.kind}`}>
                          {recDate.ageText}
                        </em>
                      ) : null}
                    </span>
                    <span
                      className={`market-sources__event-year n${ev.year == null ? ' is-missing' : ''}`}
                      title={ev.year != null ? `Model year: ${ev.year}` : 'Model year not extracted'}
                    >
                      {ev.year ?? '—'}
                    </span>
                    <span
                      className={`market-sources__event-make${!ev.make ? ' is-missing' : ''}`}
                      title={ev.make ? `Make: ${ev.make}` : `Make missing${ev.rawTitle ? ` (raw: ${ev.rawTitle})` : ''}`}
                    >
                      {ev.make ?? 'missing'}
                    </span>
                    <span
                      className={`market-sources__event-model${!ev.model ? ' is-unparsed' : ''}`}
                      title={ev.rawTitle ? `Model: ${ev.model ?? 'unparsed'} · Raw title: ${ev.rawTitle}` : modelPrimary}
                    >
                      {identityMark ? (
                        <span
                          className="market-sources__event-mark"
                          title={`${identityMark.displayLabel} (${identityMark.yearStart}–${identityMark.yearEnd})`}
                          aria-label={identityMark.displayLabel}
                          dangerouslySetInnerHTML={{ __html: identityMark.svgMarkup }}
                        />
                      ) : null}
                      {href ? (
                        <a
                          href={href}
                          {...(!ev.vehicleId && ev.sourceUrl ? { target: '_blank', rel: 'noreferrer' } : {})}
                        >
                          {modelPrimary}
                        </a>
                      ) : (
                        modelPrimary
                      )}
                      {showTrim ? <small className="market-sources__event-trim"> · {ev.trim}</small> : null}
                      {showRawHint ? <small className="market-sources__event-raw"> ({ev.rawTitle})</small> : null}
                      {facetEntries.length > 0 ? (
                        <span className="market-sources__event-facets" aria-label="Vehicle taxonomy facets">
                          {facetEntries.map(([axis, axisLabel, facetVal]) => {
                            const facetHref =
                              ev.make && facetInfo.family
                                ? buildFacetDrilldownUrl({
                                    make: ev.make,
                                    family: facetInfo.family,
                                    axis,
                                    facet: facetVal,
                                  })
                                : null;
                            return facetHref ? (
                              <a
                                key={axis}
                                href={facetHref}
                                className={`market-sources__facet-pill market-sources__facet-pill--${axis}`}
                                data-axis={axis}
                                title={`${axisLabel}: ${facetVal} (${ev.make} ${facetInfo.family})`}
                              >
                                <em className="market-sources__facet-axis">{axisLabel}</em> {facetVal}
                              </a>
                            ) : (
                              <span
                                key={axis}
                                className={`market-sources__facet-pill market-sources__facet-pill--${axis}`}
                                data-axis={axis}
                                title={`${axisLabel}: ${facetVal}`}
                              >
                                <em className="market-sources__facet-axis">{axisLabel}</em> {facetVal}
                              </span>
                            );
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`market-sources__event-vin${vinLot.isVin ? ' is-vin' : vinLot.isMissing ? ' is-missing' : ' is-lot'}`}
                      title={vinLot.title}
                    >
                      {vinLot.text}
                    </span>
                    <span
                      className={`market-sources__event-miles n${ev.mileage == null ? ' is-missing' : ''}`}
                      title={ev.mileage != null ? `${count(ev.mileage)} miles` : 'Mileage not extracted'}
                    >
                      {ev.mileage != null && ev.mileage > 0 ? `${compactCount(ev.mileage)} mi` : '—'}
                    </span>
                    <span className={`market-sources__event-status ${st.statusClass}`} title={`${st.primary}${st.meta ? ` · ${st.meta}` : ''}`}>
                      <strong>{st.primary}</strong>
                      {st.meta ? <small> · {st.meta}</small> : null}
                    </span>
                    <span className="market-sources__event-price n">
                      {ev.price && ev.price > 0 ? `$${count(ev.price)}` : '—'}
                    </span>
                    <span className="market-sources__event-link">
                      {ev.sourceUrl ? (
                        <a href={ev.sourceUrl} target="_blank" rel="noreferrer" title={ev.sourceUrl}>
                          {srcDisplay} ↗
                        </a>
                      ) : (
                        srcDisplay
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Tag>
  );
}

export { SourceLandingInspector as IngestionDrillPanel };

function resolveInitialSource(rows: SourceRow[], explicit?: string | null): string | null {
  let candidate = explicit ?? null;
  if (!candidate && typeof window !== 'undefined') {
    const pathMatch = window.location.pathname.match(/^\/sources\/([^/?#]+)/);
    candidate = pathMatch?.[1]
      ? decodeURIComponent(pathMatch[1])
      : new URLSearchParams(window.location.search).get('source');
  }
  if (!candidate) return null;
  const nk = normKey(candidate);
  const found = rows.find((r) => r.source === candidate || normKey(r.source) === nk || normKey(r.name) === nk);
  return found ? found.source : null;
}

export function SourcesBoardView({
  data,
  scope,
  initialSource,
}: {
  data: SourcesBoardData;
  scope?: string | null;
  initialSource?: string | null;
}) {
  const [all, setAll] = useState(() => !!resolveInitialSource(data.rows, initialSource));
  const [horizon, setHorizon] = useState<LandingHorizon>('14d');
  const [openSource, setOpenSource] = useState<string | null>(() => resolveInitialSource(data.rows, initialSource));
  const [categoryFilter, setCategoryFilter] = useState<'all' | SourceCategory>('all');

  const heldAt = data.rows.map((r) => r.heldAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const allGroups = GROUPS.map(([key, title, unit]) => ({
    key,
    title,
    unit,
    rows: data.rows.filter((r) => resolveSourceCategory(r) === key),
  })).filter((g) => g.rows.length);
  const groups = categoryFilter === 'all' ? allGroups : allGroups.filter((g) => g.key === categoryFilter);
  const shownPer = all || categoryFilter !== 'all' ? Infinity : SHOWN;
  const hidden = categoryFilter === 'all' ? allGroups.reduce((n, g) => n + Math.max(0, g.rows.length - SHOWN), 0) : 0;
  const notRanked = Object.entries(data.notRanked).sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${n} ${NOT_RANKED_WORDS[k] ?? k}${n > 1 ? 's' : ''}`);
  const scopedLabel = scope?.trim() ? 'Sources · all makes' : 'Sources';
  const sourceNames = new Map<string, string>();
  for (const r of data.rows) {
    const clean = shortName(r.name);
    sourceNames.set(r.source, clean);
    sourceNames.set(normKey(r.source), clean);
  }
  sourceNames.set('classiccars', 'ClassicCars.com');
  sourceNames.set('bringatrailer', 'Bring a Trailer');

  const binsForHorizon = (r: SourceRow): number[] => {
    if (horizon === '24h') return r.hours24;
    if (horizon === '1h') return r.mins60;
    return r.days14;
  };

  return (
    <section className="market-sources" aria-label="Sources, ranked by what we hold">
      <svg width="0" height="0" aria-hidden="true" className="market-sources__defs">
        <defs>
          <pattern id="market-sources-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" className="market-sources__hatch" />
          </pattern>
        </defs>
      </svg>
      <div className="market-sources__head">
        <span className="market-sources__title">{scopedLabel}</span>
        <span className="market-sources__note">
          ranked by what we hold · a source moves up as more of it lands{heldAt ? ` · held counts as of ${heldWhen(heldAt)}` : ''}
        </span>
        <div className="market-sources__cat-filters" role="group" aria-label="Filter sources by category">
          <button
            type="button"
            className={`market-sources__cat-pill${categoryFilter === 'all' ? ' is-active' : ''}`}
            aria-pressed={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
          >
            ALL
          </button>
          {allGroups.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`market-sources__cat-pill market-sources__cat-pill--${g.key}${categoryFilter === g.key ? ' is-active' : ''}`}
              aria-pressed={categoryFilter === g.key}
              onClick={() => setCategoryFilter((cur) => (cur === g.key ? 'all' : g.key))}
            >
              {CATEGORY_BADGE_LABELS[g.key]}
            </button>
          ))}
        </div>
        {data.landing.landed1h > 0 ? (
          <button
            type="button"
            className={`market-sources__live-summary${openSource === '__ALL__' ? ' is-open' : ''}`}
            onClick={() => setOpenSource((cur) => (cur === '__ALL__' ? null : '__ALL__'))}
            aria-expanded={openSource === '__ALL__'}
            title={`+${count(data.landing.landed24)} records landed across all sources in the last 24h · click for live ingestion inspector`}
          >
            <i className="on live" aria-hidden="true" />
            +{count(data.landing.landed15m)} in 15m · +{count(data.landing.landed1h)} in 1h
          </button>
        ) : null}
      </div>
      {openSource === '__ALL__' ? (
        <SourceLandingInspector
          row={null}
          boardLanding={data.landing}
          boardDay={data.day}
          sourceNames={sourceNames}
          onClose={() => setOpenSource(null)}
          asBlock
        />
      ) : null}
      {groups.map((g) => (
        <div key={g.key} className="market-sources__group">
          <div className="market-sources__cols">
            <span>#</span><span className="market-sources__group-title">{g.title}</span><span className="n">{g.unit}</span>
            <span>of their total</span>
            <span className="market-sources__col-landing">
              <button
                type="button"
                className="market-sources__col-toggle"
                onClick={() => setHorizon((h) => NEXT_HORIZON[h])}
                title="Click to switch landing view between 14 days, 24 hours (hourly), and 60 minutes (live)"
              >
                {HORIZON_LABELS[horizon]}
              </button>
              <span className="market-sources__horizon-pills" role="group" aria-label="Landing resolution">
                {(['14d', '24h', '1h'] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    className={`market-sources__pill${horizon === h ? ' is-active' : ''}`}
                    onClick={() => setHorizon(h)}
                    aria-pressed={horizon === h}
                  >
                    {h}
                  </button>
                ))}
              </span>
            </span>
            <span>sales, last 12 months</span><span className="n">live now</span>
          </div>
          <ol className="market-sources__rows">
            {g.rows.slice(0, shownPer).map((r, i) => {
              const s = heldShare(r);
              const week = r.held != null && r.heldBefore != null ? r.held - r.heldBefore : null;
              const land = landingState(r, horizon);
              const isOpen = openSource === r.source;
              const cat = resolveSourceCategory(r);
              const badge = categoryBadgeLabel(r);
              const dealerProfileHref = resolveDealerProfileHref(r);
              const total = r.population != null
                ? `${count(r.population)} ${METHOD[r.populationMethod ?? ''] ?? `(${r.populationMethod ?? 'method unrecorded'})`}`
                  + `${r.populationAt ? `, ${shortDay(r.populationAt)}` : ''}`
                  + `${r.populationConfidence != null ? `, confidence ${r.populationConfidence.toFixed(2)}` : ''}`
                : 'their total is not counted yet';
              return (
                <Fragment key={r.source}>
                  <li
                    className={`market-sources__row${isOpen ? ' market-sources__row--open' : ''}`}
                    data-category={cat ?? undefined}
                    onClick={() => setOpenSource((cur) => (cur === r.source ? null : r.source))}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setOpenSource((cur) => (cur === r.source ? null : r.source));
                      }
                    }}
                    tabIndex={0}
                    aria-expanded={isOpen}
                  >
                    <span className="market-sources__rank">{i + 1}</span>
                    <span className="market-sources__name" title={r.name}>
                      {/* Identity through the shared renderer (frontend rule 2026-10-08): the organization's recorded logo,
                          else its type icon. */}
                      <OrgLogo logoUrl={r.logoUrl} businessType={r.businessType ?? (cat === 'auction' ? 'auction_house' : cat === 'dealer' ? 'dealer' : null)}
                        businessName={r.name} size={13} maxWidth={42} variant="logo" className="market-sources__icon" />
                      <span className="market-sources__name-text">{shortName(r.name)}</span>
                      {badge && cat ? (
                        <span className={`market-sources__badge market-sources__badge--${cat}`}>
                          {badge}
                        </span>
                      ) : null}
                      {dealerProfileHref ? (
                        <a
                          href={dealerProfileHref}
                          className="market-sources__org-link"
                          onClick={(e) => e.stopPropagation()}
                          title={`Open ${shortName(r.name)} organization profile`}
                        >
                          Organization Profile →
                        </a>
                      ) : null}
                    </span>
                    <span className="market-sources__held n" title={r.heldAt ? `held as of ${heldWhen(r.heldAt)}` : undefined}>
                      {r.held != null ? count(r.held) : '—'}
                      {week != null && week !== 0
                        ? <small className={week > 0 ? 'up' : 'down'}> {week > 0 ? '+' : '−'}{count(Math.abs(week))} since {shortDay(r.beforeDay)}</small>
                        : null}
                    </span>
                    <span className="market-sources__share" title={total}>
                      <svg className="market-sources__track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
                        {s.share != null
                          ? <rect className="market-sources__fill" x="0" y="0" height="8" width={Math.max(1.5, s.share * 100)} />
                          : <rect className="market-sources__unknown" x="0" y="0" height="8" width="100" fill="url(#market-sources-hatch)" />}
                      </svg>
                      <span className="market-sources__sharetext">{s.text}</span>
                    </span>
                    <button
                      type="button"
                      className={`market-sources__landing${isOpen ? ' is-open' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenSource((cur) => (cur === r.source ? null : r.source));
                      }}
                      aria-expanded={isOpen}
                      title={`${count(r.landed7)} records landed in 7d · +${count(r.landed1h)} in 1h · click for live hourly breakdown`}
                    >
                      <i className={land.active ? (r.landed15m > 0 ? 'on live' : 'on') : 'off'} aria-hidden="true" />
                      <span className={`market-sources__landtext${land.active ? '' : ' idle'}`}>{land.text}</span>
                      <DayBars days={binsForHorizon(r)} mode={horizon} />
                    </button>
                    <span className="market-sources__recent"
                      title={r.mapSales ? `on the map: ${count(r.mapSales)} confirmed sales${r.mapUsd ? `, ${money(r.mapUsd)}` : ''}` : undefined}>
                      {r.sales12 ? <><span className="n">{count(r.sales12)}</span><Spark bars={monthBars(r.months, data.day)} /></> : <span className="n">—</span>}
                    </span>
                    <span className="market-sources__live n">
                      {r.live > 0 ? <><i aria-hidden="true" />{count(r.live)} live</> : '—'}
                    </span>
                  </li>
                  {isOpen ? (
                    <SourceLandingInspector
                      row={r}
                      boardLanding={data.landing}
                      boardDay={data.day}
                      sourceNames={sourceNames}
                      onClose={() => setOpenSource(null)}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </ol>
        </div>
      ))}
      <div className="market-sources__foot">
        {hidden > 0
          ? <button type="button" className="market-sources__more" onClick={() => setAll((x) => !x)}>
            {all ? 'Show the top of each group' : `Show all ${data.rows.length} sources`}
          </button>
          : null}
        {notRanked.length ? <span className="market-sources__note">not ranked: {notRanked.join(', ')}</span> : null}
      </div>
    </section>
  );
}

/** The board as the market page mounts it: one read, refreshed every 30s in live browser sessions. */
export default function SourcesBoard({
  scope,
  initialSource,
}: {
  scope?: string | null;
  initialSource?: string | null;
} = {}) {
  const [data, setData] = useState<SourcesBoardData | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      // A failed or missing read leaves the board off the page; it never takes the market page down with it.
      Promise.resolve().then(() => supabase.rpc('market_sources_read')).then(({ data: value, error }) => {
        if (live && !error) setData(parseSources(value));
      }).catch(() => {});
    };
    load();
    if ((globalThis as any).IS_REACT_ACT_ENVIRONMENT) {
      return () => { live = false; };
    }
    const timer = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  if (!data || !data.rows.length) return null;
  return <SourcesBoardView data={data} scope={scope} initialSource={initialSource} />;
}
