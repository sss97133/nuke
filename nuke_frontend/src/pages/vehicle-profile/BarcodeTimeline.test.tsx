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

const common = '2026-10-02', photoA = '2026-08-12', workA = '2026-08-14', photoB = '2026-09-11';
type Request = { url: URL; method: string; body: any };
let root: Root, host: HTMLDivElement, queryClient: QueryClient, current: ReturnType<typeof useVehicleProfile>, go: ReturnType<typeof useNavigate>;
let a: string, b: string, serial = 0, requests: Request[], frames: ReturnType<typeof snapshot>[];
let reply: ((request: Request) => Response | Promise<Response> | undefined) | null, emptyPrimary: Set<string>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const depth = (id: string) => [{ day: common, photos: 10, seen: 10, placed: 10, depth: id === a ? 0.7 : 0.2 }];
const contributions = (id: string) => id === a ? [{ day: photoA, kind: 'photo', n: 17 }, { day: workA, kind: 'work', n: 3 }]
  : [{ day: photoB, kind: 'photo', n: 5 }];
const photo = (id: string) => ({ id: `${id}-photo`, image_url: `https://images.test/${id}.jpg`, source: 'owner_upload', is_primary: true, vehicle_zone: 'ext_front' });
const profile = (id: string) => ({ vehicle: { id, is_public: true, make: 'Ford', model: `Synthetic-${id}` }, images: [photo(id)],
  timeline_events: emptyPrimary.has(id) ? [] : [{ id: `${id}-native`, event_date: common, event_type: 'inspection' }], work_sessions: [], stats: { comment_count: 0, observation_count: 0 } });
