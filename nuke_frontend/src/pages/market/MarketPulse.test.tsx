// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pulse: {} as any, movement: {} as any, taxonomy: {} as any, details: new Map() as Map<string, any>, specs: [] as any[], retry: vi.fn() }));
vi.mock('./useMarketPulse', async importOriginal => ({
  ...await importOriginal<typeof import('./useMarketPulse')>(),
  useMarketPulse: () => fixture.pulse, useSameHourReadings: () => ({ data: [] }), useInventoryTaxonomy: () => fixture.taxonomy,
}));
vi.mock('./useLotMovement', async importOriginal => ({
  ...await importOriginal<typeof import('./useLotMovement')>(), useLotMovement: () => fixture.movement,
}));
vi.mock('./AuctionEvidence', () => ({
  default: ({ vehicleId, onClose }: any) => <section id={`lot-inspection-${vehicleId}`} aria-label="Listing activity evidence">{vehicleId}<button onClick={onClose}>Close listing evidence</button></section>,
  AuctionCompetition: ({ fallback }: any) => <>{fallback}<span>Stack A bidding depth</span></>,
}));
vi.mock('./useMarketRowDetails', async importOriginal => ({
  ...await importOriginal<typeof import('./useMarketRowDetails')>(),
  useMarketRowDetails: () => ({ data: fixture.details }), useMarketRowSpecs: () => ({ data: fixture.specs }),
}));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('./RecordedSalesComparison', () => ({
  default: () => <section aria-label="Recorded sales comparison">Recorded sales chart</section>,
  MarketScopeControls: ({ make, onMakeChange, onViewChange, children }: any) => <>
    <span>Comparison scope {make ?? 'all'}</span>
    <button onClick={() => onViewChange('sales')}>Use recorded sales view</button>
    <button onClick={() => onViewChange('inventory')}>Use inventory view</button>
    <button onClick={() => onMakeChange('FORD')}>Choose Ford cohort</button>
    <button onClick={() => onMakeChange(null)}>Choose all live makes</button>
    {children}
  </>,
}));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, ...props }: any) => <a href={to} {...props} /> }));

import MarketPulse from './MarketPulse';
import { currentBidDistribution, type LiveAuction } from './useMarketPulse';


let root: Root, container: HTMLDivElement;
const HOUR = 3_600_000;
function lot(id: string, make: string, bid: number | null, hours: number): LiveAuction {
  return { id, make, currentBid: bid, endsAt: Date.now() + hours * HOUR, year: 2000, model: 'Local fixture',
    updatedAt: Date.now(), listedAt: Date.now() - 2 * HOUR, imageUrl: null, noReserve: false,
    listingUrl: `https://bringatrailer.com/listing/local-fixture-${id}/`, title: id, band: null };
}
async function render(query = '') {
  await act(async () => {
    window.history.replaceState({}, '', '/?' + query);
    window.dispatchEvent(new PopStateEvent('popstate'));
    root.render(<BrowserRouter><MarketPulse onUnavailable={<div>Existing feed fallback</div>} /></BrowserRouter>);
  });
}
function button(prefix: string) {
  const b = [...container.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent || '').startsWith(prefix));
  expect(b).toBeTruthy(); return b!;
}
async function click(prefix: string) { await act(async () => button(prefix).click()); }
function boardTitles() { return [...container.querySelectorAll<HTMLElement>('.market-lot-row')].map(a => a.dataset.vehicleId); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    private callback: (entries: Array<{ contentRect: { width: number } }>) => void;
    constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) { this.callback = callback; }
    observe() { this.callback([{ contentRect: { width: window.innerWidth } }]); }
    disconnect() {}
  });
  fixture.retry.mockReset(); fixture.details = new Map(); fixture.specs = [];
  fixture.taxonomy = { data: [], isLoading: false, isError: false, isSuccess: true, refetch: fixture.retry };
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fixture.movement = { data: [], coverage: undefined, dataUpdatedAt: Date.now() };
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  fixture.pulse = { data: { auctions: [lot('later', 'PORSCHE', 25_000, 30), lot('first', 'PORSCHE', 0, 2),
    lot('unknown', 'PORSCHE', null, 10), lot('other-make', 'FORD', 100_000, 1)], syncedAt: Date.now(), curve: null },
    isLoading: false, isError: false, risenIds: new Set(), refetch: fixture.retry, dataUpdatedAt: Date.now() };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});

