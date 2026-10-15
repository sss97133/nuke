// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: {} as any, source: vi.fn(), more: vi.fn(), board: vi.fn(), poll: vi.fn(), refresh: vi.fn(), boardQuery: {} as any, photos: vi.fn(), photoMap: new Map() as Map<string, any[]> }));
vi.mock('./useCapturedListings', async original => ({ ...await original<typeof import('./useCapturedListings')>(), useCapturedListings: (source: string, enabled = true) => { if (enabled) fixture.source(source); return fixture.query; } }));
vi.mock('./useAskBoard', async original => ({ ...await original<typeof import('./useAskBoard')>(), readAskBoard: fixture.poll, useAskBoard: (q: any, enabled = true) => { fixture.board(q, enabled); return fixture.boardQuery; } }));
vi.mock('./useListingPhotos', async original => ({ ...await original<typeof import('./useListingPhotos')>(), useListingPhotos: (pages: string[][]) => { fixture.photos(pages); return fixture.photoMap; } }));
vi.mock('./MarketPulse', () => ({ default: ({ collection }: any) => <section>Existing BaT bid board{collection}</section> }));
vi.mock('./AuctionCalendar', () => ({ default: ({ collection }: any) => <section>Calendar fixture{collection}</section> }));
vi.mock('./PrivateCaptureHistory', () => ({ default: () => null }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import MarketInventory from './MarketInventory';
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  fixture.source.mockClear(); fixture.more.mockClear(); fixture.board.mockClear(); fixture.photos.mockClear();
  fixture.poll.mockReset(); fixture.refresh.mockReset();
  fixture.photoMap = new Map([['v1', [
    { vehicle_id: 'v1', image_url: 'https://images.craigslist.org/00b_fixtureB_600x450.jpg' },
    { vehicle_id: 'v1', image_url: 'https://images.craigslist.org/00a_fixtureA_600x450.jpg' },
    { vehicle_id: 'v1', image_url: 'https://images.craigslist.org/00b_fixtureB_600x450.jpg' },
  ]]]);
  fixture.boardQuery = { data: { pages: [{ as_of: '2026-10-13T23:30:00Z', since: '2026-10-12T23:30:00Z', window_hours: 24, band_min_taste: 60, matching: 3,
    population: { asks: 374, priced: 368, with_point: 3, in_band: 67, by_source: { craigslist: 374 }, by_tier: { under_5k: 120, '5k_15k': 140, '15k_40k': 80, '40k_100k': 25, '100k_plus': 3, unpriced: 6 } },
    rows: [
      { event_id: 'e1', vehicle_id: 'v1', source: 'craigslist', url: 'https://www.craigslist.org/view/d/fixture-blazer/SyntheticShareToken0001', asking_price: 18800, tier: '15k_40k',
        first_seen_at: '2026-10-13T22:00:00Z', posted_at: '2026-10-13T16:03:45Z', year: 1984, make: 'Chevrolet', model: 'Blazer', drivetrain: '4WD', body_style: 'SUV', mileage: 88000,
        image: null, city: 'Phoenix', region: 'AZ', lat: 33.45, lng: -112.07, distance_mi: 256, taste: 96, in_band: true },
      { event_id: 'e2', vehicle_id: 'v2', source: 'craigslist', url: null, asking_price: null, tier: null, first_seen_at: '2026-10-13T21:00:00Z', posted_at: null,
        year: 1979, make: 'Ford', model: 'F-250', drivetrain: null, body_style: null, mileage: null, image: null, city: null, region: null, lat: null, lng: null, distance_mi: null, taste: 20, in_band: false },
    ] }] }, hasNextPage: true, fetchNextPage: fixture.more, refetch: fixture.refresh, isPending: false, isError: false };
  fixture.query = { data: { pages: [{ items: [{ id: 'listing', vehicle_id: null, vehicle: null, source_platform: 'craigslist', source_listing_id: '7000000000', source_url: 'https://www.craigslist.org/view/d/fixture-listing/SyntheticShareToken0000', current_price: 0, event_status: 'active', created_at: '2026-10-13T02:31:04Z', updated_at: '2026-10-13T02:32:00Z' }] }] }, hasNextPage: true, fetchNextPage: fixture.more };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function render(query = 'collection=listings&source=craigslist') { window.history.replaceState({}, '', '/?' + query); await act(async () => root.render(<BrowserRouter><MarketInventory /></BrowserRouter>)); }
it('opens the existing explorer at Market and keeps unresolved source presentations one explicit collection away', async () => {
  await render('tab=market');
  expect(container.textContent).toContain('Existing BaT bid board');
  expect(fixture.source).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Classifieds')!.click());
  expect(new URLSearchParams(window.location.search).get('tab')).toBe('market');
  expect(new URLSearchParams(window.location.search).get('collection')).toBe('listings');
  expect(container.querySelector('h1')?.textContent).toBe('Classifieds');
  expect(fixture.source).not.toHaveBeenCalled();
  await act(async () => root.unmount()); root = createRoot(container);
  await render('tab=market&collection=listings&source=craigslist');
  expect(container.textContent).toContain('Vehicle unresolved'); expect(container.textContent).toContain('7000000000');
  expect(container.querySelector('tbody tr td:nth-child(2)')?.textContent).toBe('0');
  expect(container.textContent).toContain('Availability and source-wide coverage are unverified');
  expect(container.textContent).toContain('Source observation time unrecorded');
  expect(container.querySelector('a')?.getAttribute('href')).toContain('craigslist.org/view/d/');
  expect(container.querySelector('a[href^="/vehicle/"]')).toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Load more listings')!.click());
  expect(fixture.more).toHaveBeenCalledOnce();
});
it('keeps retained auction and classified amounts neutral when their reader supplies no currency or price basis', async () => {
  const original = fixture.query.data.pages[0].items[0];
  fixture.query.data.pages[0].items = [
    { ...original, id: 'auction', source_platform: 'bat', source_url: 'https://bringatrailer.com/listing/1963-chevrolet-corvette/', current_price: 125000, event_status: 'sold' },
    { ...original, id: 'classified', current_price: 18800 },
    { ...original, id: 'unknown', source_platform: 'mecum', current_price: null, event_status: 'unknown' },
  ];
  await render('collection=listings&source=');
  const amounts = [...container.querySelectorAll('tbody tr td:nth-child(2)')].map(cell => cell.textContent);
  expect(amounts).toEqual(['125,000', '18,800', 'Unrecorded']);
  expect(container.textContent).toContain('Recorded amount');
  expect(container.textContent).toContain('amount type and currency are unrecorded here');
  expect(container.textContent).toContain('Recorded sold');
  expect(container.querySelector('table')?.textContent).not.toMatch(/\$|asking|sale price|high bid/);
  expect(container.textContent).not.toContain('US classifieds, in dollars');
});
it('keeps source filtering and Market navigation in the URL and retains existing auction deep links', async () => {
  await render('tab=market&source=craigslist'); expect(fixture.source).toHaveBeenLastCalledWith('craigslist');
  await act(async () => { const select = container.querySelector('select')!; select.value = 'ksl'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(new URLSearchParams(window.location.search).get('source')).toBe('ksl');
  expect(new URLSearchParams(window.location.search).get('tab')).toBe('market');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'BaT live auctions')!.click());
  expect(container.textContent).toContain('Existing BaT bid board');
});
it('opens the auction calendar as a third collection and clears a chosen sale when leaving it', async () => {
  await render('tab=market');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Calendar')!.click());
  expect(new URLSearchParams(window.location.search).get('collection')).toBe('calendar');
  expect(container.textContent).toContain('Calendar fixture');
  expect([...container.querySelectorAll('button')].map(b => b.textContent)).toEqual(expect.arrayContaining(['BaT live auctions', 'Classifieds']));
  await act(async () => root.unmount()); root = createRoot(container);
  await render('tab=market&collection=calendar&sale=mecum:fixture-2027');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'BaT live auctions')!.click());
  expect(new URLSearchParams(window.location.search).get('sale')).toBeNull();
  expect(container.textContent).toContain('Existing BaT bid board');
});
it('carries no lens from one collection into another: only the page params and the new collection survive a switch', async () => {
  const kept = () => [...new URLSearchParams(window.location.search).keys()].sort();
  await render('tab=market&force_treemap=1&collection=listings&source=ksl&near=1&sort=newest&radius=250');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'BaT live auctions')!.click());
  expect(kept()).toEqual(['collection', 'force_treemap', 'tab']);
  expect(new URLSearchParams(window.location.search).get('collection')).toBe('auctions');
  expect(container.textContent).toContain('Existing BaT bid board');
  await act(async () => root.unmount()); root = createRoot(container);
  await render('tab=market&collection=auctions&live=1&bidRange=under10k&lot=retained-lot&sort=ending');
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Calendar')!.click());
  expect(kept()).toEqual(['collection', 'tab']);
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Classifieds')!.click());
  expect(kept()).toEqual(['collection', 'tab']);
  expect(new URLSearchParams(window.location.search).get('collection')).toBe('listings');
});
it('shows the retained source observation separately from admission and update clocks', async () => {
  const row = fixture.query.data.pages[0].items[0];
  row.source_observed_at = '2026-10-12T01:02:03Z';
  await render();
  expect(container.textContent).toContain(`Source observation time ${new Date(row.source_observed_at).toLocaleString()}`);
  expect(container.textContent).toContain(`Retained ${new Date(row.created_at).toLocaleString()}`);
  expect(container.textContent).toContain(`Record updated ${new Date(row.updated_at).toLocaleString()}`);
  expect(container.textContent).not.toContain('Source observation time unrecorded');
});
it('opens the unchanged auction board for a legacy lot deep link', async () => {
  await render('tab=market&lot=retained-lot'); expect(container.textContent).toContain('Existing BaT bid board');
  expect(container.querySelector('section[aria-label="Captured listings"]')).toBeNull();
});
it.each(['make=FORD&board=1', 'live=1&sort=ending&bidRange=under10k', 'day=2026-10-01&salesScope=all&days=7&benchmark=all', 'inspect=sources&series=fixture'])('preserves existing auction lens links: %s', async query => {
  await render(query); expect(container.textContent).toContain('Existing BaT bid board');
});
it('honors an explicit listings selection while retaining the old auction lens context', async () => {
  await render('collection=listings&make=FORD&board=1');
  expect(container.querySelector('section[aria-label="Classified arrivals"]')).not.toBeNull();
  expect(new URLSearchParams(window.location.search).get('make')).toBe('FORD');
});
it('links eligible vehicles with their exact recorded identity and shared nameplate', async () => {
  const row = fixture.query.data.pages[0].items[0]; row.vehicle_id = 'eligible';
  row.vehicle = { id: 'eligible', year: 1963, make: 'Chevrolet', model: 'Corvette', primary_image_url: 'https://example.com/vehicle.jpg' };
  await render();
  const link = container.querySelector('a[href="/vehicle/eligible"]');
  expect(link?.getAttribute('aria-label')).toBe('1963 Chevrolet Corvette');
  expect(link?.querySelector('.sr-only')?.textContent).toBe('1963 Chevrolet Corvette');
  const visibleIdentity = link!.cloneNode(true) as HTMLElement;
  visibleIdentity.querySelectorAll('.sr-only').forEach(node => node.remove());
  expect(visibleIdentity.textContent?.match(/1963/g)).toHaveLength(1);
  const image = container.querySelector('img'); expect(image?.getAttribute('alt')).toBe('Vehicle record image');
  expect(image?.getAttribute('width')).toBe('80'); expect(image?.getAttribute('height')).toBe('60');
});

