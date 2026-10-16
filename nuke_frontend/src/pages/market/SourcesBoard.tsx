import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import './SourcesBoard.css';

// Every source on one board with the same measures, ranked by the lots we hold for it (market_sources_read,
// 20261018030000). Owner, 2026-10-15: "when are we gonna see the site treat all sources the same? the sources should be
// rising based on their data". No source is named in this file: the order, the bars and the counts all come from the
// reader, so a source moves up as more of its data lands. Held counts carry the time their fold was measured.
const COLUMNS = ['source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population', 'population_method',
  'population_confidence', 'population_at', 'map_sales', 'map_usd', 'sales_12m', 'usd_12m', 'sales_prior_12m',
  'usd_prior_12m', 'months', 'live_lots', 'live_at', 'held_lots_before', 'before_day', 'landed_24h', 'landed_7d',
  'last_landed', 'days14'] as const;
type Column = typeof COLUMNS[number];
const SHOWN = 10;

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
  /** Records landed (vehicle_events) in the last 24 hours and 7 days, the last hour any landed, and 14 daily counts. */
  landed24: number; landed7: number; lastLanded: string | null; days14: number[];
};
export type SourcesBoardData = { asOf: string; day: string | null; rows: SourceRow[]; notRanked: Record<string, number> };

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x
  : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x: unknown) => (typeof x === 'string' && x ? x : null);

/** The reader's value as typed rows, decoded by column name; anything else is null. */
export function parseSources(value: unknown): SourcesBoardData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as { as_of?: unknown; day?: unknown; columns?: unknown; rows?: unknown; not_ranked?: unknown };
  if (typeof v.as_of !== 'string' || !Array.isArray(v.columns) || !Array.isArray(v.rows)) return null;
  const columns = v.columns as unknown[];
  const at = Object.fromEntries(COLUMNS.map((c) => [c, columns.indexOf(c)])) as Record<Column, number>;
  if (at.source < 0 || at.name < 0 || at.held_lots < 0) return null;
  const rows: SourceRow[] = [];
  for (const r of v.rows) {
    if (!Array.isArray(r)) continue;
    const get = (c: Column) => (at[c] >= 0 ? r[at[c]] : null);
    const source = str(get('source')), name = str(get('name'));
    if (!source || !name) continue;
    const months = (Array.isArray(get('months')) ? get('months') as unknown[] : [])
      .filter((m): m is unknown[] => Array.isArray(m) && typeof m[0] === 'string')
      .map((m) => [m[0] as string, num(m[1]) ?? 0, num(m[2]) ?? 0] as [string, number, number]);
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
      landed24: num(get('landed_24h')) ?? 0, landed7: num(get('landed_7d')) ?? 0, lastLanded: str(get('last_landed')),
      days14: Array.isArray(get('days14')) ? (get('days14') as unknown[]).map((x) => num(x) ?? 0) : [],
    });
  }
  const notRanked: Record<string, number> = {};
  if (v.not_ranked && typeof v.not_ranked === 'object' && !Array.isArray(v.not_ranked)) {
    for (const [k, n] of Object.entries(v.not_ranked as Record<string, unknown>)) { const c = num(n); if (c) notRanked[k] = c; }
  }
  return { asOf: v.as_of, day: str(v.day), rows, notRanked };
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

/** Landing now: records in the last 24 hours, a dot that says whether any landed in that day, idle since when if not. */
export function landingState(row: Pick<SourceRow, 'landed24' | 'lastLanded'>, now = Date.now()): { active: boolean; text: string } {
  if (row.landed24 > 0) return { active: true, text: `+${count(row.landed24)} today` };
  if (!row.lastLanded) return { active: false, text: 'nothing landed yet' };
  const t = Date.parse(row.lastLanded);
  if (Number.isNaN(t)) return { active: false, text: 'idle' };
  return { active: false, text: `idle since ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` };
}
function DayBars({ days }: { days: number[] }) {
  const max = Math.max(0, ...days);
  if (!(max > 0) || days.length === 0) return null;
  const w = 4, gap = 1, h = 16;
  return (
    <svg className="market-sources__days" width={days.length * (w + gap)} height={h} viewBox={`0 0 ${days.length * (w + gap)} ${h}`}
      aria-hidden="true">
      {days.map((n, i) => {
        const bh = n > 0 ? Math.max(1, (Math.sqrt(n) / Math.sqrt(max)) * h) : 0;
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh}
          className={i === days.length - 1 ? 'market-sources__day--today' : 'market-sources__day'} />;
      })}
    </svg>
  );
}
const GROUPS: [string, string, string][] = [
  ['auction', 'Auction houses', 'lots held'],
  ['marketplace', 'Marketplaces', 'listings held'],
];
const NOT_RANKED_WORDS: Record<string, string> = {
  'capture channels': 'capture channel', aggregator: 'aggregator', dealer: 'dealer', shop: 'shop', registry: 'registry',
  social_media: 'social channel', forum: 'forum', documentation: 'archive', owner: 'owner source', internal: 'internal source',
};

