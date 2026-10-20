// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), recordView: vi.fn(), resolveLogo: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView: fixture.recordView }) }));
// The kit finds a mark from a source's name with a table of real names. The page's use of it is tested with a made-up name, so no test names a source.
vi.mock('../../kit/Claim', async importOriginal => ({ ...(await importOriginal<typeof import('../../kit/Claim')>()), resolveSourceLogo: fixture.resolveLogo }));
import SourceBrowse from './SourceBrowse';
import {
  appendRows, labelsFor, parseSourceBrowse, priceLine, readSourceBrowse, statusLabel, statusWord, totalHow, usd, yearOfClock, yearSpan,
  type ListingStatus,
} from './sourceBrowseRead';

// MARK: - Fixtures, shaped as browse_source_read sends them (counts shaped like one marketplace's facts of 2026-10-20)

const EXAMPLE = {
  slug: 'example_market', name: 'Example Market', category: 'marketplace', species: 'auth_walled_marketplace',
  species_label: 'Auth-walled marketplaces', unit: 'listings held',
  logo_url: 'https://nuke.ag/source-logos/example_market.png', base_url: 'https://market.example.test',
};
const AUCTION = {
  slug: 'timed_house', name: 'Timed House', category: 'auction', species: 'timed_auction',
  species_label: 'Timed with soft close', unit: 'lots held', logo_url: null, base_url: null,
};
const tally = (over: Record<string, unknown> = {}) => ({
  episodes: 0, vehicles: 0, active: 0, upcoming: 0, sold: 0, ended: 0, with_image: 0,
  shown_n: 0, shown_median: null, active_n: 0, active_median: null, ended_n: 0, ended_median: null, sold_n: 0, sold_median: null,
  year_min: null, year_max: null, ...over,
});
const BOARD = {
  day: '2026-10-20', lots: 3575, landed_at: '2026-10-20T08:00:00+00:00',
  population: null, population_method: null, population_confidence: null, population_at: null,
};
const HOLDINGS = {
  ...tally({ episodes: 19518, vehicles: 17663, active: 3681, sold: 3711, ended: 12126, with_image: 17102, shown_n: 18940, shown_median: 15000,
    active_n: 18940, active_median: 15000, ended_n: 11800, ended_median: 8800, sold_n: 3600, sold_median: 9900, year_min: 1932, year_max: 2026 }),
  unknown: 0, makes: 211, models: 2034, archived: 0, dated_min: null, dated_max: null,
  first_seen: '2026-09-02T10:00:00+00:00', last_seen: '2026-10-20T05:00:00+00:00',
  folded_at: '2026-10-20T09:45:12+00:00', landed_24h: 412, last_landed: '2026-10-20T05:10:00+00:00', board: null,
};
// A source with nothing on a public vehicle: the daily count is zero in every key.
const EMPTY = { ...HOLDINGS, ...tally(), makes: 0, models: 0, first_seen: null, last_seen: null, landed_24h: 0, last_landed: null };
const MAKES = [
  { make: 'Chevrolet', ...tally({ episodes: 2900, vehicles: 2700, active: 520, sold: 610, ended: 1770, with_image: 2650, shown_n: 2850, shown_median: 17500,
    sold_median: 12000, year_min: 1932, year_max: 2024 }),
    top_models: [{ model: 'Corvette', episodes: 410 }, { model: 'Camaro', episodes: 322 }, { model: 'C10', episodes: 280 }] },
  { make: 'Ford', ...tally({ episodes: 2400, vehicles: 2300, active: 410, sold: 520, ended: 1470, with_image: 2200, shown_n: 2350, shown_median: 14500,
    sold_median: 9800, year_min: 1928, year_max: 2023 }),
    top_models: [{ model: 'Mustang', episodes: 520 }, { model: 'F-150', episodes: 301 }, { model: 'Bronco', episodes: 150 }] },
  { make: 'Porsche', ...tally({ episodes: 1203, vehicles: 1180, active: 200, sold: 212, ended: 791, with_image: 1160, shown_n: 1190, shown_median: 38500,
    sold_median: 31000, year_min: 1957, year_max: 2023 }),
    top_models: [{ model: '911', episodes: 412 }, { model: 'Cayman', episodes: 120 }, { model: 'Boxster', episodes: 98 }] },
];
const okRead = (over: Record<string, unknown> = {}) => ({
  as_of: '2026-10-20T12:00:00+00:00', status: 'ok', median_floor: 5, source: EXAMPLE, holdings: HOLDINGS, level: 'makes',
  scope: { make: null, model: null, status: null }, makes: MAKES, models: [], listings: { total: 0, page: 1, page_size: 60, rows: [] }, ...over,
});
const row = (id: string, over: Record<string, unknown> = {}) => ({
  vehicle_id: id, year: 1969, make: 'Chevrolet', model: 'Camaro', trim: 'Z28', status: 'ended', status_raw: 'ended', shown_price: 4050,
  sold_price: null, price_kind: 'current_bid', price_label: null, bids: 6, listed_at: '2026-09-28T17:00:00+00:00',
  recorded_at: '2026-10-02T03:00:00+00:00', first_seen_at: '2026-10-02T03:00:00+00:00', ends_at: '2026-10-05T17:00:00+00:00',
  location: 'Reno, NV', image_url: 'https://images.example.test/camaro.jpg', listing_url: 'https://listings.example.test/itm/1',
  archive_url: null, ...over,
});
const listingsRead = (rows: unknown[], total: number, page = 1, over: Record<string, unknown> = {}, pageSize = 60) => okRead({
  level: 'listings', scope: { make: 'Chevrolet', model: 'Camaro', status: null }, makes: [],
  listings: { total, page, page_size: pageSize, rows }, ...over,
});
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const rowsOf = (from: number, count: number) => Array.from({ length: count }, (_, k) => row(id(from + k), { listing_url: `https://listings.example.test/itm/${from + k}` }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fixture.resolveLogo.mockReset(); fixture.resolveLogo.mockReturnValue(null);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  fixture.rpc.mockReset(); fixture.recordView.mockReset(); vi.restoreAllMocks();
});
const answer = (data: unknown) => fixture.rpc.mockImplementation(() => Promise.resolve({ data, error: null }));
/** The reader as it pages: `pages` maps a page number to the rows that page returns, and a page not named is empty. */
const serve = (total: number, pageSize: number, pages: Record<number, unknown[]>) =>
  fixture.rpc.mockImplementation((_fn: string, args: { p_page: number }) =>
    Promise.resolve({ data: listingsRead(pages[args.p_page] ?? [], total, args.p_page, {}, pageSize), error: null }));
const requested = () => fixture.rpc.mock.calls.map(c => (c[1] as { p_page: number }).p_page);
const mount = (ui: React.ReactElement, at = '/browse') => act(async () => root.render(<MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>));
const text = () => host.textContent ?? '';
const hrefs = () => [...host.querySelectorAll('a')].map(a => a.getAttribute('href'));
const link = (href: string) => [...host.querySelectorAll('a')].find(a => a.getAttribute('href') === href) as HTMLAnchorElement;
const typeInto = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const buttonNamed = (name: RegExp) => [...host.querySelectorAll('button')].find(b => name.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
const more = () => buttonNamed(/^more$/i);
const clickMore = () => act(async () => more()!.click());
const cards = () => [...host.querySelectorAll('article.sb-card')];
/** The element carrying a hover, by the words of the hover. */
const titled = (title: string) => [...host.querySelectorAll('[title]')].find(e => e.getAttribute('title') === title);
const blockLabels = () => [...host.querySelectorAll('.sb-measure')].map(e => e.getAttribute('aria-label'));

// MARK: - The makes level

describe('makes level', () => {
  it('shows the source, its holdings with their count clock, and a link per make', async () => {
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    expect(fixture.rpc).toHaveBeenCalledWith('browse_source_read',
      { p_source: 'example_market', p_make: null, p_model: null, p_page: 1, p_page_size: 60, p_sort: 'newest' });
    expect(host.querySelector('h1')?.textContent).toBe('Example Market');
    // The kind is the category in a visitor's words; Nuke's species name is only a hover.
    expect(host.querySelector('h1')?.parentElement?.textContent).toBe('Example MarketMarketplace');
    expect(text()).not.toContain('Auth-walled');
    expect(host.querySelector('[title="Auth-walled marketplaces"]')?.textContent).toBe('Marketplace');
    expect(host.querySelector('.k-figure')?.textContent).toBe('19,518');
    expect(text()).toContain('listings held');
    // The daily count is "counted", with a hover; the last 24 hours are a count of their own, never a part of it.
    expect(text()).toContain('counted Oct 20, 2026');
    expect(titled('Nuke counts each source once a day')?.textContent).toBe('counted Oct 20, 2026');
    expect(text()).toContain('412 listings recorded from this source in the last 24 hours, whether or not they are counted above');
    expect(text()).not.toMatch(/folded|landed|\+412|of these|arrived/);
    // The source's own total is not known to the page: it says so instead of printing n of n.
    expect(text()).toContain('source total unknown');
    expect(text()).not.toContain('19,518 of 19,518');
    // No median anywhere: a median over every model year and listing date of a source mixes different cars.
    expect(text()).not.toMatch(/median|priced/i);
    expect(text()).not.toMatch(/\$15,000|\$9,900|\$8,800/);
    expect(host.querySelector('[role="group"][aria-label="Median asking"]')).toBeNull();
    expect(host.querySelector('[role="group"][aria-label="Median sold"]')).toBeNull();
    expect(host.querySelector('[role="group"][aria-label="Sold"]')?.textContent).toContain('3,711');
    // Each block is n of all, on the day of the count it was read from.
    expect(host.querySelector('[role="group"][aria-label="Sold"]')?.textContent).toContain('3,711 of 19,518 listings · Oct 20, 2026');
    expect(host.querySelector('[role="group"][aria-label="Live at last check"]')?.textContent).toContain('3,681 of 19,518 listings · Oct 20, 2026');
    expect(host.querySelector('[role="group"][aria-label="Ended"]')?.textContent).toContain('12,126 of 19,518 listings · Oct 20, 2026');
    // A status with none is left out.
    expect(host.querySelector('[role="group"][aria-label="Upcoming"]')).toBeNull();
    expect(host.querySelector('[role="group"][aria-label="Status not recorded"]')).toBeNull();
    expect(text()).toContain('Model years 1932–2026 · first recorded Sep 2, 2026 · last recorded Oct 20, 2026');
    expect(text()).not.toMatch(/first seen|newest/);
    expect(text()).not.toMatch(/high bid/i);
    expect(text()).not.toContain('unranked');
    // A link per make, carrying the source; the top models sit in the cell.
    const makeLinks = hrefs().filter(h => h?.startsWith('/browse?source=example_market&make='));
    expect(makeLinks).toEqual(['/browse?source=example_market&make=Chevrolet', '/browse?source=example_market&make=Ford', '/browse?source=example_market&make=Porsche']);
    const porsche = link('/browse?source=example_market&make=Porsche');
    expect(porsche.textContent).toContain('1,203');
    expect(porsche.textContent).not.toMatch(/\$38,500|median|priced/i);
    expect(porsche.textContent).toContain('212 sold');
    expect(porsche.textContent).toContain('1957–2023');
    expect([...porsche.querySelectorAll('li')].map(li => li.textContent)).toEqual(['911412', 'Cayman120', 'Boxster98']);
    expect(text()).toContain('3 makes');
  });

  it('names the way back and the place, and draws the logo from the registry mark', async () => {
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    expect(hrefs()).toContain('/sources');
    const crumbs = host.querySelector('[aria-label="Where you are"]')!;
    // A navigation landmark, and the only thing so named.
    expect(crumbs.tagName).toBe('NAV');
    expect(host.querySelectorAll('[aria-label="Where you are"]')).toHaveLength(1);
    expect(crumbs.textContent).toContain('Sources');
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent).toBe('Example Market');
    expect(crumbs.textContent).toBe('Sources/Example Market');
    const logo = host.querySelector('img.sb-logo') as HTMLImageElement;
    expect(logo.getAttribute('src')).toBe('/source-logos/example_market.png');
    expect(logo.getAttribute('width')).toBe('64');
    expect(logo.getAttribute('height')).toBe('32');
  });

  it('draws a logo it can resolve from the name, and none when it cannot', async () => {
    // The kit's resolver is asked with the source's name and web address, and its answer is drawn.
    fixture.resolveLogo.mockImplementation((name: string | null, base: string | null) =>
      (name === 'Example Market' && base === 'https://market.example.test' ? '/source-logos/example_market.png' : null));
    answer(okRead({ source: { ...EXAMPLE, logo_url: null } }));
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('img.sb-logo')?.getAttribute('src')).toBe('/source-logos/example_market.png');
    answer(okRead({ source: { ...EXAMPLE, name: 'Plain Dealer', logo_url: null, base_url: 'https://plain.example.test' } }));
    await mount(<SourceBrowse source="plain_dealer" />);
    expect(host.querySelector('img.sb-logo')).toBeNull();
  });

  it('prefers the mark the registry sent over the one found from the name, and draws the next source\'s mark after one that would not load', async () => {
    fixture.resolveLogo.mockReturnValue('/source-logos/from_the_name.png');
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('img.sb-logo')?.getAttribute('src')).toBe('/source-logos/example_market.png');
    await act(async () => { host.querySelector('img.sb-logo')!.dispatchEvent(new Event('error')); });
    expect(host.querySelector('img.sb-logo')).toBeNull();
    answer(okRead({ source: { ...EXAMPLE, slug: 'second_market', name: 'Second Market', logo_url: null } }));
    await mount(<SourceBrowse source="second_market" />);
    expect(host.querySelector('img.sb-logo')?.getAttribute('src')).toBe('/source-logos/from_the_name.png');
  });

  it('filters the makes and keeps the denominator', async () => {
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Filter makes');
    await typeInto(host.querySelector('input') as HTMLInputElement, 'por');
    expect(hrefs().filter(h => h?.includes('&make='))).toEqual(['/browse?source=example_market&make=Porsche']);
    expect(text()).toContain('1 of 3 makes matching “por”');
    const section = host.querySelector('section[aria-label="Makes"]')!;
    expect(section.textContent).toContain('1,203 of 19,518 listings');
    await typeInto(host.querySelector('input') as HTMLInputElement, 'zzz');
    expect(text()).toContain('No make matches “zzz”.');
  });

  it('says it plainly when the species is an auction: lots, never asking, and no price summary', async () => {
    answer(okRead({
      source: AUCTION,
      holdings: { ...HOLDINGS, episodes: 8200, shown_n: 8000, shown_median: 42000, makes: 2 },
      makes: [{ make: 'Porsche', ...tally({ episodes: 600, shown_n: 590, shown_median: 61000, sold: 310, year_min: 1964, year_max: 2022 }), top_models: [] }],
    }));
    await mount(<SourceBrowse source="timed_house" />);
    expect(text()).toContain('lots held');
    expect(text()).toContain('of 8,200 lots');
    expect(text()).not.toMatch(/asking|median|\$61,000|\$42,000/i);
    expect(host.querySelector('[role="group"][aria-label="Median high bid"]')).toBeNull();
    // Timed House is an auction: the hover carries the species, the line carries the category.
    expect(host.querySelector('[title="Timed with soft close"]')?.textContent).toBe('Auction');
    expect(text()).toContain('source total unknown');
  });

  it('never says sold for a zero count, and shows no median when the reader sent one under the floor', async () => {
    answer(okRead({
      holdings: { ...HOLDINGS, episodes: 5, vehicles: 5, active: 5, sold: 0, ended: 0, sold_n: 0, sold_median: null, shown_n: 3, shown_median: 15000, makes: 1, models: 1, with_image: 5 },
      makes: [{ make: 'Ford', ...tally({ episodes: 5, vehicles: 5, active: 5, shown_n: 3, with_image: 5, year_min: 1966, year_max: 1966 }), top_models: [{ model: 'Mustang', episodes: 5 }] }],
    }));
    await mount(<SourceBrowse source="example_market" />);
    expect(text()).not.toMatch(/sold/i);
    expect(text()).not.toMatch(/priced|median/i);
    expect(text()).not.toContain('$15,000');
    expect(host.querySelector('[role="group"][aria-label="Median asking"]')).toBeNull();
    expect(text()).toContain('1966');
  });
});

