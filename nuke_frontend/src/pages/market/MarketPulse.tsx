import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import { CoverageView, Masthead, Row, Rows, Text } from '../../kit';
import { timeLeft, useSecondClock } from '../../hooks/useSecondClock';
import MarketInventoryMap from './MarketInventoryMap';
import { mapLens, mapValue, matchesMapLens, recordedModel, taxonomyByListing, type InventoryMapLens, type InventoryMapGroup, type MapDimension } from './inventoryMap';
import AuctionEvidence, { AuctionCompetition } from './AuctionEvidence';
import { BID_BUCKETS, bidBucket, currentBidDistribution, NO_MAKE, useMarketPulse, useInventoryTaxonomy, useSameHourReadings, type BidBucket, type BidCurve, type HourReading, type LiveAuction } from './useMarketPulse';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import RecordedSalesComparison, { MarketScopeControls, type MarketSalesLens } from './RecordedSalesComparison';
import { MakeLogo } from '../../components/common/MakeIdentity';
import { selectRowFacts, useMarketRowDetails, useMarketRowSpecs, vehicleIdentity, type LotInspection, type MarketRowDetails } from './useMarketRowDetails';

// The homepage: the live collector-car market as Nuke sees it right now.
// Activity figures count the rows market_pulse_live() returns; rows open their
// canonical records. Monetary heat (hot/cold against comparable sales) and the
// same-hour history strips are withheld until the board's bid units are bound;
// their last implementation is in git history before this commit.

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
  { id: 'hot', label: 'Running hot' },
  { id: 'cold', label: 'Running cold' },
];

// Current auctions appear in close order unless the viewer chooses another sort.
const SORTS: { id: Sort; label: string }[] = [
  { id: 'bid', label: 'Highest bid' },
  { id: 'ending', label: 'Ending first' },
  { id: 'newest', label: 'First seen' },
  { id: 'hottest', label: 'Hottest' },
  { id: 'coldest', label: 'Coldest' },
];

