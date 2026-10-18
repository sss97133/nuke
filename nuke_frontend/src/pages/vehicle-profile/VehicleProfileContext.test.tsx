// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../hooks/useVehiclePermissions', () => ({ useVehiclePermissions: () => ({
  isOwner: false, hasContributorAccess: false, contributorRole: null, canEdit: false,
}) }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => ({ isAdmin: false }) }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView() {}, endView() {} }) }));
vi.mock('./hooks/useVehicleIntel', () => ({ useVehicleIntel: () => ({ vehicleIntel: null, vehicleIntelLoading: false }) }));
import { VehicleProfileProvider, useVehicleProfile } from './VehicleProfileContext';
import QuickStatsBar from './QuickStatsBar';
import { PopupStackContext } from '../../components/popups/PopupStack';
import { CommentsPopup } from '../../components/popups/CommentsPopup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' },
});
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
type RequestRecord = { url: URL; method: string; body: any; headers: Headers };
let root: Root, container: HTMLDivElement, go: ReturnType<typeof useNavigate>;
let current: ReturnType<typeof useVehicleProfile>, a: string, b: string, merged: string;
let serial = 0;
let frames: any[], requests: RequestRecord[], functions: ReturnType<typeof vi.fn>;
let allowedSyntheticScrapes: Set<string>;
let popupCalls: { content: React.ReactElement<any>; title: string }[];
let reply: (request: RequestRecord) => Response | Promise<Response> | undefined;

function Probe() {
  current = useVehicleProfile();
  const location = useLocation();
  go = useNavigate();
  const frame = {
    path: location.pathname, route: current.vehicleId, vehicle: current.vehicle?.id ?? null,
    model: current.vehicle?.model ?? null, loading: current.loading, public: current.isPublic,
    images: current.vehicleImages, fallback: current.fallbackListingImageUrls, lead: current.leadImageUrl, hero: current.heroMeta,
    timeline: current.timelineEvents.map(event => event.id), pulse: current.auctionPulse?.listing_url ?? null,
    comments: current.totalCommentCount, observations: current.observationCount,
  };
  useLayoutEffect(() => { frames.push(frame); });
  return <output>{JSON.stringify(frame)}</output>;
}

function CountConsumer() {
  const [popup, setPopup] = React.useState<React.ReactNode>(null);
  return <PopupStackContext.Provider value={{ push: (content: React.ReactElement<any>, title: string) => {
    popupCalls.push({ content, title }); setPopup(content); return 'count-popup';
  } } as any}>
    <Probe /><div data-quick-stats><QuickStatsBar /></div><div data-count-popup>{popup}</div>
  </PopupStackContext.Provider>;
}

const photo = (id: string) => ({ id: `${id}-photo`, image_url: `https://images.example/${id}.jpg`,
  is_primary: true, source: 'manual', vehicle_zone: 'ext_front', taken_at: '2026-10-01T00:00:00Z' });
