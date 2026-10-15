import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink } from '../../components/PrefetchLink';
import { MakeIdentity, VehicleIdentity } from '../../components/common/MakeIdentity';
import { Masthead, Text } from '../../kit';
import { sourceLink, sourceName } from './useCapturedListings';
import { ASK_SORTS, ASK_TIERS, ASK_WINDOWS, type AskSort, type AskTier, TIER_NAMES, readAskBoard, useAskBoard } from './useAskBoard';

// The classified asks that came online, nationwide, with three lenses: near the viewer, the owner's band, and the
// asking-price tier. The point stays in memory (never in the URL); logged out there is none until the viewer shares it.
const RADII = [100, 250, 500] as const;
const WINDOW_NAMES: Record<number, string> = { 24: 'last 24 hours', 72: 'last 3 days', 168: 'last 7 days' };
const SORT_NAMES: Record<AskSort, string> = { newest: 'Newest first', nearest: 'Nearest first', band: 'Band first', price: 'Cheapest first' };
type Locating = 'off' | 'asking' | 'on' | 'refused' | 'unavailable';

// How long ago, the way a feed says it: now, 12 min, 3 h, 2 d. The page reads as live; a full date and time is noise
// (owner, 2026-10-15). Unknown stays unknown.
export function ageOf(value: string | null | undefined, now = Date.now()): string | null {
  const t = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
// Live means the newest arrival is within one intake cycle: poll-listing-feeds runs every 15 minutes (96 of 96 runs in
// the 24 h to 2026-10-15 01:30Z), so 20 minutes allows a cycle and its processing. Past that the board says how far
// behind it is, whether the intake stalled or the page has sat unread.
const LIVE_MS = 20 * 60_000;
export function freshness(newestAt: string | null | undefined, now = Date.now()): string {
  const t = newestAt ? Date.parse(newestAt) : NaN;
  if (!Number.isFinite(t)) return 'refresh';
  return now - t < LIVE_MS ? 'live' : `${ageOf(newestAt, now)} behind`;
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
function vehicleImage(value?: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const count = (n: number | undefined) => (n ?? 0).toLocaleString('en-US');

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

  // Refresh in place: the control sits top right, shows that it is reading, then says what arrived. The list keeps the
  // reader's place (the newest arrive above it), unlike a pull that jumps. Every two minutes, while the tab is shown,
  // a newest-first read of the same lenses counts what landed since this read; the control then offers "N new".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);
  const shownNewest = newestOf(first);
  const [polled, setPolled] = useState<{ newest: string | null; waiting: number } | null>(null);
  useEffect(() => {
    setPolled(null);
    if (!shownNewest) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      readAskBoard({ ...askQuery, sort: 'newest' }, 0)
        .then(board => setPolled({ newest: newestOf(board), waiting: arrivalsAfter(board.rows, shownNewest) }))
        .catch(() => { /* the next tick reads again */ });
    }, 120_000);
    return () => window.clearInterval(id);
  }, [askQuery, shownNewest]);
  const [arrived, setArrived] = useState<number | null>(null);
  const shownAt = useRef<string | null>(null);
  const refresh = async () => {
    shownAt.current = shownNewest;
    const result = await query.refetch();
    setArrived(arrivalsAfter(result.data?.pages[0]?.rows ?? [], shownAt.current)); setNow(Date.now());
    window.setTimeout(() => setArrived(null), 6_000);
  };
  const polledNewest = polled?.newest ?? null;
  const latest = shownNewest && polledNewest && Date.parse(polledNewest) > Date.parse(shownNewest) ? polledNewest : shownNewest ?? polledNewest;
  const control = query.isFetching ? '↻ reading…'
    : !first ? '↻ reading…'
    : polled?.waiting ? `↻ ${count(polled.waiting)}${polled.waiting >= 60 ? '+' : ''} new`
    : `↻ ${freshness(latest, now)}`;

  return <section aria-label="Classified arrivals" className="market-explorer">
    <Masthead result={<>
      <button type="button" className="market-control" aria-busy={query.isFetching} onClick={() => void refresh()}
        title="Read the newest listings">
        <Text role="label">{control}</Text>
      </button>
      {arrived !== null && <Text role="caption" as="div">{arrived > 0 ? `${count(arrived)} new` : 'nothing new yet'}</Text>}
    </>}>
      <Text role="entity" as="h1">Just listed</Text>
    </Masthead>
    <div className="k-section k-strip market-scope" role="group" aria-label="Market view">
      <div role="group" aria-label="Market view" className="market-scope__views">{collection}</div>
    </div>
    <details className="k-section market-filters">
      <summary><Text role="label">Filters</Text></summary>
    <div className="k-section k-strip market-scope" role="group" aria-label="Arrivals scope">
      {sourcePicker}
      <label className="market-scope__cohort"><Text role="label">Window</Text><select className="market-control k-body" value={hours}
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
    {rows.length > 0 && <div className="market-listings__scroll"><table className="market-listings">
      <thead><tr><th scope="col"><Text role="label">Listing / vehicle</Text></th><th scope="col"><Text role="label">Asking</Text></th>
        <th scope="col"><Text role="label">Place</Text></th></tr></thead>
      <tbody>{rows.map(row => {
        const href = sourceLink(row.source, row.url);
        const identity = [row.year, row.make, row.model].filter(Boolean).join(' ');
        const image = vehicleImage(row.image);
        // The photo says the body and drive; the row carries what it cannot: miles, and how old the listing is.
        const specs = row.mileage ? `${row.mileage.toLocaleString('en-US')} mi` : '';
        const age = ageOf(listedAt(row), now);
        const seen = [sourceName(row.source), age && (age === 'now' ? 'just now' : `${age} ago`)].filter(Boolean).join(' · ');
        return <tr key={row.event_id}>
          <td>{image && <img className="market-listing__image" src={image} width="80" height="60" loading="lazy" alt="Vehicle record image" onError={event => { event.currentTarget.hidden = true; }} />}
            <Text role="entity" dense as="div"><PrefetchLink to={`/vehicle/${row.vehicle_id}`} aria-label={identity || 'Vehicle identity unrecorded'}>
              {row.make && row.model ? <VehicleIdentity year={row.year} make={row.make} model={row.model} />
                : row.make ? <>{row.year ?? ''} <MakeIdentity make={row.make} /></> : identity || 'Vehicle identity unrecorded'}
            </PrefetchLink></Text>
            {specs && <Text role="caption" as="div">{specs}</Text>}
            <Text role="caption" as="div">{href ? <a href={href} target="_blank" rel="noopener noreferrer">{seen}</a> : seen}</Text></td>
          <td>{row.asking_price == null ? <Text role="caption">Unpriced</Text>
            : <><Text role="measure" dense>${Number(row.asking_price).toLocaleString('en-US')}</Text> <Text role="caption">· asking</Text></>}
          </td>
          <td>{row.city || row.region ? <Text role="body" as="div">{[row.city, row.region].filter(Boolean).join(', ')}</Text> : <Text role="caption" as="div">Place unrecorded</Text>}
            {row.distance_mi != null && <Text role="caption" as="div">{row.distance_mi.toLocaleString('en-US')} mi away</Text>}</td>
        </tr>;
      })}</tbody>
    </table></div>}
    {query.hasNextPage && <button type="button" className="market-control" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
      <Text role="label">{query.isFetchingNextPage ? 'Reading more…' : `Load more (${count(rows.length)} of ${count(first?.matching)})`}</Text></button>}
  </section>;
}
