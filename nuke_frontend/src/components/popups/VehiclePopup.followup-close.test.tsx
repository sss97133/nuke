// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, recordView: vi.fn(), endView: vi.fn(), recordInterest: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView: fixture.recordView, endView: fixture.endView }) }));
vi.mock('../../hooks/useInterests', () => ({ useInterests: () => ({ recordInterest: fixture.recordInterest }) }));
vi.mock('./PopupContainer', () => ({ PopupContainer: ({ stack, onClose }: any) => <>{stack.map((entry: any) => <section key={entry.id} data-popup-title={entry.title}>
  <button onClick={() => onClose(entry.id)}>Close</button>{entry.title === 'CURRENT VEHICLE' ? entry.content : <output data-vehicle-id={entry.content.props.vehicle.id}>Vehicle destination</output>}</section>)}</> }));
vi.mock('./MakePopup', () => ({ MakePopup: () => null }));
vi.mock('./ModelPopup', () => ({ ModelPopup: () => null }));
vi.mock('./SourcePopup', () => ({ SourcePopup: () => null }));
vi.mock('../../lib/imageOptimizer', () => ({ optimizeImageUrl: () => { throw Error('Unexpected image optimization'); } }));
import { PopupStackProvider } from './PopupStack';
import { usePopup } from './usePopup';
import { VehiclePopup } from './VehiclePopup';
import { VEHICLE_POPUP_COLUMNS } from './vehiclePopupColumns';

type Read = { url: URL; method: string; body: unknown; resolve: (response: Response) => void; reject: (reason: Error) => void };
let root: Root, host: HTMLDivElement, controls: ReturnType<typeof usePopup>, reads: Read[], serial = 0;
function Control() { controls = usePopup(); return null; }
const vehicle = Object.freeze({ id: '00000000-0000-4000-8000-00000000000a', year: 2000, make: 'Synthetic', model: 'Current', discovery_source: 'synthetic-source', discovery_url: 'https://example.test/lot' });
const scope = { method: 'same_year_exact_model', subject_id: null, label: '2000 Current', basis: 'Same recorded model year; canonical aliases only when the canonical model resolves uniquely.',
  fallback_reason: 'no_supported_registered_scope', supported_scope_count: 0, condition_matched: false, condition_note: 'Sold context only. Condition, restoration and build class have not been matched.',
  sale_rule: 'vehicle_price_facts / vehicle_sale_basis', date_rule: 'Recorded sold date required; ingest time is never a sale date.', grain: 'one current recorded sale per public vehicle; not a historical transaction ledger' };
const comp = { id: 'synthetic-comp', year: 2000, model: 'Current', sale_price: 24000, sale_date: '2026-09-13T12:00:00Z', thumbnail: null, mileage: 12000.9,
  sold_basis: 'synthetic-recorded-sale', sold_amount_from: 'synthetic-source', platform: 'synthetic-source', source_url: 'https://example.test/comp', condition_matched: false };
const intel = { comment_evidence: { source_limit: 20, atom_limit: 200, sources_returned: 0, atoms_returned: 0, sources_truncated: false, atoms_truncated: false,
  scope: 'Latest 20 non-bid public source comments; at most 200 qualified atoms linked to those sources. Inferred source testimony, not verified vehicle facts.', source_comments: [], atoms: [] },
  comment_intel: null, description_intel: null, scores: { nuke_estimate: null, nuke_confidence: null, heat_score: null, deal_score: null }, apparitions: [], recent_comps: [comp], recent_comps_scope: scope };