// ---- the arrivals board ---------------------------------------------------------------------------------------------

const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.startsWith(text))!;
const lastQuery = () => fixture.board.mock.calls.at(-1)![0];

it('opens classifieds: a refresh control instead of a clock, filters folded away, rows with source and age', async () => {
  await render('collection=listings');
  expect(container.querySelector('h1')?.textContent).toBe('Classifieds');
  expect(container.textContent).not.toContain('asks first seen');
  expect(button('↻')).toBeTruthy();
  expect(container.querySelector('details.market-filters')?.hasAttribute('open')).toBe(false);
  expect(button('$5K–15K').textContent).toBe('$5K–15K · 140');
  expect(container.textContent).toContain('368 of 374 priced (6 without a price) · 3 with a recorded place · 67 in the band (taste 60+) · Craigslist 374');
  expect(container.textContent).toContain('Phoenix, AZ'); expect(container.textContent).toContain('256 mi away');
  expect(container.textContent).toContain('88,000 mi'); expect(container.textContent).not.toContain('4WD · SUV');
  expect(container.textContent).not.toContain('original listing'); expect(container.textContent).not.toMatch(/taste 96/);
  // The source is a quiet mark with its name for screen readers; the age reads in feed terms; the price stands alone.
  expect(container.querySelector('.market-ask__mark')?.getAttribute('alt')).toBe('Craigslist');
  expect(container.querySelector('.market-ask__seen')?.textContent).toMatch(/^(just now|\d+ (min|h|d)( \d+ min)? ago)$/);
  expect(container.querySelector('.market-ask__deal')?.textContent).toContain('$18,800');
  expect(container.querySelector('.market-asks')?.textContent).not.toContain('asking');
  expect(container.textContent).toContain('Unpriced'); expect(container.textContent).toContain('Place unrecorded');
  expect(container.querySelector('a[href="/vehicle/v1"]')).not.toBeNull();
  expect(lastQuery()).toEqual({ hours: 24, tier: null, band: false, sort: 'newest', point: null, radius: null });
  await act(async () => button('Load more').click());
  expect(fixture.more).toHaveBeenCalledOnce();
});

