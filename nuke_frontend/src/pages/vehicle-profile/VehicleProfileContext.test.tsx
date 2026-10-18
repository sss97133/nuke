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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' },
});
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
type RequestRecord = { url: URL; method: string; body: any };
let root: Root, container: HTMLDivElement, go: ReturnType<typeof useNavigate>;
let current: ReturnType<typeof useVehicleProfile>, a: string, b: string, merged: string;
let serial = 0;
let frames: any[], requests: RequestRecord[], functions: ReturnType<typeof vi.fn>;
let reply: (request: RequestRecord) => Response | Promise<Response> | undefined;

function Probe() {
  current = useVehicleProfile();
  const location = useLocation();
  go = useNavigate();
  const frame = {
    path: location.pathname, route: current.vehicleId, vehicle: current.vehicle?.id ?? null,
    model: current.vehicle?.model ?? null, loading: current.loading, public: current.isPublic,
    images: current.vehicleImages, lead: current.leadImageUrl, hero: current.heroMeta,
    timeline: current.timelineEvents.map(event => event.id), pulse: current.auctionPulse?.listing_url ?? null,
    comments: current.totalCommentCount, observations: current.observationCount,
  };
  useLayoutEffect(() => { frames.push(frame); });
  return <output>{JSON.stringify(frame)}</output>;
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
  frames = []; requests = []; reply = () => undefined;
  // No global network can escape the installed client's explicit test transport.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network is forbidden'); }));
  fixture.client = createClient('https://profile-lifecycle.test', 'anonymous-fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `lifecycle-${serial}` },
    global: { fetch: async (input, init) => {
      const request = { url: new URL(input instanceof Request ? input.url : String(input)),
        method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
      requests.push(request);
      const path = request.url.pathname;
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
  functions = vi.spyOn(fixture.client.functions, 'invoke').mockRejectedValue(new Error('Functions forbidden'));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(functions).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(strict = false) {
  const app = <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[`/vehicle/${a}`]}><Routes>
      <Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><Probe /></VehicleProfileProvider>} />
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
