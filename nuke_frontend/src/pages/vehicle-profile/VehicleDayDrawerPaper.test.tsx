// @vitest-environment jsdom
// The day's paper: a 'document' contribution day opens the drawer with one get_vehicle_day_documents read; the drawer
// shows vendor, document and lines as returned, and prints money or a payer only when the reader returned them
// (the reader nulls both for a viewer not tied to the vehicle). A day without a document count never reads.
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

const paperDay = '2024-10-07', photoDay = '2026-10-02';
let root: Root, host: HTMLDivElement, queryClient: QueryClient, current: ReturnType<typeof useVehicleProfile>;
let vehicleId: string, serial = 0, tied: boolean, documentDays: number;
let requests: { method: string; url: URL; body: any }[];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const photo = () => ({ id: 'synthetic-photo', image_url: 'https://photos.test/synthetic.jpg', vehicle_id: vehicleId,
  is_primary: true, source: 'manual', vehicle_zone: 'ext_front', taken_at: `${photoDay}T12:00:00Z` });
const vehicle = () => ({ id: vehicleId, is_public: true, year: 1973, make: 'Pontiac', model: 'Synthetic' });
// What get_vehicle_day_documents returns: the same shape for every viewer, money and payer null unless tied.
const dayDocuments = () => ({ date: paperDay, tied, documents: [{
  receipt_id: 'synthetic-receipt', document_id: 'synthetic-document', vendor: 'Synthetic Machine Shop', vendor_address: tied ? '1 Shop St' : null,
  document_type: 'work_order', document_kind: 'parts_service', document_number: '9810', date: paperDay, date_source: 'data_v2.transaction_date',
  date_basis: 'printed_document_date', pages: 2, payer_as_named: tied ? 'Synthetic Builder' : null, payment_method: tied ? 'Visa' : null,
  subtotal: tied ? 650 : null, discount: null, shipping: null, tax: tied ? 54.76 : null, total: tied ? 2190 : null, currency: 'USD',
  link_basis: 'cited_document', link_confidence: 0.9,
  lines: [
    { line_number: 1, description: 'Bore cylinders .060', part_number: null, quantity: null, unit_price: null, amount: null, line_date: '2024-11-13', hours: 2.75, performer: 'Frank' },
    { line_number: 2, description: 'Piston set', part_number: 'KB-455', quantity: 1, unit_price: tied ? 650 : null, amount: tied ? 650 : null, line_date: null, hours: null, performer: null },
  ],
}] });
function Probe() {
  const profile = useVehicleProfile(); useLayoutEffect(() => { current = profile; });
  return <BarcodeTimeline />;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (text: string) => ({ width: text.length * 5 }) } as any);
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) });
  vehicleId = `00000000-0000-0000-0000-${String(++serial).padStart(12, '0')}`;
  requests = []; tied = false; documentDays = 1;
  fixture.client = createClient('https://timeline-paper.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-paper-${serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ method, url, body });
      const endpoint = url.pathname.replace('/rest/v1/', '');
      const allowedRpc = ['get_vehicle_profile_data', 'get_vehicle_day_depth', 'get_vehicle_contribution_days', 'get_vehicle_day_documents'];
      if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && allowedRpc.some(name => endpoint === `rpc/${name}`))) {
        return json({ code: '42501', message: 'Synthetic transport denies every write and function' }, 403);
      }
      if (endpoint === 'rpc/get_vehicle_profile_data') return json({ vehicle: vehicle(), images: [photo()], timeline_events: [{ id: `${vehicleId}-native`, event_date: photoDay, event_type: 'inspection' }], work_sessions: [], stats: { comment_count: 0, observation_count: 0 } });
      if (endpoint === 'rpc/get_vehicle_day_depth') return json([]);
      if (endpoint === 'rpc/get_vehicle_contribution_days') return json([{ day: photoDay, kind: 'photo', n: 1 }, ...(documentDays ? [{ day: paperDay, kind: 'document', n: documentDays }] : [])]);
      if (endpoint === 'rpc/get_vehicle_day_documents') return body?.p_date === paperDay ? json(dayDocuments()) : json({ date: body?.p_date, tied, documents: [] });
      if (endpoint === 'vehicles') return json(url.searchParams.get('select') === 'id' ? [{ id: vehicleId }] : vehicle());
      if (endpoint === 'vehicle_images') return json(url.searchParams.has('gte') || url.searchParams.get('taken_at')?.startsWith('gte.') ? [] : [photo()]);
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
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function showDay(day: string) {
  await Promise.all([import('./VehicleDayDrawer'), import('./AuctionSequenceBand')]);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/vehicle/${vehicleId}`]}>
    <Routes><Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><Probe /></VehicleProfileProvider>} /></Routes>
  </MemoryRouter></QueryClientProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  expect(current.vehicleId).toBe(vehicleId);
  await act(async () => (host.querySelector('[aria-label="Vehicle timeline"]') as HTMLButtonElement).click());
  const cell = host.querySelector(`[data-date="${day}"]`) as HTMLElement | null;
  expect(cell, `calendar cell for ${day}`).not.toBeNull();
  await act(async () => cell!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  return host.querySelector('[data-day-drawer]')?.textContent ?? '';
}
const paperReads = () => requests.filter(r => r.url.pathname.endsWith('/rpc/get_vehicle_day_documents'));

it('puts a document day on the calendar and opens it with one paper read, money and payer withheld as returned', async () => {
  const text = await showDay(paperDay);
  expect(paperReads()).toHaveLength(1);
  expect(paperReads()[0].body).toEqual({ p_vehicle_id: vehicleId, p_date: paperDay });
  expect(text).toContain('PAPER 1');
  expect(text).toContain('Synthetic Machine Shop · work order · #9810');
  expect(text).toContain('2 pages');
  expect(text).toContain('2024-11-13 · Frank · Bore cylinders .060');
  expect(text).toContain('2.75 h');
  expect(text).toContain('KB-455 · Piston set');
  expect(text).not.toContain('billed to');
  expect(text).not.toContain('USD');
  expect(text).not.toContain('2,190');
  expect(host.querySelector<HTMLElement>(`[data-date="${paperDay}"]`)?.title).toContain('Paper (1 receipt)');
});
it('prints the money and the payer when the reader returns them to a tied viewer', async () => {
  tied = true; const text = await showDay(paperDay);
  expect(text).toContain('2,190 USD');
  expect(text).toContain('billed to Synthetic Builder');
  expect(text).toContain('650 USD');
});
it('never reads paper for a day the timeline leg did not count', async () => {
  const text = await showDay(photoDay);
  expect(paperReads()).toHaveLength(0);
  expect(text).not.toContain('PAPER');
});
it('reports an unavailable paper read instead of an empty day', async () => {
  fixture.client = Object.assign(fixture.client, {});
  const original = fixture.client.rpc.bind(fixture.client);
  vi.spyOn(fixture.client, 'rpc').mockImplementation(((name: string, params: any) => name === 'get_vehicle_day_documents'
    ? Promise.resolve({ data: null, error: { message: 'synthetic failure' } }) : original(name, params)) as any);
  const text = await showDay(paperDay);
  expect(text).toContain('Paper unavailable in this read.');
  expect(text).not.toContain('NO ACTIVITY');
});
