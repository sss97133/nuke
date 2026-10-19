// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pulse: {} as any, movement: {} as any, taxonomy: {} as any, details: new Map() as Map<string, any>, specs: [] as any[], retry: vi.fn(), sameHour: [] as any[], finish: new Map() as Map<string, any> }));
vi.mock('./useFinishEstimates', () => ({ useFinishEstimates: () => ({ data: { fresh: true, writerAt: null, byId: fixture.finish } }) }));
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

import MarketPulse, { matchesFamilyScope } from './MarketPulse';
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
  fixture.retry.mockReset(); fixture.details = new Map(); fixture.specs = []; fixture.finish = new Map();
  fixture.taxonomy = { data: [], isLoading: false, isError: false, isSuccess: true, refetch: fixture.retry };
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  fixture.movement = { data: [], coverage: undefined, dataUpdatedAt: Date.now() };
  fixture.sameHour = [];
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
    expect(document.activeElement).toBe(row.querySelector('.market-lot-name'));
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
    expect(container.textContent).toContain('1–24 of 84 lots');
    expect(container.querySelector('.inventory-map-remainder')).toBeNull();
    await click('Next 24 lots');
    expect(window.location.search).toContain('board=2');
    expect(boardTitles()).toHaveLength(24);
    expect(boardTitles()[0]).toBe('small-23');
    await render('map=lots&mapBy=make&make=all&board=4');
    expect(boardTitles()).toHaveLength(12);
    expect(container.textContent).toContain('73–84 of 84 lots');
    expect(container.querySelector('[aria-label="Next 24 lots"]')).toBeNull();
    await click('Ending in 24 h');
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
  it.each([
    ['Next 24 lots', 1, 2], ['Previous 24 lots', 2, 1],
  ])('moves keyboard focus from %s to the replacement page first title', async (pager, from, to) => {
    fixture.pulse.data.auctions = Array.from({ length: 60 }, (_, i) => lot(`page-${i}`, 'PORSCHE', 1000 + i, i + 1));
    await render(`make=PORSCHE&board=${from}&sort=ending`);
    const opener = button(pager); opener.focus(); await act(async () => opener.click());
    expect(window.location.search).toContain(`board=${to}`);
    expect(window.location.search).toContain('make=PORSCHE');
    expect(window.location.search).toContain('sort=ending');
    expect(boardTitles()[0]).toBe(`page-${(to - 1) * 24}`);
    expect(document.activeElement).toBe(container.querySelector('.market-lot-name'));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'start' });
  });
  it('keeps an explicit paging action reachable if the board empties during that render', async () => {
    fixture.pulse.data.auctions = Array.from({ length: 60 }, (_, i) => lot(`page-${i}`, 'PORSCHE', 1000, i + 1));
    await render('board=1');
    const opener = button('Next 24 lots'); opener.focus();
    fixture.pulse.data = { ...fixture.pulse.data, auctions: [] };
    await act(async () => opener.click());
    expect(boardTitles()).toEqual([]);
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Live lots"]'));
    expect(container.textContent).toContain('No open lots match these filters');
  });
  it('keeps current focus on deep-linked pages and background board refreshes', async () => {
    fixture.pulse.data.auctions = Array.from({ length: 60 }, (_, i) => lot(`page-${i}`, 'PORSCHE', 1000, i + 1));
    await render('board=1');
    const control = button('Bid sounds off'); control.focus();
    await render('board=2');
    expect(boardTitles()[0]).toBe('page-24');
    expect(document.activeElement).toBe(control);
    fixture.pulse.data = { ...fixture.pulse.data, auctions: fixture.pulse.data.auctions.map((a: LiveAuction) => ({ ...a, currentBid: 2000 })) };
    await render('board=2');
    expect(document.activeElement).toBe(control);
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
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.closest('details')?.open).toBe(false);
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
    expect(d.counts).toEqual({ under10k: 2, '10k25k': 2, '25k50k': 2, '50k100k': 2, '100kplus': 1, unknown: 3 });
    expect(d.recorded).toBe(9); expect(d.median).toBe(25_000);
    expect(Object.values(d.counts).reduce((a, b) => a + b, 0)).toBe(bids.length);
    expect(currentBidDistribution([lot('missing', 'PORSCHE', null, 1)]).median).toBeNull();
  });
  it('uses the make for headline denominator and graph, opens all supporting lots in close order', async () => {
    await render('make=PORSCHE');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.textContent).toContain('2 of 3 lots');
    expect(container.textContent).toContain('Current bids in US dollars as recorded');
    expect(container.querySelector('.market-bid')?.textContent).toMatch(/^\$[\d,]+$/);
    expect(cohortCount()).toBe('3');
    expect(container.querySelector('.market-board__scope')?.textContent).toBe('3 of 4 lots · PORSCHE');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.textContent).toContain('2 of 3 lots');
    await click('Ending in 24 h');
    expect(button('Ending in 24 h').getAttribute('aria-pressed')).toBe('true');
    await click('Ending in 24 h');
    expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
    expect(window.location.search).toContain('board=1');
  });
  it('drills a graph range into exactly its lots, preserves make, and toggles back', async () => {
    await render('make=PORSCHE'); await click('$25,000–49,999:');
    expect(window.location.search).toContain('make=PORSCHE');
    expect(boardTitles()).toEqual(['later']);
    expect(button('$25,000–49,999:').getAttribute('aria-pressed')).toBe('true');
    await click('$25,000–49,999:'); expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
  });
  it('drills unknown bids without treating them as zero and scopes the graph to the window', async () => {
    await render('map=lots&make=PORSCHE&mapBy=model'); await click('Unrecorded:');
    expect(boardTitles()).toEqual(['unknown']);
    await click('Ending in 24 h');
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
    expect(container.textContent).toContain('1 of 1 lots have a recorded bid number');
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
    expect(button('No reserve').className).toContain('market-chip--nr');
    await click('No reserve');
    expect(boardTitles()).toEqual(['later']);
  });
  it('says the source once, as the venue, and not on each row', async () => {
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('Bring a Trailer');
    expect(container.querySelector('.market-venue__mark')?.getAttribute('src')).toBe('/vendor/bat/favicon.ico');
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
  it('places each figure against the same hour on earlier weeks, once, and keeps no second copy of the totals', async () => {
    fixture.pulse.data.sameHour = { hourUtc: '12', weekdayUtc: 'Saturday', low: 1, high: 2, weeks: 7, firstDay: '2026-08-15', readings: [] };
    fixture.pulse.data.weekAgo = { at: Date.now() - 7 * 86_400_000, bids: 100_000, n: 3, byMake: null, source: 'live' };
    fixture.sameHour = Array.from({ length: 7 }, (_, i) => ({ day: `2026-08-${15 + i}`, bids: 50_000 + i * 1_000, n: 2, byMake: null, source: i === 0 ? 'archive' : 'live' }));
    await render('make=all');
    const [bids, lots] = [...container.querySelectorAll('.market-figure__item')];
    expect(bids.querySelector('.k-figure')?.textContent).toBe('$125K');
    expect(bids.textContent).toContain('+25.0% on a week ago · higher than all 7 weeks at this hour');
    expect(bids.querySelectorAll('.market-range__tick')).toHaveLength(7);
    expect(lots.querySelector('.k-figure')?.textContent).toBe('4');
    expect(lots.textContent).toContain('+0.0% on a week ago · higher than all 7 weeks at this hour');
    // Said once: no second, longer copy of the total on the page (hover titles aside).
    const visible = container.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('title').forEach(t => t.remove());
    expect(visible.textContent).not.toContain('$125,000');
    expect(container.querySelector('[aria-label="Edges of the board\'s own history"]')).toBeNull();
    expect(container.querySelector('[aria-label="The board in its own history"]')).toBeNull();
  });
  it('says nothing comparative without readings, and says ties as level', async () => {
    await render();
    expect(container.querySelector('.market-range')).toBeNull();
    expect(container.querySelector('.market-figure')?.textContent).not.toContain('weeks at this hour');
    fixture.pulse.data.sameHour = { hourUtc: '12', weekdayUtc: 'Saturday', low: 1, high: 2, weeks: 7, firstDay: '2026-08-15', readings: [] };
    fixture.sameHour = Array.from({ length: 7 }, (_, i) => ({ day: `2026-08-${15 + i}`, bids: 100_000 + i * 10_000, n: 3, byMake: null, source: 'live' }));
    await render('make=all');
    const [bids, lots] = [...container.querySelectorAll('.market-figure__item')];
    expect(bids.textContent).toContain('lower than 4 of 7 weeks at this hour');
    expect(lots.textContent).toContain('level with all 7 weeks at this hour');
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
    expect(h1.textContent).toBe('Bring a Trailer · PORSCHE');
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
    expect(container.querySelector('h1')?.textContent).toBe('Bring a Trailer');
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
    expect(container.querySelector(`[data-vehicle-id="${id}"] .market-lot-metrics`)?.textContent).toContain('Stack A bidding depth');
    expect(container.querySelector('a[href*="bringatrailer.com/listing"]')).toBeNull();
    await click('Inspect auction for 2004 BMW M3');
    const row = container.querySelector(`[data-vehicle-id="${id}"]`)!;
    expect(row.nextElementSibling?.getAttribute('id')).toBe(`lot-inspection-${id}`);
    expect(window.location.search).toContain('inspect=auction');
    expect([...container.querySelectorAll(`[data-vehicle-id="${id}"] .market-lot-facts button`)]).toHaveLength(0);
    await click('Close listing evidence');
    expect(window.location.search).not.toContain('lot=');
    expect(document.activeElement).toBe(row.querySelector('.market-lot-name'));
  });
  it('scopes live auctions to a drilled model family from the URL and shows the family in the heading', async () => {
    fixture.pulse.data.auctions = [
      { ...lot('m-1', 'FORD', 38000, 2, 'mustang-gt'), year: 1967, model: 'Mustang GT 5-Speed' },
      { ...lot('m-2', 'FORD', 52000, 3, 'mustang-mach-1'), year: 1969, model: 'Mustang Mach 1' },
      { ...lot('f-1', 'FORD', 24000, 4, 'f-150-raptor'), year: 2018, model: 'F-150' },
    ];
    await render('make=Ford&family=8a8271f8-d299-4b55-837a-35ca919f8937&family_name=Mustang');
    expect(container.querySelector('h1')?.textContent).toBe('Bring a Trailer · FORD · Mustang');
    expect(boardTitles()).toEqual(['m-1', 'm-2']);

    await render('make=Ford&family=8a8271f8-d299-4b55-837a-35ca919f8937&family_name=Mustang&model=Mustang+GT');
    expect(boardTitles()).toEqual(['m-1']);
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
    expect(container.querySelector('.market-navigation > summary')?.textContent).toContain('Explore market');
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Market navigation sort"]')!;
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