describe('what this source carries', () => {
  // A marketplace of 7,896 listings: counts of one reading, each status a share of the whole.
  const MARKET = {
    ...HOLDINGS, episodes: 7896, vehicles: 7788, active: 120, upcoming: 14, sold: 2405, ended: 5350, unknown: 7, with_image: 7013,
    makes: 213, models: 1640, year_min: 1924, year_max: 2026,
  };

  it('counts every status the source carries as n of all its listings, in order, and leaves out a status with none', async () => {
    answer(okRead({ holdings: MARKET }));
    await mount(<SourceBrowse source="example_market" />);
    expect(blockLabels()).toEqual(['Sold', 'Live at last check', 'Upcoming', 'Ended', 'Status not recorded', 'With photos', 'Makes', 'Models']);
    const block = (label: string) => host.querySelector(`[role="group"][aria-label="${label}"]`)?.textContent;
    // Every block is n of all and says which day's count it is: a block read at the daily count is not "now".
    expect(block('Sold')).toBe('Sold2,405' + '2,405 of 7,896 listings · Oct 20, 2026');
    expect(block('Live at last check')).toContain('120 of 7,896 listings · Oct 20, 2026');
    expect(block('Upcoming')).toContain('14 of 7,896 listings · Oct 20, 2026');
    expect(block('Ended')).toContain('5,350 of 7,896 listings · Oct 20, 2026');
    expect(block('Status not recorded')).toContain('7 of 7,896 listings · Oct 20, 2026');
    expect(block('With photos')).toContain('7,013 of 7,788 vehicles · Oct 20, 2026');
    expect(block('Makes')).toBe('Makes213');
    expect(block('Models')).toBe('Models1,640');
    answer(okRead({ source: { ...EXAMPLE, slug: 'quiet_market' }, holdings: { ...MARKET, upcoming: 0, unknown: 0, ended: 0, sold: 0 } }));
    await mount(<SourceBrowse source="quiet_market" />);
    expect(blockLabels()).toEqual(['Live at last check', 'With photos', 'Makes', 'Models']);
  });

  it('agrees the noun when the source holds one listing', async () => {
    answer(okRead({ holdings: { ...HOLDINGS, ...tally({ episodes: 1, vehicles: 1, sold: 1, with_image: 1 }), makes: 1, models: 1 } }));
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('[role="group"][aria-label="Sold"]')?.textContent).toContain('1 of 1 listing');
    expect(host.querySelector('[role="group"][aria-label="Sold"]')?.textContent).not.toContain('listings');
  });

  it('says when the listings are dated, how many were read from saved copies of the source\'s pages, and when Nuke recorded them', async () => {
    answer(okRead({
      holdings: { ...MARKET, archived: 6400, dated_min: '2005-03-14T10:00:00+00:00', dated_max: '2026-10-19T18:00:00+00:00' },
    }));
    await mount(<SourceBrowse source="example_market" />);
    const line = host.querySelector('.sb-history')!;
    expect(line.textContent).toBe(
      "Listings dated 2005–2026 · model years 1924–2026 · 6,400 of 7,896 listings read from saved copies of the source's pages · first recorded Sep 2, 2026 · last recorded Oct 20, 2026");
    // The saved copies and the recording days each say what they are; the dated span and model years need no hover.
    expect(titled('Pages the source no longer serves, read from an internet archive')?.textContent).toBe("6,400 of 7,896 listings read from saved copies of the source's pages");
    const recorded = [...host.querySelectorAll('[title="The days Nuke recorded these listings. The listings themselves can be older."]')];
    expect(recorded.map(e => e.textContent)).toEqual(['first recorded Sep 2, 2026', 'last recorded Oct 20, 2026']);
    expect(line.querySelector('[title]')?.textContent).toBe("6,400 of 7,896 listings read from saved copies of the source's pages");
    // One saved copy is a copy, of one page.
    answer(okRead({ source: { ...EXAMPLE, slug: 'one_copy' }, holdings: { ...MARKET, archived: 1 } }));
    await mount(<SourceBrowse source="one_copy" />);
    expect(host.querySelector('.sb-history')?.textContent).toContain("1 of 7,896 listings read from a saved copy of the source's page");
  });

  it('prints one year when the listings are dated within one, and leaves out every part it does not know', async () => {
    answer(okRead({ holdings: { ...MARKET, dated_min: '2026-01-02T10:00:00+00:00', dated_max: '2026-10-19T18:00:00+00:00' } }));
    await mount(<SourceBrowse source="one_year" />);
    expect(host.querySelector('.sb-history')?.textContent).toMatch(/^Listings dated 2026 · model years 1924–2026 · first recorded/);
    expect(text()).not.toContain('saved copies');
    answer(okRead({
      source: { ...EXAMPLE, slug: 'sparse' },
      holdings: { ...MARKET, year_min: null, year_max: null, dated_min: '2005-03-14T10:00:00+00:00', dated_max: null, first_seen: null, last_seen: '2026-10-20T05:00:00+00:00' },
    }));
    await mount(<SourceBrowse source="sparse" />);
    // One end of the span alone says nothing about when the listings ran, so neither end is printed; the first part takes the capital.
    expect(host.querySelector('.sb-history')?.textContent).toBe('Last recorded Oct 20, 2026');
    answer(okRead({ source: { ...EXAMPLE, slug: 'bare' }, holdings: { ...MARKET, year_min: null, year_max: null, first_seen: null, last_seen: null } }));
    await mount(<SourceBrowse source="bare" />);
    expect(host.querySelector('.sb-history')).toBeNull();
  });
});

// MARK: - The Sources board beside the count

describe('the Sources board', () => {
  const MARKET_BOARD = { ...HOLDINGS, episodes: 7896, vehicles: 7788, active: 120, sold: 2405, ended: 5371, makes: 213, models: 1640, board: BOARD };
  const BOARD_NOTE = "The board counts the source's lots matched to Nuke's collection list. This page counts every listing the source put on a public vehicle with a make and a model.";

  it('sits as one caption under the count of a source that has one, and says what each counts', async () => {
    answer(okRead({ holdings: MARKET_BOARD }));
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('.k-figure')?.textContent).toBe('7,896');
    const caption = titled(BOARD_NOTE);
    // The board's figure is in the species' noun, and the list it matched against is Nuke's, not the source's.
    expect(caption?.textContent).toBe("Sources board counts 3,575 listings matched to Nuke's own list · Oct 20, 2026");
    expect(text()).not.toContain('target list');
    // Two counts of two things, never one number: the board's figure is not the page's.
    expect(host.querySelector('.k-figure')?.textContent).not.toContain('3,575');
    expect(text()).toContain('listings held');
    expect(text()).not.toContain('board count ·');
    expect(text()).toContain('source total unknown');
  });

  it('leaves the caption out when the reader has no board count for the source', async () => {
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    expect(text()).not.toContain('Sources board');
    expect(titled(BOARD_NOTE)).toBeUndefined();
  });

  it('says the source\'s own total with how it was measured, how sure that is and when, and never a bare percent', async () => {
    const withBoard = (over: Record<string, unknown>, source: string) => {
      answer(okRead({ source: { ...EXAMPLE, slug: source }, holdings: { ...MARKET_BOARD, board: { ...BOARD, ...over } } }));
      return mount(<SourceBrowse source={source} />);
    };
    const result = () => host.querySelector('.k-masthead__result')?.textContent ?? '';
    // A percent is the confidence in the total, so it is never printed without that word; it is not the share held.
    const noBarePercent = () => expect(text()).not.toMatch(/\d%(?! confidence)/);
    // A count says where it came from.
    await withBoard({ population: 270391, population_method: 'search_index', population_confidence: 0.95, population_at: '2026-10-17T21:30:01+00:00' }, 'all_parts');
    expect(text()).toContain('of 270,391 the source lists · from its search results · 95% confidence · Oct 17, 2026');
    expect(text()).not.toContain('source total unknown');
    expect(text()).not.toContain('_');
    noBarePercent();
    // An estimate says it is one, and that it is not a count: never "the source lists".
    await withBoard({ population: 56004, population_method: 'bounded', population_confidence: 0.7, population_at: null }, 'no_day');
    expect(result()).toContain('an estimate of 56,004 (somewhere within a range, not a count) · 70% confidence');
    expect(result()).not.toContain('the source lists');
    expect(result()).not.toContain('Oct 17');
    noBarePercent();
    await withBoard({ population: 80000, population_method: 'owner_reference', population_confidence: 0.4, population_at: '2026-10-17T18:00:00+00:00' }, 'reference');
    expect(result()).toContain('an estimate of 80,000 (a reference figure, not a count) · 40% confidence · Oct 17, 2026');
    expect(result()).not.toMatch(/owner|the source lists/);
    noBarePercent();
    // A method this page has no words for, or none, is not printed, and its total is not worded as a count.
    await withBoard({ population: 9600, population_method: null, population_confidence: 0.875, population_at: '2026-10-17T18:00:00+00:00' }, 'no_method');
    expect(result()).toContain('a total of 9,600, unknown whether counted or estimated · 88% confidence · Oct 17, 2026');
    expect(result()).not.toContain('the source lists');
    await withBoard({ population: 9600, population_method: 'mystery_count', population_confidence: 0.5, population_at: null }, 'odd_method');
    expect(result()).toContain('a total of 9,600, unknown whether counted or estimated · 50% confidence');
    expect(result()).not.toMatch(/mystery/i);
    await withBoard({ population: 34101, population_method: 'enumerated', population_confidence: null, population_at: '2026-10-17T18:00:00+00:00' }, 'no_sure');
    expect(result()).toContain('of 34,101 the source lists · counted from its own listings · Oct 17, 2026');
    expect(result()).not.toContain('confidence');
    await withBoard({ population: 12000, population_method: null, population_confidence: null, population_at: null }, 'total_only');
    expect(result()).toContain('a total of 12,000, unknown whether counted or estimated');
    expect(result()).not.toMatch(/unknown whether counted or estimated ·/);
    // No total on the board: the line says it is not known, once.
    await withBoard({ population: null, population_method: 'enumerated', population_confidence: 0.9, population_at: '2026-10-17T18:00:00+00:00' }, 'no_total');
    expect(result()).toContain('source total unknown');
    expect(result()).not.toContain('the source lists');
    expect(result()).not.toContain('counted from');
    // The hover says the percent is a confidence and that an estimate is not a count.
    await withBoard({ population: 80000, population_method: 'owner_reference', population_confidence: 0.4, population_at: '2026-10-17T18:00:00+00:00' }, 'hover');
    expect(host.querySelector('.k-masthead__result [title*="confidence"]')?.getAttribute('title')).toContain('An estimate is not a count.');
  });

  it('shows the board\'s figure and says there is nothing to browse when no listing is on a public vehicle yet', async () => {
    // Rows can arrive for a source whose listings are on no public vehicle; the page does not count them beside the board's figure.
    answer(okRead({ holdings: { ...EMPTY, landed_24h: 25, board: BOARD }, makes: [] }));
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('.k-figure')?.textContent).toBe('3,575');
    expect(host.querySelector('.k-masthead__result')?.textContent).toBe(
      'listings on the Sources board3,575board count · Oct 20, 2026source total unknown');
    expect(titled(BOARD_NOTE)?.textContent).toBe('board count · Oct 20, 2026');
    // Said of what the read knows: nothing recorded under this name is on a public vehicle. It does not say the lots are on none.
    expect(text()).toContain('No listing recorded under this name is on a public vehicle with a make and a model, so there is nothing to browse here.');
    expect(text()).not.toMatch(/None is on|yet, so/);
    expect(text()).not.toContain('listings held');
    expect(text()).not.toContain('counted');
    expect(text()).not.toContain('Sources board counts');
    expect(text()).not.toContain('recorded from this source');
    expect(text()).not.toContain('No vehicles are recorded');
    // Nothing to filter, nothing to open: the way back is the trail.
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('.sb-grid')).toBeNull();
    expect(host.querySelector('.sb-body')).toBeNull();
    expect(hrefs()).toContain('/sources');
  });

  it('counts the board\'s figure in the species\' own noun, with the source\'s total beside it when one is known', async () => {
    answer(okRead({
      source: AUCTION,
      holdings: { ...EMPTY, board: { ...BOARD, lots: 1, population: 4200, population_method: 'enumerated', population_confidence: 0.98, population_at: '2026-10-17T21:30:00+00:00' } },
      makes: [],
    }));
    await mount(<SourceBrowse source="timed_house" />);
    expect(host.querySelector('.k-masthead__result')?.textContent).toBe(
      'lot on the Sources board1board count · Oct 20, 2026of 4,200 the source lists · counted from its own listings · 98% confidence · Oct 17, 2026');
    answer(okRead({ source: { ...AUCTION, slug: 'timed_two', name: 'Timed Two' }, holdings: { ...EMPTY, board: { ...BOARD, lots: 77 } }, makes: [] }));
    await mount(<SourceBrowse source="timed_two" />);
    expect(host.querySelector('.k-masthead__result')?.textContent).toContain('lots on the Sources board77');
  });

  it('says the board\'s day is unknown rather than inventing one', async () => {
    answer(okRead({ holdings: { ...EMPTY, board: { ...BOARD, day: null } }, makes: [] }));
    await mount(<SourceBrowse source="no_day_only" />);
    expect(text()).toContain('board count · unknown date');
    answer(okRead({ source: { ...EXAMPLE, slug: 'no_day_counted' }, holdings: { ...HOLDINGS, board: { ...BOARD, day: 'yesterday' } } }));
    await mount(<SourceBrowse source="no_day_counted" />);
    expect(text()).toContain("Sources board counts 3,575 listings matched to Nuke's own list · unknown date");
  });

  it('keeps the plain empty state for a registered source the board has no count for', async () => {
    answer(okRead({ holdings: EMPTY, makes: [] }));
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('.k-figure')?.textContent).toBe('0');
    expect(text()).toContain('listings held');
    expect(text()).toContain('No vehicles are recorded for this source yet.');
    expect(text()).not.toContain('nothing to browse');
    expect(text()).not.toContain('Sources board');
  });
});

