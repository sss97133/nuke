// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ pulse: {} as any, movement: {} as any, taxonomy: {} as any, retry: vi.fn() }));
vi.mock('./useMarketPulse', async importOriginal => ({
  ...await importOriginal<typeof import('./useMarketPulse')>(),
  useMarketPulse: () => fixture.pulse, useSameHourReadings: () => ({ data: [] }), useInventoryTaxonomy: () => fixture.taxonomy,
}));
vi.mock('./useLotMovement', async importOriginal => ({
  ...await importOriginal<typeof import('./useLotMovement')>(), useLotMovement: () => fixture.movement,
}));
vi.mock('./AuctionEvidence', () => ({ default: ({ vehicleId, onClose }: any) => <section aria-label="Listing activity evidence">{vehicleId}<button onClick={onClose}>Close listing evidence</button></section> }));
vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('./RecordedSalesComparison', () => ({ default: ({ make, onMakeChange, onViewChange }: any) => <section aria-label="Recorded sales comparison">
  <span>Comparison scope {make ?? 'all'}</span>
  <button onClick={() => onViewChange('sales')}>Use recorded sales view</button>
  <button onClick={() => onViewChange('inventory')}>Use inventory view</button>
  <button onClick={() => onMakeChange('FORD')}>Choose Ford cohort</button>
  <button onClick={() => onMakeChange(null)}>Choose all live makes</button>
</section> }));
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, ...props }: any) => <a href={to} {...props} /> }));
vi.mock('@tanstack/react-virtual', () => ({ useWindowVirtualizer: ({ count, estimateSize }: any) => ({
  getTotalSize: () => count * estimateSize(),
  getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * estimateSize() })),
}) }));

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
function boardTitles() { return [...container.querySelectorAll('a[href^="/vehicle/"]')].map(a => a.textContent); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    private callback: (entries: Array<{ contentRect: { width: number } }>) => void;
    constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) { this.callback = callback; }
    observe() { this.callback([{ contentRect: { width: window.innerWidth } }]); }
    disconnect() {}
  });
  fixture.retry.mockReset();
  fixture.taxonomy = { data: [], isLoading: false, isError: false, isSuccess: true, refetch: fixture.retry };
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
    expect([...container.querySelectorAll('a[href^="/vehicle/"]')].map(a => a.getAttribute('href'))).toEqual(['/vehicle/later']);
    expect(button('25,000–49,999:').getAttribute('aria-pressed')).toBe('true');
    await click('25,000–49,999:'); expect(boardTitles().slice(-3)).toEqual(['first', 'unknown', 'later']);
  });
  it('drills unknown bids without treating them as zero and scopes the graph to the window', async () => {
    await render('make=PORSCHE'); await click('Unrecorded:');
    expect([...container.querySelectorAll('a[href^="/vehicle/"]')].map(a => a.getAttribute('href'))).toEqual(['/vehicle/unknown']);
    await click('Ending < 24 h');
    expect(window.location.search).not.toContain('bidRange');
    expect(container.querySelector('[aria-label="Current bid distribution"]')?.textContent).toContain('1 of 2 lots');
    expect(container.querySelector('button[aria-label="Local fixture: 2 captured lots. Filter this recorded model"]')).toBeTruthy();
    expect(container.querySelector('a[title="The listing on Bring a Trailer"]')?.getAttribute('href')).toContain('local-fixture-first');
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
    expect(container.textContent).toContain('area = captured lot count');
  });
});
