// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ share: { data: undefined as any, isError: false }, pulse: {} as any, movement: {} as any, taxonomy: {} as any, details: new Map() as Map<string, any>, specs: [] as any[], retry: vi.fn(), sameHour: [] as any[], finish: new Map() as Map<string, any>, track: undefined as any, calendar: { data: undefined } as any, rosterFor: vi.fn() }));
vi.mock('./useAuctionCalendar', async importOriginal => ({
  ...await importOriginal<typeof import('./useAuctionCalendar')>(),
  useAuctionCalendar: () => fixture.calendar,
  useSaleRoster: (sale: any) => { fixture.rosterFor(sale); return { isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false,
    data: { pages: [{ roster: { lots: 2, rows: [
      { event_id: 'r1', vehicle_id: 'rv1', run_on: '2026-10-08', year: 1967, make: 'Porsche', model: '911', prior: [], vin_present: true },
      { event_id: 'r2', vehicle_id: 'rv2', run_on: '2026-10-08', year: 1970, make: 'Ford', model: 'Mustang', prior: [], vin_present: true },
    ] } }] } }; },
}));
vi.mock('./HouseShare', async importOriginal => ({
  ...await importOriginal<typeof import('./HouseShare')>(),
  useHouseShare: () => fixture.share,
}));
vi.mock('./useFinishEstimates', async importOriginal => ({
  ...await importOriginal<typeof import('./useFinishEstimates')>(),
  useFinishEstimates: () => ({ data: { fresh: true, writerAt: null, byId: fixture.finish } }), useFinishTrackRecord: () => ({ data: fixture.track }),
}));
vi.mock('./useMarketPulse', async importOriginal => ({
  ...await importOriginal<typeof import('./useMarketPulse')>(),
  useMarketPulse: () => fixture.pulse, useSameHourReadings: () => ({ data: fixture.sameHour }), useInventoryTaxonomy: () => fixture.taxonomy,
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

import MarketPulse, { closeGroup, matchesFamilyScope } from './MarketPulse';
import { currentBidDistribution, type LiveAuction } from './useMarketPulse';


let root: Root, container: HTMLDivElement;
const HOUR = 3_600_000;
function lot(id: string, make: string, bid: number | null, hours: number): LiveAuction {
  return { id, make, currentBid: bid, endsAt: Date.now() + hours * HOUR, year: 2000, model: 'Local fixture',
    updatedAt: Date.now(), listedAt: Date.now() - 2 * HOUR, imageUrl: null, noReserve: false,
    listingUrl: `https://bringatrailer.com/listing/local-fixture-${id}/`, title: id, band: null, house: 'bringatrailer', currency: 'USD' };
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
// The open-lot count is the second figure; the first is the dollars bid now.
function cohortCount() { return container.querySelectorAll('.market-figure .k-figure')[1]?.textContent; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    private callback: (entries: Array<{ contentRect: { width: number } }>) => void;
    constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) { this.callback = callback; }
    observe() { this.callback([{ contentRect: { width: window.innerWidth } }]); }
    disconnect() {}
  });
  fixture.calendar = { data: undefined }; fixture.rosterFor.mockReset();
  fixture.retry.mockReset(); fixture.details = new Map(); fixture.specs = []; fixture.finish = new Map(); fixture.track = undefined;
  fixture.taxonomy = { data: [], isLoading: false, isError: false, isSuccess: true, refetch: fixture.retry };
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fixture.movement = { data: [], coverage: undefined, dataUpdatedAt: Date.now() };
  fixture.sameHour = [];
  fixture.share = { data: undefined, isError: false };
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
    await render('map=lots'); await choose('Inventory sub-boxes', 'year');
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
  it('shows the decades inside a brand box before the drill is taken, and keeps the chosen sub-box option', async () => {
    fixture.pulse.data.auctions[0].year = 1995;
    await render('map=lots');
    expect((container.querySelector('select[aria-label="Inventory sub-boxes"]') as HTMLSelectElement).value).toBe('era');
    const porsche = container.querySelector('[data-map-group="PORSCHE"]')!;
    expect(porsche.querySelector('button[aria-label^="1990–1999: 1 captured lots"]')).toBeTruthy();
    expect(porsche.querySelector('button[aria-label^="2000–2009: 2 captured lots"]')).toBeTruthy();
    await choose('Inventory sub-boxes', 'none');
    expect(window.location.search).toContain('mapInside=none');
    expect(container.querySelector('[data-map-group="PORSCHE"] .inventory-map-child')).toBeNull();
  });
  it('keeps every model as a cell inside its brand instead of folding them into a list box', async () => {
    fixture.pulse.data.auctions = [...fixture.pulse.data.auctions,
      ...Array.from({ length: 60 }, (_, i) => ({ ...lot(`p-${i}`, 'PORSCHE', null, 1), model: `Model ${i}` })),
      ...Array.from({ length: 12 }, (_, i) => lot(`f-${i}`, 'FORD', null, 1))];
    await render('map=lots&mapInside=model');
    const porsche = container.querySelector('[data-map-group="PORSCHE"]')!;
    expect(porsche.querySelectorAll('.inventory-map-child')).toHaveLength(61);
    expect(porsche.textContent).not.toContain('more models');
    expect(porsche.querySelector('button[aria-label^="Local fixture: 3 captured lots"]')).toBeTruthy();
  });
  it('opens an individual lot in the existing evidence route without a nested button', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    fixture.pulse.data.auctions[0].id = id;
    await render('map=lots'); await choose('Inventory sub-boxes', 'lot');
    expect(container.querySelector('.inventory-map button button')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(`[data-map-lot="${id}"]`)!.click());
    expect(window.location.search).toContain(`lot=${id}`);
    expect(container.querySelector('[aria-label="Listing activity evidence"]')?.textContent).toContain(id);
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.nextElementSibling?.id).toBe(`lot-inspection-${id}`);
    expect(document.activeElement).toBe(row.querySelector('.market-lot-image'));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });
  it('keeps smaller brands reachable and drills from an explicit brand view into models', async () => {
    fixture.pulse.data.auctions = [...fixture.pulse.data.auctions,
      ...Array.from({ length: 80 }, (_, i) => lot(`small-${i}`, `SMALL ${i}`, null, 1))];
    await render('map=lots&mapBy=make');
    const more = container.querySelector<HTMLButtonElement>('[data-map-more]')!;
    expect(more.textContent).toContain('more brands');
    // The tail keeps its area: every small brand is a cell of its own inside the box, sized by its lots.
    const tail = more.closest('.inventory-map-region')!;
    const folded = Number(more.textContent!.match(/(\d+) more brands/)![1]);
    expect(folded).toBeGreaterThan(60);
    expect(tail.querySelectorAll('.inventory-map-child')).toHaveLength(folded);
    expect(tail.querySelector('button[aria-label^="SMALL 79:"]')).toBeTruthy();
    expect(container.querySelector('.inventory-map-more-preview')).toBeNull();
    await act(async () => tail.querySelector<HTMLButtonElement>('button[aria-label^="SMALL 78:"]')!.click());
    expect(window.location.search).toContain('make=SMALL+78');
    expect(boardTitles()).toEqual(["small-78"]);
    await click('All makes');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-map-more]')!.click());
    const list = container.querySelector('.inventory-map-list-grid')!;
    expect(list.textContent).toContain('SMALL 79');
    await act(async () => list.querySelector<HTMLButtonElement>('button[aria-label^="SMALL 79:"]')!.click());
    expect(window.location.search).toContain('make=SMALL+79');
    expect((container.querySelector('select[aria-label="Group inventory by"]') as HTMLSelectElement).value).toBe('era');
    expect(boardTitles()).toEqual(['small-79']);
    await click('All makes');
    expect(boardTitles()).toHaveLength(24);
    expect(container.textContent).toContain('Loading more · 24 of 84');
    expect(container.querySelector('.inventory-map-remainder')).toBeNull();
    await click('Loading more');
    expect(window.location.search).toContain('board=2');
    expect(boardTitles()).toHaveLength(48);
    expect(boardTitles()[24]).toBe('small-23');
    await render('map=lots&mapBy=make&make=all&board=4');
    expect(boardTitles()).toHaveLength(84);
    expect(container.textContent).toContain('All 84 lots shown');
    expect([...container.querySelectorAll('button')].some(b => b.textContent?.startsWith('Loading more'))).toBe(false);
    await click('Ending in 24 h');
    expect(window.location.search).toContain('board=1');
  });
  it('loads a shared lot with every lot ahead of it and opens it beneath its row', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    fixture.pulse.data.auctions = [...Array.from({ length: 30 }, (_, i) => lot(`early-${i}`, 'PORSCHE', null, 1)),
      { ...lot(id, 'PORSCHE', 1000, 2), year: 1999, model: '911' }];
    await render(`lot=${id}&inspect=auction`);
    expect(boardTitles()).toHaveLength(31);
    expect(container.textContent).toContain('All 31 lots shown');
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.nextElementSibling?.id).toBe(`lot-inspection-${id}`);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });
  it('adds the next lots under the ones shown, keeping the filters and the viewer\'s focus', async () => {
    fixture.pulse.data.auctions = Array.from({ length: 60 }, (_, i) => lot(`page-${i}`, 'PORSCHE', 1000 + i, i + 1));
    await render('make=PORSCHE&sort=ending');
    expect(boardTitles()).toHaveLength(24);
    const control = button('Bid sounds off'); control.focus();
    await click('Loading more');
    expect(window.location.search).toContain('board=2');
    expect(window.location.search).toContain('make=PORSCHE');
    expect(window.location.search).toContain('sort=ending');
    expect(boardTitles()).toHaveLength(48);
    expect(boardTitles()[0]).toBe('page-0');
    expect(document.activeElement).toBe(control);
    await click('Loading more');
    expect(boardTitles()).toHaveLength(60);
    expect(container.textContent).toContain('All 60 lots shown');
  });
  it('returns from a model sub-box to the whole model and recovers a group that disappeared', async () => {
    await render('map=lots&make=PORSCHE&mapBy=model&mapInside=year&mapFocus=' + encodeURIComponent(JSON.stringify(['PORSCHE', 'Local fixture'])) + '&mapChild=2000');
    await click('Local fixture: 3 captured lots');
    expect(window.location.search).not.toContain('mapChild');
    expect(window.location.search).not.toContain('mapFocus');
    expect(boardTitles()).toEqual(['first', 'unknown', 'later']);
    await render('map=lots&mapBy=year&mapFocus=1901');
    expect(container.textContent).toContain('No captured lots remain in this map group');
    await click('Show all map groups');
    expect(boardTitles()).toEqual(['other-make', 'first', 'unknown', 'later']);
  });
  it('keeps unrecorded taxonomy visible and distinguishes a failed metadata read', async () => {
    fixture.taxonomy.data = [{ id: 'later', listing_url: fixture.pulse.data.auctions[0].listingUrl, canonical_vehicle_type: 'CAR', canonical_body_style: 'COUPE' }];
    await render('map=lots'); await choose('Group inventory by', 'type');
    await click('Unrecorded: 3'); expect(boardTitles()).toEqual(['other-make', 'first', 'unknown']);
    fixture.taxonomy.isError = true; fixture.taxonomy.isSuccess = false;
    await render('map=lots&mapBy=type');
    expect(container.textContent).toContain('classifications could not be loaded');
    expect(container.querySelector('.inventory-map-canvas button')).toBeNull();
    await click('Retry classifications'); expect(fixture.retry).toHaveBeenCalledOnce();
  });
  it('pulses changed lots without moving them and allows motion to be disabled', async () => {
    await render('map=lots&mapInside=lot');
    const positions = () => [...container.querySelectorAll('[data-map-lot]')].map(el => [el.getAttribute('data-map-lot'), el.getAttribute('style')]);
    const before = positions();
    fixture.pulse.data = { ...fixture.pulse.data, auctions: [...fixture.pulse.data.auctions].reverse() };
    fixture.pulse.risenIds = new Set(['later']);
    await render('map=lots&mapInside=lot');
    expect(positions()).toEqual(before);
    expect(container.querySelector('[data-map-lot="later"]')?.classList.contains('inventory-map-pulse')).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>('.inventory-map-pulse-control input')!.click());
    expect(container.querySelector('.inventory-map-pulse')).toBeNull();
  });
  it('rings a bell for each new bid only after the viewer turns bid sounds on', async () => {
    const tones: number[] = [];
    class FakeAudio {
      state = 'running'; currentTime = 0; destination = {};
      resume() { return Promise.resolve(); }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: any) => d }; }
      createOscillator() { return { type: '', frequency: { set value(v: number) { tones.push(v); } }, connect: (g: any) => g, start() {}, stop() {} }; }
    }
    vi.stubGlobal('AudioContext', FakeAudio);
    fixture.pulse.newBids = [{ id: 'b1', vehicleId: 'later', amount: 26_000, bidAt: Date.now(), endAt: null }];
    await render();
    expect(button('Bid sounds off').getAttribute('aria-pressed')).toBe('false');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(tones).toEqual([]);
    await click('Bid sounds off');
    expect(button('Bid sounds on').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(tones.length).toBeGreaterThan(0);
    await click('Bid sounds on');
    expect(button('Bid sounds off').getAttribute('aria-pressed')).toBe('false');
  });
  it('drills recorded model labels into exactly their records and replaces inventory when switching views', async () => {
    fixture.pulse.data.auctions[0].model = 'Recorded model A';
    fixture.pulse.data.auctions[1].model = 'Recorded model B';
    fixture.pulse.data.auctions[2].model = 'Recorded model B';
    await render('map=lots&make=PORSCHE&mapBy=model');
    await click('Recorded model B: 2 captured lots');
    expect(window.location.search).toContain('model=Recorded+model+B');
    expect(boardTitles()).toEqual(['first', 'unknown']);
    expect(container.querySelector('[aria-label="Inventory drill path"]')?.textContent).toContain('Recorded model B');
    await click('Use recorded sales view');
    expect(window.location.search).toContain('view=sales');
    expect(window.location.search).not.toContain('model=');
    expect(container.querySelector('[aria-label="Live lots"]')).toBeNull();
    await click('Use inventory view');
    expect(boardTitles()).toEqual(['first', 'unknown', 'later']);
  });
  it('attaches its map observer when an initially loading population becomes available', async () => {
    const data = fixture.pulse.data; fixture.pulse.data = undefined; fixture.pulse.isLoading = true;
    await render('map=lots&make=all');
    expect(container.querySelector('button[aria-label="PORSCHE: 3 captured live lots"]')).toBeNull();
    fixture.pulse.data = data; fixture.pulse.isLoading = false; await render('map=lots');
    expect(container.querySelector('button[aria-label="PORSCHE: 3 captured live lots"]')).toBeTruthy();
  });
  it('uses one comparison make for the live board and keeps the optional bid ranges collapsed', async () => {
    await render();
    expect(container.textContent).toContain('Comparison scope all');
    expect(container.querySelector('[aria-label="Live lot make"]')).toBeNull();
    expect(container.querySelector('[aria-label="Current bid distribution"]')).toBeTruthy();
    await click('Choose Ford cohort');
    expect(window.location.search).toContain('make=FORD');
    expect(boardTitles().slice(-1)).toEqual(['other-make']);
    await click('Choose all live makes');
    expect(window.location.search).toContain('make=all');
    expect(cohortCount()).toBe('4');
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Live lots')).toBe(false);
    expect(container.querySelector('[aria-label="Filter the lots"]')?.textContent).not.toContain('Ending in 1 h');
  });
  it('keeps unknown separate from zero and assigns each boundary exactly once', () => {
    const bids = [null, 0, 9_999, 10_000, 24_999, 25_000, 49_999, 50_000, 99_999, 100_000, NaN, -1];
    const d = currentBidDistribution(bids.map((bid, i) => lot(String(i), 'PORSCHE', bid, 1)));
    expect(d.counts).toEqual({ under10k: 2, '10k25k': 2, '25k50k': 2, '50k100k': 2, '100kplus': 1, unknown: 3, otherCurrency: 0 });
    expect(d.recorded).toBe(9); expect(d.median).toBe(25_000);
    expect(Object.values(d.counts).reduce((a, b) => a + b, 0)).toBe(bids.length);
    expect(currentBidDistribution([lot('missing', 'PORSCHE', null, 1)]).median).toBeNull();
  });
  it('uses the make for headline denominator and graph, opens all supporting lots in close order', async () => {
    await render('make=PORSCHE');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.getAttribute('title')).toBe('2 of 3 lots have a bid in US dollars, recorded or converted at a published rate');
    expect(container.textContent).toContain("the bid's hover gives the rate, its publisher and its date");
    expect(container.querySelector('.market-bid')?.textContent).toMatch(/^\$[\d,]+$/);
    expect(cohortCount()).toBe('3');
    expect(container.querySelector('.market-board__scope')?.textContent).toBe('3 of 4 live lotsPorsche');
    await click('Ending in 24 h');
    expect(button('Ending in 24 h').getAttribute('aria-pressed')).toBe('true');
    await click('Ending in 24 h');
    expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
    expect(window.location.search).toContain('board=1');
  });
  it('drills a graph range into exactly its lots, preserves make, and toggles back', async () => {
    await render('make=PORSCHE'); await click('$25K–50K:');
    expect(window.location.search).toContain('make=PORSCHE');
    expect(boardTitles()).toEqual(['later']);
    expect(button('$25K–50K:').getAttribute('aria-pressed')).toBe('true');
    await click('$25K–50K:'); expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
  });
  it('drills unknown bids without treating them as zero and scopes the graph to the window', async () => {
    await render('map=lots&make=PORSCHE&mapBy=model'); await click('No bid recorded:');
    expect(boardTitles()).toEqual(['unknown']);
    await click('Ending in 24 h');
    expect(window.location.search).not.toContain('bidRange');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.getAttribute('title')).toBe('1 of 2 lots have a bid in US dollars, recorded or converted at a published rate');
    expect(container.querySelector('button[aria-label="Local fixture: 2 captured lots. Filter this recorded model"]')).toBeTruthy();
    expect(container.querySelector('a[href*="bringatrailer.com/listing"]')).toBeNull();
    expect(container.textContent).toContain('a bid can trail the house by a few minutes');
  });
  it('makes an empty scope recoverable and does not display a zero median', async () => {
    await render('make=MISSING');
    expect(container.textContent).toContain('No open lots match these filters');
    expect(container.textContent).toContain('No open lots in this scope.');
    expect(container.textContent).not.toContain('Median current bid');
    await click('Clear market filters'); expect(cohortCount()).toBe('4');
  });
  it('distinguishes loading, failure, and a failed refresh with previously fetched data', async () => {
    fixture.pulse.data = undefined; fixture.pulse.isLoading = true;
    await render(); expect(cohortCount()).toBe('…');
    expect(container.querySelector('[aria-label="Current bid distribution"]')).toBeNull();
    fixture.pulse.isLoading = false; fixture.pulse.isError = true;
    await render(); expect(container.textContent).toContain('could not be loaded');
    await click('Retry live board'); expect(fixture.retry).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Existing feed fallback');
    fixture.pulse.data = { auctions: [lot('cached', 'PORSCHE', 10_000, 2)] };
    await render('make=PORSCHE'); expect(container.textContent).toContain('Refresh failed');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.getAttribute('title')).toBe('1 of 1 lots have a bid in US dollars, recorded or converted at a published rate');
  });
  it('shows no hot or cold verdict, and marks no reserve in the row and in the filters', async () => {
    fixture.pulse.data.curve = { fixture: [[120, 0.2], [0, 1]] };
    fixture.pulse.data.auctions[0].band = { p10: 100, p50: 500, p90: 1000, comps: 100, tier: 'fixture' }; // once tagged hot
    fixture.pulse.data.auctions[0].noReserve = true;
    await render('make=PORSCHE');
    expect(container.textContent).not.toMatch(/Running (hot|cold)|Hottest|Coldest/);
    expect(container.querySelector('.market-heat')).toBeNull();
    expect(container.querySelector('[data-vehicle-id="later"] .market-no-reserve')?.textContent).toBe('No reserve');
    expect(container.querySelector('[data-vehicle-id="first"] .market-no-reserve')).toBeNull();
    expect(button('No reserve').className).toContain('market-option--nr');
    await click('No reserve');
    expect(boardTitles()).toEqual(['later']);
  });
  it('says the source once, as the venue, and not on each row', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('Live auctions');
    expect(container.querySelector('.market-venue__marks')?.getAttribute('aria-label')).toBe('BaT');
    expect(container.querySelector('.market-venue__mark')).toBeNull();
    expect(container.textContent).not.toContain('Source: BaT');
    expect(container.textContent).not.toContain('differing specification reports');
  });
});


