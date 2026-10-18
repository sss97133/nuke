// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuctionSequence } from './auctionSequence';

const fixture = vi.hoisted(() => ({ client: null as any, vehicleId: '', timeline: [] as any[], auctions: [] as any[] }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicleId: fixture.vehicleId, vehicle: { id: fixture.vehicleId },
  timelineEvents: fixture.timeline, setGalleryFilter: () => {} }) }));
vi.mock('./useAuctionSequence', () => ({ useAuctionSequence: () => ({ auctions: fixture.auctions, importStampedDays: [],
  activityUnavailable: false, hasUnpositionedActivity: false }) }));
vi.mock('./AuctionSequenceBand', () => ({ default: () => null }));
vi.mock('./VehicleDayDrawer', async original => {
  const real = await original<typeof import('./VehicleDayDrawer')>();
  return { ...real, default: (props: React.ComponentProps<typeof real.default>) => {
    React.useLayoutEffect(() => { photoFrames.push({ date: props.date, photos: visible() }); });
    return <real.default {...props} />;
  } };
});
import VehicleDayDrawer from './VehicleDayDrawer';
import BarcodeTimeline from './BarcodeTimeline';
import { listingForPhoto } from './auctionSequence';

const day = '2026-09-02', nextDay = '2026-09-03';
const image = (id: string, extra: Record<string, unknown> = {}) => ({ id, image_url: `https://photos.test/${id}.jpg`,
  taken_at: null, source: 'bat_import', source_url: null, is_duplicate: false, ...extra });
const captured = image('captured', { source: 'owner_upload', taken_at: `${day}T12:30:00Z` });
const addressed = image('addressed', { source_url: 'https://bringatrailer.com/wp-content/uploads/2026/09/synthetic.jpg' });
const unaddressed = image('unaddressed');
function listing(key: string, at: string, ordinal = 1, listingCount = 1): AuctionSequence {
  return { key, lotUrl: `https://bringatrailer.com/listing/${key}/`, lotNumber: key.toUpperCase(), ordinal, listingCount,
    open: { at, basis: 'synthetic recorded opening', exact: true, role: 'listing_start', grain: 'instant' }, close: null,
    lastObservedBid: null, outcome: 'unknown', outcomeConflict: false, price: null, buyer: null, seller: null,
    bidCount: null, commentCount: null, watchers: null, views: null, items: [], days: [], activityExtracted: false,
    photos: { publishedWithListing: 2, attributionUncertain: false } };
}
const onlyA = () => [listing('episode-a', `${day}T12:00:00Z`)];
const withNewer = () => [listing('episode-b', '2026-12-02T12:00:00Z', 2, 2), listing('episode-a', `${day}T12:00:00Z`, 1, 2)];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let root: Root, host: HTMLDivElement, serial = 0, rows: any[], requests: URL[];
let photoFrames: { date: string; photos: ReturnType<typeof visible> }[];
let reply: ((url: URL) => Response | Promise<Response> | undefined) | null;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.vehicleId = `00000000-0000-0000-0000-${String(++serial).padStart(12, '0')}`;
  rows = [captured, addressed, unaddressed]; requests = []; reply = null; photoFrames = []; fixture.timeline = []; fixture.auctions = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://day-photos.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-photos-${serial}` },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if ((init?.method ?? 'GET') === 'POST' && ['/rest/v1/rpc/get_vehicle_day_depth', '/rest/v1/rpc/get_vehicle_contribution_days'].includes(url.pathname)) return json([]);
      if ((init?.method ?? 'GET') !== 'GET' || url.pathname !== '/rest/v1/vehicle_images') throw new Error('Only local photo read allowed');
      requests.push(url);
      const special = reply?.(url); if (special) return (await special).clone();
      expect(url.searchParams.get('vehicle_id')).toBe(`eq.${fixture.vehicleId}`);
      expect(url.searchParams.get('is_duplicate')).toBe('not.is.true');
      let selected = rows.filter(row => !row.is_duplicate);
      if (url.searchParams.has('or')) {
        expect(url.searchParams.get('or')).toBe('(source.ilike.%bat%,source_url.ilike.%bringatrailer.com%,taken_at.is.null)');
        expect(url.searchParams.get('limit')).toBe('600');
        selected = selected.filter(row => /bat/i.test(row.source ?? '') || /bringatrailer.com/i.test(row.source_url ?? '') || row.taken_at == null);
      } else {
        const requestedDay = url.searchParams.getAll('taken_at')[0].slice(4, 14);
        expect([day, nextDay]).toContain(requestedDay);
        expect(url.searchParams.getAll('taken_at')).toEqual([`gte.${requestedDay}T00:00:00Z`, `lt.${requestedDay}T23:59:59.999Z`]);
        expect(url.searchParams.get('order')).toBe('taken_at.asc'); expect(url.searchParams.get('limit')).toBe('120');
        selected = selected.filter(row => row.taken_at && row.taken_at >= `${requestedDay}T00:00:00Z` && row.taken_at < `${requestedDay}T23:59:59.999Z`);
      }
      const fields = url.searchParams.get('select')!.split(',');
      return json(selected.map(row => Object.fromEntries(fields.map(field => [field, row[field]]))));
    } },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
