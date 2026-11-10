// @vitest-environment jsdom
// The receipt-to-work context under each paper line: one get_vehicle_receipt_work_context read per paper day, shown
// behind a tap as a PROPOSED context with the frames the reader returned (withheld frames only counted), lineage with
// the unresolved page, document-attributed printed claims, separately labelled photographer / printed performer /
// custodian / holder, the question state, and withdrawn lines apart. Never ownership, payment, installation or worker.
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: null, loading: false }) }));
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
let vehicleId: string, serial = 0, tied: boolean, documentDays: number, contextFails = false;
let requests: { method: string; url: URL; body: any }[];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const photo = () => ({ id: 'synthetic-photo', image_url: 'https://photos.test/synthetic.jpg', vehicle_id: vehicleId,
  is_primary: true, source: 'manual', vehicle_zone: 'ext_front', taken_at: `${photoDay}T12:00:00Z` });
const vehicle = () => ({ id: vehicleId, is_public: true, year: 1973, make: 'Pontiac', model: 'Synthetic' });
const pagePath = '00000000-0000-0000-0000-000000000099/financial/' + 'a'.repeat(64) + '.heic';
// What get_vehicle_day_documents returns: the same shape for every viewer, money, payer and the page null unless tied.
const dayDocuments = () => ({ date: paperDay, tied, documents: [{
  receipt_id: 'synthetic-receipt', document_id: 'synthetic-document', vendor: 'Synthetic Machine Shop', vendor_address: tied ? '1 Shop St' : null,
  vendor_org: { name: 'Synthetic Machine Shop', logo_url: 'https://nuke.ag/source-logos/synthetic.png', website: 'https://shop.test' },
  page: tied ? { bucket: 'user-documents', path: pagePath, bytes: 1234567, page_no: 1 } : null, page_paths: tied ? [pagePath] : null,
  document_type: 'work_order', document_kind: 'parts_service', document_number: '9810', date: paperDay, date_source: 'data_v2.transaction_date',
  date_basis: 'printed_document_date', pages: 2, payer_as_named: tied ? 'Synthetic Builder' : null, payment_method: tied ? 'Visa' : null,
  subtotal: tied ? 650 : null, discount: null, shipping: null, tax: tied ? 54.76 : null, total: tied ? 2190 : null, currency: 'USD',
  link_basis: 'cited_document', link_confidence: 0.9,
  lines: [
    { line_number: 1, description: 'Bore cylinders .060', part_number: null, quantity: null, unit_price: null, amount: null, line_date: '2024-11-13', hours: 2.75, performer: 'Frank',
      install: { zone: 'engine', status: 'photographed', photo_day: photoDay, photo_count: 1, image_id: 'synthetic-photo' } },
    { line_number: 2, description: 'Piston set', part_number: 'KB-455', quantity: 1, unit_price: tied ? 650 : null, amount: tied ? 650 : null, line_date: null, hours: null, performer: null,
      install: { zone: 'engine', status: 'photographed', photo_day: photoDay, photo_count: 1, image_id: 'synthetic-photo' } },
    { line_number: 3, description: 'Dash cluster lens', part_number: 'F70813', quantity: 1, unit_price: tied ? 70 : null, amount: tied ? 70 : null, line_date: null, hours: null, performer: null,
      install: { zone: 'dashboard', status: 'no_photo', photo_day: null, photo_count: 0, image_id: null } },
    { line_number: 4, description: 'Shipping', part_number: null, quantity: null, unit_price: null, amount: tied ? 12 : null, line_date: null, hours: null, performer: null,
      install: { zone: null, status: 'no_zone', photo_day: null, photo_count: null, image_id: null } },
  ],
}] });