const profile = (id: string, extra: Record<string, unknown> = {}) => ({
  vehicle: { id, is_public: true, model: `vehicle-${id}`, ...extra },
  images: [photo(id)], timeline_events: [{ id: `${id}-event`, event_date: '2026-10-01' }],
  stats: { comment_count: 7, observation_count: 11 },
});
const listing = (id: string) => ({ id: `${id}-listing`, source_platform: 'mecum',
  source_url: `https://www.mecum.com/lots/${id}/`, event_type: 'auction', event_status: 'sold',
  final_price: 24000, sold_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
const subject = (request: RequestRecord) => request.body?.p_vehicle_id
  ?? request.url.searchParams.get('vehicle_id')?.replace(/^eq\./, '')
  ?? request.url.searchParams.get('id')?.replace(/^eq\./, '');

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const id = (tail: string) => `00000000-0000-${String(++serial).padStart(4, '0')}-0000-${tail.padStart(12, '0')}`;
  a = id('1'); b = id('2'); merged = id('3');
  frames = []; requests = []; reply = () => undefined; allowedSyntheticScrapes = new Set(); popupCalls = [];
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => { cache.set(key, value); },
    removeItem: (key: string) => { cache.delete(key); },
  });
  // No global network can escape the installed client's explicit test transport.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network is forbidden'); }));
  functions = vi.fn();
  fixture.client = createClient('https://profile-lifecycle.test', 'anonymous-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `lifecycle-${serial}` },
    global: { fetch: async (input, init) => {
      const request = { url: new URL(input instanceof Request ? input.url : String(input)),
        method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
        headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
      requests.push(request);
      const path = request.url.pathname;
      if (path.startsWith('/functions/v1/')) {
        const name = path.slice('/functions/v1/'.length);
        functions(name, { body: request.body });
        if (name === 'simple-scraper' && allowedSyntheticScrapes.has(request.body?.url)) {
          return reply(request) ?? json({ message: 'Missing synthetic scraper response' }, 403);
        }
        return json({ message: 'Fixture refuses live functions' }, 403);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD'
        && !(request.method === 'POST' && path === '/rest/v1/rpc/get_vehicle_profile_data')) {
        return json({ code: '42501', message: 'Fixture refuses all writes and functions' }, 403);
      }
      const response = reply(request);
      if (response) return response;
      if (path === '/rest/v1/rpc/get_vehicle_profile_data') return json(profile(subject(request)));
      if (path === '/rest/v1/vehicle_images') return json([photo(subject(request))]);
      if (path === '/rest/v1/vehicle_events') return json([listing(subject(request))]);
      return json([]);
    } },
  });
  vi.spyOn(fixture.client.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null });
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: null });
  vi.spyOn(fixture.client.auth, 'onAuthStateChange').mockReturnValue({ data: { subscription: { unsubscribe() {} } } } as any);
  const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: () => Promise.resolve() };
  vi.spyOn(fixture.client, 'channel').mockReturnValue(channel);
  vi.spyOn(fixture.client, 'removeChannel').mockResolvedValue('ok');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const [name, options] of functions.mock.calls) {
    expect(name).toBe('simple-scraper');
    expect(allowedSyntheticScrapes.has((options as any)?.body?.url)).toBe(true);
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(strict = false, counts = false) {
  const app = <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/vehicle/${a}`]}><Routes>
      <Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider>{counts ? <CountConsumer /> : <Probe />}</VehicleProfileProvider>} />
      <Route path="/away" element={<div>Away</div>} />
      <Route path="*" element={<div>Redirected</div>} />
    </Routes></MemoryRouter>
  </QueryClientProvider>;
  await act(async () => root.render(strict ? <React.StrictMode>{app}</React.StrictMode> : app));
}
const visit = async (id: string) => { await act(async () => go(`/vehicle/${id}`)); };
const release = async (pending: ReturnType<typeof deferred>, response: Response) => { await act(async () => pending.resolve(response)); };
const endpoint = (request: RequestRecord, name: string, id: string) => request.url.pathname === `/rest/v1/${name}` && subject(request) === id;

it('withholds the previous primary profile in the very first committed frame of a pending route', async () => {
  const pending = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', b) ? pending.promise : undefined;
  await render();
  expect(current.vehicle?.id).toBe(a);
  expect(current.auctionPulse?.listing_url).toBe(listing(a).source_url);
  await visit(b);
  const first = frames.find(frame => frame.route === b);
  expect(first).toMatchObject({ vehicle: null, loading: true, public: false, images: [], lead: null,
    hero: null, timeline: [], pulse: null, comments: 0, observations: 0 });
  await release(pending, json(profile(b)));
  expect(current.vehicle?.id).toBe(b);
  expect(current.loading).toBe(false);
  expect(current.timelineEvents.map(event => event.id)).toEqual([`${b}-event`]);
});

it.each(['merged', 'private'])('ignores an obsolete %s RPC redirect while the new profile remains pending', async state => {
  const old = deferred(), next = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? old.promise
    : endpoint(request, 'rpc/get_vehicle_profile_data', b) ? next.promise : undefined;
  await render(); await visit(b);
  await release(old, json(profile(a, state === 'merged' ? { merged_into_vehicle_id: merged } : { is_public: false })));
  expect(current.vehicleId).toBe(b);
  expect(container.textContent).not.toContain('Redirected');
  expect(current.loading).toBe(true);
  expect(current.timelineEvents).toEqual([]);
  await release(next, json(profile(b)));
  expect(current.vehicle?.id).toBe(b);
  expect(current.loading).toBe(false);
});

it('ignores late primary pulse/finally callbacks after the next vehicle has loaded', async () => {
  const old = deferred();
  reply = request => endpoint(request, 'vehicle_events', a) ? old.promise : undefined;
  await render(); await visit(b);
  expect(current.auctionPulse?.listing_url).toBe(listing(b).source_url);
  frames = [];
  await release(old, json([listing(a)]));
  expect(frames.filter(frame => frame.route === b).every(frame => frame.pulse !== listing(a).source_url)).toBe(true);
  expect(current.vehicle?.id).toBe(b);
  expect(current.auctionPulse?.listing_url).toBe(listing(b).source_url);
  expect(current.timelineEvents.map(event => event.id)).toEqual([`${b}-event`]);
  expect(current.totalCommentCount).toBe(7);
});

it.each(['success', 'fallback-error'])('does not finish the new pending load when obsolete A settles with %s', async state => {
  const old = deferred(), next = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? old.promise
    : endpoint(request, 'rpc/get_vehicle_profile_data', b) ? next.promise
    : endpoint(request, 'vehicles', a) ? json({ code: '42501', message: 'fixture denied' }, 403) : undefined;
  await render(); await visit(b);
  await release(old, state === 'success' ? json(profile(a)) : json({ message: 'fixture unavailable' }, 500));
  expect(current.vehicleId).toBe(b);
  expect(current.loading).toBe(true);
  expect(current.timelineEvents).toEqual([]);
  expect(current.auctionPulse).toBeNull();
  await release(next, json(profile(b)));
  expect(current.vehicle?.id).toBe(b);
  expect(current.loading).toBe(false);
});

it('ignores an old functional photo-session append after the next vehicle has loaded', async () => {
  const old = deferred();
  reply = request => endpoint(request, 'image_sets', a) ? old.promise : undefined;
  await render(); await visit(b);
  await release(old, json([{ id: 'old-photo-session', session_start: '2026-10-02T00:00:00Z' }]));
  expect(current.timelineEvents.map(event => event.id)).toEqual([`${b}-event`]);
});

it.each(['timeline_events', 'image_sets'])('ignores obsolete direct %s supplementation after an RPC without timeline data', async table => {
  const old = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a)
    ? json({ ...profile(a), timeline_events: undefined })
    : endpoint(request, table, a) ? old.promise : undefined;
  await render(); await visit(b);
  await release(old, json([{ id: 'obsolete-direct-event', event_date: '2026-10-03', session_start: '2026-10-03T00:00:00Z' }]));
  expect(current.timelineEvents.map(event => event.id)).toEqual([`${b}-event`]);
});

it('keeps a late direct timeline response out of a newer reload of the same UUID', async () => {
  const old = deferred(); let reads = 0;
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a)
    ? json({ ...profile(a), timeline_events: ++reads === 1 ? undefined : [{ id: 'latest-event' }] })
    : endpoint(request, 'timeline_events', a) ? old.promise : undefined;
  await render();
  await act(async () => current.reloadVehicle());
  await release(old, json([{ id: 'obsolete-direct-event', event_date: '2026-10-03' }]));
  expect(current.timelineEvents.map(event => event.id)).toEqual(['latest-event']);
});

it('distinguishes an old A load from a new A visit after A to B to A', async () => {
  const old = deferred(); let aReads = 0, profiles = 0;
  reply = request => endpoint(request, 'vehicle_events', a) && ++aReads === 1 ? old.promise
    : endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a),
      stats: { comment_count: ++profiles * 7, observation_count: profiles * 11 } }) : undefined;
  await render(); await visit(b); await visit(a);
  expect(current.vehicle?.id).toBe(a);
  expect(current.loading).toBe(false);
  expect(current.totalCommentCount).toBe(14);
  await release(old, json([{ ...listing(a), source_url: 'https://www.mecum.com/lots/obsolete/' }]));
  expect(current.auctionPulse?.listing_url).toBe(listing(a).source_url);
  expect(current.totalCommentCount).toBe(14);
  expect(current.observationCount).toBe(22);
});

it('distinguishes overlapping reloads of the same route', async () => {
  const old = deferred(); let events = 0, profiles = 0;
  reply = request => endpoint(request, 'vehicle_events', a) && ++events === 1 ? old.promise
    : endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a),
      stats: { comment_count: ++profiles * 7, observation_count: profiles * 11 } }) : undefined;
  await render();
  await act(async () => current.reloadVehicle());
  expect(current.totalCommentCount).toBe(14);
  await release(old, json([listing(a)]));
  expect(current.totalCommentCount).toBe(14);
  expect(current.observationCount).toBe(22);
});

it('does not let a retained old reload callback invalidate the new pending profile', async () => {
  const next = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', b) ? next.promise : undefined;
  await render();
  const obsoleteReload = current.reloadVehicle;
  await visit(b);
  await act(async () => obsoleteReload());
  await release(next, json(profile(b)));
  expect(current.vehicle?.id).toBe(b);
  expect(current.loading).toBe(false);
  expect(current.auctionPulse?.listing_url).toBe(listing(b).source_url);
});

it('ignores a retained reload callback after provider unmount', async () => {
  await render();
  const obsoleteReload = current.reloadVehicle;
  await act(async () => go('/away'));
  const before = requests.length;
  await act(async () => obsoleteReload());
  expect(requests).toHaveLength(before);
  expect(container.textContent).toBe('Away');
});

it('does not admit an old fallback row after a new visit to the same UUID succeeds', async () => {
  const old = deferred(); let reads = 0;
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a)
    ? ++reads === 1 ? json({ message: 'fixture RPC unavailable' }, 500)
      : json(profile(a, { model: 'Current revision' }))
    : endpoint(request, 'vehicles', a) ? old.promise : undefined;
  await render(); await visit(b); await visit(a);
  expect(current.vehicle?.model).toBe('Current revision');
  await release(old, json({ id: a, is_public: true, model: 'Obsolete revision' }));
  expect(current.vehicle?.model).toBe('Current revision');
  expect(current.timelineEvents.map(event => event.id)).toEqual([`${a}-event`]);
});

it('does not redirect after the primary provider unmounts', async () => {
  const old = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? old.promise : undefined;
  await render();
  await act(async () => go('/away'));
  expect(container.textContent).toBe('Away');
  await release(old, json(profile(a, { merged_into_vehicle_id: merged })));
  expect(container.textContent).toBe('Away');
});

it.each(['denied', 'missing'])('lets a current %s fallback settle without reviving the previous profile', async state => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', b)
    ? json({ code: '57014', message: 'fixture RPC unavailable' }, 500)
    : endpoint(request, 'vehicles', b) ? state === 'denied'
      ? json({ code: '42501', message: 'fixture denied' }, 403) : json(null) : undefined;
  await render(); await visit(b);
  expect(current.vehicleId).toBe(b);
  expect(current.vehicle).toBeNull();
  expect(current.loading).toBe(false);
  expect(current.timelineEvents).toEqual([]);
  expect(current.auctionPulse).toBeNull();
  expect(current.vehicleImages).toEqual([]);
});

it('keeps the current fallback vehicle, direct timeline, hero and auction pulse useful', async () => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', b) ? json({ vehicle: null })
    : endpoint(request, 'vehicles', b) ? json({ id: b, is_public: true, model: 'Current fallback', observation_count: 19 })
    : endpoint(request, 'timeline_events', b) ? json([{ id: 'current-direct-event', event_date: '2026-10-01' }])
    : endpoint(request, 'work_sessions', b) ? json([{ id: 'current-work', session_date: '2026-10-02', title: 'Inspection' }])
    : endpoint(request, 'image_sets', b) ? json([{ id: 'current-photo-session', session_start: '2026-10-03T00:00:00Z' }]) : undefined;
  await render(); await visit(b);
  expect(current.vehicle?.model).toBe('Current fallback');
  expect(current.loading).toBe(false);
  expect(current.isPublic).toBe(true);
  expect(current.observationCount).toBe(19);
  expect(current.vehicleImages).toEqual([photo(b).image_url]);
  expect(current.leadImageUrl).toBe(photo(b).image_url);
  expect(current.timelineEvents.map(event => event.id)).toEqual(['current-photo-session', 'current-work', 'current-direct-event']);
  expect(current.auctionPulse?.listing_url).toBe(listing(b).source_url);
});

it('preserves current merged replacement and current private refusal', async () => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a)
    ? json(profile(a, { merged_into_vehicle_id: merged }))
    : endpoint(request, 'rpc/get_vehicle_profile_data', merged) ? json(profile(merged, { is_public: false })) : undefined;
  await render();
  expect(container.textContent).toBe('Redirected');
  expect(requests.filter(request => request.url.pathname.endsWith('/get_vehicle_profile_data')).map(subject)).toEqual([a, merged]);
});

it('keeps a current StrictMode profile useful with one coalesced canonical RPC', async () => {
  await render(true);
  expect(current.vehicle?.id).toBe(a);
  expect(current.loading).toBe(false);
  expect(current.vehicleImages).toEqual([photo(a).image_url]);
  expect(current.leadImageUrl).toBe(photo(a).image_url);
  expect(current.isPublic).toBe(true);
  expect(current.observationCount).toBe(11);
  expect(requests.filter(request => endpoint(request, 'rpc/get_vehicle_profile_data', a))).toHaveLength(1);
});

const fallbackUrl = (id: string) => `https://carsandbids.com/auctions/${id}/synthetic-car`;
const fallbackPhoto = (label: string) => `https://images.example/fallback-${label}.jpg`;
const metadataRead = (request: RequestRecord, id: string, url = fallbackUrl(id)) =>
  endpoint(request, 'vehicle_events', id) && request.url.searchParams.get('select') === 'metadata'
    && request.url.searchParams.get('source_url') === `eq.${url}`;
function fallbackReply(request: RequestRecord) {
  const id = subject(request);
  if (id !== a && id !== b) return undefined;
  if (endpoint(request, 'rpc/get_vehicle_profile_data', id)) return json({ ...profile(id,
    { discovery_url: fallbackUrl(id), profile_origin: 'url_scraper' }), images: [] });
  if (endpoint(request, 'vehicle_images', id)) return json([]);
  if (metadataRead(request, id)) return json([{ metadata: { image_urls: [fallbackPhoto(id)] } }]);
  if (endpoint(request, 'vehicle_events', id)) return json([]);
  return undefined;
}

it.each(['image_urls', 'images'])('keeps current C&B metadata.%s useful through the exact existing bounded query', async field => {
  reply = request => metadataRead(request, a) ? json([{ metadata: { [field]: [fallbackPhoto(a)] } }]) : fallbackReply(request);
  await render();
  expect(current.vehicleImages).toEqual([]);
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto(a)]);
  const reads = requests.filter(request => metadataRead(request, a));
  expect(reads).toHaveLength(1);
  expect(reads[0].url.searchParams.get('limit')).toBe('5');
  expect(current.vehicle?.id).toBe(a);
});