describe('words on the face', () => {
  it('words the last 24 hours as a count of its own, whether it is under, at or over the held figure, and says nothing for none', async () => {
    const said = (n: number, noun = 'listings') => `${n.toLocaleString('en-US')} ${noun} recorded from this source in the last 24 hours, whether or not they are counted above`;
    for (const [slug, n] of [['busy_one', 25000], ['same_one', 19518], ['some_one', 412]] as const) {
      answer(okRead({ holdings: { ...HOLDINGS, landed_24h: n } }));
      await mount(<SourceBrowse source={slug} />);
      expect(text(), slug).toContain(said(n));
      expect(text(), slug).not.toMatch(/of these|arrived/);
    }
    answer(okRead({ holdings: { ...HOLDINGS, landed_24h: 1 } }));
    await mount(<SourceBrowse source="one_one" />);
    expect(text()).toContain('1 listing recorded from this source in the last 24 hours');
    answer(okRead({ holdings: { ...HOLDINGS, landed_24h: 0 } }));
    await mount(<SourceBrowse source="quiet_one" />);
    expect(text()).not.toContain('recorded from this source');
    // In the species' own noun.
    answer(okRead({ source: AUCTION, holdings: { ...HOLDINGS, landed_24h: 30 } }));
    await mount(<SourceBrowse source="timed_house" />);
    expect(text()).toContain(said(30, 'lots'));
  });

  it('writes a category with an underscore as words, and no kind line when there is none', async () => {
    answer(okRead({ source: { ...EXAMPLE, slug: 'social_one', category: 'social_media', species_label: null } }));
    await mount(<SourceBrowse source="social_one" />);
    expect(host.querySelector('h1')?.parentElement?.textContent).toBe('Example MarketSocial media');
    answer(okRead({ source: { ...EXAMPLE, slug: 'bare_one', category: null } }));
    await mount(<SourceBrowse source="bare_one" />);
    expect(host.querySelector('h1')?.parentElement?.textContent).toBe('Example Market');
  });

  it('says the count date is unknown rather than inventing one', async () => {
    answer(okRead({ holdings: { ...HOLDINGS, folded_at: null } }));
    await mount(<SourceBrowse source="example_market" />);
    expect(text()).toContain('count date unknown');
    expect(text()).not.toMatch(/fold/i);
    // With no count date there is no date to put beside a block, and none is made up.
    expect(host.querySelector('[role="group"][aria-label="Ended"]')?.textContent).toBe('Ended12,12612,126 of 19,518 listings');
  });

  it('names the recording days as recording days, with a hover that says the listings can be older', async () => {
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    const line = [...host.querySelectorAll('[title]')].find(e => /first recorded/.test(e.textContent ?? ''));
    expect(line?.getAttribute('title')).toBe('The days Nuke recorded these listings. The listings themselves can be older.');
  });

  it('keeps a real fraction in the trail below the first level', async () => {
    answer(okRead({
      level: 'models', scope: { make: 'Porsche', model: null, status: null }, makes: [],
      models: [{ model: '911', ...tally({ episodes: 412 }) }],
    }));
    await mount(<SourceBrowse source="example_market" make="Porsche" />);
    expect(host.querySelector('[aria-label="Where you are"]')?.textContent).toContain('412 of 19,518 listings · Oct 20, 2026');
  });

  it('uses no pipeline word and shows no median in any state of the page', async () => {
    const market = { ...HOLDINGS, upcoming: 14, unknown: 7, archived: 6400, dated_min: '2005-03-14T10:00:00+00:00', dated_max: '2026-10-19T18:00:00+00:00',
      board: { ...BOARD, population: 270391, population_method: 'search_index', population_confidence: 0.95, population_at: '2026-10-17T21:30:01+00:00' } };
    const states: Array<[string, { make?: string; model?: string }, unknown]> = [
      ['counted', {}, okRead({ holdings: market })],
      ['board_only', {}, okRead({ holdings: { ...EMPTY, board: BOARD }, makes: [] })],
      ['not_counted', {}, okRead({ status: 'not_folded', holdings: {}, makes: [] })],
      ['nothing', {}, { as_of: '2026-10-20T12:00:00+00:00', status: 'unknown_source', source: { slug: 'nothing' } }],
      ['models', { make: 'Porsche' }, okRead({ holdings: market, level: 'models', scope: { make: 'Porsche', model: null, status: null }, makes: [], models: [{ model: '911', ...tally({ episodes: 412, sold: 90 }) }] })],
      ['listings', { make: 'Chevrolet', model: 'Camaro' }, listingsRead([
        row(id(1), { status: 'upcoming', status_raw: 'upcoming', listed_at: '2026-11-14T17:00:00+00:00', shown_price: null, price_kind: null, bids: null }),
        row(id(2), { status: 'ended', status_raw: 'bid-goes-on', archive_url: 'https://archive.example.test/web/1' }),
        row(id(3), { status: 'unknown', status_raw: null }),
        row(id(4), { status: 'sold', status_raw: 'sold', sold_price: 41500 }),
      ], 4, 1, { holdings: market })],
    ];
    for (const [slug, scope, data] of states) {
      answer(data);
      await mount(<SourceBrowse source={slug} {...scope} />);
      const hovers = [...host.querySelectorAll('[title],[aria-label],[alt]')].flatMap(e => [e.getAttribute('title'), e.getAttribute('aria-label'), e.getAttribute('alt')]).filter(Boolean);
      const face = `${text()} ${hovers.join(' ')}`;
      expect(face, slug).not.toMatch(/\b(?:fold|folded|landed|matview|episodes?)\b/i);
      expect(face, slug).not.toMatch(/median/i);
      // No internal name: not the board's target list, the name of a method, nor a third word for recording.
      expect(face, slug).not.toMatch(/target list|enumerated|owner reference|search index|\bbounded\b|\barrived\b/i);
      expect(text().length, slug).toBeGreaterThan(20);
    }
  });
});

describe('the page around the read', () => {
  it('names the tab for the source and scope, and gives the old title back', async () => {
    document.title = 'Nuke';
    answer(okRead());
    await mount(<SourceBrowse source="example_market" make="Porsche" />);
    expect(document.title).toBe('Porsche · Example Market | Nuke');
    await act(async () => root.unmount());
    expect(document.title).toBe('Nuke');
  });

  it('opens a new scope at the top of the page, and leaves a page that is already there alone', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, configurable: true });
    const at = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    answer(okRead());
    at(0);
    await mount(<SourceBrowse source="example_market" />);
    expect(scrollTo).not.toHaveBeenCalled();
    at(640);
    await mount(<SourceBrowse source="example_market" make="Porsche" />);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    at(0);
  });
});

// MARK: - A source that is not ready, or not there

