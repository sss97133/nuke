import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { OrgLogo } from '../../components/common/OrgLogo';
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
  price: number | null;
  title: string | null;
  lot: string | null;
  vehicleId: string | null;
  sourceUrl: string | null;
  createdAt: string;
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

/** Decodes public.market_source_landing_read(p_source, p_hour). */
export function parseSourceLanding(value: unknown): SourceLandingDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.as_of !== 'string') return null;
  const recent: LandingRecentEvent[] = [];
  if (Array.isArray(v.recent)) {
    for (const item of v.recent) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const ev = item as Record<string, unknown>;
      const id = str(ev.id);
      const source = str(ev.source);
      const createdAt = str(ev.created_at);
      if (!id || !source || !createdAt) continue;
      recent.push({
        id,
        source,
        eventType: str(ev.event_type),
        eventStatus: str(ev.event_status),
        price: num(ev.price),
        title: str(ev.title),
        lot: str(ev.lot),
        vehicleId: str(ev.vehicle_id),
        sourceUrl: str(ev.source_url),
        createdAt,
      });
    }
  }
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
    recent,
  };
}

const count = (n: number) => Math.round(n).toLocaleString('en-US');
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
  enumerated: 'counted from their own listings', bounded: 'estimated within a range', search_index: 'from their search index',
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

