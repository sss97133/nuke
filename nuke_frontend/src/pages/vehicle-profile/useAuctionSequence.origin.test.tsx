// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../hooks/useVehiclePermissions', () => ({ useVehiclePermissions: () => ({ isOwner: false, hasContributorAccess: false, canEdit: false }) }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => ({ isAdmin: false }) }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView() {}, endView() {} }) }));
vi.mock('./hooks/useVehicleIntel', () => ({ useVehicleIntel: () => ({ vehicleIntel: null, vehicleIntelLoading: false }) }));
import { VehicleProfileProvider, useVehicleProfile } from './VehicleProfileContext';
import BarcodeTimeline from './BarcodeTimeline';
import { buildAuctionSequences } from './auctionSequence';

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
let refusedTable: string | null, contextBodies: Map<string, unknown>, parentDenied: boolean, failCommentContinuation: boolean;
let current: ReturnType<typeof useVehicleProfile>, go: ReturnType<typeof useNavigate>;
let holdNativeComments: Promise<Response> | null;
function Probe() { current = useVehicleProfile(); go = useNavigate(); return <BarcodeTimeline />; }
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
  refusedTable = null; contextBodies = new Map(); parentDenied = false; failCommentContinuation = false; holdNativeComments = null;
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
      if (table === 'vehicles') { expect(read.url.searchParams.get('id')).toBe(`eq.${vehicleId}`); return json(parentDenied ? [] : [{ id: vehicleId }]); }
      if (['auction_comments', 'auction_events', 'vehicle_events', 'vehicle_images'].includes(table!)) {
        expect(read.url.searchParams.get('vehicle_id')).toBe(`eq.${vehicleId}`);
        if (table === refusedTable) return json({ message: 'Synthetic private error detail' }, 403);
        if (contextBodies.has(table!)) return json(contextBodies.get(table!));
        if (table === 'auction_comments') {
          expect(read.url.searchParams.get('order')).toBe('id.asc'); expect(read.url.searchParams.get('limit')).toBe('250');
          if (holdNativeComments && !read.url.searchParams.has('id')) return (await holdNativeComments).clone();
          if (failCommentContinuation && read.url.searchParams.has('id')) return json({ message: 'Synthetic private error detail' }, 403);
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
  expect(host.textContent).not.toContain('Synthetic private error detail');
  await act(async () => root.unmount()); queryClient.clear(); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(reads.some(r => r.url.pathname.startsWith('/functions/'))).toBe(false);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function draw(expectTimeline = true) {
  await import('./AuctionSequenceBand'); // Resolve the actual lazy module before the first frame assertion.
  await act(async () => root.render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/vehicle/${vehicleId}`]}><Routes>
    <Route path="/vehicle/:vehicleId" element={<VehicleProfileProvider><Probe /></VehicleProfileProvider>} />
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


// Non-comment failures must retain independently readable native testimony without
// changing the query's error/cache/refetch lifecycle or admitting a partial comment page.
const incomplete = 'Auction activity could not be fully read. Timeline activity counts are unavailable.';
const sequenceKey = () => ['auction-sequence', vehicleId];
const queryState = () => queryClient.getQueryState<any>(sequenceKey())!;
const contextReads = (table: string) => reads.filter(r => r.url.pathname === `/rest/v1/${table}` &&
  r.url.searchParams.get('select') === ({ auction_events: 'id,source,source_url,lot_number,outcome,winning_bid,total_bids,winning_bidder,seller_name,page_views,watchers,comments_count',
    vehicle_events: 'id,source_platform,source_url,started_at,ended_at,sold_at,final_price,event_status', vehicle_images: 'id,taken_at,source,source_url' } as Record<string, string>)[table]);
async function refetchSequence() {
  await act(async () => { await queryClient.refetchQueries({ queryKey: sequenceKey(), exact: true }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}
async function remount() { await act(async () => root.unmount()); root = createRoot(host); await draw(false); }
function assertRetainedBid(amount = '$100') {
  expect(host.querySelector('[aria-label="Vehicle timeline"]')).not.toBeNull();
  expect(host.querySelector('.auction-band')).not.toBeNull(); expect(sourceLinks()).toContain(`${valid}#comment-123`);
  expect(host.querySelector('.auction-band__svg')?.getAttribute('aria-label')).toBe('auction sequence: 1 bids, 0 comments shown');
  expect([...host.querySelectorAll<HTMLAnchorElement>(`.auction-band a[href="${valid}#comment-123"]`)].some(link => link.textContent?.includes(amount))).toBe(true);
}
it.each(['vehicle_images', 'auction_events', 'vehicle_events'])('retains complete native bids and independently readable context when %s refuses', async table => {
  timeline = []; refusedTable = table; await draw(false); assertRetainedBid();
  expect(host.textContent).toContain(incomplete); expect(queryState().status).toBe('error'); expect(queryState().data).toBeUndefined();
  expect(nativeReads()).toHaveLength(2); for (const name of ['vehicle_images', 'auction_events', 'vehicle_events']) expect(contextReads(name)).toHaveLength(1);
  const band = host.querySelector('.auction-band')!;
  if (table !== 'vehicle_events') expect(band.textContent).toContain('auction end recorded by the extractor');
  else expect(band.textContent).toContain('End clock unknown');
  await openReceipt(); expect(host.querySelector('.day-drawer__auction-list a')?.getAttribute('href')).toBe(`${valid}#comment-123`);
  expect(host.querySelector('[data-day-drawer]')?.textContent).toContain('BID $100');
});
it.each(['vehicle_images', 'auction_events', 'vehicle_events'])('does not certify null %s as a successful empty context read', async table => {
  timeline = []; contextBodies.set(table, null); await draw(false); assertRetainedBid();
  expect(host.textContent).toContain(incomplete); expect(queryState().status).toBe('error'); expect(queryState().data).toBeUndefined();
});
it.each(['vehicle_images', 'auction_events', 'vehicle_events'])('refuses malformed %s context shape while preserving the readable native interaction', async table => {
  timeline = []; contextBodies.set(table, { invalid: 'Synthetic shape' }); await draw(false); assertRetainedBid();
  expect(host.textContent).toContain(incomplete); expect(queryState().status).toBe('error');
});
it('keeps complete current native activity and its existing fresh-success cache useful across a real remount', async () => {
  timeline = []; await draw(); assertRetainedBid(); const before = queryState().dataUpdatedAt;
  expect(queryState().status).toBe('success'); expect(host.textContent).not.toContain(incomplete);
  await remount(); assertRetainedBid(); expect(nativeReads()).toHaveLength(2); expect(queryState().dataUpdatedAt).toBe(before);
});
it('preserves initial-error remount refetch behavior rather than caching partial success', async () => {
  timeline = []; refusedTable = 'vehicle_images'; await draw(false); assertRetainedBid();
  expect(queryState().status).toBe('error'); expect(queryState().dataUpdatedAt).toBe(0);
  await remount(); assertRetainedBid(); expect(nativeReads()).toHaveLength(4); expect(queryState().status).toBe('error');
  const query = queryClient.getQueryCache().find({ queryKey: sequenceKey(), exact: true })!;
  expect(query.options.staleTime).toBe(60000); expect(query.options.retry).toBe(false); expect(query.queryKey).toEqual(sequenceKey());
});
it('retains the latest qualified error rows without replacing old successful cache data or its timestamp', async () => {
  timeline = []; await draw(); const cached = queryState().data, updated = queryState().dataUpdatedAt;
  refusedTable = 'vehicle_images'; comments = [{ ...comment(valid), bid_amount: 200 }]; await refetchSequence();
  expect(queryState().status).toBe('error'); expect(queryState().data).toBe(cached); expect(queryState().dataUpdatedAt).toBe(updated);
  expect(queryState().isInvalidated).toBe(true); const before = nativeReads().length;
  await remount(); expect(nativeReads()).toHaveLength(before + 2); assertRetainedBid('$200');
});
it('recovers through the existing explicit refetch without an automatic retry or extra reader', async () => {
  timeline = []; refusedTable = 'vehicle_images'; await draw(false); const first = nativeReads().length;
  expect(queryState().status).toBe('error'); expect(first).toBe(2);
  refusedTable = null; await refetchSequence(); assertRetainedBid();
  expect(queryState().status).toBe('success'); expect(host.textContent).not.toContain(incomplete); expect(nativeReads()).toHaveLength(4);
});
it.each(['success', 'partial'] as const)('denies the parent fail-closed after a cached %s without reviving rows or making child reads', async previous => {
  timeline = []; if (previous === 'partial') refusedTable = 'vehicle_images'; await draw(false);
  const before = nativeReads().length; parentDenied = true; await refetchSequence();
  expect(queryState().status).toBe('error'); expect(host.querySelector('.auction-band')).toBeNull(); expect(sourceLinks()).toEqual([]);
  expect(host.textContent).toContain(incomplete); expect(nativeReads()).toHaveLength(before);
});
it.each(['success', 'partial'] as const)('withholds the entire comment collection after a failed continuation with previous %s', async previous => {
  timeline = []; if (previous === 'partial') refusedTable = 'vehicle_images'; await draw(false);
  const before = nativeReads().length; failCommentContinuation = true; await refetchSequence();
  expect(nativeReads()).toHaveLength(before + 2); expect(queryState().status).toBe('error');
  expect(host.querySelector('.auction-band')).toBeNull(); expect(sourceLinks()).toEqual([]); expect(host.textContent).toContain(incomplete);
});
it('does not turn a fully read empty comment collection plus failed context into a certified complete empty read', async () => {
  timeline = []; comments = []; auctions = []; events = []; refusedTable = 'vehicle_images'; await draw(false);
  expect(nativeReads()).toHaveLength(1); expect(queryState().status).toBe('error'); expect(host.textContent).toContain(incomplete);
  expect(host.querySelector('.auction-band')).toBeNull(); expect(host.querySelector('[aria-label="Vehicle timeline"]')).toBeNull();
});
it('withholds a previous partial payload when the current vehicle no longer has a native lot hint', async () => {
  timeline = []; refusedTable = 'vehicle_images'; await draw(false); const before = nativeReads().length;
  hint = null; await act(async () => { await current.reloadVehicle(); });
  expect(host.querySelector('.auction-band')).toBeNull(); expect(sourceLinks()).toEqual([]); expect(host.textContent).not.toContain(incomplete);
  expect(nativeReads()).toHaveLength(before);
});
it('does not associate a departed vehicle partial payload with the next pending vehicle key', async () => {
  timeline = []; refusedTable = 'vehicle_images'; await draw(false);
  let release!: (response: Response) => void; holdNativeComments = new Promise<Response>(resolve => { release = resolve; });
  vehicleId = `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`; refusedTable = null;
  await act(async () => go(`/vehicle/${vehicleId}`)); await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(current.vehicleId).toBe(vehicleId); expect(host.querySelector('.auction-band')).toBeNull(); expect(sourceLinks()).toEqual([]);
  expect(host.textContent).not.toContain(incomplete); expect(queryState().status).toBe('pending');
  await act(async () => release(json([{ ...comment(valid), bid_amount: 200 }]))); await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Vehicle timeline"]');
  if (button?.getAttribute('aria-expanded') === 'false') await act(async () => button.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(10); }); assertRetainedBid('$200'); expect(queryState().status).toBe('success');
});


it.each([
  { kind: 'recorded instant', start: '2026-09-10T15:00:00Z', interaction: 'bid', role: 'listing_start', grain: 'instant', exact: true, svgLabel: 'OPEN', detailLabel: 'Opened' },
  { kind: 'first observed bid', start: null, interaction: 'bid', role: 'first_activity', grain: 'instant', exact: false, svgLabel: 'FIRST OBSERVED', detailLabel: 'First observed auction activity · opening time unknown' },
  { kind: 'first observed comment', start: null, interaction: 'comment', role: 'first_activity', grain: 'instant', exact: false, svgLabel: 'FIRST OBSERVED', detailLabel: 'First observed auction activity · opening time unknown' },
  { kind: 'recorded listing day', start: '2026-09-10T00:00:00Z', interaction: 'bid', role: 'listing_start', grain: 'day', exact: false, svgLabel: 'LISTING DAY', detailLabel: 'Listing day recorded · time unknown' },
])('qualifies the native band opening label for $kind without changing retained clocks or interactions', async control => {
  timeline = []; comments = [{ ...comment(valid), posted_at: '2026-09-17T18:00:00Z', comment_type: control.interaction,
    bid_amount: control.interaction === 'bid' ? 100 : null }];
  events = [{ ...event(valid), started_at: control.start, ended_at: control.start ? '2026-09-17T20:00:00Z' : null, sold_at: null }];
  await draw();
  const model = buildAuctionSequences({ comments, auctionEvents: auctions, vehicleEvents: events, images: [], timelineEvents: timeline, lotUrlHint: hint }).sequences[0];
  expect(model.open).toMatchObject({ role: control.role, grain: control.grain, exact: control.exact });
  expect(model.open?.at).toBe(control.start ? new Date(control.start).toISOString() : '2026-09-17T18:00:00.000Z');
  expect(model.items).toHaveLength(1); expect(model.items[0]).toMatchObject({ kind: control.interaction, at: '2026-09-17T18:00:00.000Z', url: `${valid}#comment-123` });
  expect(nativeReads()).toHaveLength(2); expect(sourceLinks()).toContain(valid); expect(sourceLinks()).toContain(`${valid}#comment-123`);
  const band = host.querySelector('.auction-band')!;
  expect(band.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 800 96');
  expect(band.querySelectorAll('svg a')).toHaveLength(1);
  const labels = [...band.querySelectorAll('svg text')].map(node => node.textContent);
  const detailLabels = [...band.querySelectorAll('dt')].map(node => node.textContent);
  expect(labels).toContain(control.svgLabel); expect(detailLabels).toContain(control.detailLabel);
  if (!control.exact) expect([...band.querySelectorAll('svg text')].find(node => node.textContent === control.svgLabel)?.getAttribute('aria-label')).toBe(control.detailLabel);
  if (!control.exact) { expect(labels).not.toContain('OPEN'); expect(detailLabels).not.toContain('Opened'); }
  const firstDetail = band.querySelector('dd')!;
  if (control.grain === 'day') { expect(firstDetail.textContent).toContain('Sep 10, 2026'); expect(firstDetail.textContent).not.toMatch(/\d{1,2}:\d{2}|AM|PM/); }
  else expect(firstDetail.textContent).toMatch(/\d{1,2}:\d{2}/);
});