// Bids are US dollars: Bring a Trailer runs every auction in USD and reports the bid as a dollar amount.
function bidNumber(n: number | null | undefined, compact = false): string {
  if (n == null) return '—';
  if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (compact && Math.abs(n) >= 10_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

const left = timeLeft;

// In the viewer's own time zone.
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function title(a: LiveAuction): string {
  return vehicleIdentity(a);
}

// Every countdown ticks by the second on the page's one shared clock (useSecondClock).
function Countdown({ endsAt, strong }: { endsAt: number; strong?: boolean }) {
  const now = useSecondClock();
  const remaining = endsAt - now;
  return (
    <Text role="measure" dense className={strong || remaining < HOUR ? 'market-countdown market-countdown--soon' : 'market-countdown'}>
      {remaining <= 0 ? 'Awaiting result' : left(remaining)}
    </Text>
  );
}

// ---- The building block (docs/schematics/homepage.md): one number placed in its own history ----------------
// Each earlier week at this weekday and hour is a tick; now is the block; the sentence ranks now among them,
// counted, never labelled. The page scans every series that has such a history and shows only those at an edge.

function pctChange(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}

function signed(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

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

function RangeBar({ value, readings, fmt, weekdayUtc, weeks }: { value: number; readings: { day: string; v: number }[]; fmt: (n: number, compact?: boolean) => string; weekdayUtc: string; weeks: number }) {
  const lo = Math.min(value, ...readings.map((r) => r.v));
  const hi = Math.max(value, ...readings.map((r) => r.v));
  const span = hi - lo;
  const x = (v: number) => (span > 0 ? (v - lo) / span : 0.5) * 160;
  const { n, text: rank } = rankOf(value, readings);
  return (
    <span className="market-range">
      <Text role="label">Same time on {weekdayUtc}s · {n === weeks ? `last ${weeks} weeks` : `${n} of the last ${weeks} weeks`}</Text>
      <Text role="measure" dense>{fmt(lo, true)}</Text>
      <svg className="market-range__bar" viewBox="0 0 160 12" width="160" height="12" aria-hidden="true">
        <rect className="market-range__track" x="0" y="5" width="160" height="2" />
        {readings.map((r) => <rect key={r.day} className="market-range__tick" x={x(r.v) - 1} y="2" width="2" height="8"><title>{`${r.day}: ${fmt(r.v)}`}</title></rect>)}
        <rect className="market-range__now" x={x(value) - 3} y="0" width="6" height="12"><title>{`Now: ${fmt(value)}`}</title></rect>
      </svg>
      <Text role="measure" dense>{fmt(hi, true)}</Text>
      {rank && <Text role="label" className="market-range__verdict">{rank} {weekdayUtc}s at this hour</Text>}
    </span>
  );
}

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

// Series: the whole board's current bids, auctions with a bid, and bid per auction; and, once 6 weeks of live
// readings carry them, the same per make.
export function edgeSeries(live: LiveAuction[], readings: HourReading[]): Series[] {
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

// Only what is at an edge of its own history earns a strip here; the board's own reading always sits in the masthead.
function EdgeStrips({ series, hourUtc, weekdayUtc, archiveDays }: { series: Series[]; hourUtc: string; weekdayUtc: string; archiveDays: Set<string> }) {
  const edges = useMemo(
    () => series.map(edgeOf).filter((e): e is Edge => e != null).sort((a, b) => a.depth - b.depth || b.beyond - a.beyond).slice(0, EDGE_MAX),
    [series]
  );
  if (edges.length === 0) return null;
  return (
    <section className="market-edges" aria-label="Edges of the board's own history">
      <div className="market-edges__head">
        <Text role="label">Top or bottom 2 of its own history now · {edges.length} of {series.length} series, each against its own readings at {hourUtc}:00 UTC on earlier {weekdayUtc}s</Text>
      </div>
      {edges.map((e) => {
        const weeks = Math.round((Date.now() - Date.parse(`${e.readings[0].day}T00:00:00Z`)) / (7 * DAY));
        const rebuilt = e.readings.filter((r) => archiveDays.has(r.day)).length;
        return (
          <div key={e.key} className="market-edge">
            <div className="market-edge__head">
              <Text role="entity" dense>{e.what}</Text>
              <Text role="measure" dense>{e.fmt(e.value)}</Text>
              <Text role="label">now</Text>
            </div>
            <RangeBar value={e.value} readings={e.readings} fmt={e.fmt} weekdayUtc={weekdayUtc} weeks={weeks} />
            <Text role="caption" as="div">
              Window: {hourUtc}:00 UTC on {weekdayUtc}s, {shortDay(e.readings[0].day)} to {shortDay(e.readings[e.readings.length - 1].day)}, and now.
              {' '}Count: {e.readings.length} readings.
              {' '}Set: {e.set} (BAT-LIVE-BIDS index, read hourly from the live board{rebuilt ? `; ${rebuilt} of the readings rebuilt from BaT bid history, 96% of auctions` : ''}).
            </Text>
          </div>
        );
      })}
    </section>
  );
}

// ---- Hot / cold: the bid against where comparable sales usually sit at this point in the auction --------------
// heat = current bid / (band middle x the share of the final price comparable cars are usually bid to with
// this much time left). The band is the lot's expected-price range from comparable BaT sales on its model
// page, weighted toward its own version (scripts/market/live-bands.mjs, model version 31); the curve is
// measured on 36,700 sales (migration 20260927230000). Past 120 h the curve rests on thin, early data, so no verdict.
export interface Heat { ratio: number; state: 'hot' | 'cold' | 'in line'; typicalNow: number; share: number; hoursLeft: number }
/** The verdict's three numbers, stated once. The phone's LiveBoard.swift carries the same three; the fixture test
 *  (heat-fixture.contract.test.ts) binds both to one file. */
export const HEAT_THRESHOLDS = { hot: 1.25, cold: 0.8, maxHours: 120 } as const;
const HEAT_MAX_H = HEAT_THRESHOLDS.maxHours;
const HOT = HEAT_THRESHOLDS.hot;
const COLD = HEAT_THRESHOLDS.cold;

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

export function heatOf(a: LiveAuction, curve: BidCurve | null, now: number): Heat | null {
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
// The read sends this as 'backtest' from heat_tag_backtest (market_pulse_live v3); until it does, the page carries the
// 2026-09-28 run here. Same rows either way; the table is the source once it is live.
type Backtest = [number, string, number, number][];
const BACKTEST: Backtest = [
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

function heatParts(a: LiveAuction, heat: Heat, backtest: Backtest) {
  const band = a.band as NonNullable<LiveAuction['band']>;
  // Quote the checkpoint at or before this point in the auction (17 h left reads the 24 h record, not the 12 h one).
  const [, when, hotAbove, coldBelow] = [...backtest].reverse().find((row) => row[0] >= heat.hoursLeft) ?? backtest[backtest.length - 1];
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

// The tag on a row, and the reasoning behind it one tap away: the bid, the comps, their middle, the typical bid
// at this point in the auction, the multiple, and how lots tagged this way finished before.
function HeatTag({ a, heat, backtest }: { a: LiveAuction; heat: Heat; backtest: Backtest }) {
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLSpanElement>(null);
  if (heat.state === 'in line') return null;
  const x = heatParts(a, heat, backtest);
  const hot = heat.state === 'hot';
  return (
    <span ref={boundary} className="market-heat">
      <button type="button" className={`market-heat__tag market-heat__tag--${heat.state}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Why ${title(a)} is running ${heat.state}`} onClick={() => setOpen((v) => !v)}>
        <Text role="label">{hot ? 'Running hot' : 'Running cold'} · {x.multiple}</Text>
      </button>
      <HeaderPopover open={open} title={`${hot ? 'Running hot' : 'Running cold'} · ${title(a)}`} width={360} align="left" dismissBoundaryRef={boundary} onClose={() => setOpen(false)}>
        <Rows title="The reading">
          <Row label="Current bid">{x.bid} · {x.left} left</Row>
          <Row label="Comparable sales">{x.comps} on its BaT model page, weighted toward the same version, year, mileage and gearbox</Row>
          <Row label="Their middle">{x.middle} (80% range {x.range})</Row>
          <Row label="Typical bid now">about {x.typical}: with this much time left, cars at this price are usually bid to about {x.share}% of their final</Row>
          <Row label="This bid" role="measure">{x.multiple} typical</Row>
        </Rows>
        {x.beyond && <Text role="body" as="p">{x.beyond}</Text>}
        {x.outcome && <Text role="body" as="p"><Text role="label">Track record</Text> {x.outcome}</Text>}
      </HeaderPopover>
    </span>
  );
}

function Thumb({ src }: { src: string | null }) {
  if (!src) return <div className="market-thumb" />;
  return <img className="market-thumb" src={src} alt="" width={72} height={48} loading="lazy" decoding="async" />;
}

// This is a row-write-age warning only. vehicles.updated_at can change for any
// writer; it cannot verify source freshness or tell when a bid happened.
const STALE_MS = 45 * 60_000;

function BidCell({ auction, risen, stale }: { auction: LiveAuction; risen: boolean; stale: boolean }) {
  return (
    <Text role="measure" dense
      title={`Recorded current bid. Record updated ${clock(auction.updatedAt)} by a writer; source read time is unavailable.${stale ? ' Recent record writes are behind.' : ''}`}
      className={`market-bid${risen ? ' market-bid--risen' : stale ? ' market-bid--stale' : ''}`}
    >
      {bidNumber(auction.currentBid)}
    </Text>
  );
}

// A row reads its specifications once the viewer reaches it, never for every row on the page at once.
function useSeen<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px 0px' });
    io.observe(node);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function BoardRow({ a, risen, stale, detail, expanded, heat, backtest, onInspect }: {
  a: LiveAuction; risen: boolean; stale: boolean; detail?: MarketRowDetails; expanded: boolean; heat: Heat | null; backtest: Backtest;
  onInspect: (a: LiveAuction, view: LotInspection) => void;
}) {
  const [rowRef, seen] = useSeen<HTMLDivElement>();
  const reached = (seen || expanded) && !!detail;
  const specs = useMarketRowSpecs(a.id, reached);
  const facts = selectRowFacts(specs.data ?? [], title(a));
  const bidReading = detail?.currentBid != null ? { ...a, currentBid: detail.currentBid,
    updatedAt: detail.recordedAt ? Date.parse(detail.recordedAt) : a.updatedAt } : a;
  return (
    <div ref={rowRef} className="market-lot-row" data-vehicle-id={a.id} data-expanded={expanded}>
      <div className="market-lot-close">
        <Text role="label">Closes in</Text>
        <Countdown endsAt={a.endsAt} />
        {heat && <HeatTag a={a} heat={heat} backtest={backtest} />}
      </div>
      <button type="button" className="market-lot-image" onClick={() => onInspect(a, 'auction')}
        aria-label={`Inspect ${title(a)}`} aria-expanded={expanded} aria-controls={expanded ? `lot-inspection-${a.id}` : undefined}>
        <Thumb src={a.imageUrl} />
      </button>
      <div className="market-lot-identity">
        <button type="button" className="market-lot-name" onClick={() => onInspect(a, 'auction')}
          aria-expanded={expanded} aria-controls={expanded ? `lot-inspection-${a.id}` : undefined}><Text role="entity" dense>{title(a)}</Text></button>
        <div className="market-lot-facts">
          {facts.map(f => <button type="button" key={f.field} onClick={() => onInspect(a, 'vehicle')}
            title={`${f.label}: ${f.value}${f.conflict ? ' · differing reports' : ''}`}
            aria-label={`Inspect ${f.label.toLowerCase()} for ${title(a)}: ${f.value}${f.conflict ? ', differing reports' : ''}`}>
            <Text role="body">{f.value}{f.conflict && <span aria-hidden="true"> †</span>}</Text>
          </button>)}
          {!facts.length && specs.isError && <Text role="caption">Specifications unavailable</Text>}
        </div>
        <div className="market-lot-context">
          {detail?.location && <Text role="caption">{detail.location}</Text>}
          {a.noReserve && <Text role="caption">No reserve</Text>}
          <button type="button" onClick={() => onInspect(a, 'sources')} aria-label={`Sources for ${title(a)}`}><Text role="caption">Source: BaT</Text></button>
        </div>
      </div>
      <button type="button" className="market-lot-metrics" onClick={() => onInspect(a, 'auction')}
        aria-label={`Inspect auction for ${title(a)}`} aria-expanded={expanded}>
        <AuctionCompetition vehicleId={a.id} sourceUrl={a.listingUrl} row enabled={reached}
          fallback={<span><Text role="label">Recorded bid</Text><BidCell auction={bidReading} risen={risen} stale={stale} /></span>} />
      </button>
    </div>
  );
}

// The board is read a page at a time: PAGE lots, named in the URL (board=n), so a page is a link and the
// document never grows past one page. A shared link to a lot opens the page that holds it.
export const PAGE = 24;

function Board({ rows, risenIds, stale, activityId, heats, backtest, inspection, onInspect, onInspectionChange, onClose }: {
  rows: LiveAuction[]; risenIds: Set<string>; stale: boolean; activityId: string | null; heats: Map<string, Heat | null>; backtest: Backtest;
  inspection: LotInspection; onInspect: (a: LiveAuction, view: LotInspection) => void;
  onInspectionChange: (view: LotInspection) => void; onClose: () => void;
}) {
  const details = useMarketRowDetails(rows);
  const arrival = useRef(activityId);
  useLayoutEffect(() => {
    // Arriving on a link to a lot puts that row at the top of the viewport.
    if (!arrival.current || arrival.current !== activityId) return;
    document.querySelector(`[data-vehicle-id="${activityId}"]`)?.scrollIntoView({ block: 'start' });
    arrival.current = null;
  }, [activityId]);
  return (
    <div className="market-board-rows">
      {rows.map((a) => {
        const detail = details.data?.get(a.id);
        const expanded = a.id === activityId;
        return (
          <div key={a.id}>
            <BoardRow a={a} risen={risenIds.has(a.id)} stale={stale} detail={detail} expanded={expanded} heat={heats.get(a.id) ?? null} backtest={backtest} onInspect={onInspect} />
            {expanded && <AuctionEvidence key={a.id} vehicleId={a.id} compact inspection={inspection} summary={detail}
              sourceUrl={a.listingUrl} onInspectionChange={onInspectionChange} onClose={onClose} />}
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

export default function MarketPulse({ onUnavailable, collection }: { onUnavailable?: React.ReactNode; collection?: React.ReactNode }) {
  usePageTitle('Market');
  const { data, isLoading, isError, risenIds, refetch, dataUpdatedAt } = useMarketPulse();
  const [params, setParams] = useSearchParams();
  const boardRef = useRef<HTMLDivElement>(null);

  const makeParam = params.get('make')?.toUpperCase();
  const view = params.get('view') === 'sales' ? 'sales' : 'inventory';
  // Recorded sales never opens empty: without a chosen make it reads the largest open cohort.
  const liveForDefault = data?.auctions ?? [];
  const defaultMake = view === 'sales' && (!makeParam || makeParam === 'ALL') ? (() => {
    const counts = new Map<string, number>();
    for (const a of liveForDefault) if (a.make !== NO_MAKE) counts.set(a.make, (counts.get(a.make) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
  })() : null;
  const make = makeParam === 'ALL' ? defaultMake : makeParam ?? defaultMake;
  const model = make ? params.get('model') : null;
  const inventoryLens = mapLens(params, make);
  const lotParam = params.get('lot');
  const activityId = lotParam && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lotParam) ? lotParam : null;
  const mapInspection = useRef<string | null>(null);
  useEffect(() => {
    if (!activityId || mapInspection.current !== activityId) return;
    const row = document.querySelector<HTMLButtonElement>(`[data-vehicle-id="${activityId}"] .market-lot-name`);
    row?.scrollIntoView({ block: 'center' });
    row?.focus({ preventScroll: true });
    mapInspection.current = null;
  }, [activityId]);
  const [pinnedAuction, setPinnedAuction] = useState<LiveAuction | null>(null);
  useEffect(() => {
    const current = data?.auctions.find(a => a.id === activityId);
    if (current) setPinnedAuction(current);
    else if (!activityId) setPinnedAuction(null);
  }, [activityId, data]);
  const inspection: LotInspection = params.get('inspect') === 'vehicle' ? 'vehicle' : params.get('inspect') === 'sources' ? 'sources' : 'auction';
  const openActivity = (auction: LiveAuction, view: LotInspection) => {
    const next = new URLSearchParams(params);
    if (activityId === auction.id && inspection === view) { next.delete('lot'); next.delete('inspect'); }
    else { setPinnedAuction(auction); next.set('lot', auction.id); next.set('inspect', view); next.delete('board'); }
    setParams(next, { preventScrollReset: true });
  };
  const setInspection = (view: LotInspection) => {
    const next = new URLSearchParams(params); next.set('inspect', view);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const closeActivity = () => {
    const active = activityId;
    const next = new URLSearchParams(params); next.delete('lot'); next.delete('inspect'); setParams(next, { preventScrollReset: true });
    if (active) requestAnimationFrame(() => (document.querySelector<HTMLButtonElement>(`[data-vehicle-id="${active}"] .market-lot-name`)
      ?? document.querySelector<HTMLButtonElement>('.market-lot-name'))?.focus({ preventScroll: true }));
  };
  const salesDay = params.get('day');
  const salesLens: MarketSalesLens = {
    scopeKey: params.get('salesScope'), days: params.get('days') === '2' ? 2 : 7,
    drill: salesDay && /^\d{4}-\d{2}-\d{2}$/.test(salesDay) && Number.isFinite(Date.parse(salesDay))
      ? { bucket: `${salesDay}T00:00:00Z`, series: params.get('series') === 'benchmark' ? 'benchmark' : 'selected' } : null,
    benchmark: params.get('benchmark') === '1' || params.get('series') === 'benchmark',
  };
  const win = (WINDOWS.some((w) => w.id === params.get('live')) ? params.get('live') : 'all') as Window;
  const sort = (SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'ending') as Sort;
  const selectedBid = BID_BUCKETS.find(b => b.id === params.get('bidRange'))?.id ?? null;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (key === 'make' && value == null) next.set(key, 'all');
    else if (value == null) next.delete(key);
    else next.set(key, value);
    if (key === 'live' || (key === 'make' && value != null) || key === 'bidRange') next.set('board', '1');
    else if (key !== 'board') next.delete('board');
    if (key === 'live' || key === 'make') next.delete('bidRange');
    if (key === 'make' || key === 'view') {
      next.delete('model');
      ['mapFocus', 'mapChild'].forEach(k => next.delete(k));
    }
    if (key === 'make') next.delete('mapBy');
    if (key === 'model') ['mapFocus', 'mapChild'].forEach(k => next.delete(k));
    if (key === 'view') next.delete('bidRange');
    if (key === 'view' && value === 'sales' && (!next.get('make') || next.get('make') === 'all') && largestMake) next.set('make', largestMake);
    if (key === 'make' || key === 'view') ['day', 'series', 'salesScope'].forEach(k => next.delete(k));
    next.delete('lot');
    setParams(next, { replace: key === 'live' || key === 'bidRange' || key === 'sort', preventScrollReset: true });
  };
  const setCohort = (nextMake: string | null, scopeKey?: string | null) => {
    const next = new URLSearchParams(params);
    next.set('make', nextMake ?? 'all');
    ['model', 'bidRange', 'day', 'series', 'salesScope', 'mapFocus', 'mapChild', 'board'].forEach(k => next.delete(k));
    if (scopeKey?.startsWith('subject:')) next.set('salesScope', scopeKey);
    next.delete('lot');
    setParams(next);
  };
  const setInventoryLens = (change: Partial<InventoryMapLens>) => {
    const next = new URLSearchParams(params);
    const keys = { group: 'mapBy', inside: 'mapInside', focus: 'mapFocus', child: 'mapChild' } as const;
    for (const key of Object.keys(change) as (keyof InventoryMapLens)[]) {
      const value = change[key];
      if (value == null) next.delete(keys[key]); else next.set(keys[key], value);
    }
    next.delete('lot'); next.delete('board'); setParams(next, { preventScrollReset: true });
  };
  const selectMapGroup = (dimension: MapDimension | 'lot', group: InventoryMapGroup, child = false) => {
    if (dimension === 'lot') { mapInspection.current = group.lots[0].id; openActivity(group.lots[0], 'auction'); return; }
    if (child) {
      setInventoryLens({ child: inventoryLens.child === group.key ? null : group.key,
        focus: mapValue(group.lots[0], inventoryLens.group, taxonomy) });
      return;
    }
    if (dimension === 'make') { setParam('make', group.key); return; }
    if (dimension === 'model' && make) { setParam('model', model === recordedModel(group.lots[0]) ? null : recordedModel(group.lots[0])); return; }
    setInventoryLens({ focus: inventoryLens.focus === group.key ? null : group.key, child: null });
  };
  const setSalesLens = (change: Partial<MarketSalesLens>) => {
    const next = new URLSearchParams(params);
    if (change.days != null) next.set('days', String(change.days));
    if (change.benchmark != null) { if (change.benchmark) next.set('benchmark', '1'); else next.delete('benchmark'); }
    if ('drill' in change) {
      next.delete('day'); next.delete('series');
      if (change.drill) { next.set('day', change.drill.bucket.slice(0, 10)); next.set('series', change.drill.series); }
    }
    setParams(next);
  };

  // Figures and filters are evaluated against the clock once a minute; the countdowns tick on their own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const live = useMemo(() => (data?.auctions ?? []).filter((a) => a.endsAt > now), [data, now]);
  const cohort = useMemo(() => live.filter(a => make == null || a.make === make), [live, make]);
  const todayUtc = new Date(now).toISOString().slice(0, 10);
  const sameHour = useSameHourReadings(data?.sameHour?.hourUtc ?? '', todayUtc);
  const edgeInput = useMemo(() => data?.sameHour && sameHour.data ? edgeSeries(live, sameHour.data) : [], [data?.sameHour, sameHour.data, live]);
  const archiveDays = useMemo(() => new Set((sameHour.data ?? []).filter((r) => r.source === 'archive').map((r) => r.day)), [sameHour.data]);
  const liveBids = useMemo(() => live.reduce((s, a) => s + (a.currentBid ?? 0), 0), [live]);
  const cohortBids = useMemo(() => cohort.reduce((s, a) => s + (a.currentBid ?? 0), 0), [cohort]);
  const boardReadings = useMemo(() => (sameHour.data ?? []).flatMap((r) => {
    if (make == null) return [{ day: r.day, v: r.bids }];
    const bm = r.byMake?.[make];
    return bm ? [{ day: r.day, v: Number(bm[0]) }] : [];
  }), [sameHour.data, make]);
  // The largest open cohort opens the recorded-sales view when no make is chosen, so the view never opens empty.
  const largestMake = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of live) if (a.make !== NO_MAKE) counts.set(a.make, (counts.get(a.make) ?? 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
  }, [live]);
  // The read's own verdict when it sent one (v3: heat_of with the server's clock, the same the phone shows); the page
  // computes it only for older payloads. Both are graded against one fixture (heat-fixture.contract.test.ts).
  const heats = useMemo(() => new Map<string, Heat | null>(live.map((a) => [a.id, a.serverHeat ?? heatOf(a, data?.curve ?? null, now)])), [live, data?.curve, now]);
  const backtest = useMemo<Backtest>(() => data?.backtest && data.backtest.length
    ? data.backtest.map((b) => [b.horizonHours, b.label, b.hotAbove, b.coldBelow] as Backtest[number]).sort((x, y) => y[0] - x[0])
    : BACKTEST, [data?.backtest]);

  const figures = useMemo(() => {
    const f: Record<Window, number> = { all: 0, '1h': 0, '24h': 0, new: 0, nr: 0, hot: 0, cold: 0 };
    for (const a of cohort) for (const w of WINDOWS) if (inWindow(a, w.id, now, heats.get(a.id))) f[w.id] += 1;
    return f;
  }, [cohort, now, heats]);
  const syncBehind = data?.syncedAt != null && now - data.syncedAt > STALE_MS;

  const scoped = useMemo(() => cohort.filter(a => inWindow(a, win, now, heats.get(a.id))), [cohort, win, now, heats]);
  const distribution = useMemo(() => currentBidDistribution(scoped), [scoped]);
  // The make map is the wider inventory context. Window/range changes reshape its actual population;
  // the selected make is highlighted within it rather than erasing all other brands.
  const mappedInventory = useMemo(() => live.filter(a => inWindow(a, win, now, heats.get(a.id))
    && (selectedBid == null || bidBucket(a.currentBid) === selectedBid)), [live, win, now, heats, selectedBid]);

  const mapAuctions = useMemo(() => mappedInventory.filter(a => (make == null || a.make === make)
    && (inventoryLens.group === 'model' || model == null || recordedModel(a) === model)), [mappedInventory, make, model, inventoryLens.group]);
  const needsTaxonomy = inventoryLens.group === 'type' || inventoryLens.group === 'body';
  const taxonomyQuery = useInventoryTaxonomy(mapAuctions, view === 'inventory' && needsTaxonomy);
  const taxonomy = useMemo(() => taxonomyByListing(taxonomyQuery.data), [taxonomyQuery.data]);
  const mapFilterPending = needsTaxonomy && !taxonomyQuery.isSuccess && inventoryLens.focus != null;

  const board = useMemo(() => {
    const rows = scoped.filter(a => (selectedBid == null || bidBucket(a.currentBid) === selectedBid)
      && (model == null || recordedModel(a) === model)
      && matchesMapLens(a, inventoryLens, taxonomy));
    // Keep an inspected lot reachable while the board rolls past its deadline.
    if (pinnedAuction?.id === activityId && !rows.some(a => a.id === activityId)) rows.push(pinnedAuction);
    const ratio = (a: LiveAuction) => heats.get(a.id)?.ratio ?? null;
    if (sort === 'bid') rows.sort((a, b) => (b.currentBid ?? 0) - (a.currentBid ?? 0));
    else if (sort === 'newest') rows.sort((a, b) => b.listedAt - a.listedAt);
    else if (sort === 'hottest') rows.sort((a, b) => (ratio(b) ?? -1) - (ratio(a) ?? -1));
    else if (sort === 'coldest') rows.sort((a, b) => (ratio(a) ?? Infinity) - (ratio(b) ?? Infinity));
    else rows.sort((a, b) => a.endsAt - b.endsAt);
    return rows;
  }, [scoped, selectedBid, sort, heats, model, inventoryLens.group, inventoryLens.inside, inventoryLens.focus, inventoryLens.child, taxonomy, pinnedAuction, activityId]);

  // One page of the board. A link to a lot opens its page; a filter change returns to the first page.
  const pages = Math.max(1, Math.ceil(board.length / PAGE));
  const boardParam = Number(params.get('board'));
  const selectedIndex = activityId ? board.findIndex(a => a.id === activityId) : -1;
  const page = Number.isInteger(boardParam) && boardParam >= 1 ? Math.min(boardParam, pages)
    : selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE) + 1 : 1;
  const pageRows = useMemo(() => board.slice((page - 1) * PAGE, page * PAGE), [board, page]);
  const goToPage = (n: number) => {
    setParam('board', String(n));
    requestAnimationFrame(() => boardRef.current?.scrollIntoView({ block: 'start' }));
  };


  // The page as a document: the population is the entity, its count the headline result, and the scope strip
  // carries the view, the cohort and the coverage of the cohort within the captured population.
  const weekAgoPct = data?.weekAgo && make == null ? pctChange(liveBids, data.weekAgo.bids) : null;
  const masthead = (
    <Masthead result={view === 'inventory' ? <>
      <div className="market-masthead__count"><Text role="measure">{isLoading ? '…' : cohort.length.toLocaleString('en-US')}</Text> <Text role="label">open lots</Text></div>
      {data?.syncedAt != null && <Text role="caption" as="div" title={data.source}>recorded {clock(data.syncedAt)}{syncBehind ? ' · over 45 min ago' : ''}</Text>}
      {data?.weekAgo && weekAgoPct != null && <Text role="caption" as="div" title={`${bidNumber(data.weekAgo.bids)} across ${data.weekAgo.n.toLocaleString('en-US')} auctions at ${clock(data.weekAgo.at)} a week ago${data.weekAgo.source === 'archive' ? ' (rebuilt from BaT bid history, 96% of auctions)' : ''}`}>
        vs same time last week {data.weekAgo.source === 'archive' ? '≈' : ''}{signed(weekAgoPct)} from {bidNumber(data.weekAgo.bids, true)}</Text>}
    </> : undefined}>
      <Text role="entity" as="h1">{view !== 'inventory' ? 'Recorded sales' : isLoading || cohortBids <= 0 ? 'Open BaT lots' : `${bidNumber(cohortBids, true)} on BaT live auctions${make ? ` · ${make}` : ''}`}</Text>
    </Masthead>
  );
  // The board's own reading in its own history, always: the owner's building block (docs/schematics/homepage.md).
  const boardStrip = view === 'inventory' && data?.sameHour && boardReadings.length > 0 ? (
    <div className="k-section market-pulse-strip" role="group" aria-label="The board in its own history">
      <RangeBar value={cohortBids} readings={boardReadings} fmt={bidNumber} weekdayUtc={data.sameHour.weekdayUtc}
        weeks={Math.max(boardReadings.length, Math.round((Date.now() - Date.parse(`${boardReadings[0].day}T00:00:00Z`)) / (7 * DAY)))} />
      <Text role="caption" as="div">Current bids{make ? ` on ${make} lots` : ''} at {data.sameHour.hourUtc}:00 UTC on earlier {data.sameHour.weekdayUtc}s · {boardReadings.length} readings · BAT-LIVE-BIDS index, read hourly from the live board.</Text>
    </div>
  ) : null;
  const scope = (
    <div className="k-section k-strip market-scope" role="group" aria-label="Market scope">
      <MarketScopeControls make={make} scopeKey={salesLens.scopeKey} view={view} onMakeChange={setCohort} onViewChange={v => setParam('view', v)}>{collection}</MarketScopeControls>
      {view === 'inventory' && !isLoading && data && <CoverageView className="k-strip__coverage"
        c={{ n: cohort.length, of: live.length, grain: 'captured BaT vehicle lots', as_of: data.syncedAt != null ? new Date(data.syncedAt).toISOString() : null }} />}
    </div>
  );

  if (!data && isError && view === 'inventory' && !activityId) return <>
    {masthead}
    {scope}
    <div role="status" className="market-status">Live BaT bids could not be loaded. <button className="market-control" onClick={() => refetch()}><Text role="label">Retry live board</Text></button></div>
    {onUnavailable}
  </>;

  return (
    <div className="market-explorer">
      {masthead}
      {boardStrip}

      {view === 'inventory' && isError && data && <div role="status" className="market-status">Refresh failed. Showing the last fetched board. <button className="market-control" onClick={() => refetch()}><Text role="label">Retry</Text></button></div>}

      {activityId && (view !== 'inventory' || !pageRows.some(a => a.id === activityId)) &&
        <AuctionEvidence key={activityId} vehicleId={activityId} compact inspection={inspection} onInspectionChange={setInspection} onClose={closeActivity} />}

      {scope}

      {view === 'inventory' && data?.sameHour && edgeInput.length > 0 &&
        <EdgeStrips series={edgeInput} hourUtc={data.sameHour.hourUtc} weekdayUtc={data.sameHour.weekdayUtc} archiveDays={archiveDays} />}

      {view === 'sales' && <RecordedSalesComparison make={make} onMakeChange={setCohort} view={view} onViewChange={v => setParam('view', v)} lens={salesLens} onLensChange={setSalesLens} controls={false} />}

      {view === 'inventory' && <>
      {make && <nav aria-label="Inventory drill path" className="market-drill">
        <button type="button" className="market-control" onClick={() => setParam('make', null)}><Text role="label">All captured makes</Text></button>
        <span aria-hidden="true">→</span>
        <button type="button" className="market-control market-control--make" onClick={() => setParam('model', null)}><MakeLogo make={make} /><Text role="label">{make}</Text></button>
        {model && <><span aria-hidden="true">→</span><Text role="body">Recorded model: {model}</Text></>}
      </nav>}

      {/* Windows. Each is a count that filters the board below. The whole cohort is counted in the masthead,
          and a window with nothing in it is not offered. */}
      <div role="group" aria-label="Open inventory filters" className="market-windows">
        {WINDOWS.filter((w) => w.id !== 'all' && (isLoading || win === w.id || figures[w.id] > 0)).map((w) => (
          <button key={w.id} type="button" className="market-window" aria-pressed={win === w.id}
            title={w.id === 'new' ? 'First seen by Nuke in the last 24 h; the live page is read every 15 min'
              : w.id === 'hot' ? `Bid at least ${HOT}x where comparable sales usually sit at this point in the auction (within 5 days of the close)`
              : w.id === 'cold' ? `Bid at most ${COLD}x where comparable sales usually sit at this point in the auction (within 5 days of the close)`
              : undefined}
            onClick={() => setParam('live', win === w.id ? null : w.id)}>
            <Text role="label">{w.label}</Text>
            <Text role="measure">{isLoading ? '…' : figures[w.id].toLocaleString('en-US')}</Text>
          </button>
        ))}
      </div>

      {!isLoading && <details open={selectedBid != null} className="market-distribution">
        <summary><Text role="label">Filter live lots by current bid</Text></summary>
        <BidDistribution distribution={distribution} lots={scoped.length} scope={`${make ?? 'All makes'} · ${WINDOWS.find(w => w.id === win)?.label}`} selected={selectedBid} onSelect={b => setParam('bidRange', selectedBid === b ? null : b)} fetchedAt={dataUpdatedAt} />
      </details>}


      <section className="market-map">
          {mapAuctions.length > 0 && <MarketInventoryMap auctions={mapAuctions} lens={inventoryLens} taxonomy={taxonomy}
            taxonomyLoading={taxonomyQuery.isLoading} taxonomyError={taxonomyQuery.isError} onRetryTaxonomy={() => { void taxonomyQuery.refetch(); }}
            risenIds={risenIds} selectedModel={model} onLensChange={setInventoryLens} onSelect={selectMapGroup} />}
      </section>


      <div ref={boardRef} tabIndex={-1} className="market-board" aria-label="Supporting live lots">
      <section className="market-board__frame">
        <div className="market-board__head">
          <Text role="caption">
            {mapFilterPending ? 'Reading classifications…' : `${board.filter(a => a.endsAt > now).length.toLocaleString('en-US')} lots`}
            {make ? ` · ${make}` : ''}
            {model ? ` · recorded model ${model}` : ''}
            {win !== 'all' ? ` · ${WINDOWS.find((w) => w.id === win)?.label}` : ''}
            {selectedBid ? ` · ${BID_BUCKETS.find(b => b.id === selectedBid)?.label}` : ''}
            {' · † differing specification reports'}
          </Text>
          <div className="market-sorts" role="group" aria-label="Sort">
            {SORTS.map((s) => (
              <button key={s.id} type="button" className="market-control" aria-pressed={sort === s.id}
                onClick={() => setParam('sort', s.id === 'ending' ? null : s.id)}>
                <Text role="label">{s.label}</Text>
              </button>
            ))}
          </div>
        </div>
        {!isLoading && !mapFilterPending && board.length === 0 && <div role="status" className="market-board__empty">No open lots match these filters. <button type="button" className="market-control" onClick={() => {
          const next = new URLSearchParams(params);
          ['make', 'live', 'bidRange', 'mapFocus', 'mapChild'].forEach(k => next.delete(k));
          next.delete('model');
          next.set('make', 'all');
          setParams(next, { replace: true });
        }}><Text role="label">Clear market filters</Text></button></div>}
        {isLoading || mapFilterPending ? null : <Board rows={pageRows} risenIds={risenIds} stale={syncBehind} heats={heats} backtest={backtest}
          activityId={activityId} inspection={inspection} onInspect={openActivity} onInspectionChange={setInspection} onClose={closeActivity} />}
        {!isLoading && !mapFilterPending && board.length > 0 && (
          <nav className="market-board-pager" aria-label="Board pages">
            <Text role="caption">{`${((page - 1) * PAGE + 1).toLocaleString('en-US')}–${Math.min(page * PAGE, board.length).toLocaleString('en-US')} of ${board.length.toLocaleString('en-US')} lots`}</Text>
            {page > 1 && <button type="button" className="market-board-page" aria-label={`Previous ${PAGE} lots`} onClick={() => goToPage(page - 1)}><Text role="label">← Previous {PAGE}</Text></button>}
            {page < pages && <button type="button" className="market-board-page" aria-label={`Next ${PAGE} lots`} onClick={() => goToPage(page + 1)}><Text role="label">Next {PAGE} →</Text></button>}
          </nav>
        )}
      </section>
      </div>
      </>}

      {view === 'inventory' && data?.source && (
        <Text role="caption" as="p" className="market-source">
          Source: {data.source}. Bids are US dollars as Bring a Trailer records them; a bid's freshness is the record's last write, shown beside it.
        </Text>
      )}
    </div>
  );
}

function BidDistribution({ distribution, lots, scope, selected, onSelect, fetchedAt }: {
  distribution: ReturnType<typeof currentBidDistribution>; lots: number; scope: string;
  selected: BidBucket | null; onSelect: (b: BidBucket) => void; fetchedAt: number;
}) {
  return (
    <section aria-label="Current bid distribution" className="market-distribution__body">
      <div className="market-distribution__head">
        <Text role="label">{scope}</Text>
        <Text role="body">{distribution.recorded.toLocaleString('en-US')} of {lots.toLocaleString('en-US')} lots have a recorded bid number</Text>
      </div>
      {lots === 0 && <div role="status" className="k-body">No open lots in this scope.</div>}
      <div className="market-distribution__bars">
        {BID_BUCKETS.map(b => {
          const n = distribution.counts[b.id];
          const pct = lots > 0 ? n / lots * 100 : 0;
          return (
            <button key={b.id} type="button" className="market-bucket" disabled={n === 0 && selected !== b.id} aria-pressed={selected === b.id}
              aria-label={`${b.label}: ${n} of ${lots} lots. Show supporting lots`}
              onClick={() => onSelect(b.id)}>
              <Text role="body" className="market-bucket__label">{b.label}</Text>
              <svg aria-hidden="true" className="market-bucket__track" viewBox="0 0 100 1" preserveAspectRatio="none"><rect x="0" y="0" width={pct} height="1" /></svg>
              <Text role="measure" className="market-bucket__count">{n} · {pct.toFixed(1)}%</Text>
            </button>
          );
        })}
      </div>
      <Text role="caption" as="div" className="market-distribution__note">
        Current bids in US dollars as recorded. Choose a range to see its lots.
      </Text>
      <details className="market-notes">
        <summary><Text role="label">Scope, source and timing</Text></summary>
        <p className="k-body">One public, undeleted vehicle record marked live on Bring a Trailer with a recorded end in the future. Make and auction-window filters define this distribution; selecting a bid range narrows the supporting list. Each bar counts lots, including unrecorded bids in the denominator. A recorded zero stays zero.</p>
        <p className="k-body">These are current bids, not sold prices or a valuation. Condition, restoration and build class are not matched. Open a lot's Nuke record for evidence or its BaT link for the attributed listing.</p>
        <p className="k-body">Board fetched {clock(fetchedAt)}. Latest record write is a vehicle-row update by any writer. Source read time and bid event time are unavailable in the full board reader; the bounded Ending next panel exposes captured source clocks separately. BaT's board is scheduled to be read every 15 minutes; that schedule does not prove freshness.</p>
      </details>
    </section>
  );
}
