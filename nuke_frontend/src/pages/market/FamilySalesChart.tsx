import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import './FamilySalesChart.css';

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

/** The reader's one value: n sales in the window, the newest `returned` of them as [vehicle_id, sale_date, usd, source,
 *  year, model] rows, and whether it held back older ones. Anything else is not a read. */
export function parseFamilySales(data: unknown): { sales: Sale[]; n: number; truncated: boolean } | null {
  const v = data as { n?: unknown; truncated?: unknown; rows?: unknown } | null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.n !== 'number' || !Array.isArray(v.rows)) return null;
  const sales: Sale[] = [];
  for (const r of v.rows) {
    if (!Array.isArray(r) || r.length !== 6 || typeof r[0] !== 'string' || typeof r[1] !== 'string' || typeof r[2] !== 'number') return null;
    sales.push({ vehicle_id: r[0], sale_date: r[1], usd: r[2], source: r[3] ?? null, year: r[4] ?? null, model: r[5] ?? null });
  }
  return { sales, n: v.n, truncated: v.truncated === true };
}

export function useFamilySales(brand: string | null, familyKey: string | null) {
  const [state, setState] = useState<{ sales: Sale[] | null; n: number; truncated: boolean; failed: boolean }>({ sales: null, n: 0, truncated: false, failed: false });
  useEffect(() => {
    setState({ sales: null, n: 0, truncated: false, failed: false });
    if (!brand || !familyKey || typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return;
    let live = true;
    Promise.resolve(supabase.rpc('treemap_family_sales', { p_brand: brand, p_family_key: familyKey })).then(
      ({ data, error }) => {
        if (!live) return;
        const v = error ? null : parseFamilySales(data);
        setState(v ? { ...v, failed: false } : { sales: null, n: 0, truncated: false, failed: true });
      },
      () => { if (live) setState({ sales: null, n: 0, truncated: false, failed: true }); },
    );
    return () => { live = false; };
  }, [brand, familyKey]);
  return state;
}

const M = { left: 60, right: 18, top: 16, bottom: 26 };
// The price axis starts at $500. A sale recorded under it (27 of 169,682 dated sales in five years on 2026-10-15, the
// lowest $1; for the 911 a 1989 Carrera 4 at $320) is counted in the caption and not drawn: it fell below the axis,
// and stretching the axis to it would flatten every real price.
export const PRICE_FLOOR = 500;
// Under this width the head stacks (title over the BaT move) and the legend takes short venue names (a 390 px phone
// wrapped the one-line head over the legend and the dots, 2026-10-15).
const NARROW = 640;

export default function FamilySalesChart({ brand, familyKey, family, width, height, onOpen }: {
  brand: string; familyKey: string; family: string; width: number; height: number; onOpen: (vehicleId: string) => void;
}) {
  const { sales, n: windowCount, truncated, failed } = useFamilySales(brand, familyKey);
  const [hover, setHover] = useState<number | null>(null);
  // Venues the reader hid from the legend: their dots and their share of the median line go, the axis stays, so one
  // venue's prices read against the same scale as the rest (Mecum against BaT, say). A new family shows every venue.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setHidden(new Set()); }, [brand, familyKey]);
  const toggle = (key: string) => setHidden((h) => { const next = new Set(h); if (!next.delete(key)) next.add(key); return next; });
  const svgRef = useRef<SVGSVGElement>(null);
  const plot = useMemo(() => {
    if (!sales?.length || width < 200 || height < 160) return null;
    const dated = sales.map((s) => ({ ...s, t: Date.parse(s.sale_date) })).filter((s) => Number.isFinite(s.t) && s.usd > 0).sort((a, b) => a.t - b.t);
    const pts = dated.filter((s) => s.usd >= PRICE_FLOOR);
    if (!pts.length) return null;
    const head = width < NARROW ? 96 : 54;
    const w = width - M.left - M.right, h = height - head - M.top - M.bottom;
    const t0 = Math.min(pts[0].t, Date.now() - 1826 * DAY), t1 = Date.now();
    const usd = pts.map((p) => p.usd);
    const lo = Math.max(PRICE_FLOOR, Math.min(...usd) * 0.85), hi = Math.max(...usd) * 1.15;
    const x = (t: number) => M.left + ((t - t0) / (t1 - t0)) * w;
    const y = (v: number) => head + M.top + h - ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * h;
    const shown = hidden.size ? pts.filter((p) => !hidden.has(venueOf(p.source).key)) : pts;
    const dots = shown.map((p) => ({ ...p, cx: x(p.t), cy: y(p.usd), color: venueOf(p.source).color }));
    const line = rollingMedian(shown).map((p) => `${x(p.t).toFixed(1)},${y(p.usd).toFixed(1)}`);
    const years: { x: number; label: string }[] = [];
    for (let yr = new Date(t0).getUTCFullYear() + 1; yr <= new Date(t1).getUTCFullYear(); yr++) years.push({ x: x(Date.UTC(yr, 0, 1)), label: String(yr) });
    const ticks = logTicks(lo, hi).map((v) => ({ y: y(v), label: money(v) }));
    const counts = VENUES.map((v) => ({ ...v, n: pts.filter((p) => venueOf(p.source).key === v.key).length })).filter((v) => v.n > 0);
    return { dots, line: line.length > 1 ? 'M' + line.join('L') : '', years, ticks, counts, head, w, h, n: dated.length,
      under: dated.length - pts.length, shown: shown.length, since: new Date(dated[0].t) };
  }, [sales, width, height, hidden]);
  const move = useMemo(() => (sales ? batMove(sales) : null), [sales]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!plot || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bestD = 14 * 14;
    plot.dots.forEach((d, i) => { const dd = (d.cx - mx) ** 2 + (d.cy - my) ** 2; if (dd < bestD) { bestD = dd; best = i; } });
    setHover(best >= 0 ? best : null);
  };

  if (failed) return <div className="family-sales__empty"><Text role="caption">The sales of this family could not be read.</Text></div>;
  if (!sales) return <div className="family-sales__empty"><Text role="caption">Reading sales…</Text></div>;
  if (!plot) return <div className="family-sales__empty"><Text role="caption">No dated sales of this family in the last five years.</Text></div>;
  const hd = hover != null ? plot.dots[hover] : null;
  const pct = move ? Math.round((move.last / move.prior - 1) * 100) : null;
  const narrow = width < NARROW;
  const since = plot.since.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const count = truncated ? `newest ${plot.n.toLocaleString('en-US')} of ${windowCount.toLocaleString('en-US')}` : plot.n.toLocaleString('en-US');
  return <div className={narrow ? 'family-sales family-sales--narrow' : 'family-sales'}>
    <div className="family-sales__head">
      <div className="family-sales__title">
        <Text role="entity" dense>{family}</Text>
        <Text role="caption">{(narrow ? `${count} sales since ${since} · line = rolling median`
          : `${count} sales with a date since ${since} · one dot each · line = rolling median, 60 days either side`)
          + (plot.under ? ` · ${plot.under.toLocaleString('en-US')} under ${money(PRICE_FLOOR)} not drawn` : '')
          + (hidden.size ? ` · ${plot.shown.toLocaleString('en-US')} shown` : '')}</Text>
      </div>
      {move && <div className="family-sales__move">
        <Text role="measure">{money(move.last)}</Text>
        <Text role="caption">{narrow ? `BaT median, 12 mo · ${money(move.prior)} the 12 before · ${pct! >= 0 ? '▲' : '▼'}${Math.abs(pct!)}%`
          : `BaT median, last 12 mo (${move.nLast}) · ${money(move.prior)} the 12 before (${move.nPrior}) · ${pct! >= 0 ? '▲' : '▼'}${Math.abs(pct!)}%`}</Text>
      </div>}
    </div>
    <div className="family-sales__legend">
      {plot.counts.map((v) => <button key={v.key} type="button" className="family-sales__venue" aria-pressed={!hidden.has(v.key)}
        title={hidden.has(v.key) ? `Show ${v.label}` : `Hide ${v.label}`} onClick={() => toggle(v.key)}>
        <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={v.color} /></svg>
        <Text role="caption">{narrow ? v.short : v.label} {v.n.toLocaleString('en-US')}</Text></button>)}
    </div>
    <svg ref={svgRef} className="family-sales__plot" width={width} height={height - plot.head} viewBox={`0 ${plot.head} ${width} ${height - plot.head}`}
      role="img" aria-label={`${family}: ${plot.n} sales over five years, price against date`}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => { if (hd) onOpen(hd.vehicle_id); }}>
      {plot.ticks.map((t) => <g key={t.label}>
        <line x1={M.left} x2={width - M.right} y1={t.y} y2={t.y} className="family-sales__grid" />
        <text x={M.left - 8} y={t.y + 3} textAnchor="end" className="family-sales__axis">{t.label}</text>
      </g>)}
      {plot.years.map((t) => <g key={t.label}>
        <line x1={t.x} x2={t.x} y1={plot.head + M.top} y2={height - M.bottom} className="family-sales__grid" />
        <text x={t.x + 4} y={height - 8} className="family-sales__axis">{t.label}</text>
      </g>)}
      {plot.dots.map((d) => <circle key={d.vehicle_id} cx={d.cx} cy={d.cy} r={plot.n > 2500 ? (narrow ? 1.3 : 2) : 2.8} fill={d.color} fillOpacity={narrow && plot.n > 2500 ? 0.4 : 0.55} />)}
      {plot.line && <path d={plot.line} className="family-sales__median-halo" />}
      {plot.line && <path d={plot.line} className="family-sales__median" />}
      {hd && <circle cx={hd.cx} cy={hd.cy} r={6} className="family-sales__hit" />}
    </svg>
    {hd && <div className="family-sales__tip" style={{ left: Math.min(hd.cx + 12, width - 240), top: hd.cy + 12 }}>
      <Text role="label" as="div">{[hd.year, hd.model].filter(Boolean).join(' ') || family}</Text>
      <Text role="measure" as="div">${hd.usd.toLocaleString('en-US')}</Text>
      <Text role="caption" as="div">{venueOf(hd.source).key === 'other' ? hd.source ?? 'venue unrecorded' : hd.source} · {new Date(hd.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · click to open</Text>
    </div>}
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