describe('a family keeps its numbered members on the live board', () => {
  const live = (make: string, model: string, title = `2022 ${make} ${model}`) => ({ ...lot('x', make, 1000, 2), model, title });
  it('keeps name-plus-number members of a family', () => {
    expect(matchesFamilyScope(live('Lexus', 'LC500 Convertible'), 'LC')).toBe(true);
    expect(matchesFamilyScope(live('Lexus', '', '2022 Lexus LC500 Convertible Inspiration Series'), 'LC')).toBe(true);
    expect(matchesFamilyScope(live('Ford', 'F-150 XLT'), 'F-Series')).toBe(true);
    expect(matchesFamilyScope(live('Ford', 'F250'), 'F-Series')).toBe(true);
    expect(matchesFamilyScope(live('BMW', '328i'), '3 Series')).toBe(true);
    expect(matchesFamilyScope(live('Chevrolet', 'C10'), 'C/K')).toBe(true);
    expect(matchesFamilyScope(live('Chevrolet', 'K20 Scottsdale'), 'C/K')).toBe(true);
    expect(matchesFamilyScope(live('Lexus', 'LC 500'), 'LC')).toBe(true);
  });
  it('does not pull in another family that only contains the letters', () => {
    expect(matchesFamilyScope(live('Ford', 'Mustang Shelby GT350'), 'GT')).toBe(false);
    expect(matchesFamilyScope(live('Lexus', 'LS460'), 'LC')).toBe(false);
    expect(matchesFamilyScope(live('BMW', 'M3'), '3 Series')).toBe(false);
    expect(matchesFamilyScope(live('Porsche', '9110'), '911')).toBe(false);
  });
});