it('a card carries every photo the capture landed: the board image first, one read per page, the count in the corner', async () => {
  fixture.boardQuery.data.pages[0].rows[0].image = 'https://images.craigslist.org/00a_fixtureA_600x450.jpg';
  await render('collection=listings');
  expect(fixture.photos).toHaveBeenLastCalledWith([['v1', 'v2']]);
  const [first, second] = [...container.querySelectorAll('.market-ask')];
  expect([...first.querySelectorAll('.market-ask__strip img')].map(img => img.getAttribute('src')))
    .toEqual(['https://images.craigslist.org/00a_fixtureA_600x450.jpg', 'https://images.craigslist.org/00b_fixtureB_600x450.jpg']);
  expect(first.querySelector('.market-ask__count')?.textContent).toBe('1 / 2');
  expect(first.querySelector<HTMLButtonElement>('button[aria-label="Previous photo"]')?.disabled).toBe(true);
  expect(first.querySelector<HTMLButtonElement>('button[aria-label="Next photo"]')?.disabled).toBe(false);
  expect(first.querySelector('a[href="/vehicle/v1"] .market-ask__strip')).not.toBeNull();
  // No photo at all: the blank frame, no count, no arrows.
  expect(second.querySelector('.market-ask__blank')).not.toBeNull();
  expect(second.querySelector('.market-ask__count')).toBeNull();
  expect(second.querySelector('button[aria-label="Next photo"]')).toBeNull();
});