it('preserves existing mixed-photo filtering and the 250 URL cache cap', async () => {
  const photos = Array.from({ length: 260 }, (_, i) => fallbackPhoto(`current-${i}`));
  reply = request => metadataRead(request, a) ? json([{ metadata: { image_urls: [
    'https://gstatic.com/faviconv2?site=example', 'https://images.example/tiny.jpg?width=32', ...photos,
  ] } }]) : fallbackReply(request);
  await render();
  expect(current.fallbackListingImageUrls).toEqual(photos);
  expect(JSON.parse(window.localStorage.getItem(`carsandbids_fallback_images_${a}`)!)).toEqual(photos.slice(0, 250));
});

it('keeps the existing current-vehicle cache format useful without another metadata read', async () => {
  window.localStorage.setItem(`carsandbids_fallback_images_${a}`, JSON.stringify([fallbackPhoto('cached-current')]));
  reply = fallbackReply;
  await render();
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('cached-current')]);
  expect(requests.filter(request => metadataRead(request, a))).toEqual([]);
});

it.each(['[]', '{broken-json'])('keeps the existing uncached path useful after unusable cache %s', async cached => {
  window.localStorage.setItem(`carsandbids_fallback_images_${a}`, cached);
  reply = fallbackReply;
  await render();
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto(a)]);
  expect(requests.filter(request => metadataRead(request, a))).toHaveLength(1);
});