// What get_vehicle_receipt_work_context returns for the paper day: line 1 proposed with one visible frame and two withheld,
// an open (claimed) question; line 2 answered; line 3's context withdrawn.
const workContext = (pageDate: string) => pageDate !== paperDay ? { visible: true, tied, lines: [], withdrawn: [] } : { visible: true, tied, lines: [
  { evidence_id: 'e1', receipt_id: 'synthetic-receipt', item_id: 'i1', line_number: 1, description: 'Bore cylinders .060', conclusion: 'work_day_photographed',
    confidence: 0.61, status: 'proposed', anchor_date: '2024-11-13', anchor_source: 'line_date', zone: 'engine', days_to_first_photo: 0,
    frames: [{ image_id: 'synthetic-photo', taken_at: '2024-11-13T15:00:00Z', image_url: 'https://photos.test/synthetic.jpg', thumbnail_url: null,
      photographer: { label: 'photographer (from the photo record)', attribution: 'Synthetic Photographer', documented_by_user_id: null } }],
    frames_hidden: 2,
    lineage: { receipt_id: 'synthetic-receipt', source_document_table: 'vehicle_documents', source_document_id: 'synthetic-document', line_number: 1,
      item_id: 'i1', link_id: 'l1', link_basis: 'cited_document', link_confidence: 0.9, page: null, page_reason: 'line-to-page mapping unresolved' },
    printed: { attributed_to: 'document', line_date: '2024-11-13', hours: 2.75, performer: 'Frank' },
    printed_performer: { label: 'performer as printed on the document (document testimony)', value: 'Frank' },
    custodian: { label: 'account the document is filed under (custody only, not ownership or payment)', user_id: null, masked: true },
    judgment: { question_id: 'q1', status: 'claimed', holder: { label: 'worker holding this question', claimed_by: 'synthetic-worker', claimed_at: null }, answer: null } },
  { evidence_id: 'e2', receipt_id: 'synthetic-receipt', item_id: 'i2', line_number: 2, description: 'Piston set', conclusion: 'install_window_photographed',
    confidence: 0.57, status: 'proposed', frames: [], frames_hidden: 0,
    lineage: { receipt_id: 'synthetic-receipt', source_document_table: 'vehicle_documents', source_document_id: 'synthetic-document', line_number: 2,
      item_id: 'i2', link_id: 'l1', link_basis: 'cited_document', link_confidence: 0.9, page: null, page_reason: 'line-to-page mapping unresolved' },
    printed: { attributed_to: 'document', line_date: null, hours: null, performer: null }, printed_performer: { value: null }, custodian: { masked: true },
    judgment: { question_id: 'q2', status: 'answered', answer: { visible: 'yes', installed: 'cannot_tell', confidence: 0.6, image_id: null, quote: 'pistons on the bench' } } },
], withdrawn: [{ evidence_id: 'e3', receipt_id: 'synthetic-receipt', item_id: 'i3', line_number: 3, status: 'withdrawn', reason: 'line_removed' }] };
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
  requests = []; tied = false; documentDays = 1; contextFails = false;
  fixture.client = createClient('https://timeline-paper.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-paper-${serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ method, url, body });
      const endpoint = url.pathname.replace('/rest/v1/', '');
      const allowedRpc = ['get_vehicle_profile_data', 'get_vehicle_day_depth', 'get_vehicle_contribution_days', 'get_vehicle_day_documents', 'get_vehicle_receipt_work_context'];
      if (url.pathname.startsWith('/storage/v1/object/sign/')) {
        // the private bucket signs for this viewer only; a signed render URL comes back for the page
        return json({ signedURL: `/render/image/sign/${url.pathname.replace('/storage/v1/object/sign/', '')}?token=synthetic` });
      }
      if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && allowedRpc.some(name => endpoint === `rpc/${name}`))) {
        return json({ code: '42501', message: 'Synthetic transport denies every write and function' }, 403);
      }
      if (endpoint === 'rpc/get_vehicle_profile_data') return json({ vehicle: vehicle(), images: [photo()], timeline_events: [{ id: `${vehicleId}-native`, event_date: photoDay, event_type: 'inspection' }], work_sessions: [], stats: { comment_count: 0, observation_count: 0 } });
      if (endpoint === 'rpc/get_vehicle_day_depth') return json([]);
      if (endpoint === 'rpc/get_vehicle_contribution_days') return json([{ day: photoDay, kind: 'photo', n: 1 }, ...(documentDays ? [{ day: paperDay, kind: 'document', n: documentDays }] : [])]);
      if (endpoint === 'rpc/get_vehicle_day_documents') return body?.p_date === paperDay ? json(dayDocuments()) : json({ date: body?.p_date, tied, documents: [] });
      if (endpoint === 'rpc/get_vehicle_receipt_work_context') return contextFails ? json({ message: 'synthetic failure' }, 500) : json(workContext(body?.p_page_date));
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
const contextReads = () => requests.filter(r => r.url.pathname.endsWith('/rpc/get_vehicle_receipt_work_context'));
const contextButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[data-day-drawer] .day-drawer__context > button')];
const drawerText = () => host.querySelector('[data-day-drawer]')?.textContent ?? '';

