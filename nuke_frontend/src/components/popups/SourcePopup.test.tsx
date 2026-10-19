// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, openPopup: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('./usePopup', () => ({ usePopup: () => ({ openPopup: fixture.openPopup }) }));
vi.mock('./MakePopup', () => ({ MakePopup: () => null }));
vi.mock('./VehiclePopup', () => ({ VehiclePopup: () => null }));
import { SourcePopup } from './SourcePopup';
import { MakePopup } from './MakePopup';
import { VehiclePopup } from './VehiclePopup';
import { VEHICLE_POPUP_COLUMNS } from './vehiclePopupColumns';

type Read = { url: URL; method: string; body: unknown; resolve: (response: Response) => void; reject: (reason: Error) => void };
let root: Root, host: HTMLDivElement, reads: Read[];
const privateMessage = 'Synthetic source read refused';
const empty = { total: 0, for_sale: 0, sold_this_week: 0, sold_this_month: 0, recent_sales: [], live_now: [], top_makes: [] };
const makes = [{ label: 'Ford', cnt: 5, for_sale: 1 }, { label: 'Chevrolet', cnt: 3, for_sale: 0 }];
const text = () => host.textContent;
const chips = () => [...host.querySelectorAll('[role="button"]')].map(node => node.textContent);
async function draw(source = 'synthetic-source', searchQuery?: string) {
  await act(async () => root.render(<SourcePopup source={source} searchQuery={searchQuery} />));
}
async function settle(value: unknown = empty, status = 200, index = 0) {
  const before = structuredClone(value);
  await act(async () => reads[index].resolve(new Response(JSON.stringify(status === 200 ? value : { code: '42501', message: privateMessage }),
    { status, headers: { 'Content-Type': 'application/json' } })));
  expect(value).toEqual(before);
}
function rpc(source = 'synthetic-source') {
  expect(reads[0].method).toBe('POST'); expect(reads[0].url.pathname).toBe('/rest/v1/rpc/popup_source_intel');
  expect([...reads[0].url.searchParams]).toEqual([]); expect(reads[0].body).toEqual({ p_source: source });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = []; fixture.openPopup.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://source-popup.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'synthetic-source-popup' },
    global: { fetch: async (input, init) => new Promise<Response>((resolve, reject) => {
      reads.push({ url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null, resolve, reject });
    }) },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

it('replaces loading after a current API error without disclosing the raw error', async () => {
  await draw(); expect(text()).toBe('LOADING...'); await settle(null, 403);
  expect(text()).toBe('Source details unavailable.'); expect(text()).not.toContain(privateMessage); expect(reads).toHaveLength(1); rpc();
});
it('replaces loading after a rejected transport through the installed client', async () => {
  await draw(); expect(text()).toBe('LOADING...'); await act(async () => reads[0].reject(new Error(privateMessage)));
  expect(text()).toBe('Source details unavailable.'); expect(text()).not.toContain(privateMessage); expect(reads).toHaveLength(1); rpc();
});
it('preserves initial loading and one useful pending read across a local search rerender', async () => {
  await draw(); await draw('synthetic-source', 'ford'); expect(text()).toBe('LOADING...'); expect(reads).toHaveLength(1); rpc();
});
it('preserves a successful empty summary as a completed zero total', async () => {
  await draw(); await settle(); expect(text()).toBe('TOTAL0'); expect(chips()).toEqual([]); expect(reads).toHaveLength(1); rpc();
});
it('preserves all successful retained summary counts', async () => {
  await draw(); await settle({ ...empty, total: 12, for_sale: 3, sold_this_week: 2, sold_this_month: 4 });
  expect(text()).toBe('TOTAL12FOR SALE3SOLD THIS WEEK2SOLD 30 DAYS4'); expect(reads).toHaveLength(1); rpc();
});
it('preserves static source character and local make filtering without another read', async () => {
  await draw('bat'); await settle({ ...empty, total: 10, top_makes: makes });
  expect(text()).toBe('TOTAL10Curated enthusiast auctions. Strong community commentary.TOP MAKESFord5Chevrolet3');
  await draw('bat', ' Fo '); expect(chips()).toEqual(['Ford5']);
  expect(text()).toBe('TOTAL10Curated enthusiast auctions. Strong community commentary.TOP MAKESFord5'); expect(reads).toHaveLength(1); rpc('bat');
});
it('preserves a local make no-match without suppressing the retained summary', async () => {
  await draw('synthetic-source', 'unmatched'); await settle({ ...empty, total: 10, top_makes: makes });
  expect(text()).toBe('TOTAL10'); expect(chips()).toEqual([]); expect(reads).toHaveLength(1); rpc();
});
it('preserves the make-chip popup action without reading another source', async () => {
  await draw(); await settle({ ...empty, total: 10, top_makes: makes });
  await act(async () => host.querySelector('[role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(fixture.openPopup).toHaveBeenCalledTimes(1); const [element, title, width] = fixture.openPopup.mock.calls[0];
  expect(element.type).toBe(MakePopup); expect(element.props).toEqual({ make: 'Ford' }); expect([title, width]).toEqual(['Ford', 480]);
  expect(reads).toHaveLength(1); rpc();
});
it('preserves live/recent rows, prices, clocks and the existing selected-vehicle followup', async () => {
  await draw(); await settle({ ...empty, total: 2, live_now: [{ id: 'live-row', year: 2000, make: 'Ford', model: 'Coupe', price: 12500, thumbnail: 'https://images.test/live.jpg' }],
    recent_sales: [{ id: 'sold-row', year: 1990, make: 'Chevrolet', model: 'Sedan', sale_price: 24000, sale_date: '2026-09-13T12:00:00Z', thumbnail: null }] });
  expect(text()).toBe(`TOTAL2LIVE NOW2000 Ford Coupe$13KRECENT RESULTS1990 Chevrolet Sedan$24K${new Date('2026-09-13T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  expect([...host.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(['https://images.test/live.jpg']);
  const title = [...host.querySelectorAll('div')].find(node => node.textContent === '2000 Ford Coupe')!;
  await act(async () => title.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(reads).toHaveLength(2); rpc(); expect(reads[1].method).toBe('GET'); expect(reads[1].url.pathname).toBe('/rest/v1/vehicles');
  expect([...reads[1].url.searchParams]).toEqual([['select', VEHICLE_POPUP_COLUMNS.replace(/\s/g, '')], ['id', 'eq.live-row']]);
  const vehicle = { id: 'live-row', make: 'Ford' }; await settle(vehicle, 200, 1);
  const [element, popupTitle, width] = fixture.openPopup.mock.calls[0]; expect(element.type).toBe(VehiclePopup);
  expect(element.props).toEqual({ vehicle }); expect([popupTitle, width]).toEqual(['2000 Ford Coupe', 480]);
});
it('preserves cancellation after close before an API error settles', async () => {
  await draw(); await act(async () => root.render(null)); await settle(null, 403); expect(text()).toBe(''); expect(reads).toHaveLength(1); rpc();
});
it('preserves cancellation after close before a rejected transport settles', async () => {
  await draw(); await act(async () => root.render(null)); await act(async () => reads[0].reject(new Error(privateMessage)));
  expect(text()).toBe(''); expect(reads).toHaveLength(1); rpc();
});
it('preserves cancellation after close before a successful summary settles', async () => {
  await draw(); await act(async () => root.render(null)); await settle({ ...empty, total: 12 });
  expect(text()).toBe(''); expect(reads).toHaveLength(1); rpc();
});