it('keeps a current fallback useful through StrictMode and repeated render', async () => {
  reply = fallbackReply;
  await render(true);
  await act(async () => current.setVehicleHeaderHeight(91));
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto(a)]);
  expect(requests.filter(request => metadataRead(request, a))).toHaveLength(1);
});

it('keeps a completed no-hero decision authoritative when current fallback photos arrive', async () => {
  const pending = deferred();
  reply = request => metadataRead(request, a) ? pending.promise : fallbackReply(request);
  await render();
  expect(current.leadImageUrl).toBeNull();
  await release(pending, json([{ metadata: { image_urls: [fallbackPhoto('current-no-hero')] } }]));
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('current-no-hero')]);
  expect(current.leadImageUrl).toBeNull();
});

it('keeps a current DB gallery preferred without starting a fallback metadata read', async () => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(profile(a,
    { discovery_url: fallbackUrl(a), profile_origin: 'url_scraper' }))
    : endpoint(request, 'vehicle_images', a) ? json([photo(a)]) : fallbackReply(request);
  await render();
  expect(current.vehicleImages).toEqual([photo(a).image_url]);
  expect(current.leadImageUrl).toBe(photo(a).image_url);
  expect(current.fallbackListingImageUrls).toEqual([]);
  expect(requests.filter(request => metadataRead(request, a))).toEqual([]);
});