it('reads the day\'s context once and keeps it behind a tap under each line', async () => {
  const text = await showDay(paperDay);
  expect(contextReads()).toHaveLength(1);
  expect(contextReads()[0].body).toEqual({ p_vehicle_id: vehicleId, p_page_date: paperDay });
  expect(contextButtons()).toHaveLength(2);
  expect(contextButtons()[0].textContent).toBe('CONTEXT ▸ proposed · question open');
  expect(contextButtons()[1].textContent).toBe('CONTEXT ▸ proposed · answered');
  expect(text).not.toContain('PROPOSED ·');
  expect(text).toContain('context withdrawn: the line was removed from the receipt');
});
it('opens a line\'s proposed context with visible frames only, lineage, printed claims and labelled people fields', async () => {
  const opened: any[] = [];
  window.addEventListener('nuke:vehicle-photo-open', (e) => opened.push((e as CustomEvent).detail));
  await showDay(paperDay);
  await act(async () => contextButtons()[0].click());
  const body = host.querySelector('[data-day-drawer] .day-drawer__context-body')?.textContent ?? '';
  expect(body).toContain('PROPOSED · photos exist on the printed work day · 0.61');
  expect(body).toContain('not proof of installation, payment, ownership or who did the work');
  expect(body).toContain('2 frames withheld (private or not yet cleared)');
  expect(body).toContain('source vehicle documents · line 1 · linked by cited document 0.90 · page: line-to-page mapping unresolved');
  expect(body).toContain('printed on the document: date 2024-11-13 · 2.75 h · performer Frank');
  expect(body).toContain('photographer (from the photo record): Synthetic Photographer');
  expect(body).toContain('performer as printed (the document says so): Frank');
  expect(body).toContain('custodian: the account the document is filed under (withheld for this viewer); custody only, not ownership or payment');
  expect(body).toContain('question open, being read · holder: synthetic-worker (a worker, not a person on the document)');
  expect(body).not.toMatch(/installed by|paid by|owned by|owner:/i);
  const frames = host.querySelectorAll<HTMLButtonElement>('[data-day-drawer] .day-drawer__context-frame');
  expect(frames).toHaveLength(1);
  await act(async () => frames[0].click());
  expect(opened.length).toBeGreaterThan(0);
  await act(async () => contextButtons()[1].click());
  expect(drawerText()).toContain("answered (a model's reading, not a sign): visible: yes · installed: cannot tell · confidence 0.60");
  expect(drawerText()).toContain('“pistons on the bench”');
});
it('a failed context read leaves the paper as it was', async () => {
  contextFails = true;
  const text = await showDay(paperDay);
  expect(text).toContain('2024-11-13 · Frank · Bore cylinders .060');
  expect(contextButtons()).toHaveLength(0);
  expect(text).not.toContain('CONTEXT');
  expect(text).not.toContain('Paper unavailable');
});
it('never reads context on a day without paper', async () => {
  await showDay(photoDay);
  expect(contextReads()).toHaveLength(0);
});