function snapshot() {
  return { route: current?.vehicleId, vehicle: current?.vehicle?.id, rendered: !!host.querySelector('[aria-label="Vehicle timeline"]'),
    cells: [...host.querySelectorAll<HTMLElement>('.hm-c[data-date]')].map(cell => ({ day: cell.dataset.date, title: cell.title, heat: cell.className })),
    counts: [...host.querySelectorAll('.timeline-filter-pill')].map(button => button.textContent),
    stripeColors: [...host.querySelectorAll<HTMLElement>('.barcode-stripe__fill')].map(stripe => stripe.style.background).filter(Boolean) };
}
function Probe() {
  current = useVehicleProfile(); go = useNavigate();
  useLayoutEffect(() => { frames.push(snapshot()); });
  return <BarcodeTimeline />;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) });
  const id = (suffix: number) => `00000000-0000-${String(++serial).padStart(4, '0')}-0000-${String(suffix).padStart(12, '0')}`;
  a = id(1); b = id(2); requests = []; frames = []; reply = null; emptyPrimary = new Set();
  fixture.client = createClient('https://barcode-state.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `barcode-${serial}` },
    global: { fetch: async (input, init) => {
      const request = { url: new URL(input instanceof globalThis.Request ? input.url : String(input)), method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
      requests.push(request);
      const path = request.url.pathname, rpc = path.split('/').pop();
      if (!['GET', 'HEAD'].includes(request.method) && !(request.method === 'POST' && path.startsWith('/rest/v1/rpc/')
        && ['get_vehicle_profile_data', 'get_vehicle_day_depth', 'get_vehicle_contribution_days'].includes(rpc!))) {
        return json({ code: '42501', message: 'Synthetic transport denies writes and functions' }, 403);
      }
      const special = reply?.(request); if (special) return (await special).clone();
      const subject = request.body?.p_vehicle_id ?? request.url.searchParams.get('vehicle_id')?.replace(/^eq\./, '');
      if (rpc === 'get_vehicle_profile_data') return json(profile(subject));
      if (rpc === 'get_vehicle_day_depth') return json(depth(subject));
      if (rpc === 'get_vehicle_contribution_days') return json(contributions(subject));
      if (path === '/rest/v1/vehicle_images') return json([photo(subject)]);
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
  await act(async () => root.unmount()); queryClient.clear(); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(requests.some(r => r.url.pathname.startsWith('/functions/'))).toBe(false);
  for (const r of requests.filter(r => ['get_vehicle_day_depth', 'get_vehicle_contribution_days'].some(name => r.url.pathname.endsWith(`/rpc/${name}`)))) {
    expect(r.method).toBe('POST'); expect(Object.keys(r.body)).toEqual(['p_vehicle_id']); expect([a, b]).toContain(r.body.p_vehicle_id);
  }
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function draw() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/vehicle/${a}`]}><Routes>
    <Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><Probe /></VehicleProfileProvider>} />
  </Routes></MemoryRouter></QueryClientProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
}
async function openCalendar() {
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Vehicle timeline"]');
  if (button?.getAttribute('aria-expanded') === 'false') await act(async () => button.click());
  const details = host.querySelector<HTMLDetailsElement>('details.timeline-view-options');
  if (details && !details.open) await act(async () => details.querySelector('summary')!.click());
  expect(host.querySelector('[aria-label="Vehicle calendar"]')?.hasAttribute('hidden')).toBe(false);
}
const visit = async (id: string) => { await act(async () => go(`/vehicle/${id}`)); await act(async () => { await vi.advanceTimersByTimeAsync(5); }); };
const cell = (day: string) => host.querySelector<HTMLElement>(`.hm-c[data-date="${day}"]`);
const calls = (name: string, id: string) => requests.filter(r => r.url.pathname.endsWith(`/rpc/${name}`) && r.body?.p_vehicle_id === id);
function deferred() { let resolve!: (response: Response) => void; return { promise: new Promise<Response>(done => { resolve = done; }), resolve }; }
const auxiliary = (request: Request, id: string) => request.body?.p_vehicle_id === id && ['get_vehicle_day_depth', 'get_vehicle_contribution_days'].some(name => request.url.pathname.endsWith(`/rpc/${name}`));

it('keeps current contribution titles/counts and current depth useful with one read each', async () => {
  await draw(); await openCalendar(); expect(cell(photoA)?.title).toContain('17 photos'); expect(cell(common)?.className).toContain('l4');
  expect(cell(workA)?.title).toContain('Work'); expect(snapshot().counts).toEqual([]);
  expect(calls('get_vehicle_day_depth', a)).toHaveLength(1); expect(calls('get_vehicle_contribution_days', a)).toHaveLength(1);
});
it('withholds A contribution days/counts while B has its own raw event and pending auxiliary reads', async () => {
  await draw(); await openCalendar(); const pending = deferred(); reply = r => auxiliary(r, b) ? pending.promise : undefined;
  await visit(b); await openCalendar(); expect(current.vehicle?.id).toBe(b);
  expect({ aPhoto: cell(photoA)?.title ?? null, aWork: cell(workA)?.title ?? null, counts: snapshot().counts }).toEqual({ aPhoto: null, aWork: null,
    counts: [] });
});
it('withholds A analysis depth while B has a raw event on the same day', async () => {
  await draw(); await openCalendar(); const pending = deferred(); reply = r => auxiliary(r, b) ? pending.promise : undefined;
  await visit(b); await openCalendar(); expect(cell(common)?.className).toBe('hm-c l1 ');
});
it('does not commit A auxiliary state in the first rendered B timeline frame', async () => {
  await draw(); await openCalendar(); const pending = deferred(); reply = r => auxiliary(r, b) ? pending.promise : undefined;
  await visit(b); const first = frames.find(frame => frame.route === b && frame.rendered)!;
  expect(first.vehicle).toBe(b);
  expect({ aDay: first.cells.some(c => c.day === photoA), commonHeat: first.cells.find(c => c.day === common)?.heat }).toEqual({ aDay: false, commonHeat: 'hm-c l1 ' });
});
it.each(['get_vehicle_contribution_days', 'get_vehicle_day_depth'])('does not retain A %s values after the B reader fails', async name => {
  await draw(); await openCalendar(); reply = r => auxiliary(r, b) ? r.url.pathname.endsWith(name) ? json({ code: '42501', message: 'Synthetic refused read' }, 403) : json([]) : undefined;
  await visit(b); await openCalendar();
  if (name === 'get_vehicle_contribution_days') expect(cell(photoA)).toBeNull();
  else expect(cell(common)?.className).toBe('hm-c l1 ');
});
it('keeps successful empty B auxiliary results and the native inspection useful', async () => {
  await draw(); await openCalendar(); reply = r => auxiliary(r, b) ? json([]) : undefined;
  await visit(b); await openCalendar(); expect(cell(photoA)).toBeNull(); expect(cell(common)?.title).toContain('Inspection'); expect(cell(common)?.className).toBe('hm-c l1 ');
});
it('keeps B own contribution/depth results useful without another reader call', async () => {
  await draw(); await openCalendar(); await visit(b); await openCalendar();
  expect(cell(photoA)).toBeNull(); expect(cell(photoB)?.title).toContain('5 photos'); expect(cell(common)?.className).toBe('hm-c l2 ');
  expect(calls('get_vehicle_day_depth', b)).toHaveLength(1); expect(calls('get_vehicle_contribution_days', b)).toHaveLength(1);
});
it('refuses late departed A auxiliary callbacks after B results are visible', async () => {
  const pending = deferred(); reply = r => auxiliary(r, a) ? pending.promise : undefined;
  await draw(); await visit(b); await openCalendar();
  await act(async () => pending.resolve(json(contributions(a))));
  expect(cell(photoA)).toBeNull(); expect(cell(photoB)?.title).toContain('5 photos'); expect(cell(common)?.className).toBe('hm-c l2 ');
});
it('preserves a valid unchanged-subject pending result across primary reload without duplicate demand', async () => {
  const heldDepth = deferred(), heldDays = deferred(); reply = r => auxiliary(r, a) ? r.url.pathname.endsWith('get_vehicle_day_depth') ? heldDepth.promise : heldDays.promise : undefined;
  await draw(); await act(async () => { await current.reloadVehicle(); }); await openCalendar();
  await act(async () => { heldDepth.resolve(json(depth(a))); heldDays.resolve(json(contributions(a))); });
  expect(cell(photoA)?.title).toContain('17 photos'); expect(cell(common)?.className).toBe('hm-c l4 ');
  expect(calls('get_vehicle_day_depth', a)).toHaveLength(1); expect(calls('get_vehicle_contribution_days', a)).toHaveLength(1);
});
it('withholds ended-visit A supplementary values while a new A visit has fresh pending demand', async () => {
  await draw(); await openCalendar(); const pending = deferred(); reply = r => auxiliary(r, b) ? pending.promise : undefined;
  await visit(b); reply = r => auxiliary(r, a) || auxiliary(r, b) ? pending.promise : undefined; await visit(a); await openCalendar();
  expect({ aDay: cell(photoA)?.title ?? null, heat: cell(common)?.className }).toEqual({ aDay: null, heat: 'hm-c l1 ' });
  expect(calls('get_vehicle_contribution_days', a)).toHaveLength(2);
});
it('preserves the raw-event empty guard instead of showing auxiliary-only history', async () => {
  await draw(); emptyPrimary.add(b); const pending = deferred(); reply = r => auxiliary(r, b) ? pending.promise : undefined;
  await visit(b); expect(current.timelineEvents).toHaveLength(0); expect(host.querySelector('[aria-label="Vehicle timeline"]')).toBeNull();
});

it.each([{ value: 0, heat: 'l1' }, { value: 0.18, heat: 'l2' }, { value: 0.35, heat: 'l3' }, { value: 0.5, heat: 'l4' }])('preserves current depth threshold $value as $heat', async ({ value, heat }) => {
  reply = r => r.url.pathname.endsWith('/rpc/get_vehicle_day_depth') ? json([{ day: common, depth: value }]) : undefined;
  await draw(); await openCalendar(); expect(cell(common)?.className).toBe(`hm-c ${heat} `);
});
it.each(['get_vehicle_contribution_days', 'get_vehicle_day_depth'])('does not retain old %s values when B returns null', async name => {
  await draw(); await openCalendar(); reply = r => auxiliary(r, b) && r.url.pathname.endsWith(name) ? json(null) : undefined;
  await visit(b); await openCalendar();
  if (name === 'get_vehicle_contribution_days') { expect(cell(photoA)).toBeNull(); expect(cell(common)?.className).toBe('hm-c l2 '); }
  else { expect(cell(common)?.className).toBe('hm-c l1 '); expect(cell(photoB)?.title).toContain('5 photos'); }
});
it.each(['get_vehicle_contribution_days', 'get_vehicle_day_depth'])('preserves the other current reader while B %s is pending', async name => {
  await draw(); await openCalendar(); const pending = deferred(); reply = r => auxiliary(r, b) && r.url.pathname.endsWith(name) ? pending.promise : undefined;
  await visit(b); await openCalendar();
  if (name === 'get_vehicle_contribution_days') { expect(cell(photoA)).toBeNull(); expect(cell(common)?.className).toBe('hm-c l2 '); }
  else { expect(cell(common)?.className).toBe('hm-c l1 '); expect(cell(photoB)?.title).toContain('5 photos'); }
});
it.each(['get_vehicle_contribution_days', 'get_vehicle_day_depth'])('keeps unchanged pending %s useful, then withholds its ended A1 state in first A2 commit', async name => {
  const first = deferred(); reply = r => auxiliary(r, a) && r.url.pathname.endsWith(name) ? first.promise : undefined;
  await draw(); await act(async () => current.reloadVehicle()); await openCalendar();
  await act(async () => first.resolve(json(name === 'get_vehicle_contribution_days' ? contributions(a) : depth(a))));
  if (name === 'get_vehicle_contribution_days') expect(cell(photoA)?.title).toContain('17 photos'); else expect(cell(common)?.className).toBe('hm-c l4 ');
  expect(calls(name, a)).toHaveLength(1);
  const next = deferred(); reply = r => auxiliary(r, b) || auxiliary(r, a) ? next.promise : undefined;
  await visit(b); frames = []; await visit(a); await openCalendar();
  const firstReturned = frames.find(frame => frame.route === a && frame.rendered)!;
  if (name === 'get_vehicle_contribution_days') expect(firstReturned.cells.some(c => c.day === photoA)).toBe(false);
  else expect(firstReturned.cells.find(c => c.day === common)?.heat).toBe('hm-c l1 ');
  expect(calls(name, a)).toHaveLength(2);
});
it('keeps current B days, day click and journal navigation useful', async () => {
  await draw(); await visit(b); await openCalendar();
  expect(host.querySelector('.timeline-filter-pill')).toBeNull(); expect(cell(common)).not.toBeNull(); expect(cell(photoB)?.title).toContain('5 photos');
  await import('./VehicleDayDrawer'); await act(async () => cell(photoB)!.click());
  expect(host.querySelector('[data-day-drawer]')).not.toBeNull();
  expect(host.querySelector(`a[href="/journal/${photoB}"]`)).not.toBeNull();
  const drawerRead = requests.find(r => r.url.pathname === '/rest/v1/vehicle_images' && r.url.searchParams.get('select') === 'id,image_url,taken_at,source,source_url');
  expect(drawerRead?.url.searchParams.get('vehicle_id')).toBe(`eq.${b}`);
});

const noDrawerPhotos = (request: Request) => request.url.pathname === '/rest/v1/vehicle_images' && request.url.searchParams.has('taken_at') ? json([]) : undefined;
const drawerText = () => host.querySelector('[data-day-drawer]')?.textContent ?? '';
const missingWork = 'Work-session details unavailable in this read.';
async function openReceipt(day: string) {
  await import('./VehicleDayDrawer');
  await act(async () => cell(day)!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
}
it('qualifies a current positive work-summary day instead of claiming no activity or inventing detail counts', async () => {
  reply = noDrawerPhotos; await draw(); await openCalendar(); await openReceipt(workA);
  expect({ text: drawerText(), summaryCalls: calls('get_vehicle_contribution_days', a).length }).toEqual({
    text: expect.stringContaining(missingWork), summaryCalls: 1,
  });
  expect(drawerText()).not.toContain('NO ACTIVITY'); expect(drawerText()).not.toContain('WORK 3');
});
it('carries summary presence through actual next-day navigation only for its exact day', async () => {
  reply = noDrawerPhotos; await draw(); await openCalendar(); await openReceipt(photoA);
  expect(drawerText()).toContain('NO ACTIVITY'); expect(drawerText()).not.toContain(missingWork);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next day"]')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  expect(drawerText()).toContain(missingWork); expect(drawerText()).not.toContain('NO ACTIVITY');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next day"]')!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  expect(drawerText()).not.toContain(missingWork); expect(drawerText()).toContain('inspection');
  expect(calls('get_vehicle_contribution_days', a)).toHaveLength(1);
});
it.each([0, -1, null, 'not-a-count'])('does not turn nonpositive/unusable summary count %j into a missing-work assertion', async n => {
  reply = request => request.url.pathname.endsWith('/rpc/get_vehicle_contribution_days') ? json([{ day: workA, kind: 'work', n }]) : noDrawerPhotos(request);
  await draw(); await openCalendar(); await openReceipt(workA);
  expect(drawerText()).toContain('NO ACTIVITY'); expect(drawerText()).not.toContain(missingWork);
});
it('withholds completed A work-summary presence from the B receipt while B summary is pending', async () => {
  reply = noDrawerPhotos; await draw(); await openCalendar(); await openReceipt(workA);
  const pending = deferred(); reply = request => request.url.pathname.endsWith('/rpc/get_vehicle_contribution_days') && request.body?.p_vehicle_id === b ? pending.promise : noDrawerPhotos(request);
  await visit(b); expect(current.vehicleId).toBe(b);
  expect(drawerText()).not.toContain(missingWork); expect(drawerText()).toContain('NO ACTIVITY');
});
it('refuses an obsolete A work-summary reply while the actual B day receipt is open', async () => {
  const pending = deferred(); reply = request => request.url.pathname.endsWith('/rpc/get_vehicle_contribution_days') && request.body?.p_vehicle_id === a ? pending.promise : noDrawerPhotos(request);
  await draw(); await openCalendar(); await openReceipt(common); await visit(b);
  await act(async () => pending.resolve(json([{ day: common, kind: 'work', n: 1 }])));
  expect(current.vehicleId).toBe(b); expect(drawerText()).not.toContain(missingWork); expect(drawerText()).toContain('inspection');
  expect(calls('get_vehicle_contribution_days', b)).toHaveLength(1);
});
it('does not revive ended A work presence on a return visit before the new A summary completes', async () => {
  reply = noDrawerPhotos; await draw(); await openCalendar(); await openReceipt(workA); await visit(b);
  const pending = deferred(); reply = request => request.url.pathname.endsWith('/rpc/get_vehicle_contribution_days') && request.body?.p_vehicle_id === a ? pending.promise : noDrawerPhotos(request);
  await visit(a); expect(drawerText()).not.toContain(missingWork);
  await act(async () => pending.resolve(json([{ day: workA, kind: 'work', n: 1 }])));
  expect(drawerText()).toContain(missingWork); expect(calls('get_vehicle_contribution_days', a)).toHaveLength(2);
});
it('preserves a useful pending unchanged-vehicle summary across primary reload without extra demand', async () => {
  const pending = deferred(); reply = request => request.url.pathname.endsWith('/rpc/get_vehicle_contribution_days') ? pending.promise : noDrawerPhotos(request);
  await draw(); await act(async () => current.reloadVehicle());
  await act(async () => pending.resolve(json([{ day: workA, kind: 'work', n: 1 }])));
  await openCalendar(); await openReceipt(workA); expect(drawerText()).toContain(missingWork);
  expect(calls('get_vehicle_contribution_days', a)).toHaveLength(1);
});
it('retains actual work detail/story/amount/duration instead of showing a missing-detail warning', async () => {
  reply = request => request.url.pathname.endsWith('/rpc/get_vehicle_profile_data') ? json({ ...profile(request.body.p_vehicle_id), timeline_events: [{
    id: 'synthetic-known-work', event_date: workA, event_type: 'work_session', title: 'Retained work detail', cost_amount: 125,
    metadata: { duration_minutes: 60, work_description: 'Retained work story' },
  }] }) : noDrawerPhotos(request);
  await draw(); await openCalendar(); await openReceipt(workA);
  expect(drawerText()).toContain('Retained work story'); expect(drawerText()).toContain('125 (currency unknown)');
  expect(drawerText()).toContain('WORK 1'); expect(drawerText()).toContain('1h 0m'); expect(drawerText()).not.toContain(missingWork);
});


it('shows the calendar alone, collapses to the barcode on scroll, and restores the same days on return', async () => {
  let anchorTop = 200;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.className === 'vp-timeline-anchor' ? anchorTop : 0, height: 0 } as DOMRect;
  });
  await draw();
  const calendar = host.querySelector<HTMLElement>('[aria-label="Vehicle calendar"]')!;
  const barcode = host.querySelector<HTMLElement>('[aria-label="Vehicle timeline"]')!;
  expect(calendar.hidden).toBe(false); expect(barcode.hidden).toBe(true);
  expect(host.querySelector('.timeline-view-options')).toBeNull();
  const days = snapshot().cells;
  await import('./VehicleDayDrawer');
  await act(async () => cell(photoA)!.click());
  anchorTop = -1;
  await act(async () => window.dispatchEvent(new Event('scroll')));
  expect(calendar.hidden).toBe(true); expect(barcode.hidden).toBe(false);
  expect(host.querySelector('[data-day-drawer]')).not.toBeNull();
  expect(host.querySelector('[data-day-drawer]')!.closest('[hidden]')).toBeNull();
  anchorTop = 200;
  await act(async () => window.dispatchEvent(new Event('scroll')));
  expect(calendar.hidden).toBe(false); expect(barcode.hidden).toBe(true);
  expect(snapshot().cells).toEqual(days);
  expect(calls('get_vehicle_contribution_days', a)).toHaveLength(1);
});