it.each(['empty', 'denied'])('keeps a current %s C&B metadata read from inventing fallback photos', async state => {
  reply = request => metadataRead(request, a) ? state === 'empty' ? json([])
    : json({ message: 'fixture denied' }, 403) : fallbackReply(request);
  await render();
  expect(current.vehicle?.id).toBe(a);
  expect(current.loading).toBe(false);
  expect(current.fallbackListingImageUrls).toEqual([]);
});

it('refuses A fallback photos after B has loaded its own fallback', async () => {
  const old = deferred();
  reply = request => metadataRead(request, a) ? old.promise : fallbackReply(request);
  await render(); await visit(b);
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto(b)]);
  await release(old, json([{ metadata: { image_urls: [fallbackPhoto('obsolete-A')] } }]));
  expect(current.vehicle?.id).toBe(b);
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto(b)]);
});

it('refuses pending fallback photos after the current vehicle receives a DB gallery and hero', async () => {
  const old = deferred(); let hasDbPhotos = false;
  reply = request => metadataRead(request, a) ? old.promise
    : endpoint(request, 'vehicle_images', a) && hasDbPhotos ? json([photo(a)]) : fallbackReply(request);
  await render();
  hasDbPhotos = true;
  await act(async () => current.reloadImages());
  expect(current.vehicleImages).toEqual([photo(a).image_url]);
  expect(current.leadImageUrl).toBe(photo(a).image_url);
  frames = [];
  await release(old, json([{ metadata: { image_urls: [fallbackPhoto('obsolete-no-gallery')] } }]));
  expect(current.fallbackListingImageUrls).toEqual([]);
  expect(current.vehicleImages).toEqual([photo(a).image_url]);
  expect(current.leadImageUrl).toBe(photo(a).image_url);
  expect(frames.every(frame => frame.fallback.length === 0)).toBe(true);
});

it.each(['discovery_url', 'listing_url'])('refuses prior-source fallback after the same vehicle changes %s', async field => {
  const old = deferred(); const nextUrl = 'https://carsandbids.com/auctions/current-episode/synthetic-car';
  let changed = false;
  reply = request => metadataRead(request, a) ? old.promise
    : metadataRead(request, a, nextUrl) ? json([{ metadata: { image_urls: [fallbackPhoto('current-episode')] } }])
    : endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a,
      { discovery_url: null, [field]: changed ? nextUrl : fallbackUrl(a), profile_origin: 'url_scraper' }), images: [] }) : fallbackReply(request);
  await render();
  changed = true;
  await act(async () => current.reloadVehicle());
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('current-episode')]);
  await release(old, json([{ metadata: { image_urls: [fallbackPhoto('obsolete-episode')] } }]));
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('current-episode')]);
});

it('distinguishes pending fallback reads across A to B to A', async () => {
  const old = deferred(), latest = deferred(); let reads = 0;
  reply = request => metadataRead(request, a) ? ++reads === 1 ? old.promise : latest.promise : fallbackReply(request);
  await render(); await visit(b); await visit(a);
  expect(current.fallbackListingImageUrls).toEqual([]);
  await release(old, json([{ metadata: { image_urls: [fallbackPhoto('obsolete-visit')] } }]));
  expect(current.fallbackListingImageUrls).toEqual([]);
  await release(latest, json([{ metadata: { image_urls: [fallbackPhoto('current-visit')] } }]));
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('current-visit')]);
});

it('keeps a later mounted route useful when an unmounted fallback read settles', async () => {
  const old = deferred();
  reply = request => metadataRead(request, a) ? old.promise : fallbackReply(request);
  await render();
  await act(async () => go('/away'));
  await visit(b);
  await release(old, json([{ metadata: { image_urls: [fallbackPhoto('unmounted-A')] } }]));
  expect(current.vehicle?.id).toBe(b);
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto(b)]);
});

it('preserves a valid pending fallback across an unchanged-subject unchanged-source primary reload', async () => {
  const old = deferred(); let reads = 0;
  reply = request => metadataRead(request, a) ? ++reads === 1 ? old.promise
    : json([{ metadata: { image_urls: [fallbackPhoto('current-reload')] } }]) : fallbackReply(request);
  await render();
  await act(async () => current.reloadVehicle());
  await release(old, json([{ metadata: { image_urls: [fallbackPhoto('unchanged-valid-source')] } }]));
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('unchanged-valid-source')]);
  expect(reads).toBe(1);
});

it.each(['nested', 'direct'])('keeps explicitly synthetic current BaT %s scraper photos useful', async shape => {
  const url = 'https://bringatrailer.com/listing/synthetic-current-vehicle/';
  allowedSyntheticScrapes.add(url);
  reply = request => request.url.pathname === '/functions/v1/simple-scraper'
    ? json(shape === 'nested' ? { success: true, data: { images: [fallbackPhoto('current-bat')] } }
      : { images: [fallbackPhoto('current-bat')] })
    : endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a,
      { discovery_url: url, profile_origin: 'bat_import' }), images: [] }) : fallbackReply(request);
  await render();
  expect(current.vehicle?.id).toBe(a);
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('current-bat')]);
  expect(JSON.parse(window.localStorage.getItem(`bat_fallback_images_${a}`)!)).toEqual([fallbackPhoto('current-bat')]);
});

it('preserves the existing BaT cache hit without invoking a scraper', async () => {
  const url = 'https://bringatrailer.com/listing/synthetic-cached-vehicle/';
  window.localStorage.setItem(`bat_fallback_images_${a}`, JSON.stringify([fallbackPhoto('cached-bat')]));
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a,
    { discovery_url: url, profile_origin: 'bat_import' }), images: [] }) : fallbackReply(request);
  await render();
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto('cached-bat')]);
  expect(functions).not.toHaveBeenCalled();
});

