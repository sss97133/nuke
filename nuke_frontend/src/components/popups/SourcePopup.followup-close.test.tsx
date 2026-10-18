// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('./PopupContainer', () => ({ PopupContainer: ({ stack, onClose }: any) => <>{stack.map((entry: any) => <section key={entry.id} data-popup-title={entry.title}>
  <button onClick={() => onClose(entry.id)}>Close</button>{entry.content}</section>)}</> }));
vi.mock('./VehiclePopup', () => ({ VehiclePopup: ({ vehicle }: any) => <output data-vehicle-id={vehicle.id}>Vehicle destination</output> }));
vi.mock('./MakePopup', () => ({ MakePopup: () => null }));
import { PopupStackProvider } from './PopupStack';
import { usePopup } from './usePopup';
import { SourcePopup } from './SourcePopup';
import { VehiclePopup } from './VehiclePopup';
import { VEHICLE_POPUP_COLUMNS } from './vehiclePopupColumns';

type Read = { url: URL; method: string; body: unknown; resolve: (response: Response) => void; reject: (reason: Error) => void };
let root: Root, host: HTMLDivElement, controls: ReturnType<typeof usePopup>, reads: Read[], serial = 0;
function Control() { controls = usePopup(); return null; }
const empty = { total: 0, for_sale: 0, sold_this_week: 0, sold_this_month: 0, recent_sales: [], live_now: [], top_makes: [] };
const live = { id: 'fixture-live', year: 2001, make: 'Synthetic', model: 'Live', price: 12000, thumbnail: null };
const recent = { id: 'fixture-recent', year: 2000, make: 'Synthetic', model: 'Recent', sale_price: 24000, sale_date: '2026-09-13T12:00:00Z', thumbnail: null };
const privateMessage = 'Synthetic private followup refusal';
async function finish(index: number, value: unknown, status = 200, rejected = false) {
  const before = structuredClone(value);
  await act(async () => rejected ? reads[index].reject(new Error(privateMessage)) : reads[index].resolve(new Response(JSON.stringify(status === 200 ? value : { code: '42501', message: privateMessage }),
    { status, headers: { 'Content-Type': 'application/json' } })));
  expect(value).toEqual(before);
}
function initialQuery() {
  expect(reads[0].method).toBe('POST'); expect(reads[0].url.pathname).toBe('/rest/v1/rpc/popup_source_intel');
  expect([...reads[0].url.searchParams]).toEqual([]); expect(reads[0].body).toEqual({ p_source: 'fixture-source' });
}
function selectedQuery(id: string) {
  expect(reads[1].method).toBe('GET'); expect(reads[1].url.pathname).toBe('/rest/v1/vehicles');
  expect([...reads[1].url.searchParams]).toEqual([['select', VEHICLE_POPUP_COLUMNS.replace(/\s/g, '')], ['id', `eq.${id}`]]); expect(reads[1].body).toBeNull();
}
async function openSource() {
  await act(async () => controls.openPopup(<SourcePopup source="fixture-source" />, 'FIXTURE SOURCE', 360));
  expect(controls.stack).toHaveLength(1); expect(host.textContent).toBe('CloseLOADING...'); expect(reads).toHaveLength(1); initialQuery();
}
async function choose(section: 'live' | 'recent') {
  const row = section === 'live' ? live : recent;
  await finish(0, { ...empty, total: 1, ...(section === 'live' ? { live_now: [live] } : { recent_sales: [recent] }) });
  const title = `${row.year} ${row.make} ${row.model}`;
  const node = [...host.querySelectorAll(section === 'live' ? 'div' : 'span')].find(element => element.textContent === title)!;
  expect(node).toBeDefined(); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(controls.stack).toHaveLength(1); expect(reads).toHaveLength(2); selectedQuery(row.id); return { row, title };
}
async function closeSource() {
  await act(async () => controls.closeTop()); expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(host.querySelector('section')).toBeNull();
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = [];
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network forbidden'); }));
  fixture.client = createClient('https://source-followup-close.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `source-followup-close-${++serial}` },
    global: { fetch: async (input, init) => new Promise<Response>((resolve, reject) => reads.push({
      url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, resolve, reject,
    })) },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<PopupStackProvider><Control /></PopupStackProvider>)); expect(controls.stack).toEqual([]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

it.each(['live', 'recent'] as const)('preserves mounted selected %s success with raw vehicle/title/width and exact query', async section => {
  await openSource(); const { row, title } = await choose(section); const full = { id: row.id, make: row.make, model: row.model, series: 'Unmodified returned series' };
  await finish(1, full); expect(reads).toHaveLength(2); expect(controls.stack).toHaveLength(2);
  const entry = controls.stack[1], element = entry.content as React.ReactElement<any>;
  expect(element.type).toBe(VehiclePopup); expect(element.props).toEqual({ vehicle: full }); expect([entry.title, entry.width, entry.searchable]).toEqual([title, 480, true]);
  expect(host.querySelector('output')!.getAttribute('data-vehicle-id')).toBe(row.id);
});
it.each(['live', 'recent'] as const)('withholds selected %s success after actual closeTop unmounts the initiating source', async section => {
  await openSource(); const { row } = await choose(section); await closeSource(); await finish(1, { id: row.id, make: row.make, model: row.model });
  expect(reads).toHaveLength(2); expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(host.querySelector('output')).toBeNull();
});
it('preserves closed selected API refusal without opening a destination or revealing its message', async () => {
  await openSource(); await choose('live'); await closeSource(); await finish(1, null, 403);
  expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(reads).toHaveLength(2); expect(host.textContent).not.toContain(privateMessage);
});
it('preserves closed selected SDK-normalized fetch refusal without opening a destination', async () => {
  await openSource(); await choose('live'); await closeSource(); await finish(1, null, 200, true);
  expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(reads).toHaveLength(2);
});
it('preserves existing main-RPC cancellation when the source closes before its response', async () => {
  await openSource(); await closeSource(); await finish(0, { ...empty, total: 1, live_now: [live] });
  expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(reads).toHaveLength(1); initialQuery();
});
