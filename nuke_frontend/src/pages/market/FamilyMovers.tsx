import { useEffect, useState } from 'react';
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

// 24 bars, the prior year faint and the last year in the chip's direction, each scaled to the family's busiest bin.
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

/** A family that gained or lost share of Bring a Trailer's sales (treemap_family_share_movers, 20261016211000): its
 *  move against BaT overall with a ±2 standard error band, its sales both years, and its average sale's move apart. */
export type ShareMover = {
  brand: string; family_key: string; family: string; sold_12m: number; sold_prior_12m: number; usd_12m: number;
  usd_prior_12m: number; share_move: number; share_lo: number; share_hi: number; se: number; avg_price_move: number | null;
};
export type ShareMovers = {
  as_of: string | null; min_sales: number; families: number; eligible: number; significant: number;
  bat: { sold_12m: number; sold_prior_12m: number; usd_12m: number; usd_prior_12m: number };
  gaining: ShareMover[]; losing: ShareMover[];
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function parseMover(r: unknown): ShareMover | null {
  const m = r as Partial<ShareMover> | null;
  if (!m || typeof m.brand !== 'string' || typeof m.family_key !== 'string' || typeof m.family !== 'string') return null;
  if (![m.sold_12m, m.sold_prior_12m, m.share_move, m.share_lo, m.share_hi].every(isNum)) return null;
  return { brand: m.brand, family_key: m.family_key, family: m.family, sold_12m: m.sold_12m!, sold_prior_12m: m.sold_prior_12m!,
    usd_12m: isNum(m.usd_12m) ? m.usd_12m : 0, usd_prior_12m: isNum(m.usd_prior_12m) ? m.usd_prior_12m : 0,
    share_move: m.share_move!, share_lo: m.share_lo!, share_hi: m.share_hi!, se: isNum(m.se) ? m.se : 0,
    avg_price_move: isNum(m.avg_price_move) ? m.avg_price_move : null };
}
/** The reader's value, or null when it is not one (the strip then stays away). */
export function parseShareMovers(raw: unknown): ShareMovers | null {
  const v = raw as Partial<ShareMovers> | null;
  if (!v || typeof v !== 'object' || !Array.isArray(v.gaining) || !Array.isArray(v.losing)) return null;
  const b = v.bat as ShareMovers['bat'] | undefined;
  if (!b || !isNum(b.sold_12m) || !isNum(b.sold_prior_12m) || b.sold_prior_12m <= 0) return null;
  const gaining = v.gaining.map(parseMover).filter((m): m is ShareMover => m !== null);
  const losing = v.losing.map(parseMover).filter((m): m is ShareMover => m !== null);
  return { as_of: typeof v.as_of === 'string' ? v.as_of : null, min_sales: isNum(v.min_sales) ? v.min_sales : 30,
    families: isNum(v.families) ? v.families : 0, eligible: isNum(v.eligible) ? v.eligible : 0,
    significant: isNum(v.significant) ? v.significant : 0, bat: b, gaining, losing };
}

let shareRead: Promise<ShareMovers | null> | null = null;
export function readShareMovers(): Promise<ShareMovers | null> {
  if (typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return Promise.resolve(null);
  if (!shareRead) {
    shareRead = Promise.resolve(supabase.rpc('treemap_family_share_movers', { p_limit: 5 })).then(
      ({ data, error }) => { const v = error ? null : parseShareMovers(data); if (!v) shareRead = null; return v; },
      () => { shareRead = null; return null; },
    );
  }
  return shareRead;
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

export default function FamilyMovers({ onPick }: { onPick: (m: Pick<Mover, 'brand' | 'family_key' | 'family'>) => void }) {
  const [data, setData] = useState<ShareMovers | null>(null);
  const [bins, setBins] = useState<Map<string, number[]>>(new Map());
  useEffect(() => {
    let live = true;
    readShareMovers().then((r) => { if (live) setData(r); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const rows = data ? [...data.gaining, ...data.losing] : [];
    if (!rows.length) return;
    let live = true;
    readFamilyMonthly(rows as unknown as Mover[]).then((b) => { if (live) setBins(b); });
    return () => { live = false; };
  }, [data]);
  if (!data || (!data.gaining.length && !data.losing.length)) return null;
  const batMove = data.bat.sold_12m / data.bat.sold_prior_12m - 1;
  const row = (m: ShareMover, dir: 'up' | 'down') => {
    const key = `${m.brand}|${m.family_key}`;
    return <button key={key} type="button" className="map-movers2__row" onClick={() => onPick(m)}
      title={`${m.brand} ${m.family} on Bring a Trailer: ${m.sold_prior_12m} sold the year before, ${m.sold_12m} this year; ${pct(m.share_move)} after taking out BaT's own growth (likely range ${pct(m.share_lo)} to ${pct(m.share_hi)})`}>
      <span className="map-movers2__name">{m.brand} {m.family}</span>
      <MoveDot m={m} />
      <span className={`map-movers2__move map-movers2__move--${dir}`}>{pct(m.share_move)}</span>
      <span className="map-movers2__counts">{m.sold_prior_12m.toLocaleString('en-US')} → {m.sold_12m.toLocaleString('en-US')} sold</span>
      <span className="map-movers2__price">{m.avg_price_move == null ? '' : `avg sale ${pct(m.avg_price_move)}`}</span>
      {bins.has(key) ? <Spark bins={bins.get(key)!} direction={dir} /> : <span />}
    </button>;
  };
  const side = (title: string, list: ShareMover[], dir: 'up' | 'down') => <div className="map-movers2__side">
    <div className="map-movers2__title">{title}</div>
    {list.length ? list.map((m) => row(m, dir)) : <div className="map-movers2__none">no real changes</div>}
  </div>;
  return <div className="map-movers2" role="group" aria-label="Model families selling more and less on Bring a Trailer">
    <div className="map-movers2__sides">
      {side('Selling more on Bring a Trailer', data.gaining, 'up')}
      {side('Selling less on Bring a Trailer', data.losing, 'down')}
    </div>
    <div className="map-movers2__base">
      Bring a Trailer sales this year against last year, after taking out BaT's own growth ({pct(batMove)},{' '}
      {data.bat.sold_prior_12m.toLocaleString('en-US')} → {data.bat.sold_12m.toLocaleString('en-US')}). A family is listed only when its
      change is bigger than luck explains; the bar is the likely range, from half as many sales (−50%) to twice as many (+100%).
      {' '}{data.significant.toLocaleString('en-US')} of {data.eligible.toLocaleString('en-US')} families with {data.min_sales}+ BaT sales each
      year changed for real ({data.families.toLocaleString('en-US')} families read). Avg sale = BaT dollars divided by cars sold, so it
      moves with which cars sold.
    </div>
  </div>;
}