it('a photo list keeps web addresses only, once each, the lead first', async () => {
  const { photoList } = await import('./useListingPhotos');
  expect(photoList('https://a.example/1.jpg', [
    { vehicle_id: 'v', image_url: 'https://a.example/2.jpg' }, { vehicle_id: 'v', image_url: 'https://a.example/1.jpg' },
    { vehicle_id: 'v', image_url: 'javascript:alert(1)' }, { vehicle_id: 'v', image_url: 'https://user:pw@a.example/3.jpg' },
    { vehicle_id: 'v', image_url: null }, { vehicle_id: 'v', image_url: 'storage/relative.jpg' },
  ])).toEqual(['https://a.example/1.jpg', 'https://a.example/2.jpg']);
  expect(photoList(null, undefined)).toEqual([]);
});

it('says where an ask lands: the word, the price line, then the counts it rests on; nothing without a position', async () => {
  fixture.boardQuery.data.pages[0].rows[0].position = {
    family: 'Blazer', family_id: 'f-blazer', share: 40 / 43, basis: 'asked',
    sold: { n: 16, year_from: 1983, year_to: 1985, thin: false, p25: 9000, p50: 12500, p75: 16000, at_or_below: 15, by_source: { bat: 12, mecum: 4 } },
    asked: { n: 43, year_from: 1983, year_to: 1985, thin: false, p25: 8000, p50: 11000, p75: 15000, at_or_below: 40 },
  };
  await render('collection=listings');
  const [first, second] = [...container.querySelectorAll('.market-ask')];
  const placed = first.querySelector('.market-ask__position')!;
  expect(placed.querySelector('.k-label')?.textContent).toBe('top of the market · 1983–85 Blazer');
  // Placed by the other asks (ten or more exist), so they come first; the sales follow.
  expect([...placed.querySelectorAll('.k-caption')].map(n => n.textContent)).toEqual([
    'at or above 40 of 43 asks, median $11K', 'at or above 15 of 16 sales, median $12.5K']);
  expect(placed.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('ask $18,800; middle half $8,000 to $15,000, median $11,000');
  expect(second.querySelector('.market-ask__position')).toBeNull();
});

it('tier, band and window are lenses in the URL', async () => {
  await render('collection=listings');
  await act(async () => button('$5K–15K').click());
  expect(new URLSearchParams(window.location.search).get('tier')).toBe('5k_15k');
  expect(lastQuery().tier).toBe('5k_15k');
  await act(async () => button('My band').click());
  expect(new URLSearchParams(window.location.search).get('band')).toBe('1');
  expect(lastQuery().band).toBe(true);
  await act(async () => { const select = [...container.querySelectorAll('select')].find(s => s.querySelector('option[value="168"]'))!;
    select.value = '168'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(lastQuery().hours).toBe(168);
  await act(async () => button('$5K–15K').click());
  expect(new URLSearchParams(window.location.search).get('tier')).toBeNull();
});

it('near me asks the browser, keeps the point out of the URL, and sorts nearest first', async () => {
  const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 36.16987, longitude: -115.13981 } } as GeolocationPosition));
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  await render('collection=listings');
  await act(async () => button('Near me').click());
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  expect(lastQuery()).toMatchObject({ point: { lat: 36.17, lng: -115.14 }, sort: 'nearest' });
  expect(window.location.search).not.toContain('36.1');
});

