// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../hooks/useVehiclePermissions', () => ({ useVehiclePermissions: () => ({ isOwner: false, hasContributorAccess: false, contributorRole: null, canEdit: false }) }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => ({ isAdmin: false }) }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView() {}, endView() {} }) }));
vi.mock('./hooks/useVehicleIntel', () => ({ useVehicleIntel: () => ({ vehicleIntel: null, vehicleIntelLoading: false }) }));
import { VehicleProfileProvider, useVehicleProfile } from './VehicleProfileContext';
import BarcodeTimeline from './BarcodeTimeline';


const day = '2026-09-13', otherDay = '2026-09-17';
type Request = { url: URL; method: string; body: any };
type Input = { fallback?: boolean; timeline?: unknown; work?: unknown; timelineError?: boolean; workError?: boolean };
let root: Root, host: HTMLDivElement, queryClient: QueryClient, current: ReturnType<typeof useVehicleProfile>, go: ReturnType<typeof useNavigate>;
let a: string, b: string, serial = 0, requests: Request[], frames: ReturnType<typeof snapshot>[], inputs: Map<string, Input>;
let reply: ((request: Request) => Response | Promise<Response> | undefined) | null;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const refused = () => json({ code: '42501', message: 'PRIVATE synthetic refusal detail' }, 403);
const event = (id: string, date = otherDay) => ({ id, event_date: date, event_type: 'maintenance', title: id });
const work = (id: string) => ({ id, session_date: day, title: id, total_job_cost: 410, duration_minutes: 60 });
const photo = (id: string) => ({ id: `${id}-photo`, image_url: `https://images.test/${id}.jpg`, is_primary: true, vehicle_zone: 'ext_front' });
const vehicle = (id: string) => ({ id, is_public: true, make: 'Ford', model: 'Synthetic', listing_url: null });
function profile(id: string) {
  const input = inputs.get(id) ?? {};
  return { vehicle: vehicle(id), images: [photo(id)], timeline_events: input.timeline ?? [event(`${id}-known`)],
    ...(Object.hasOwn(input, 'work') ? { work_sessions: input.work } : { work_sessions: [] }), stats: { comment_count: 0, observation_count: 0 } };
}
const state = () => (current as any)?.timelineReadState ?? null;
function snapshot() { return { route: current?.vehicleId, vehicle: current?.vehicle?.id, state: state(), text: host.textContent,
  events: current?.timelineEvents.map(e => e.id), statuses: [...host.querySelectorAll('[role="status"]')].map(e => e.textContent) }; }
function Probe() { current = useVehicleProfile(); go = useNavigate(); useLayoutEffect(() => { frames.push(snapshot()); }); return <BarcodeTimeline />; }
beforeEach(async () => {
  await import('./VehicleDayDrawer');
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) });
  const id = (suffix: number) => `00000000-0000-${String(++serial).padStart(4, '0')}-0000-${String(suffix).padStart(12, '0')}`;
  a = id(1); b = id(2); requests = []; frames = []; inputs = new Map(); reply = null;
  fixture.client = createClient('https://timeline-status.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `timeline-status-${serial}` },
    global: { fetch: async (input, init) => {
      const request = { url: new URL(input instanceof globalThis.Request ? input.url : String(input)), method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
      requests.push(request);
      const path = request.url.pathname, rpc = path.split('/').pop();
      if (!['GET', 'HEAD'].includes(request.method) && !(request.method === 'POST' && path.startsWith('/rest/v1/rpc/') &&
        ['get_vehicle_profile_data', 'get_vehicle_day_depth', 'get_vehicle_contribution_days'].includes(rpc!))) return refused();
      const special = reply?.(request); if (special) return (await special).clone();
      const subject = request.body?.p_vehicle_id ?? request.url.searchParams.get('vehicle_id')?.replace(/^eq\./, '') ?? request.url.searchParams.get('id')?.replace(/^eq\./, '');
      const selected = inputs.get(subject) ?? {};
      if (rpc === 'get_vehicle_profile_data') return selected.fallback ? refused() : json(profile(subject));
      if (rpc === 'get_vehicle_day_depth' || rpc === 'get_vehicle_contribution_days') return json([]);
      if (path === '/rest/v1/vehicles') return json(vehicle(subject));
      if (path === '/rest/v1/timeline_events') return selected.timelineError ? refused() : json(selected.timeline ?? []);
      if (path === '/rest/v1/work_sessions') return selected.workError ? refused() : json(selected.work ?? []);
      if (path === '/rest/v1/vehicle_images') return json(request.url.searchParams.has('taken_at') ? [] : [photo(subject)]);
      return json([]);
    } },
  });
  vi.spyOn(fixture.client.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null });
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: null });
  vi.spyOn(fixture.client.auth, 'onAuthStateChange').mockReturnValue({ data: { subscription: { unsubscribe() {} } } } as any);
  const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: () => Promise.resolve() };
  vi.spyOn(fixture.client, 'channel').mockReturnValue(channel); vi.spyOn(fixture.client, 'removeChannel').mockResolvedValue('ok');
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => {
  expect(host.textContent).not.toContain('PRIVATE');
  await act(async () => root.unmount()); queryClient.clear(); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(requests.some(r => r.url.pathname.startsWith('/functions/'))).toBe(false);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(5); }); };
