import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { usePageTitle } from '../../hooks/usePageTitle';
import { timeLeft, useSecondClock } from '../../hooks/useSecondClock';
import { squarify } from '../../lib/squarify';
import { useLotMovement, weigh, type ActivityReceipt, type LotMovement, type MovementItem } from './useLotMovement';
import { BID_BUCKETS, bidBucket, currentBidDistribution, NO_MAKE, useMarketPulse, type BidBucket, type BidCurve, type BoardReading, type HourReading, type LiveAuction } from './useMarketPulse';
import RecordedSalesComparison from './RecordedSalesComparison';

// The homepage: the live collector-car market as Nuke sees it right now.
// Activity figures count the rows market_pulse_live() returns; rows open their
// canonical records. Model-based hot/cold context is explained separately below.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Window = 'all' | '1h' | '24h' | 'new' | 'nr' | 'hot' | 'cold';
type Sort = 'ending' | 'bid' | 'newest' | 'hottest' | 'coldest';

const WINDOWS: { id: Window; label: string }[] = [
  { id: 'all', label: 'Live lots' },
  { id: '1h', label: 'Ending < 1 h' },
  { id: '24h', label: 'Ending < 24 h' },
  { id: 'new', label: 'First seen < 24 h' },
  { id: 'nr', label: 'No reserve' },
];

// Current auctions appear in close order unless the viewer chooses another sort.
const SORTS: { id: Sort; label: string }[] = [
  { id: 'bid', label: 'Highest bid' },
  { id: 'ending', label: 'Ending first' },
  { id: 'newest', label: 'First seen' },
];

const label: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
};

const mono: React.CSSProperties = { fontFamily: "'Courier New', monospace" };