it('preserves synthetic BaT function-error refusal', async () => {
  const url = 'https://bringatrailer.com/listing/synthetic-denied-vehicle/';
  allowedSyntheticScrapes.add(url);
  reply = request => request.url.pathname === '/functions/v1/simple-scraper' ? json({ message: 'fixture denied' }, 403)
    : endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a,
      { discovery_url: url, profile_origin: 'bat_import' }), images: [] }) : fallbackReply(request);
  await render();
  expect(current.vehicle?.id).toBe(a);
  expect(current.loading).toBe(false);
  expect(current.fallbackListingImageUrls).toEqual([]);
});

it('does not publish synthetic BaT scraper photos from the prior vehicle under B', async () => {
  const url = 'https://bringatrailer.com/listing/synthetic-prior-vehicle/';
  const old = deferred();
  allowedSyntheticScrapes.add(url);
  reply = request => request.url.pathname === '/functions/v1/simple-scraper' ? old.promise
    : endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a,
    { discovery_url: url, profile_origin: 'bat_import' }), images: [] }) : fallbackReply(request);
  await render();
  expect(functions).toHaveBeenCalledWith('simple-scraper', { body: { url } });
  await visit(b);
  await release(old, json({ success: true, data: { images: [fallbackPhoto('obsolete-bat')] } }));
  expect(current.fallbackListingImageUrls).toEqual([fallbackPhoto(b)]);
});

type CountKind = 'comments' | 'observations';
const countTable = (kind: CountKind) => kind === 'comments' ? 'vehicle_comments_unified' : 'vehicle_observations';
const countRead = (request: RequestRecord, kind: CountKind, id: string) => request.method === 'HEAD'
  && endpoint(request, countTable(kind), id);
const counted = (count: number, status = 200) => new Response(null, {
  status, headers: { 'Content-Range': `0-0/${count}`, 'Content-Type': 'application/json' },
});
const withoutCount = (id: string, kind: CountKind) => ({ ...profile(id), stats:
  kind === 'comments' ? { observation_count: 11 } : { comment_count: 7 } });
const tickDeferredCounts = async () => { await act(async () => vi.advanceTimersByTimeAsync(500)); };
async function countDisplay(kind: CountKind) {
  const stats = container.querySelector('[data-quick-stats]')!;
  if (kind === 'observations') return { stats: stats.textContent };
  await act(async () => stats.querySelector('[role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const popup = popupCalls.at(-1)!;
  return { stats: stats.textContent, popupVehicle: popup.content.props.vehicleId,
    popupExpected: popup.content.props.expectedCount, popupIsComments: popup.content.type === CommentsPopup,
    popupTitle: popup.title, popupText: container.querySelector('[data-count-popup]')!.textContent };
}

it.each<CountKind>(['comments', 'observations'])('keeps obsolete A fallback %s out of B quick stats and popup', async kind => {
  const old = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, kind))
    : countRead(request, kind, a) ? old.promise : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  const read = requests.find(request => countRead(request, kind, a))!;
  expect(read.headers.get('prefer')).toContain('count=exact');
  expect(read.url.searchParams.get('select')).toBe(kind === 'comments' ? 'comment_id' : 'id');
  await visit(b);
  await release(old, counted(83));
  const result = await countDisplay(kind);
  expect(result).toMatchObject(kind === 'comments' ? { stats: expect.stringContaining('7 comments'),
    popupVehicle: b, popupExpected: 7, popupIsComments: true, popupText: expect.stringContaining('/ 7 expected') }
    : { stats: expect.stringContaining('11 observations') });
});

it.each<CountKind>(['comments', 'observations'])('distinguishes A fallback %s from a later A visit', async kind => {
  const old = deferred(); let reads = 0;
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, kind))
    : countRead(request, kind, a) ? ++reads === 1 ? old.promise : counted(23) : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  await visit(b); await visit(a);
  if (kind === 'observations') await tickDeferredCounts();
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(23);
  await release(old, counted(83));
  const result = await countDisplay(kind);
  expect(result).toMatchObject(kind === 'comments' ? { stats: expect.stringContaining('23 comments'),
    popupVehicle: a, popupExpected: 23, popupIsComments: true }
    : { stats: expect.stringContaining('23 observations') });
  expect(reads).toBe(2);
});

it('preserves a newer same-ID RPC comment count against a previously started fallback', async () => {
  const old = deferred(); let reads = 0;
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(++reads === 1
    ? withoutCount(a, 'comments') : { ...profile(a), stats: { comment_count: 29, observation_count: 11 } })
    : countRead(request, 'comments', a) ? old.promise : undefined;
  await render(false, true);
  await act(async () => current.reloadVehicle());
  expect(current.totalCommentCount).toBe(29);
  expect(requests.filter(request => countRead(request, 'comments', a))).toHaveLength(1);
  await release(old, counted(83));
  expect(await countDisplay('comments')).toMatchObject({ stats: expect.stringContaining('29 comments'),
    popupVehicle: a, popupExpected: 29, popupIsComments: true });
});

it('keeps known RPC counts useful without fallback HEADs after the deferred boundary', async () => {
  await render(false, true); await tickDeferredCounts();
  expect(requests.filter(request => countRead(request, 'comments', a) || countRead(request, 'observations', a))).toEqual([]);
  expect(await countDisplay('comments')).toMatchObject({ stats: expect.stringContaining('7 comments'),
    popupVehicle: a, popupExpected: 7, popupIsComments: true });
  expect(container.querySelector('[data-quick-stats]')!.textContent).toContain('11 observations');
});

