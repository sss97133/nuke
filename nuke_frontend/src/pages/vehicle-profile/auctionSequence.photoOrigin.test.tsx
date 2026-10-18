// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../hooks/useVehiclePermissions', () => ({ useVehiclePermissions: () => ({ isOwner: false, hasContributorAccess: false, canEdit: false }) }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => ({ isAdmin: false }) }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView() {}, endView() {} }) }));
vi.mock('./hooks/useVehicleIntel', () => ({ useVehicleIntel: () => ({ vehicleIntel: null, vehicleIntelLoading: false }) }));
import { VehicleProfileProvider } from './VehicleProfileContext';
import BarcodeTimeline from './BarcodeTimeline';

const olderDay = '2026-09-03', newerDay = '2026-12-03', captureDay = '2026-10-17';
const olderUrl = 'https://bringatrailer.com/listing/synthetic-independent-september/';
const newerUrl = 'https://bringatrailer.com/listing/synthetic-independent-december/';
const nativePhoto = 'https://bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg';
const foreignPhotos = [
  'https://notbringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg',
  'https://example.invalid/bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg',
  'https://example.invalid/?next=https://bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg',
];
type Read = { url: URL; method: string; body: any };
let root: Root, host: HTMLDivElement, queryClient: QueryClient, serial = 0, vehicleId: string;
let timeline: any[], photos: any[], reads: Read[], listingHint: string, auctionRows: any[], eventRows: any[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const photo = (sourceUrl: string | null, source = 'external_import', takenAt: string | null = `${captureDay}T12:00:00Z`) => ({
  id: 'synthetic-photo', image_url: 'https://images.test/synthetic-source-photo.jpg', source, source_url: sourceUrl, taken_at: takenAt, is_duplicate: false,
});
const auction = (url: string, number: string, price: number) => ({ id: `auction-${number}`, source: 'bat', source_url: url, lot_number: number,
  outcome: 'sold', winning_bid: price, total_bids: 0, winning_bidder: null, seller_name: null, page_views: null, watchers: null, comments_count: 0 });
const event = (url: string, day: string) => ({ id: `event-${day}`, source_platform: 'bat', source_url: url,
  started_at: `${day}T12:00:00Z`, ended_at: `${day}T20:00:00Z`, sold_at: `${day}T20:00:00Z`, final_price: null, event_status: 'sold' });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (text: string) => ({ width: text.length * 5 }) } as any);
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) });
  vehicleId = `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  timeline = [{ id: 'synthetic-added', event_date: '2026-01-01', event_type: 'vehicle_added' }];
  photos = [photo(nativePhoto)]; reads = []; listingHint = newerUrl; auctionRows = [auction(olderUrl, 'OLD', 100), auction(newerUrl, 'NEW', 200)]; eventRows = [event(olderUrl, olderDay), event(newerUrl, newerDay)];
  fixture.client = createClient('https://auction-origin.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `origin-${serial}` },
    global: { fetch: async (input, init) => {
      const read = { url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
      reads.push(read); const path = read.url.pathname;
      if (read.method === 'POST') {
        if (path === '/rest/v1/rpc/get_vehicle_profile_data') return json({ vehicle: { id: vehicleId, is_public: true, make: 'Ford', model: 'Synthetic photo origin', listing_url: listingHint },
          images: [{ id: 'synthetic-image', image_url: 'https://images.test/own.jpg', source: 'owner_upload', is_primary: true }], timeline_events: timeline,
          stats: { comment_count: 0, observation_count: 0 } });
        if (path === '/rest/v1/rpc/get_vehicle_contribution_days') return json([{ day: captureDay, kind: 'photo', n: 1 }]);
        if (path === '/rest/v1/rpc/get_vehicle_day_depth') return json([]);
        throw new Error('Synthetic transport denies writes and other functions');
      }
      if (!['GET', 'HEAD'].includes(read.method) || !path.startsWith('/rest/v1/')) throw new Error('Synthetic transport denies non-read requests');
      const table = path.split('/').pop();
      if (table === 'vehicles') { expect(read.url.searchParams.get('id')).toBe(`eq.${vehicleId}`); return json([{ id: vehicleId }]); }
      if (['auction_comments', 'auction_events', 'vehicle_events', 'vehicle_images'].includes(table!)) {
        expect(read.url.searchParams.get('vehicle_id')).toBe(`eq.${vehicleId}`);
        if (table === 'auction_comments') {
          expect(read.url.searchParams.get('order')).toBe('id.asc'); expect(read.url.searchParams.get('limit')).toBe('250');
          return json([]);
        }
        if (table === 'auction_events') { expect(read.url.searchParams.get('limit')).toBe('5'); return json(auctionRows); }
        if (table === 'vehicle_events') { expect(read.url.searchParams.get('limit')).toBe('10'); return json(eventRows); }
        const fields = read.url.searchParams.get('select')!.split(',').map(v => v.trim());
        if (!read.url.searchParams.has('is_duplicate')) return json([]); // Separate Provider count/coverage reader.
        let selected = photos.filter(p => !p.is_duplicate);
        if (read.url.searchParams.has('or')) {
          expect(read.url.searchParams.get('or')).toBe('(source.ilike.%bat%,source_url.ilike.%bringatrailer.com%,taken_at.is.null)');
          expect(read.url.searchParams.get('limit')).toBe('600');
          selected = selected.filter(p => /bat/i.test(p.source ?? '') || /bringatrailer.com/i.test(p.source_url ?? '') || p.taken_at == null);
        } else if (read.url.searchParams.has('taken_at')) {
          expect(read.url.searchParams.get('limit')).toBe('120'); expect(read.url.searchParams.get('order')).toBe('taken_at.asc');
          const bounds = read.url.searchParams.getAll('taken_at');
          selected = selected.filter(p => p.taken_at && bounds.every(bound => bound.startsWith('gte.') ? Date.parse(p.taken_at) >= Date.parse(bound.slice(4)) : Date.parse(p.taken_at) < Date.parse(bound.slice(3))));
        } else expect(read.url.searchParams.get('limit')).toBe('2000');
        return json(selected.map(p => Object.fromEntries(fields.map(field => [field, p[field]]))));
      }
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
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(reads.some(r => r.url.pathname.startsWith('/functions/'))).toBe(false);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
async function draw() {
  await Promise.all([import('./AuctionSequenceBand'), import('./VehicleDayDrawer')]); // Resolve the actual lazy module before the first frame assertion.
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/vehicle/${vehicleId}`]}><Routes>
    <Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><BarcodeTimeline /></VehicleProfileProvider>} />
  </Routes></MemoryRouter></QueryClientProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Vehicle timeline"]')!;
  if (button.getAttribute('aria-expanded') === 'false') await act(async () => button.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}