describe('states', () => {
  it('says the source is not counted yet and keeps the identity, with no figure and no clock time', async () => {
    answer(okRead({ status: 'not_folded', holdings: {}, makes: [] }));
    await mount(<SourceBrowse source="example_market" />);
    expect(text()).toContain("Nuke has not counted this source's listings yet. It counts once a day.");
    expect(text()).not.toMatch(/fold|PT\b|tonight|\d\d:\d\d/);
    expect(host.querySelector('h1')?.textContent).toBe('Example Market');
    expect(host.querySelector('.k-figure')).toBeNull();
    expect(host.querySelector('.sb-grid')).toBeNull();
    answer(okRead({ source: AUCTION, status: 'not_folded', holdings: {}, makes: [] }));
    await mount(<SourceBrowse source="timed_house" />);
    expect(text()).toContain("Nuke has not counted this source's lots yet. It counts once a day.");
  });

  it('says there is nothing to browse for a slug that is not a market source, and names only what was asked for', async () => {
    answer({ as_of: '2026-10-20T12:00:00+00:00', status: 'unknown_source', source: { slug: 'nope', name: 'nope' } });
    await mount(<SourceBrowse source="nope" />);
    expect(host.querySelector('h1')?.textContent).toBe('Nothing to browse');
    expect(text()).toContain('Only market sources have a browse page: auction houses, dealers, classifieds, marketplaces and aggregators. Nothing is published under nope.');
    expect(text()).not.toMatch(/Unknown source|registered/);
    const way = host.querySelector('a[href="/sources"]');
    expect(way?.textContent).toBe('All sources');
    expect(host.querySelector('.k-figure')).toBeNull();
    expect(host.querySelector('.sb-grid')).toBeNull();
    // A reader that sent nothing at all reads the same way, with the slug that was asked for.
    answer(null);
    await mount(<SourceBrowse source="nothing_sent" />);
    expect(text()).toContain('Nothing is published under nothing_sent.');
  });

  it('says what it is doing while it reads, never with the slug, and that it failed when it fails', async () => {
    let fail!: (e: unknown) => void;
    fixture.rpc.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Reading…');
    expect(text()).not.toContain('example_market');
    await act(async () => fail(new Error('boom')));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Source holdings could not be read.');
    // A read that comes back as an error object fails the same way, and Try again reads once more.
    fixture.rpc.mockReset();
    answer(okRead());
    await act(async () => buttonNamed(/try again/i)!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('.k-figure')?.textContent).toBe('19,518');
  });

  it('names the source in the loading line only once an earlier read has', async () => {
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    // The status region is there for the page's life and empty when nothing is being read.
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
    // Going one level down reads again; the earlier read named the source, so the line may.
    fixture.rpc.mockReset();
    fixture.rpc.mockReturnValue(new Promise(() => {}));
    await mount(<SourceBrowse source="example_market" make="Porsche" />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Reading Example Market…');
    expect(host.querySelector('h1')?.textContent).toBe('Example Market');
    // Another source has no earlier read to name it.
    await mount(<SourceBrowse source="timed_house" />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Reading…');
    expect(text()).not.toContain('timed_house');
  });

  it('never names an unknown source by the slug it was asked for in the loading line', async () => {
    answer({ as_of: '2026-10-20T12:00:00+00:00', status: 'unknown_source', source: { slug: 'nope', name: 'nope' } });
    await mount(<SourceBrowse source="nope" />);
    fixture.rpc.mockReset();
    fixture.rpc.mockReturnValue(new Promise(() => {}));
    await mount(<SourceBrowse source="nope" make="Porsche" />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Reading…');
  });

  it('treats an rpc error as a failed read', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await mount(<SourceBrowse source="example_market" />);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Source holdings could not be read.');
  });

  it('keeps the newest request: an older answer that lands late is dropped', async () => {
    const waiting: Record<string, (v: unknown) => void> = {};
    fixture.rpc.mockImplementation((_fn: string, args: { p_source: string }) => new Promise(resolve => { waiting[args.p_source] = resolve; }));
    await mount(<SourceBrowse source="slow_one" />);
    await mount(<SourceBrowse source="fast_one" />);
    await act(async () => waiting.fast_one({ data: okRead({ source: { ...EXAMPLE, slug: 'fast_one', name: 'Fast One' } }), error: null }));
    expect(host.querySelector('h1')?.textContent).toBe('Fast One');
    await act(async () => waiting.slow_one({ data: okRead({ source: { ...EXAMPLE, slug: 'slow_one', name: 'Slow One' } }), error: null }));
    expect(host.querySelector('h1')?.textContent).toBe('Fast One');
  });

  it('does nothing when an answer lands after the page is gone', async () => {
    let land!: (v: unknown) => void;
    fixture.rpc.mockReturnValue(new Promise(resolve => { land = resolve; }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(<SourceBrowse source="example_market" />);
    await act(async () => root.unmount());
    await act(async () => land({ data: okRead(), error: null }));
    expect(errors).not.toHaveBeenCalled();
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
});

// MARK: - Models and listings

describe('models level', () => {
  it('lists the make\'s models with the way back, and counts them in the source\'s own unit', async () => {
    answer(okRead({
      level: 'models', scope: { make: 'Porsche', model: null, status: null }, makes: [],
      models: [
        { model: '911', ...tally({ episodes: 412, shown_n: 400, shown_median: 52000, sold: 90, year_min: 1965, year_max: 2023 }) },
        { model: 'Cayman', ...tally({ episodes: 120, shown_n: 3, sold: 0, year_min: 2006, year_max: 2022 }) },
      ],
    }));
    await mount(<SourceBrowse source="example_market" make="Porsche" />);
    expect(fixture.rpc).toHaveBeenCalledWith('browse_source_read', expect.objectContaining({ p_source: 'example_market', p_make: 'Porsche', p_model: null }));
    expect(text()).toContain('2 models · 532 listings');
    expect(hrefs()).toContain('/browse?source=example_market');
    expect(hrefs()).toContain('/browse?source=example_market&make=Porsche&model=911');
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Porsche');
    expect(host.querySelector('[aria-label="Where you are"]')?.textContent).toContain('532 of 19,518 listings · Oct 20, 2026');
    const cayman = link('/browse?source=example_market&make=Porsche&model=Cayman');
    expect(cayman.textContent).not.toMatch(/priced|median/i);
    expect(cayman.textContent).not.toMatch(/sold/i);
    expect(text()).not.toMatch(/\$52,000/);
  });
});

describe('listings level', () => {
  it('shows a card per listing with its price in the source\'s words, its status, and a link to the vehicle', async () => {
    answer(listingsRead([
      row('11111111-1111-4111-8111-111111111111'),
      row('22222222-2222-4222-8222-222222222222', {
        year: 1970, status: 'sold', status_raw: 'sold', sold_price: 41500, shown_price: 41500, price_kind: 'buy_it_now', bids: 0,
        image_url: null, listing_url: 'javascript:alert(1)', location: null,
      }),
    ], 2));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    expect(fixture.rpc).toHaveBeenCalledWith('browse_source_read',
      { p_source: 'example_market', p_make: 'Chevrolet', p_model: 'Camaro', p_page: 1, p_page_size: 60, p_sort: 'newest' });
    expect(cards()).toHaveLength(2);
    expect(cards()[0].textContent).toContain('1969 Chevrolet Camaro');
    // A bid on a listing that is over is its last bid.
    expect(cards()[0].textContent).toContain('Last bid $4,050 · 6 bids');
    expect(cards()[0].textContent).toContain('Ended · Reno, NV');
    expect(cards()[0].textContent).toContain('Listed Sep 28, 2026 · Ended Oct 5, 2026');
    expect(cards()[0].querySelector('a[href="/vehicle/11111111-1111-4111-8111-111111111111"]')).not.toBeNull();
    const photo = cards()[0].querySelector('img.sb-card__photo') as HTMLImageElement;
    // The title beside the photo names the card; the photo has no words of its own.
    expect(photo.getAttribute('alt')).toBe('');
    expect(photo.getAttribute('width')).toBe('240');
    expect(photo.getAttribute('loading')).toBe('lazy');
    const open = cards()[0].querySelector('a[href="https://listings.example.test/itm/1"]')!;
    expect(open.getAttribute('rel')).toContain('noreferrer');
    expect(open.textContent).toBe('Open the listing');
    // A sold listing says what it sold for; one with no photo says so; an address that is not a web link is not a link.
    expect(cards()[1].textContent).toContain('Sold $41,500');
    expect(cards()[1].textContent).not.toMatch(/Sold.*Sold/);
    expect(cards()[1].textContent).toContain('no photo');
    expect(cards()[1].querySelector('img')).toBeNull();
    expect(cards()[1].querySelector('a[href^="javascript"]')).toBeNull();
    expect(text()).toContain('showing 2 of 2');
    expect(more()).toBeUndefined();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Camaro');
    await act(async () => (cards()[0].querySelector('a.sb-card__main') as HTMLAnchorElement).click());
    expect(fixture.recordView).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'browse');
  });

  it('says a bid price with the source\'s own word, or that the count was not recorded, and never a starting price as a bid', async () => {
    answer(listingsRead([
      row(id(1), { shown_price: 25000, bids: 0, price_label: 'Starting bid' }),
      row(id(2), { shown_price: 25000, bids: 0, price_label: null, status: 'active', status_raw: 'active' }),
      row(id(3), { shown_price: 7.99, bids: null, price_label: 'Starting bid' }),
      row(id(4), { shown_price: 25000, bids: 14, price_label: 'Current bid', status: 'active', status_raw: 'active' }),
      row(id(5), { shown_price: 12828, bids: 23, price_label: null }),
      row(id(6), { shown_price: 4050, bids: 0, price_label: null }),
    ], 6));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    expect(cards()[0].textContent).toContain('Starting bid $25,000');
    expect(cards()[0].textContent).not.toContain('bid count');
    // A bid with no count says the count was not recorded; it never says "a bid" and "no bids" together.
    expect(cards()[1].textContent).toContain('Bid shown $25,000 · bid count not recorded');
    expect(cards()[2].textContent).toContain('Starting bid $7.99');
    expect(cards()[3].textContent).toContain('Current bid $25,000 · 14 bids');
    // A bid on a listing that is over is its last bid, so it never reads like one still open.
    expect(cards()[4].textContent).toContain('Last bid $12,828 · 23 bids');
    expect(cards()[5].textContent).toContain('Last bid shown $4,050 · bid count not recorded');
    expect(text()).not.toContain('no bids recorded');
  });

  it('says each status in plain words, and the source\'s own word for how a listing ended', async () => {
    const at = (status: ListingStatus, status_raw: string | null, over: Record<string, unknown> = {}) => row(id(0), { status, status_raw, ...over });
    const rows = [
      at('active', 'active', { ends_at: '2026-10-25T17:00:00+00:00' }),
      at('sold', 'sold'),
      at('sold', 'sold', { sold_price: 41500 }),
      at('ended', 'ended'),
      at('ended', 'bid-goes-on'),
      at('ended', 'reserve_not_met'),
      at('ended', 'unsold'),
      at('ended', 'withdrawn'),
      at('ended', 'cancelled'),
      at('ended', 'expired'),
      at('ended', 'closed'),
      at('unknown', null),
    ].map((r, i) => ({ ...r, vehicle_id: id(100 + i), listing_url: `https://listings.example.test/itm/${100 + i}` }));
    answer(listingsRead(rows, rows.length));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    const where = cards().map(c => c.querySelector('.sb-clip')?.textContent ?? null);
    expect(where).toEqual([
      'Live · Reno, NV', 'Sold · Reno, NV',
      // The price line of a sale already says Sold, so the card does not say it twice.
      'Reno, NV',
      'Ended · Reno, NV', 'Bid goes on · Reno, NV', 'Reserve not met · Reno, NV', 'Unsold · Reno, NV', 'Withdrawn · Reno, NV',
      'Cancelled · Reno, NV', 'Expired · Reno, NV', 'Ended · Reno, NV', 'Status not recorded · Reno, NV',
    ]);
  });

  it('puts a lot still to come as Upcoming, with the day its sale starts', async () => {
    answer(listingsRead([
      row(id(1), {
        year: 1967, make: 'Porsche', model: '911', status: 'upcoming', status_raw: 'upcoming', shown_price: null, price_kind: null, bids: null,
        listed_at: '2026-11-14T17:00:00+00:00', ends_at: '2026-11-14T23:00:00+00:00', location: 'Monterey, CA',
      }),
    ], 1));
    await mount(<SourceBrowse source="timed_house" make="Chevrolet" model="Camaro" />);
    const t = cards()[0].textContent ?? '';
    expect(t).toContain('Upcoming · Monterey, CA');
    expect(t).toContain('Starts Nov 14, 2026 · Ends Nov 14, 2026');
    // The card says what it shows, not that no price exists: an ended lot can carry a final bid the reader does not send.
    expect(t).toContain('No price shown');
    expect(t).not.toContain('No price recorded');
    expect(t).not.toContain('Listed');
  });

  it('says Starts only for an upcoming lot whose date is ahead of the page\'s clock', async () => {
    answer(listingsRead([
      row(id(1), { status: 'upcoming', status_raw: 'upcoming', listed_at: '2026-10-01T17:00:00+00:00', ends_at: '2026-11-14T23:00:00+00:00' }),
      row(id(2), { status: 'active', status_raw: 'active', listed_at: '2026-11-14T17:00:00+00:00', ends_at: '2026-11-20T23:00:00+00:00' }),
      row(id(3), { status: 'upcoming', status_raw: 'upcoming', listed_at: null, recorded_at: '2026-10-20T03:00:00+00:00', ends_at: '2026-11-14T23:00:00+00:00' }),
      row(id(4), { status: 'upcoming', status_raw: 'upcoming', listed_at: '2026-10-20T12:00:00+00:00', ends_at: null }),
    ], 4));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    expect(cards()[0].textContent).toContain('Listed Oct 1, 2026 · Ends Nov 14, 2026');
    expect(cards()[0].textContent).not.toContain('Starts');
    expect(cards()[1].textContent).toContain('Listed Nov 14, 2026 · Ends Nov 20, 2026');
    expect(cards()[1].textContent).not.toContain('Starts');
    expect(cards()[2].textContent).toContain('First recorded Oct 20, 2026 · Ends Nov 14, 2026');
    // A start at the page's own instant is not ahead of it.
    expect(cards()[3].textContent).toContain('Listed Oct 20, 2026');
  });

  it('opens the saved page of a listing read from one, else the listing, else nothing', async () => {
    answer(listingsRead([
      row(id(1), { archive_url: 'https://archive.example.test/web/20120101/https://listings.example.test/itm/1' }),
      row(id(2), { archive_url: null }),
      row(id(3), { archive_url: 'https://archive.example.test/web/20120101/https://listings.example.test/itm/3', listing_url: null }),
      row(id(4), { archive_url: null, listing_url: null }),
      row(id(5), { archive_url: 'javascript:alert(1)', listing_url: 'https://listings.example.test/itm/5' }),
    ], 5));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    const open = (i: number) => [...cards()[i].querySelectorAll('a.sb-card__link')].map(a => [a.textContent, a.getAttribute('href'), a.getAttribute('rel'), a.getAttribute('target')]);
    // The saved copy wins: the live address is the one the source no longer serves, and only one link is offered.
    expect(open(0)).toEqual([['Open the saved page', 'https://archive.example.test/web/20120101/https://listings.example.test/itm/1', 'noreferrer noopener', '_blank']]);
    expect(open(1)).toEqual([['Open the listing', 'https://listings.example.test/itm/1', 'noreferrer noopener', '_blank']]);
    expect(open(2)).toEqual([['Open the saved page', 'https://archive.example.test/web/20120101/https://listings.example.test/itm/3', 'noreferrer noopener', '_blank']]);
    expect(open(3)).toEqual([]);
    // An address that is not a web link is not a link, and the listing's own is offered instead.
    expect(open(4)).toEqual([['Open the listing', 'https://listings.example.test/itm/5', 'noreferrer noopener', '_blank']]);
    expect(text()).not.toContain('javascript');
  });

  it('reads the next page on More and appends it, then stops when everything is shown', async () => {
    serve(3, 2, { 1: [row(id(1)), row(id(2))], 2: [row(id(2)), row(id(3))] });
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    expect(cards()).toHaveLength(2);
    expect(text()).toContain('showing 2 of 3');
    await clickMore();
    expect(fixture.rpc).toHaveBeenLastCalledWith('browse_source_read', expect.objectContaining({ p_page: 2, p_page_size: 60 }));
    // The row a shifted page boundary repeated is kept once.
    expect(cards()).toHaveLength(3);
    expect(text()).toContain('showing 3 of 3');
    expect(more()).toBeUndefined();
    expect(requested()).toEqual([1, 2]);
  });

  it('reads again from the first page when the order changes', async () => {
    answer(listingsRead([row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')], 1));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    const select = host.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent)).toEqual(['Newest', 'Price high', 'Price low', 'Year new', 'Year old']);
    await act(async () => { select.value = 'price_desc'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(fixture.rpc).toHaveBeenLastCalledWith('browse_source_read', expect.objectContaining({ p_sort: 'price_desc', p_page: 1 }));
    expect((host.querySelector('select') as HTMLSelectElement).value).toBe('price_desc');
  });

  it('says so when a failed next page could not be read, and keeps what it has and the button', async () => {
    fixture.rpc.mockImplementation((_fn: string, args: { p_page: number }) => (args.p_page === 1
      ? Promise.resolve({ data: listingsRead(rowsOf(1, 1), 2, 1, {}, 1), error: null })
      : Promise.reject(new Error('offline'))));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    await clickMore();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The next page could not be read.');
    expect(cards()).toHaveLength(1);
    expect(more()).toBeDefined();
  });

  it('says when a source holds none of a make and model', async () => {
    answer(listingsRead([], 0));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    expect(text()).toContain('This source holds no Chevrolet Camaro listings.');
    expect(text()).toContain('showing 0 of 0');
  });

  describe('More retires with the pages read', () => {
    it('a count of 120 read in pages of 60 that return 60, 59, then nothing: More is gone after page 2 and no third page is asked for', async () => {
      serve(120, 60, { 1: rowsOf(1, 60), 2: rowsOf(61, 59) });
      await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
      expect(cards()).toHaveLength(60);
      expect(text()).toContain('showing 60 of 120');
      expect(more()).toBeDefined();
      await clickMore();
      expect(cards()).toHaveLength(119);
      expect(text()).toContain('showing 119 of 120');
      expect(more()).toBeUndefined();
      expect(requested()).toEqual([1, 2]);
    });

    it('a count of 3 in pages of 2: page 1 returns 2 rows, page 2 returns none, and More is gone with the rows shown as the total', async () => {
      serve(3, 2, { 1: rowsOf(1, 2), 2: [] });
      await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
      expect(cards()).toHaveLength(2);
      expect(text()).toContain('showing 2 of 3');
      expect(more()).toBeDefined();
      await clickMore();
      expect(cards()).toHaveLength(2);
      expect(text()).toContain('showing 2 of 2');
      expect(more()).toBeUndefined();
      expect(requested()).toEqual([1, 2]);
    });

    it('an empty page part-way through a long count ends the paging and shows what was read as the total', async () => {
      serve(200, 60, { 1: rowsOf(1, 60), 2: [] });
      await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
      await clickMore();
      expect(text()).toContain('showing 60 of 60');
      expect(host.querySelector('[aria-label="Where you are"]')?.textContent).toContain('60 of 19,518 listings');
      expect(more()).toBeUndefined();
      expect(requested()).toEqual([1, 2]);
    });

    it('keeps More while the count has pages left: 120 of 150 shown after page 2', async () => {
      serve(150, 60, { 1: rowsOf(1, 60), 2: rowsOf(61, 60), 3: rowsOf(121, 30) });
      await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
      await clickMore();
      expect(text()).toContain('showing 120 of 150');
      expect(more()).toBeDefined();
      await clickMore();
      expect(text()).toContain('showing 150 of 150');
      expect(more()).toBeUndefined();
      expect(requested()).toEqual([1, 2, 3]);
    });

    it('a row a shifted page boundary repeats is kept once, and the rows landing on the total retire More', async () => {
      serve(3, 2, { 1: rowsOf(1, 2), 2: [rowsOf(1, 2)[1], rowsOf(3, 1)[0]] });
      await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
      await clickMore();
      expect(cards()).toHaveLength(3);
      expect(text()).toContain('showing 3 of 3');
      expect(more()).toBeUndefined();
    });

    it('shows no More when the first page already holds the count', async () => {
      serve(60, 60, { 1: rowsOf(1, 60) });
      await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
      expect(text()).toContain('showing 60 of 60');
      expect(more()).toBeUndefined();
      expect(requested()).toEqual([1]);
    });
  });

  describe('the card says what its clock is', () => {
    const cardText = async (r: Record<string, unknown>) => {
      answer(listingsRead([r], 1));
      await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
      return cards()[0].textContent ?? '';
    };

    it('prints Listed from the seller\'s own date', async () => {
      const t = await cardText(row(id(1), { recorded_at: '2026-10-20T03:00:00+00:00' }));
      expect(t).toContain('Listed Sep 28, 2026 · Ended Oct 5, 2026');
      expect(t).not.toContain('First recorded');
    });

    it('with no listed date prints First recorded from the recorded day, with the end beside it', async () => {
      const t = await cardText(row(id(1), { listed_at: null, recorded_at: '2026-10-20T03:00:00+00:00' }));
      expect(t).toContain('First recorded Oct 20, 2026 · Ended Oct 5, 2026');
      expect(t).not.toContain('Listed');
    });

    it('takes the recorded day from first_seen_at when that is the key the reader sent', async () => {
      const r = row(id(1), { listed_at: null, recorded_at: undefined, first_seen_at: '2026-10-19T03:00:00+00:00' });
      const t = await cardText(r);
      expect(t).toContain('First recorded Oct 19, 2026');
    });

    it('a live listing with no listed date and no end says when it was first recorded and when it was last checked', async () => {
      const t = await cardText(row(id(1), { listed_at: null, ends_at: null, status: 'active', status_raw: 'active', recorded_at: '2026-10-20T03:00:00+00:00', checked_at: '2026-10-18T07:54:00+00:00' }));
      expect(t).toContain('Live');
      expect(t).toContain('First recorded Oct 20, 2026 · last checked Oct 18, 2026');
      expect(t).not.toContain('Listed');
      expect(t).not.toMatch(/Ended|Ends/);
      // Without the check day the card says only when it was first recorded; with an end clock the end says it, and a listing
      // that is over never says it was checked. Each case is its own model, so each is a fresh read.
      const cardTextOf = async (r: Record<string, unknown>, model: string) => {
        answer(listingsRead([r], 1, 1, { scope: { make: 'Chevrolet', model, status: null } }));
        await mount(<SourceBrowse source="example_market" make="Chevrolet" model={model} />);
        return cards()[0].textContent ?? '';
      };
      const v = await cardTextOf(row(id(1), { listed_at: null, ends_at: null, status: 'active', status_raw: 'active', recorded_at: '2026-10-20T03:00:00+00:00', checked_at: null }), 'Nova');
      expect(v).toContain('First recorded Oct 20, 2026');
      expect(v).not.toContain('last checked');
      const u = await cardTextOf(row(id(2), { listed_at: null, status: 'active', status_raw: 'active', recorded_at: '2026-10-20T03:00:00+00:00', ends_at: '2026-11-20T23:00:00+00:00', checked_at: '2026-10-18T07:54:00+00:00' }), 'Chevelle');
      expect(u).toContain('First recorded Oct 20, 2026 · Ends Nov 20, 2026');
      expect(u).not.toContain('last checked');
      const w = await cardTextOf(row(id(3), { ends_at: null, checked_at: '2026-10-18T07:54:00+00:00' }), 'Impala');
      expect(w).not.toContain('last checked');
    });

    it('with neither clock prints no Listed and no First recorded', async () => {
      const t = await cardText(row(id(1), { listed_at: null, recorded_at: null, first_seen_at: null }));
      expect(t).not.toContain('Listed');
      expect(t).not.toContain('First recorded');
      expect(t).toContain('Ended Oct 5, 2026');
    });

    it('an end still ahead of the page\'s clock is Ends, and one behind it is Ended', async () => {
      const ahead = await cardText(row(id(1), { status: 'active', status_raw: 'active', ends_at: '2026-10-25T17:00:00+00:00' }));
      expect(ahead).toContain('Ends Oct 25, 2026');
      expect(ahead).not.toContain('Ended');
    });
  });
});

// MARK: - Focus, busy and names: what a keyboard and a screen reader meet

describe('the order of the listings', () => {
  const select = () => host.querySelector('select') as HTMLSelectElement;
  const choose = (value: string) => act(async () => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })); });
  /** The reader as it answers by order: the newest at once, every other order when the test lands it. */
  const hold = () => {
    const waiting: Array<{ sort: string; land: (rows: unknown[], total: number) => void; fail: () => void }> = [];
    fixture.rpc.mockImplementation((_fn: string, args: { p_sort: string }) => (args.p_sort === 'newest'
      ? Promise.resolve({ data: listingsRead([row(id(1))], 1), error: null })
      : new Promise((resolve, reject) => waiting.push({
        sort: args.p_sort,
        land: (rows, total) => resolve({ data: listingsRead(rows, total), error: null }),
        fail: () => reject(new Error('offline')),
      }))));
    return waiting;
  };
  const camaro = () => mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
  const viewed = () => hrefs().filter(h => h?.startsWith('/vehicle/'));
  const grid = () => host.querySelector('.sb-grid--cards')!;

  it('keeps the sort control, its focus and the cards while the new order is read, then swaps the cards', async () => {
    const waiting = hold();
    await camaro();
    const control = select();
    control.focus();
    expect(document.activeElement).toBe(control);
    await choose('price_desc');
    // Reading: the same control still has focus and shows the new order; the cards are the old ones, dimmed and marked busy.
    expect(select()).toBe(control);
    expect(document.activeElement).toBe(control);
    expect(select().value).toBe('price_desc');
    expect(viewed()).toEqual([`/vehicle/${id(1)}`]);
    expect(grid().getAttribute('aria-busy')).toBe('true');
    expect(grid().classList.contains('sb-grid--busy')).toBe(true);
    // The page itself is not busy, no reading line pushes the cards down, and the source is still named.
    expect(host.querySelector('.sb-content')!.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('');
    expect(host.querySelector('h1')?.textContent).toBe('Example Market');
    expect(waiting.map(w => w.sort)).toEqual(['price_desc']);
    // The new order lands: the cards change, the control and its focus do not.
    await act(async () => waiting[0].land([row(id(7)), row(id(8))], 2));
    expect(select()).toBe(control);
    expect(document.activeElement).toBe(control);
    expect(viewed()).toEqual([`/vehicle/${id(7)}`, `/vehicle/${id(8)}`]);
    expect(grid().getAttribute('aria-busy')).toBe('false');
    expect(grid().classList.contains('sb-grid--busy')).toBe(false);
    // Said to a screen reader, out of sight, since the visible reading line is not drawn for a new order.
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Sorted by Price high, showing 2 of 2');
    expect(host.querySelector('[role="status"] .sb-sr')).not.toBeNull();
  });

  it('says nothing of a sort when a page opens, and the note is gone once the visitor moves on', async () => {
    const waiting = hold();
    await camaro();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
    await choose('price_asc');
    await act(async () => waiting[0].land([row(id(3))], 1));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Sorted by Price low, showing 1 of 1');
    // Going up a level is a new page: the note of the old one does not follow it.
    answer(okRead({ level: 'models', scope: { make: 'Chevrolet', model: null, status: null }, makes: [], models: [{ model: 'Camaro', ...tally({ episodes: 3 }) }] }));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('reads the new order from the first page, and the latest choice wins', async () => {
    const waiting = hold();
    await camaro();
    await choose('price_desc');
    await choose('price_asc');
    expect(waiting.map(w => w.sort)).toEqual(['price_desc', 'price_asc']);
    // The first answer lands late and is dropped: the cards are still the old ones, still dimmed.
    await act(async () => waiting[0].land([row(id(7))], 1));
    expect(viewed()).toEqual([`/vehicle/${id(1)}`]);
    expect(host.querySelector('.sb-grid--busy')).not.toBeNull();
    await act(async () => waiting[1].land([row(id(8)), row(id(9))], 2));
    expect(viewed()).toEqual([`/vehicle/${id(8)}`, `/vehicle/${id(9)}`]);
    expect(select().value).toBe('price_asc');
    expect(host.querySelector('.sb-grid--busy')).toBeNull();
    expect(fixture.rpc.mock.calls.every(c => (c[1] as { p_page: number }).p_page === 1)).toBe(true);
  });

  it('dims the cards while an order read again is on its way, even when it is the order on screen', async () => {
    let newest = 0;
    const waiting: Array<(rows: unknown[], total: number) => void> = [];
    fixture.rpc.mockImplementation((_fn: string, args: { p_sort: string }) => (args.p_sort === 'newest' && newest++ === 0
      ? Promise.resolve({ data: listingsRead([row(id(1))], 1), error: null })
      : new Promise(resolve => waiting.push((rows, total) => resolve({ data: listingsRead(rows, total), error: null })))));
    await camaro();
    await choose('price_desc');
    // Back to the order on screen before the other one landed: that read is made again, and until it lands the cards are not fresh.
    await choose('newest');
    expect(waiting).toHaveLength(2);
    expect(viewed()).toEqual([`/vehicle/${id(1)}`]);
    expect(grid().getAttribute('aria-busy')).toBe('true');
    expect(grid().classList.contains('sb-grid--busy')).toBe(true);
    await act(async () => waiting[0]([row(id(7))], 1));
    expect(viewed()).toEqual([`/vehicle/${id(1)}`]);
    expect(grid().getAttribute('aria-busy')).toBe('true');
    await act(async () => waiting[1]([row(id(1)), row(id(2))], 2));
    expect(viewed()).toEqual([`/vehicle/${id(1)}`, `/vehicle/${id(2)}`]);
    expect(grid().getAttribute('aria-busy')).toBe('false');
    expect(select().value).toBe('newest');
  });

  it('says so when the new order could not be read, and reads it again on Try again', async () => {
    const waiting = hold();
    await camaro();
    await choose('price_desc');
    await act(async () => waiting[0].fail());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Source holdings could not be read.');
    expect(cards()).toHaveLength(0);
    await act(async () => buttonNamed(/try again/i)!.click());
    expect(waiting.map(w => w.sort)).toEqual(['price_desc', 'price_desc']);
    await act(async () => waiting[1].land([row(id(5))], 1));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(viewed()).toEqual([`/vehicle/${id(5)}`]);
    expect(select().value).toBe('price_desc');
  });

  it('leaves More alone while the new order is read', async () => {
    fixture.rpc.mockImplementation((_fn: string, args: { p_sort: string }) => (args.p_sort === 'newest'
      ? Promise.resolve({ data: listingsRead(rowsOf(1, 60), 150), error: null })
      : new Promise(() => {})));
    await camaro();
    await choose('price_desc');
    const asked = fixture.rpc.mock.calls.length;
    expect(more()).toBeDefined();
    await act(async () => more()!.click());
    expect(fixture.rpc.mock.calls.length).toBe(asked);
    expect(more()!.getAttribute('aria-disabled')).toBe('true');
  });

  it('reads the makes and models in the default order, whatever order was chosen at the listings', async () => {
    answer(listingsRead([row(id(1))], 1));
    await camaro();
    await choose('price_desc');
    expect(fixture.rpc).toHaveBeenLastCalledWith('browse_source_read', expect.objectContaining({ p_make: 'Chevrolet', p_model: 'Camaro', p_sort: 'price_desc' }));
    answer(okRead({ level: 'models', scope: { make: 'Chevrolet', model: null, status: null }, makes: [], models: [{ model: 'Camaro', ...tally({ episodes: 3 }) }] }));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" />);
    expect(fixture.rpc).toHaveBeenLastCalledWith('browse_source_read', expect.objectContaining({ p_make: 'Chevrolet', p_model: null, p_sort: 'newest' }));
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    expect(fixture.rpc).toHaveBeenLastCalledWith('browse_source_read', expect.objectContaining({ p_make: null, p_model: null, p_sort: 'newest' }));
  });
});

describe('while it reads', () => {
  it('marks only the content as busy, and leaves the status line outside it', async () => {
    let land!: (v: unknown) => void;
    fixture.rpc.mockReturnValue(new Promise(resolve => { land = resolve; }));
    await mount(<SourceBrowse source="example_market" />);
    const content = host.querySelector('.sb-content')!;
    const status = host.querySelector('[role="status"]')!;
    expect(content.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe('Reading…');
    // No busy region holds the status line, so it is not held back as part of a region still being filled.
    expect(content.contains(status)).toBe(false);
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    expect(host.querySelector('.sb-page')!.hasAttribute('aria-busy')).toBe(false);
    await act(async () => land({ data: okRead(), error: null }));
    expect(host.querySelector('.sb-content')!.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    // The same status element all along, and empty now: it was there before its text, so its text was announced.
    expect(host.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe('');
  });

  it('marks the content busy again when it reads another place, and names the source in the status', async () => {
    answer(okRead());
    await mount(<SourceBrowse source="example_market" />);
    fixture.rpc.mockReturnValue(new Promise(() => {}));
    await mount(<SourceBrowse source="example_market" make="Porsche" />);
    expect(host.querySelector('.sb-content')!.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Reading Example Market…');
    expect(host.querySelector('.sb-content')!.children).toHaveLength(0);
    expect(host.querySelector('[aria-busy="true"] [role="status"]')).toBeNull();
  });
});

describe('More, for a keyboard', () => {
  /** Page 1 at once; each later page when the test lands it. */
  const hold = (pageSize: number, total: number, first: unknown[]) => {
    const waiting: Array<(rows: unknown[]) => void> = [];
    fixture.rpc.mockImplementation((_fn: string, args: { p_page: number }) => (args.p_page === 1
      ? Promise.resolve({ data: listingsRead(first, total, 1, {}, pageSize), error: null })
      : new Promise(resolve => waiting.push(rows => resolve({ data: listingsRead(rows, total, args.p_page, {}, pageSize), error: null })))));
    return waiting;
  };
  const camaro = () => mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
  const lastCardLink = () => cards()[cards().length - 1].querySelector('a.sb-card__main');

  it('keeps focus on More while the next page is read, ignores a second press, and says what was added', async () => {
    const waiting = hold(2, 5, rowsOf(1, 2));
    await camaro();
    const button = more()!;
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    // Reading: the same button, still focused, marked busy and not disabled (a disabled button cannot keep focus).
    expect(more()).toBeUndefined();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toBe('Reading…');
    await act(async () => button.click());
    expect(requested()).toEqual([1, 2]);
    await act(async () => waiting[0](rowsOf(3, 2)));
    expect(cards()).toHaveLength(4);
    expect(more()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    // Said to a screen reader in the status region that was already there, out of sight.
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('2 more listings, showing 4 of 5');
    expect(status.querySelector('.sb-sr')?.textContent).toBe('2 more listings, showing 4 of 5');
  });

  it('moves focus to the first card the last page added when More retires with focus on it', async () => {
    serve(3, 2, { 1: rowsOf(1, 2), 2: rowsOf(3, 1) });
    await camaro();
    more()!.focus();
    await clickMore();
    expect(more()).toBeUndefined();
    expect(cards()).toHaveLength(3);
    expect(document.activeElement).toBe(cards()[2].querySelector('a.sb-card__main'));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('1 more listing, showing 3 of 3');
  });

  it('moves focus to the last card when the page that retires More adds nothing', async () => {
    serve(3, 2, { 1: rowsOf(1, 2), 2: [] });
    await camaro();
    more()!.focus();
    await clickMore();
    expect(more()).toBeUndefined();
    expect(document.activeElement).toBe(lastCardLink());
    expect(host.querySelector('[role="status"]')?.textContent).toBe('No new listings, showing 2 of 2');
  });

  it('leaves focus alone when More did not have it (a mouse press in a browser that does not focus buttons)', async () => {
    serve(3, 2, { 1: rowsOf(1, 2), 2: rowsOf(3, 1) });
    await camaro();
    expect(document.activeElement).toBe(document.body);
    await clickMore();
    expect(more()).toBeUndefined();
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps focus on More after a page that could not be read, with the alert beside it', async () => {
    fixture.rpc.mockImplementation((_fn: string, args: { p_page: number }) => (args.p_page === 1
      ? Promise.resolve({ data: listingsRead(rowsOf(1, 1), 2, 1, {}, 1), error: null })
      : Promise.reject(new Error('offline'))));
    await camaro();
    const button = more()!;
    button.focus();
    await act(async () => button.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The next page could not be read.');
    expect(more()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('false');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('never reads a count under the rows already shown, and forgets a failed page when the page changes', async () => {
    // The count shrank between two pages: 4 rows are shown, and the line does not say of 3.
    fixture.rpc.mockImplementation((_fn: string, args: { p_page: number }) => Promise.resolve({
      data: args.p_page === 1 ? listingsRead(rowsOf(1, 2), 4, 1, {}, 2) : listingsRead(rowsOf(3, 2), 3, 2, {}, 2), error: null,
    }));
    await camaro();
    await clickMore();
    expect(cards()).toHaveLength(4);
    expect(text()).toContain('showing 4 of 4');
    expect(text()).not.toContain('of 3');
    expect(more()).toBeUndefined();
    // A failed page is not carried to the next page the visitor opens.
    fixture.rpc.mockImplementation((_fn: string, args: { p_page: number; p_model: string }) => (args.p_page === 1
      ? Promise.resolve({ data: listingsRead(rowsOf(1, 1), 2, 1, { scope: { make: 'Chevrolet', model: args.p_model, status: null } }, 1), error: null })
      : Promise.reject(new Error('offline'))));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Corvette" />);
    await clickMore();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('The next page could not be read.');
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Nova" />);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(more()).toBeDefined();
  });
});

describe('a card is named for a screen reader', () => {
  it('names each card by its title, each outside link by its card, and leaves the photo to the title beside it', async () => {
    answer(listingsRead([row(id(1)), row(id(2), { year: 1970, listing_url: null, archive_url: 'https://archive.example.test/web/1' })], 2));
    await mount(<SourceBrowse source="example_market" make="Chevrolet" model="Camaro" />);
    const [a, b] = cards();
    for (const [card, title] of [[a, '1969 Chevrolet Camaro'], [b, '1970 Chevrolet Camaro']] as const) {
      const named = card.getAttribute('aria-labelledby') ?? '';
      expect(named).not.toBe('');
      expect(card.querySelector(`[id="${named}"]`)?.textContent).toBe(title);
    }
    expect(a.getAttribute('aria-labelledby')).not.toBe(b.getAttribute('aria-labelledby'));
    expect(a.querySelector('img')!.getAttribute('alt')).toBe('');
    // The outside link says what it opens and of which card, and its name holds the words it shows.
    const outside = (card: Element) => card.querySelector('a.sb-card__link')!;
    expect(outside(a).getAttribute('aria-label')).toBe('Open the listing: 1969 Chevrolet Camaro');
    expect(outside(b).getAttribute('aria-label')).toBe('Open the saved page: 1970 Chevrolet Camaro');
    for (const card of [a, b]) expect(outside(card).getAttribute('aria-label')).toContain(outside(card).textContent ?? '?');
    // Two links on a page never share a name.
    const names = [...host.querySelectorAll('a.sb-card__link')].map(l => l.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('small guards of the page', () => {
  it('shows the top three models of a make and no more', async () => {
    answer(okRead({
      makes: [{ make: 'Chevrolet', ...tally({ episodes: 900 }), top_models: [
        { model: 'Corvette', episodes: 410 }, { model: 'Camaro', episodes: 322 }, { model: 'C10', episodes: 280 }, { model: 'Nova', episodes: 90 }] }],
    }));
    await mount(<SourceBrowse source="example_market" />);
    expect([...link('/browse?source=example_market&make=Chevrolet').querySelectorAll('li')].map(li => li.textContent)).toEqual(['Corvette410', 'Camaro322', 'C10280']);
  });

  it('starts another make with an empty filter, and says what it filters', async () => {
    const models = (make: string) => okRead({ level: 'models', scope: { make, model: null, status: null }, makes: [], models: [{ model: 'Alpha', ...tally({ episodes: 3 }) }, { model: 'Beta', ...tally({ episodes: 2 }) }] });
    answer(models('Porsche'));
    await mount(<SourceBrowse source="example_market" make="Porsche" />);
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Filter Porsche models');
    await typeInto(host.querySelector('input') as HTMLInputElement, 'alp');
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('alp');
    answer(models('Ford'));
    await mount(<SourceBrowse source="example_market" make="Ford" />);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('Filter Ford models');
  });

  it('words an aggregator\'s count as pages read, which are not listings held, as the registry and the Sources board do', async () => {
    const pages = { ...EXAMPLE, slug: 'pages_one', species: 'aggregator', unit: 'pages read, not listings held' };
    answer(okRead({ source: pages, holdings: { ...HOLDINGS, episodes: 7896, vehicles: 7788, sold: 2405, ended: 5000, active: 0, with_image: 7013, landed_24h: 30 } }));
    await mount(<SourceBrowse source="pages_one" />);
    expect(host.querySelector('.k-masthead__result .k-label')?.textContent).toBe('pages read, not listings held');
    expect(host.querySelector('.k-figure')?.textContent).toBe('7,896');
    expect(host.querySelector('[role="group"][aria-label="Sold"]')?.textContent).toContain('2,405 of 7,896 pages · Oct 20, 2026');
    expect(text()).toContain('30 pages recorded from this source in the last 24 hours');
    expect(host.querySelector('section[aria-label="Makes"]')?.textContent).toContain('1,203pages');
    // A read that sends no unit says the same for the species.
    answer(okRead({ source: { ...pages, slug: 'pages_two', unit: null }, holdings: { ...HOLDINGS, episodes: 12 } }));
    await mount(<SourceBrowse source="pages_two" />);
    expect(host.querySelector('.k-masthead__result .k-label')?.textContent).toBe('pages read, not listings held');
    // And a page of nothing says pages too.
    answer(listingsRead([], 0, 1, { source: pages }));
    await mount(<SourceBrowse source="pages_one" make="Chevrolet" model="Camaro" />);
    expect(text()).toContain('This source holds no Chevrolet Camaro pages.');
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'SourceBrowse.css'), 'utf8');
  const rule = (selector: string) => {
    const start = css.split('\n').findIndex(line => line.startsWith(`${selector} {`));
    return start < 0 ? '' : css.split('\n').slice(start).join('\n').split('}')[0];
  };
  it('lets a name with no break point wrap in the trail, in a note and in a head, instead of widening the page', () => {
    for (const selector of ['.sb-crumb .k-label', '.sb-note', '.sb-head .k-caption']) expect(rule(selector), selector).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('dims busy cards, marks a busy More, and hides what is said only to a screen reader', () => {
    expect(rule('.sb-grid--busy')).toMatch(/opacity:/);
    expect(rule('.sb-more [aria-disabled="true"]')).toMatch(/opacity:/);
    expect(rule('.sb-sr')).toMatch(/clip/);
  });
});

// MARK: - The reader's decoding and words

describe('parseSourceBrowse', () => {
  it('never throws on nothing, and reads nothing as an unknown source', () => {
    for (const bad of [null, undefined, 'x', 7, [], {}]) {
      const r = parseSourceBrowse(bad, 'gone');
      expect(r.status).toBe('unknown_source');
      expect(r.source.slug).toBe('gone');
      expect(r.makes).toEqual([]);
      expect(r.listings.rows).toEqual([]);
      expect(r.holdings.episodes).toBe(0);
      expect(r.holdings.upcoming).toBe(0);
      expect(r.holdings.archived).toBe(0);
      expect(r.holdings.dated_min).toBeNull();
      expect(r.holdings.board).toBeNull();
      expect(r.scope).toEqual({ make: null, model: null, status: null });
    }
  });

  it('reads numbers sent as text, drops rows with no name, and floors medians the reader should have nulled', () => {
    const r = parseSourceBrowse({
      status: 'ok', source: { slug: 's', name: null }, median_floor: '5',
      holdings: { episodes: '19518', shown_n: '4', shown_median: '15000', sold: '12', sold_median: '9900', sold_n: '3', landed_24h: null },
      makes: [{ make: 'Ford', episodes: '10', shown_n: '10', shown_median: '20000.4', top_models: [{ model: 'Mustang', episodes: '4' }, { episodes: 1 }, null] }, { episodes: 3 }, null, 'x'],
      models: 'not a list',
      listings: { total: 1, rows: [{ vehicle_id: 'v1', shown_price: '0', sold_price: -5, listing_url: 'ftp://x', image_url: 'data:text/html,x', status: 'weird' }, { year: 1999 }] },
    });
    expect(r.source.name).toBe('s');
    expect(r.holdings.episodes).toBe(19518);
    expect(r.holdings.shown_median).toBeNull();
    expect(r.holdings.sold_median).toBeNull();
    expect(r.holdings.landed_24h).toBe(0);
    expect(r.makes).toHaveLength(1);
    expect(r.makes[0].shown_median).toBe(20000.4);
    expect(r.makes[0].top_models).toEqual([{ model: 'Mustang', episodes: 4 }]);
    expect(r.models).toEqual([]);
    expect(r.listings.rows).toHaveLength(1);
    expect(r.listings.rows[0]).toMatchObject({ vehicle_id: 'v1', shown_price: null, sold_price: null, listing_url: null, image_url: null, status: 'unknown' });
  });

  it('reads every status count and floors every per-status median under the floor', () => {
    const r = parseSourceBrowse({
      status: 'ok', median_floor: 5,
      holdings: {
        episodes: 1000, active: 500, upcoming: '186', sold: 100, ended: 200, unknown: 14,
        active_n: 4, active_median: 15000, ended_n: 4, ended_median: 7000, sold_n: 4, sold_median: 9000, shown_n: 4, shown_median: 15000,
      },
      makes: [{ make: 'Ford', episodes: 9, upcoming: 2, ended: 3, active_n: 5, active_median: '12000', ended_n: 5, ended_median: 6000, sold: 5, sold_n: 5, sold_median: 8000, shown_n: 5, shown_median: 12000 }],
      models: [{ model: 'Mustang', episodes: 9, active_n: 5, active_median: 0, ended_n: 2, ended_median: 6000 }],
    });
    expect(r.holdings).toMatchObject({ upcoming: 186, ended: 200, unknown: 14, active: 500, sold: 100 });
    expect(r.holdings).toMatchObject({ active_median: null, ended_median: null, sold_median: null, shown_median: null });
    expect(r.makes[0]).toMatchObject({ upcoming: 2, ended: 3, active_median: 12000, ended_median: 6000, sold_median: 8000, shown_median: 12000 });
    // A zero is not a median, and two values are not enough for one.
    expect(r.models[0]).toMatchObject({ active_n: 5, active_median: null, ended_n: 2, ended_median: null });
    // A raised floor is enforced too.
    const strict = parseSourceBrowse({ median_floor: 8, holdings: { ended_n: 7, ended_median: 5000 }, makes: [{ make: 'Ford', ended_n: 8, ended_median: 5000 }] });
    expect(strict.holdings.ended_median).toBeNull();
    expect(strict.makes[0].ended_median).toBe(5000);
  });

  it('lets a reader built to the first contract keep working: shown_* repeats as the active price', () => {
    const r = parseSourceBrowse({ status: 'ok', holdings: { shown_n: 12, shown_median: 15000 }, makes: [{ make: 'Ford', shown_n: 3, shown_median: 9000 }] });
    expect(r.holdings).toMatchObject({ active_n: 12, active_median: 15000, ended_n: 0, ended_median: null });
    expect(r.makes[0]).toMatchObject({ active_n: 3, active_median: null });
    // A reader that sends the per-status keys is believed over shown_*.
    const both = parseSourceBrowse({ status: 'ok', holdings: { shown_n: 12, shown_median: 15000, active_n: 0, active_median: null } });
    expect(both.holdings).toMatchObject({ active_n: 0, active_median: null });
  });

  it('reads the span of listing clocks and the count read from saved copies', () => {
    const h = parseSourceBrowse({
      status: 'ok', holdings: { archived: '6400', dated_min: '2005-03-14 10:00:00+00', dated_max: '2026-10-19T18:00:00+00:00' },
    }).holdings;
    expect(h.archived).toBe(6400);
    expect(h.dated_min).toBe('2005-03-14T10:00:00+00:00');
    expect(h.dated_max).toBe('2026-10-19T18:00:00+00:00');
    const none = parseSourceBrowse({ status: 'ok', holdings: { archived: -3, dated_min: 'long ago', dated_max: null } }).holdings;
    expect(none.archived).toBe(0);
    expect(none.dated_min).toBeNull();
    expect(none.dated_max).toBeNull();
  });

  it('reads the Sources board count, numbers sent as text, and calls anything it cannot read unknown', () => {
    const board = (b: unknown) => parseSourceBrowse({ status: 'ok', holdings: { board: b } }).holdings.board;
    expect(board({
      day: '2026-10-20', lots: '3575', landed_at: '2026-10-20 08:00:00+00', population: '270391', population_method: ' search_index ',
      population_confidence: '0.95', population_at: '2026-10-17T21:30:01+00:00',
    })).toEqual({
      day: '2026-10-20', lots: 3575, landed_at: '2026-10-20T08:00:00+00:00', population: 270391, population_method: 'search_index',
      population_confidence: 0.95, population_at: '2026-10-17T21:30:01+00:00',
    });
    for (const none of [null, undefined, 'x', 7, [], {}, { day: '2026-10-20' }, { lots: 'many' }, { lots: -4 }]) expect(board(none)).toBeNull();
    expect(board({ day: '2026-10-20', lots: 0 })).toEqual({
      day: '2026-10-20', lots: 0, landed_at: null, population: null, population_method: null, population_confidence: null, population_at: null,
    });
    // A day it cannot read is no day; a total of zero is no total; a confidence is a share from 0 to 1 or it is unknown.
    expect(board({ day: 'today', lots: 5, population: 0, population_confidence: 95 })).toMatchObject({ day: '', lots: 5, population: null, population_confidence: null });
    expect(board({ lots: 5, population_confidence: 1 })?.population_confidence).toBe(1);
    expect(board({ lots: 5, population_confidence: 0 })?.population_confidence).toBe(0);
    expect(board({ lots: 5, population_confidence: -0.1 })?.population_confidence).toBeNull();
    expect(board({ lots: 5, population_method: '   ' })?.population_method).toBeNull();
  });

  it('reads the status a listing page was asked for, and the status of each listing', () => {
    const r = parseSourceBrowse({
      status: 'ok', scope: { make: 'A', model: 'B', status: 'upcoming' },
      listings: { rows: ['active', 'upcoming', 'sold', 'ended', 'unknown', 'live', null, 7].map((status, i) => ({ vehicle_id: `v${i}`, status })) },
    });
    expect(r.scope).toEqual({ make: 'A', model: 'B', status: 'upcoming' });
    expect(r.listings.rows.map(x => x.status)).toEqual(['active', 'upcoming', 'sold', 'ended', 'unknown', 'unknown', 'unknown', 'unknown']);
    expect(parseSourceBrowse({ scope: { status: 'sideways' } }).scope.status).toBeNull();
    expect(parseSourceBrowse({ scope: { status: ' sold ' } }).scope.status).toBeNull();
    expect(parseSourceBrowse({ scope: { status: 'ended' } }).scope.status).toBe('ended');
  });

  it('reads when a listing was recorded and where its saved copy is', () => {
    const rows = parseSourceBrowse({
      listings: { rows: [
        { vehicle_id: 'a', recorded_at: '2026-10-02 03:00:00+00', first_seen_at: '2026-09-01T00:00:00+00:00', archive_url: 'https://archive.example.test/web/1' },
        { vehicle_id: 'b', first_seen_at: '2026-09-01T00:00:00+00:00', archive_url: 'ftp://archive.example.test/1' },
        { vehicle_id: 'c', recorded_at: 'last week', archive_url: 'javascript:alert(1)' },
        { vehicle_id: 'd', archive_url: '   ' },
      ] },
    }).listings.rows;
    expect(rows[0]).toMatchObject({ recorded_at: '2026-10-02T03:00:00+00:00', archive_url: 'https://archive.example.test/web/1' });
    expect(rows[1]).toMatchObject({ recorded_at: '2026-09-01T00:00:00+00:00', archive_url: null });
    expect(rows[2]).toMatchObject({ recorded_at: null, archive_url: null });
    expect(rows[3]).toMatchObject({ recorded_at: null, archive_url: null });
  });

  it('reads a clock the browser can read, and calls an unreadable one unknown', () => {
    const r = parseSourceBrowse({
      as_of: '2026-10-20T12:00:00Z', holdings: { folded_at: '2026-10-20 09:45:12+00', first_seen: 'last tuesday', last_seen: '2026-10-19T05:00:00.123456+00:00' },
      listings: { rows: [{ vehicle_id: 'v1', listed_at: '2026-09-28 17:00:00', ends_at: 'soon' }] },
    });
    expect(r.as_of).toBe('2026-10-20T12:00:00Z');
    expect(r.holdings.folded_at).toBe('2026-10-20T09:45:12+00:00');
    expect(r.holdings.first_seen).toBeNull();
    expect(r.holdings.last_seen).toBe('2026-10-19T05:00:00.123456+00:00');
    expect(r.listings.rows[0].listed_at).toBe('2026-09-28T17:00:00');
    expect(r.listings.rows[0].ends_at).toBeNull();
    expect(parseSourceBrowse({ holdings: { folded_at: '2026-10-20' } }).holdings.folded_at).toBe('2026-10-20');
  });

  it('serves the registry mark from the app root and derives the level when the reader omits it', () => {
    expect(parseSourceBrowse({ source: { slug: 's', logo_url: 'https://nuke.ag/source-logos/x.png' } }).source.logo_url).toBe('/source-logos/x.png');
    expect(parseSourceBrowse({ source: { slug: 's' }, scope: { make: 'A', model: 'B' } }).level).toBe('listings');
    expect(parseSourceBrowse({ source: { slug: 's' }, scope: { make: 'A' } }).level).toBe('models');
    expect(parseSourceBrowse({ source: { slug: 's' } }).level).toBe('makes');
  });

  it('decodes a read shaped exactly as the reader sends it', () => {
    const r = parseSourceBrowse(okRead({
      holdings: { ...HOLDINGS, upcoming: 186, board: { ...BOARD, population: 270391, population_method: 'search_index', population_confidence: 0.95, population_at: '2026-10-17T21:30:01+00:00' } },
    }));
    expect(r.status).toBe('ok');
    expect(r.holdings).toMatchObject({ episodes: 19518, upcoming: 186, ended: 12126, board: { lots: 3575, population: 270391 } });
    expect(r.makes.map(m => m.make)).toEqual(['Chevrolet', 'Ford', 'Porsche']);
    const listed = parseSourceBrowse(listingsRead([row(id(1))], 1));
    expect(listed.listings.rows[0]).toMatchObject({ status: 'ended', recorded_at: '2026-10-02T03:00:00+00:00', archive_url: null, price_label: null });
    expect(listed.scope).toEqual({ make: 'Chevrolet', model: 'Camaro', status: null });
  });
});

describe('the decoder holds its guards', () => {
  it('never lets the reader lower the median floor under five, and lets it raise it', () => {
    for (const sent of [0, 1, 4, -3, '2', null, undefined]) {
      const r = parseSourceBrowse({
        status: 'ok', median_floor: sent, holdings: { ended_n: 4, ended_median: 5000 },
        makes: [{ make: 'Ford', ended_n: 4, ended_median: 5000 }], models: [{ model: 'T', ended_n: 1, ended_median: 5000 }],
      });
      expect(r.median_floor, String(sent)).toBe(5);
      expect(r.holdings.ended_median, String(sent)).toBeNull();
      expect(r.makes[0].ended_median, String(sent)).toBeNull();
      expect(r.models[0].ended_median, String(sent)).toBeNull();
    }
    // Five values are enough for a median even when the reader's floor was lowered to nothing.
    expect(parseSourceBrowse({ median_floor: 0, holdings: { ended_n: 5, ended_median: 5000 } }).holdings.ended_median).toBe(5000);
    expect(parseSourceBrowse({ median_floor: 8 }).median_floor).toBe(8);
  });

  it('tests a web address after trimming it, so a space on either end changes nothing', () => {
    const [a] = parseSourceBrowse({ listings: { rows: [{
      vehicle_id: 'a', listing_url: ' https://listings.example.test/a', archive_url: 'https://archive.example.test/a ', image_url: '  https://images.example.test/a.jpg ',
    }] } }).listings.rows;
    expect(a).toMatchObject({ listing_url: 'https://listings.example.test/a', archive_url: 'https://archive.example.test/a', image_url: 'https://images.example.test/a.jpg' });
    const [b] = parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'b', image_url: ' /photos/b.jpg ', listing_url: ' javascript:alert(1)', archive_url: ' ftp://x.test/b' }] } }).listings.rows;
    expect(b).toMatchObject({ image_url: '/photos/b.jpg', listing_url: null, archive_url: null });
  });

  it('never reports fewer listings in all than the rows it carries, and falls back to a page of 60', () => {
    const rows = [{ vehicle_id: 'a' }, { vehicle_id: 'b' }];
    expect(parseSourceBrowse({ listings: { total: 1, rows } }).listings.total).toBe(2);
    expect(parseSourceBrowse({ listings: { total: 9, rows } }).listings.total).toBe(9);
    expect(parseSourceBrowse({ listings: { rows } }).listings.page_size).toBe(60);
    expect(parseSourceBrowse({ listings: { page_size: 0, rows } }).listings.page_size).toBe(60);
    expect(parseSourceBrowse({ listings: { page_size: 25, rows } }).listings.page_size).toBe(25);
    expect(parseSourceBrowse({ listings: { page: 0, rows } }).listings.page).toBe(1);
  });

  it('keeps two listings of one vehicle that differ only by how they ended, and a row a shifted page repeats once', () => {
    const ended = { vehicle_id: 'v1', status: 'ended', status_raw: 'ended', ends_at: '2026-09-01T10:00:00+00:00' };
    const sold = { vehicle_id: 'v1', status: 'sold', status_raw: 'sold', ends_at: '2026-10-01T10:00:00+00:00' };
    const [first] = parseSourceBrowse({ listings: { rows: [ended] } }).listings.rows;
    expect(appendRows([first], parseSourceBrowse({ listings: { rows: [sold] } }).listings.rows)).toHaveLength(2);
    // The same vehicle and word with another end is another listing, and so is the same end under another word; the very same row twice is one.
    expect(appendRows([first], parseSourceBrowse({ listings: { rows: [{ ...ended, ends_at: '2026-09-02T10:00:00+00:00' }] } }).listings.rows)).toHaveLength(2);
    expect(appendRows([first], parseSourceBrowse({ listings: { rows: [{ ...ended, status_raw: 'withdrawn' }] } }).listings.rows)).toHaveLength(2);
    expect(appendRows([first], [{ ...first }])).toHaveLength(1);
    // With the event id the reader sends, the id alone is the key: the same event on two pages is one row whatever changed on it,
    // and two events of one vehicle are two rows. The check day rides along as a clock.
    const x = parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'v1', event_id: 'e1', checked_at: '2026-10-18 07:54:00+00' }] } }).listings.rows;
    expect(x[0]).toMatchObject({ event_id: 'e1', checked_at: '2026-10-18T07:54:00+00:00' });
    expect(appendRows(x, parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'v1', event_id: 'e1', status: 'sold' }] } }).listings.rows)).toHaveLength(1);
    expect(appendRows(x, parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'v1', event_id: 'e2' }] } }).listings.rows)).toHaveLength(2);
    expect(parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'v1', event_id: 7, checked_at: 'yesterday' }] } }).listings.rows[0]).toMatchObject({ event_id: null, checked_at: null });
  });

  it('words every method the board records in plain words, and none by its own name', () => {
    const counted = ['enumerated', 'api_count', 'search_index', 'sitemap', 'docket_and_broadcast_census'];
    const estimated = ['owner_reference', 'catalogue_estimate', 'estimate', 'bounded', 'window_extrapolated', 'turnover_model', 'capture_model'];
    for (const m of counted) expect(totalHow(m), m).toMatchObject({ count: true });
    for (const m of estimated) expect(totalHow(m), m).toMatchObject({ count: false });
    for (const m of [...counted, ...estimated]) expect(totalHow(m)!.words, m).not.toMatch(/_/);
    // An estimate always says it is not a count; a count never says it is an estimate.
    for (const m of estimated) expect(totalHow(m)!.words, m).toMatch(/not a count/);
    for (const m of counted) expect(totalHow(m)!.words, m).not.toMatch(/not a count|estimate/);
    // Case and spacing are the reader's; an unknown or missing method has no words.
    expect(totalHow(' Search-Index ')).toMatchObject({ count: true });
    for (const none of [null, '', '   ', 'mystery_count']) expect(totalHow(none), String(none)).toBeNull();
  });
});

