// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: state.rpc }, SUPABASE_ANON_KEY: 'fixture', getSupabaseFunctionsUrl: () => 'https://fixture.test' }));
import { StructuredProfileData } from './VehicleDossierPanel';

const VEHICLE = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const FIRST = '20000000-0000-4000-8000-000000000001';
const SECOND = '20000000-0000-4000-8000-000000000002';
const FIELDS = ['year', 'make', 'model', 'vin', 'trim', 'body_style', 'engine_type', 'engine_size', 'transmission', 'drivetrain', 'color', 'interior_color', 'mileage'];
const record = (id = VEHICLE) => ({ schema_version: 'vehicle_data_model_v1', vehicle_id: id, typed_claims_status: 'not_requested',
  retained_record: { origin_relation: 'vehicles', source_attribution_status: 'unassayed', property_bindings: [],
    attributes: Object.fromEntries(FIELDS.map(key => [key, { origin_column: key, unit: null, data_type: 'string',
      value_status: key === 'make' ? 'retained_record_value' : 'unrecorded', value: key === 'make' ? 'Fixture make' : null }])) } });
const claim = (patch: Record<string, unknown> = {}) => ({ property_key: 'image_visible_rust_severity', label: 'Visible rust in image',
  property_id: '30000000-0000-4000-8000-000000000001', observation_id: FIRST, value: 'surface', unit: null,
  source_url: 'https://example.test/source', observed_at: '2026-10-01T00:00:00Z', ingested_at: '2026-10-02T00:00:00Z',
  image_id: '40000000-0000-4000-8000-000000000001', image_url: 'https://example.test/image.jpg',
  evidence_state: 'interpreted', measurement_scope: 'one_image_reading', mechanical_verification: 'unestablished',
  qualifiers: { current_configuration_status: 'unknown', factory_configuration_status: 'unknown' }, ...patch });
const page = (claims = [claim()], next: string | null = null, id = VEHICLE) => ({ ...record(id), typed_claims_status: 'current_registered_scope_read',
  typed_claims: claims, unresolved_properties: [], claim_page: { reader: 'registered_profile_source_claims_v1', has_more: next !== null, next_after: next } });
const response = (data: unknown) => ({ data: [data], error: null });
let host: HTMLDivElement, root: Root;
const render = (id = VEHICLE) => act(async () => { root.render(<MemoryRouter><StructuredProfileData vehicleId={id} /></MemoryRouter>); });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.rpc.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('reads the admitted-property page and renders its scope and source without mechanical proof', async () => {
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page() : record())) }));
  await render();
  expect(state.rpc).toHaveBeenLastCalledWith('get_vehicle_specs', { p_vehicle_ids: [VEHICLE], p_include_typed_claims: true, p_claim_cursor: {} });
  expect(host.textContent).toContain('Visible rust in image'); expect(host.textContent).toContain('Interpreted image reading');
  expect(host.textContent).toContain('Current configuration: unknown'); expect(host.textContent).toContain('Fixture make');
  expect(host.querySelector(`a[href="/vehicle/${VEHICLE}/observation/${FIRST}"]`)).not.toBeNull();
  expect(host.querySelector('a[href="https://example.test/image.jpg"]')?.textContent).toBe('Image witness');
});
it('renders disputed readings and option-code arrays with evidence links', async () => {
  const data = page([claim({ property_key: 'image_spid_rpo_codes', label: 'RPO codes on label', value: ['L82', 'Z49'], evidence_state: 'disputed',
    alternative_readings: [{ observation_id: SECOND, value: ['L82'], agent_model: 'fixture-reader' }] })]);
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? data : record())) }));
  await render();
  expect(host.textContent).toContain('L82, Z49'); expect(host.textContent).toContain('Disputed image reading');
  expect(host.querySelector(`a[href="/vehicle/${VEHICLE}/observation/${SECOND}"]`)).not.toBeNull();
});
it('a failed continuation preserves source claims and retries the same cursor', async () => {
  let continuation = 0;
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(!args.p_include_typed_claims ? response(record())
    : !args.p_claim_cursor.after ? response(page([claim()], FIRST))
    : continuation++ === 0 ? { data: null, error: { message: 'unavailable' } }
    : response(page([claim({ observation_id: SECOND, property_key: 'image_spid_rpo_codes', value: ['Z49'] })]))) }));
  await render();
  await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });
  expect(host.textContent).toContain('surface'); expect(host.textContent).toContain('could not be read');
  await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });
  expect(state.rpc).toHaveBeenLastCalledWith('get_vehicle_specs', { p_vehicle_ids: [VEHICLE], p_include_typed_claims: true, p_claim_cursor: { after: FIRST } });
  expect(host.textContent).toContain('surface'); expect(host.textContent).toContain('Z49'); expect(host.querySelector('button')).toBeNull();
});
it('an unqualified reply cannot assert engine specifications and retains the stored record', async () => {
  const bad = page([claim({ property_key: 'engine_configuration', value: 'Unsupported engine assertion', measurement_scope: 'attributed_source_claim', mechanical_verification: 'verified' })]);
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? bad : record())) }));
  await render();
  expect(host.textContent).not.toContain('Unsupported engine assertion'); expect(host.textContent).toContain('Fixture make');
  expect(host.textContent).toContain('Structured evidence could not be read');
});
it('a late response from the previous vehicle cannot replace current source claims', async () => {
  let release!: (v: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => {
    const id = args.p_vehicle_ids[0];
    return !args.p_include_typed_claims ? Promise.resolve(response(record(id))) : id === VEHICLE ? pending
      : Promise.resolve(response(page([claim({ label: 'Current vehicle image' })], null, OTHER)));
  } }));
  await render(); await render(OTHER);
  await act(async () => { release(response(page([claim({ label: 'Previous vehicle image' })]))); });
  expect(host.textContent).toContain('Current vehicle image'); expect(host.textContent).not.toContain('Previous vehicle image');
});
it('an input-limit refusal remains visible without pretending that the evidence is absent', async () => {
  const limited = { ...page([]), unresolved_properties: [{ property_key: 'image_visible_rust_severity', reason: 'source_reader_refused_input_limit' }] };
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? limited : record())) }));
  await render(); expect(host.textContent).toContain('exceeds the current reader limit and remains unresolved');
});