function bidNumber(n: number | null | undefined, compact = false): string {
  if (n == null) return '—';
  if (compact && Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (compact && Math.abs(n) >= 10_000) return `${Math.round(n / 1_000)}K`;
  return `${Math.round(n).toLocaleString('en-US')}`;
}

const left = timeLeft;

// "2 h out", "40 min out", "3.5 days out": where in the auction a measure was taken.
function out(hours: number): string {
  if (hours >= 48) return `${(hours / 24).toFixed(1)} days out`;
  if (hours >= 1) return `${Math.round(hours)} h out`;
  return `${Math.max(1, Math.round(hours * 60))} min out`;
}

// In the viewer's own time zone.
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function title(a: LiveAuction): string {
  return a.title ?? [a.year, a.make === NO_MAKE ? null : a.make, a.model].filter(Boolean).join(' ');
}

// Every countdown ticks by the second on the page's one shared clock (useSecondClock).
function Countdown({ endsAt, strong }: { endsAt: number; strong?: boolean }) {
  const now = useSecondClock();
  const remaining = endsAt - now;
  return (
    <span style={{ ...mono, fontWeight: strong || remaining < HOUR ? 700 : 400, color: remaining < HOUR ? 'var(--text)' : 'var(--text-secondary)' }}>
      {left(remaining)}
    </span>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function pctChange(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}

function signed(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// "Higher than 8 of 11": where now ranks among its own past readings, counted, never labelled.
function rankOf(value: number, readings: { v: number }[]): { below: number; above: number; n: number; text: string | null } {
  const n = readings.length;
  const below = readings.filter((r) => value > r.v).length;
  const above = readings.filter((r) => value < r.v).length;
  const text = n === 0 ? null
    : below === n ? `higher than all ${n}`
    : above === n ? `lower than all ${n}`
    : below >= above ? `higher than ${below} of ${n}` : `lower than ${above} of ${n}`;
  return { below, above, n, text };
}

// Each earlier week at this weekday and hour is a tick; now is the block. The sentence ranks now among them.
function RangeBar({ value, readings, fmt, weekdayUtc, weeks }: { value: number; readings: { day: string; v: number }[]; fmt: (n: number, compact?: boolean) => string; weekdayUtc: string; weeks: number }) {
  const lo = Math.min(value, ...readings.map((r) => r.v));
  const hi = Math.max(value, ...readings.map((r) => r.v));
  const span = hi - lo;
  const x = (v: number) => (span > 0 ? (v - lo) / span : 0.5);
  const { n, text: rank } = rankOf(value, readings);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={label}>Same time on {weekdayUtc}s · {n === weeks ? `last ${weeks} weeks` : `${n} of the last ${weeks} weeks`}</span>
      <span style={{ ...mono, fontSize: 11 }}>{fmt(lo, true)}</span>
      <span style={{ position: 'relative', width: 160, height: 12 }}>
        <span style={{ position: 'absolute', top: 5, left: 0, right: 0, height: 2, background: 'var(--border)' }} />
        {readings.map((r) => (
          <span
            key={r.day}
            title={`${r.day}: ${fmt(r.v)}`}
            style={{ position: 'absolute', top: 2, left: `calc(${x(r.v) * 100}% - 1px)`, width: 2, height: 8, background: 'var(--text-secondary)' }}
          />
        ))}
        <span title={`Now: ${fmt(value)}`} style={{ position: 'absolute', top: 0, left: `calc(${x(value) * 100}% - 3px)`, width: 6, height: 12, background: 'var(--text)' }} />
      </span>
      <span style={{ ...mono, fontSize: 11 }}>{fmt(hi, true)}</span>
      {rank && <span style={{ ...label, color: 'var(--text)' }}>{rank} {weekdayUtc}s at this hour</span>}
    </span>
  );
}

// What the headline is relative to: the same board a week ago. Its range at this time of the week is a strip below.
function Relativity({ value, weekAgo }: { value: number; weekAgo: BoardReading | null }) {
  const pct = weekAgo ? pctChange(value, weekAgo.bids) : null;
  const rebuilt = weekAgo?.source === 'archive';
  if (!weekAgo || pct == null) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center', padding: '6px 10px', border: '2px solid var(--border)', borderTop: 'none', marginTop: -12, marginBottom: 12 }}>
      <span title={`${bidNumber(weekAgo.bids)} across ${weekAgo.n.toLocaleString('en-US')} auctions at ${clock(weekAgo.at)} a week ago${rebuilt ? ' (rebuilt from BaT bid history, 96% of auctions)' : ''}`}>
        <span style={label}>vs same time last week </span>
        <span style={{ ...mono, fontWeight: 700, color: pct >= 0 ? 'var(--success)' : 'var(--error)' }}>{rebuilt ? '≈' : ''}{signed(pct)}</span>
        <span style={{ ...mono, fontSize: 11, color: 'var(--text-secondary)' }}> from {bidNumber(weekAgo.bids, true)}</span>
      </span>
    </div>
  );
}

// ---- Edges --------------------------------------------------------------------------------------
// The strip above is a generator: any series with a reading at this weekday and hour in earlier weeks gets one. The
// page scans them all and shows only those whose value now sits in the top or bottom 2 of its own readings (higher,
// or lower, than all or all but one), most extreme first. Series: the whole board's current bids, auctions with a
// bid, and bid per auction; and, once 6 weeks of live readings carry them (from 2026-09-27), the same per make.
interface Series {
  key: string;
  what: string; // what is measured
  set: string; // the comparison set
  value: number; // now
  readings: { day: string; v: number }[]; // the same weekday and hour in earlier weeks
  fmt: (n: number, compact?: boolean) => string;
}

interface Edge extends Series { depth: number; beyond: number }

const EDGE_MIN_READINGS = 6;
const EDGE_MAX = 6;
const MAKE_MIN_AUCTIONS = 5;

function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function edgeOf(s: Series): Edge | null {
  const { below, above, n } = rankOf(s.value, s.readings);
  if (n < EDGE_MIN_READINGS) return null;
  const top = below >= n - 1;
  const bottom = above >= n - 1;
  if (!top && !bottom) return null;
  const vs = s.readings.map((r) => r.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || Math.abs(hi) || 1;
  // depth 0 = beyond every reading, 1 = beyond all but one; beyond = how far past the far end, in spans.
  return { ...s, depth: n - Math.max(below, above), beyond: top ? (s.value - hi) / span : (lo - s.value) / span };
}

function edgeSeries(live: LiveAuction[], readings: HourReading[]): Series[] {
  const bidded = live.filter((a) => a.currentBid != null);
  const bids = bidded.reduce((s, a) => s + (a.currentBid ?? 0), 0);
  const withN = readings.filter((r) => r.n != null && (r.n as number) > 0);
  const out: Series[] = [
    { key: 'bids', what: 'Current bids', set: 'all live BaT auctions', value: bids, readings: readings.map((r) => ({ day: r.day, v: r.bids })), fmt: bidNumber },
    { key: 'n', what: 'Auctions with a bid', set: 'all live BaT auctions', value: bidded.length, readings: withN.map((r) => ({ day: r.day, v: r.n as number })), fmt: count },
  ];
  if (bidded.length > 0) {
    out.push({ key: 'per', what: 'Current bid per auction', set: 'all live BaT auctions with a bid', value: bids / bidded.length, readings: withN.map((r) => ({ day: r.day, v: r.bids / (r.n as number) })), fmt: (v) => bidNumber(v) });
  }
  const byMake = readings.filter((r) => r.byMake != null);
  if (byMake.length >= EDGE_MIN_READINGS) {
    const now = new Map<string, [number, number]>();
    for (const a of bidded) {
      const m = now.get(a.make) ?? [0, 0];
      now.set(a.make, [m[0] + (a.currentBid ?? 0), m[1] + 1]);
    }
    const makes = new Set([...now.keys(), ...byMake.flatMap((r) => Object.keys(r.byMake as object))]);
    for (const make of makes) {
      if (make === NO_MAKE) continue;
      const past = byMake.map((r) => ({ day: r.day, bm: (r.byMake as Record<string, [number, number]>)[make] ?? [0, 0] }));
      const cur = now.get(make) ?? [0, 0];
      if (Math.max(cur[1], ...past.map((p) => p.bm[1])) < MAKE_MIN_AUCTIONS) continue;
      out.push({ key: `bids:${make}`, what: `${make} · current bids`, set: `live BaT auctions of ${make}`, value: cur[0], readings: past.map((p) => ({ day: p.day, v: Number(p.bm[0]) })), fmt: bidNumber });
      out.push({ key: `n:${make}`, what: `${make} · auctions with a bid`, set: `live BaT auctions of ${make}`, value: cur[1], readings: past.map((p) => ({ day: p.day, v: Number(p.bm[1]) })), fmt: count });
    }
  }
  return out;
}

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function EdgeStrips({ series, hourUtc, weekdayUtc, archiveDays }: { series: Series[]; hourUtc: string; weekdayUtc: string; archiveDays: Set<string> }) {
  const edges = useMemo(
    () => series.map(edgeOf).filter((e): e is Edge => e != null).sort((a, b) => a.depth - b.depth || b.beyond - a.beyond).slice(0, EDGE_MAX),
    [series]
  );
  if (series.length === 0) return null;
  const scanned = `${series.length} series scanned, each against its own readings at ${hourUtc}:00 UTC on earlier ${weekdayUtc}s`;
  return (
    <section style={{ border: '2px solid var(--border)', marginBottom: 12 }}>
      <div style={{ ...label, padding: '6px 8px', borderBottom: edges.length ? '2px solid var(--border)' : 'none' }}>
        {edges.length ? `Top or bottom 2 of its own history now · ${edges.length} of ${scanned}` : `None in the top or bottom 2 of its own history now · ${scanned}`}
      </div>
      {edges.map((e, i) => {
        const weeks = Math.round((Date.now() - Date.parse(`${e.readings[0].day}T00:00:00Z`)) / (7 * DAY));
        const rebuilt = e.readings.filter((r) => archiveDays.has(r.day)).length;
        return (
          <div key={e.key} style={{ padding: '8px', borderTop: i ? '2px solid var(--border)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{e.what}</span>
              <span style={{ ...mono, fontSize: 13, fontWeight: 700 }}>{e.fmt(e.value)}</span>
              <span style={{ ...label, fontWeight: 400 }}>now</span>
            </div>
            <RangeBar value={e.value} readings={e.readings} fmt={e.fmt} weekdayUtc={weekdayUtc} weeks={weeks} />
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4 }}>
              Window: {hourUtc}:00 UTC on {weekdayUtc}s, {shortDay(e.readings[0].day)} to {shortDay(e.readings[e.readings.length - 1].day)}, and now.
              {' '}Count: {e.readings.length} readings.
              {' '}Set: {e.set} (BAT-LIVE-BIDS index, read hourly from the live board{rebuilt ? `; ${rebuilt} of the readings rebuilt from BaT bid history, 96% of auctions` : ''}).
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ---- Hot / cold ----------------------------------------------------------------------------------
// heat = current bid / (band middle x the share of the final price comparable cars are usually bid to with
// this much time left). The band is the lot's expected-price range from comparable BaT sales on its model
// page, weighted toward its own version (scripts/market/live-bands.mjs, model version 31); the curve is
// measured on 36,700 sales (migration 20260927230000). Past 120 h the curve rests on thin, early data, so no verdict.
interface Heat { ratio: number; state: 'hot' | 'cold' | 'in line'; typicalNow: number; share: number; hoursLeft: number }
const HEAT_MAX_H = 120;
const HOT = 1.25;
const COLD = 0.8;

function curveAt(curve: BidCurve, tier: string, hours: number): number | null {
  const pts = curve[tier];
  if (!pts || pts.length === 0) return null;
  const h = Math.max(pts[pts.length - 1][0], Math.min(pts[0][0], hours));
  for (let i = 0; i < pts.length - 1; i++) {
    const [h1, v1] = pts[i];
    const [h2, v2] = pts[i + 1];
    if (h <= h1 && h >= h2) return v1 + ((v2 - v1) * (h1 - h)) / (h1 - h2);
  }
  return pts[pts.length - 1][1];
}

function heatOf(a: LiveAuction, curve: BidCurve | null, now: number): Heat | null {
  if (!curve || !a.band || !a.currentBid || a.currentBid <= 0) return null;
  const hoursLeft = (a.endsAt - now) / HOUR;
  if (hoursLeft <= 0 || hoursLeft > HEAT_MAX_H) return null;
  const share = curveAt(curve, a.band.tier, hoursLeft);
  if (!share) return null;
  const typicalNow = a.band.p50 * share;
  const ratio = a.currentBid / typicalNow;
  return { ratio, state: ratio >= HOT ? 'hot' : ratio <= COLD ? 'cold' : 'in line', typicalNow, share, hoursLeft };
}

// Backtest, 10,065 cars sold 2026-06-27..09-26, each priced only from sales before it: of the cars tagged hot at
// this much time left, the share that finished above the middle of their comparable sales; of those tagged cold,
// the share that finished below it. (In line: 46-49% above, i.e. no signal.)
const BACKTEST: [number, string, number, number][] = [
  [120, '5 days', 0.784, 0.781], [96, '4 days', 0.808, 0.797], [72, '3 days', 0.833, 0.809],
  [48, '2 days', 0.855, 0.829], [24, 'a day', 0.884, 0.85], [12, '12 hours', 0.915, 0.876],
];

// Three significant figures: "about $166,000", not "$166,323".
function about(n: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(n, 1))) - 2);
  return Math.round(n / step) * step;
}

// Past 3x the multiple mostly says the comps don't describe the car (backtest: 77% of those sold above 90% of their
// comps), so it is shown as 3x+ rather than as a precise number.
function multiple(ratio: number): string {
  return ratio >= 3 ? '3×+' : ratio < 0.1 ? '<0.1×' : `${ratio.toFixed(1)}×`;
}

function heatParts(a: LiveAuction, heat: Heat) {
  const band = a.band as NonNullable<LiveAuction['band']>;
  // Quote the checkpoint at or before this point in the auction (17 h left reads the 24 h record, not the 12 h one).
  const [, when, hotAbove, coldBelow] = [...BACKTEST].reverse().find((row) => row[0] >= heat.hoursLeft) ?? BACKTEST[BACKTEST.length - 1];
  return {
    bid: bidNumber(a.currentBid),
    left: left(heat.hoursLeft * HOUR),
    comps: band.comps,
    middle: bidNumber(band.p50),
    range: `${bidNumber(band.p10)}–${bidNumber(band.p90)}`,
    share: Math.round(heat.share * 100),
    typical: bidNumber(about(heat.typicalNow)),
    multiple: multiple(heat.ratio),
    beyond: (a.currentBid ?? 0) > band.p90
      ? 'The bid already tops 90% of those sales: this car is bringing more than its model page usually does (a rarer version, very low miles, or prices that have risen since), so the multiple says "beyond its comps", not how far.'
      : null,
    outcome: heat.state === 'hot'
      ? `Of sold cars running this hot ${when} out, ${Math.round(hotAbove * 100)}% finished above the middle of their comparable sales.`
      : heat.state === 'cold'
        ? `Of sold cars running this cold ${when} out, ${Math.round(coldBelow * 100)}% finished below the middle of their comparable sales.`
        : null,
  };
}

function explainHeat(a: LiveAuction, heat: Heat): string {
  const x = heatParts(a, heat);
  return `Bid ${x.bid} with ${x.left} left. ${x.comps} comparable BaT sales (same model page, weighted toward the same version, year, mileage and gearbox) put the middle at ${x.middle}, 80% range ${x.range}. With this much time left, cars at this price are usually bid to about ${x.share}% of their final, so a typical bid now is about ${x.typical}; this one is at ${x.multiple} that.${x.beyond ? ` ${x.beyond}` : ''}${x.outcome ? ` ${x.outcome}` : ''}`;
}

// A phone has no hover, so a tag is also a button: tapping it opens the reasoning (ExplainSheet). The title
// attribute stays for mouse users. Tags sit inside row links, so the tap must not open the car.
const ExplainContext = createContext<((a: LiveAuction, heat: Heat) => void) | null>(null);

// The tag carries its why: the measure, where in the auction it was taken, and the comparison set's size.
function heatWhy(a: LiveAuction, heat: Heat): string {
  return `${heat.state === 'hot' ? 'Hot' : 'Cold'} · bid ${multiple(heat.ratio)} typical at ${out(heat.hoursLeft)} · ${a.band?.comps ?? 0} comps`;
}

function HeatTag({ a, heat, style }: { a: LiveAuction; heat: Heat | null | undefined; style?: React.CSSProperties }) {
  const explain = useContext(ExplainContext);
  if (!heat || heat.state === 'in line') return null;
  const hot = heat.state === 'hot';
  const text = heatWhy(a, heat);
  const open = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    explain?.(a, heat);
  };
  return (
    <span
      title={explainHeat(a, heat)}
      role={explain ? 'button' : undefined}
      tabIndex={explain ? 0 : undefined}
      aria-label={explain ? `${text}: why` : undefined}
      onClick={explain ? open : undefined}
      onKeyDown={explain ? (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); } : undefined}
      style={{ ...label, color: 'var(--bg)', background: hot ? 'var(--success)' : 'var(--error)', padding: '1px 4px', minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: explain ? 'pointer' : undefined, ...style }}
    >
      {text}
    </span>
  );
}

// The reasoning behind one tag, opened by tapping it: bottom sheet on a phone, a panel bottom-right on desktop.
function ExplainSheet({ item, onClose, narrow }: { item: { a: LiveAuction; heat: Heat } | null; onClose: () => void; narrow: boolean }) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);
  if (!item) return null;
  const { a, heat } = item;
  const x = heatParts(a, heat);
  const hot = heat.state === 'hot';
  const rows: [string, string][] = [
    ['Current bid', `${x.bid} · ${x.left} left`],
    ['Comparable sales', `${x.comps} on its BaT model page, weighted toward the same version, year, mileage and gearbox`],
    ['Their middle', `${x.middle} (80% range ${x.range})`],
    ['Typical bid now', `about ${x.typical}: with this much time left, cars at this price are usually bid to about ${x.share}% of their final`],
    ['This bid', `${x.multiple} typical`],
  ];
  return (
    <div
      role="dialog"
      aria-label={`Why ${title(a)} is running ${heat.state}`}
      style={{
        position: 'fixed', zIndex: 2000, bottom: narrow ? 0 : 16, left: narrow ? 0 : 'auto', right: narrow ? 0 : 16,
        width: narrow ? 'auto' : 440, maxHeight: '70vh', overflowY: 'auto', boxSizing: 'border-box',
        background: 'var(--surface)', color: 'var(--text)', border: '2px solid var(--text)', padding: 12, fontSize: 12, fontFamily: 'Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{title(a)}</div>
          <span style={{ ...label, color: 'var(--bg)', background: hot ? 'var(--success)' : 'var(--error)', padding: '1px 4px' }}>
            {hot ? 'Running hot' : 'Running cold'} · {x.multiple}
          </span>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ ...label, color: 'var(--text)', background: 'transparent', border: '2px solid var(--text)', padding: '2px 8px', cursor: 'pointer' }}>
          Close
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 6 }}>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <span style={{ ...label, paddingTop: 1 }}>{k}</span>
            <span>{v}</span>
          </React.Fragment>
        ))}
      </div>
      {x.beyond && <p style={{ margin: '10px 0 0' }}>{x.beyond}</p>}
      {x.outcome && <p style={{ margin: '10px 0 0' }}><span style={label}>Track record</span> {x.outcome}</p>}
      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <Link to={`/vehicle/${a.id}`} style={{ ...label, color: 'var(--text)' }}>Open the car</Link>
        {a.listingUrl && (
          <a href={a.listingUrl} target="_blank" rel="noopener noreferrer" style={{ ...label, color: 'var(--text-secondary)' }}>BaT listing ↗</a>
        )}
      </div>
    </div>
  );
}

