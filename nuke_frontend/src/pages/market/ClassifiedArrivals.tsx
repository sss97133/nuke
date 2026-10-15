import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink } from '../../components/PrefetchLink';
import { Masthead, Text } from '../../kit';
import { sourceLink, sourceName } from './useCapturedListings';
import './ClassifiedArrivals.css';
import { ASK_SORTS, ASK_TIERS, ASK_WINDOWS, type AskRow, type AskSort, type AskTier, TIER_NAMES, readAskBoard, useAskBoard } from './useAskBoard';
import { photoList, useListingPhotos } from './useListingPhotos';
import { type PositionRead, headline, spreadLine } from './askPosition';
import { type ListingRead, readLines, requestListingRead } from './analyzeListing';
import { useAdminAccess } from '../../hooks/useAdminAccess';

// The classified asks that came online, nationwide, with three lenses: near the viewer, the owner's band, and the
// asking-price tier. The point stays in memory (never in the URL); logged out there is none until the viewer shares it.
const RADII = [100, 250, 500] as const;
const WINDOW_NAMES: Record<number, string> = { 24: 'last 24 hours', 72: 'last 3 days', 168: 'last 7 days' };
const SORT_NAMES: Record<AskSort, string> = { newest: 'Newest first', nearest: 'Nearest first', band: 'Band first', price: 'Cheapest first' };
type Locating = 'off' | 'asking' | 'on' | 'refused' | 'unavailable';