it('near me refused: the whole country, said so', async () => {
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError) }, configurable: true });
  await render('collection=listings&near=1');
  expect(container.textContent).toContain('Location not shared; showing the whole country.');
  expect(lastQuery().point).toBeNull();
});

describe('what a listing says about its miles and title', () => {
  it('never shows a disclosed broken odometer as a mileage, says rolled over and an unclean title, and leaves clean unsaid', async () => {
    const { listingFacts } = await import('./ClassifiedArrivals');
    expect(listingFacts({ mileage: 10, listing_mileage: 10, odometer: 'broken', title_status: null })).toEqual({ miles: 'odometer broken', title: null });
    expect(listingFacts({ mileage: 5, listing_mileage: 62000, odometer: 'rolled_over', title_status: 'salvage' })).toEqual({ miles: '62,000 mi, rolled over', title: 'salvage title' });
    expect(listingFacts({ mileage: 88000, listing_mileage: null, odometer: null, title_status: 'clean' })).toEqual({ miles: '88,000 mi', title: null });
    expect(listingFacts({ mileage: null, odometer: null, title_status: undefined } as never)).toEqual({ miles: null, title: null });
  });
});

describe('how a listing is named', () => {
  it('capitalises words typed in lower case, writes codes in capitals, and keeps what the seller capitalised', async () => {
    const { tidyName } = await import('./ClassifiedArrivals');
    expect(tidyName('wrangler')).toBe('Wrangler');
    expect(tidyName('tacoma sr5')).toBe('Tacoma SR5');
    expect(tidyName('f-150 xlt')).toBe('F-150 Xlt');
    expect(tidyName('k1500')).toBe('K1500');
    expect(tidyName('Sonoma')).toBe('Sonoma');
    expect(tidyName('DeVille')).toBe('DeVille');
    expect(tidyName(null)).toBe('');
  });
});