describe('where a lot should finish', () => {
  it('puts the estimate and its range under the bid, with the measured confidence on hover, and nothing without one', async () => {
    fixture.finish.set('later', { vehicleId: 'later', estimate: 33000, low: 25500, high: 45100, grade: 'A', coverage: 0.775,
      sentence: '8 in 10 cars like this finished inside this range. Half finished within 15%.', estimatedAt: Date.now(),
      bidAtEstimate: 25000, compsThrough: '2026-09-27' });
    await render();
    const line = container.querySelector('[data-vehicle-id="later"] .market-lot-finish')!;
    // how far the bid has to run ($25,000 now), then the range bar: the range, the likely tick, the bid
    expect(line.textContent).toBe('likely $33K · +32% to go · $26K–$45K');
    expect(line.getAttribute('title')).toContain('8 in 10 cars like this');
    expect(line.querySelector('svg')?.getAttribute('aria-label')).toBe('likely $33K, range $26K to $45K, bid $25K');
    expect(line.querySelectorAll('svg line')).toHaveLength(2);
    expect(container.querySelector('[data-vehicle-id="first"] .market-lot-finish')).toBeNull();
  });
  it('says on hover how often estimates made this far out finished inside their range', async () => {
    fixture.finish.set('later', { vehicleId: 'later', estimate: 33000, low: 25500, high: 45100, grade: 'A', coverage: 0.8,
      sentence: null, estimatedAt: Date.now(), bidAtEstimate: 25000, compsThrough: '2026-09-27', model: 33 });
    fixture.track = [{ model: 33, fromHours: 0, toHours: null, lots: 555, inside: 448, medianMissPct: 16.6,
      firstClose: Date.parse('2026-10-17T20:00:00Z'), lastClose: Date.parse('2026-10-20T21:00:00Z') }];
    await render();
    const line = container.querySelector('[data-vehicle-id="later"] .market-lot-finish')!;
    expect(line.getAttribute('title')).toContain('448 of 555 finished inside the range, half within 17%');
    expect(line.textContent).toBe('likely $33K · +32% to go · $26K–$45K');
  });
  it('gives another house\'s estimate no BaT track record', async () => {
    fixture.pulse.data.auctions = fixture.pulse.data.auctions.map((x: any) => x.id === 'later' ? { ...x, house: 'pcarmarket' } : x);
    fixture.finish.set('later', { vehicleId: 'later', estimate: 33000, low: 25500, high: 45100, grade: 'A', coverage: 0.8,
      sentence: null, estimatedAt: Date.now(), bidAtEstimate: 25000, compsThrough: '2026-09-27', model: 32 });
    fixture.track = [{ model: 32, fromHours: 0, toHours: null, lots: 721, inside: 575, medianMissPct: 20,
      firstClose: Date.parse('2026-10-17T20:00:00Z'), lastClose: Date.parse('2026-10-20T21:00:00Z') }];
    await render();
    const line = container.querySelector('[data-vehicle-id="later"] .market-lot-finish');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('title')).toBeNull();
  });
});