async function draw(auctions: AuctionSequence[] = [], date = day) {
  await act(async () => root.render(<MemoryRouter><VehicleDayDrawer date={date} auctions={auctions} onClose={() => {}} /></MemoryRouter>));
}
async function close() { await act(async () => root.render(null)); }
const visible = () => [...host.querySelectorAll('img')].map(img => ({ src: img.getAttribute('src'), title: img.closest('button')?.title }));
const listingPhoto = (id: string) => ({ src: `https://photos.test/${id}.jpg`, title: 'published with the listing — no capture time' });
function deferred() { let resolve!: (response: Response) => void; return { promise: new Promise<Response>(done => { resolve = done; }), resolve }; }

it('preserves a valid same-input capture cache and its recorded-time title', async () => {
  await draw(); const first = visible(); expect(first).toHaveLength(1); expect(first[0].src).toBe(captured.image_url);
  expect(first[0].title).not.toBe('published with the listing — no capture time');
  await close(); await draw(); expect(visible()).toEqual(first); expect(requests).toHaveLength(1);
});
it('preserves a successful known-empty cache without repeated reads', async () => {
  rows = []; await draw(); expect(host.textContent).toContain('NO ACTIVITY');
  await close(); await draw(); expect(host.textContent).toContain('NO ACTIVITY'); expect(requests).toHaveLength(1);
});
it('does not let a failed photo read permanently hide useful photos on reopen', async () => {
  reply = () => json({ code: '57014', message: 'Synthetic failed read' }, 500);
  await draw(); await close(); reply = null; await draw();
  expect({ photos: visible().map(p => p.src), reads: requests.length }).toEqual({ photos: [captured.image_url], reads: 2 });
});
it('does not relabel a captured-photo cache as listing-published photos when listing context arrives', async () => {
  await draw(); expect(visible()[0].src).toBe(captured.image_url);
  await draw(onlyA());
  expect(visible()).toEqual([listingPhoto('addressed'), listingPhoto('unaddressed')]);
});
it('does not relabel a listing-photo cache as a captured-day photo when listing context is removed', async () => {
  await draw(onlyA()); expect(visible()).toHaveLength(2); await draw();
  expect(visible().map(p => p.src)).toEqual([captured.image_url]);
  expect(visible()[0].title).not.toBe('published with the listing — no capture time');
});
it('rechecks same-mode attribution when a newly known listing changes the existing owner result', async () => {
  await draw(onlyA()); expect(visible()).toHaveLength(2);
  expect(listingForPhoto(unaddressed, onlyA())?.key).toBe('episode-a');
  expect(listingForPhoto(unaddressed, withNewer())?.key).toBe('episode-b');
  await draw(withNewer()); expect(visible()).toEqual([listingPhoto('addressed')]);
});
it('does not publish a pending photo result using obsolete listing attribution context', async () => {
  const pending = deferred(); reply = () => pending.promise;
  await draw(onlyA()); await draw(withNewer());
  reply = null; await act(async () => pending.resolve(json([addressed, unaddressed])));
  expect(visible()).toEqual([listingPhoto('addressed')]);
});
it('keeps a useful unchanged-context pending result without an extra query', async () => {
  const pending = deferred(); reply = () => pending.promise; await draw(onlyA()); await draw(onlyA());
  await act(async () => pending.resolve(json([addressed, unaddressed])));
  expect(visible()).toEqual([listingPhoto('addressed'), listingPhoto('unaddressed')]); expect(requests).toHaveLength(1);
});
it('ignores an old capture read after a new listing read has already supplied useful photos', async () => {
  const pending = deferred(); reply = url => url.searchParams.has('or') ? undefined : pending.promise;
  await draw(); await draw(onlyA()); expect(visible()).toHaveLength(2);
  await act(async () => pending.resolve(json([captured])));
  expect(visible()).toEqual([listingPhoto('addressed'), listingPhoto('unaddressed')]);
});