describe('how a feed says time', () => {
  it('says how old a listing is in feed terms, and unknown as unknown', async () => {
    const { ageOf, freshness } = await import('./ClassifiedArrivals');
    const now = Date.parse('2026-10-15T02:00:00Z');
    expect(ageOf('2026-10-15T01:59:30Z', now)).toBe('now');
    expect(ageOf('2026-10-15T01:48:00Z', now)).toBe('12 min');
    expect(ageOf('2026-10-15T00:48:00Z', now)).toBe('1 h 12 min');
    expect(ageOf('2026-10-15T01:00:00Z', now)).toBe('1 h');
    expect(ageOf('2026-10-14T23:00:00Z', now)).toBe('3 h');
    expect(ageOf('2026-10-13T01:00:00Z', now)).toBe('2 d');
    expect(ageOf(null, now)).toBeNull();
    expect(freshness(null, now)).toBe('refresh');
  });

  it('states the read age without treating it as proof of source freshness', async () => {
    const { freshness } = await import('./ClassifiedArrivals');
    const now = Date.parse('2026-10-15T02:00:00Z');
    expect(freshness('2026-10-15T01:59:45Z', now)).toBe('read just now');
    expect(freshness('2026-10-15T01:45:00Z', now)).toBe('read 15 min ago');
    expect(freshness('2026-10-15T01:35:00Z', now)).toBe('read 25 min ago');
    expect(freshness('2026-10-14T23:00:00Z', now)).toBe('read 3 h ago');
    expect(freshness('2099-01-01T00:00:00Z', now)).toBe('refresh');
  });

  it('keeps the snapshot clock independent of posting age and surfaces a failed background check', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T02:00:00Z'));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    fixture.boardQuery.data.pages[0].as_of = '2026-10-15T01:30:00Z';
    fixture.boardQuery.data.pages[0].newest_at = '2026-10-15T01:59:59Z';
    fixture.poll.mockRejectedValue(new Error('read unavailable'));
    await render('collection=listings');
    expect(container.querySelector('.k-masthead__result button')?.textContent).toBe('↻ read 30 min ago');
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(container.querySelector('.k-masthead__result button')?.textContent).toBe('↻ retry');
    expect(container.querySelector('.k-masthead__result button')?.getAttribute('title')).toContain('Latest check failed');
    expect(container.querySelectorAll('.market-ask')).toHaveLength(2);
  });

  it('does not report nothing new after a failed refresh or keep reading on initial failure', async () => {
    fixture.refresh.mockResolvedValue({ isError: true, data: fixture.boardQuery.data });
    await render('collection=listings');
    await act(async () => (container.querySelector('.k-masthead__result button') as HTMLButtonElement).click());
    expect(container.textContent).not.toContain('nothing new yet');
    fixture.boardQuery.data = undefined; fixture.boardQuery.isError = true;
    await render('collection=listings');
    expect(container.querySelector('.k-masthead__result button')?.textContent).toBe('↻ retry');
  });

  it('knows its newest arrival from the reader, else from its rows, and counts what came after it', async () => {
    const { newestOf, arrivalsAfter } = await import('./ClassifiedArrivals');
    const rows = [{ first_seen_at: '2026-10-15T01:30:00+00:00' }, { first_seen_at: '2026-10-15T01:45:00+00:00' }];
    expect(newestOf({ newest_at: '2026-10-15T01:46:00+00:00', rows: rows as never })).toBe('2026-10-15T01:46:00+00:00');
    expect(newestOf({ newest_at: undefined, rows: rows as never })).toBe('2026-10-15T01:45:00.000Z');
    // Before the reader carries listed_at: a post time before the first sighting is the listing's age; a later one is not.
    const { listedAt } = await import('./ClassifiedArrivals');
    expect(listedAt({ first_seen_at: '2026-10-15T01:45:00Z', posted_at: '2026-10-14T19:00:00Z' })).toBe('2026-10-14T19:00:00Z');
    expect(listedAt({ first_seen_at: '2026-10-15T01:45:00Z', posted_at: '2099-01-01T00:00:00Z' })).toBe('2026-10-15T01:45:00Z');
    expect(listedAt({ first_seen_at: '2026-10-15T01:45:00Z', posted_at: null, listed_at: '2026-10-15T01:00:00Z' })).toBe('2026-10-15T01:00:00Z');
    expect(newestOf({ newest_at: null, rows: [] })).toBeNull();
    expect(newestOf(undefined)).toBeNull();
    expect(arrivalsAfter(rows, '2026-10-15T01:40:00Z')).toBe(1);
    expect(arrivalsAfter(rows, '2026-10-15T01:45:00Z')).toBe(0);
    expect(arrivalsAfter(rows, null)).toBe(0);
  });
});

