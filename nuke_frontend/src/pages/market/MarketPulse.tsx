import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import { Masthead, Text } from '../../kit';
import { timeLeft, useSecondClock } from '../../hooks/useSecondClock';
import MarketInventoryMap from './MarketInventoryMap';
import { mapLens, mapValue, matchesMapLens, recordedModel, taxonomyByListing, type InventoryMapLens, type InventoryMapGroup, type MapDimension } from './inventoryMap';
import AuctionEvidence, { AuctionCompetition } from './AuctionEvidence';
import { BID_BUCKETS, bidBucket, currentBidDistribution, listingKey, NO_MAKE, useMarketPulse, useInventoryTaxonomy, useSameHourReadings, type BidBucket, type BidCurve, type LiveAuction } from './useMarketPulse';
import RecordedSalesComparison, { MarketScopeControls, type MarketSalesLens } from './RecordedSalesComparison';
import { MakeLogo } from '../../components/common/MakeIdentity';
import { selectRowFacts, useMarketRowDetails, useMarketRowSpecs, vehicleIdentity, type LotInspection, type MarketRowDetails } from './useMarketRowDetails';
import { useFinishEstimates, type FinishEstimate } from './useFinishEstimates';
import { ringBids, startBidChime } from './bidChime';
import { matchesEraRange } from '../../lib/market/familyEras';

// The homepage: the live collector-car market as Nuke sees it right now.
// Activity figures count the rows market_pulse_live() returns; rows open their canonical records.
// Owner review, 2026-10-15 (docs/market/MARKET_MEASUREMENT_UI_CONTRACT.md, "The live auction board"): each datum once,
// in its most efficient place. The live total is the page's one figure, placed against the same hour in earlier
// weeks and opened into what it is made of; hot/cold tags, bidder depth and the edge strips left the page (their
// last implementation is in git history before this commit; heatOf stays exported for the phone's shared fixture).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Window = 'all' | '1h' | '24h' | 'new' | 'nr';
type Sort = 'ending' | 'bid' | 'newest';

// Filters over the open lots, each with its count; one that would show nothing is not offered.
const WINDOWS: { id: Window; label: string }[] = [
  { id: 'all', label: 'Live lots' },
  { id: 'nr', label: 'No reserve' },
  { id: '1h', label: 'Ending in 1 h' },
  { id: '24h', label: 'Ending in 24 h' },
  { id: 'new', label: 'New in 24 h' },
];