async function draw(selectedDay = false) {
  if (selectedDay) window.history.replaceState({}, '', `/?day=${day}`);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/vehicle/${a}`]}><Routes>
    <Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><Probe /></VehicleProfileProvider>} />
  </Routes></MemoryRouter></QueryClientProvider>)); await flush();
}
const visit = async (id: string) => { await act(async () => go(`/vehicle/${id}`)); await flush(); };
const calls = (table: string, id = a) => requests.filter(r => r.url.pathname.endsWith(`/${table}`) &&
  (r.body?.p_vehicle_id === id || r.url.searchParams.get('vehicle_id') === `eq.${id}`));
const hasTimeline = () => !!host.querySelector('[aria-label="Vehicle timeline"]');
const drawer = () => host.querySelector<HTMLElement>('[data-day-drawer]')!;
const unavailable = (source: 'timeline' | 'work') => `${source === 'timeline' ? 'Timeline events' : 'Work-session details'} could not be fully read.`;
const pendingText = 'Timeline details are still being read.';
const statuses = () => [...host.querySelectorAll('[role="status"]')].map(e => e.textContent);
function deferred() { let resolve!: (response: Response) => void; return { promise: new Promise<Response>(done => { resolve = done; }), resolve }; }
const core = (r: Request, id = a) => r.url.searchParams.get('vehicle_id') === `eq.${id}` && ['/rest/v1/timeline_events', '/rest/v1/work_sessions'].includes(r.url.pathname);
async function resolveBoth(timeline: ReturnType<typeof deferred>, workRead: ReturnType<typeof deferred>, tl: Response, ws: Response) {
  await act(async () => { timeline.resolve(tl); workRead.resolve(ws); }); await flush();
}

it.each([false, true])('preserves successful known-empty RPC/fallback=%s without an incomplete claim or visible timeline', async fallback => {
  inputs.set(a, { fallback, timeline: [], work: [] }); await draw();
  expect(hasTimeline()).toBe(false); expect(statuses()).toEqual([]);
  expect(calls('timeline_events')).toHaveLength(fallback ? 1 : 0); expect(calls('work_sessions')).toHaveLength(fallback ? 1 : 0);
});
it.each(['timeline', 'work'] as const)('shows a generic %s refusal even when all retained rows are empty', async source => {
  inputs.set(a, { fallback: true, [`${source}Error`]: true }); await draw();
  expect(hasTimeline()).toBe(false); expect(statuses()).toContain(unavailable(source)); expect(host.textContent).not.toContain('PRIVATE');
  expect(state()).toEqual({ timeline: source === 'timeline' ? 'unavailable' : 'ready', work: source === 'work' ? 'unavailable' : 'ready' });
});
it('retains known timeline content beside an incomplete work read', async () => {
  inputs.set(a, { fallback: true, timeline: [event('Retained timeline event')], workError: true }); await draw(true);
  expect(hasTimeline()).toBe(true); expect(current.timelineEvents.map(e => e.id)).toContain('Retained timeline event');
  expect(statuses()).toContain(unavailable('work')); expect(drawer().textContent).not.toContain('NO ACTIVITY');
});
it('retains known work details and its recorded total beside an incomplete timeline read', async () => {
  inputs.set(a, { fallback: true, timelineError: true, work: [work('Retained work story')] }); await draw(true);
  expect(drawer().textContent).toContain('Retained work story'); expect(drawer().textContent).toContain('410 (currency unknown)');
  expect(drawer().textContent).toContain('1h 0m'); expect(statuses()).toContain(unavailable('timeline'));
});
it.each([undefined, null, { not: 'an array' }])('does not certify absent/malformed RPC work as known-empty (%s) or add fallback demand', async work => {
  inputs.set(a, { timeline: [], work }); await draw(); expect(statuses()).toContain(unavailable('work'));
  expect(state()).toEqual({ timeline: 'ready', work: 'unavailable' }); expect(calls('timeline_events')).toHaveLength(0); expect(calls('work_sessions')).toHaveLength(0);
});
it.each(['timeline', 'work'] as const)('treats malformed fallback %s as unavailable while retaining the other successful source', async source => {
  inputs.set(a, { fallback: true, [source]: { not: 'an array' } }); await draw(); expect(statuses()).toContain(unavailable(source));
  expect(state()?.[source === 'timeline' ? 'work' : 'timeline']).toBe('ready');
});
it('shows selected-day pending instead of NO ACTIVITY, then restores successful known-empty behavior', async () => {
  await draw(true); expect(drawer().textContent).toContain('NO ACTIVITY');
  const tl = deferred(), ws = deferred(); reply = r => core(r) ? r.url.pathname.endsWith('timeline_events') ? tl.promise : ws.promise : undefined;
  let loading!: Promise<void>; await act(async () => { loading = current.reloadTimeline(); });
  expect(drawer().textContent).not.toContain('NO ACTIVITY'); expect(drawer().textContent).toContain(pendingText);
  await resolveBoth(tl, ws, json([event('Fresh retained event')]), json([])); await loading;
  expect(drawer().textContent).toContain('NO ACTIVITY'); expect(state()).toEqual({ timeline: 'ready', work: 'ready' });
});
it('keeps known selected-day content while a current reload is pending', async () => {
  inputs.set(a, { timeline: [event('Known selected event', day)], work: [work('Known selected work')] }); await draw(true);
  const pending = deferred(); reply = r => core(r) ? pending.promise : undefined;
  await act(async () => { void current.reloadTimeline(); });
  expect(drawer().textContent).toContain('Known selected work'); expect(drawer().textContent).toContain('Known selected event');
  expect(drawer().textContent).toContain(pendingText);
});
it('clears a prior terminal failure during explicit reload and retains useful current ready results', async () => {
  inputs.set(a, { fallback: true, workError: true }); await draw(); expect(statuses()).toContain(unavailable('work'));
  inputs.set(a, { timeline: [event('Recovered event')], work: [] }); await act(async () => { await current.reloadTimeline(); });
  expect(state()).toEqual({ timeline: 'ready', work: 'ready' }); expect(statuses()).toEqual([]); expect(current.timelineEvents[0].id).toBe('Recovered event');
  expect(calls('timeline_events')).toHaveLength(2); expect(calls('work_sessions')).toHaveLength(2);
});
it('withholds prior-route failure in the first B commit and during pending B', async () => {
  inputs.set(a, { fallback: true, workError: true }); await draw(); const pending = deferred();
  reply = r => r.url.pathname.endsWith('/rpc/get_vehicle_profile_data') && r.body.p_vehicle_id === b ? pending.promise : undefined;
  await visit(b); const first = frames.find(frame => frame.route === b)!;
  expect(first.state).toEqual({ timeline: 'pending', work: 'pending' }); expect(first.statuses).not.toContain(unavailable('work'));
  await act(async () => pending.resolve(json(profile(b)))); await flush(); expect(state()).toEqual({ timeline: 'ready', work: 'ready' });
});
it('refuses departed A failures after current B is ready', async () => {
  inputs.set(a, { fallback: true }); const tl = deferred(), ws = deferred();
  reply = r => core(r) ? r.url.pathname.endsWith('timeline_events') ? tl.promise : ws.promise : undefined;
  await draw(); await visit(b); await resolveBoth(tl, ws, refused(), refused());
  expect(current.vehicleId).toBe(b); expect(statuses()).toEqual([]);
  expect(current.timelineEvents.map(e => e.id)).toEqual([`${b}-known`]);
});
it('does not revive an ended A1 failure when A2 has completed', async () => {
  inputs.set(a, { fallback: true }); const tl = deferred(), ws = deferred(); let old = true;
  reply = r => old && core(r) ? r.url.pathname.endsWith('timeline_events') ? tl.promise : ws.promise : undefined;
  await draw(); await visit(b); old = false; inputs.set(a, { timeline: [event('Fresh A2')], work: [] }); await visit(a);
  await resolveBoth(tl, ws, refused(), refused()); expect(current.timelineEvents[0].id).toBe('Fresh A2');
  expect(statuses()).toEqual([]);
});
it('keeps the newest supplementary read when an older same-primary read completes last', async () => {
  await draw(); const tl = deferred(), ws = deferred(); let hold = true;
  reply = r => hold && core(r) ? r.url.pathname.endsWith('timeline_events') ? tl.promise : ws.promise : undefined;
  await act(async () => { void current.reloadTimeline(); }); hold = false;
  inputs.set(a, { timeline: [event('Newest supplementary event')], work: [] });
  await act(async () => { await current.reloadTimeline(); }); expect(current.timelineEvents[0].id).toBe('Newest supplementary event');
  await resolveBoth(tl, ws, refused(), refused());
  expect(current.timelineEvents.map(e => e.id)).toEqual(['Newest supplementary event']); expect(state()).toEqual({ timeline: 'ready', work: 'ready' });
});
it('retains primary RPC authority over a supplementary read started while that primary was pending', async () => {
  const primary = deferred(), tl = deferred(), ws = deferred();
  reply = r => r.url.pathname.endsWith('/rpc/get_vehicle_profile_data') ? primary.promise : core(r) ? r.url.pathname.endsWith('timeline_events') ? tl.promise : ws.promise : undefined;
  await draw(); await act(async () => { void current.reloadTimeline(); });
  await act(async () => primary.resolve(json(profile(a)))); await flush(); expect(current.timelineEvents[0].id).toBe(`${a}-known`);
  await resolveBoth(tl, ws, refused(), refused()); expect(current.timelineEvents.map(e => e.id)).toEqual([`${a}-known`]);
  expect(state()).toEqual({ timeline: 'ready', work: 'ready' });
});
it('preserves existing primary-reload supersession of an older supplementary response', async () => {
  await draw(); const tl = deferred(), ws = deferred(); reply = r => core(r) ? r.url.pathname.endsWith('timeline_events') ? tl.promise : ws.promise : undefined;
  await act(async () => { void current.reloadTimeline(); }); inputs.set(a, { timeline: [event('Authoritative primary')], work: [] });
  await act(async () => { await current.reloadVehicle(); }); await resolveBoth(tl, ws, refused(), refused());
  expect(current.timelineEvents.map(e => e.id)).toEqual(['Authoritative primary']); expect(statuses()).toEqual([]);
});
it('preserves exact fallback predicates and the existing one-read demand', async () => {
  inputs.set(a, { fallback: true, timeline: [event('Useful fallback')], work: [work('Useful work')] }); await draw();
  const tl = calls('timeline_events'), ws = calls('work_sessions'); expect(tl).toHaveLength(1); expect(ws).toHaveLength(1);
  expect(Object.fromEntries(tl[0].url.searchParams)).toEqual({ select: '*', vehicle_id: `eq.${a}`, order: 'event_date.desc', limit: '200' });
  expect(Object.fromEntries(ws[0].url.searchParams)).toEqual({ select: 'id,session_date,title,work_type,image_count,duration_minutes,total_parts_cost,work_description,status,total_labor_cost,total_job_cost,session_type',
    vehicle_id: `eq.${a}`, or: '(session_type.is.null,session_type.not.in.(imessage_sync,baseline_backfill))', order: 'session_date.desc' });
  expect(current.timelineEvents.map(e => e.id)).toEqual(['Useful fallback', 'Useful work']);
});
it('does not let a departed route action invalidate the current pending supplementary read', async () => {
  await draw(); const oldReload = current.reloadTimeline, tl = deferred(), ws = deferred();
  inputs.set(b, { fallback: true }); reply = r => core(r, b) ? r.url.pathname.endsWith('timeline_events') ? tl.promise : ws.promise : undefined;
  await visit(b); await act(async () => { await oldReload(); });
  await resolveBoth(tl, ws, json([event('Current B event')]), json([]));
  expect(current.timelineEvents.map(e => e.id)).toEqual(['Current B event']); expect(statuses()).toEqual([]);
});
it('turns the existing supplementary timeout into a generic terminal state without discarding known content', async () => {
  await draw(true); const pending = deferred(); reply = r => core(r) ? pending.promise : undefined;
  await act(async () => { void current.reloadTimeline(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
  expect(current.timelineEvents.map(e => e.id)).toEqual([`${a}-known`]);
  expect(statuses()).toContain(unavailable('timeline')); expect(statuses()).toContain(unavailable('work'));
  expect(drawer().textContent).not.toContain('NO ACTIVITY'); expect(drawer().textContent).not.toContain(pendingText);
  expect(calls('timeline_events')).toHaveLength(1); expect(calls('work_sessions')).toHaveLength(1);
});
it('keeps existing fallback demand and useful fallback rows after an unusable primary timeline shape', async () => {
  inputs.set(a, { timeline: { not: 'an array' }, work: [] });
  reply = r => r.url.pathname === '/rest/v1/timeline_events' ? json([event('Recovered fallback event')]) : undefined;
  await draw(); expect(calls('timeline_events')).toHaveLength(1); expect(calls('work_sessions')).toHaveLength(1);
  expect(current.timelineEvents.map(e => e.id)).toEqual(['Recovered fallback event']);
  expect(state()).toEqual({ timeline: 'ready', work: 'ready' }); expect(statuses()).toEqual([]);
});