describe('where an ask lands', () => {
  it('places by the reader\'s share, else by asks when they are enough, else by sales, and counts a thin population without placing it', async () => {
    const { headline, placement, spreadLine } = await import('./askPosition');
    expect(placement(0.95)).toBe('top of the market');
    expect(placement(0.75)).toBe('upper end');
    expect(placement(0.5)).toBe('middle of the market');
    expect(placement(0.2)).toBe('lower end');
    expect(placement(0.05)).toBe('bottom of the market');
    // The reader's share and basis lead when present.
    expect(headline({ family: 'Wrangler', share: 0.52, basis: 'sold',
      sold: { n: 214, year_from: 1997, year_to: 2001, thin: false, p25: 9000, p50: 13500, p75: 19000, at_or_below: 111 } }))
      .toEqual({ word: 'middle of the market', basis: 'sales', span: '1997–01 Wrangler' });
    const thinSold = { n: 6, year_from: 1965, year_to: 1965, thin: true, p25: null, p50: null, p75: null, at_or_below: null };
    const asked = { n: 40, year_from: 1964, year_to: 1966, thin: false, p25: 12000, p50: 18000, p75: 24000, at_or_below: 3 };
    expect(headline({ family: 'Barracuda', sold: thinSold, asked })).toEqual({ word: 'bottom of the market', basis: 'asks', span: '1964–66 Barracuda' });
    expect(spreadLine(thinSold, 'sales')).toBe('only 6 recorded sales');
    expect(spreadLine({ ...thinSold, n: 1 }, 'sales')).toBe('only 1 recorded sale');
    expect(spreadLine(asked, 'asks')).toBe('under 37 of 40 asks, median $18K');
    expect(spreadLine(null, 'asks')).toBeNull();
    expect(headline({ family: 'Barracuda', sold: thinSold, asked: null })).toBeNull();
    expect(headline(null)).toBeNull();
  });
});