describe('shareable listing evidence on the existing market route', () => {
  it('opens a stored listing before inventory controls even after it leaves the live board', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    await render('make=PORSCHE&lot=' + id);
    expect(container.querySelector('[aria-label="Listing activity evidence"]')?.textContent).toContain(id);
    expect(container.textContent?.indexOf(id)).toBeLessThan(container.textContent?.indexOf('Comparison scope')!);
    await click('Close listing evidence');
    expect(window.location.search).not.toContain('lot=');
    expect(window.location.search).toContain('make=PORSCHE');
  });
  it('ignores invalid IDs and keeps evidence readable if the live board fails', async () => {
    await render('lot=invalid');
    expect(container.querySelector('[aria-label="Listing activity evidence"]')).toBeNull();
    fixture.pulse.data = undefined; fixture.pulse.isError = true;
    await render('lot=46dd9cc6-20ec-47cb-a563-159a8005115c');
    expect(container.querySelector('[aria-label="Listing activity evidence"]')).toBeTruthy();
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('market answer -> supporting lots', () => {
  async function choose(label: string, value: string) {
    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
      select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  it('nests years inside their own brand, shares the selection, and restores it from the URL', async () => {
    fixture.pulse.data.auctions[0].year = 1995;
    await render(); await choose('Inventory sub-boxes', 'year');
    const region = container.querySelector('[data-map-group="PORSCHE"]')!;
    await act(async () => region.querySelector<HTMLButtonElement>('button[aria-label^="2000:"]')!.click());
    expect(window.location.search).toContain('mapFocus=PORSCHE');
    expect(window.location.search).toContain('mapChild=2000');
    expect(boardTitles()).toEqual(['first', 'unknown']);
    await render(window.location.search.slice(1));
    expect(boardTitles()).toEqual(['first', 'unknown']);
    await click('Clear sub-box selection');
    expect(boardTitles()).toEqual(['first', 'unknown', 'later']);
    await choose('Group inventory by', 'era');
    expect(window.location.search).not.toContain('mapFocus');
    expect(window.location.search).not.toContain('mapChild');
    await click('1990–1999:'); expect(boardTitles()).toEqual(['later']);
  });
  it('opens an individual lot in the existing evidence route without a nested button', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    fixture.pulse.data.auctions[0].id = id;
    await render(); await choose('Inventory sub-boxes', 'lot');
    expect(container.querySelector('.inventory-map button button')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(`[data-map-lot="${id}"]`)!.click());
    expect(window.location.search).toContain(`lot=${id}`);
    expect(container.querySelector('[aria-label="Listing activity evidence"]')?.textContent).toContain(id);
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.nextElementSibling?.id).toBe(`lot-inspection-${id}`);
    expect(document.activeElement).toBe(row.querySelector('.market-lot-name'));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });
  it('keeps smaller brands reachable and drills from an explicit brand view into models', async () => {
    fixture.pulse.data.auctions = [...fixture.pulse.data.auctions,
      ...Array.from({ length: 80 }, (_, i) => lot(`small-${i}`, `SMALL ${i}`, null, 1))];
    await render('mapBy=make');
    const more = container.querySelector<HTMLButtonElement>('[data-map-more]')!;
    expect(more.textContent).toContain('more brands');
    await act(async () => more.click());
    const list = container.querySelector('.inventory-map-list-grid')!;
    expect(list.textContent).toContain('SMALL 79');
    await act(async () => list.querySelector<HTMLButtonElement>('button[aria-label^="SMALL 79:"]')!.click());
    expect(window.location.search).toContain('make=SMALL+79');
    expect((container.querySelector('select[aria-label="Group inventory by"]') as HTMLSelectElement).value).toBe('model');
    expect(boardTitles()).toEqual(['small-79']);
    await click('All captured makes');
    expect(boardTitles()).toHaveLength(24);
    expect(container.textContent).toContain('1–24 of 84 lots');
    expect(container.querySelector('.inventory-map-remainder')).toBeNull();
    await click('Next 24 lots');
    expect(window.location.search).toContain('board=2');
    expect(boardTitles()).toHaveLength(24);
    expect(boardTitles()[0]).toBe('small-23');
    await render('mapBy=make&make=all&board=4');
    expect(boardTitles()).toHaveLength(12);
    expect(container.textContent).toContain('73–84 of 84 lots');
    expect(container.querySelector('[aria-label="Next 24 lots"]')).toBeNull();
    await click('Ending < 24 h');
    expect(window.location.search).toContain('board=1');
  });
  it('opens a shared lot on the page that holds it and returns to the first page by link', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    fixture.pulse.data.auctions = [...Array.from({ length: 30 }, (_, i) => lot(`early-${i}`, 'PORSCHE', null, 1)),
      { ...lot(id, 'PORSCHE', 1000, 2), year: 1999, model: '911' }];
    await render(`lot=${id}&inspect=auction`);
    expect(boardTitles()).toHaveLength(7);
    expect(container.textContent).toContain('25–31 of 31 lots');
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.nextElementSibling?.id).toBe(`lot-inspection-${id}`);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    await click('Previous 24 lots');
    expect(window.location.search).toContain('board=1');
    expect(window.location.search).not.toContain('lot=');
    expect(boardTitles()).toHaveLength(24);
    expect(container.querySelector('[aria-label="Previous 24 lots"]')).toBeNull();
  });
  it('returns from a model sub-box to the whole model and recovers a group that disappeared', async () => {
    await render('make=PORSCHE&mapInside=year&mapFocus=' + encodeURIComponent(JSON.stringify(['PORSCHE', 'Local fixture'])) + '&mapChild=2000');
    await click('Local fixture: 3 captured lots');
    expect(window.location.search).not.toContain('mapChild');
    expect(window.location.search).not.toContain('mapFocus');
    expect(boardTitles()).toEqual(['first', 'unknown', 'later']);
    await render('mapBy=year&mapFocus=1901');
    expect(container.textContent).toContain('No captured lots remain in this map group');
    await click('Show all map groups');
    expect(boardTitles()).toEqual(['other-make', 'first', 'unknown', 'later']);
  });
  it('keeps unrecorded taxonomy visible and distinguishes a failed metadata read', async () => {
    fixture.taxonomy.data = [{ id: 'later', listing_url: fixture.pulse.data.auctions[0].listingUrl, canonical_vehicle_type: 'CAR', canonical_body_style: 'COUPE' }];
    await render(); await choose('Group inventory by', 'type');
    await click('Unrecorded: 3'); expect(boardTitles()).toEqual(['other-make', 'first', 'unknown']);
    fixture.taxonomy.isError = true; fixture.taxonomy.isSuccess = false;
    await render('mapBy=type');
    expect(container.textContent).toContain('classifications could not be loaded');
    expect(container.querySelector('.inventory-map-canvas button')).toBeNull();
    await click('Retry classifications'); expect(fixture.retry).toHaveBeenCalledOnce();
  });
  it('pulses changed lots without moving them and allows motion to be disabled', async () => {
    await render('mapInside=lot');
    const positions = () => [...container.querySelectorAll('[data-map-lot]')].map(el => [el.getAttribute('data-map-lot'), el.getAttribute('style')]);
    const before = positions();
    fixture.pulse.data = { ...fixture.pulse.data, auctions: [...fixture.pulse.data.auctions].reverse() };
    fixture.pulse.risenIds = new Set(['later']);
    await render('mapInside=lot');
    expect(positions()).toEqual(before);
    expect(container.querySelector('[data-map-lot="later"]')?.classList.contains('inventory-map-pulse')).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('.inventory-map-pulse-control input')!.click());
    expect(container.querySelector('.inventory-map-pulse')).toBeNull();
  });
  it('drills recorded model labels into exactly their records and replaces inventory when switching views', async () => {
    fixture.pulse.data.auctions[0].model = 'Recorded model A';
    fixture.pulse.data.auctions[1].model = 'Recorded model B';
    fixture.pulse.data.auctions[2].model = 'Recorded model B';
    await render('make=PORSCHE');
    await click('Recorded model B: 2 captured lots');
    expect(window.location.search).toContain('model=Recorded+model+B');
    expect(boardTitles()).toEqual(['first', 'unknown']);
    expect(container.querySelector('[aria-label="Inventory drill path"]')?.textContent).toContain('Recorded model: Recorded model B');
    await click('Use recorded sales view');
    expect(window.location.search).toContain('view=sales');
    expect(window.location.search).not.toContain('model=');
    expect(container.querySelector('[aria-label="Supporting live lots"]')).toBeNull();
    await click('Use inventory view');
    expect(boardTitles()).toEqual(['first', 'unknown', 'later']);
  });
  it('attaches its map observer when an initially loading population becomes available', async () => {
    const data = fixture.pulse.data; fixture.pulse.data = undefined; fixture.pulse.isLoading = true;
    await render('make=all');
    expect(container.querySelector('button[aria-label="PORSCHE: 3 captured live lots"]')).toBeNull();
    fixture.pulse.data = data; fixture.pulse.isLoading = false; await render();
    expect(container.querySelector('button[aria-label="PORSCHE: 3 captured live lots"]')).toBeTruthy();
  });
  it('uses one comparison make for the live board and keeps the optional bid ranges collapsed', async () => {
    await render();
    expect(container.textContent).toContain('Comparison scope all');
    expect(container.querySelector('[aria-label="Live lot make"]')).toBeNull();
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.closest('details')?.open).toBe(false);
    await click('Choose Ford cohort');
    expect(window.location.search).toContain('make=FORD');
    expect(boardTitles().slice(-1)).toEqual(['other-make']);
    await click('Choose all live makes');
    expect(window.location.search).toContain('make=all');
    expect(button('Live lots').textContent).toContain('4');
  });
  it('keeps unknown separate from zero and assigns each boundary exactly once', () => {
    const bids = [null, 0, 9_999, 10_000, 24_999, 25_000, 49_999, 50_000, 99_999, 100_000, NaN, -1];
    const d = currentBidDistribution(bids.map((bid, i) => lot(String(i), 'PORSCHE', bid, 1)));
    expect(d.counts).toEqual({ under10k: 2, '10k25k': 2, '25k50k': 2, '50k100k': 2, '100kplus': 1, unknown: 3 });
    expect(d.recorded).toBe(9); expect(d.median).toBe(25_000);
    expect(Object.values(d.counts).reduce((a, b) => a + b, 0)).toBe(bids.length);
    expect(currentBidDistribution([lot('missing', 'PORSCHE', null, 1)]).median).toBeNull();
  });
  it('uses the make for headline denominator and graph, opens all supporting lots in close order', async () => {
    await render('make=PORSCHE');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.textContent).toContain('2 of 3 lots');
    expect(container.textContent).toContain('source currency unknown');
    expect(container.textContent).not.toContain('USD');
    expect(container.textContent).not.toContain('$');
    expect(button('Live lots').textContent).toContain('3');
    expect(container.textContent).toContain('3 of 4 captured BaT vehicle lots');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.textContent).toContain('2 of 3 lots');
    await click('Live lots');
    expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
    expect(window.location.search).toContain('board=1');
  });
  it('drills a graph range into exactly its lots, preserves make, and toggles back', async () => {
    await render('make=PORSCHE'); await click('25,000–49,999:');
    expect(window.location.search).toContain('make=PORSCHE');
    expect(boardTitles()).toEqual(['later']);
    expect(button('25,000–49,999:').getAttribute('aria-pressed')).toBe('true');
    await click('25,000–49,999:'); expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
  });
  it('drills unknown bids without treating them as zero and scopes the graph to the window', async () => {
    await render('make=PORSCHE'); await click('Unrecorded:');
    expect(boardTitles()).toEqual(['unknown']);
    await click('Ending < 24 h');
    expect(window.location.search).not.toContain('bidRange');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.textContent).toContain('1 of 2 lots');
    expect(container.querySelector('button[aria-label="Local fixture: 2 captured lots. Filter this recorded model"]')).toBeTruthy();
    expect(container.querySelector('a[href*="bringatrailer.com/listing"]')).toBeNull();
    expect(container.textContent).toContain('Source read time and bid event time are unavailable');
  });
  it('makes an empty scope recoverable and does not display a zero median', async () => {
    await render('make=MISSING');
    expect(container.textContent).toContain('No open lots match these filters');
    expect(container.textContent).toContain('0 of 0 lots have a recorded bid number');
    expect(container.textContent).not.toContain('Median current bid');
    await click('Clear market filters'); expect(button('Live lots').textContent).toContain('4');
  });
  it('distinguishes loading, failure, and a failed refresh with previously fetched data', async () => {
    fixture.pulse.data = undefined; fixture.pulse.isLoading = true;
    await render(); expect(button('Live lots').textContent).toContain('…');
    expect(container.querySelector('[aria-label="Current bid distribution"]')).toBeNull();
    fixture.pulse.isLoading = false; fixture.pulse.isError = true;
    await render(); expect(container.textContent).toContain('could not be loaded');
    await click('Retry live board'); expect(fixture.retry).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Existing feed fallback');
    fixture.pulse.data = { auctions: [lot('cached', 'PORSCHE', 10_000, 2)] };
    await render('make=PORSCHE'); expect(container.textContent).toContain('Refresh failed');
    expect(container.textContent).toContain('1 of 1 lots have a recorded bid number');
  });
  it('withholds monetary heat and histories without comparable source units', async () => {
    fixture.pulse.data.curve = { fixture: [[120, 0.2], [0, 1]] };
    fixture.pulse.data.auctions[0].band = { p10: 100, p50: 500, p90: 1000, comps: 100, tier: 'fixture' };
    fixture.pulse.data.weekAgo = { bids: 12345, byMake: {}, n: 10, day: '2026-09-26', source: 'live' };
    await render('make=PORSCHE&live=hot&sort=hottest');
    expect(container.textContent).not.toMatch(/Running hot|Running cold|vs last week|Current bid per auction|Median current bid/);
    expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
    await click('All captured makes');
    expect(container.textContent).toContain('Box size = number of open lots');
  });
});


