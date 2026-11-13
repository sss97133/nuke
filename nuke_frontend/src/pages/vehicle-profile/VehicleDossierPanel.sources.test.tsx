// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), provenance: new Map<string, unknown>() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: state.rpc, functions: { invoke: state.invoke } }, SUPABASE_ANON_KEY: 'fixture', getSupabaseFunctionsUrl: () => 'https://fixture.test' }));
vi.mock('./hooks/useFieldProvenance', async importOriginal => ({
  ...await importOriginal<typeof import('./hooks/useFieldProvenance')>(),
  useFieldProvenance: (_id: string, field: string) => ({ data: state.provenance.get(field), isError: false }),
}));
import { StructuredProfileData } from './VehicleDossierPanel';
import { PHYSICAL_READING_METHOD, PHYSICAL_READING_ROLES } from './profileSourceClaims';

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
  state.rpc.mockReset(); state.invoke.mockReset(); state.provenance.clear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
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
  await act(async () => { (host.querySelector('[aria-label="Structured source claims"] button') as HTMLButtonElement).click(); });
  expect(host.textContent).toContain('surface'); expect(host.textContent).toContain('could not be read');
  await act(async () => { (host.querySelector('[aria-label="Structured source claims"] button') as HTMLButtonElement).click(); });
  expect(state.rpc).toHaveBeenLastCalledWith('get_vehicle_specs', { p_vehicle_ids: [VEHICLE], p_include_typed_claims: true, p_claim_cursor: { after: FIRST } });
  expect(host.textContent).toContain('surface'); expect(host.textContent).toContain('Z49'); expect(host.querySelector('[aria-label="Structured source claims"] button')).toBeNull();
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
it('opens the selected recorded value directly and lets an empty field inspect evidence', async () => {
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page([]) : record())) }));
  const inspect = vi.fn();
  await act(async () => root.render(<MemoryRouter><StructuredProfileData vehicleId={VEHICLE} onInspect={inspect} /></MemoryRouter>));
  await act(async () => (host.querySelector('[data-record-field="make"] button') as HTMLButtonElement).click());
  expect(inspect).toHaveBeenLastCalledWith('make', 'Make', 'Fixture make');
  await act(async () => (host.querySelector('[data-record-field="mileage"] button') as HTMLButtonElement).click());
  expect(inspect).toHaveBeenLastCalledWith('mileage', 'Odometer', '');
});

it('puts the exact physical odometer reading in the existing row and opens its source directly', async () => {
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page([]) : record())) }));
  state.provenance.set('mileage', physical('mileage', '12.3 miles shown', 'Total mileage unknown.'));
  const inspect = vi.fn();
  await act(async () => root.render(<MemoryRouter><StructuredProfileData vehicleId={VEHICLE} onInspect={inspect} /></MemoryRouter>));
  const row = host.querySelector('[data-record-field="mileage"]')!;
  expect(row.textContent).toContain('12.3 miles shown'); expect(row.textContent).toContain('Total mileage unknown.');
  expect(row.querySelectorAll('button')).toHaveLength(1);
  await act(async () => (row.querySelector('button') as HTMLButtonElement).click());
  expect(inspect).toHaveBeenLastCalledWith('mileage', 'Odometer', '12.3 miles shown');
  state.provenance.set('mileage', { ...physical('mileage', '12.3 miles shown', 'Total mileage unknown.'), image_observations: [] });
  await render();
  expect(host.querySelector('[data-record-field="mileage"]')!.textContent).not.toContain('12.3');
});
it('keeps decoded factory paint separate from current exterior color and omits an empty factory row', async () => {
  const stored = record(); stored.retained_record.attributes.color = { origin_column: 'color', unit: null, data_type: 'string', value_status: 'retained_record_value', value: 'Green' };
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page([]) : stored)) }));
  await render(); expect(host.querySelector('[data-record-field="factory_color"]')).toBeNull();
  state.provenance.set('factory_color', physical('factory_color', 'Factory blue (42)', 'Decoded tag; present paint formula not established.'));
  await render();
  expect(host.querySelector('[data-record-field="color"]')!.textContent).toContain('Green');
  expect(host.querySelector('[data-record-field="factory_color"]')!.textContent).toContain('Factory blue (42)');
});
it('preserves missing units on the legacy mileage fallback', async () => {
  const stored = record();
  Object.assign(stored.retained_record.attributes.mileage, { value: 123, data_type: 'integer', value_status: 'retained_record_value' });
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page([]) : stored)) }));
  await render();
  const row = host.querySelector('[data-record-field="mileage"]')!;
  expect(row.textContent).toContain('123'); expect(row.textContent).toContain('Unit not established');
  expect(row.textContent).not.toContain('miles shown');
});

