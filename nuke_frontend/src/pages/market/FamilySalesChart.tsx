import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import './FamilySalesChart.css';
import { LikeForLike, useFamilyIndex } from './FamilyPriceIndex';
import { getFamilyEraCohorts, matchesEraRange } from '../../lib/market/familyEras';

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

export function matchesSaleSubModel(saleModel: string | null | undefined, selectedModel: string | null | undefined): boolean {
  if (!selectedModel) return true;
  const target = selectedModel.trim().toLowerCase();
  if (!target) return true;
  const m = (saleModel ?? '').trim().toLowerCase();
  return m === target || m.startsWith(`${target} `) || m.startsWith(`${target}-`);
}

export default function FamilySalesChart({ brand, familyKey, family, width, height, onOpen, selectedEra = null, onSelectEra, selectedModel = null }: {
  brand: string;
  familyKey: string;
  family: string;
  width: number;
  height: number;
  onOpen: (vehicleId: string) => void;
  selectedEra?: string | null;
  onSelectEra?: (era: string | null) => void;
  selectedModel?: string | null;
}) {
  const { sales: allSales, n: windowCount, truncated, failed } = useFamilySales(brand, familyKey);
  const modelSales = useMemo(
    () => (allSales && selectedModel ? allSales.filter((s) => matchesSaleSubModel(s.model, selectedModel)) : null),
    [allSales, selectedModel],
  );
  const baseSales = modelSales && modelSales.length > 0 ? modelSales : allSales;
  const eraCohorts = useMemo(
    () => (baseSales ? getFamilyEraCohorts(brand, family, baseSales.map((s) => s.year)) : []),
    [brand, family, baseSales],
  );
  const sales = useMemo(
    () => (baseSales && selectedEra ? baseSales.filter((s) => matchesEraRange(s.year, selectedEra)) : baseSales),
    [baseSales, selectedEra],
  );
  // Same car, same miles (family_price_index_read): when the family has a fitted index, the chart is one panel of every
  // sale with the like-for-like line over it, and the head answers with its 12-month change instead of a median.
  const ix = useFamilyIndex(brand, familyKey);
  const indexed = !selectedEra && !(modelSales && modelSales.length > 0) && !!ix && ix.series.length > 1;
  // The plain median's own 12-month change over every venue, for the sentence beside the answer when the reader has none.
  const plain = useMemo(() => (sales ? plainMedianChange(sales) : null), [sales]);
  const [hover, setHover] = useState<{ band: number; dot: number } | null>(null);
  const [refHover, setRefHover] = useState<number | null>(null);
  // Venues hidden from the legend: their dots and their share of the medians go, the axes stay.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setHidden(new Set()); }, [brand, familyKey]);
  const toggle = (key: string) => setHidden((h) => { const next = new Set(h); if (!next.delete(key)) next.add(key); return next; });
  const narrow = width < NARROW;
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
    const head = ix ? (narrow ? 132 : 92) : narrow ? 96 : 54;
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
      const band = rollingBand(g);
      const mid = band.map((b) => `${x(b.t).toFixed(1)},${y(b.p50).toFixed(1)}`);
      const area = band.length > 1 ? 'M' + band.map((b) => `${x(b.t).toFixed(1)},${y(b.p75).toFixed(1)}`).join('L')
        + 'L' + [...band].reverse().map((b) => `${x(b.t).toFixed(1)},${y(b.p25).toFixed(1)}`).join('L') + 'Z' : '';
      return { era, dots, line: mid.length > 1 ? 'M' + mid.join('L') : '', area, move: moves.get(era) ?? null,
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
    return { panels, years, ticks, counts, head, cols, pw, ph, ref, n: dated.length, under: dated.length - pts.length,
      shown: shown.length, outside, unpanelled, lo, hi, since: new Date(dated[0].t) };
  }, [sales, width, height, hidden, narrow, ix, indexed]);
  const move = useMemo(() => (sales ? batMove(sales) : null), [sales]);
  const held = useMemo(() => (sales ? mixFixed(eraMoves(sales)) : null), [sales]);

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
        <Text role="entity" dense>{selectedModel && selectedModel.toLowerCase() !== family.toLowerCase() && modelSales?.length ? `${family} · ${selectedModel}` : family}</Text>
        <Text role="caption">{(narrow ? `${count} sales since ${since}` : indexed
          ? `${count} sales with a date since ${since} · one dot each · blue = the same car, same miles (95% band) · gray = plain median, which mixes different cars`
          : `${count} sales with a date since ${since} · one dot each · panels by model-year decade · line = rolling median, band = middle half`)
          + (plot.under ? ` · ${plot.under.toLocaleString('en-US')} under ${money(PRICE_FLOOR)} not drawn` : '')
          + (plot.outside ? ` · ${plot.outside.toLocaleString('en-US')} outside ${money(plot.lo)}–${money(plot.hi)} on the edge` : '')
          + (plot.unpanelled ? ` · ${plot.unpanelled.toLocaleString('en-US')} with a rare or unknown model year not drawn` : '')
          + (hidden.size ? ` · ${plot.shown.toLocaleString('en-US')} shown` : '')}</Text>
      </div>
      {!selectedEra && ix ? <LikeForLike ix={plain != null && ix.rawChange == null ? { ...ix, rawChange: plain } : ix} narrow={narrow} /> : (held || move) && <div className="family-sales__move">
        {held ? <>
          <Text role="measure">{signed(held.change)}</Text>
          <Text role="caption">{narrow ? `BaT price, decades held at last year's mix · raw median ${raw}`
            : `BaT price, last 12 mo against the 12 before, each decade's median weighted by its sales a year earlier (${held.nPrior.toLocaleString('en-US')} → ${held.nLast.toLocaleString('en-US')} in ${held.eras} decades) · raw median ${raw}`}</Text>
        </> : move && <>
          <Text role="measure">{money(move.last)}</Text>
          <Text role="caption">{narrow ? `BaT median, 12 mo · ${money(move.prior)} the 12 before · ${signed(move.last / move.prior - 1)}`
            : `BaT median, last 12 mo (${move.nLast}) · ${money(move.prior)} the 12 before (${move.nPrior}) · ${signed(move.last / move.prior - 1)}`}</Text>
        </>}
      </div>}
    </div>
    <div className="family-sales__legend">
      {plot.counts.map((v) => <button key={v.key} type="button" className="family-sales__venue" aria-pressed={!hidden.has(v.key)}
        title={hidden.has(v.key) ? `Show ${v.label}` : `Hide ${v.label}`} onClick={() => toggle(v.key)}>
        <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={v.color} /></svg>
        <Text role="caption">{narrow ? v.short : v.label} {v.n.toLocaleString('en-US')}</Text></button>)}
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
    </div>
    <div className="family-sales__panels" style={{ gridTemplateColumns: `repeat(${plot.cols}, ${plot.pw}px)` }}>
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
        {pn.dots.map((d) => d.out
          ? <path key={d.vehicle_id} d={d.out > 0 ? `M${d.cx - 3} ${d.cy + 4}L${d.cx} ${d.cy - 1}L${d.cx + 3} ${d.cy + 4}Z` : `M${d.cx - 3} ${d.cy - 4}L${d.cx} ${d.cy + 1}L${d.cx + 3} ${d.cy - 4}Z`} className="family-sales__edge" />
          : <circle key={d.vehicle_id} cx={d.cx} cy={d.cy} r={pn.n > 1500 ? 1.4 : pn.n > 400 ? 2 : 2.6} fill={d.color} fillOpacity={pn.n > 1500 ? 0.35 : 0.55} />)}
        {pn.line && !plot.ref && <path d={pn.line} className="family-sales__median-halo" />}
        {pn.line && <path d={pn.line} className={plot.ref ? 'family-sales__median family-sales__median--plain' : 'family-sales__median'} />}
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
      const tip = r ? {
        left: Math.min(r.cx + 12, width - 260), top: plot.head + r.cy + 12,
        label: `${ix?.periodKind === 'month'
          ? new Date(r.t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
          : `${new Date(r.t).getUTCFullYear()} Q${Math.floor(new Date(r.t).getUTCMonth() / 3) + 1}`} · the same car`,
        measure: money(r.usd),
        caption: `${r.n.toLocaleString('en-US')} sales · 95% ${money(r.lo)}–${money(r.hi)}${r.median ? ` · plain median ${money(r.median)}` : ''}`,
      } : hd && hover ? {
        left: Math.min((hover.band % plot.cols) * (plot.pw + 6) + hd.cx + 12, width - 240),
        top: plot.head + Math.floor(hover.band / plot.cols) * (plot.ph + 6) + hd.cy + 12,
        label: [hd.year, hd.model].filter(Boolean).join(' ') || family,
        measure: `$${hd.usd.toLocaleString('en-US')}`,
        caption: `${venueOf(hd.source).key === 'other' ? hd.source ?? 'venue unrecorded' : hd.source} · ${new Date(hd.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · click to open`,
      } : null;
      return tip && <div className="family-sales__tip" style={{ left: tip.left, top: tip.top }}>
        <Text role="label" as="div">{tip.label}</Text>
        <Text role="measure" as="div">{tip.measure}</Text>
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
