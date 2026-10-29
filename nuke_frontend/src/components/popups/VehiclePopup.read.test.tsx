// @vitest-environment jsdom
import React, { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any, recordView: vi.fn(), endView: vi.fn(), recordInterest: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
vi.mock('../../hooks/useViewHistory', () => ({ useViewHistory: () => ({ recordView: fixture.recordView, endView: fixture.endView }) }));
vi.mock('../../hooks/useInterests', () => ({ useInterests: () => ({ recordInterest: fixture.recordInterest }) }));
vi.mock('./PopupStack', async () => { const { createContext } = await import('react'); return { PopupStackContext: createContext(null) }; });
vi.mock('./MakePopup', () => ({ MakePopup: () => null }));
vi.mock('./ModelPopup', () => ({ ModelPopup: () => null }));
vi.mock('./SourcePopup', () => ({ SourcePopup: () => null }));
vi.mock('../../lib/imageOptimizer', () => ({ optimizeImageUrl: () => { throw Error('Unexpected image optimization'); } }));
import { VehiclePopup } from './VehiclePopup';
import { MakePopup } from './MakePopup';
import { ModelPopup } from './ModelPopup';
import { SourcePopup } from './SourcePopup';
import { PopupStackContext } from './PopupStack';
import { VEHICLE_POPUP_COLUMNS } from './vehiclePopupColumns';

type Read = { url: URL; method: string; body: unknown; resolve: (response: Response) => void; reject: (reason: Error) => void };
let root: Root, host: HTMLDivElement, reads: Read[], serial = 0;
const push = vi.fn(() => 'synthetic-popup');
const context = { stack: [], push, pop: vi.fn(), popTop: vi.fn(), closeAll: vi.fn(), toggleMinimize: vi.fn(), toggleExpanded: vi.fn() };
const vehicle = Object.freeze({ id: '00000000-0000-4000-8000-00000000000a', year: 2000, make: 'Ford', model: 'Coupe',
  discovery_source: 'synthetic-source', discovery_url: 'https://example.test/lot' });
const privateMessage = 'Synthetic private intelligence read refused';
const baseText = '2000 Ford Coupe—synthetic-sourceView listingOpen full profile';
const scope = { method: 'same_year_exact_model', subject_id: null, label: '2000 Coupe',
  basis: 'Same recorded model year; canonical aliases only when the canonical model resolves uniquely.', fallback_reason: 'no_supported_registered_scope', supported_scope_count: 0,
  condition_matched: false, condition_note: 'Sold context only. Condition, restoration and build class have not been matched.', sale_rule: 'vehicle_price_facts / vehicle_sale_basis',
  date_rule: 'Recorded sold date required; ingest time is never a sale date.', grain: 'one current recorded sale per public vehicle; not a historical transaction ledger' };
const empty = { comment_evidence: { source_limit: 20, atom_limit: 200, sources_returned: 0, atoms_returned: 0, sources_truncated: false, atoms_truncated: false,
  scope: 'Latest 20 non-bid public source comments; at most 200 qualified atoms linked to those sources. Inferred source testimony, not verified vehicle facts.', source_comments: [], atoms: [] },
  comment_intel: null, description_intel: null, scores: { nuke_estimate: null, nuke_confidence: null, heat_score: null, deal_score: null }, apparitions: [], recent_comps: [], recent_comps_scope: scope };
const legacyEmpty = { comment_intel: null, description_intel: null, scores: null, apparitions: null, recent_comps: null };
const text = () => host.textContent;
const links = () => [...host.querySelectorAll('a')].map(node => ({ text: node.textContent, href: node.getAttribute('href'), target: node.getAttribute('target'), rel: node.getAttribute('rel') }));
const expectedLinks = [{ text: 'View listing', href: vehicle.discovery_url, target: '_blank', rel: 'noopener noreferrer' },
  { text: 'Open full profile', href: `/vehicle/${vehicle.id}`, target: null, rel: null }];
async function draw(current: Record<string, unknown> = vehicle, searchQuery?: string) {
  await act(async () => root.render(<MemoryRouter><PopupStackContext.Provider value={context}><VehiclePopup vehicle={current as any} searchQuery={searchQuery} /></PopupStackContext.Provider></MemoryRouter>));
}
async function settle(data: unknown, status = 200, index = 0) {
  const raw = structuredClone(data);
  await act(async () => reads[index].resolve(new Response(JSON.stringify(status === 200 ? data : { code: '42501', message: privateMessage }),
    { status, headers: { 'Content-Type': 'application/json' } })));
  expect(data).toEqual(raw);
}
function rpc() {
  expect(reads[0].method).toBe('POST'); expect(reads[0].url.pathname).toBe('/rest/v1/rpc/popup_vehicle_intel');
  expect([...reads[0].url.searchParams]).toEqual([]); expect(reads[0].body).toEqual({ p_vehicle_id: vehicle.id });
}
async function click(node: Element) { await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; reads = []; push.mockClear(); fixture.recordView.mockClear(); fixture.endView.mockClear(); fixture.recordInterest.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Real network forbidden'); }));
  fixture.client = createClient('https://vehicle-popup.test', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `synthetic-vehicle-popup-${++serial}` },
    global: { fetch: async (input, init) => new Promise<Response>((resolve, reject) => reads.push({
      url: new URL(input instanceof Request ? input.url : String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null, resolve, reject,
    })) },
  });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(fixture.recordView.mock.calls).toEqual([[vehicle.id, 'popup']]);
  expect(fixture.recordInterest.mock.calls).toEqual([['make', 'Ford'], ['model', 'Coupe']]); expect(fixture.endView.mock.calls).toEqual([[vehicle.id]]);
  vi.unstubAllGlobals();
});

