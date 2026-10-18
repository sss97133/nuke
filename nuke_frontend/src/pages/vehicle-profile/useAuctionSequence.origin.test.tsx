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

const lot = 'synthetic-origin-lot', valid = `https://bringatrailer.com/listing/${lot}/`;
const foreign = [
  `https://notbringatrailer.com/listing/${lot}/`,
  `https://example.invalid/bringatrailer.com/listing/${lot}/`,
  `https://example.invalid/?next=https://bringatrailer.com/listing/${lot}/`,
];
const day = '2025-01-10';
type Read = { url: URL; method: string; body: any };
let root: Root, host: HTMLDivElement, queryClient: QueryClient, serial = 0, vehicleId: string;
let hint: string | null, timeline: any[], comments: any[], auctions: any[], events: any[], reads: Read[];
let refusedTable: string | null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const auction = (sourceUrl: string, price = 100) => ({ id: 'synthetic-auction', source: 'external', source_url: sourceUrl,
  lot_number: '123', outcome: 'sold', winning_bid: price, total_bids: 1, winning_bidder: 'Synthetic buyer', seller_name: null,
  page_views: null, watchers: null, comments_count: 1 });
const event = (sourceUrl: string) => ({ id: 'synthetic-event', source_platform: 'external', source_url: sourceUrl,
  started_at: '2025-01-03T15:00:00Z', ended_at: `${day}T20:00:00Z`, sold_at: `${day}T20:00:00Z`, final_price: 100, event_status: 'sold' });
const comment = (sourceUrl: string | null) => ({ id: '00000000-0000-4000-8000-000000000001', vehicle_id: vehicleId,
  posted_at: `${day}T18:00:00Z`, comment_type: 'bid', bid_amount: 100, author_username: 'Synthetic bidder', is_seller: false,
  comment_text: 'Synthetic source-origin control', bat_comment_id: 123, source_url: sourceUrl, sequence_number: 1, comment_likes: 0 });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (text: string) => ({ width: text.length * 5 }) } as any);
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) });
  vehicleId = `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  hint = valid; timeline = [{ id: 'synthetic-added', event_date: '2025-01-01', event_type: 'vehicle_added' }];
  comments = [comment(valid)]; auctions = [auction(valid)]; events = [event(valid)]; reads = [];
  refusedTable = null;
  fixture.client = createClient('https://auction-origin.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `origin-${serial}` },
    global: { fetch: async (input, init) => {
      const read = { url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
      reads.push(read); const path = read.url.pathname;
      if (read.method === 'POST') {
        if (path === '/rest/v1/rpc/get_vehicle_profile_data') return json({ vehicle: { id: vehicleId, is_public: true, make: 'Ford', model: 'Synthetic origin', listing_url: hint },
          images: [{ id: 'synthetic-image', image_url: 'https://images.test/own.jpg', source: 'owner_upload', is_primary: true }], timeline_events: timeline, work_sessions: [],
          stats: { comment_count: 0, observation_count: 0 } });
        if (['/rest/v1/rpc/get_vehicle_day_depth', '/rest/v1/rpc/get_vehicle_contribution_days'].includes(path)) return json([]);
        throw new Error('Synthetic transport denies writes and other functions');
      }
      if (!['GET', 'HEAD'].includes(read.method) || !path.startsWith('/rest/v1/')) throw new Error('Synthetic transport denies non-read requests');
      const table = path.split('/').pop();
      if (table === 'vehicles') { expect(read.url.searchParams.get('id')).toBe(`eq.${vehicleId}`); return json([{ id: vehicleId }]); }
      if (['auction_comments', 'auction_events', 'vehicle_events', 'vehicle_images'].includes(table!)) {
        expect(read.url.searchParams.get('vehicle_id')).toBe(`eq.${vehicleId}`);
        if (table === refusedTable) return json({ message: 'Synthetic private error detail' }, 403);
        if (table === 'auction_comments') {
          expect(read.url.searchParams.get('order')).toBe('id.asc'); expect(read.url.searchParams.get('limit')).toBe('250');
          return json(read.url.searchParams.has('id') ? [] : comments);
        }
        if (table === 'auction_events') { expect(read.url.searchParams.get('limit')).toBe('5'); return json(auctions); }
        if (table === 'vehicle_events') { expect(read.url.searchParams.get('limit')).toBe('10'); return json(events); }
        return json([]);
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
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function draw(expectTimeline = true) {
  await import('./AuctionSequenceBand'); // Resolve the actual lazy module before the first frame assertion.
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/vehicle/${vehicleId}`]}><Routes>
    <Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><BarcodeTimeline /></VehicleProfileProvider>} />
  </Routes></MemoryRouter></QueryClientProvider>));
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Vehicle timeline"]')!;
  if (!button) { expect(expectTimeline).toBe(false); return; }
  if (button.getAttribute('aria-expanded') === 'false') await act(async () => button.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}