describe('the board in time sections', () => {
  it('places each lot in its section by the viewer\'s own day', () => {
    const now = new Date(2026, 9, 3, 12, 0).getTime();
    expect(closeGroup(now + 30 * 60_000, now)).toBe('hour');
    expect(closeGroup(new Date(2026, 9, 3, 23, 0).getTime(), now)).toBe('today');
    expect(closeGroup(new Date(2026, 9, 4, 1, 0).getTime(), now)).toBe('tomorrow');
    expect(closeGroup(new Date(2026, 9, 7, 12, 0).getTime(), now)).toBe('week');
    expect(closeGroup(new Date(2026, 9, 20, 12, 0).getTime(), now)).toBe('later');
  });
  it('heads each section once with its count in close order, ticks only the last hour, and drops the sections in another order', async () => {
    fixture.pulse.data.auctions = [lot('soon', 'PORSCHE', 1000, 0.5), lot('day-a', 'PORSCHE', 1000, 30), lot('day-b', 'PORSCHE', 1000, 31)];
    await render('make=PORSCHE');
    const heads = [...container.querySelectorAll('.market-board-group')].map(h => h.textContent);
    expect(heads).toEqual(['Ending within the hour 1 lot', 'Tomorrow 2 lots']);
    expect(container.querySelector('[data-vehicle-id="soon"] .market-lot-ends')?.textContent).toContain('left');
    expect(container.querySelector('[data-vehicle-id="day-a"] .market-lot-ends')?.textContent).toMatch(/^ends /);
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Sort lots"]')!;
    await act(async () => { select.value = 'bid'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('.market-board-group')).toBeNull();
  });
});

describe('the scheduled sales at the end of the board', () => {
  // System time is 2026-10-03 12:00Z: an ended sale, a sale running today, two ahead (given out of order) and an empty one.
  const sale = (sale_key: string, starts_on: string, ends_on: string, lots: number, lots_listed: number | null = null) => ({
    house: 'mecum', sale_key, sale_name: `Fixture ${sale_key}`, location: null, starts_on, ends_on, lots, lots_listed, listed_at: null,
    seen_before: 1, no_reserve: 2, first_seen_at: null, first_seen_7d: 3, updated_at: null, run_days: [{ day: starts_on, lots }] });
  beforeEach(() => {
    fixture.calendar = { data: { as_of: '2026-10-03T12:00:00Z', horizon_days: 200, population: {}, roster: null, sales: [
      sale('ended', '2026-09-20', '2026-09-22', 40),
      { ...sale('later', '2026-11-12', '2026-11-14', 165, 169), listed_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T11:48:00Z' },
      sale('soon', '2026-10-08', '2026-10-08', 25), sale('today', '2026-10-02', '2026-10-04', 12), sale('empty', '2026-10-20', '2026-10-21', 0, 0)] } };
  });
  it('lists the sales still to run in date order after the last time section, each datum once, and opens a roster in place', async () => {
    await render('make=PORSCHE');
    const heads = [...container.querySelectorAll('.market-board-group')].map(h => h.textContent);
    expect(heads[heads.length - 1]).toBe('Scheduled sales 3 sales');
    const rows = [...container.querySelectorAll('.market-board-scheduled tr.auction-sale')];
    expect(rows.map(r => r.querySelector('.k-entity')?.textContent)).toEqual(['Fixture today', 'Fixture soon', 'Fixture later']);
    expect(rows[0].textContent).toContain('running · day 2 of 3');
    expect(rows[1].textContent).toContain('in 5 days');
    expect(rows[2].textContent).toContain('165 of 169 lots');
    // The census and landing clocks stay one hover away.
    expect(rows[2].querySelector('.k-measure[title]')?.getAttribute('title')).toBe('Mecum lists 169, read 2 h ago · lots updated 12 min ago');
    // Compact: the calendar's census and history lines stay on the calendar.
    expect(rows[2].textContent).not.toMatch(/lists 169|first seen|no reserve/);
    expect(container.querySelector('.market-board-scheduled .auction-track')).toBeNull();
    expect(fixture.rosterFor).not.toHaveBeenCalled();
    await act(async () => rows[1].querySelector<HTMLButtonElement>('button.auction-sale__open')!.click());
    expect(new URLSearchParams(window.location.search).get('sale')).toBe('mecum:soon');
    expect(fixture.rosterFor).toHaveBeenLastCalledWith({ house: 'mecum', key: 'soon' });
    // The board's make scope narrows the opened roster.
    const roster = container.querySelector('.market-board-scheduled .auction-roster')!;
    expect(roster.querySelector('a[href="/vehicle/rv1"]')).not.toBeNull();
    expect(roster.querySelector('a[href="/vehicle/rv2"]')).toBeNull();
    // A lot with no earlier record says nothing on the board; the calendar keeps the line.
    expect(roster.textContent).not.toContain('No earlier record');
    expect(container.querySelector('.market-board-scheduled th')?.textContent).toBe('When');
  });
  it('shows only in close order, outside a house, window or bid-range filter, and not at all without sales', async () => {
    await render('sort=bid');
    expect(container.querySelector('.market-board-scheduled')).toBeNull();
    await render('live=nr');
    expect(container.querySelector('.market-board-scheduled')).toBeNull();
    await render('');
    expect(container.querySelector('.market-board-scheduled')).not.toBeNull();
    fixture.calendar = { data: { ...fixture.calendar.data, sales: [sale('ended', '2026-09-20', '2026-09-22', 40)] } };
    await render('');
    expect(container.querySelector('.market-board-scheduled')).toBeNull();
  });
});

describe('how far a lot has to run', () => {
  it('says the gap from the bid to the likely finish', async () => {
    const { finishGap } = await import('./MarketPulse');
    expect(finishGap(500000, { estimate: 575000 })).toBe('+15% to go');
    expect(finishGap(600000, { estimate: 575000 })).toBe('4% past likely');
    expect(finishGap(575000, { estimate: 576000 })).toBe('at likely');
    expect(finishGap(null, { estimate: 575000 })).toBeNull();
  });
});

describe('the board in its own history', () => {
  // Every house's own reading a week ago and its 15-minute line since (live_board_share).
  const weekOfShare = (bidsAgo: number, lotsAgo: number) => {
    const t0 = Date.now() - 7 * 86_400_000;
    return { isError: false, data: { firstAt: t0, convertedFirstAt: null, firstAtByHouse: { bringatrailer: t0 },
      weekAgo: { bringatrailer: { at: t0, bidUsd: bidsAgo, lots: lotsAgo, lotsWithBid: lotsAgo, bidUsdConverted: null } },
      points: [0, 1, 2].map(i => ({ at: t0 + i * 3 * 86_400_000, house: 'bringatrailer', bidUsd: bidsAgo + i * 5_000, lots: lotsAgo, lotsWithBid: lotsAgo, bidUsdConverted: null })) } };
  };
  it('reads each figure as a ticker: the number, one change on last week, and the line it moved along', async () => {
    fixture.share = weekOfShare(100_000, 3);
    await render('make=all');
    const [bids, lots] = [...container.querySelectorAll('.market-figure__item')];
    expect(bids.querySelector('.k-figure')?.textContent).toBe('$125K');
    const chg = bids.querySelector('.market-figure__chg')!;
    expect(chg.className).toContain('is-up');
    expect(chg.textContent).toBe('▲ 25.0%vs last week');
    // the line: three readings and now, with last week's level dotted
    expect(bids.querySelector('.market-figure__chart polyline')?.getAttribute('points')?.split(' ')).toHaveLength(4);
    expect(bids.querySelector('.market-stock__spark-base')).toBeTruthy();
    expect(bids.querySelector('button')?.getAttribute('aria-label')).toBe('$125K bid now, +25.0% vs last week');
    expect(bids.querySelector('button')?.getAttribute('title')).toContain('against their own readings');
    expect(lots.querySelector('.k-figure')?.textContent).toBe('4');
    expect(lots.querySelector('.market-figure__chg')?.textContent).toBe('▲ 33.3%vs last week');
    // One change per figure: no ranks, no house-by-house list, no second, longer copy of the total under the headline.
    const visible = container.querySelector('.market-figure')!.textContent!;
    expect(visible).not.toMatch(/weeks at this hour|week on week|on a week ago|\$125,000/);
    fixture.share = weekOfShare(150_000, 5);
    await render('make=all');
    expect(container.querySelector('.market-figure__chg')?.className).toContain('is-down');
    expect(container.querySelector('.market-figure__chg')?.textContent).toBe('▼ 16.7%vs last week');
  });
  it('compares a make on BaT\'s own hourly index, with the readings at this hour on earlier weeks as its line', async () => {
    fixture.pulse.data.sameHour = { hourUtc: '12', weekdayUtc: 'Saturday', low: 1, high: 2, weeks: 7, firstDay: '2026-08-15', readings: [] };
    fixture.pulse.data.weekAgo = { at: Date.now() - 7 * 86_400_000, bids: 900_000, n: 30, byMake: { PORSCHE: [20_000, 2] }, source: 'live' };
    fixture.sameHour = Array.from({ length: 4 }, (_, i) => ({ day: `2026-09-${12 + i * 7}`, bids: 1, n: 1, byMake: { PORSCHE: [10_000 + i * 1_000, 2] }, source: 'live' }));
    await render('make=PORSCHE');
    const [bids, lots] = [...container.querySelectorAll('.market-figure__item')];
    expect(bids.querySelector('.market-figure__chg')?.textContent).toBe('▲ 25.0%vs last week');
    expect(bids.querySelector('.market-figure__chg img')).toBeNull();
    expect(bids.querySelector('.market-figure__chart polyline')?.getAttribute('points')?.split(' ')).toHaveLength(5);
    expect(bids.querySelector('button')?.getAttribute('title')).toContain('Now higher than all 4 Saturdays at this hour');
    expect(lots.querySelector('.market-figure__chg')?.textContent).toBe('▲ 0.0%vs last week');
  });
  it('says nothing comparative without a reading a week old, and draws no line', async () => {
    await render();
    expect(container.querySelector('.market-figure__chg')).toBeNull();
    expect(container.querySelector('.market-figure__chart')).toBeNull();
    fixture.share = { isError: true, data: undefined };
    await render();
    expect(container.querySelector('.market-figure__chg')).toBeNull();
    // a family has no series of its own
    fixture.share = weekOfShare(100_000, 3);
    await render('make=PORSCHE&family_name=911');
    expect(container.querySelector('.market-figure__chg')).toBeNull();
  });
  it('opens the map of what each figure is made of, by dollars or by lots, and closes it again', async () => {
    await render();
    expect(container.querySelector('#market-composition')).toBeNull();
    await click('$125K');
    expect(window.location.search).toContain('map=bids');
    expect(container.querySelector('#market-composition')?.getAttribute('aria-label')).toBe('What the bids are made of');
    expect(container.textContent).toContain('Box size = dollars bid now');
    await click('4');
    expect(window.location.search).toContain('map=lots');
    expect(container.textContent).toContain('Box size = number of open lots');
    await click('4');
    expect(window.location.search).not.toContain('map=');
    expect(container.querySelector('#market-composition')).toBeNull();
  });
  it('opens a chosen brand on its decades, and a decade box on its cars', async () => {
    fixture.pulse.data.auctions[0].year = 1995;
    await render('map=lots&make=PORSCHE');
    expect((container.querySelector('select[aria-label="Group inventory by"]') as HTMLSelectElement).value).toBe('era');
    expect((container.querySelector('select[aria-label="Inventory sub-boxes"]') as HTMLSelectElement).value).toBe('lot');
    const nineties = container.querySelector('[data-map-group="1990–1999"]')!;
    expect(nineties.querySelector('[data-map-lot="later"]')).toBeTruthy();
    await act(async () => nineties.querySelector<HTMLButtonElement>('[data-map-lot="later"]')!.click());
    expect(window.location.search).toContain('lot=later');
  });
  it('opens recorded sales on the largest open cohort instead of an empty form', async () => {
    await render();
    await click('Use recorded sales view');
    expect(window.location.search).toContain('make=PORSCHE');
    await render('view=sales');
    expect(container.textContent).toContain('Comparison scope PORSCHE');
  });
});

describe('the market document', () => {
  it('names the population once, counts the cohort in the masthead and states its coverage in the strip', async () => {
    await render('make=PORSCHE');
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toBe('Live auctions · Porsche');
    expect(h1.className).toContain('k-entity');
    expect(container.querySelector('.market-figure .k-figure')?.textContent).toBe('$25K');
    expect(cohortCount()).toBe('3');
    expect(container.querySelector('.k-masthead__result')?.textContent).toBe('↻ read just now');
    expect(container.querySelector('[aria-label="Market scope"] .k-coverage')).toBeNull();
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
    expect(container.querySelector('h1')?.textContent).toBe('Live auctions');
    expect(container.querySelector('[aria-label="Market scope"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Market scope"] .k-coverage')).toBeNull();
    expect(container.querySelector('.k-masthead__result')?.textContent).toBe('↻ retry');
  });
  it('uses the successful browser read clock, not a recent unrelated vehicle write, and exposes refresh failure', async () => {
    fixture.pulse.data.syncedAt = Date.now();
    fixture.pulse.dataUpdatedAt = Date.now() - 30 * 60_000;
    await render();
    expect(container.querySelector('.market-clock')?.textContent).toBe('↻ read 30 min ago');
    expect(container.querySelector('.market-clock')?.getAttribute('title')).toContain('source capture time is unavailable');
    fixture.pulse.isError = true;
    await render();
    expect(container.querySelector('.market-clock')?.textContent).toBe('↻ retry');
    expect(boardTitles().length).toBeGreaterThan(0);
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
    expect(container.querySelector(`[data-vehicle-id="${id}"]`)?.textContent).not.toContain('CA · 90210');
    // The row's answer is the bid (and the finish when estimated); how the bidding went opens in the drawer.
    expect(container.querySelector(`[data-vehicle-id="${id}"] .market-lot-metrics`)?.textContent).toBe('$42,000');
    expect(container.querySelector('a[href*="bringatrailer.com/listing"]')).toBeNull();
    await click('Inspect auction for 2004 BMW M3');
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.nextElementSibling?.getAttribute('id')).toBe(`lot-inspection-${id}`);
    expect(window.location.search).toContain('inspect=auction');
    expect([...container.querySelectorAll(`[data-vehicle-id="${id}"] .market-lot-facts button`)]).toHaveLength(0);
    await click('Close listing evidence');
    expect(window.location.search).not.toContain('lot=');
    expect(document.activeElement).toBe(row.querySelector('.market-lot-image'));
  });
  it('scopes live auctions to a drilled model family from the URL and shows the family in the heading', async () => {
    fixture.pulse.data.auctions = [
      { ...lot('m-1', 'FORD', 38000, 2, 'mustang-gt'), year: 1967, model: 'Mustang GT 5-Speed' },
      { ...lot('m-2', 'FORD', 52000, 3, 'mustang-mach-1'), year: 1969, model: 'Mustang Mach 1' },
      { ...lot('f-1', 'FORD', 24000, 4, 'f-150-raptor'), year: 2018, model: 'F-150' },
    ];
    await render('make=Ford&family=8a8271f8-d299-4b55-837a-35ca919f8937&family_name=Mustang');
    expect(container.querySelector('h1')?.textContent).toBe('Live auctions · Ford · Mustang');
    expect(boardTitles()).toEqual(['m-1', 'm-2']);

    await render('make=Ford&family=8a8271f8-d299-4b55-837a-35ca919f8937&family_name=Mustang&model=Mustang+GT');
    expect(boardTitles()).toEqual(['m-1']);
  });
});

describe("a row's title drills the board in place", () => {
  const scope = () => new URLSearchParams(window.location.search);
  it('re-scopes to the make, the model and the year, each a toggle, without opening the lot', async () => {
    await render();
    const row = container.querySelector('[data-vehicle-id="later"]')!;
    expect(row.querySelector('.market-lot-name button[aria-haspopup]')).toBeNull();
    await click('Show Ford lots');
    expect(scope().get('make')).toBe('FORD');
    expect(scope().get('lot')).toBeNull();
    expect(boardTitles()).toEqual(['other-make']);
    expect(container.querySelector('h1')?.textContent).toBe('Live auctions · Ford');
    await click('Show every make');
    expect(scope().get('make')).toBe('all');
    await click('Show Porsche Local fixture lots');
    expect(scope().get('make')).toBe('PORSCHE');
    expect(scope().get('model')).toBe('Local fixture');
    expect(boardTitles()).toEqual(['first', 'unknown', 'later']);
    await click('Show 2000 lots');
    expect(scope().get('era')).toBe('2000-2000');
    expect(scope().get('model')).toBe('Local fixture');
    expect(container.querySelector('h1')?.textContent).toBe('Live auctions · Porsche · 2000');
    await click('Show every year');
    expect(scope().get('era')).toBeNull();
    await click('Show every Porsche model');
    expect(scope().get('model')).toBeNull();
    expect(scope().get('make')).toBe('PORSCHE');
  });
  it('scopes to a year across every make', async () => {
    fixture.pulse.data.auctions[3] = { ...fixture.pulse.data.auctions[3], year: 1967 };
    await render();
    await click('Show 1967 lots');
    expect(scope().get('era')).toBe('1967-1967');
    expect(scope().get('make')).toBeNull();
    expect(boardTitles()).toEqual(['other-make']);
    expect(container.querySelector('h1')?.textContent).toBe('Live auctions · 1967');
  });
  it('opens the lot from the rest of the row, and keeps text for a lot without a recorded model', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    fixture.pulse.data.auctions[0] = { ...lot(id, 'BMW', 42000, 2), year: 2004, model: null };
    await render();
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.querySelector('.market-lot-name')?.textContent).toBe('2004 BMW');
    expect(row.querySelector('.market-lot-name button')).toBeNull();
    await act(async () => row.querySelector<HTMLElement>('.market-lot-close')!.click());
    expect(scope().get('lot')).toBe(id);
  });
  it('keeps the title as text even where the catalogue has headline-scale period lettering', async () => {
    fixture.pulse.data.auctions = [{ ...lot('k5', 'CHEVROLET', 20000, 2), year: 1985, model: 'K5 Blazer' }];
    await render();
    const name = container.querySelector('[data-vehicle-id="k5"] .market-lot-name')!;
    expect(name.querySelector('.vehicle-identity')?.getAttribute('data-period-artwork')).toBe('false');
    expect(name.querySelector('.vehicle-identity__art')).toBeNull();
    expect(name.querySelector('.sr-only')?.textContent).toBe('1985 Chevrolet K5 Blazer');
  });
});

