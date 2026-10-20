import React, { useState } from 'react';
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

/** One reading per timestamp: each house's value and the total, from the snapshots. */
export function shareSeries(points: SharePoint[], measure: ShareMeasure) {
  const byTime = new Map<number, Map<string, number>>();
  for (const p of points) {
    const v = measure === 'bids' ? p.bidUsd : p.lots;
    if (!byTime.has(p.at)) byTime.set(p.at, new Map());
    byTime.get(p.at)!.set(p.house, v);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const houses = [...new Set(points.map(p => p.house))];
  return {
    times,
    houses,
    shares: Object.fromEntries(houses.map(h => [h, times.map(t => {
      const row = byTime.get(t)!;
      const total = [...row.values()].reduce((a, b) => a + b, 0);
      return total > 0 ? ((row.get(h) ?? 0) / total) * 100 : null;
    })])) as Record<string, (number | null)[]>,
  };
}

/** The house's change against its own reading a week ago, or null while its own series is younger than a week. */
export function houseWeekChange(house: string, now: number, measure: ShareMeasure, data: HouseShareData | undefined): number | null {
  const w = data?.weekAgo[house];
  if (!w || !now) return null;
  const before = measure === 'bids' ? w.bidUsd : w.lots;
  return before > 0 ? ((now - before) / before) * 100 : null;
}

function days(ms: number): string {
  const d = ms / 86_400_000;
  return d >= 2 ? `${Math.floor(d)} days` : `${Math.max(1, Math.round(ms / 3_600_000))} h`;
}

function stamp(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const LINE_COLORS = ['var(--share-1)', 'var(--share-2)', 'var(--share-3)', 'var(--share-4)', 'var(--share-5)', 'var(--share-6)', 'var(--share-7)', 'var(--share-8)'];

/** What the clicked figure opens into: each house's share of the total, now (from the live board) and over time (from the
 *  snapshots, one line per house). Says where the history starts; draws a line only once there are two readings. */
export function HouseShareChart({ measure, live, data, isError, now }: {
  measure: ShareMeasure; live: LiveAuction[]; data: HouseShareData | undefined; isError: boolean; now: number;
}) {
  const valueOf = (a: LiveAuction) => (measure === 'bids' ? (usdBid(a) ?? 0) : 1);
  const nowByHouse = new Map<string, number>();
  for (const a of live) nowByHouse.set(a.house, (nowByHouse.get(a.house) ?? 0) + valueOf(a));
  const total = [...nowByHouse.values()].reduce((a, b) => a + b, 0);
  const rank = [...nowByHouse.entries()].sort((a, b) => b[1] - a[1]);
  const series = shareSeries(data?.points ?? [], measure);
  const drawn = series.times.length >= 2;
  const x = (i: number) => (series.times.length > 1 ? (i / (series.times.length - 1)) * 100 : 0);
  const ordered = rank.map(([h]) => h).concat(series.houses.filter(h => !nowByHouse.has(h)));
  const color = (h: string) => LINE_COLORS[ordered.indexOf(h) % LINE_COLORS.length];
  const unit = measure === 'bids' ? 'dollars bid' : 'open lots';
  return (
    <section className="market-share" aria-label={`Each house's share of ${unit}`}>
      <div className="market-share__head">
        <Text role="label">{`Share of ${unit}, by house`}</Text>
        <Text role="caption">
          {data?.firstAt ? `Recorded every 15 minutes since ${stamp(data.firstAt)} (${days(now - data.firstAt)} of history). Nothing before that is estimated.`
            : isError ? 'The history could not be read.' : 'Recording starts now; the lines fill in as readings accumulate.'}
          {measure === 'bids' ? ' Dollar bids only; bids in another currency are not added.' : ''}
        </Text>
      </div>
      <div className="market-share__now" role="img" aria-label="Each house's share now">
        {rank.map(([h, v]) => total > 0 && v > 0 ? <span key={h} style={{ flexBasis: `${(v / total) * 100}%`, background: color(h) }} title={`${houseName(h)}: ${((v / total) * 100).toFixed(1)}%`} /> : null)}
      </div>
      <ul className="market-share__legend">
        {rank.map(([h, v]) => (
          <li key={h}>
            <i style={{ background: color(h) }} aria-hidden="true" />
            <HouseMark house={h} />
            <Text role="measure" dense>{total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—'}</Text>
          </li>
        ))}
      </ul>
      {drawn ? (
        <svg className="market-share__chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img"
          aria-label={`Share of ${unit} by house, ${stamp(series.times[0])} to ${stamp(series.times[series.times.length - 1])}`}>
          {[0, 25, 50, 75, 100].map(g => <line key={g} className="market-share__grid" x1="0" x2="100" y1={40 - (g / 100) * 38 - 1} y2={40 - (g / 100) * 38 - 1} vectorEffect="non-scaling-stroke" />)}
          {series.houses.map(h => {
            const pts = series.shares[h].map((s, i) => (s == null ? null : `${x(i).toFixed(2)},${(39 - (s / 100) * 38).toFixed(2)}`)).filter((p): p is string => p != null);
            return pts.length > 1 ? <polyline key={h} className="market-share__line" style={{ stroke: color(h) }} vectorEffect="non-scaling-stroke" points={pts.join(' ')}>
              <title>{houseName(h)}</title></polyline> : null;
          })}
        </svg>
      ) : null}
      {drawn ? <div className="market-share__axis"><Text role="caption">{stamp(series.times[0])}</Text><Text role="caption">100% = every house together</Text><Text role="caption">{stamp(series.times[series.times.length - 1])}</Text></div> : null}
    </section>
  );
}