it('shows readable native auction activity when the primary raw event feed is empty', async () => {
  timeline = [];
  await draw();
  expect(sourceLinks()).toContain(valid);
  expect(host.querySelector('.auction-band')).not.toBeNull();
  await openReceipt();
  expect(host.querySelector('[data-day-drawer]')?.textContent).toContain('BID $100');
  expect(host.querySelector('.day-drawer__auction-list a')?.getAttribute('href')).toBe(`${valid}#comment-123`);
});
it('keeps a recorded auction window useful without comments or raw timeline rows', async () => {
  timeline = []; comments = [];
  await draw();
  expect(sourceLinks()).toContain(valid);
  expect(host.textContent).toContain('No timed interactions in this read.');
});
it('keeps a listing hint with no qualified retained auction or raw events hidden', async () => {
  timeline = []; comments = []; auctions = []; events = [];
  await draw(false);
  expect(host.querySelector('[aria-label="Vehicle timeline"]')).toBeNull();
  expect(host.querySelector('.auction-band')).toBeNull();
});
it.each([true, false])('preserves the unreadable-auction status with an empty raw feed: %s', async emptyRaw => {
  if (emptyRaw) timeline = [];
  refusedTable = 'auction_comments';
  await draw(!emptyRaw);
  const message = 'Auction activity could not be fully read. Timeline activity counts are unavailable.';
  expect([...host.querySelectorAll('[role="status"]')].filter(node => node.textContent === message)).toHaveLength(1);
  expect(sourceLinks()).toEqual([]);
  expect(host.textContent).not.toContain('Synthetic private error detail');
});
it.each([true, false])('preserves untimed retained-activity status with an empty raw feed: %s', async emptyRaw => {
  if (emptyRaw) timeline = [];
  comments = [{ ...comment(valid), posted_at: null }]; auctions = []; events = [];
  await draw(!emptyRaw);
  const message = 'Some retained auction interactions lack usable posting times and cannot be placed on this timeline.';
  expect([...host.querySelectorAll('[role="status"]')].filter(node => node.textContent === message)).toHaveLength(1);
  expect(host.querySelector('.auction-band')).toBeNull();
  expect(host.querySelector('[data-day-drawer]')).toBeNull();
  expect(nativeReads()).toHaveLength(2);
});
const sourceLinks = () => [...host.querySelectorAll<HTMLAnchorElement>('.auction-band a')].map(link => link.getAttribute('href'));
const nativeReads = () => reads.filter(r => r.url.pathname === '/rest/v1/auction_comments'
  && r.url.searchParams.get('limit') === '250' && r.url.searchParams.get('order') === 'id.asc');