const privateMessage = 'Synthetic private followup refusal';
async function finish(index: number, value: unknown, status = 200, rejected = false) {
  const before = structuredClone(value);
  await act(async () => rejected ? reads[index].reject(new Error(privateMessage)) : reads[index].resolve(new Response(JSON.stringify(status === 200 ? value : { code: '42501', message: privateMessage }),
    { status, headers: { 'Content-Type': 'application/json' } })));
  expect(value).toEqual(before);
}
function initialQuery() {
  expect(reads[0].method).toBe('POST'); expect(reads[0].url.pathname).toBe('/rest/v1/rpc/popup_vehicle_intel');
  expect([...reads[0].url.searchParams]).toEqual([]); expect(reads[0].body).toEqual({ p_vehicle_id: vehicle.id });
}
function selectedQuery() {
  expect(reads[1].method).toBe('GET'); expect(reads[1].url.pathname).toBe('/rest/v1/vehicles');
  expect([...reads[1].url.searchParams]).toEqual([['select', VEHICLE_POPUP_COLUMNS.replace(/\s/g, '')], ['id', `eq.${comp.id}`]]); expect(reads[1].body).toBeNull();
}
async function openReader() {
  await act(async () => controls.openPopup(<VehiclePopup vehicle={vehicle as any} />, 'CURRENT VEHICLE', 480));
  expect(controls.stack).toHaveLength(1); expect(host.textContent).toContain('Loading intelligence...'); expect(reads).toHaveLength(1); initialQuery();
}
async function choose() {
  await finish(0, intel);
  const node = [...host.querySelectorAll('span')].find(element => element.textContent === '2000 Current')!;
  expect(node).toBeDefined(); await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(controls.stack).toHaveLength(1); expect(reads).toHaveLength(2); initialQuery(); selectedQuery();
}
async function closeReader() {
  await act(async () => controls.closeTop()); expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(host.querySelector('section')).toBeNull();
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = []; fixture.recordView.mockClear(); fixture.endView.mockClear(); fixture.recordInterest.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network forbidden'); }));
  fixture.client = createClient('https://vehicle-comp-followup-close.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `vehicle-comp-followup-close-${++serial}` },
    global: { fetch: async (input, init) => new Promise<Response>((resolve, reject) => reads.push({
      url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, resolve, reject,
    })) },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<PopupStackProvider><Control /></PopupStackProvider>)); expect(controls.stack).toEqual([]);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(fixture.recordView.mock.calls).toEqual([[vehicle.id, 'popup']]); expect(fixture.recordInterest.mock.calls).toEqual([['make', vehicle.make], ['model', vehicle.model]]);
  expect(fixture.endView.mock.calls).toEqual([[vehicle.id]]); vi.unstubAllGlobals();
});

it('preserves mounted comparable success with raw vehicle/title/width and exact query', async () => {
  await openReader(); await choose(); const full = { id: comp.id, make: vehicle.make, model: comp.model, series: 'Unmodified returned series' };
  await finish(1, full); expect(reads).toHaveLength(2); expect(controls.stack).toHaveLength(2);
  const entry = controls.stack[1], element = entry.content as React.ReactElement<any>;
  expect(element.type).toBe(VehiclePopup); expect(element.props).toEqual({ vehicle: full }); expect([entry.title, entry.width, entry.searchable]).toEqual(['2000 Current', 480, true]);
  expect(host.querySelector('output')!.getAttribute('data-vehicle-id')).toBe(comp.id);
});
it('withholds comparable success after actual closeTop unmounts the initiating reader', async () => {
  await openReader(); await choose(); await closeReader(); await finish(1, { id: comp.id, make: vehicle.make, model: comp.model });
  expect(reads).toHaveLength(2); expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(host.querySelector('output')).toBeNull();
});
it('preserves closed comparable API refusal without opening a destination or revealing its message', async () => {
  await openReader(); await choose(); await closeReader(); await finish(1, null, 403);
  expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(reads).toHaveLength(2); expect(host.textContent).not.toContain(privateMessage);
});
it('preserves closed comparable SDK-normalized fetch refusal without opening a destination', async () => {
  await openReader(); await choose(); await closeReader(); await finish(1, null, 200, true);
  expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(reads).toHaveLength(2);
});
it('preserves existing main-RPC cancellation when the reader closes before its response', async () => {
  await openReader(); await closeReader(); await finish(0, intel);
  expect(controls.stack).toEqual([]); expect(host.textContent).toBe(''); expect(reads).toHaveLength(1); initialQuery();
});
