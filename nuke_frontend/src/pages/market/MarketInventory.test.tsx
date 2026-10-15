// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ query: {} as any, source: vi.fn(), more: vi.fn(), board: vi.fn(), boardQuery: {} as any }));
vi.mock('./useCapturedListings', async original => ({ ...await original<typeof import('./useCapturedListings')>(), useCapturedListings: (source: string, enabled = true) => { if (enabled) fixture.source(source); return fixture.query; } }));
vi.mock('./useAskBoard', async original => ({ ...await original<typeof import('./useAskBoard')>(), useAskBoard: (q: any, enabled = true) => { fixture.board(q, enabled); return fixture.boardQuery; } }));
vi.mock('./MarketPulse', () => ({ default: ({ collection }: any) => <section>Existing BaT bid board{collection}</section> }));
vi.mock('./AuctionCalendar', () => ({ default: ({ collection }: any) => <section>Calendar fixture{collection}</section> }));
vi.mock('./PrivateCaptureHistory', () => ({ default: () => null }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import MarketInventory from './MarketInventory';
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  fixture.source.mockClear(); fixture.more.mockClear(); fixture.board.mockClear();
  fixture.boardQuery = { data: { pages: [{ as_of: '2026-10-13T23:30:00Z', since: '2026-10-12T23:30:00Z', window_hours: 24, band_min_taste: 60, matching: 3,
    population: { asks: 374, priced: 368, with_point: 3, in_band: 67, by_source: { craigslist: 374 }, by_tier: { under_5k: 120, '5k_15k': 140, '15k_40k': 80, '40k_100k': 25, '100k_plus': 3, unpriced: 6 } },
    rows: [
      { event_id: 'e1', vehicle_id: 'v1', source: 'craigslist', url: 'https://www.craigslist.org/view/d/fixture-blazer/SyntheticShareToken0001', asking_price: 18800, tier: '15k_40k',
        first_seen_at: '2026-10-13T22:00:00Z', posted_at: '2026-10-13T16:03:45Z', year: 1984, make: 'Chevrolet', model: 'Blazer', drivetrain: '4WD', body_style: 'SUV', mileage: 88000,
        image: null, city: 'Phoenix', region: 'AZ', lat: 33.45, lng: -112.07, distance_mi: 256, taste: 96, in_band: true },
      { event_id: 'e2', vehicle_id: 'v2', source: 'craigslist', url: null, asking_price: null, tier: null, first_seen_at: '2026-10-13T21:00:00Z', posted_at: null,
        year: 1979, make: 'Ford', model: 'F-250', drivetrain: null, body_style: null, mileage: null, image: null, city: null, region: null, lat: null, lng: null, distance_mi: null, taste: 20, in_band: false },
    ] }] }, hasNextPage: true, fetchNextPage: fixture.more, isPending: false, isError: false };
  fixture.query = { data: { pages: [{ items: [{ id: 'listing', vehicle_id: null, vehicle: null, source_platform: 'craigslist', source_listing_id: '7000000000', source_url: 'https://www.craigslist.org/view/d/fixture-listing/SyntheticShareToken0000', current_price: 0, event_status: 'active', created_at: '2026-10-13T02:31:04Z', updated_at: '2026-10-13T02:32:00Z' }] }] }, hasNextPage: true, fetchNextPage: fixture.more };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(query = 'collection=listings&source=craigslist') { window.history.replaceState({}, '', '/?' + query); await act(async () => root.render(<BrowserRouter><MarketInventory /></BrowserRouter>)); }
it('opens the existing explorer at Market and keeps unresolved source presentations one explicit collection away', async () => {
  await render('tab=market');
  expect(container.textContent).toContain('Existing BaT bid board');
  expect(fixture.source).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Just listed')!.click());
  expect(new URLSearchParams(window.location.search).get('tab')).toBe('market');
  expect(new URLSearchParams(window.location.search).get('collection')).toBe('listings');
  expect(container.querySelector('h1')?.textContent).toBe('Just listed');
  expect(fixture.source).not.toHaveBeenCalled();
  await act(async () => root.unmount()); root = createRoot(container);
  await render('tab=market&collection=listings&source=craigslist');
  expect(container.textContent).toContain('Vehicle unresolved'); expect(container.textContent).toContain('7000000000');
  expect(container.textContent).toContain('$0 · asking'); expect(container.textContent).toContain('availability and source-wide coverage are unverified');
  expect(container.textContent).toContain('Source observation time unrecorded');
  expect(container.querySelector('a')?.getAttribute('href')).toContain('craigslist.org/view/d/');
  expect(container.querySelector('a[href^="/vehicle/"]')).toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Load more listings')!.click());
  expect(fixture.more).toHaveBeenCalledOnce();
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
  expect([...container.querySelectorAll('button')].map(b => b.textContent)).toEqual(expect.arrayContaining(['BaT live auctions', 'Just listed']));
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
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Just listed')!.click());
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

it('opens classifieds as just listed: a refresh control instead of a clock, filters folded away, rows with source and age', async () => {
  await render('collection=listings');
  expect(container.querySelector('h1')?.textContent).toBe('Just listed');
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

  it('is live while the newest arrival is within one 15-minute intake cycle, and says how far behind past it', async () => {
    const { freshness } = await import('./ClassifiedArrivals');
    const now = Date.parse('2026-10-15T02:00:00Z');
    expect(freshness('2026-10-15T01:59:00Z', now)).toBe('live');
    expect(freshness('2026-10-15T01:45:00Z', now)).toBe('live');
    expect(freshness('2026-10-15T01:35:00Z', now)).toBe('25 min behind');
    expect(freshness('2026-10-14T23:00:00Z', now)).toBe('3 h behind');
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