it.each(['http', 'network', 'malformed'])('states Photos unavailable for %s instead of claiming a successful empty read', async failure => {
  reply = () => failure === 'http' ? json({ code: '42501', message: 'Private synthetic detail' }, 403)
    : failure === 'network' ? Promise.reject(new Error('Private synthetic network detail')) : json({ unexpected: true });
  await draw(); expect(host.textContent).toContain('Photos unavailable');
  expect(host.textContent).not.toContain('NO ACTIVITY'); expect(host.textContent).not.toContain('Private synthetic');
});
it('retains known work and auction content when photos are unavailable', async () => {
  fixture.timeline = [{ id: 'known-work', event_date: day, event_type: 'work_session', title: 'Known synthetic work', cost_amount: 125,
    metadata: { duration_minutes: 60, work_description: 'Known synthetic story' } }];
  const auctions = onlyA();
  auctions[0].items = [{ id: 'known-comment', kind: 'comment', at: `${day}T12:00:00Z`, amount: null, author: 'Synthetic reader',
    text: 'Known synthetic comment', url: 'https://bringatrailer.com/listing/episode-a/#comment-1', likes: 0, seq: null, postClose: null, listingKey: 'episode-a' }];
  reply = () => json({ code: '42501' }, 403); await draw(auctions);
  expect(host.textContent).toContain('Photos unavailable'); expect(host.textContent).toContain('Known synthetic work');
  expect(host.textContent).toContain('Known synthetic story'); expect(host.textContent).toContain('$125');
  expect(host.textContent).toContain('Known synthetic comment'); expect(host.textContent).not.toContain('NO ACTIVITY');
});
it('masks the previous photo in the first committed frame of a direct date change', async () => {
  await draw(); const pending = deferred(); reply = () => pending.promise;
  await draw([], nextDay);
  expect(photoFrames.find(frame => frame.date === nextDay)?.photos).toEqual([]);
  expect(visible()).toEqual([]);
  await act(async () => pending.resolve(json([image('next-capture', { source: 'owner_upload', taken_at: `${nextDay}T12:00:00Z` })])));
  expect(visible().map(p => p.src)).toEqual(['https://photos.test/next-capture.jpg']);
});
it('preserves listing truncation, storage thumbnails and the real photo-open identity', async () => {
  rows = Array.from({ length: 125 }, (_, i) => image(`synthetic-${i}`, {
    image_url: `https://day-photos.test/storage/v1/object/public/vehicle-images/${i}.jpg`, source_url: addressed.source_url }));
  await draw(onlyA()); expect(visible()).toHaveLength(120);
  expect(visible()[0].src).toBe('https://day-photos.test/storage/v1/render/image/public/vehicle-images/0.jpg?width=200&quality=70&resize=contain');
  const onOpen = vi.fn(); window.addEventListener('nuke:vehicle-photo-open', onOpen);
  try {
    await act(async () => host.querySelector('img')!.closest('button')!.click());
    expect((onOpen.mock.calls[0][0] as CustomEvent).detail).toEqual({ imageId: 'synthetic-0' });
  } finally { window.removeEventListener('nuke:vehicle-photo-open', onOpen); }
});
it('does not cache a departed pending response over explicit reopen demand', async () => {
  const pending = deferred(); reply = () => pending.promise; await draw(); await close();
  await act(async () => pending.resolve(json([captured]))); reply = null; await draw();
  expect(visible().map(p => p.src)).toEqual([captured.image_url]); expect(requests).toHaveLength(2);
});
it('uses the actual Barcode NEXT caller without committing the previous day photo under the next day', async () => {
  fixture.timeline = [{ id: 'day-a', event_date: day, event_type: 'photo_session' }, { id: 'day-b', event_date: nextDay, event_type: 'photo_session' }];
  const pending = deferred(); reply = url => url.searchParams.getAll('taken_at').some(value => value.includes(nextDay)) ? pending.promise : undefined;
  await act(async () => root.render(<MemoryRouter><BarcodeTimeline /></MemoryRouter>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Vehicle timeline"]')!.click());
  await act(async () => host.querySelector<HTMLElement>(`[data-date="${day}"]`)!.click());
  expect(visible().map(p => p.src)).toEqual([captured.image_url]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next day"]')!.click());
  expect(photoFrames.find(frame => frame.date === nextDay)?.photos).toEqual([]);
  await act(async () => pending.resolve(json([image('next-capture', { source: 'owner_upload', taken_at: `${nextDay}T12:00:00Z` })])));
  expect(visible().map(p => p.src)).toEqual(['https://photos.test/next-capture.jpg']);
});