const cellTitle = (day: string) => host.querySelector<HTMLElement>(`.hm-c[data-date="${day}"]`)?.title ?? null;
const displayedPhotos = () => [...host.querySelectorAll<HTMLImageElement>('img')].map(p => ({ src: p.getAttribute('src'), title: p.closest('button')?.title }));
async function openDay(day: string) {
  await act(async () => host.querySelector<HTMLElement>(`.hm-c[data-date="${day}"]`)!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  return displayedPhotos();
}
async function chooseLot(key: string) {
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Timeline auction episode"]')!;
  await act(async () => { select.value = key; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}
const listingPhoto = { src: 'https://images.test/synthetic-source-photo.jpg', title: 'listing association inferred; capture and publication times unknown' };

it.each(foreignPhotos)('keeps actual external capture %s on its capture day instead of publishing it with a BaT lot', async url => {
  photos = [photo(url)]; await draw();
  const captureTitle = cellTitle(captureDay), olderTitle = cellTitle(olderDay);
  const olderPhotos = await openDay(olderDay);
  const capturedPhotos = host.querySelector(`.hm-c[data-date="${captureDay}"]`) ? await openDay(captureDay) : null;
  expect({ captureTitle, olderTitle, olderPhotos, capturedPhotos }).toEqual({ captureTitle: expect.stringContaining('1 photos'),
    olderTitle: expect.not.stringContaining('images grouped with listing'), olderPhotos: [], capturedPhotos: [{ src: listingPhoto.src, title: expect.not.stringContaining('listing association inferred') }] });
});
it.each([
  ...foreignPhotos.map(url => ({ url, source: 'bat_import' })),
  { url: 'https://bringatrailer.com/mirror/bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg', source: 'external_import' },
  { url: 'https://bringatrailer.com/images/synthetic.jpg?next=https://bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg', source: 'external_import' },
])('keeps hosted $source with untrusted month $url useful on the newest listing', async ({ url, source }) => {
  photos = [photo(url, source, null)]; await draw(); const newerCaption = host.querySelector('.auction-band')!.textContent;
  await chooseLot('synthetic-independent-september'); const olderCaption = host.querySelector('.auction-band')!.textContent;
  const olderPhotos = await openDay(olderDay); await chooseLot('synthetic-independent-december'); const newerPhotos = await openDay(newerDay);
  expect({ newerCaption, olderCaption, olderPhotos, newerPhotos }).toEqual({ newerCaption: expect.stringContaining('listing attribution incomplete'),
    olderCaption: expect.not.stringContaining('Grouped image records:'), olderPhotos: [], newerPhotos: [listingPhoto] });
});
it.each([nativePhoto, 'http://www.bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg?x=1#image',
  'bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg', '//bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg',
  'https://photos.bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg',
])('keeps native photo URL %s with its trusted month and hides its import stamp', async url => {
  photos = [photo(url)]; await draw(); expect(cellTitle(captureDay) ?? '').not.toContain('1 photos');
  await chooseLot('synthetic-independent-september'); expect(host.querySelector('.auction-band')!.textContent).toContain('Grouped image records: 1 · listing association inferred · capture and publication times unknown');
  expect(host.querySelector('.auction-band')!.textContent).not.toContain('listing attribution incomplete');
  expect(await openDay(olderDay)).toEqual([listingPhoto]);
});
it.each([null, 'https://images.test/photo.jpg'])('keeps known bat_import with missing/unattributed URL %s on the newest listing', async url => {
  photos = [photo(url, 'bat_import', null)]; await draw(); expect(host.querySelector('.auction-band')!.textContent).toContain('listing attribution incomplete');
  expect(await openDay(newerDay)).toEqual([listingPhoto]);
});
it('keeps native known-source handling when its recorded stamp is an import time', async () => {
  photos = [photo(null, 'bat_import')]; await draw(); expect(cellTitle(captureDay) ?? '').not.toContain('1 photos');
  expect(await openDay(newerDay)).toEqual([listingPhoto]);
});
it('retains an ordinary non-native captured photo and its useful cache', async () => {
  photos = [photo('https://images.test/owner-photo.jpg')]; await draw(); expect(cellTitle(captureDay)).toContain('1 photos');
  const first = await openDay(captureDay); expect(first).toHaveLength(1); expect(first[0].title).not.toContain('listing association inferred');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close day"]')!.click());
  expect(await openDay(captureDay)).toEqual(first);
  expect(reads.filter(r => r.url.pathname.endsWith('/vehicle_images') && r.url.searchParams.has('taken_at'))).toHaveLength(1);
});


it.each([
  { name: 'recorded day UTC', tz: 'UTC', start: '2026-09-10', day: '2026-09-10', mode: 'listing', count: 1 },
  { name: 'recorded day Pacific', tz: 'America/Los_Angeles', start: '2026-09-10', day: '2026-09-10', mode: 'listing', count: 1 },
  { name: 'previous day Pacific', tz: 'America/Los_Angeles', start: '2026-09-10', day: '2026-09-09', mode: 'capture', count: 0 },
  { name: 'instant local day Pacific', tz: 'America/Los_Angeles', start: '2026-09-10T01:00:00Z', day: '2026-09-09', mode: 'listing', count: 1 },
  { name: 'instant day UTC', tz: 'UTC', start: '2026-09-10T01:00:00Z', day: '2026-09-10', mode: 'listing', count: 1 },
])('keeps the native inferred-photo group on its $name through actual calendar click', async control => {
  vi.stubEnv('TZ', control.tz); expect(new Date('2026-09-10T00:00:00Z').getDate()).toBe(control.tz === 'UTC' ? 10 : 9);
  listingHint = olderUrl; auctionRows = [auction(olderUrl, 'OLD', 100)];
  eventRows = [{ ...event(olderUrl, '2026-09-10'), started_at: control.start, ended_at: '2026-09-17T20:00:00Z', sold_at: null }];
  timeline = [{ id: 'synthetic-prior-inspection', event_date: '2026-09-09', event_type: 'inspection', title: 'Synthetic calendar navigation control' }];
  photos = [photo(nativePhoto, 'bat_import', null)]; await draw();
  const title = cellTitle(control.day);
  if (control.mode === 'capture' || (control.tz === 'America/Los_Angeles' && control.start.length > 10)) expect(title).toContain('Inspection');
  else expect(title).toContain(control.start.length === 10 ? 'Listing day recorded' : 'Auction Opened');
  const displayed = await openDay(control.day); expect(displayed).toHaveLength(control.count);
  if (control.count) { expect(displayed).toEqual([listingPhoto]); expect(host.querySelector('[data-day-drawer]')?.textContent).toContain('LISTING ASSOCIATION INFERRED'); }
  const queries = reads.filter(r => r.url.pathname === '/rest/v1/vehicle_images' && r.url.searchParams.get('select') === 'id,image_url,taken_at,source,source_url');
  expect(queries).toHaveLength(1); const params = queries[0].url.searchParams;
  expect(params.get('vehicle_id')).toBe(`eq.${vehicleId}`); expect(params.get('is_duplicate')).toBe('not.is.true');
  expect(params.has('or')).toBe(control.mode === 'listing');
  if (control.mode === 'listing') { expect(params.get('or')).toBe('(source.ilike.%bat%,source_url.ilike.%bringatrailer.com%,taken_at.is.null)'); expect(params.get('limit')).toBe('600'); expect(params.has('taken_at')).toBe(false); }
  else { expect(params.getAll('taken_at')).toEqual(['gte.2026-09-09T00:00:00Z', 'lt.2026-09-10T00:00:00.000Z']); expect(params.get('limit')).toBe('120'); expect(params.get('order')).toBe('taken_at.asc'); }
});


it.each([
  { kind: 'native importer stamp', imported: true, camera: false, listing: false, takenAt: '2026-09-02T12:10:00Z', source: 'bat_import', sourceUrl: null },
  { kind: 'native host stamp', imported: true, camera: false, listing: false, takenAt: '2026-09-02T12:10:00Z', source: 'external_import', sourceUrl: nativePhoto },
  { kind: 'mixed import and camera clocks', imported: true, camera: true, listing: false, takenAt: '2026-09-02T12:10:00Z', source: 'bat_import', sourceUrl: null },
  { kind: 'ordinary camera', imported: false, camera: true, listing: false, takenAt: null, source: 'owner_upload', sourceUrl: null },
  { kind: 'foreign camera', imported: false, camera: false, listing: false, takenAt: '2026-09-02T12:10:00Z', source: 'owner_upload', sourceUrl: foreignPhotos[0] },
  { kind: 'native listing unknown capture', imported: true, camera: false, listing: true, takenAt: null, source: 'bat_import', sourceUrl: nativePhoto },
  { kind: 'native listing import stamp', imported: true, camera: false, listing: true, takenAt: '2026-09-03T12:10:00Z', source: 'bat_import', sourceUrl: nativePhoto },
])('carries $kind clock authority through the actual Provider/Barcode/Drawer without changing rows', async control => {
  vi.stubEnv('TZ', 'UTC'); expect(new Date('2026-09-02T00:00:00Z').getHours()).toBe(0);
  listingHint = olderUrl; auctionRows = [auction(olderUrl, 'CLOCK', 100)]; eventRows = [event(olderUrl, olderDay)];
  timeline.push({ id: 'synthetic-clock-navigation', event_date: '2026-09-02', event_type: 'inspection', title: 'Synthetic clock navigation' });
  photos = [];
  if (control.kind !== 'ordinary camera') photos.push({ ...photo(control.sourceUrl, control.source, control.takenAt), id: 'synthetic-clock-row' });
  if (control.camera) photos.push({ ...photo(null, 'owner_upload', '2026-09-02T12:40:00Z'), id: 'synthetic-camera-row', image_url: 'https://images.test/clock-camera.jpg' });
  const before = structuredClone(photos), selectedDay = control.listing ? olderDay : '2026-09-02';
  await draw();
  if (control.imported && !control.listing) expect(cellTitle('2026-09-02') ?? '').not.toContain('1 photos');
  const result = await openDay(selectedDay);
  const expected = photos.map(p => ({ src: p.image_url, title: control.listing ? listingPhoto.title : p.source === 'owner_upload' ? (p.id === 'synthetic-camera-row' ? '12:40 PM' : '12:10 PM') : 'import clock 12:10 PM; capture time unknown' }));
  // URL-qualified native rows use the same existing owner authority as source-qualified rows.
  if (control.kind === 'native host stamp') expected[0].title = 'import clock 12:10 PM; capture time unknown';
  expect(result).toEqual(expected); expect(photos).toEqual(before);
  const drawer = host.querySelector('[data-day-drawer]')!, header = drawer.firstElementChild!.textContent;
  expect(drawer.textContent).toContain(`PHOTOS ${photos.length}`);
  if (control.imported && !control.listing) {
    expect(header).toContain('IMPORTED PHOTO CAPTURE TIMES UNKNOWN'); expect(header).not.toMatch(/12:10|12:40|SPAN/);
  } else if (!control.listing) {
    expect(header).toContain(control.camera ? '12:40 PM–12:40 PM' : '12:10 PM–12:10 PM');
    expect(header).not.toContain('IMPORTED PHOTO CAPTURE TIMES UNKNOWN');
  } else {
    expect(drawer.textContent).toContain('LISTING ASSOCIATION INFERRED'); expect(header).not.toMatch(/12:10|SPAN|IMPORTED PHOTO/);
  }
  const drawerReads = () => reads.filter(r => r.url.pathname.endsWith('/vehicle_images') && r.url.searchParams.get('select') === 'id,image_url,taken_at,source,source_url');
  expect(drawerReads()).toHaveLength(1); const query = drawerReads()[0].url.searchParams;
  expect(query.get('vehicle_id')).toBe(`eq.${vehicleId}`); expect(query.get('is_duplicate')).toBe('not.is.true');
  expect(query.get('limit')).toBe(control.listing ? '600' : '120');
  expect(query.getAll('taken_at')).toEqual(control.listing ? [] : ['gte.2026-09-02T00:00:00Z', 'lt.2026-09-03T00:00:00.000Z']);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close day"]')!.click());
  expect(await openDay(selectedDay)).toEqual(expected); expect(drawerReads()).toHaveLength(1);
});