// A make's color is the median heat of its priced live lots (3 or more); grey when unpriced or in line.
function heatTone(median: number | null): { bg: string; fg: string } | null {
  if (median == null) return null;
  if (median >= 1.3) return { bg: 'var(--success)', fg: 'var(--bg)' };
  if (median >= 1.1) return { bg: 'var(--success-dim)', fg: 'var(--text)' };
  if (median <= 0.77) return { bg: 'var(--error)', fg: 'var(--bg)' };
  if (median <= 0.9) return { bg: 'var(--error-dim)', fg: 'var(--text)' };
  return null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface MakeNode {
  make: string;
  count: number;
}

function MarketMap({ auctions, selected, onSelect }: { auctions: LiveAuction[]; selected: string | null; onSelect: (make: string | null) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = width < 640 ? 240 : 380;
  const makes = useMemo(() => {
    const by = new Map<string, MakeNode>();
    for (const a of auctions) {
      const n = by.get(a.make) ?? { make: a.make, count: 0 };
      n.count += 1;
      by.set(a.make, n);
    }
    return [...by.values()];
  }, [auctions]);
  const rects = useMemo(
    () => (width > 0 ? squarify(makes.filter((m) => m.count > 0).map((m) => ({ node: m, area: m.count })), 0, 0, width, height) : []),
    [makes, width, height]
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = makes.find((m) => m.make === (hovered ?? selected));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, minHeight: 12 }}>
        <span style={{ ...label, color: shown ? 'var(--text)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shown
            ? `${shown.make} · ${shown.count} captured live lots`
            : 'Live lots by make · area = captured lot count · hover or tap a make'}
        </span>
        {selected && (
          <button onClick={() => onSelect(null)} style={{ ...label, color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            {selected} ✕
          </button>
        )}
      </div>
    <div ref={ref} style={{ position: 'relative', height, background: 'var(--border)' }} onMouseLeave={() => setHovered(null)}>
      {rects.map(({ node, x, y, w, h }) => {
        const active = selected === node.make;
        const dim = selected != null && !active;
        const roomy = w > 64 && h > 34;
        return (
          <button
            key={node.make}
            onClick={() => onSelect(active ? null : node.make)}
            onMouseEnter={() => setHovered(node.make)}
            onFocus={() => setHovered(node.make)}
            aria-pressed={active}
            aria-label={`${node.make}: ${node.count} captured live lots`}
            style={{
              position: 'absolute',
              left: x + 1,
              top: y + 1,
              width: Math.max(0, w - 2),
              height: Math.max(0, h - 2),
              padding: roomy ? '5px 6px' : 0,
              border: 'none',
              background: active ? 'var(--text)' : 'var(--surface)',
              color: active ? 'var(--bg)' : 'var(--text)',
              opacity: dim ? 0.45 : 1,
              cursor: 'pointer',
              textAlign: 'left',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {roomy && (
              <>
                <span style={{ ...label, color: 'inherit', fontSize: w > 140 ? 10 : 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                  {node.make}
                </span>
                <span style={{ ...mono, fontSize: w > 140 ? 13 : 10, whiteSpace: 'nowrap' }}>
                  {node.count} <span style={{ opacity: 0.7 }}>live lots</span>
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
    </div>
  );
}

function Thumb({ src, size }: { src: string | null; size: number }) {
  const h = Math.round(size * 0.67);
  if (!src) return <div style={{ width: size, height: h, background: 'var(--surface)', flexShrink: 0 }} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={h}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: h, objectFit: 'cover', flexShrink: 0, background: 'var(--surface)' }}
    />
  );
}

// This is a row-write-age warning only. vehicles.updated_at can change for any
// writer; it cannot verify source freshness or tell when a bid happened.
const STALE_MS = 45 * 60_000;

function BidCell({ auction, risen, stale }: { auction: LiveAuction; risen: boolean; stale: boolean }) {
  return (
    <span
      title={`Recorded current bid. Vehicle record updated ${clock(auction.updatedAt)} by a writer; source read time is unavailable.${stale ? ' Recent record writes are behind.' : ''}`}
      style={{
        ...mono,
        fontWeight: 700,
        padding: '1px 3px',
        background: risen ? 'var(--success)' : 'transparent',
        color: risen ? 'var(--bg)' : stale ? 'var(--text-disabled)' : 'var(--text)',
        transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {bidNumber(auction.currentBid)}
    </span>
  );
}

// ---- Movement -----------------------------------------------------------------------------------
// Captured interactions on the current listing, qualified by the reader's as-of, bounds and source clock.
// Bid-step weight compares only the observed increments in view; no assumed listing-duration rate is shown.

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const KIND: Record<MovementItem['kind'], string> = { bid: 'Bid', comment: 'Comment', question: 'Question', seller: 'Seller' };

// Weight as a bar: 1x the observed median step fills a quarter; 4x or more fills it.
function WeightBar({ w, title: t }: { w: number; title: string }) {
  return (
    <span title={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span style={{ position: 'relative', width: 32, height: 6, background: 'var(--border)' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(1, w / 4) * 100}%`, background: w >= 1.5 ? 'var(--success)' : 'var(--text-secondary)' }} />
      </span>
      <span style={{ ...mono, fontWeight: w >= 1.5 ? 700 : 400 }}>{w.toFixed(1)}×</span>
    </span>
  );
}

const MOVEMENT_ITEMS = 3;

function Movement({ m, receipt, readAsOf, rowCap }: {
  m: LotMovement | undefined; receipt: ActivityReceipt['lots'][number] | undefined;
  readAsOf: string | undefined; rowCap: number | undefined;
}) {
  const now = useSecondClock();
  if (!m && !receipt) return null;
  const items = (m?.items ?? []).slice(0, MOVEMENT_ITEMS);
  const asOf = readAsOf ? Date.parse(readAsOf) : m?.readAsOf;
  const sourceAt = receipt ? Date.parse(receipt.source_read_at ?? '') : m?.sourceReadAt;
  const sourceBasis = receipt?.source_read_basis ?? m?.sourceReadBasis ?? 'unknown';
  const knownSource = sourceBasis !== 'unknown' && sourceAt != null && Number.isFinite(sourceAt);
  const captured = receipt?.activity_rows ?? m?.items.length ?? 0;
  const truncated = receipt?.has_more ?? m?.lastHourFloor ?? false;
  return (
    <div aria-label="Captured lot activity" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, fontSize: 10, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
      <div style={{ fontSize: 9, lineHeight: 1.4 }}>
        Captured activity as of {asOf != null && Number.isFinite(asOf)
          ? <time dateTime={new Date(asOf).toISOString()}>{clock(asOf)}</time> : 'unknown time'}.
        {' '}{knownSource
          ? <span>Source read <time dateTime={new Date(sourceAt!).toISOString()}>{ago(now - sourceAt!)}</time> · {sourceBasis === 'cached_snapshot' ? 'Cached snapshot' : 'Direct fetch'}.</span>
          : <span>Source read time unknown.</span>}
      </div>
      <div style={{ fontSize: 9, lineHeight: 1.4 }}>
        Showing {items.length} of {captured} captured interactions{rowCap != null ? ` · read limit ${rowCap}` : ''}.
        {truncated && ' Window truncated; earlier interactions are omitted.'}
      </div>
      {items.map((it, i) => (
        <div key={`${it.at}-${i}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '0 6px', alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap' }}>
          <span style={{ ...label, fontSize: 8, width: 52, flexShrink: 0, color: it.kind === 'bid' ? 'var(--text)' : 'var(--text-secondary)' }}>{KIND[it.kind]}</span>
          {it.amount != null && <span style={{ ...mono, color: 'var(--text)' }}>{bidNumber(it.amount, true)}</span>}
          {it.step != null && <span style={mono}>+{bidNumber(it.step, true)}</span>}
          {it.weight != null && m?.medianStep != null && (
            <WeightBar w={it.weight} title={`A +${bidNumber(it.step)} step against a median step of ${bidNumber(m.medianStep)} over this lot's ${m.steps} bid steps in view`} />
          )}
          <span style={{ ...mono, marginLeft: 'auto', flexShrink: 0 }}>{ago(now - it.at)}</span>
        </div>
      ))}
      {m != null && m.lastHour > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 6px', alignItems: 'center', whiteSpace: 'nowrap' }}>
          <span style={{ ...label, fontSize: 8, flexShrink: 0 }}>Captured hour before read</span>
          <span style={mono}>{m.lastHourFloor ? '≥' : ''}{m.lastHour} posted</span>
        </div>
      )}
    </div>
  );
}

function EndingNext({ auctions, risenIds, stale, heat }: { auctions: LiveAuction[]; risenIds: Set<string>; stale: boolean; heat: Map<string, Heat | null> }) {
  const next = auctions.slice(0, 8);
  const key = next.map((a) => a.id).join(',');
  const ids = useMemo(() => (key ? key.split(',') : []), [key]);
  const { data: rows, dataUpdatedAt, coverage } = useLotMovement(ids);
  const movement = useMemo(
    () => (rows ? weigh(rows, new Map(next.map((a) => [a.id, a.endsAt])), dataUpdatedAt || Date.now()) : null),
    [rows, dataUpdatedAt] // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (next.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {next.map((a) => (
        <Link
          key={a.id}
          to={`/vehicle/${a.id}`}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 8px', borderBottom: '2px solid var(--border)', textDecoration: 'none', color: 'var(--text)' }}
        >
          <Thumb src={a.imageUrl} size={54} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title(a)}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11, marginTop: 2 }}>
              <BidCell auction={a} risen={risenIds.has(a.id)} stale={stale} />
              <Countdown endsAt={a.endsAt} strong />
            </div>
            {heat.get(a.id) && heat.get(a.id)?.state !== 'in line' && (
              <div style={{ display: 'flex', marginTop: 3 }}><HeatTag a={a} heat={heat.get(a.id)} /></div>
            )}
            <Movement m={movement?.get(a.id)} receipt={coverage?.lots.find(l => l.vehicle_id === a.id)} readAsOf={coverage?.as_of} rowCap={coverage?.per_lot_limit} />
          </div>
        </Link>
      ))}
    </div>
  );
}

// Fixed row heights so the board can render only the rows on screen.
const ROW_H = 52;
const ROW_H_NARROW = 50;

function BoardRow({ a, risen, narrow, stale, heat }: { a: LiveAuction; risen: boolean; narrow: boolean; stale: boolean; heat: Heat | null | undefined }) {
  const nr = a.noReserve && <span style={{ ...label, color: 'var(--text)', border: '2px solid var(--text)', padding: '0 3px', flexShrink: 0 }}>NR</span>;
  const tagged = (heat != null && heat.state !== 'in line') || a.noReserve;
  const name = <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title(a)}</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: narrow ? 8 : 10, padding: '0 8px', height: narrow ? ROW_H_NARROW : ROW_H, boxSizing: 'border-box', borderBottom: '2px solid var(--border)', fontSize: 11 }}>
      <div style={{ width: narrow ? 74 : 84, flexShrink: 0 }}>
        <Countdown endsAt={a.endsAt} />
      </div>
      <Link to={`/vehicle/${a.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textDecoration: 'none', color: 'var(--text)' }}>
        <Thumb src={a.imageUrl} size={narrow ? 40 : 60} />
        {narrow ? (
          // A phone has no room for tags beside the title: they go under it.
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            {name}
            {tagged && <span style={{ display: 'flex', gap: 4, minWidth: 0 }}><HeatTag a={a} heat={heat} />{nr}</span>}
          </span>
        ) : name}
      </Link>
      {!narrow && <HeatTag a={a} heat={heat} style={{ flexShrink: 0 }} />}
      {!narrow && nr}
      <div style={{ width: narrow ? 76 : 104, textAlign: 'right', flexShrink: 0 }}>
        <BidCell auction={a} risen={risen} stale={stale} />
      </div>
      {a.listingUrl && (
        <a
          href={a.listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="The listing on Bring a Trailer"
          style={{ ...label, color: 'var(--text-secondary)', textDecoration: 'none', flexShrink: 0 }}
        >
          BAT ↗
        </a>
      )}
    </div>
  );
}

// Every row stays reachable by scrolling; only the ones near the viewport are in the DOM.
function Board({ rows, risenIds, narrow, stale, heat }: { rows: LiveAuction[]; risenIds: Set<string>; narrow: boolean; stale: boolean; heat: Map<string, Heat | null> }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (listRef.current) setOffset(listRef.current.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const rowH = narrow ? ROW_H_NARROW : ROW_H;
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => rowH, overscan: 12, scrollMargin: offset });
  return (
    <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
      {v.getVirtualItems().map((item) => {
        const a = rows[item.index];
        return (
          <div key={a.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - offset}px)` }}>
            <BoardRow a={a} risen={risenIds.has(a.id)} narrow={narrow} stale={stale} heat={heat.get(a.id)} />
          </div>
        );
      })}
    </div>
  );
}

