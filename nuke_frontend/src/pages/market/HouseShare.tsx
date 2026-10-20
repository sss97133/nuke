import React, { useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import { houseName, usdBid, type LiveAuction } from './useMarketPulse';
import { sourceLogoInk } from './sourceLogoInk';

// Each house's share of the board over time, and each house's own week-over-week comparison. Both read one series:
// live_board_snapshots (migration 20261022073000), recorded every 15 minutes from its first day. Nothing is backfilled:
// the chart says where its history starts, and a house has a week-ago comparison only once its own series is a week old.

export interface SharePoint { at: number; house: string; bidUsd: number; lots: number; lotsWithBid: number }
export interface HouseWeekAgo { at: number; bidUsd: number; lots: number; lotsWithBid: number }
export interface HouseShareData {
  firstAt: number | null;
  firstAtByHouse: Record<string, number>;
  points: SharePoint[];
  weekAgo: Record<string, HouseWeekAgo>;
}

export async function fetchHouseShare(): Promise<HouseShareData> {
  const { data, error } = await supabase.rpc('live_board_share', { p_hours: 168 });
  if (error) throw error;
  const rows = (Array.isArray(data?.points) ? data.points : []) as [string, string, number | string, number, number][];
  const week = (data?.week_ago ?? {}) as Record<string, { at: string; bid_usd: number | string; lots: number; lots_with_bid: number }>;
  const firsts = (data?.first_at_by_house ?? {}) as Record<string, string>;
  return {
    firstAt: data?.first_at ? Date.parse(data.first_at) : null,
    firstAtByHouse: Object.fromEntries(Object.entries(firsts).map(([h, t]) => [h, Date.parse(t)])),
    points: rows.map(r => ({ at: Date.parse(r[0]), house: r[1], bidUsd: Number(r[2]), lots: Number(r[3]), lotsWithBid: Number(r[4]) }))
      .filter(p => Number.isFinite(p.at)),
    weekAgo: Object.fromEntries(Object.entries(week).map(([h, w]) => [h, {
      at: Date.parse(w.at), bidUsd: Number(w.bid_usd), lots: Number(w.lots), lotsWithBid: Number(w.lots_with_bid) }])),
  };
}

export function useHouseShare() {
  return useQuery({ queryKey: ['live-board-share'], queryFn: fetchHouseShare, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: 1 });
}

/** The file name of a house's mark in public/source-logos. */
export function houseLogoSlug(house: string): string {
  return house === 'bringatrailer' ? 'bat' : house;
}

/** A house's own logo, or its name when it has none hosted. The name is always the accessible label. */
export function HouseMark({ house, short = true, height = 18 }: { house: string; short?: boolean; height?: number }) {
  const [missing, setMissing] = useState(false);
  const name = houseName(house, short);
  const src = `/source-logos/${houseLogoSlug(house)}.png`;
  if (missing) return <Text role="label" className="market-house-mark market-house-mark--name">{name}</Text>;
  return <img className={`market-house-mark market-house-mark--${sourceLogoInk(src) ?? 'color'}`} src={src} alt={name} title={name}
    height={height} loading="lazy" onError={() => setMissing(true)} />;
}

export type ShareMeasure = 'bids' | 'lots';

/** One reading per timestamp across every house: the board's total, as a price chart reads it. */
export function totalSeries(points: SharePoint[], measure: ShareMeasure): { t: number; v: number }[] {
  const byTime = new Map<number, number>();
  for (const p of points) byTime.set(p.at, (byTime.get(p.at) ?? 0) + (measure === 'bids' ? p.bidUsd : p.lots));
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
}

/** One house's readings. */
export function houseSeries(points: SharePoint[], house: string, measure: ShareMeasure): { t: number; v: number }[] {
  return points.filter(p => p.house === house).sort((a, b) => a.at - b.at).map(p => ({ t: p.at, v: measure === 'bids' ? p.bidUsd : p.lots }));
}

/** The house's change against its own reading a week ago, or null while its own series is younger than a week. */
export function houseWeekChange(house: string, now: number, measure: ShareMeasure, data: HouseShareData | undefined): number | null {
  const w = data?.weekAgo[house];
  if (!w || !now) return null;
  const before = measure === 'bids' ? w.bidUsd : w.lots;
  return before > 0 ? ((now - before) / before) * 100 : null;
}

export const RANGES = [
  { id: '6h', label: '6H', ms: 6 * 3_600_000 },
  { id: '1d', label: '1D', ms: 24 * 3_600_000 },
  { id: '1w', label: '1W', ms: 7 * 24 * 3_600_000 },
  { id: 'all', label: 'ALL', ms: Infinity },
] as const;
export type RangeId = typeof RANGES[number]['id'];

/** The readings inside a range, ending at the newest reading. */
export function inRange<T extends { t: number }>(series: T[], range: RangeId): T[] {
  if (series.length === 0) return series;
  const ms = RANGES.find(r => r.id === range)!.ms;
  const end = series[series.length - 1].t;
  return series.filter(x => x.t >= end - ms);
}

/** First-to-last change over the readings given, or null with fewer than two or a zero start. */
export function change(series: { v: number }[]): { abs: number; pct: number } | null {
  if (series.length < 2 || !(series[0].v > 0)) return null;
  const abs = series[series.length - 1].v - series[0].v;
  return { abs, pct: (abs / series[0].v) * 100 };
}

function stamp(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function span(ms: number): string {
  const d = ms / 86_400_000;
  return d >= 2 ? `${Math.floor(d)} days` : ms >= 3_600_000 * 2 ? `${Math.round(ms / 3_600_000)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`;
}
function dollars(n: number, places = 1): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(places)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(places > 0 ? 1 : 0)}K` : `$${Math.round(n)}`;
}
function valueText(n: number, measure: ShareMeasure, places = 2): string {
  return measure === 'bids' ? dollars(n, places) : Math.round(n).toLocaleString('en-US');
}
function signedPct(p: number): string { return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`; }