describe('readSourceBrowse', () => {
  it('asks for a status only when one is given', async () => {
    answer(okRead());
    await readSourceBrowse({ source: 'example_market' });
    await readSourceBrowse({ source: 'example_market', make: 'Chevrolet', model: 'Camaro', status: 'upcoming', page: 2, pageSize: 30, sort: 'price_desc' });
    await readSourceBrowse({ source: 'example_market', status: null });
    const [plain, filtered, none] = fixture.rpc.mock.calls.map(c => c[1] as Record<string, unknown>);
    expect(plain).toEqual({ p_source: 'example_market', p_make: null, p_model: null, p_page: 1, p_page_size: 60, p_sort: 'newest' });
    expect('p_status' in plain).toBe(false);
    expect(filtered).toEqual({ p_source: 'example_market', p_make: 'Chevrolet', p_model: 'Camaro', p_page: 2, p_page_size: 30, p_sort: 'price_desc', p_status: 'upcoming' });
    expect('p_status' in none).toBe(false);
  });

  it('decodes what the reader sends, with the slug that was asked for when it names none', async () => {
    answer(null);
    const r = await readSourceBrowse({ source: 'asked_for' });
    expect(r.status).toBe('unknown_source');
    expect(r.source).toMatchObject({ slug: 'asked_for', name: 'asked_for' });
  });

  it('rejects with the reader\'s own message', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(readSourceBrowse({ source: 'example_market' })).rejects.toThrow('permission denied');
    fixture.rpc.mockResolvedValue({ data: null, error: { message: '' } });
    await expect(readSourceBrowse({ source: 'example_market' })).rejects.toThrow('Source holdings could not be read.');
  });
});