// How long ago, the way a feed says it: now, 12 min, 1 h 12 min, 5 h, 2 d. Minutes count while a listing is fresh,
// the first three hours (owner, 2026-10-15: "if listing is less than an hour put the minutes"); a full date and time is
// noise. Unknown stays unknown.
export function ageOf(value: string | null | undefined, now = Date.now()): string | null {
  const t = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 3 * 3600) { const m = Math.floor((s % 3600) / 60); return `${Math.floor(s / 3600)} h${m ? ` ${m} min` : ''}`; }
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
// A listing's name as a reader expects to see it: a word typed in lower case gets its capital, a word with digits is a
// code (SR5, F-150, K1500), and so is a short word with no vowel (XLT, GT, SS); a word already capitalised stays as the
// seller wrote it.
export function tidyName(value: string | null | undefined): string {
  return (value ?? '').split(/(\s+)/).map((w) => /\d/.test(w) ? w.toUpperCase()
    // a short word with no vowel is a trim code (xlt, gt, ss, ltz), not a word
    : /^[b-df-hj-np-tv-xz]{2,4}$/.test(w) ? w.toUpperCase()
    : /^[a-z][a-z'.-]*$/.test(w) && w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w).join('');
}
// The source as a small mark, not a word: the platform's own icon, kept in the repo, with its name for screen readers.
const SOURCE_MARKS: Record<string, string> = {
  craigslist: '/vendor/craigslist/favicon.ico', facebook_marketplace: '/vendor/facebook/favicon.ico', ksl: '/vendor/ksl/favicon.ico',
};
// The reader's as_of is when it read this snapshot. Posting age does not establish successful source capture.
export function freshness(readAt: string | null | undefined, now = Date.now()): string {
  const t = readAt ? Date.parse(readAt) : NaN;
  if (!Number.isFinite(t) || t > now) return 'refresh';
  const age = ageOf(readAt, now);
  return age === 'now' ? 'read just now' : `read ${age} ago`;
}
// Live means our intake captured a listing within one cycle (poll-listing-feeds runs every 15 minutes): the reader's
// newest_seen_at, the newest first sighting it can show (20261015150000), which is capture time, not posting time.
// Owner, 2026-10-15: the board reads live, or how far behind it is, not a clock. Null when the reader has no capture
// time; the control then states the read age.
const LIVE_MS = 20 * 60_000;
export function captureFreshness(seenAt: string | null | undefined, now = Date.now()): string | null {
  const t = seenAt ? Date.parse(seenAt) : NaN;
  if (!Number.isFinite(t) || t > now + 60_000) return null;
  return now - t < LIVE_MS ? 'live' : `${ageOf(seenAt, now)} behind`;
}
// When a listing went up: the reader's listed_at (20261015070000), else the post time when it precedes the first
// sighting, else the first sighting. Capture trails posting (median 6.5 h on 2026-10-15), so first seen is not age.
type Timed = { first_seen_at: string; posted_at?: string | null; listed_at?: string | null };
export function listedAt(row: Timed): string {
  if (row.listed_at) return row.listed_at;
  const posted = row.posted_at ? Date.parse(row.posted_at) : NaN;
  return Number.isFinite(posted) && posted < Date.parse(row.first_seen_at) ? row.posted_at as string : row.first_seen_at;
}
// The newest listing a board knows: the reader's newest_at, else its newest row.
export function newestOf(board: { newest_at?: string | null; rows: Timed[] } | undefined): string | null {
  if (!board) return null;
  if (board.newest_at) return board.newest_at;
  const times = board.rows.map(row => Date.parse(listedAt(row))).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}
// Listings that went up after a moment, counted from a newest-first page.
export function arrivalsAfter(rows: Timed[], since: string | null): number {
  const t = since ? Date.parse(since) : NaN;
  return Number.isFinite(t) ? rows.filter(row => Date.parse(listedAt(row)) > t).length : 0;
}
// The miles and title as the listing states them. A seller-disclosed broken odometer is not a mileage, so no number is
// shown for it; a rolled-over one says so beside the number. A title other than clean is said; clean goes unsaid.
export function listingFacts(row: Pick<AskRow, 'mileage' | 'listing_mileage' | 'odometer' | 'title_status'>): { miles: string | null; title: string | null } {
  const n = row.listing_mileage ?? row.mileage;
  const miles = row.odometer === 'broken' ? 'odometer broken'
    : n != null ? `${n.toLocaleString('en-US')} mi${row.odometer === 'rolled_over' ? ', rolled over' : ''}` : null;
  const title = row.title_status && row.title_status !== 'clean' ? `${row.title_status} title` : null;
  return { miles, title };
}
// The listing's photos on its card: the board's image first, the rest a swipe (phone) or an arrow (pointer) away, and
// how many there are. Owner, 2026-10-15, choosing between three cards: "based on one photo here… you're not pulling
// all the pictures". The photo still opens the record; a photo that fails to load drops out of the count.
function ListingPhotos({ urls, to, label }: { urls: string[]; to: string; label: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const shown = urls.filter(src => !failed.has(src));
  const step = (by: number) => { const el = strip.current; if (el) el.scrollBy({ left: by * el.clientWidth, behavior: 'smooth' }); };
  const onScroll = () => { const el = strip.current; if (el?.clientWidth) setAt(Math.round(el.scrollLeft / el.clientWidth)); };
  return <div className="market-ask__photos">
    <PrefetchLink to={to} className="market-ask__image" aria-label={label} tabIndex={-1}>
      {shown.length ? <div className="market-ask__strip" ref={strip} onScroll={onScroll}>
        {shown.map(src => <img key={src} src={src} width="240" height="160" loading="lazy" alt=""
          onError={() => setFailed(prev => new Set(prev).add(src))} />)}
      </div> : <span className="market-ask__blank" />}
    </PrefetchLink>
    {shown.length > 1 && <>
      <button type="button" className="market-ask__step market-ask__step--back" aria-label="Previous photo" disabled={at <= 0}
        onClick={() => step(-1)}><Text role="measure">‹</Text></button>
      <button type="button" className="market-ask__step market-ask__step--next" aria-label="Next photo" disabled={at >= shown.length - 1}
        onClick={() => step(1)}><Text role="measure">›</Text></button>
      <Text role="caption" className="market-ask__count" aria-label={`photo ${Math.min(at + 1, shown.length)} of ${shown.length}`}>
        {Math.min(at + 1, shown.length)} / {shown.length}</Text>
    </>}
  </div>;
}
const count = (n: number | undefined) => (n ?? 0).toLocaleString('en-US');
const dollars = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

// The ask on a price line: the middle half of the population it is placed by (p25 to p75), its median, and the ask.
function PriceStrip({ ask, p25, p50, p75 }: { ask: number; p25: number; p50: number | null; p75: number }) {
  const lo = Math.min(p25, ask), hi = Math.max(p75, ask);
  const pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
  const x = (v: number) => ((v - lo + pad) / (hi - lo + 2 * pad)) * 100;
  return <svg className="market-ask__price" viewBox="0 0 100 10" preserveAspectRatio="none" role="img"
    aria-label={`ask ${dollars(ask)}; middle half ${dollars(p25)} to ${dollars(p75)}${p50 != null ? `, median ${dollars(p50)}` : ''}`}>
    <line x1="0" x2="100" y1="5" y2="5" className="market-ask__axis" />
    <rect x={x(p25)} y="2" width={Math.max(0.5, x(p75) - x(p25))} height="6" className="market-ask__band" />
    {p50 != null && <line x1={x(p50)} x2={x(p50)} y1="1" y2="9" className="market-ask__median" />}
    <line x1={x(ask)} x2={x(ask)} y1="0" y2="10" className="market-ask__at" />
  </svg>;
}

// Where the ask lands, under its price: a word, the price line, then a line per population, the one it is placed by
// first. Nothing when the reader has no position for the row.
// The owner's Analyze control: a photo read of this one listing on request, shown on the card once it returns. Only an
// admin sees it; the route refuses everyone else and caps reads a day.
function AnalyzeControl({ vehicleId }: { vehicleId: string }) {
  const [state, setState] = useState<{ busy: boolean; read?: ListingRead; error?: string }>({ busy: false });
  const run = async () => {
    setState({ busy: true });
    try { setState({ busy: false, read: await requestListingRead(vehicleId) }); }
    catch (err) { setState({ busy: false, error: err instanceof Error ? err.message : String(err) }); }
  };
  if (state.read) return <div className="market-ask__read">{readLines(state.read).map(line => <Text key={line} role="caption" as="div">{line}</Text>)}</div>;
  return <div className="market-ask__read">
    <button type="button" className="market-control" aria-busy={state.busy} disabled={state.busy} onClick={() => void run()}
      title="Read this listing's photos for condition (admins; YONO first, otherwise your connected provider pays)">
      <Text role="label">{state.busy ? 'Reading photos…' : 'Analyze photos'}</Text></button>
    {state.error && <Text role="caption" as="div">{state.error}</Text>}
  </div>;
}

// The board's position and the seller's stated condition (classified_ask_board 20261015150000).
type PlacedRow = AskRow & { position?: PositionRead | null; condition?: string | null };

function AskPlacement({ ask, position }: { ask: number | null; position?: PositionRead | null }) {
  const head = headline(position);
  const lines = [spreadLine(position?.sold, 'sales'), spreadLine(position?.asked, 'asks')];
  if (head?.basis === 'asks') lines.reverse();
  if (!head && !lines.some(Boolean)) return null;
  const basis = head ? (head.basis === 'sales' ? position?.sold : position?.asked) : null;
  return <div className="market-ask__position">
    {head && <Text role="label" as="div">{head.word}{head.span ? ` · ${head.span}` : ''}</Text>}
    {ask != null && basis?.p25 != null && basis.p75 != null && <PriceStrip ask={ask} p25={basis.p25} p50={basis.p50} p75={basis.p75} />}
    {lines.filter(Boolean).map(line => <Text key={line} role="caption" as="div">{line}</Text>)}
  </div>;
}

export default function ClassifiedArrivals({ collection, sourcePicker }: { collection?: ReactNode; sourcePicker?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };
  const hours = ASK_WINDOWS.find(h => String(h) === params.get('window')) ?? 24;
  const tier = (ASK_TIERS as readonly string[]).includes(params.get('tier') ?? '') ? params.get('tier') as AskTier : null;
  const band = params.get('band') === '1';
  const near = params.get('near') === '1';
  const radius = RADII.find(r => String(r) === params.get('radius')) ?? null;
  const requestedSort = (ASK_SORTS as readonly string[]).includes(params.get('sort') ?? '') ? params.get('sort') as AskSort : null;

  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<Locating>('off');
  useEffect(() => {
    if (!near) { setLocating('off'); return; }
    if (point) { setLocating('on'); return; }
    if (!('geolocation' in navigator)) { setLocating('unavailable'); return; }
    let live = true;
    setLocating('asking');
    navigator.geolocation.getCurrentPosition(
      position => { if (!live) return;
        setPoint({ lat: Math.round(position.coords.latitude * 100) / 100, lng: Math.round(position.coords.longitude * 100) / 100 });
        setLocating('on'); },
      () => { if (live) setLocating('refused'); },
      { maximumAge: 600_000, timeout: 15_000 },
    );
    return () => { live = false; };
  }, [near, point]);

  const located = near && point ? point : null;
  const sort: AskSort = requestedSort === 'nearest' && !located ? 'newest' : requestedSort ?? (located ? 'nearest' : 'newest');
  const askQuery = useMemo(() => ({ hours, tier, band, sort, point: located, radius: located ? radius : null }),
    [hours, tier, band, sort, located, radius]);
  const query = useAskBoard(askQuery, !near || locating !== 'asking');
  const first = query.data?.pages[0];
  const population = first?.population;
  const rows = query.data?.pages.flatMap(page => page.rows) ?? [];
  const { isAdmin } = useAdminAccess();
  const pageIds = useMemo(() => (query.data?.pages ?? []).map(page => page.rows.map(row => row.vehicle_id)), [query.data]);
  const photos = useListingPhotos(pageIds);

  // Refresh in place: the control sits top right, shows that it is reading, then says what arrived. The list keeps the
  // reader's place (the newest arrive above it), unlike a pull that jumps. Every two minutes, while the tab is shown,
  // a newest-first read of the same lenses counts what landed since this read; the control then offers "N new".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);
  const shownNewest = newestOf(first);
  const [polled, setPolled] = useState<{ newest: string | null; waiting: number } | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  useEffect(() => {
    setPolled(null);
    setPollFailed(false);
    if (!shownNewest) return;
    let active = true;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      readAskBoard({ ...askQuery, sort: 'newest' }, 0)
        .then(board => { if (active) { setPolled({ newest: newestOf(board), waiting: arrivalsAfter(board.rows, shownNewest) }); setPollFailed(false); } })
        .catch(() => { if (active) setPollFailed(true); });
    }, 120_000);
    return () => { active = false; window.clearInterval(id); };
  }, [askQuery, shownNewest]);
  const [arrived, setArrived] = useState<number | null>(null);
  const shownAt = useRef<string | null>(null);
  const refresh = async () => {
    setArrived(null);
    shownAt.current = shownNewest;
    const result = await query.refetch();
    if (result.isError) return;
    setPollFailed(false); setPolled(null);
    setArrived(arrivalsAfter(result.data?.pages[0]?.rows ?? [], shownAt.current)); setNow(Date.now());
    window.setTimeout(() => setArrived(null), 6_000);
  };
  const capturedAt = (first as (typeof first & { newest_seen_at?: string | null }) | undefined)?.newest_seen_at ?? null;
  const control = query.isFetching ? '↻ reading…'
    : query.isError || pollFailed ? '↻ retry'
    : !first ? '↻ reading…'
    : polled?.waiting ? `↻ ${count(polled.waiting)}${polled.waiting >= 60 ? '+' : ''} new`
    : `↻ ${captureFreshness(capturedAt, Math.max(now, Date.now())) ?? freshness(first.as_of, Math.max(now, Date.now()))}`;

  return <section aria-label="Classified arrivals" className="market-explorer">
    <Masthead result={<>
      <button type="button" className="market-control" aria-busy={query.isFetching} onClick={() => void refresh()}
        title={pollFailed ? 'Latest check failed. Showing the last fetched listings; select to retry.'
          : capturedAt ? 'Live when our intake captured a listing in the last 20 minutes; otherwise how long since it last did. Select to read the newest.'
          : 'Read the newest listings; the read clock does not establish source capture freshness.'}>
        <Text role="label">{control}</Text>
      </button>
      {arrived !== null && <Text role="caption" as="div">{arrived > 0 ? `${count(arrived)} new` : 'nothing new yet'}</Text>}
    </>}>
      <Text role="entity" as="h1">Classifieds</Text>
    </Masthead>
    <div className="k-section k-strip market-scope" role="group" aria-label="Market view">
      <div role="group" aria-label="Market view" className="market-scope__views">{collection}</div>
    </div>
    <details className="k-section market-filters">
      <summary><Text role="label">Filters</Text></summary>
    <div className="k-section k-strip market-scope" role="group" aria-label="Arrivals scope">
      {sourcePicker}
      <label className="market-scope__cohort"><Text role="label">First captured</Text><select className="market-control k-body" value={hours}
        onChange={event => set('window', event.target.value === '24' ? null : event.target.value)}>
        {ASK_WINDOWS.map(h => <option key={h} value={h}>{WINDOW_NAMES[h]}</option>)}
      </select></label>
      <div role="group" aria-label="Lenses" className="market-scope__views">
        <button type="button" className="market-control" aria-pressed={near} onClick={() => set('near', near ? null : '1')}>
          <Text role="label">Near me</Text></button>
        <button type="button" className="market-control" aria-pressed={band} onClick={() => set('band', band ? null : '1')}
          title={`Taste score ${first?.band_min_taste ?? 60} or more (compute_taste_score)`}>
          <Text role="label">My band</Text></button>
      </div>
      {near && <label className="market-scope__cohort"><Text role="label">Within</Text><select className="market-control k-body" value={radius ?? ''}
        disabled={!located} onChange={event => set('radius', event.target.value || null)}>
        <option value="">any distance</option>{RADII.map(r => <option key={r} value={r}>{r} miles</option>)}
      </select></label>}
      <label className="market-scope__cohort"><Text role="label">Order</Text><select className="market-control k-body" value={sort}
        onChange={event => set('sort', event.target.value)}>
        {ASK_SORTS.filter(s => s !== 'nearest' || located).map(s => <option key={s} value={s}>{SORT_NAMES[s]}</option>)}
      </select></label>
      <Text role="caption" className="market-scope__note">{near && locating === 'asking' ? 'Asking the browser for your location…'
        : near && locating === 'refused' ? 'Location not shared; showing the whole country.'
        : near && locating === 'unavailable' ? 'This browser has no location; showing the whole country.'
        : 'Asking prices as listed on US classifieds, in dollars; availability and source-wide coverage are unverified.'}</Text>
    </div>
    {population && <div className="k-section k-strip market-scope" role="group" aria-label="Price tiers">
      <div role="group" aria-label="Tier" className="market-scope__views">
        {ASK_TIERS.map(t => <button key={t} type="button" className="market-control" aria-pressed={tier === t}
          onClick={() => set('tier', tier === t ? null : t)}>
          <Text role="label">{TIER_NAMES[t]} · {count(population.by_tier[t])}</Text></button>)}
      </div>
      <Text role="caption" className="market-scope__note">
        {count(population.priced)} of {count(population.asks)} priced ({count(population.by_tier.unpriced)} without a price) · {count(population.with_point)} with a recorded place · {count(population.in_band)} in the band (taste {first?.band_min_taste ?? 60}+) · {Object.entries(population.by_source).map(([s, n]) => `${sourceName(s)} ${count(n)}`).join(', ') || 'no source'}
      </Text>
    </div>}
    </details>
    {query.isPending && <p role="status" className="k-body">Reading arrivals…</p>}
    {query.isError && <p role="status" className="k-body">Arrivals could not be read. <button type="button" className="market-control" onClick={() => void query.refetch()}><Text role="label">Retry</Text></button></p>}
    {first && !rows.length && <p role="status" className="k-body">{located && population?.with_point === 0
      ? 'No ask in this window has a recorded place yet.' : 'No ask in this window matches these lenses.'}</p>}
    {rows.length > 0 && <div className="market-asks" role="list" aria-label="Classifieds">{rows.map(row => {
      const href = sourceLink(row.source, row.url);
      const identity = [row.year, tidyName(row.make), tidyName(row.model)].filter(Boolean).join(' ');
      const urls = photoList(row.image, photos.get(row.vehicle_id));
      // The photo says the body and drive; the card says what it cannot: what the listing states about its miles and
      // title, where it is, what it asks, and how long it has been up.
      const said = listingFacts(row);
      const age = ageOf(listedAt(row), now);
      const seen = age ? (age === 'now' ? 'just now' : `${age} ago`) : '';
      const mark = SOURCE_MARKS[row.source];
      const place = [row.city, row.region].filter(Boolean).join(', ');
      return <article key={row.event_id} role="listitem" className="market-ask">
        <ListingPhotos urls={urls} to={`/vehicle/${row.vehicle_id}`} label={identity || 'Vehicle identity unrecorded'} />
        <div className="market-ask__identity">
          <PrefetchLink to={`/vehicle/${row.vehicle_id}`}><Text role="entity">{identity || 'Vehicle identity unrecorded'}</Text></PrefetchLink>
          {(said.miles || said.title) && <Text role="body" as="div">{said.miles}{said.miles && said.title ? ' · ' : ''}{said.title && <strong>{said.title}</strong>}</Text>}
          <Text role="caption" as="div" className="market-ask__seen">
            {mark ? <img className="market-ask__mark" src={mark} width={14} height={14} alt={sourceName(row.source)} title={sourceName(row.source)} />
              : <span>{sourceName(row.source)} · </span>}
            {href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${sourceName(row.source)} listing, ${seen}`}>{seen}</a> : seen}
          </Text>
        </div>
        <div className="market-ask__deal">
          {row.asking_price == null ? <Text role="caption">Unpriced</Text>
            : <Text role="measure">${Number(row.asking_price).toLocaleString('en-US')}</Text>}
          <Text role="body" as="div">{place || 'Place unrecorded'}{row.distance_mi != null ? ` · ${row.distance_mi.toLocaleString('en-US')} mi away` : ''}</Text>
          <AskPlacement ask={row.asking_price == null ? null : Number(row.asking_price)} position={(row as PlacedRow).position} />
          {isAdmin && <AnalyzeControl vehicleId={row.vehicle_id} />}
        </div>
      </article>;
    })}</div>}
    {query.hasNextPage && <button type="button" className="market-control" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
      <Text role="label">{query.isFetchingNextPage ? 'Reading more…' : `Load more (${count(rows.length)} of ${count(first?.matching)})`}</Text></button>}
  </section>;
}
