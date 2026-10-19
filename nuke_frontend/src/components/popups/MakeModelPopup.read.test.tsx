// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, openPopup: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('./usePopup', () => ({ usePopup: () => ({ openPopup: fixture.openPopup }) }));
vi.mock('./SourcePopup', () => ({ SourcePopup: () => null }));
vi.mock('./VehiclePopup', () => ({ VehiclePopup: () => null }));
import { MakePopup } from './MakePopup';
import { ModelPopup } from './ModelPopup';
import { SourcePopup } from './SourcePopup';
import { VehiclePopup } from './VehiclePopup';
import { VEHICLE_POPUP_COLUMNS } from './vehiclePopupColumns';

const owners = [{ name: 'Make', rpc: 'popup_make_intel' }, { name: 'Model', rpc: 'popup_model_intel' }] as const;
type Owner = typeof owners[number];
type Read = { url: URL; method: string; body: unknown; resolve: (response: Response) => void; reject: (reason: Error) => void };
let root: Root, host: HTMLDivElement, reads: Read[], serial = 0;
const make = 'Synthetic & Make', model = 'Coupe / Sport', privateMessage = 'Synthetic popup current read refused';
const emptyMake = { total: 0, for_sale: 0, recent_sales: [], live_now: [], top_models: [], sources: [], price_scatter: [] };
const emptyModel = { total: 0, for_sale: 0, recent_sales: [], live_now: [], price_scatter: [], year_range: null, sources: [] };
const emptyFor = (owner: Owner) => owner.name === 'Make' ? emptyMake : emptyModel;
const text = () => host.textContent;
async function draw(owner: Owner, searchQuery?: string) {
  await act(async () => root.render(owner.name === 'Make' ? <MakePopup make={make} searchQuery={searchQuery} /> : <ModelPopup make={make} model={model} searchQuery={searchQuery} />));
}
async function settle(value: unknown, status = 200, index = 0) {
  const before = structuredClone(value);
  await act(async () => reads[index].resolve(new Response(JSON.stringify(status === 200 ? value : { code: '42501', message: privateMessage }),
    { status, headers: { 'Content-Type': 'application/json' } })));
  expect(value).toEqual(before);
}
function rpc(owner: Owner) {
  expect(reads[0].method).toBe('POST'); expect(reads[0].url.pathname).toBe(`/rest/v1/rpc/${owner.rpc}`);
  expect([...reads[0].url.searchParams]).toEqual([]);
  expect(reads[0].body).toEqual(owner.name === 'Make' ? { p_make: make } : { p_make: make, p_model: model });
}
async function click(node: Element) { await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
async function vehicleFollowup(owner: Owner, title: string, id: string) {
  const titleNode = [...host.querySelectorAll('div')].find(node => node.textContent === title)!;
  await click(titleNode); expect(reads).toHaveLength(2); rpc(owner); expect(reads[1].method).toBe('GET');
  expect(reads[1].url.pathname).toBe('/rest/v1/vehicles');
  expect([...reads[1].url.searchParams]).toEqual([['select', VEHICLE_POPUP_COLUMNS.replace(/\s/g, '')], ['id', `eq.${id}`]]);
  const vehicle = { id, make, model }; await settle(vehicle, 200, 1);
  const [element, popupTitle, width] = fixture.openPopup.mock.calls[0]; expect(element.type).toBe(VehiclePopup);
  expect(element.props).toEqual({ vehicle }); expect([popupTitle, width]).toEqual([`2000 ${make} ${model}`, 480]);
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = []; fixture.openPopup.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); }));
  fixture.client = createClient('https://make-model-popup.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-make-model-${++serial}` },
    global: { fetch: async (input, init) => new Promise<Response>((resolve, reject) => {
      reads.push({ url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null, resolve, reject });
    }) },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(window, 'open').mockReturnValue(null);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe.each(owners)('$name current RPC presentation', owner => {
  it('reports an explicit API failure after initial loading without raw error text', async () => {
    await draw(owner); expect(text()).toBe('LOADING...'); rpc(owner); await settle(null, 403); expect(reads).toHaveLength(1);
    expect(text()).toBe(`${owner.name} details unavailable.`); expect(text()).not.toContain(privateMessage);
  });
  it('reports rejected transport through the installed client', async () => {
    await draw(owner); expect(text()).toBe('LOADING...'); rpc(owner);
    await act(async () => reads[0].reject(new Error(privateMessage))); expect(reads).toHaveLength(1);
    expect(text()).toBe(`${owner.name} details unavailable.`); expect(text()).not.toContain(privateMessage);
  });
  it('preserves one useful pending read across a local-search rerender', async () => {
    await draw(owner); await draw(owner, 'unmatched'); expect(text()).toBe('LOADING...'); expect(reads).toHaveLength(1); rpc(owner);
  });
  it('preserves successful zero counts and the existing tab', async () => {
    await draw(owner); await settle(emptyFor(owner)); expect(text()).toBe(owner.name === 'Make' ? 'TOTAL VEHICLES0TAB' : 'TOTAL0TAB');
    expect(reads).toHaveLength(1); rpc(owner);
  });
  it('preserves successful retained counts and applicable recorded year range', async () => {
    await draw(owner); await settle({ ...emptyFor(owner), total: 12, for_sale: 3, ...(owner.name === 'Model' ? { year_range: { min: 1990, max: 2000 } } : {}) });
    expect(text()).toBe(owner.name === 'Make' ? 'TOTAL VEHICLES12FOR SALE NOW3TAB' : 'TOTAL12FOR SALE NOW3YEARS1990–2000TAB');
    expect(reads).toHaveLength(1); rpc(owner);
  });
  it('preserves close-before-rejected-transport cancellation', async () => {
    await draw(owner); rpc(owner); await act(async () => root.render(null)); await act(async () => reads[0].reject(new Error(privateMessage)));
    expect(text()).toBe(''); expect(reads).toHaveLength(1);
  });
  it('preserves close-before-success cancellation', async () => {
    await draw(owner); rpc(owner); await act(async () => root.render(null)); await settle({ ...emptyFor(owner), total: 12 });
    expect(text()).toBe(''); expect(reads).toHaveLength(1);
  });
});

it('preserves make model/source filtering, bar values and captured popup/tab actions', async () => {
  const owner = owners[0]; await draw(owner); await settle({ ...emptyMake, total: 10,
    top_models: [{ label: model, cnt: 5, avg_price: 12000, for_sale: 2 }, { label: 'Sedan', cnt: 3, avg_price: 8000, for_sale: 0 }],
    sources: [{ label: 'bat', cnt: 7 }, { label: 'mecum', cnt: 3 }] });
  expect(text()).toBe(`TOTAL VEHICLES10MODELS${model}52Sedan3SOURCESbat7mecum3TAB`);
  expect([...host.querySelectorAll<HTMLElement>('div[style*="transition: width"]')].map(node => node.style.width)).toEqual(['100%', '60%']);
  await click([...host.querySelectorAll('span')].find(node => node.textContent === model)!);
  let [element, title, width] = fixture.openPopup.mock.calls[0]; expect(element.type).toBe(ModelPopup); expect(element.props).toEqual({ make, model }); expect([title, width]).toEqual([model, 420]);
  await click(host.querySelector('[role="button"]')!); [element, title, width] = fixture.openPopup.mock.calls[1];
  expect(element.type).toBe(SourcePopup); expect(element.props).toEqual({ source: 'bat' }); expect([title, width]).toEqual(['BAT', 420]);
  await draw(owner, ' seD '); expect(text()).toBe('TOTAL VEHICLES10MODELSSedan3TAB');
  await click(host.querySelector('button')!); expect(window.open).toHaveBeenCalledWith(`/?makes=${encodeURIComponent(make)}`, '_blank');
  expect(reads).toHaveLength(1); rpc(owner);
});
it('preserves make live/recent images, prices, dates and the selected-vehicle followup', async () => {
  const owner = owners[0], date = '2026-09-13T12:00:00Z'; await draw(owner); await settle({ ...emptyMake, total: 2, for_sale: 1,
    live_now: [{ id: 'make-live', year: 2000, model, price: 12500, thumbnail: 'https://images.test/make.jpg', source: 'bat' }],
    recent_sales: [{ id: 'make-sold', year: 1990, model: 'Sedan', sale_price: 24000, sale_date: date, thumbnail: null, mileage: 10, nuke_estimate: 25000, heat_score: 1 }] });
  expect(text()).toBe(`TOTAL VEHICLES2FOR SALE NOW1LIVE NOWBAT2000 ${model}$13KSOLD LAST 90 DAYS1990 Sedan$24K${new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}TAB`);
  expect([...host.querySelectorAll('img')].map(node => node.getAttribute('src'))).toEqual(['https://images.test/make.jpg']);
  await vehicleFollowup(owner, `2000 ${model}`, 'make-live');
});
it('preserves the make price-topology threshold and existing canvas element', async () => {
  const owner = owners[0]; await draw(owner); await settle({ ...emptyMake, price_scatter: Array.from({ length: 5 }, (_, i) => ({ y: 1990 + i, p: 10000 + i * 1000 })) });
  expect(text()).toBe('TOTAL VEHICLES0PRICE TOPOLOGYTAB'); expect(host.querySelectorAll('canvas')).toHaveLength(1); expect(reads).toHaveLength(1); rpc(owner);
});
it('preserves model local filtering, persistent source facets and captured tab URL', async () => {
  const owner = owners[1]; await draw(owner); await settle({ ...emptyModel, total: 2, recent_sales: [], live_now: [], sources: [{ label: 'bat', cnt: 2 }] });
  await draw(owner, 'unmatched'); expect(text()).toBe('TOTAL2SOURCESbat2TAB');
  await click(host.querySelector('button')!); expect(window.open).toHaveBeenCalledWith(`/?makes=${encodeURIComponent(make)}&models=${encodeURIComponent(model)}`, '_blank');
  expect(reads).toHaveLength(1); rpc(owner);
});
it('preserves model live/recent rows, prices, clocks, mileage, estimate and vehicle followup', async () => {
  const owner = owners[1], date = '2026-09-13T12:00:00Z'; await draw(owner); await settle({ ...emptyModel, total: 2,
    live_now: [{ id: 'model-live', year: 2000, make, model, sale_price: 12500, primary_image_url: 'https://images.test/model.jpg', sale_date: null, mileage: 12345.9, nuke_estimate: 14000 }],
    recent_sales: [{ id: 'model-sold', year: 1990, make, model: 'Sedan', sale_price: 24000, primary_image_url: null, sale_date: date, mileage: null, nuke_estimate: null }] });
  expect(text()).toBe(`TOTAL2FOR SALE NOW2000 ${model}$13K12,345 miest. $14KRECENT SALES1990 Sedan$24K${new Date(date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}TAB`);
  expect([...host.querySelectorAll('img')].map(node => node.getAttribute('src'))).toEqual(['https://images.test/model.jpg']);
  await vehicleFollowup(owner, `2000 ${model}`, 'model-live');
});
it('preserves model price-topology threshold, year range and existing canvas element', async () => {
  const owner = owners[1]; await draw(owner); await settle({ ...emptyModel, year_range: { min: 1990, max: 1994 }, price_scatter: Array.from({ length: 5 }, (_, i) => ({ y: 1990 + i, p: 10000 + i * 1000 })) });
  expect(text()).toBe('TOTAL0YEARS1990–1994PRICE TOPOLOGYTAB'); expect(host.querySelectorAll('canvas')).toHaveLength(1); expect(reads).toHaveLength(1); rpc(owner);
});