// Current auctions appear in close order unless the viewer chooses another sort.
const SORTS: { id: Sort; label: string }[] = [
  { id: 'ending', label: 'Ending first' },
  { id: 'bid', label: 'Highest bid' },
  { id: 'newest', label: 'Newest' },
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

// This is the successful browser read clock. A vehicle-row write by any process cannot establish source freshness.
export function boardFreshness(readAt: number | null | undefined, now: number): string {
  if (readAt == null || !Number.isFinite(readAt) || readAt <= 0 || readAt > now) return 'refresh';
  const m = Math.floor((now - readAt) / 60_000);
  return m < 1 ? 'read just now' : `read ${m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`} ago`;
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
    : below === 0 && above === 0 ? `level with all ${n}`
    : below === n ? `higher than all ${n}`
    : above === n ? `lower than all ${n}`
    : below >= above ? `higher than ${below} of ${n}` : `lower than ${above} of ${n}`;
  return { below, above, n, text };
}

function RangeBar({ value, readings, fmt, weekdayUtc, weeks, bare = false }: { value: number; readings: { day: string; v: number }[]; fmt: (n: number, compact?: boolean) => string; weekdayUtc: string; weeks: number; bare?: boolean }) {
  const lo = Math.min(value, ...readings.map((r) => r.v));
  const hi = Math.max(value, ...readings.map((r) => r.v));
  const span = hi - lo;
  const x = (v: number) => (span > 0 ? (v - lo) / span : 0.5) * 160;
  const { n, text: rank } = rankOf(value, readings);
  return (
    <span className="market-range">
      {!bare && <Text role="label">Same time on {weekdayUtc}s · {n === weeks ? `last ${weeks} weeks` : `${n} of the last ${weeks} weeks`}</Text>}
      <Text role="measure" dense>{fmt(lo, true)}</Text>
      <svg className="market-range__bar" viewBox="0 0 160 12" width="160" height="12" aria-hidden="true">
        <rect className="market-range__track" x="0" y="5" width="160" height="2" />
        {readings.map((r) => <rect key={r.day} className="market-range__tick" x={x(r.v) - 1} y="2" width="2" height="8"><title>{`${r.day}: ${fmt(r.v)}`}</title></rect>)}
        <rect className="market-range__now" x={x(value) - 3} y="0" width="6" height="12"><title>{`Now: ${fmt(value)}`}</title></rect>
      </svg>
      <Text role="measure" dense>{fmt(hi, true)}</Text>
      {rank && !bare && <Text role="label" className="market-range__verdict">{rank} {weekdayUtc}s at this hour</Text>}
    </span>
  );
}

function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// A headline number: the figure, what it counts, where it sits against the same hour in earlier weeks, and the map of
// what it is made of, one press away.
function Figure({ value, label, open, onToggle, relative, bar, title }: {
  value: string; label: string; open: boolean; onToggle: () => void; relative: (string | null)[]; bar?: React.ReactNode; title?: string;
}) {
  const said = relative.filter((r): r is string => !!r);
  return <div className="market-figure__item">
    <button type="button" className="market-figure__value" aria-expanded={open} aria-controls="market-composition" onClick={onToggle} title={title}>
      <Text role="figure">{value}</Text>
      <Text role="label">{label} · inspect {open ? '▴' : '▾'}</Text>
    </button>
    {said.length > 0 && <Text role="body" as="div">{said.join(' · ')}</Text>}
    {bar}
  </div>;
}

interface BoardChange { auction: LiveAuction; before: number | null; after: number | null; kind: 'bid' | 'entered' | 'left' }
interface BoardSample { at: number; bids: number; lots: number; changes: BoardChange[] }

// A browser-observed path of the headline, not reconstructed bid-event history. Keep exact episode keys and
// separate membership changes from bid changes: a closing lot can lower the total without a bid falling.
function useBoardHistory(auctions: LiveAuction[], scope: string, enabled: boolean) {
  const previous = useRef<{ scope: string; rows: LiveAuction[] } | null>(null);
  const [history, setHistory] = useState<{ scope: string; samples: BoardSample[] }>({ scope, samples: [] });
  useEffect(() => {
    if (!enabled) return;
    const prior = previous.current?.scope === scope ? previous.current.rows : null;
    const keyOf = (a: LiveAuction) => listingKey(a) ?? `${a.id}:${a.listingUrl ?? 'unrecorded'}`;
    const before = new Map(prior?.map(a => [keyOf(a), a] as const));
    const after = new Set(auctions.map(keyOf));
    const changes: BoardChange[] = [];
    if (prior) {
      for (const a of auctions) {
        const b = before.get(keyOf(a));
        if (!b) changes.push({ auction: a, before: null, after: a.currentBid, kind: 'entered' });
        else if (b.currentBid !== a.currentBid) changes.push({ auction: a, before: b.currentBid, after: a.currentBid, kind: 'bid' });
      }
      for (const a of prior) if (!after.has(keyOf(a))) changes.push({ auction: a, before: a.currentBid, after: null, kind: 'left' });
    }
    previous.current = { scope, rows: auctions };
    const sample = { at: Date.now(), bids: auctions.reduce((sum, a) => sum + (a.currentBid ?? 0), 0), lots: auctions.length, changes };
    setHistory(h => ({ scope, samples: [...(h.scope === scope ? h.samples : []), sample].slice(-180) }));
  }, [auctions, scope, enabled]);
  return history.scope === scope ? history.samples : [];
}

function BoardHistory({ samples, measure }: { samples: BoardSample[]; measure: 'bids' | 'lots' }) {
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const [lot, setLot] = useState<LiveAuction | null>(null);
  if (!samples.length) return null;
  const value = (s: BoardSample) => measure === 'bids' ? s.bids : s.lots;
  const fmt = measure === 'bids' ? bidNumber : count;
  const selected = samples.find(s => s.at === selectedAt) ?? [...samples].reverse().find(s => s.changes.some(c => measure === 'bids' || c.kind !== 'bid')) ?? samples[samples.length - 1];
  const index = samples.indexOf(selected), prev = samples[index - 1];
  const lo = Math.min(...samples.map(value)), hi = Math.max(...samples.map(value));
  const x = (s: BoardSample) => 8 + (s.at - samples[0].at) / Math.max(1, samples[samples.length - 1].at - samples[0].at) * 624;
  const y = (s: BoardSample) => hi === lo ? 60 : 108 - (value(s) - lo) / (hi - lo) * 96;
  const path = samples.map((s, i) => `${i ? `H ${x(s)} V` : `M ${x(s)}`} ${y(s)}`).join(' ');
  const changes = measure === 'lots' ? selected.changes.filter(c => c.kind !== 'bid') : selected.changes;
  const delta = prev ? value(selected) - value(prev) : null;
  return <section className="market-history" aria-label={measure === 'bids' ? 'Bid total movement' : 'Open lot movement'}>
    <div className="market-history__head">
      <Text role="label">This visit · {measure === 'bids' ? 'standing bids, USD' : 'open lots'}</Text>
      <button type="button" className="market-control" onClick={() => { setSelectedAt(null); setLot(null); }} aria-pressed={selectedAt == null}><Text role="label">Latest change</Text></button>
    </div>
    <svg className="market-history__chart" viewBox="0 0 640 120" preserveAspectRatio="none" role="img" aria-label={`${fmt(lo)} to ${fmt(hi)} since ${clock(samples[0].at)}. Choose an observation below to inspect its changes.`}
      onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); const atX = (e.clientX - rect.left) / rect.width * 640;
        setSelectedAt(samples.reduce((best, s) => Math.abs(x(s) - atX) < Math.abs(x(best) - atX) ? s : best).at); setLot(null); }}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx={x(selected)} cy={y(selected)} r="4" fill="currentColor" />
    </svg>
    <div className="market-history__head"><Text role="caption">{fmt(lo)}–{fmt(hi)}</Text><Text role="caption">{clock(samples[0].at)} → {clock(samples[samples.length - 1].at)}</Text></div>
    <label className="market-history__head"><Text role="label">Observation</Text>
      <select className="market-control" aria-label="Inspect market observation" value={index} onChange={e => { setSelectedAt(samples[Number(e.target.value)].at); setLot(null); }}>
        {samples.map((s, i) => <option key={i} value={i}>{new Date(s.at).toLocaleTimeString()} · {fmt(value(s))}</option>)}
      </select>
    </label>
    {delta != null && <Text role="measure" as="div">{delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta))} since previous observation</Text>}
    <Text role="caption" as="p">History starts when you open this page. Updates can combine bids. Lots entering or leaving also change the total; leaving does not establish a sale.</Text>
    {changes.length > 0 ? <div className="market-history__changes">
      {changes.map((c, i) => <button type="button" className="market-history__change" key={i} disabled={!listingKey(c.auction)} onClick={() => setLot(c.auction)}>
        <Text role="body">{title(c.auction)}</Text>
        <Text role="measure">{c.kind === 'entered' ? 'Entered board' : c.kind === 'left' ? 'Left board' : c.before == null ? 'Bid now recorded' : c.after == null ? 'Bid now unrecorded' : `${c.after >= c.before ? '+' : '−'}${bidNumber(Math.abs(c.after - c.before))}`}</Text>
        {measure === 'bids' && <Text role="caption">{c.kind === 'bid' ? `${bidNumber(c.before)} → ${bidNumber(c.after)}` : bidNumber(c.kind === 'entered' ? c.after : c.before)}</Text>}
      </button>)}
    </div> : <Text role="body" as="p">{prev ? 'No change in this observation.' : 'Starting observation. New changes will appear here as the board updates.'}</Text>}
    {lot && <AuctionEvidence key={`${lot.id}:${lot.listingUrl}`} vehicleId={lot.id} sourceUrl={lot.listingUrl} compact onClose={() => setLot(null)} />}
  </section>;
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

function Thumb({ src }: { src: string | null }) {
  if (!src) return <div className="market-thumb" />;
  return <img className="market-thumb" src={src} alt="" width={168} height={112} loading="lazy" decoding="async" />;
}

// This is a row-write-age warning only. vehicles.updated_at can change for any
// writer; it cannot verify source freshness or tell when a bid happened.
const STALE_MS = 45 * 60_000;

function BidCell({ auction, risen, stale }: { auction: LiveAuction; risen: boolean; stale: boolean }) {
  return (
    <Text role="measure"
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

// Where the lot should finish, in one line: the estimate and its 80% range; the measured confidence on hover.
// How far the bid has to run to the likely finish: "+15% to go", "at likely", or past it.
export function finishGap(bid: number | null | undefined, e: Pick<FinishEstimate, 'estimate'>): string | null {
  if (!bid || bid <= 0) return null;
  const g = e.estimate / bid - 1;
  if (g >= 0.005) return `+${Math.round(g * 100)}% to go`;
  if (g <= -0.005) return `${Math.abs(Math.round(g * 100))}% past likely`;
  return 'at likely';
}

// The finish under the bid: the likely number and how far there is to go, then a bar: the range eight in ten such lots
// finished inside (shaded), the likely finish (tick) and where the bid stands now (bar), so a lot that must still run
// reads at a glance.
export function FinishLine({ e, bid }: { e: FinishEstimate; bid?: number | null }) {
  const gap = finishGap(bid, e);
  const now = bid && bid > 0 ? bid : null;
  const lo = Math.min(e.low, now ?? e.low), hi = Math.max(e.high, now ?? e.high);
  const pad = (hi - lo) * 0.06 || hi * 0.05 || 1;
  const x = (v: number) => ((v - lo + pad) / (hi - lo + 2 * pad)) * 100;
  return <div className="market-lot-finish" title={e.sentence ?? undefined}>
    <Text role="caption" as="div">likely <strong>{bidNumber(e.estimate, true)}</strong>{gap ? ` · ${gap}` : ''} · {bidNumber(e.low, true)}–{bidNumber(e.high, true)}</Text>
    <svg className="market-lot-finish__bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img"
      aria-label={`likely ${bidNumber(e.estimate, true)}, range ${bidNumber(e.low, true)} to ${bidNumber(e.high, true)}${now ? `, bid ${bidNumber(now, true)}` : ''}`}>
      <rect x={x(e.low)} y="1.5" width={Math.max(0.5, x(e.high) - x(e.low))} height="5" className="market-lot-finish__band" />
      <line x1={x(e.estimate)} x2={x(e.estimate)} y1="0" y2="8" className="market-lot-finish__likely" />
      {now != null && <line x1={x(now)} x2={x(now)} y1="0" y2="8" className="market-lot-finish__bid" />}
    </svg>
  </div>;
}

function BoardRow({ a, risen, stale, detail, expanded, finish, onInspect }: {
  a: LiveAuction; risen: boolean; stale: boolean; detail?: MarketRowDetails; expanded: boolean; finish?: FinishEstimate;
  onInspect: (a: LiveAuction, view: LotInspection) => void;
}) {
  const [rowRef, seen] = useSeen<HTMLDivElement>();
  const reached = (seen || expanded) && !!detail;
  const specs = useMarketRowSpecs(a.id, reached);
  const facts = selectRowFacts(specs.data ?? [], title(a));
  // One bid per lot: the board's (vehicles.high_bid, synced every 15 min), the same number the figures and the finish
  // estimate use. The listing event's recorded price and the bid rows can trail it by hours (2026-10-15: a GT2 RS read
  // $582,000 on the board at 03:15Z while its event said $467,000 from 23:02Z).
  const bidReading = a;
  // A row says what the photo cannot: the time left, the bid and its pace, and no reserve. The venue is the page's.
  return (
    <div ref={rowRef} className="market-lot-row" data-vehicle-id={a.id} data-expanded={expanded}>
      <div className="market-lot-close">
        <Text role="label">Closes in</Text>
        <Countdown endsAt={a.endsAt} />
        {a.noReserve && <Text role="label" className="market-no-reserve">No reserve</Text>}
      </div>
      <button type="button" className="market-lot-image" onClick={() => onInspect(a, 'auction')}
        aria-label={`Inspect ${title(a)}`} aria-expanded={expanded} aria-controls={expanded ? `lot-inspection-${a.id}` : undefined}>
        <Thumb src={a.imageUrl} />
      </button>
      <div className="market-lot-identity">
        <button type="button" className="market-lot-name" onClick={() => onInspect(a, 'auction')}
          aria-expanded={expanded} aria-controls={expanded ? `lot-inspection-${a.id}` : undefined}><Text role="entity">{title(a)}</Text></button>
        <div className="market-lot-facts">
          {facts.map(f => <Text role="body" key={f.field} title={`${f.label}: ${f.value}${f.conflict ? ' · reports differ' : ''}`}>{f.value}</Text>)}
        </div>
      </div>
      <button type="button" className="market-lot-metrics" onClick={() => onInspect(a, 'auction')}
        aria-label={`Inspect auction for ${title(a)}`} aria-expanded={expanded}>
        <AuctionCompetition vehicleId={a.id} sourceUrl={a.listingUrl} row enabled={reached} bid={a.currentBid}
          fallback={<BidCell auction={bidReading} risen={risen} stale={stale} />} />
        {finish && <FinishLine e={finish} bid={a.currentBid} />}
      </button>
    </div>
  );
}

// The board is read a page at a time: PAGE lots, named in the URL (board=n), so a page is a link and the
// document never grows past one page. A shared link to a lot opens the page that holds it.
export const PAGE = 24;

function Board({ rows, risenIds, stale, activityId, finishes, inspection, onInspect, onInspectionChange, onClose }: {
  rows: LiveAuction[]; risenIds: Set<string>; stale: boolean; activityId: string | null; finishes?: Map<string, FinishEstimate>;
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
            <BoardRow a={a} risen={risenIds.has(a.id)} stale={stale} detail={detail} expanded={expanded} finish={finishes?.get(a.id)} onInspect={onInspect} />
            {expanded && <AuctionEvidence key={a.id} vehicleId={a.id} compact inspection={inspection} summary={detail}
              sourceUrl={a.listingUrl} onInspectionChange={onInspectionChange} onClose={onClose} />}
          </div>
        );
      })}
    </div>
  );
}

function inWindow(a: LiveAuction, w: Window, now: number): boolean {
  switch (w) {
    case '1h': return a.endsAt - now < HOUR;
    case '24h': return a.endsAt - now < DAY;
    case 'new': return now - a.listedAt < DAY;
    case 'nr': return a.noReserve;
    default: return true;
  }
}

export function matchesFamilyScope(a: LiveAuction, familyName: string | null): boolean {
  if (!familyName) return true;
  const f = familyName.trim().toLowerCase();
  if (!f || f === 'other models') return true;
  const m = (a.model ?? '').trim().toLowerCase();
  const t = (a.title ?? '').trim().toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`(^|[^a-z0-9])${esc(f)}($|[^a-z0-9])`, 'i');
  if (m === f || m.startsWith(`${f} `) || m.startsWith(`${f}-`) || wordRe.test(m) || wordRe.test(t)) return true;
  // A family whose members are its name plus a number: LC -> LC500, F-Series -> F-150, 3 Series -> 328i, C/K -> C10, K20.
  const stems = /^(.+?)[- ]series$/.test(f) ? [f.replace(/[- ]series$/, '')]
    : f.includes('/') ? f.split('/').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 3)
      : /[a-z]$/.test(f) ? [f] : [];
  const make = (a.make ?? '').trim().toLowerCase();
  return stems.some((s) => new RegExp(`^${esc(s)}-?\\d`, 'i').test(m)
    || (!!make && new RegExp(`(^|\\s)${esc(make)}\\s+${esc(s)}-?\\d`, 'i').test(t)));
}

export function matchesModelScope(a: LiveAuction, model: string | null): boolean {
  if (!model) return true;
  return recordedModel(a) === model || matchesFamilyScope(a, model);
}

export default function MarketPulse({ onUnavailable, collection }: { onUnavailable?: React.ReactNode; collection?: React.ReactNode }) {
  usePageTitle('Market');
  const { data, isLoading, isError, risenIds, refetch, dataUpdatedAt, newBids } = useMarketPulse();
  // A bell for each bid as it lands, off until the viewer turns it on.
  const [sound, setSound] = useState(false);
  useEffect(() => (sound && newBids?.length ? ringBids(newBids) : undefined), [newBids, sound]);
  const finish = useFinishEstimates();
  const [params, setParams] = useSearchParams();
  const boardRef = useRef<HTMLDivElement>(null);
  const focusBoardPage = useRef(false);

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
  const familyName = make ? params.get('family_name')?.trim() || null : null;
  const era = make ? params.get('era')?.trim() || null : null;
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
      ['family', 'family_name', 'year', 'era', 'mapFocus', 'mapChild'].forEach(k => next.delete(k));
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
    ['model', 'family', 'family_name', 'year', 'era', 'bidRange', 'day', 'series', 'salesScope', 'mapFocus', 'mapChild', 'board'].forEach(k => next.delete(k));
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
  const cohort = useMemo(() => live.filter(a => (make == null || a.make === make)
    && (model != null || matchesFamilyScope(a, familyName))
    && matchesEraRange(a.year, era)), [live, make, model, familyName, era]);
  const history = useBoardHistory(cohort, JSON.stringify([make, familyName, era, model != null]), !!data && !isLoading && !isError);
  const todayUtc = new Date(now).toISOString().slice(0, 10);
  const sameHour = useSameHourReadings(data?.sameHour?.hourUtc ?? '', todayUtc);
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
  const figures = useMemo(() => {
    const f: Record<Window, number> = { all: 0, '1h': 0, '24h': 0, new: 0, nr: 0 };
    for (const a of cohort) for (const w of WINDOWS) if (inWindow(a, w.id, now)) f[w.id] += 1;
    return f;
  }, [cohort, now]);
  const syncBehind = data?.syncedAt != null && now - data.syncedAt > STALE_MS;

  const scoped = useMemo(() => cohort.filter(a => inWindow(a, win, now)), [cohort, win, now]);
  const distribution = useMemo(() => currentBidDistribution(scoped), [scoped]);
  // The map shows the lots after the window and bid-range filters; a chosen make narrows it to that make's lots.
  const mappedInventory = useMemo(() => live.filter(a => inWindow(a, win, now)
    && (selectedBid == null || bidBucket(a.currentBid) === selectedBid)), [live, win, now, selectedBid]);

  const mapAuctions = useMemo(() => mappedInventory.filter(a => (make == null || a.make === make)
    && (model != null || matchesFamilyScope(a, familyName))
    && matchesEraRange(a.year, era)
    && (inventoryLens.group === 'model' || matchesModelScope(a, model))), [mappedInventory, make, model, familyName, era, inventoryLens.group]);
  const needsTaxonomy = inventoryLens.group === 'type' || inventoryLens.group === 'body';
  const taxonomyQuery = useInventoryTaxonomy(mapAuctions, view === 'inventory' && needsTaxonomy);
  const taxonomy = useMemo(() => taxonomyByListing(taxonomyQuery.data), [taxonomyQuery.data]);
  const mapFilterPending = needsTaxonomy && !taxonomyQuery.isSuccess && inventoryLens.focus != null;

  const board = useMemo(() => {
    const rows = scoped.filter(a => (selectedBid == null || bidBucket(a.currentBid) === selectedBid)
      && matchesModelScope(a, model)
      && matchesMapLens(a, inventoryLens, taxonomy));
    // Keep an inspected lot reachable while the board rolls past its deadline.
    if (pinnedAuction?.id === activityId && !rows.some(a => a.id === activityId)) rows.push(pinnedAuction);
    if (sort === 'bid') rows.sort((a, b) => (b.currentBid ?? 0) - (a.currentBid ?? 0));
    else if (sort === 'newest') rows.sort((a, b) => b.listedAt - a.listedAt);
    else rows.sort((a, b) => a.endsAt - b.endsAt);
    return rows;
  }, [scoped, selectedBid, sort, model, inventoryLens.group, inventoryLens.inside, inventoryLens.focus, inventoryLens.child, taxonomy, pinnedAuction, activityId]);

  // One page of the board. A link to a lot opens its page; a filter change returns to the first page.
  const pages = Math.max(1, Math.ceil(board.length / PAGE));
  const boardParam = Number(params.get('board'));
  const selectedIndex = activityId ? board.findIndex(a => a.id === activityId) : -1;
  const page = Number.isInteger(boardParam) && boardParam >= 1 ? Math.min(boardParam, pages)
    : selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE) + 1 : 1;
  const pageRows = useMemo(() => board.slice((page - 1) * PAGE, page * PAGE), [board, page]);
  useLayoutEffect(() => {
    if (!focusBoardPage.current || isLoading || mapFilterPending) return;
    focusBoardPage.current = false;
    boardRef.current?.scrollIntoView({ block: 'start' });
    (boardRef.current?.querySelector<HTMLButtonElement>('.market-lot-name') ?? boardRef.current)?.focus();
  }, [page, pageRows, isLoading, mapFilterPending]);
  const goToPage = (n: number) => {
    focusBoardPage.current = true;
    setParam('board', String(n));
  };


  // The page as a document. The venue is the entity. Its live total is the page's one figure, stated once against the
  // same hour in earlier weeks, and it opens into what it is made of (the map, by dollars). The lot count takes the
  // viewer to the lots. The clock says live, or how far behind the last board read is, and reads again on a press.
  const weekAgoPct = data?.weekAgo && make == null ? pctChange(liveBids, data.weekAgo.bids) : null;
  const rank = boardReadings.length ? rankOf(cohortBids, boardReadings) : null;
  // The lot count is compared as lots with a bid, the unit the hourly readings keep.
  const bidded = cohort.filter(a => a.currentBid != null).length;
  const lotReadings = (sameHour.data ?? []).flatMap((r) => make == null
    ? (r.n != null ? [{ day: r.day, v: r.n as number }] : [])
    : (r.byMake?.[make] ? [{ day: r.day, v: Number(r.byMake[make][1]) }] : []));
  const lotRank = lotReadings.length ? rankOf(bidded, lotReadings) : null;
  const lotWeekPct = data?.weekAgo && make == null && data.weekAgo.n > 0 ? pctChange(bidded, data.weekAgo.n) : null;
  const mapMeasure: 'bids' | 'lots' | null = params.get('map') === 'lots' ? 'lots' : params.get('map') ? 'bids' : null;
  const [reading, setReading] = useState(false);
  const readAgain = async () => { setReading(true); try { await refetch(); } finally { setReading(false); } };
  const toggleMap = (measure: 'bids' | 'lots') => {
    const next = new URLSearchParams(params);
    if (mapMeasure === measure) next.delete('map'); else next.set('map', measure);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const masthead = (
    <Masthead result={view === 'inventory' ? <button type="button" className="market-control market-clock" aria-busy={reading}
      onClick={() => void readAgain()} title={dataUpdatedAt > 0 ? `Board fetched ${clock(dataUpdatedAt)}; source capture time is unavailable here. Select to read again.` : 'Read the board'}>
      <Text role="label">{reading || isLoading ? '↻ reading…' : isError ? '↻ retry' : `↻ ${boardFreshness(dataUpdatedAt, Math.max(now, Date.now()))}`}</Text>
    </button> : undefined}>
      {view === 'inventory' ? <span className="market-venue">
        <img className="market-venue__mark" src="/vendor/bat/favicon.ico" alt="" width={32} height={32} />
        <Text role="entity" as="h1">Bring a Trailer{make ? ` · ${make}${familyName && !model ? ` · ${familyName}` : ''}${era ? ` · ${era.replace('-', '–')}` : ''}` : ''}</Text>
        <Text role="label">Live auctions</Text>
      </span> : <Text role="entity" as="h1">Recorded sales</Text>}
    </Masthead>
  );
  const at = (r: ReturnType<typeof rankOf> | null) => r?.text ? `${r.text} weeks at this hour` : null;
  const figure = view === 'inventory' ? (
    <section className="k-section market-figure" aria-label="The live board in numbers">
      <Figure value={isLoading ? '…' : bidNumber(cohortBids, true)} label="Bid now" open={mapMeasure === 'bids'} onToggle={() => toggleMap('bids')}
        title={`Current bids in US dollars as Bring a Trailer records them${data?.source ? ` (${data.source})` : ''}.${data?.weekAgo ? ` A week ago: ${bidNumber(data.weekAgo.bids)} across ${data.weekAgo.n.toLocaleString('en-US')} auctions at ${clock(data.weekAgo.at)}${data.weekAgo.source === 'archive' ? ', rebuilt from BaT bid history (96% of auctions)' : ''}.` : ''}`}
        relative={[weekAgoPct != null ? `${data?.weekAgo?.source === 'archive' ? '≈' : ''}${signed(weekAgoPct)} on a week ago` : null, at(rank)]}
        bar={data?.sameHour && boardReadings.length > 0 ? <RangeBar bare value={cohortBids} readings={boardReadings} fmt={bidNumber}
          weekdayUtc={data.sameHour.weekdayUtc} weeks={boardReadings.length} /> : undefined} />
      <Figure value={isLoading ? '…' : count(cohort.length)} label="Open lots" open={mapMeasure === 'lots'} onToggle={() => toggleMap('lots')}
        title={`Open lots on the board. Compared with earlier weeks as lots with a recorded bid number, $0 included (${count(bidded)} now), the unit the hourly readings keep.`}
        relative={[lotWeekPct != null ? `${signed(lotWeekPct)} on a week ago` : null, at(lotRank)]} />
    </section>
  ) : null;
  const scope = (
    <details className="market-navigation">
    <summary><Text role="label">Explore market · {view === 'inventory' ? 'BaT live auctions' : 'Recorded sales'}</Text></summary>
    <div className="k-section k-strip market-scope" role="group" aria-label="Market scope">
      <MarketScopeControls make={make} scopeKey={salesLens.scopeKey} view={view} onMakeChange={setCohort} onViewChange={v => setParam('view', v)}>{collection}</MarketScopeControls>
    </div>
    {view === 'inventory' && <div className="market-navigation__tools">
      <label><Text role="label">Sort lots </Text><select className="market-control" aria-label="Market navigation sort" value={sort} onChange={e => setParam('sort', e.target.value === 'ending' ? null : e.target.value)}>
        {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select></label>
      <button type="button" className="market-control" onClick={() => document.querySelector<HTMLButtonElement>('.market-figure__value')?.scrollIntoView({ block: 'center' })}><Text role="label">Headline numbers ↑</Text></button>
    </div>}
    </details>
  );

  if (!data && isError && view === 'inventory' && !activityId) return <>
    {masthead}
    {scope}
    <div role="status" className="market-status">Live BaT bids could not be loaded. <button className="market-control" onClick={() => refetch()}><Text role="label">Retry live board</Text></button></div>
    {onUnavailable}
  </>;

  // Filters and sorts sit on the lots they change. A count is said only when it narrows the open lots.
  const filtered = make != null || familyName != null || model != null || era != null || win !== 'all' || selectedBid != null || inventoryLens.focus != null;
  return (
    <div className="market-explorer">
      {masthead}
      {figure}

      {activityId && (view !== 'inventory' || !pageRows.some(a => a.id === activityId)) &&
        <AuctionEvidence key={activityId} vehicleId={activityId} compact inspection={inspection} onInspectionChange={setInspection} onClose={closeActivity} />}

      {scope}

      {view === 'inventory' && mapMeasure && <section id="market-composition" className="market-map" aria-label={mapMeasure === 'bids' ? 'What the bids are made of' : 'What the open lots are'}>
        <BoardHistory key={`${make}:${familyName}:${era}:${mapMeasure}`} samples={history} measure={mapMeasure} />
        {mapAuctions.length > 0 && <MarketInventoryMap auctions={mapAuctions} lens={inventoryLens} taxonomy={taxonomy} measure={mapMeasure}
          taxonomyLoading={taxonomyQuery.isLoading} taxonomyError={taxonomyQuery.isError} onRetryTaxonomy={() => { void taxonomyQuery.refetch(); }}
          risenIds={risenIds} selectedModel={model} onLensChange={setInventoryLens} onSelect={selectMapGroup} />}
      </section>}

      {view === 'inventory' && isError && data && <div role="status" className="market-status">Refresh failed. Showing the last fetched board. <button className="market-control" onClick={() => refetch()}><Text role="label">Retry</Text></button></div>}

      {view === 'sales' && <RecordedSalesComparison make={make} onMakeChange={setCohort} view={view} onViewChange={v => setParam('view', v)} lens={salesLens} onLensChange={setSalesLens} controls={false} />}

      {view === 'inventory' && <>
      {make && <nav aria-label="Inventory drill path" className="market-drill">
        <button type="button" className="market-control" onClick={() => setParam('make', null)}><Text role="label">All makes</Text></button>
        <span aria-hidden="true">→</span>
        <button type="button" className="market-control market-control--make" onClick={() => setParam('model', null)}><MakeLogo make={make} /><Text role="label">{make}</Text></button>
        {model && <><span aria-hidden="true">→</span><Text role="body">{model}</Text></>}
      </nav>}

      <div ref={boardRef} tabIndex={-1} className="market-board" aria-label="Live lots">
      <section className="market-board__frame">
        <div className="market-board__head">
          <div role="group" aria-label="Filter the lots" className="market-chips">
            {WINDOWS.filter((w) => w.id !== 'all' && (isLoading || win === w.id || figures[w.id] > 0)).map((w) => (
              <button key={w.id} type="button" className={`market-chip${w.id === 'nr' ? ' market-chip--nr' : ''}`} aria-pressed={win === w.id}
                title={w.id === 'new' ? 'First seen by Nuke in the last 24 h; the live page is read every 15 min' : undefined}
                onClick={() => setParam('live', win === w.id ? null : w.id)}>
                <Text role="label">{w.label}</Text> <Text role="measure" dense>{isLoading ? '…' : figures[w.id].toLocaleString('en-US')}</Text>
              </button>
            ))}
          </div>
          <div className="market-sorts" role="group" aria-label="Sort">
            {SORTS.map((s) => (
              <button key={s.id} type="button" className="market-control" aria-pressed={sort === s.id}
                onClick={() => setParam('sort', s.id === 'ending' ? null : s.id)}>
                <Text role="label">{s.label}</Text>
              </button>
            ))}
            <button type="button" className="market-control" aria-pressed={sound}
              title="A short bell for each bid as it lands, about a minute after Bring a Trailer records it"
              onClick={() => setSound(sound ? false : startBidChime())}>
              <Text role="label">{sound ? 'Bid sounds on' : 'Bid sounds off'}</Text>
            </button>
          </div>
        </div>
        {!isLoading && <details open={selectedBid != null} className="market-distribution">
          <summary><Text role="label">Filter by bid</Text></summary>
          <BidDistribution distribution={distribution} lots={scoped.length} scope={`${make ?? 'All makes'} · ${WINDOWS.find(w => w.id === win)?.label}`} selected={selectedBid} onSelect={b => setParam('bidRange', selectedBid === b ? null : b)} fetchedAt={dataUpdatedAt} />
        </details>}
        {filtered && !mapFilterPending && <Text role="caption" as="div" className="market-board__scope">
          {`${board.filter(a => a.endsAt > now).length.toLocaleString('en-US')} of ${live.length.toLocaleString('en-US')} lots`}
          {make ? ` · ${make}` : ''}{model ? ` · ${model}` : ''}
          {win !== 'all' ? ` · ${WINDOWS.find((w) => w.id === win)?.label}` : ''}
          {selectedBid ? ` · ${BID_BUCKETS.find(b => b.id === selectedBid)?.label}` : ''}
        </Text>}
        {mapFilterPending && <Text role="caption" as="div" className="market-board__scope">Reading classifications…</Text>}
        {!isLoading && !mapFilterPending && board.length === 0 && <div role="status" className="market-board__empty">No open lots match these filters. <button type="button" className="market-control" onClick={() => {
          const next = new URLSearchParams(params);
          ['make', 'family', 'family_name', 'year', 'era', 'live', 'bidRange', 'mapFocus', 'mapChild'].forEach(k => next.delete(k));
          next.delete('model');
          next.set('make', 'all');
          setParams(next, { replace: true });
        }}><Text role="label">Clear market filters</Text></button></div>}
        {isLoading || mapFilterPending ? null : <Board rows={pageRows} risenIds={risenIds} stale={syncBehind}
          activityId={activityId} finishes={finish.data?.byId} inspection={inspection} onInspect={openActivity} onInspectionChange={setInspection} onClose={closeActivity} />}
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