describe('labelsFor', () => {
  const words = (species: string | null, unit: string | null = null) => labelsFor({ source: { species, unit } });
  it('chooses by species group: a bid for the auction species, an ask for the rest', () => {
    expect(words('timed_auction', 'lots held')).toMatchObject({ shown: 'High bid', noun: 'lots', held: 'lots held', bidding: true });
    expect(words('block_house')).toMatchObject({ shown: 'High bid', noun: 'lots' });
    expect(words('dealer')).toMatchObject({ shown: 'Asking', noun: 'vehicles' });
    expect(words('classifieds')).toMatchObject({ shown: 'Asking', noun: 'posts' });
    expect(words('auth_walled_marketplace', 'listings held')).toMatchObject({ shown: 'Asking', noun: 'listings', held: 'listings held' });
    // An aggregator counts pages read and says they are not listings held: the registry's own unit, as the Sources board words it.
    expect(words('aggregator', 'pages read, not listings held')).toMatchObject({ shown: 'Asking', noun: 'pages', held: 'pages read, not listings held' });
    expect(words('aggregator')).toMatchObject({ noun: 'pages', held: 'pages read, not listings held' });
    // Any other unit that is not one plain word held is said as the registry has it; the noun still comes from the species.
    expect(words('dealer', 'vehicles on the lot')).toMatchObject({ noun: 'vehicles', held: 'vehicles on the lot' });
    expect(words('classifieds')).toMatchObject({ noun: 'posts', held: 'posts held' });
    expect(words(null)).toMatchObject({ shown: 'Asking', noun: 'listings', held: 'listings held' });
  });
  it('keeps the same words for the same species whatever the source is called', () => {
    const a = labelsFor({ source: { species: 'timed_auction', unit: null } });
    const b = labelsFor({ source: { species: 'timed_auction', unit: 'lots held' } });
    expect(a).toEqual(b);
  });
  it('words an aggregate over mixed prices as the shown price, never an ask, and keeps the high bid for the bidding species', () => {
    for (const species of ['auth_walled_marketplace', 'dealer', 'classifieds', 'aggregator', null]) expect(words(species).shownLower).toBe('shown price');
    for (const species of ['timed_auction', 'block_house']) expect(words(species)).toMatchObject({ shown: 'High bid', shownLower: 'high bid', bidding: true });
  });
});