const H = 260, PAD_R = 70, PAD_B = 22, PAD_T = 10;

/** Decimals for an axis in millions or thousands so neighbouring ticks never read the same. */
function axisPlaces(step: number, top: number, measure: ShareMeasure): number {
  if (measure !== 'bids' || !(step > 0)) return 0;
  const unit = top >= 1_000_000 ? 1_000_000 : 1_000;
  return Math.min(3, Math.max(1, Math.ceil(-Math.log10(step / unit)) + 0));
}

/** A price chart of one series: a line and soft area in green when the range is up and red when down, a dashed last-price
 *  line with its tag on the right axis, a price grid and a time axis, and a crosshair that reads the value under the pointer. */
export function PriceChart({ series, measure, up }: { series: { t: number; v: number }[]; measure: ShareMeasure; up: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at its real pixel width so the labels keep their size on any screen.
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(760);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => { const w = Math.round(entries[0]?.contentRect.width ?? 0); if (w > 0) setWidth(w); });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(320, width);
  const lo0 = Math.min(...series.map(x => x.v)), hi0 = Math.max(...series.map(x => x.v));
  const pad = (hi0 - lo0) * 0.12 || hi0 * 0.02 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const px = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD_R);
  const py = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const pts = series.map(x => `${px(x.t).toFixed(1)},${py(x.v).toFixed(1)}`);
  const last = series[series.length - 1];
  const color = up ? 'var(--success)' : 'var(--error)';
  const ticks = [0, 1, 2, 3].map(i => lo + ((hi - lo) * (i + 0.5)) / 4);
  const places = axisPlaces((hi - lo) / 4, hi, measure);
  const h = hover != null ? series[hover] : null;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0, bd = Infinity;
    series.forEach((s, i) => { const d = Math.abs(px(s.t) - x); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  return (
    <svg ref={ref} className="market-stock__chart" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" onPointerMove={onMove} onPointerLeave={() => setHover(null)}
      aria-label={`${valueText(last.v, measure)} at ${stamp(last.t)}, ${stamp(t0)} to ${stamp(t1)}`}>
      {ticks.map((v, i) => <g key={i}><line className="market-stock__grid" x1="0" x2={W - PAD_R} y1={py(v)} y2={py(v)} />
        <text className="market-stock__tick" x={W - PAD_R + 6} y={py(v) + 3}>{valueText(v, measure, places)}</text></g>)}
      <polygon className="market-stock__area" style={{ fill: color }} points={`0,${H - PAD_B} ${pts.join(' ')} ${px(t1).toFixed(1)},${H - PAD_B}`} />
      <polyline className="market-stock__line" style={{ stroke: color }} points={pts.join(' ')} />
      <line className="market-stock__last" style={{ stroke: color }} x1="0" x2={W - PAD_R} y1={py(last.v)} y2={py(last.v)} />
      <rect x={W - PAD_R + 2} y={py(last.v) - 9} width={PAD_R - 2} height="18" style={{ fill: color }} />
      <text className="market-stock__tag" x={W - PAD_R + 6} y={py(last.v) + 4}>{valueText(last.v, measure, Math.max(2, places))}</text>
      <text className="market-stock__tick" x="0" y={H - 6}>{series.length > 1 && t1 - t0 < 86_400_000 * 1.5 ? clock(t0) : stamp(t0)}</text>
      <text className="market-stock__tick" x={W - PAD_R} y={H - 6} textAnchor="end">{series.length > 1 && t1 - t0 < 86_400_000 * 1.5 ? clock(t1) : stamp(t1)}</text>
      {h && <g>
        <line className="market-stock__cross" x1={px(h.t)} x2={px(h.t)} y1={PAD_T} y2={H - PAD_B} />
        <circle cx={px(h.t)} cy={py(h.v)} r="4" style={{ fill: color }} />
        <g transform={`translate(${Math.min(Math.max(px(h.t) - 70, 0), W - PAD_R - 140)},${PAD_T})`}>
          <rect className="market-stock__tip" width="140" height="34" />
          <text className="market-stock__tipv" x="8" y="15">{valueText(h.v, measure, 2)}</text>
          <text className="market-stock__tipt" x="8" y="28">{stamp(h.t)}</text>
        </g>
      </g>}
    </svg>
  );
}

function Spark({ series, up }: { series: { t: number; v: number }[]; up: boolean }) {
  if (series.length < 2) return <span className="market-stock__spark market-stock__spark--none" aria-hidden="true">—</span>;
  const lo = Math.min(...series.map(x => x.v)), hi = Math.max(...series.map(x => x.v));
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const pts = series.map(x => `${(((x.t - t0) / Math.max(1, t1 - t0)) * 80).toFixed(1)},${(22 - ((x.v - lo) / Math.max(1e-9, hi - lo)) * 20).toFixed(1)}`).join(' ');
  return <svg className="market-stock__spark" viewBox="0 0 80 24" aria-hidden="true"><polyline points={pts} style={{ stroke: up ? 'var(--success)' : 'var(--error)' }} /></svg>;
}

/** What the clicked figure opens into, laid out like a market screen: the board's total as a price chart with range
 *  tabs, and under it a watchlist of the houses (mark, value, share, change, trend). The history starts the day it began
 *  recording and says so; a house with fewer than two readings in the range shows no change. */
export function HouseMarket({ measure, live, data, isError, now }: {
  measure: ShareMeasure; live: LiveAuction[]; data: HouseShareData | undefined; isError: boolean; now: number;
}) {
  const [range, setRange] = useState<RangeId>('1d');
  const valueOf = (a: LiveAuction) => (measure === 'bids' ? (usdBid(a) ?? 0) : 1);
  const nowBy = new Map<string, number>();
  for (const a of live) nowBy.set(a.house, (nowBy.get(a.house) ?? 0) + valueOf(a));
  const total = [...nowBy.values()].reduce((a, b) => a + b, 0);
  const rows = [...nowBy.entries()].sort((a, b) => b[1] - a[1]);
  const all = totalSeries(data?.points ?? [], measure);
  const series = inRange(all, range);
  const ch = change(series);
  const up = (ch?.abs ?? 0) >= 0;
  const unit = measure === 'bids' ? 'Dollars bid' : 'Open lots';
  return (
    <section className="market-stock" aria-label={`${unit}, every house`}>
      <div className="market-stock__top">
        <div>
          <Text role="label">{unit} · every house</Text>
          <div className="market-stock__price">
            <Text role="figure">{valueText(series.length ? series[series.length - 1].v : total, measure, 2)}</Text>
            {ch ? <span className={`market-stock__chg ${up ? 'is-up' : 'is-down'}`}>{up ? '▲' : '▼'} {measure === 'bids' ? dollars(Math.abs(ch.abs), 2) : Math.round(Math.abs(ch.abs)).toLocaleString('en-US')} ({signedPct(ch.pct)})</span> : null}
          </div>
        </div>
        <div className="market-stock__ranges" role="group" aria-label="Time range">
          {RANGES.map(r => <button key={r.id} type="button" className="market-control" aria-pressed={range === r.id} onClick={() => setRange(r.id)}><Text role="label">{r.label}</Text></button>)}
        </div>
      </div>
      {series.length >= 2 ? <PriceChart series={series} measure={measure} up={up} /> : (
        <div className="market-stock__empty" role="status">
          <Text role="body">{isError ? 'The history could not be read.' : series.length === 1 ? 'One reading so far; the line draws from the next one (every 15 minutes).' : 'Recording starts now; the chart fills in as readings accumulate.'}</Text>
        </div>
      )}
      <Text role="caption" as="div" className="market-stock__note">
        {data?.firstAt ? `Recorded every 15 minutes since ${stamp(data.firstAt)} (${span(now - data.firstAt)} of history). Nothing before that is estimated.` : ''}
        {measure === 'bids' ? ' Dollar bids only; a bid in another currency is not added.' : ''}
        {series.length >= 2 ? ` Showing ${span(series[series.length - 1].t - series[0].t)}.` : ''}
      </Text>
      <table className="market-stock__watch" aria-label="Houses">
        <thead><tr><th scope="col">House</th><th scope="col">{unit}</th><th scope="col">Share</th><th scope="col">Change</th><th scope="col" aria-label="Trend" /></tr></thead>
        <tbody>
          {rows.map(([h, v]) => {
            const hs = inRange(houseSeries(data?.points ?? [], h, measure), range);
            const hc = change(hs);
            const hup = (hc?.abs ?? 0) >= 0;
            return (
              <tr key={h}>
                <th scope="row"><HouseMark house={h} /></th>
                <td><Text role="measure" dense>{valueText(v, measure, 2)}</Text></td>
                <td><Text role="measure" dense>{total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—'}</Text></td>
                <td className={hc ? (hup ? 'is-up' : 'is-down') : ''}><Text role="measure" dense>{hc ? `${hup ? '▲' : '▼'} ${signedPct(hc.pct)}` : '—'}</Text></td>
                <td><Spark series={hs} up={hup} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