function inWindow(a: LiveAuction, w: Window, now: number, heat?: Heat | null): boolean {
  switch (w) {
    case 'hot': return heat?.state === 'hot';
    case 'cold': return heat?.state === 'cold';
    case '1h': return a.endsAt - now < HOUR;
    case '24h': return a.endsAt - now < DAY;
    case 'new': return now - a.listedAt < DAY;
    case 'nr': return a.noReserve;
    default: return true;
  }
}

export default function MarketPulse({ onUnavailable }: { onUnavailable?: React.ReactNode }) {
  usePageTitle('Market');
  const { data, isLoading, isError, risenIds, refetch, dataUpdatedAt } = useMarketPulse();
  const [params, setParams] = useSearchParams();
  const [boardRef, boardWidth] = useWidth<HTMLDivElement>();
  const narrow = boardWidth > 0 && boardWidth < 640;
  const [explaining, setExplaining] = useState<{ a: LiveAuction; heat: Heat } | null>(null);
  const openExplain = useCallback((a: LiveAuction, heat: Heat) => setExplaining({ a, heat }), []);
  const closeExplain = useCallback(() => setExplaining(null), []);

  const make = params.get('make')?.toUpperCase() ?? null;
  const win = (WINDOWS.some((w) => w.id === params.get('live')) ? params.get('live') : 'all') as Window;
  const sort = (SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'ending') as Sort;
  const selectedBid = BID_BUCKETS.find(b => b.id === params.get('bidRange'))?.id ?? null;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key);
    else next.set(key, value);
    if (key === 'live' || (key === 'make' && value != null) || key === 'bidRange') next.set('board', '1');
    if (key === 'live' || key === 'make') next.delete('bidRange');
    setParams(next, { replace: true });
    if (key === 'live' || key === 'bidRange') window.requestAnimationFrame(() => {
      boardRef.current?.scrollIntoView?.({ block: 'start' });
      boardRef.current?.focus({ preventScroll: true });
    });
  };

  // Figures and filters are evaluated against the clock once a minute; the countdowns tick on their own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const live = useMemo(() => (data?.auctions ?? []).filter((a) => a.endsAt > now), [data, now]);
  const cohort = useMemo(() => live.filter(a => make == null || a.make === make), [live, make]);
  // The board has no bound currency contract. Monetary heat is withheld until units can be matched.
  const heat = useMemo(() => new Map<string, Heat | null>(live.map((a) => [a.id, null])), [live]);

  const figures = useMemo(() => {
    const f: Record<Window, number> = { all: 0, '1h': 0, '24h': 0, new: 0, nr: 0, hot: 0, cold: 0 };
    for (const a of cohort) for (const w of WINDOWS) if (inWindow(a, w.id, now, heat.get(a.id))) f[w.id] += 1;
    return f;
  }, [cohort, now, heat]);
  const recordedBids = useMemo(() => currentBidDistribution(cohort).recorded, [cohort]);
  const syncBehind = data?.syncedAt != null && now - data.syncedAt > STALE_MS;

  const scoped = useMemo(() => cohort.filter(a => inWindow(a, win, now, heat.get(a.id))), [cohort, win, now, heat]);
  const distribution = useMemo(() => currentBidDistribution(scoped), [scoped]);

  const board = useMemo(() => {
    const rows = scoped.filter(a => selectedBid == null || bidBucket(a.currentBid) === selectedBid);
    const ratio = (a: LiveAuction) => heat.get(a.id)?.ratio ?? null;
    if (sort === 'bid') rows.sort((a, b) => (b.currentBid ?? 0) - (a.currentBid ?? 0));
    else if (sort === 'newest') rows.sort((a, b) => b.listedAt - a.listedAt);
    else if (sort === 'hottest') rows.sort((a, b) => (ratio(b) ?? -1) - (ratio(a) ?? -1));
    else if (sort === 'coldest') rows.sort((a, b) => (ratio(a) ?? Infinity) - (ratio(b) ?? Infinity));
    else rows.sort((a, b) => a.endsAt - b.endsAt);
    return rows;
  }, [scoped, selectedBid, sort, heat]);

  if (!data && isError) return <>
    <RecordedSalesComparison key={make ?? 'all'} make={make} />
    <div role="status" style={{ padding: 12 }}>Live BaT bids could not be loaded. <button onClick={() => refetch()}>Retry live board</button></div>
    {onUnavailable}
  </>;

  return (
    <ExplainContext.Provider value={openExplain}>
    <div style={{ fontFamily: 'Arial, sans-serif', color: 'var(--text)', background: 'var(--bg)', padding: '12px 12px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.14em' }}>MARKET</span>
          <span style={label}>Live lots · Bring a Trailer{make ? ` · ${make}` : ''}</span>
        </div>
        {data?.syncedAt != null && (
          <span style={label} title={data.source}>
            Latest record write {clock(data.syncedAt)}{syncBehind ? ' · over 45 min ago' : ''}
          </span>
        )}
      </div>

      {isError && data && <div role="status">Refresh failed. Showing the last fetched board. <button onClick={() => refetch()}>Retry</button></div>}

      <RecordedSalesComparison key={make ?? 'all'} make={make} />

      <label style={{ ...label, display: 'block', marginBottom: 8 }}>
        Make{' '}
        <select aria-label="Live lot make" value={make ?? ''} onChange={e => setParam('make', e.target.value || null)} style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, color: 'var(--text)', background: 'var(--bg)', border: '2px solid var(--border)', padding: 4 }}>
          <option value="">All makes</option>
          {[...new Set([...live.map(a => a.make), ...(make ? [make] : [])])].sort().map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      {/* Figures. Each one is a filter on the board below. */}
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)', border: '2px solid var(--border)', background: 'var(--border)', gap: 2, marginBottom: 12 }}>
        <Figure caption="Lots with bid data" value={isLoading ? '…' : recordedBids.toLocaleString('en-US')} active={false} onClick={() => setParam('live', null)} hint="Lots with a recorded bid number; units are unverified, so bids are not summed" compact={narrow} />
        {WINDOWS.map((w) => (
          <Figure
            key={w.id}
            caption={w.label}
            hint={w.id === 'new' ? 'First seen by Nuke in the last 24 h; the live page is read every 15 min'
              : w.id === 'hot' ? `Bid at least ${HOT}x where comparable sales usually are at this point in the auction (within 5 days of the close)`
              : w.id === 'cold' ? `Bid at most ${COLD}x where comparable sales usually are at this point in the auction (within 5 days of the close)`
              : undefined}
            value={isLoading ? '…' : figures[w.id].toLocaleString('en-US')}
            active={win === w.id && w.id !== 'all'}
            onClick={() => setParam('live', w.id === 'all' || win === w.id ? null : w.id)}
            compact={narrow}
          />
        ))}
      </div>

      {!isLoading && <BidDistribution distribution={distribution} lots={scoped.length} scope={`${make ?? 'All makes'} · ${WINDOWS.find(w => w.id === win)?.label}`} selected={selectedBid} onSelect={b => setParam('bidRange', selectedBid === b ? null : b)} fetchedAt={dataUpdatedAt} />}


      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 3fr) minmax(260px, 1fr)', gap: 12, marginBottom: 12 }}>
        <section style={{ minWidth: 0 }}>
          <MarketMap auctions={live} selected={make} onSelect={(m) => setParam('make', m)} />
        </section>
        {board.length > 0 && <section style={{ border: '2px solid var(--border)', alignSelf: 'start', minWidth: 0 }}>
          <div style={{ ...label, padding: '6px 8px', borderBottom: '2px solid var(--border)' }}>Ending next</div>
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', padding: '4px 8px', borderBottom: '2px solid var(--border)' }}>
            Captured bids and comments on each current listing. × compares a bid increment with the median increment in view. Source clock and capture limits appear per lot; this sample does not establish the listing's complete activity.
          </div>
          <EndingNext auctions={[...board].sort((a, b) => a.endsAt - b.endsAt)} risenIds={risenIds} stale={syncBehind} heat={heat} />
        </section>}
      </div>

      <div ref={boardRef} tabIndex={-1} aria-label="Supporting live lots">
      <section style={{ border: '2px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '6px 8px', borderBottom: '2px solid var(--border)' }}>
          <span style={label}>
            {board.length.toLocaleString('en-US')} lots · source bid units unverified
            {make ? ` · ${make}` : ''}
            {win !== 'all' ? ` · ${WINDOWS.find((w) => w.id === win)?.label}` : ''}
            {selectedBid ? ` · ${BID_BUCKETS.find(b => b.id === selectedBid)?.label}` : ''}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setParam('sort', s.id === 'ending' ? null : s.id)}
                aria-pressed={sort === s.id}
                style={{
                  ...label,
                  color: sort === s.id ? 'var(--bg)' : 'var(--text)',
                  background: sort === s.id ? 'var(--text)' : 'transparent',
                  border: '2px solid var(--text)',
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {!isLoading && board.length === 0 && <div role="status" style={{ padding: 12 }}>No open lots match these filters. <button onClick={() => {
          const next = new URLSearchParams(params);
          ['make', 'live', 'bidRange'].forEach(k => next.delete(k));
          setParams(next, { replace: true });
        }}>Clear market filters</button></div>}
        {isLoading ? null : <Board rows={board} risenIds={risenIds} narrow={narrow} stale={syncBehind} heat={heat} />}
      </section>
      </div>

      {data?.source && (
        <div style={{ ...label, marginTop: 8 }}>
          Source: {data.source}. Current bid is a recorded listing number; its unit and freshness need source evidence. Monetary totals, medians and hot/cold comparisons are withheld until currencies can be matched.
        </div>
      )}
      <ExplainSheet item={explaining} onClose={closeExplain} narrow={narrow} />
    </div>
    </ExplainContext.Provider>
  );
}

function BidDistribution({ distribution, lots, scope, selected, onSelect, fetchedAt }: {
  distribution: ReturnType<typeof currentBidDistribution>; lots: number; scope: string;
  selected: BidBucket | null; onSelect: (b: BidBucket) => void; fetchedAt: number;
}) {
  return (
    <section aria-label="Current bid distribution" style={{ border: '2px solid var(--border)', padding: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', marginBottom: 6 }}>
        <span style={{ ...label, color: 'var(--text)' }}>{scope}</span>
        <span style={{ fontSize: 12 }}>
          {distribution.recorded.toLocaleString('en-US')} of {lots.toLocaleString('en-US')} lots have a recorded bid number
        </span>
      </div>
      {lots === 0 && <div role="status" style={{ fontSize: 12 }}>No open lots in this scope.</div>}
      <div style={{ display: 'grid', gap: 2 }}>
        {BID_BUCKETS.map(b => {
          const n = distribution.counts[b.id];
          const pct = lots > 0 ? n / lots * 100 : 0;
          return (
            <button key={b.id} disabled={n === 0 && selected !== b.id} aria-pressed={selected === b.id}
              aria-label={`${b.label}: ${n} of ${lots} lots. Show supporting lots`}
              onClick={() => onSelect(b.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, padding: '2px 4px', border: '2px solid transparent', textAlign: 'left', fontFamily: 'Arial, sans-serif', fontSize: 11,
                color: selected === b.id ? 'var(--bg)' : 'var(--text)', background: selected === b.id ? 'var(--text)' : 'var(--bg)', cursor: n > 0 || selected === b.id ? 'pointer' : 'default' }}>
              <span style={{ width: 100, flexShrink: 0 }}>{b.label}</span>
              <span aria-hidden="true" style={{ flex: 1, height: 8, background: 'var(--surface)' }}>
                <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: selected === b.id ? 'var(--bg)' : 'var(--text-secondary)' }} />
              </span>
              <span style={{ ...mono, width: 76, textAlign: 'right', flexShrink: 0 }}>{n} · {pct.toFixed(1)}%</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
        Recorded bid numbers · source currency unknown · ranges group raw numbers, not comparable monetary values. Choose a range to see its lots.
      </div>
      <details style={{ fontSize: 11, marginTop: 6 }}>
        <summary style={{ cursor: 'pointer' }}>Scope, source and timing</summary>
        <p style={{ margin: '6px 0' }}>One public, undeleted vehicle record marked live on Bring a Trailer with a recorded end in the future. Make and auction-window filters define this distribution; selecting a bid range narrows the supporting list. Each bar counts lots, including unrecorded bids in the denominator. A recorded zero stays zero.</p>
        <p style={{ margin: '6px 0' }}>These are recorded listing numbers, not sold prices or a valuation. Their source currencies are unknown, so monetary aggregates and comparison tags are withheld. Condition, restoration and build class are not matched. Open a lot's Nuke record for evidence or its BaT link for the attributed listing.</p>
        <p style={{ margin: '6px 0' }}>Board fetched {clock(fetchedAt)}. Latest record write is a vehicle-row update by any writer. Source read time and bid event time are unavailable in the full board reader; the bounded Ending next panel exposes captured source clocks separately. BaT's board is scheduled to be read every 15 minutes; that schedule does not prove freshness.</p>
      </details>
    </section>
  );
}

function Figure({ caption, value, active, onClick, hint, compact }: { caption: string; value: string; active: boolean; onClick: () => void; hint?: string; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      style={{
        textAlign: 'left',
        padding: compact ? '6px 6px' : '8px 10px',
        border: 'none',
        background: active ? 'var(--text)' : 'var(--bg)',
        color: active ? 'var(--bg)' : 'var(--text)',
        cursor: 'pointer',
        transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ ...label, color: 'inherit', opacity: 0.8 }}>{caption}</div>
      <div style={{ ...mono, fontSize: compact ? 17 : 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </button>
  );
}