describe('words on a listing', () => {
  const asking = labelsFor({ source: { species: 'auth_walled_marketplace', unit: null } });
  const bidding = labelsFor({ source: { species: 'timed_auction', unit: null } });
  const base = { sold_price: null, shown_price: null, price_kind: null, bids: null };
  it('names the price the way the source showed it', () => {
    expect(priceLine({ ...base, sold_price: 41500, shown_price: 40000 }, asking)).toBe('Sold $41,500');
    expect(priceLine({ ...base, shown_price: 4050, price_kind: 'current_bid', bids: 6 }, asking)).toBe('Bid $4,050 · 6 bids');
    expect(priceLine({ ...base, shown_price: 4050, price_kind: 'current_bid', bids: 1 }, asking)).toBe('Bid $4,050 · 1 bid');
    expect(priceLine({ ...base, shown_price: 4050, price_kind: 'current_bid', bids: 0 }, asking)).toBe('Bid shown $4,050 · bid count not recorded');
    expect(priceLine({ ...base, shown_price: 9900, price_kind: 'buy_it_now', bids: 3 }, asking)).toBe('Buy it now $9,900');
    expect(priceLine({ ...base, shown_price: 9900 }, asking)).toBe('Asking $9,900');
    // Only an auction species shows the bids behind a price; an asking price with a count beside it is still an asking price.
    expect(priceLine({ ...base, shown_price: 9900, bids: 31 }, asking)).toBe('Asking $9,900');
    expect(priceLine({ ...base, shown_price: 9900, bids: 31 }, bidding)).toBe('High bid $9,900 · 31 bids');
    expect(priceLine(base, asking)).toBeNull();
  });
  describe('a bid price says what stands behind it', () => {
    const bid = { ...base, shown_price: 25000, price_kind: 'current_bid' };
    it('shows the source\'s word as sent when the reader sends one', () => {
      expect(priceLine({ ...bid, bids: 0, price_label: 'Starting bid' }, asking)).toBe('Starting bid $25,000');
      expect(priceLine({ ...bid, bids: null, price_label: 'Starting bid' }, asking)).toBe('Starting bid $25,000');
      expect(priceLine({ ...bid, bids: 14, price_label: 'Current bid' }, asking)).toBe('Current bid $25,000 · 14 bids');
      expect(priceLine({ ...bid, bids: 1, price_label: 'Current bid' }, asking)).toBe('Current bid $25,000 · 1 bid');
      expect(priceLine({ ...bid, bids: 0, price_label: 'Current bid' }, asking)).toBe('Current bid $25,000');
    });
    it('without a source word, says only what the capture recorded: a zero count is never "Starting bid"', () => {
      expect(priceLine({ ...bid, bids: 0 }, asking)).toBe('Bid shown $25,000 · bid count not recorded');
      expect(priceLine({ ...bid, bids: null }, asking)).toBe('Bid shown $25,000 · bid count not recorded');
      expect(priceLine({ ...bid, bids: 6 }, asking)).toBe('Bid $25,000 · 6 bids');
      expect(priceLine({ ...bid, bids: 0, price_label: null }, asking)).toBe('Bid shown $25,000 · bid count not recorded');
      expect(priceLine({ ...bid, bids: 0, price_label: '' }, asking)).toBe('Bid shown $25,000 · bid count not recorded');
    });
    it('says a bid on a listing that is over is its last, and one still open is a bid', () => {
      for (const status of ['ended', 'sold'] as const) {
        expect(priceLine({ ...bid, status, bids: 23, shown_price: 12828 }, asking), status).toBe('Last bid $12,828 · 23 bids');
        expect(priceLine({ ...bid, status, bids: 1 }, asking), status).toBe('Last bid $25,000 · 1 bid');
        expect(priceLine({ ...bid, status, bids: 0 }, asking), status).toBe('Last bid shown $25,000 · bid count not recorded');
        expect(priceLine({ ...bid, status, bids: null }, asking), status).toBe('Last bid shown $25,000 · bid count not recorded');
      }
      for (const status of ['active', 'upcoming', 'unknown'] as const) {
        expect(priceLine({ ...bid, status, bids: 23 }, asking), status).toBe('Bid $25,000 · 23 bids');
        expect(priceLine({ ...bid, status, bids: 0 }, asking), status).toBe('Bid shown $25,000 · bid count not recorded');
      }
      // The source's own word and a sale are said as they are, over or not.
      expect(priceLine({ ...bid, status: 'ended', bids: 0, price_label: 'Starting bid' }, asking)).toBe('Starting bid $25,000');
      expect(priceLine({ ...bid, status: 'sold', bids: 4, sold_price: 31000 }, asking)).toBe('Sold $31,000');
    });
    it('does not touch the other kinds or a sale', () => {
      expect(priceLine({ ...base, shown_price: 9900, price_kind: 'buy_it_now', bids: 3, price_label: 'Price' }, asking)).toBe('Buy it now $9,900');
      expect(priceLine({ ...bid, bids: 0, price_label: 'Starting bid', sold_price: 41500 }, asking)).toBe('Sold $41,500');
      expect(priceLine({ ...base, price_kind: 'current_bid', price_label: 'Starting bid' }, asking)).toBeNull();
    });
    it('decodes the word tolerantly: trimmed text, or nothing', () => {
      const label = (price_label: unknown) => parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'v1', price_label }] } }).listings.rows[0].price_label;
      expect(label('  Starting bid ')).toBe('Starting bid');
      for (const none of ['', '   ', 42, null, undefined]) expect(label(none)).toBeNull();
    });
    it('carries the decoded word through to the price line, end to end', () => {
      const decoded = parseSourceBrowse({
        listings: { rows: [{ vehicle_id: 'v1', status: 'ended', shown_price: 25000, price_kind: 'current_bid', bids: 0, price_label: 'Starting bid' }] },
      }).listings.rows[0];
      expect(priceLine(decoded, asking)).toBe('Starting bid $25,000');
    });
  });
  it('shows the cents of a price under $100 and whole dollars from there', () => {
    expect(usd(7.99)).toBe('$7.99');
    expect(usd(99.5)).toBe('$99.50');
    expect(usd(25)).toBe('$25');
    expect(usd(100)).toBe('$100');
    expect(usd(12827.89)).toBe('$12,828');
    expect(usd(25000)).toBe('$25,000');
  });
  it('spans years and appends pages without repeats', () => {
    expect(yearSpan(1969, 1969)).toBe('1969');
    expect(yearSpan(1932, 2024)).toBe('1932–2024');
    expect(yearSpan(null, 2001)).toBe('2001');
    expect(yearSpan(null, null)).toBeNull();
    const a = parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'a' }, { vehicle_id: 'b' }] } }).listings.rows;
    const b = parseSourceBrowse({ listings: { rows: [{ vehicle_id: 'b' }, { vehicle_id: 'c' }] } }).listings.rows;
    expect(appendRows(a, b).map(r => r.vehicle_id)).toEqual(['a', 'b', 'c']);
  });
  it('reads the year of a clock in UTC, and nothing from a clock it cannot read', () => {
    expect(yearOfClock('2005-03-14T10:00:00+00:00')).toBe(2005);
    expect(yearOfClock('2026-12-31T23:30:00+00:00')).toBe(2026);
    expect(yearOfClock('2027-01-01T00:30:00+00:00')).toBe(2027);
    expect(yearOfClock('2026-10-20')).toBe(2026);
    for (const none of [null, undefined, '', 'soon', '0001-01-01T00:00:00+00:00']) expect(yearOfClock(none)).toBeNull();
  });
});