const GROUPS: [string, string, string][] = [
  ['auction', 'Auction houses', 'lots held'],
  ['marketplace', 'Marketplaces', 'listings held'],
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

function SourceLandingInspector({
  row,
  boardLanding,
  sourceNames,
  onClose,
  asBlock = false,
}: {
  row: SourceRow | null;
  boardLanding: BoardLandingMeta;
  sourceNames: ReadonlyMap<string, string>;
  onClose: () => void;
  asBlock?: boolean;
}) {
  const [selectedHour, setSelectedHour] = useState<string | null>(null);
  const [detail, setDetail] = useState<SourceLandingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const sourceKey = row?.source ?? null;
  const displayName = row ? shortName(row.name) : 'All sources';

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
  const hours24 = detail?.hours24?.length === 24 ? detail.hours24 : fallbackHours;
  const mins60 = detail?.mins60?.length === 12 ? detail.mins60 : fallbackMins;
  const endHourIso = detail?.hour ?? boardLanding.hour ?? null;
  const landed15m = detail?.landed15m ?? (row ? row.landed15m : boardLanding.landed15m);
  const landed1h = detail?.landed1h ?? (row ? row.landed1h : boardLanding.landed1h);
  const landed24 = detail?.landed24 ?? (row ? row.landed24 : boardLanding.landed24);
  const landed7 = detail?.landed7 ?? (row ? row.landed7 : boardLanding.landed7);
  const lastLanded = detail?.lastLanded ?? (row ? row.lastLanded : null);
  const recent = detail?.recent ?? [];

  const maxHour = Math.max(1, ...hours24);
  const maxMin = Math.max(1, ...mins60);
  const Tag = asBlock ? 'div' : 'li';

  return (
    <Tag className="market-sources__drill" aria-label={`Live ingestion for ${displayName}`}>
      <div className="market-sources__drill-head">
        <div className="market-sources__drill-title">
          <i className={landed1h > 0 ? 'on live' : landed24 > 0 ? 'on' : 'off'} aria-hidden="true" />
          <strong>{displayName}</strong>
          <span>live &amp; hourly ingestion</span>
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
              {loading ? 'syncing…' : 'live stream'}
            </span>
          )}
        </div>
        <div className="market-sources__drill-actions">
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
                  <span className="market-sources__hour-val">{n > 0 ? count(n) : ''}</span>
                  <svg className="market-sources__hour-track" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                    {pct > 0 ? <rect className="market-sources__hour-fill" x="0" y={100 - pct} width="10" height={pct} /> : null}
                  </svg>
                  <span className="market-sources__hour-lbl">{idx % 3 === 0 || isNow ? hourLabel.slice(0, 2) : ''}</span>
                </button>
              );
            })}
          </div>
        </div>

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
                  <span className="market-sources__hour-val">{n > 0 ? count(n) : ''}</span>
                  <svg className="market-sources__hour-track" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                    {pct > 0 ? <rect className="market-sources__hour-fill" x="0" y={100 - pct} width="10" height={pct} /> : null}
                  </svg>
                  <span className="market-sources__hour-lbl">{idx % 2 === 1 || idx === 0 ? lbl : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="market-sources__drill-feed">
        <div className="market-sources__chart-head">
          <span>
            {selectedHour
              ? `Records landed in ${formatHourLabel(selectedHour)} UTC`
              : `Latest arriving records · ${displayName}`}
          </span>
          <small>{recent.length ? `showing ${recent.length} most recent` : loading ? 'loading…' : 'no recent records in window'}</small>
        </div>
        {recent.length > 0 ? (
          <ul className="market-sources__events">
            {recent.slice(0, 12).map((ev) => {
              const label = ev.title || ev.lot || ev.id;
              return (
                <li key={ev.id} className="market-sources__event">
                  <span className="market-sources__event-time" title={formatExactTime(ev.createdAt)}>
                    {formatAgo(ev.createdAt)}
                  </span>
                  <span className="market-sources__event-kind">
                    {ev.eventType ?? 'record'}{ev.eventStatus && ev.eventStatus !== 'unknown' ? ` · ${ev.eventStatus}` : ''}
                  </span>
                  <span className="market-sources__event-title">
                    {ev.vehicleId ? (
                      <a href={`/vehicle/${ev.vehicleId}`}>{label}</a>
                    ) : ev.sourceUrl ? (
                      <a href={ev.sourceUrl} target="_blank" rel="noreferrer">{label}</a>
                    ) : (
                      label
                    )}
                  </span>
                  <span className="market-sources__event-price n">
                    {ev.price && ev.price > 0 ? `$${count(ev.price)}` : '—'}
                  </span>
                  <span className="market-sources__event-link">
                    {ev.sourceUrl ? (
                      <a href={ev.sourceUrl} target="_blank" rel="noreferrer" title={ev.sourceUrl}>
                        {sourceNames.get(ev.source) ?? ev.source} ↗
                      </a>
                    ) : (
                      sourceNames.get(ev.source) ?? ev.source
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Tag>
  );
}

export function SourcesBoardView({ data, scope }: { data: SourcesBoardData; scope?: string | null }) {
  const [all, setAll] = useState(false);
  const [horizon, setHorizon] = useState<LandingHorizon>('14d');
  const [openSource, setOpenSource] = useState<string | null>(null);

  const heldAt = data.rows.map((r) => r.heldAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const groups = GROUPS.map(([key, title, unit]) => ({ key, title, unit, rows: data.rows.filter((r) => r.category === key) }))
    .filter((g) => g.rows.length);
  const shownPer = all ? Infinity : SHOWN;
  const hidden = groups.reduce((n, g) => n + Math.max(0, g.rows.length - SHOWN), 0);
  const notRanked = Object.entries(data.notRanked).sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${n} ${NOT_RANKED_WORDS[k] ?? k}${n > 1 ? 's' : ''}`);
  const scopedLabel = scope?.trim() ? 'Sources · all makes' : 'Sources';
  const sourceNames = new Map(data.rows.map((r) => [r.source, shortName(r.name)]));

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
              const total = r.population != null
                ? `${count(r.population)} ${METHOD[r.populationMethod ?? ''] ?? `(${r.populationMethod ?? 'method unrecorded'})`}`
                  + `${r.populationAt ? `, ${shortDay(r.populationAt)}` : ''}`
                  + `${r.populationConfidence != null ? `, confidence ${r.populationConfidence.toFixed(2)}` : ''}`
                : 'their total is not counted yet';
              return (
                <Fragment key={r.source}>
                  <li className={`market-sources__row${isOpen ? ' market-sources__row--open' : ''}`}>
                    <span className="market-sources__rank">{i + 1}</span>
                    <span className="market-sources__name" title={r.name}>
                      {/* Identity through the shared renderer (frontend rule 2026-10-08): the organization's recorded logo,
                          else its type icon. */}
                      <OrgLogo logoUrl={r.logoUrl} businessType={r.businessType ?? (r.category === 'auction' ? 'auction_house' : null)}
                        businessName={r.name} size={18} maxWidth={76} variant="logo" className="market-sources__icon" />
                      {shortName(r.name)}
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
                      onClick={() => setOpenSource((cur) => (cur === r.source ? null : r.source))}
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
export default function SourcesBoard({ scope }: { scope?: string | null } = {}) {
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
  return <SourcesBoardView data={data} scope={scope} />;
}