it.each(['rpc', 'row'])('preserves newer same-ID %s observation authority against an older fallback', async authority => {
  const old = deferred(); let reads = 0;
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? ++reads === 1
    ? json(withoutCount(a, 'observations'))
    : json(authority === 'rpc' ? { ...profile(a), stats: { comment_count: 7, observation_count: 29 } }
      : { ...withoutCount(a, 'observations'), vehicle: { ...profile(a).vehicle, observation_count: 29 } })
    : countRead(request, 'observations', a) ? old.promise : undefined;
  await render(false, true); await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  expect(current.observationCount).toBe(29);
  await release(old, counted(83));
  expect(await countDisplay('observations')).toMatchObject({ stats: expect.stringContaining('29 observations') });
});

it.each<CountKind>(['comments', 'observations'])('preserves a valid pending %s fallback across unchanged-input reload without newer authority', async kind => {
  const pending = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, kind))
    : countRead(request, kind, a) ? pending.promise : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  await release(pending, counted(23));
  const result = await countDisplay(kind);
  expect(result).toMatchObject(kind === 'comments' ? { stats: expect.stringContaining('23 comments'),
    popupVehicle: a, popupExpected: 23, popupIsComments: true }
    : { stats: expect.stringContaining('23 observations') });
  expect(requests.filter(request => countRead(request, kind, a))).toHaveLength(1);
});

it.each<CountKind>(['comments', 'observations'])('preserves current fallback %s zero and error behavior', async kind => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, kind))
    : countRead(request, kind, a) ? counted(0) : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(0);
  expect(container.querySelector('[data-quick-stats]')!.textContent).not.toContain(`0 ${kind}`);
  // A new subject with a denied HEAD cannot revive the earlier subject's total.
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', b) ? json(withoutCount(b, kind))
    : countRead(request, kind, b) ? counted(999, 403) : undefined;
  await visit(b);
  if (kind === 'observations') await tickDeferredCounts();
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(0);
  expect(container.querySelector('[data-quick-stats]')!.textContent).not.toContain('999');
});

it.each<CountKind>(['comments', 'observations'])('withholds A %s arriving during pending B after B loads without its own count', async kind => {
  const old = deferred(), nextProfile = deferred(), nextCount = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, kind))
    : endpoint(request, 'rpc/get_vehicle_profile_data', b) ? nextProfile.promise
    : countRead(request, kind, a) ? old.promise : countRead(request, kind, b) ? nextCount.promise : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  await visit(b);
  await release(old, counted(83));
  expect(current.vehicle).toBeNull();
  expect(container.querySelector('[data-quick-stats]')!.textContent).not.toContain('83');
  await release(nextProfile, json(withoutCount(b, kind)));
  if (kind === 'observations') await tickDeferredCounts();
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(0);
  await release(nextCount, counted(23));
  expect(await countDisplay(kind)).toMatchObject(kind === 'comments'
    ? { stats: expect.stringContaining('23 comments'), popupVehicle: b, popupExpected: 23 }
    : { stats: expect.stringContaining('23 observations') });
});

it.each<CountKind>(['comments', 'observations'])('preserves newer authoritative %s zero against an old HEAD', async kind => {
  const old = deferred(); let reads = 0;
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(++reads === 1
    ? withoutCount(a, kind) : { ...profile(a), stats: { comment_count: 0, observation_count: 0 } })
    : countRead(request, kind, a) ? old.promise : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  await release(old, counted(83));
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(0);
  expect(container.querySelector('[data-quick-stats]')!.textContent).not.toContain('83');
  expect(requests.filter(request => countRead(request, kind, a))).toHaveLength(1);
});

it('keeps the 500 ms observation defer and cancels before a departed subject starts a HEAD', async () => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, 'observations')) : undefined;
  await render(false, true);
  await act(async () => vi.advanceTimersByTimeAsync(499));
  expect(requests.filter(request => countRead(request, 'observations', a))).toEqual([]);
  await visit(b); await tickDeferredCounts();
  expect(requests.filter(request => countRead(request, 'observations', a) || countRead(request, 'observations', b))).toEqual([]);
  expect(current.observationCount).toBe(11);
});

it.each([0, 19])('keeps maintained row observation_count=%s useful without a fallback HEAD', async count => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...withoutCount(a, 'observations'),
    vehicle: { ...profile(a).vehicle, observation_count: count } }) : undefined;
  await render(false, true); await tickDeferredCounts();
  expect(current.observationCount).toBe(count);
  expect(requests.filter(request => countRead(request, 'observations', a))).toEqual([]);
});

it('keeps RPC zero counts authoritative without fallback requests', async () => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a),
    stats: { comment_count: 0, observation_count: 0 } }) : undefined;
  await render(false, true); await tickDeferredCounts();
  expect(current.totalCommentCount).toBe(0); expect(current.observationCount).toBe(0);
  expect(requests.filter(request => countRead(request, 'comments', a) || countRead(request, 'observations', a))).toEqual([]);
});

it('keeps current fallback counts and the actual popup query useful through StrictMode and harmless render', async () => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a), stats: {} })
    : countRead(request, 'comments', a) ? counted(37) : countRead(request, 'observations', a) ? counted(41) : undefined;
  await render(true, true); await tickDeferredCounts();
  await act(async () => current.setVehicleHeaderHeight(92));
  expect(await countDisplay('comments')).toMatchObject({ stats: expect.stringContaining('37 comments'),
    popupVehicle: a, popupExpected: 37, popupIsComments: true, popupTitle: 'COMMENTS (37)' });
  expect(container.querySelector('[data-quick-stats]')!.textContent).toContain('41 observations');
  expect(requests.filter(request => countRead(request, 'comments', a))).toHaveLength(1);
  expect(requests.filter(request => countRead(request, 'observations', a))).toHaveLength(1);
  const popupRead = requests.find(request => request.method === 'GET' && endpoint(request, 'vehicle_comments_unified', a))!;
  expect(popupRead.url.searchParams.get('limit')).toBe('200');
  expect(popupRead.url.searchParams.get('order')).toBe('observed_at.desc');
  expect(popupRead.url.searchParams.get('select')).toBe('comment_id,comment_text,observed_at,author_username,comment_type,bid_amount,is_seller,platform');
});