it('retains supplied vehicle/links and reports current API failure without raw error text', async () => {
  await draw(); expect(text()).toBe(`${baseText}Loading intelligence...`); rpc(); await settle(null, 403);
  expect(links()).toEqual(expectedLinks); expect(reads).toHaveLength(1);
  expect(text()).toBe(`${baseText}Vehicle intelligence unavailable.`); expect(text()).not.toContain(privateMessage);
});
it('reports current rejected transport through the installed client without hiding the supplied vehicle', async () => {
  await draw(); rpc(); await act(async () => reads[0].reject(new Error(privateMessage)));
  expect(links()).toEqual(expectedLinks); expect(reads).toHaveLength(1);
  expect(text()).toBe(`${baseText}Vehicle intelligence unavailable.`); expect(text()).not.toContain(privateMessage);
});
it('preserves one current pending read and tracking across a local search rerender', async () => {
  await draw(); await draw(vehicle, 'local-filter'); expect(text()).toBe(`${baseText}Loading intelligence...`);
  expect(links()).toEqual(expectedLinks); expect(reads).toHaveLength(1); rpc();
});
it.each([{ name: 'SQL null with no eligible reference', data: null }, { name: 'current contract empty arrays and evidence envelope', data: empty },
  { name: 'legacy synthetic all-null interface object', data: legacyEmpty }])('preserves successful $name without inventing an error', async ({ data }) => {
  await draw(); rpc(); await settle(data); expect(text()).toBe(baseText); expect(links()).toEqual(expectedLinks); expect(reads).toHaveLength(1);
});
it('preserves complete retained comment/description inline output', async () => {
  await draw(); await settle({ ...empty, comment_intel: { sentiment: null, key_quotes: ['Synthetic source quote'], expert_insights: [{ insight: 'Synthetic expert statement' }],
    community_concerns: ['Synthetic concern'], price_sentiment: null, market_signals: null, seller_disclosures: null, authenticity: null, overall_sentiment: 'positive', sentiment_score: 0.5, comment_count: 3 },
    description_intel: { red_flags: [{ f: 'Synthetic condition flag', sev: 'low' }], mods: ['Synthetic modification'], work_history: null, condition: null,
      condition_note: 'Synthetic condition testimony', title_status: null, owner_count: 0, matching_numbers: false, documentation: [], option_codes: null, equipment: null, price_positive: null, price_negative: null } });
  expect(text()).toBe('2000 Ford Coupe—Community summariespositive 50%3 commentsSynthetic source quoteReported expert insightsSynthetic expert statementConcerns raisedSynthetic concernListing summariesSynthetic condition testimonyNOT MATCHING0 OWNERSReported concernslowSynthetic condition flagModifications (1)Synthetic modificationsynthetic-sourceView listingOpen full profile');
  expect(links()).toEqual(expectedLinks); expect(reads).toHaveLength(1); rpc();
});
it('preserves complete retained score values and confidence', async () => {
  await draw(); await settle({ ...empty, scores: { nuke_estimate: 12000, nuke_confidence: 80, heat_score: 45, deal_score: 65 } });
  expect(text()).toBe('2000 Ford Coupe—Nuke estimate$12,00080% confidenceHeat45Deal65synthetic-sourceView listingOpen full profile');
  expect(reads).toHaveLength(1); rpc();
});
it('preserves supplied asking price/specs and captured make/model/source actions through actual usePopup', async () => {
  const current = Object.freeze({ ...vehicle, series: 'S1', is_for_sale: true, asking_price: 12500, mileage: 12345.9, transmission: 'Manual', drivetrain: 'RWD', engine_size: '2.0 L', body_style: 'Coupe', fuel_type: 'Gasoline', vin: 'SYNTHETIC12345678', location: 'Synthetic place' });
  const raw = structuredClone(current); await draw(current); await settle(empty);
  expect(text()).toBe('2000 Ford Coupe S1$12,500For saleMileage12,345 miTransmissionManualDrivetrainRWDEngine2.0 LBodyCoupeFuelGasolineVIN...12345678LocationSynthetic placesynthetic-sourceView listingOpen full profile');
  const buttons = [...host.querySelectorAll('.vehicle-popup-text-action')]; await click(buttons[0]); await click(buttons[1]); await click(buttons[2]);
  const calls = push.mock.calls as unknown as [React.ReactElement<any>, string, number][];
  expect(calls.map(([element, title, width]) => ({ type: element.type, props: element.props, title, width }))).toEqual([
    { type: MakePopup, props: { make: 'Ford' }, title: 'Ford', width: 480 }, { type: ModelPopup, props: { make: 'Ford', model: 'Coupe' }, title: 'Coupe', width: 420 },
    { type: SourcePopup, props: { source: 'synthetic-source' }, title: 'SYNTHETIC-SOURCE', width: 420 },
  ]); expect(current).toEqual(raw); expect(links()).toEqual(expectedLinks); expect(reads).toHaveLength(1); rpc();
});
it('preserves qualified sold context, recorded dates/apparitions and the existing comparable followup', async () => {
  const date = '2026-09-13T12:00:00Z'; await draw(); await settle({ ...empty,
    recent_comps: [{ id: 'synthetic-comp', year: 2000, model: 'Coupe', sale_price: 24000, sale_date: date, thumbnail: null, mileage: 12000.9,
      sold_basis: 'synthetic-recorded-sale', sold_amount_from: 'synthetic-source', platform: 'synthetic-source', source_url: 'https://example.test/comp', condition_matched: false }],
    apparitions: [{ platform: 'synthetic-one', url: 'https://example.test/one', event_type: 'auction', event_date: date, price: 24000 },
      { platform: 'synthetic-two', url: null, event_type: 'listing', event_date: null, price: null }] });
  const formatted = new Date(date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  expect(text()).toBe(`2000 Ford Coupe—Recent sold context2000 Coupe · Condition not matched2000 Coupe12,000 mi$24,000${formatted}Recorded sightingssynthetic-oneauction$24,000${formatted}synthetic-twolistingsynthetic-sourceView listingOpen full profile`);
  expect(host.querySelector('[title="' + scope.basis + '"]')).not.toBeNull();
  await click([...host.querySelectorAll('span')].find(node => node.textContent === '2000 Coupe')!); expect(reads).toHaveLength(2); rpc();
  expect(reads[1].method).toBe('GET'); expect(reads[1].url.pathname).toBe('/rest/v1/vehicles');
  expect([...reads[1].url.searchParams]).toEqual([['select', VEHICLE_POPUP_COLUMNS.replace(/\s/g, '')], ['id', 'eq.synthetic-comp']]);
  const full = { id: 'synthetic-comp', make: 'Ford', model: 'Coupe' }; await settle(full, 200, 1);
  const [element, title, width] = push.mock.calls[0] as unknown as [React.ReactElement<any>, string, number];
  expect(element.type).toBe(VehiclePopup); expect(element.props).toEqual({ vehicle: full }); expect([title, width]).toEqual(['2000 Coupe', 480]);
});
it('preserves close-before-API-error cancellation and tracking cleanup', async () => {
  await draw(); rpc(); await act(async () => root.render(null)); await settle(null, 403); expect(text()).toBe(''); expect(reads).toHaveLength(1);
});
it('preserves close-before-rejected-transport cancellation and tracking cleanup', async () => {
  await draw(); rpc(); await act(async () => root.render(null)); await act(async () => reads[0].reject(new Error(privateMessage)));
  expect(text()).toBe(''); expect(reads).toHaveLength(1);
});
it('preserves close-before-success cancellation and tracking cleanup', async () => {
  await draw(); rpc(); await act(async () => root.render(null)); await settle(empty); expect(text()).toBe(''); expect(reads).toHaveLength(1);
});