describe('headline movement inspection', () => {
  async function update(auctions: LiveAuction[]) {
    vi.setSystemTime(Date.now() + 15_000);
    fixture.pulse = { ...fixture.pulse, data: { ...fixture.pulse.data, auctions }, dataUpdatedAt: Date.now() };
    await render(window.location.search.slice(1));
  }
  it('retains a bid increase observed before opening the figure and opens the exact contributing lot inline', async () => {
    const id = '46dd9cc6-20ec-47cb-a563-159a8005115c';
    fixture.pulse.data.auctions = [lot(id, 'PORSCHE', 25_000, 2)];
    await render();
    await update([{ ...fixture.pulse.data.auctions[0], currentBid: 26_500 }]);
    await click('$27K');
    const panel = container.querySelector('[aria-label="Bid total movement"]')!;
    expect(panel.textContent).toContain('+$1,500 since previous observation');
    expect(panel.querySelector('.market-history__change')?.textContent).toContain('$25,000 → $26,500');
    expect(panel.textContent).toContain('This visit');
    await act(async () => (panel.querySelector('.market-history__change') as HTMLButtonElement).click());
    expect(panel.querySelector('[aria-label="Listing activity evidence"]')?.textContent).toContain(id);
    // A later unchanged read must not erase the latest raise.
    await update([...fixture.pulse.data.auctions]);
    expect(panel.textContent).toContain('+$1,500 since previous observation');
    expect(panel.querySelector('[aria-label="Listing activity evidence"]')).toBeTruthy();
    // Following a different change closes evidence tied to the previous observation.
    await update([{ ...fixture.pulse.data.auctions[0], currentBid: 27_000 }]);
    expect(panel.textContent).toContain('+$500 since previous observation');
    expect(panel.querySelector('[aria-label="Listing activity evidence"]')).toBeNull();
    const select = panel.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { select.value = '0'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(panel.textContent).toContain('Starting observation');
    expect(panel.querySelector('.market-history__change')).toBeNull();
  });
  it('separates lot departures, arrivals, unknown bids and changed listing episodes from bid increases', async () => {
    await render('map=bids');
    const [later, first, unknown, ford] = fixture.pulse.data.auctions;
    await update([{ ...later, currentBid: null }, first, { ...unknown, currentBid: 2000 }, { ...ford, listingUrl: 'https://bringatrailer.com/listing/different-episode/' }, lot('new', 'FORD', 3000, 1)]);
    const panel = container.querySelector('[aria-label="Bid total movement"]')!;
    expect(panel.textContent).toContain('−$20,000 since previous observation');
    expect(panel.textContent).toContain('Bid now unrecorded');
    expect(panel.textContent).toContain('Bid now recorded');
    expect(panel.textContent).toContain('Entered board');
    expect(panel.textContent).toContain('Left board');
    expect(panel.textContent).not.toContain('+$100,000');
    await click('5');
    const lots = container.querySelector('[aria-label="Open lot movement"]')!;
    expect(lots.textContent).toContain('+1 since previous observation');
    expect(lots.textContent).not.toContain('Bid now recorded');
    expect(lots.textContent).toContain('leaving does not establish a sale');
  });
  it('starts a new timeline on a cohort change and keeps the navigation sort in the existing URL', async () => {
    await render('map=bids');
    await update(fixture.pulse.data.auctions.map((a: LiveAuction) => ({ ...a, currentBid: (a.currentBid ?? 0) + 1000 })));
    await click('Choose Ford cohort');
    expect(container.querySelector('[aria-label="Bid total movement"]')?.textContent).toContain('Starting observation');
    expect(container.querySelector('.market-history__change')).toBeNull();
    expect(container.querySelector('nav[aria-label="Market views"] [aria-label="Market scope"]')).toBeTruthy();
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Sort lots"]')!;
    await act(async () => { select.value = 'bid'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(window.location.search).toContain('sort=bid');
    expect(window.location.search).toContain('make=FORD');
  });
  it('does not turn a failed refresh or its cached board into a new observation', async () => {
    await render('map=bids');
    const select = () => container.querySelector<HTMLSelectElement>('[aria-label="Inspect market observation"]')!;
    const initial = select().options.length;
    fixture.pulse.isError = true;
    await update(fixture.pulse.data.auctions.map((a: LiveAuction) => ({ ...a, currentBid: 999999 })));
    expect(select().options.length).toBe(initial);
    expect(container.querySelector('.market-history__change')).toBeNull();
  });
});


describe('every live house on one board', () => {
  const other = (id: string, house: string, currency: string, bid: number | null, hours: number): LiveAuction => ({
    ...lot(id, 'PORSCHE', bid, hours), house, currency, listingUrl: `https://collectingcars.com/for-sale/${id}` });
  const houses = (extra: any[] = []) => [
    { house: 'bringatrailer', lots: 4, readAt: Date.now(), onBoard: true },
    { house: 'collecting-cars', lots: 3, readAt: Date.now(), onBoard: true }, ...extra];
  beforeEach(() => {
    fixture.pulse.data.auctions = [lot('bat-1', 'PORSCHE', 20_000, 5), lot('bat-2', 'PORSCHE', 30_000, 6),
      other('cc-usd', 'pcarmarket', 'USD', 10_000, 3), other('cc-gbp', 'collecting-cars', 'GBP', 44_694, 2), other('cc-eur', 'collecting-cars', 'EUR', 38_250, 4)];
    fixture.pulse.data.houses = houses([{ house: 'cars-and-bids', lots: 188, readAt: Date.parse('2026-10-01T15:00:00Z'), onBoard: false }]);
  });
  it('titles the board for every house and shows the houses read, not BaT alone', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('Live auctions');
    expect(container.querySelector('.market-venue__marks')?.getAttribute('aria-label')).toBe('BaT, Collecting Cars, PCarMarket');
    expect([...container.querySelectorAll('.market-venue__marks img')].map(i => i.getAttribute('alt'))).toEqual(['BaT', 'Collecting Cars', 'PCarMarket']);
    expect(container.querySelector('.market-venue__marks img')?.getAttribute('src')).toBe('/source-logos/bat.png');
    expect(cohortCount()).toBe('5');
  });
  it('adds only dollar bids into the headline when no rate is published, and says what it left out and which house is held off', async () => {
    await render();
    expect(container.querySelector('.market-figure .k-figure')?.textContent).toBe('$60K');
    const note = container.querySelector('.market-figure__note')!.textContent!;
    expect(note).not.toContain('not added');
    expect(note).toContain('Cars & Bids: 188 lots held off, last read Oct 1');
    expect(container.querySelector('.market-figure__value')?.getAttribute('title')).toContain('2 lots bid in EUR and GBP listed but not added: no published rate');
  });
  it('adds a foreign bid at its published rate, names the rate and its date, and keeps the house figure as the bid', async () => {
    const ecb = (currency: string, rate: number) => ({ currency, rate, rateDate: '2026-11-06', source: `ECB euro foreign exchange reference rates 2026-11-06 (${currency})`,
      sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml' });
    fixture.pulse.data.auctions = fixture.pulse.data.auctions.map((a: LiveAuction) => a.currency === 'GBP' ? { ...a, fx: ecb('GBP', 1.338488281) }
      : a.currency === 'EUR' ? { ...a, fx: ecb('EUR', 1.1165) } : a);
    await render();
    // $60,000 in dollars + £44,694 x 1.338488281 ($59,822) + €38,250 x 1.1165 ($42,706)
    expect(container.querySelector('.market-figure .k-figure')?.textContent).toBe('$163K');
    const hover = container.querySelector('.market-figure__value')!.getAttribute('title')!;
    expect(hover).toContain('2 lots bid in EUR and GBP added in dollars at the ECB reference rate of 2026-11-06');
    expect(hover).not.toContain('not added');
    const gbp = container.querySelector('[data-vehicle-id="cc-gbp"]')!;
    expect(gbp.textContent).toContain('£44,694');
    expect(gbp.querySelector('.market-bid')?.getAttribute('title')).toContain('≈ $59,822 at 1.3385 USD per GBP (ECB reference rate, 2026-11-06)');
    const d = currentBidDistribution(fixture.pulse.data.auctions);
    expect(d.counts.otherCurrency).toBe(0);
    expect(d.counts['50k100k']).toBe(1);
    expect(d.counts['25k50k']).toBe(2);
    expect(d.total).toBe(60_000 + 59_822 + 42_706);
  });
  it('shows each lot in its own currency with its house', async () => {
    await render();
    const gbp = container.querySelector('[data-vehicle-id="cc-gbp"]')!;
    expect(gbp.textContent).toContain('£44,694');
    expect(gbp.textContent).not.toContain('$44,694');
    expect(gbp.querySelector('.market-lot-house')?.textContent).toBe('Collecting Cars');
    expect(container.querySelector('[data-vehicle-id="bat-1"] .market-lot-house')?.textContent).toBe('BaT');
  });
  it('filters by house, counts each house, and states the scope', async () => {
    await render();
    expect(button('All houses').textContent).toContain('5');
    expect(button('Collecting Cars, 2 lots').querySelector('img')?.getAttribute('src')).toBe('/source-logos/collecting-cars.png');
    await click('Collecting Cars, 2 lots');
    expect(window.location.search).toContain('house=collecting-cars');
    expect(boardTitles().sort()).toEqual(['cc-eur', 'cc-gbp']);
    expect(container.querySelector('h1')?.textContent).toBe('Collecting Cars');
    expect(container.querySelector('.market-venue__mark')?.getAttribute('src')).toBe('/source-logos/collecting-cars.png');
    expect(container.querySelector('.market-figure .k-figure')?.textContent).toBe('$0');
    await click('All houses');
    expect(window.location.search).not.toContain('house=');
  });
  it('compares on BaT alone when no house history can be read, and shows the BaT mark beside the change', async () => {
    fixture.share = { isError: true, data: undefined };
    fixture.pulse.data.weekAgo = { at: Date.now() - 7 * 24 * HOUR, bids: 25_000, n: 2, byMake: null, source: 'live' };
    await render();
    const chg = container.querySelector('.market-figure__chg')!;
    expect(chg.textContent).toContain('100.0%');
    expect(chg.querySelector('img')?.getAttribute('alt')).toBe('BaT');
    expect(container.querySelector('.market-figure__value')?.getAttribute('aria-label')).toBe('$60K bid now, +100.0% vs last week on BaT');
    await click('Collecting Cars, 2 lots');
    expect(container.querySelector('.market-figure__chg')).toBeNull();
  });
  it('bids high to low by dollars; a bid in another currency is its own range, never an unrecorded one', async () => {
    await render();
    expect(currentBidDistribution(fixture.pulse.data.auctions).counts.otherCurrency).toBe(2);
    expect(currentBidDistribution(fixture.pulse.data.auctions).counts.unknown).toBe(0);
    expect(currentBidDistribution(fixture.pulse.data.auctions).total).toBe(60_000);
  });
  it("opens another house's lot on its Nuke record, not BaT's listing evidence", async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-vehicle-id="cc-usd"] .market-lot-name')!.click());
    expect(window.location.pathname).toBe('/vehicle/cc-usd');
    window.history.replaceState({}, '', '/');
  });
  it('says plainly when the other houses could not be read', async () => {
    fixture.pulse.data.auctions = fixture.pulse.data.auctions.filter((a: LiveAuction) => a.house === 'bringatrailer');
    fixture.pulse.data.houses = []; fixture.pulse.data.housesFailed = true;
    await render();
    expect(container.querySelector('.market-figure__note')?.textContent).toContain('Other houses could not be read; showing Bring a Trailer only');
    expect(container.querySelector('[aria-label="Auction house"]')).toBeNull();
  });
  it('opens the dollars into a price chart of the total with a watchlist of the houses, and says where the history starts', async () => {
    const t0 = Date.parse('2026-10-03T08:00:00Z');
    fixture.share = { isError: false, data: { firstAt: t0, firstAtByHouse: { bringatrailer: t0, pcarmarket: t0 }, weekAgo: {},
      points: [0, 1, 2, 3].flatMap((i) => [
        { at: t0 + i * 900_000, house: 'bringatrailer', bidUsd: 50_000 + i * 1000, lots: 2, lotsWithBid: 2 },
        { at: t0 + i * 900_000, house: 'pcarmarket', bidUsd: 10_000 - i * 500, lots: 1, lotsWithBid: 1 }]) } };
    await render('map=bids');
    const stock = container.querySelector('[aria-label="Dollars bid, every house"]')!;
    expect(stock).toBeTruthy();
    expect(stock.textContent).toContain('Nothing before that is estimated');
    expect(stock.textContent).toContain('Bids recorded in dollars only, the unit these readings keep');
    // the total went from $60,000 to $61,500: up, drawn as a green line with a last-price tag
    expect(stock.querySelector('.market-stock__chg')?.className).toContain('is-up');
    expect(stock.querySelector('.market-stock__chg')?.textContent).toContain('+2.50%');
    expect(stock.querySelector('polyline.market-stock__line')).toBeTruthy();
    expect(stock.querySelector('.market-stock__tag')?.textContent).toBe('$61.5K');
    // the watchlist: BaT up, PCarMarket down, shares from the live board ($50,000 of $60,000)
    const rows = [...stock.querySelectorAll('tbody tr')];
    expect(rows[0].textContent).toContain('83.3%');
    expect(rows[0].querySelector('td.is-up')).toBeTruthy();
    expect(rows[1].querySelector('td.is-down')).toBeTruthy();
    expect(rows[0].querySelector('img')?.getAttribute('alt')).toBe('BaT');
    await act(async () => container.querySelectorAll<HTMLButtonElement>('.market-figure__value')[1].click());
    expect(container.querySelector('[aria-label="Open lots, every house"]')).toBeTruthy();
  });
  it('switches the range and reads the value under the pointer', async () => {
    const t0 = Date.parse('2026-10-03T00:00:00Z'), end = Date.parse('2026-10-03T12:00:00Z');
    const pts = Array.from({ length: 13 }, (_, i) => ({ at: t0 + i * 3_600_000, house: 'bringatrailer', bidUsd: 50_000 + i * 1000, lots: 2, lotsWithBid: 2 }));
    fixture.share = { isError: false, data: { firstAt: t0, firstAtByHouse: { bringatrailer: t0 }, weekAgo: {}, points: pts } };
    await render('map=bids');
    const chart = () => container.querySelector('.market-stock__chart')!;
    const span = () => container.querySelector('.market-stock__note')!.textContent!;
    expect(span()).toContain('Showing 12 h');
    await click('6H');
    expect(span()).toContain('Showing 6 h');
    expect(end).toBeGreaterThan(t0);
    await act(async () => { chart().dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 0 })); });
    expect(container.querySelector('.market-stock__tipv')).toBeTruthy();
  });
  it('draws no line from fewer than two readings and says recording has just begun', async () => {
    fixture.share = { isError: false, data: { firstAt: null, firstAtByHouse: {}, weekAgo: {}, points: [] } };
    await render('map=bids');
    const stock = container.querySelector('[aria-label="Dollars bid, every house"]')!;
    expect(stock.textContent).toContain('Recording starts now');
    expect(stock.querySelector('polyline')).toBeNull();
  });
  it('compares each house with its own week-ago reading in the watchlist, and marks the houses with no week of history yet', async () => {
    const t0 = Date.parse('2026-09-26T12:00:00Z');
    fixture.share = { isError: false, data: { firstAt: t0, firstAtByHouse: { pcarmarket: Date.parse('2026-10-02T12:00:00Z'), 'collecting-cars': t0 }, points: [],
      weekAgo: { 'collecting-cars': { at: t0, bidUsd: 0, lots: 1, lotsWithBid: 1 } } } };
    await render('map=lots');
    const row = (alt: string) => [...container.querySelectorAll('.market-stock__watch tbody tr')].find(r => r.querySelector(`img[alt="${alt}"]`))!;
    const week = (alt: string) => row(alt).querySelectorAll('td')[3];
    expect(week('Collecting Cars').textContent).toBe('+100.00%');
    expect(week('Collecting Cars').className).toBe('is-up');
    expect(week('PCarMarket').textContent).toBe('—');
    expect(week('PCarMarket').getAttribute('title')).toContain('No week of readings yet (recorded since Oct 2');
    // the headline lots compare only the house with a week of readings, under its mark; the hover names the rest
    const lots = container.querySelectorAll('.market-figure__item')[1];
    expect(lots.querySelector('.market-figure__chg img')?.getAttribute('alt')).toBe('Collecting Cars');
    expect(lots.querySelector('button')?.getAttribute('title')).toContain('BaT, PCarMarket: no week of readings yet, not in the change');
    expect(container.querySelector('.market-figure')!.textContent).not.toContain('no week of history');
  });
  it('keeps the price axis readable: neighbouring ticks differ even when the range is a sliver of the total', async () => {
    const t0 = Date.parse('2026-10-03T08:00:00Z');
    fixture.share = { isError: false, data: { firstAt: t0, firstAtByHouse: { bringatrailer: t0 }, weekAgo: {},
      points: [45_480_000, 45_520_000, 45_560_000, 45_600_000].map((v, i) => ({ at: t0 + i * 900_000, house: 'bringatrailer', bidUsd: v, lots: 2, lotsWithBid: 2 })) } };
    await render('map=bids');
    const ticks = [...container.querySelectorAll('.market-stock__tick')].map(e => e.textContent).filter(x => /\$/.test(x ?? ''));
    expect(ticks.length).toBe(4);
    expect(new Set(ticks).size).toBe(4);
    expect(container.querySelector('.market-stock__tag')?.textContent).toBe('$45.60M');
  });
});