export function SourcesBoardView({ data }: { data: SourcesBoardData }) {
  const [all, setAll] = useState(false);
  const heldAt = data.rows.map((r) => r.heldAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const groups = GROUPS.map(([key, title, unit]) => ({ key, title, unit, rows: data.rows.filter((r) => r.category === key) }))
    .filter((g) => g.rows.length);
  const shownPer = all ? Infinity : SHOWN;
  const hidden = groups.reduce((n, g) => n + Math.max(0, g.rows.length - SHOWN), 0);
  const notRanked = Object.entries(data.notRanked).sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${n} ${NOT_RANKED_WORDS[k] ?? k}${n > 1 ? 's' : ''}`);
  return (
    <section className="market-sources" aria-label="Sources, ranked by what we hold">
      <div className="market-sources__head">
        <span className="market-sources__title">Sources</span>
        <span className="market-sources__note">
          ranked by what we hold · a source moves up as more of it lands{heldAt ? ` · held counts as of ${heldWhen(heldAt)}` : ''}
        </span>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="market-sources__group">
          <div className="market-sources__cols">
            <span>#</span><span className="market-sources__group-title">{g.title}</span><span className="n">{g.unit}</span>
            <span>of their total</span><span>landing, last 14 days</span><span>sales, last 12 months</span><span className="n">live now</span>
          </div>
          <ol className="market-sources__rows">
            {g.rows.slice(0, shownPer).map((r, i) => {
              const s = heldShare(r);
              const week = r.held != null && r.heldBefore != null ? r.held - r.heldBefore : null;
              const land = landingState(r);
              const total = r.population != null
                ? `${count(r.population)} ${METHOD[r.populationMethod ?? ''] ?? `(${r.populationMethod ?? 'method unrecorded'})`}`
                  + `${r.populationAt ? `, ${shortDay(r.populationAt)}` : ''}`
                  + `${r.populationConfidence != null ? `, confidence ${r.populationConfidence.toFixed(2)}` : ''}`
                : 'their total is not counted yet';
              return (
                <li key={r.source} className="market-sources__row">
                  <span className="market-sources__rank">{i + 1}</span>
                  <span className="market-sources__name">{r.name}</span>
                  <span className="market-sources__held n" title={r.heldAt ? `held as of ${heldWhen(r.heldAt)}` : undefined}>
                    {r.held != null ? count(r.held) : '—'}
                    {week != null && week !== 0
                      ? <small className={week > 0 ? 'up' : 'down'}> {week > 0 ? '+' : '−'}{count(Math.abs(week))} since {shortDay(r.beforeDay)}</small>
                      : null}
                  </span>
                  <span className="market-sources__share" title={total}>
                    <svg className={`market-sources__track${s.share == null ? ' market-sources__track--unknown' : ''}`} viewBox="0 0 100 8"
                      preserveAspectRatio="none" aria-hidden="true">
                      {s.share != null ? <rect className="market-sources__fill" x="0" y="0" height="8" width={Math.max(1.5, s.share * 100)} /> : null}
                    </svg>
                    <span className="market-sources__sharetext">{s.text}</span>
                  </span>
                  <span className="market-sources__landing" title={`${count(r.landed7)} records landed in the last 7 days`}>
                    <i className={land.active ? 'on' : 'off'} aria-hidden="true" />
                    <span className={`market-sources__landtext${land.active ? '' : ' idle'}`}>{land.text}</span>
                    <DayBars days={r.days14} />
                  </span>
                  <span className="market-sources__recent"
                    title={r.mapSales ? `on the map: ${count(r.mapSales)} confirmed sales${r.mapUsd ? `, ${money(r.mapUsd)}` : ''}` : undefined}>
                    {r.sales12 ? <><span className="n">{count(r.sales12)}</span><Spark bars={monthBars(r.months, data.day)} /></> : <span className="n">—</span>}
                  </span>
                  <span className="market-sources__live n">
                    {r.live > 0 ? <><i aria-hidden="true" />{count(r.live)} live</> : '—'}
                  </span>
                </li>
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

/** The board as the market page mounts it: one read, nothing shown until it answers, nothing shown if it fails. */
export default function SourcesBoard() {
  const [data, setData] = useState<SourcesBoardData | null>(null);
  useEffect(() => {
    let live = true;
    // A failed or missing read leaves the board off the page; it never takes the market page down with it.
    Promise.resolve().then(() => supabase.rpc('market_sources_read')).then(({ data: value, error }) => {
      if (live && !error) setData(parseSources(value));
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!data || !data.rows.length) return null;
  return <SourcesBoardView data={data} />;
}