describe('the market document', () => {
  it('names the population once, counts the cohort in the masthead and states its coverage in the strip', async () => {
    await render('make=PORSCHE');
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toBe('Open lots');
    expect(h1.className).toContain('k-entity');
    expect(container.querySelector('.k-masthead__result .k-measure')?.textContent).toBe('3');
    expect(container.querySelector('.k-masthead__result .k-caption')?.textContent).toMatch(/^recorded /);
    expect(container.querySelector('[aria-label="Market scope"] .k-coverage')?.textContent).toContain('3 of 4 captured BaT vehicle lots');
    expect(container.textContent?.match(/Market explorer|Market cohort|captured vehicle auctions/)).toBeNull();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    await click('Use recorded sales view');
    expect(container.querySelector('h1')?.textContent).toBe('Recorded sales');
    expect(container.querySelector('.k-masthead__result')).toBeNull();
    expect(container.textContent).toContain('Recorded sales chart');
  });
  it('keeps the scope strip and the masthead when the live board cannot be read', async () => {
    fixture.pulse.data = undefined; fixture.pulse.isLoading = false; fixture.pulse.isError = true;
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('Open lots');
    expect(container.querySelector('[aria-label="Market scope"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Market scope"] .k-coverage')).toBeNull();
  });
});

describe('inline market row inspection', () => {
  it('keeps the inspected row under its panel when its deadline passes and a refresh removes it', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    const selected = { ...lot(id, 'BMW', 42000, .01), year: 2004, model: 'M3' };
    fixture.pulse.data.auctions = [selected, lot('later', 'BMW', 5000, 4)];
    await render(); await click('Inspect auction for 2004 BMW M3');
    await act(async () => { vi.advanceTimersByTime(60_000); });
    fixture.pulse.data = { ...fixture.pulse.data, auctions: [fixture.pulse.data.auctions[1]] };
    await render(window.location.search.slice(1));
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.textContent).toContain('Awaiting result');
    expect(row.nextElementSibling?.id).toBe(`lot-inspection-${id}`);
    await click('Close listing evidence');
    expect(container.querySelector(`[data-vehicle-id="${id}"]`)).toBeNull();
  });
  it('uses structured identity and opens beneath the clicked row without an outbound primary action', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    fixture.pulse.data.auctions[1] = { ...lot(id, 'BMW', 42000, 2), year: 2004, model: 'M3', title: 'Arbitrary promotional headline' };
    fixture.details.set(id, { id, location: 'CA · 90210', bidCount: 24, watchers: 432, lastBidAt: '2026-10-03T11:58:00Z' });
    fixture.specs = [{ field: 'transmission', value: '6-speed manual', rooted: true }];
    await render();
    expect(container.textContent).toContain('2004 BMW M3');
    expect(container.textContent).not.toContain('Arbitrary promotional headline');
    expect(container.textContent).toContain('6-speed manual');
    expect(container.textContent).toContain('CA · 90210');
    expect(container.querySelector(`[data-vehicle-id="${id}"] .market-lot-metrics`)?.textContent).toContain('Stack A bidding depth');
    expect(container.querySelector('a[href*="bringatrailer.com/listing"]')).toBeNull();
    await click('Inspect auction for 2004 BMW M3');
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.nextElementSibling?.getAttribute('id')).toBe(`lot-inspection-${id}`);
    expect(window.location.search).toContain('inspect=auction');
    await click('Inspect transmission for 2004 BMW M3');
    expect(window.location.search).toContain('inspect=vehicle');
    await click('Sources for 2004 BMW M3');
    expect(window.location.search).toContain('inspect=sources');
    await click('Close listing evidence');
    expect(window.location.search).not.toContain('lot=');
    expect(document.activeElement).toBe(row.querySelector('.market-lot-name'));
  });
});