it.each<CountKind>(['comments', 'observations'])('keeps current %s unavailable when the HEAD has no count header', async kind => {
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, kind))
    : countRead(request, kind, a) ? new Response(null, { status: 200 }) : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(0);
  expect(requests.filter(request => countRead(request, kind, a))).toHaveLength(1);
});

it.each<CountKind>(['comments', 'observations'])('does not publish unmounted %s into a later provider', async kind => {
  const old = deferred();
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(withoutCount(a, kind))
    : countRead(request, kind, a) ? old.promise : undefined;
  await render(false, true);
  if (kind === 'observations') await tickDeferredCounts();
  await act(async () => go('/away'));
  await visit(b); await release(old, counted(83));
  expect(await countDisplay(kind)).toMatchObject(kind === 'comments'
    ? { stats: expect.stringContaining('7 comments'), popupVehicle: b, popupExpected: 7 }
    : { stats: expect.stringContaining('11 observations') });
});

it.each<CountKind>(['comments', 'observations'])('keeps %s superseded after an authoritative reload and a later count-less reload', async kind => {
  const old = deferred(); let reads = 0;
  const authority = kind === 'comments' ? { comment_count: 31 } : { observation_count: 31 };
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json(++reads === 2
    ? { ...profile(a), stats: authority } : { ...profile(a), stats: {} })
    : countRead(request, kind, a) ? old.promise : undefined;
  await render(false, true); await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(31);
  await act(async () => current.reloadVehicle());
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(31);
  await release(old, counted(87));
  expect(await countDisplay(kind)).toMatchObject(kind === 'comments'
    ? { stats: expect.stringContaining('31 comments'), popupVehicle: a, popupExpected: 31, popupIsComments: true }
    : { stats: expect.stringContaining('31 observations') });
  expect(requests.filter(request => countRead(request, kind, a))).toHaveLength(1);
});

it.each<CountKind>(['comments', 'observations'])('keeps %s superseded while a third profile reload is pending', async kind => {
  const old = deferred(), pending = deferred(); let reads = 0;
  const authority = kind === 'comments' ? { comment_count: 31 } : { observation_count: 31 };
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? ++reads === 3 ? pending.promise
    : json(reads === 2 ? { ...profile(a), stats: authority } : { ...profile(a), stats: {} })
    : countRead(request, kind, a) ? old.promise : undefined;
  await render(false, true); await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  await act(async () => { current.reloadVehicle(); });
  expect(current.loading).toBe(true);
  await release(old, counted(87));
  const during = await countDisplay(kind);
  await release(pending, json({ ...profile(a), stats: {} }));
  expect(during).toMatchObject(kind === 'comments'
    ? { stats: expect.stringContaining('31 comments'), popupVehicle: a, popupExpected: 31 }
    : { stats: expect.stringContaining('31 observations') });
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(31);
});

it.each<CountKind>(['comments', 'observations'])('keeps a valid %s fallback when only the other field gained authority', async kind => {
  const pending = deferred(); let reads = 0;
  const other = kind === 'comments' ? { observation_count: 31 } : { comment_count: 31 };
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a), stats: ++reads === 2 ? other : {} })
    : countRead(request, kind, a) ? pending.promise : undefined;
  await render(false, true); await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  await act(async () => current.reloadVehicle());
  await release(pending, counted(23));
  expect(await countDisplay(kind)).toMatchObject(kind === 'comments'
    ? { stats: expect.stringContaining('23 comments'), popupVehicle: a, popupExpected: 23 }
    : { stats: expect.stringContaining('23 observations') });
  expect(kind === 'comments' ? current.observationCount : current.totalCommentCount).toBe(31);
  expect(requests.filter(request => countRead(request, kind, a))).toHaveLength(1);
});

it.each<CountKind>(['comments', 'observations'])('does not revive pre-zero %s HEADs after a later count-less reload', async kind => {
  const old = deferred(); let reads = 0;
  const authority = kind === 'comments' ? { comment_count: 0 } : { observation_count: 0 };
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a), stats: ++reads === 2 ? authority : {} })
    : countRead(request, kind, a) ? old.promise : undefined;
  await render(false, true); await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  await act(async () => current.reloadVehicle());
  await release(old, counted(87));
  expect(kind === 'comments' ? current.totalCommentCount : current.observationCount).toBe(0);
  expect(container.querySelector('[data-quick-stats]')!.textContent).not.toContain('87');
});

it('does not revive an observation HEAD after maintained-row authority and a later omission', async () => {
  const old = deferred(); let reads = 0;
  reply = request => endpoint(request, 'rpc/get_vehicle_profile_data', a) ? json({ ...profile(a), stats: {},
    vehicle: { ...profile(a).vehicle, ...( ++reads === 2 ? { observation_count: 31 } : {}) } })
    : countRead(request, 'observations', a) ? old.promise : undefined;
  await render(false, true); await tickDeferredCounts();
  await act(async () => current.reloadVehicle());
  await act(async () => current.reloadVehicle());
  await release(old, counted(87));
  expect(await countDisplay('observations')).toMatchObject({ stats: expect.stringContaining('31 observations') });
});