describe('statusLabel', () => {
  const say = (status: ListingStatus, status_raw: string | null = null) => statusLabel({ status, status_raw });
  it('says the bucket word for every status that is not ended, whatever word the source used', () => {
    expect(say('active', 'active')).toBe('Live');
    expect(say('active', 'live')).toBe('Live');
    expect(say('upcoming', 'upcoming')).toBe('Upcoming');
    expect(say('upcoming', 'listed')).toBe('Upcoming');
    expect(say('sold', 'sold')).toBe('Sold');
    expect(say('unknown', null)).toBe('Status not recorded');
    expect(say('unknown', 'pending')).toBe('Status not recorded');
  });
  it('says how an ended listing ended, in the source\'s own word made readable', () => {
    for (const [raw, words] of [
      ['bid-goes-on', 'Bid goes on'], ['bid_goes_on', 'Bid goes on'], ['Bid Goes On', 'Bid goes on'], ['  BID-GOES-ON ', 'Bid goes on'],
      ['reserve_not_met', 'Reserve not met'], ['reserve not met', 'Reserve not met'], ['Reserve-Not-Met', 'Reserve not met'],
      ['unsold', 'Unsold'], ['withdrawn', 'Withdrawn'], ['cancelled', 'Cancelled'], ['canceled', 'Cancelled'], ['expired', 'Expired'],
    ]) expect(say('ended', raw), raw).toBe(words);
  });
  it('says Ended for any other word, or none', () => {
    for (const raw of ['ended', 'closed', 'completed', 'sold at auction', '', '   ', null, 'constructor', '__proto__', 'toString']) expect(say('ended', raw), String(raw)).toBe('Ended');
  });
  it('keeps the bucket word for the buckets', () => {
    expect(statusWord('active')).toBe('Live');
    expect(statusWord('upcoming')).toBe('Upcoming');
    expect(statusWord('sold')).toBe('Sold');
    expect(statusWord('ended')).toBe('Ended');
    expect(statusWord('unknown')).toBe('Status not recorded');
  });
});

describe('species, not names', () => {
  // One letter of each name is in a class, so this file does not hold the names it looks for.
  const NAMED = /e[b]ay|mec[u]m|craigs[l]ist|face[b]ook|barr[e]tt|goodi[n]g|bonh[a]ms|hemm[i]ngs|pcarm[a]rket|collecting ?c[a]rs|cars ?(?:&|and) ?b[i]ds|bring a tr[a]iler|\b[b]at\b/i;
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (...parts: string[]) => readFileSync(join(here, ...parts), 'utf8');
  it('names no source in the page, its reader or its stylesheet', () => {
    for (const file of ['SourceBrowse.tsx', 'sourceBrowseRead.ts', 'SourceBrowse.css']) expect(read(file), file).not.toMatch(NAMED);
  });
  it('names no source in its tests either', () => {
    for (const parts of [['SourceBrowse.test.tsx'], ['..', 'BrowseVehicles.test.tsx']]) expect(read(...parts), parts.join('/')).not.toMatch(NAMED);
  });
});