async function openReceipt(selectedDay = day) {
  await import('./VehicleDayDrawer'); // Wait for the actual lazy child before asserting its DOM.
  await act(async () => host.querySelector<HTMLElement>(`.hm-c[data-date="${selectedDay}"]`)!.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}

it.each([
  { date: '2025-01-03', label: 'Auction Opened', basis: 'listing start recorded by the extractor' },
  { date: day, label: 'Auction Closed', basis: 'auction end recorded by the extractor' },
])('keeps a retained native moment visible in its otherwise empty day drawer: $label', async ({ date, label, basis }) => {
  timeline = []; comments = [];
  await draw(); await openReceipt(date);
  const drawer = host.querySelector<HTMLElement>('[data-day-drawer]')!;
  const moments = drawer.querySelectorAll('.day-drawer__auction-moment');
  expect(moments).toHaveLength(1);
  expect(moments[0].textContent).toContain(label); expect(moments[0].textContent).toContain(basis);
  expect(moments[0].querySelector('a')?.getAttribute('href')).toBe(valid);
  expect(drawer.textContent).not.toContain('NO ACTIVITY'); expect(drawer.textContent).not.toContain('$');
  expect(reads.filter(r => r.url.pathname === '/rest/v1/vehicle_images' && r.url.searchParams.get('select') === 'id,image_url,taken_at,source,source_url')).toHaveLength(1);
});
it('keeps a date-only native end on its recorded day without inventing a closing time', async () => {
  timeline = []; comments = []; events = [{ ...event(valid), started_at: null, ended_at: `${day}T00:00:00Z`, sold_at: null }];
  await draw(); await openReceipt();
  const moment = host.querySelector('.day-drawer__auction-moment')!;
  expect(moment?.textContent).toContain('Auction end day recorded · time unknown');
  expect(moment?.textContent).toContain('auction end day; time not recorded');
  expect(moment?.textContent).toContain('Jan 10, 2025'); expect(moment?.textContent).not.toMatch(/\d{1,2}:\d{2}|AM|PM/);
  expect(host.querySelector('[data-day-drawer]')?.textContent).not.toContain('NO ACTIVITY');
});
it('keeps a retained sale moment distinct from a recorded auction close', async () => {
  timeline = []; comments = []; events = [{ ...event(valid), ended_at: null }];
  await draw(); await openReceipt();
  const moment = host.querySelector('.day-drawer__auction-moment')!;
  expect(moment?.textContent).toContain('Sale recorded · auction end unknown');
  expect(moment?.textContent).toContain('sale recorded by the extractor; auction end unknown');
  expect(moment?.textContent).not.toContain('Auction Closed'); expect(moment?.querySelector('a')?.getAttribute('href')).toBe(valid);
});
it('keeps a first-activity record distinct from a known opening time while retaining its source interaction', async () => {
  timeline = []; events = [{ ...event(valid), started_at: null }];
  await draw(); await openReceipt();
  const drawer = host.querySelector('[data-day-drawer]')!;
  const moment = [...drawer.querySelectorAll('.day-drawer__auction-moment')].find(node => node.textContent?.includes('First observed'));
  expect(moment?.textContent).toContain('First observed auction activity · opening time unknown');
  expect(moment?.textContent).toContain('first activity — first bid; opening time not recorded');
  expect(moment?.textContent).not.toContain('Auction Opened');
  expect(drawer.querySelector('.day-drawer__auction-list a')?.getAttribute('href')).toBe(`${valid}#comment-123`);
});

it.each([valid, 'http://www.bringatrailer.com/listing/SYNTHETIC-ORIGIN-LOT?x=1#comment-1',
  `bringatrailer.com/listing/${lot}/`, `//bringatrailer.com/listing/${lot}/`, `https://auctions.bringatrailer.com/listing/${lot}/`,
])('keeps supported BaT source %s clickable with its result', async url => {
  hint = url; comments = [comment(url)]; auctions = [auction(url)]; events = [event(url)];
  await draw(); expect(sourceLinks()).toContain(valid); expect(host.textContent).toContain('SOLD $100');
  expect(nativeReads()).toHaveLength(2); expect(host.querySelector(`.hm-c[data-date="${day}"]`)?.getAttribute('title')).toContain('1 bid');
  await openReceipt();
  expect(host.querySelector('.day-drawer__auction-list a')?.getAttribute('href')).toBe(`${valid}#comment-123`);
});
it.each(foreign)('does not enable BaT readers or mint a clickable result from foreign hint %s', async url => {
  hint = url; comments = [comment(url)]; auctions = [auction(url)]; events = [event(url)];
  await draw(); if (host.querySelector(`.hm-c[data-date="${day}"]`)) await openReceipt();
  expect({ nativeReads: nativeReads().length, links: sourceLinks(), dayLinks: [...host.querySelectorAll<HTMLAnchorElement>('.day-drawer__auction-list a')].map(a => a.getAttribute('href')), text: host.textContent }).toMatchObject({
    nativeReads: 0, links: [], dayLinks: [], text: expect.not.stringContaining('SOLD $100'),
  });
});
it.each(foreign)('does not turn foreign event source %s into a second BaT episode under a valid hint', async url => {
  comments = []; auctions = [auction(url)]; events = [event(url)];
  hint = 'https://bringatrailer.com/listing/synthetic-real-other-lot/';
  await draw(); expect(sourceLinks()).not.toContain(valid); expect(host.textContent).not.toContain('SOLD $100');
});
it('preserves the existing native BaT timeline trigger with source-addressed retained rows', async () => {
  hint = null; timeline.push({ id: 'native-bat', event_type: 'auction_listed', event_date: '2025-01-03', source: 'bat' });
  await draw(); expect(nativeReads()).toHaveLength(2); expect(sourceLinks()).toContain(valid); expect(host.textContent).toContain('SOLD $100');
});
it('does not mint a BaT result from foreign rows when a native timeline signal legitimately enables reads', async () => {
  hint = null; timeline.push({ id: 'native-bat', event_type: 'auction_listed', event_date: '2025-01-03', source: 'bat' });
  comments = [comment(foreign[0])]; auctions = [auction(foreign[0])]; events = [event(foreign[0])];
  await draw(); expect(nativeReads()).toHaveLength(2); expect(sourceLinks()).not.toContain(valid); expect(host.textContent).not.toContain('SOLD $100');
});
it('preserves current known-empty cache without repeated native demand', async () => {
  comments = []; auctions = []; events = [];
  await draw(); expect(sourceLinks()).toEqual([]); expect(nativeReads()).toHaveLength(1);
  await draw(); expect(nativeReads()).toHaveLength(1); expect(host.textContent).not.toContain('SOLD');
});
it.each([null, 'https://example.invalid/car', 'conceptcarz://synthetic-car'])('keeps unknown/non-BaT hint %s from starting native reads', async url => {
  hint = url; await draw(); expect(nativeReads()).toHaveLength(0); expect(sourceLinks()).toEqual([]);
});
it('preserves useful native cached results with one complete comment read', async () => {
  await draw(); const before = sourceLinks(); expect(before).toContain(valid); expect(nativeReads()).toHaveLength(2);
  await draw(); expect(sourceLinks()).toEqual(before); expect(nativeReads()).toHaveLength(2);
});
it.each(['https://example.invalid/auctions/other-lot', 'not a listing URL'])('does not attribute explicitly unsupported comment URL %s to the current legitimate lot', async url => {
  comments = [comment(url)];
  await draw(); await openReceipt(); expect(sourceLinks()).toContain(valid); expect(sourceLinks()).not.toContain(`${valid}#comment-123`);
  expect(host.querySelector('.day-drawer__auction-list a')).toBeNull();
});
it.each([null, '', '   '])('keeps the existing missing/blank comment URL %s fallback to the known native listing', async url => {
  comments = [comment(url)];
  await draw(); expect(sourceLinks()).toContain(`${valid}#comment-123`);
  await openReceipt();
  expect(host.querySelector('.day-drawer__auction-list a')?.textContent).toBe('Synthetic bidder');
});
