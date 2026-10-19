// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
import BarcodeTimeline from './BarcodeTimeline';

const day = '2026-10-02';
let root: Root, host: HTMLDivElement, queryClient: QueryClient, current: ReturnType<typeof useVehicleProfile>;
let vehicleId: string, serial = 0, path: 'rpc' | 'fallback', row: any, extraSessions: any[], nativeEvents: any[];
let requests: { method: string; url: URL; body: any; authorization: string | null }[];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const photo = () => ({ id: 'synthetic-photo', image_url: 'https://photos.test/synthetic.jpg', vehicle_id: vehicleId,
  is_primary: true, source: 'manual', vehicle_zone: 'ext_front', taken_at: `${day}T12:00:00Z` });
const vehicle = () => ({ id: vehicleId, is_public: true, year: 1966, make: 'Ford', model: 'Mustang' });
function Probe() {
  const profile = useVehicleProfile(); useLayoutEffect(() => { current = profile; });
  return <BarcodeTimeline />;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) });
  vehicleId = `00000000-0000-0000-0000-${String(++serial).padStart(12, '0')}`;
  path = 'rpc'; requests = []; extraSessions = []; nativeEvents = [];
  row = { id: 'synthetic-session', vehicle_id: vehicleId, session_date: day, title: 'Synthetic recorded work',
    work_type: 'work', image_count: 0, duration_minutes: 60, total_parts_cost: 25, total_labor_cost: 100,
    total_job_cost: 125, work_description: 'Synthetic fixture only', status: 'completed', session_type: 'manual' };
  fixture.client = createClient('https://timeline-cost.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-cost-${serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ method, url, body, authorization: new Headers(init?.headers).get('authorization') });
      const endpoint = url.pathname.replace('/rest/v1/', '');
      const allowedRpc = ['get_vehicle_profile_data', 'get_vehicle_day_depth', 'get_vehicle_contribution_days'];
      if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && allowedRpc.some(name => endpoint === `rpc/${name}`))) {
        return json({ code: '42501', message: 'Synthetic transport denies every write and function' }, 403);
      }
      if (endpoint === 'rpc/get_vehicle_profile_data') return path === 'fallback' ? json({ code: '57014', message: 'synthetic fallback' }, 500)
        : json({ vehicle: vehicle(), images: [photo()], timeline_events: nativeEvents, work_sessions: [row, ...extraSessions], stats: { comment_count: 0, observation_count: 0 } });
      if (endpoint === 'vehicles') return json(vehicle());
      if (endpoint === 'vehicle_images') return json(url.searchParams.has('gte') || url.searchParams.get('taken_at')?.startsWith('gte.') ? [] : [photo()]);
      if (endpoint === 'timeline_events') return json(nativeEvents);
      if (endpoint === 'work_sessions') {
        const fields = url.searchParams.get('select')!.split(',');
        return json([row, ...extraSessions].map(session => Object.fromEntries(fields.filter(f => f in session).map(f => [f, session[f]]))));
      }
      return json([]);
    } },
  });
  const user = { id: '00000000-0000-0000-0000-000000000099' };
  const session = { user, access_token: 'test-token', expires_at: 9999999999 };
  vi.spyOn(fixture.client.auth, 'getSession').mockResolvedValue({ data: { session }, error: null });
  vi.spyOn(fixture.client.auth, 'getUser').mockResolvedValue({ data: { user }, error: null });
  vi.spyOn(fixture.client.auth, 'onAuthStateChange').mockReturnValue({ data: { subscription: { unsubscribe() {} } } } as any);
  const channel: any = { on: () => channel, subscribe: () => channel };
  vi.spyOn(fixture.client, 'channel').mockReturnValue(channel); vi.spyOn(fixture.client, 'removeChannel').mockResolvedValue('ok');
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount()); queryClient.clear(); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(requests.some(r => r.url.pathname.startsWith('/functions/'))).toBe(false);
  expect(requests.filter(r => r.method === 'POST' && !r.url.pathname.includes('/rpc/')).every(r =>
    ['/rest/v1/vehicle_views', '/rest/v1/user_presence'].includes(r.url.pathname))).toBe(true);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function showDay() {
  // The actual lazy-loaded day consumer is preloaded without replacing its implementation.
  await import('./VehicleDayDrawer');
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/vehicle/${vehicleId}`]}>
    <Routes><Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><Probe /></VehicleProfileProvider>} /></Routes>
  </MemoryRouter></QueryClientProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  expect(current.session?.user?.id).toBe('00000000-0000-0000-0000-000000000099');
  await act(async () => (host.querySelector('[aria-label="Vehicle timeline"]') as HTMLButtonElement).click());
  await act(async () => (host.querySelector(`[data-date="${day}"]`) as HTMLElement).click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  const work = current.timelineEvents.find(event => event.id === row.id)!;
  expect(work.metadata).toMatchObject({ total_job_cost: row.total_job_cost, total_parts_cost: row.total_parts_cost, total_labor_cost: row.total_labor_cost });
  expect(requests.find(r => r.url.pathname.endsWith('/rpc/get_vehicle_profile_data'))?.authorization).toBe('Bearer test-token');
  const wsReads = requests.filter(r => r.url.pathname === '/rest/v1/work_sessions');
  expect(wsReads).toHaveLength(path === 'rpc' ? 0 : 1);
  if (wsReads.length) expect(wsReads[0].url.searchParams.get('or')).toBe('(session_type.is.null,session_type.not.in.(imessage_sync,baseline_backfill))');
  return { projected: work.cost_amount, text: host.querySelector('[data-day-drawer]')?.textContent ?? '' };
}
it.each(['rpc', 'fallback'] as const)('uses the stored inclusive job total once in actual %s timeline/day consumer', async mode => {
  path = mode; const actual = await showDay();
  expect(actual.text).toContain('Synthetic recorded work');
  expect(actual).toMatchObject({ projected: 125, text: expect.stringContaining('125 (currency unknown)') });
});
it.each(['rpc', 'fallback'] as const)('preserves useful %s cost when no additional parts are recorded', async mode => {
  path = mode; row.total_parts_cost = 0;
  const actual = await showDay(); expect(actual.projected).toBe(125); expect(actual.text).toContain('125 (currency unknown)');
});
it.each(['rpc', 'fallback'] as const)('retains a synthetic recorded authoritative %s total without re-adding parts', async mode => {
  path = mode; row.total_job_cost = 410;
  const actual = await showDay(); expect(actual).toMatchObject({ projected: 410, text: expect.stringContaining('410 (currency unknown)') });
});
it.each(['rpc', 'fallback'] as const)('keeps a missing %s total unknown without reconstructing from parts', async mode => {
  path = mode; row.total_job_cost = null; row.total_parts_cost = 25;
  const actual = await showDay();
  expect(actual.projected).toBeNull(); expect(actual.text).not.toMatch(/\$/);
});

it.each(['rpc', 'fallback'] as const)('preserves explicit %s zero while retaining current visible-zero omission', async mode => {
  path = mode; row.total_job_cost = 0; row.total_parts_cost = 25;
  const actual = await showDay(); expect(actual.projected).toBe(0); expect(actual.text).not.toMatch(/\$/);
});
it.each(['rpc', 'fallback'] as const)('keeps all-null %s costs unknown with the existing absence display', async mode => {
  path = mode; row.total_job_cost = null; row.total_parts_cost = null; row.total_labor_cost = null;
  const actual = await showDay(); expect(actual.projected).toBeNull(); expect(actual.text).not.toMatch(/\$/);
});

it.each(['rpc', 'fallback'] as const)('keeps an absent %s total unknown without manufacturing zero', async mode => {
  path = mode; delete row.total_job_cost;
  const actual = await showDay(); expect(actual.projected).toBeNull(); expect(actual.text).not.toMatch(/\$/);
});
it.each(['rpc', 'fallback'] as const)('preserves a fractional %s total and the existing rounded display', async mode => {
  path = mode; row.total_job_cost = 125.5; row.total_parts_cost = 25.25;
  const actual = await showDay(); expect(actual.projected).toBe(125.5); expect(actual.text).toContain('126 (currency unknown)');
});
it.each(['rpc', 'fallback'] as const)('preserves a present %s total when components are unknown', async mode => {
  path = mode; row.total_parts_cost = null; row.total_labor_cost = null;
  const actual = await showDay(); expect(actual.projected).toBe(125); expect(actual.text).toContain('125 (currency unknown)');
});
it.each(['rpc', 'fallback'] as const)('retains individual %s work values without claiming a day aggregate', async mode => {
  path = mode;
  extraSessions = [
    { ...row, id: 'second-synthetic-session', title: 'Second synthetic work', total_job_cost: 75, total_parts_cost: 15 },
    { ...row, id: 'unknown-synthetic-session', title: 'Unknown synthetic work', total_job_cost: null, total_parts_cost: 30 },
  ];
  nativeEvents = [{ id: 'synthetic-sale', event_date: day, event_type: 'sale', title: 'Synthetic separate sale', cost_amount: 800 }];
  const actual = await showDay();
  const facets = [...host.querySelectorAll('[data-day-drawer] span')].find(node => node.textContent === 'WORK 3')?.parentElement?.textContent;
  expect(facets).toBe('WORK 3'); expect(actual.text).toContain('125 (currency unknown)'); expect(actual.text).toContain('75 (currency unknown)');
  expect(actual.text).toContain('Unknown synthetic work'); expect(actual.text).toContain('Synthetic separate sale800 (currency unknown)');
  expect(current.timelineEvents.find(event => event.id === nativeEvents[0].id)).toEqual(nativeEvents[0]);
  expect(current.timelineEvents.find(event => event.id === 'unknown-synthetic-session')?.cost_amount).toBeNull();
});
