import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import { CoverageView, Masthead, Text } from '../../kit';
import { timeLeft, useSecondClock } from '../../hooks/useSecondClock';
import MarketInventoryMap from './MarketInventoryMap';
import { mapLens, mapValue, matchesMapLens, recordedModel, taxonomyByListing, type InventoryMapLens, type InventoryMapGroup, type MapDimension } from './inventoryMap';
import AuctionEvidence, { AuctionCompetition } from './AuctionEvidence';
import { BID_BUCKETS, bidBucket, currentBidDistribution, useMarketPulse, useInventoryTaxonomy, type BidBucket, type LiveAuction } from './useMarketPulse';
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

type Window = 'all' | '1h' | '24h' | 'new' | 'nr';
type Sort = 'ending' | 'bid' | 'newest';

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

function BoardRow({ a, risen, stale, detail, expanded, onInspect }: {
  a: LiveAuction; risen: boolean; stale: boolean; detail?: MarketRowDetails; expanded: boolean;
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

function Board({ rows, risenIds, stale, activityId, inspection, onInspect, onInspectionChange, onClose }: {
  rows: LiveAuction[]; risenIds: Set<string>; stale: boolean; activityId: string | null;
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
            <BoardRow a={a} risen={risenIds.has(a.id)} stale={stale} detail={detail} expanded={expanded} onInspect={onInspect} />
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

export default function MarketPulse({ onUnavailable, collection }: { onUnavailable?: React.ReactNode; collection?: React.ReactNode }) {
  usePageTitle('Market');
  const { data, isLoading, isError, risenIds, refetch, dataUpdatedAt } = useMarketPulse();
  const [params, setParams] = useSearchParams();
  const boardRef = useRef<HTMLDivElement>(null);

  const makeParam = params.get('make')?.toUpperCase();
  const make = makeParam === 'ALL' ? null : makeParam ?? null;
  const view = params.get('view') === 'sales' ? 'sales' : 'inventory';
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
  // The board has no bound currency contract: no monetary heat, no hot/cold verdicts, until units can be matched.
  const figures = useMemo(() => {
    const f: Record<Window, number> = { all: 0, '1h': 0, '24h': 0, new: 0, nr: 0 };
    for (const a of cohort) for (const w of WINDOWS) if (inWindow(a, w.id, now)) f[w.id] += 1;
    return f;
  }, [cohort, now]);
  const syncBehind = data?.syncedAt != null && now - data.syncedAt > STALE_MS;

  const scoped = useMemo(() => cohort.filter(a => inWindow(a, win, now)), [cohort, win, now]);
  const distribution = useMemo(() => currentBidDistribution(scoped), [scoped]);
  // The make map is the wider inventory context. Window/range changes reshape its actual population;
  // the selected make is highlighted within it rather than erasing all other brands.
  const mappedInventory = useMemo(() => live.filter(a => inWindow(a, win, now)
    && (selectedBid == null || bidBucket(a.currentBid) === selectedBid)), [live, win, now, selectedBid]);

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
  const goToPage = (n: number) => {
    setParam('board', String(n));
    requestAnimationFrame(() => boardRef.current?.scrollIntoView({ block: 'start' }));
  };


  // The page as a document: the population is the entity, its count the headline result, and the scope strip
  // carries the view, the cohort and the coverage of the cohort within the captured population.
  const masthead = (
    <Masthead result={view === 'inventory' ? <>
      <Text role="measure" as="div">{isLoading ? '…' : cohort.length.toLocaleString('en-US')}</Text>
      {data?.syncedAt != null && <Text role="caption" as="div" title={data.source}>recorded {clock(data.syncedAt)}{syncBehind ? ' · over 45 min ago' : ''}</Text>}
    </> : undefined}>
      <Text role="entity" as="h1">{view === 'inventory' ? 'Open lots' : 'Recorded sales'}</Text>
    </Masthead>
  );
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

      {view === 'inventory' && isError && data && <div role="status" className="market-status">Refresh failed. Showing the last fetched board. <button className="market-control" onClick={() => refetch()}><Text role="label">Retry</Text></button></div>}

      {activityId && (view !== 'inventory' || !pageRows.some(a => a.id === activityId)) &&
        <AuctionEvidence key={activityId} vehicleId={activityId} compact inspection={inspection} onInspectionChange={setInspection} onClose={closeActivity} />}

      {scope}

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
            title={w.id === 'new' ? 'First seen by Nuke in the last 24 h; the live page is read every 15 min' : undefined}
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
        {isLoading || mapFilterPending ? null : <Board rows={pageRows} risenIds={risenIds} stale={syncBehind}
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