it('shows a replica appearance source without reasserting retained trim or its derived binding', async () => {
  const stored = record();
  Object.assign(stored.retained_record.attributes.trim, { value: 'SPORT', value_status: 'retained_record_value' });
  (stored.retained_record.property_bindings as unknown[]).push({ property_key: 'trim_name', origin_column: 'trim',
    value: 'SPORT deluxe', unit: null, record_columns_disagree: false });
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page([]) : stored)) }));
  state.provenance.set('appearance', physical('appearance', 'Sport-style', 'Visible exterior treatment; factory trim is not established.'));
  const inspect = vi.fn();
  const renderReplica = () => act(async () => root.render(<MemoryRouter><StructuredProfileData vehicleId={VEHICLE}
    isReplica onInspect={inspect} /></MemoryRouter>));
  await renderReplica();
  expect(host.querySelector('[data-record-field="trim"]')).toBeNull();
  expect(host.textContent).not.toContain('SPORT');
  const row = host.querySelector('[data-record-field="appearance"]')!;
  expect(row.textContent).toContain('Sport-style');
  expect(row.textContent).toContain('factory trim is not established');
  await act(async () => (row.querySelector('button') as HTMLButtonElement).click());
  expect(inspect).toHaveBeenLastCalledWith('appearance', 'Appearance', 'Sport-style');
  // Withdrawing the image must not resurrect the known replica trim.
  state.provenance.set('appearance', { ...physical('appearance', 'Sport-style', 'Exterior only.'), image_observations: [] });
  await renderReplica();
  expect(host.querySelector('[data-record-field="appearance"]')).toBeNull();
  expect(host.textContent).not.toContain('SPORT');
  await render();
  expect(host.querySelector('[data-record-field="trim"]')!.textContent).toContain('SPORT');
});

function physical(field: keyof typeof PHYSICAL_READING_ROLES, value: string, limitation: string) {
  const image = '40000000-0000-4000-8000-000000000001';
  return { vehicle_id: VEHICLE, field, value: null, evidence: [], observations: [], image_observations: [{
    observation_id: FIRST, image_id: image, image_url: 'https://example.test/physical.jpg', source_url: 'https://example.test/physical.jpg',
    witness_id: SECOND, witness_role: 'derived', source_family: `image:${image}`, value, limitation,
    extraction_method: PHYSICAL_READING_METHOD, agent_model: 'fixture', claim_role: PHYSICAL_READING_ROLES[field],
    is_inferred: true, visual_relation: field === 'factory_color' ? 'direct_code' : 'direct_visual',
  }] };
}

it('the current profile exposes an on-demand evidence review without a stored estimate', async () => {
  const { fixture } = await import('../../services/__tests__/listingEvidenceFixture');
  await import('../../components/vehicle/VehicleEvidenceAssessment');
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page() : record())) }));
  state.invoke.mockResolvedValue({ data: { action: 'assessment', read_only: true, assessment: fixture().assessment }, error: null });
  await act(async () => { root.render(<MemoryRouter><StructuredProfileData vehicleId={VEHICLE} canReview /></MemoryRouter>); });
  const review = [...host.querySelectorAll('button')].find(b => b.textContent === 'Review evidence');
  expect(review).toBeDefined(); expect(state.invoke).not.toHaveBeenCalled();
  await act(async () => review!.click());
  expect(state.invoke).toHaveBeenCalledWith('compute-vehicle-valuation', { body: { action: 'assessment', vehicle_id: VEHICLE } });
  expect(host.querySelector('section[aria-label="Vehicle evidence assessment"]')).not.toBeNull();
  expect(host.textContent).toContain('Fixture make');
  expect(host.textContent).toContain('Installed and factory configuration remain unresolved');
});
it('anonymous structured profiles keep their source data without an authenticated assessment action', async () => {
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page() : record())) }));
  await render();
  expect(host.textContent).toContain('Fixture make');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Review evidence')).toBe(false);
  expect(state.invoke).not.toHaveBeenCalled();
});
it('renders a field a header token states as that token\'s line items, once, with no field provenance read', async () => {
  state.rpc.mockImplementation((_name, args) => ({ abortSignal: () => Promise.resolve(response(args.p_include_typed_claims ? page([]) : record())) }));
  const item = (key: string, facet: 'as_built' | 'current' | 'decode', value: unknown, status: 'established' | 'reading' | 'missing', needed: string | null = null) =>
    ({ key, facet, value, unit: null, status, sources: [], rule: null, equation: null, needed });
  const tokenItems = {
    transmission: [item('transmission.as_built.model', 'as_built', null, 'missing', 'build sheet'),
      item('transmission.current.case_casting', 'current', 'C-0001', 'reading')],
    engine: [item('engine.current.block_casting', 'current', 'B-0001', 'reading')],
  };
  await act(async () => { root.render(<MemoryRouter><StructuredProfileData vehicleId={VEHICLE} tokenItems={tokenItems as any} /></MemoryRouter>); });
  const trans = host.querySelector('tr[data-token-items="transmission"]');
  expect(trans?.querySelector('.vp-structured-record__items-label')?.textContent).toBe('Transmission');
  expect(trans?.textContent).toContain('As built'); expect(trans?.textContent).toContain('Needed: build sheet');
  expect(trans?.textContent).toContain('C-0001');
  expect(host.querySelectorAll('tr[data-token-items="engine"]').length).toBe(1);
  expect(host.querySelector('tr[data-token-items="engine"] .vp-structured-record__items-label')?.textContent).toBe('Engine');
  expect(host.querySelector('tr[data-record-field="engine_size"]')).toBeNull();
  // Fields no token states keep their recorded row.
  expect(host.querySelector('tr[data-record-field="vin"]')).not.toBeNull();
  expect(host.querySelector('tr[data-record-field="make"]')?.getAttribute('data-token-items')).toBeNull();
});
