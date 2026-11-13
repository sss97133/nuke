// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ open: vi.fn(), rpc: vi.fn(), user: null as null | { id: string }, loading: false }));
vi.mock('./VehiclePhotoLightbox', () => ({ openVehiclePhoto: fixture.open }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: fixture.user, loading: fixture.loading }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => {
  const result = fixture.rpc(...args); return { abortSignal: () => result };
}, storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.example/${path}` } }) }) } } }));
import { VisualWorkCards, photoDate } from './VisualWorkCards';
import { isComponentEvidence, useVisualWork, type ComponentEvidence, type MasterCostLedger, type VisualWork } from './hooks/useVisualWork';
import { hasRecordedInstallation } from './PartPage';

const record: VisualWork = {
 observation_id: 'review-a', title: 'Cabin upholstery', summary: 'The earlier seating is torn; the later frame shows black covers.', gaps: ['Hidden cushion foam remains unconfirmed.'],
 images: [{ image_id: 'before-a', image_url: 'https://images.example/before.jpg', role: 'before', caption: 'Torn seating', taken_at: '2026-04-27T17:00:00Z' },
 { image_id: 'after-a', image_url: 'https://images.example/after.jpg', role: 'after', caption: 'Covered seating', taken_at: '2026-05-05T21:00:00Z' }],
 receipts: [{ item_id: 'item-a', receipt_id: 'receipt-a', relation: 'candidate_material', source_table: 'vehicle_documents', source_id: 'doc-a', source_url_sha256: 'a'.repeat(64), vendor: 'Example upholstery',
 page_date: '2025-09-08', description: 'Black upholstery', part_number: 'SYNTHETIC-1', quantity: 1, hours: null, amount: null, currency: 'USD', amounts_visible: false }],
 receipt_links_unavailable: 0, market_value: { status: 'not_established_by_cited_sources' }, paid_labor: { status: 'unreconciled' },
 effort_reference: { reference_id: 'reference-a', description: 'Upholstery reference', hours_min: 16, hours_max: 40, hours_typical: 24, basis: 'seed_uncalibrated' },
};
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 fixture.open.mockReset(); fixture.user = null; fixture.loading = false; fixture.rpc.mockReset();
 client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
const render = async (rows = [record]) => act(async () => root.render(<VisualWorkCards rows={rows} renderSource={line => <button>Read source {line.source_id}</button>} />));

it('opens the exact before/after images directly and separates all four lenses', async () => {
 await render();
 expect(host.querySelectorAll('article')).toHaveLength(1);
 const before = host.querySelector<HTMLButtonElement>('button[aria-label^="Open before"]')!;
 await act(async () => before.click());
 expect(fixture.open).toHaveBeenCalledWith('before-a');
 for (const label of ['Recorded time', 'Inferred effort', 'Market value', 'Paid value']) expect(host.textContent).toContain(label);
 expect(host.textContent).toContain('16–40 reference hours');
 expect(host.textContent).toContain('Uncalibrated reference; not measured time.');
 expect(host.textContent).toContain('No person-hours in the cited operation lines');
 expect(host.textContent).toContain('Candidate material · installation not established');
 expect(host.textContent).toContain('Read source doc-a');
 expect(host.textContent).toContain('2025');
 expect(host.querySelector('details')).toBeNull();
});
it('keeps charged amounts and documented operation hours distinct from payment and candidate time', async () => {
 const work = structuredClone(record);
 work.receipts.push({ ...work.receipts[0], item_id: 'work-line', relation: 'documented_operation', hours: 3.5, amount: 210, amounts_visible: true });
 await render([work]);
 expect(host.textContent).toContain('3.5 documented person-hours');
 expect(host.textContent).toContain('$210.00 · line charge');
 expect(host.textContent).toContain('Paid labor not reconciled');
 expect(host.textContent).toContain('Not established by these sources');
 expect(host.textContent).not.toContain('payment not recorded');
 expect(host.textContent).toContain('Amount visible to owner & contributors');
 expect(host.textContent).not.toContain('total build time:');
});
it('uses the source local date across a UTC date boundary and keeps an explicit UTC fallback', () => {
 expect(photoDate({ ...record.images[0], taken_at: '2026-05-06T01:00:00Z', capture_time_zone: 'America/Los_Angeles' })).toBe('May 5, 2026, PDT');
 expect(photoDate({ ...record.images[0], taken_at: '2026-05-06T01:00:00Z' })).toBe('May 6, 2026, UTC');
});
it('renders no empty work shell and exposes withdrawn receipt state without an old amount', async () => {
 await render([]); expect(host.innerHTML).toBe('');
 await render([{ ...record, receipts: [], receipt_links_unavailable: 1 }]);
 expect(host.textContent).toContain('Some cited receipt lines are no longer available');
 expect(host.textContent).not.toContain('SYNTHETIC-1');
});
it('preserves a line amount without crashing or inventing a currency when the currency is malformed', async () => {
 await render([{ ...record, receipts: [{ ...record.receipts[0], amount: 210, amounts_visible: true, currency: 'NOT-ISO' }] }]);
 expect(host.textContent).toContain('210 · currency unrecognized');
});
it('does not turn a candidate or generic work mention into installation', () => {
 expect(hasRecordedInstallation([{ lifecycle_status: null, part_relation: null }])).toBe(false);
 expect(hasRecordedInstallation([{ lifecycle_status: 'installed', part_relation: 'candidate_material' }])).toBe(false);
 expect(hasRecordedInstallation([{ lifecycle_status: 'installed', part_relation: 'receipt_time_context' }])).toBe(false);
 expect(hasRecordedInstallation([{ lifecycle_status: 'installed', part_relation: null }])).toBe(true);
});

function Harness() {
 const work = useVisualWork('vehicle-a');
 return <><span>{work.isError ? 'Read failed' : ''}</span><VisualWorkCards rows={work.rows} ledger={work.ledger} components={work.components} renderSource={() => null} /></>;
}
const renderHook = () => act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const componentEvidence: ComponentEvidence = {
 version: 1, as_of: '2026-11-11T12:00:00Z', expected_population: { status: 'unknown' },
 coverage: { examined_readings: 1, qualified_readings: 1, truncated: false },
 components: [{ subject_id: 'battery-position', component_key: 'fluid.battery', label: 'Battery', identity_basis: 'position_only',
   presence: { status: 'attributed_reading', readings: [{ observation_id: 'battery-reading', quote: 'Battery marked EXAMPLE-78',
     value: 'present', evidence_time: '2026-11-10T12:00:00Z', recorded_at: '2026-11-11T12:00:00Z', agreement_status: 'not_established',
     clock_basis: 'source_analysis_time', source_role: 'attributed_retained_image_reading',
     images: [{ ...record.images[0], image_id: 'battery-photo', caption: 'Battery marked EXAMPLE-78', bbox: [100, 200, 500, 700] }] }] },
   condition: { status: 'unknown', readings: [] }, purchase_candidates: [{ receipt_item_id: 'battery-item', receipt_id: 'battery-receipt',
     source_table: 'vehicle_documents', source_id: 'battery-doc', source_url_sha256: 'b'.repeat(64), description: 'Battery purchase',
     printed_part_number: 'EXAMPLE-78', printed_quantity: 1, page_date: '2025-09-10', association_basis: 'same_printed_part_number',
     product: null, documented_amount: null, currency: 'USD', amounts_visible: false, installation_status: 'unestablished' }],
   unresolved: ['physical_unit_identity_unestablished', 'installation_time_unestablished', 'functional_inspection_unestablished'] }],
};
it('opens component pixels and original receipt directly without turning the match into installation or a completion score', async () => {
 await act(async () => root.render(<VisualWorkCards rows={[]} components={componentEvidence}
   renderSource={line => <button data-source-hash={line.source_url_sha256}>Read source {line.source_id}</button>} />));
 await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="Open read as visible"]')!.click());
 expect(fixture.open).toHaveBeenCalledWith('battery-photo');
 expect(host.querySelector('[data-source-hash]')?.getAttribute('data-source-hash')).toBe('b'.repeat(64));
 expect(host.textContent).toContain('matching part number');
 expect(host.textContent).toContain('Still to establish: exact unit identity · installation date · functional inspection');
 expect(host.textContent).toContain('An applicable build reference is still needed');
 expect(host.textContent).not.toMatch(/installed|100%|complete restoration/i);
 const box = host.querySelector<HTMLElement>('.vp-component-region')!;
 expect(parseFloat(box.style.left)).toBeCloseTo(100 / 999 * 100);
 expect(parseFloat(box.style.top)).toBeCloseTo(200 / 999 * 100);
 expect(host.querySelector('details')).toBeNull();
});
it('shows a build-reference part number only when the source excerpt contains it', async () => {
 const ref = (excerpt: string) => [{ page_number: 14, figure: 'Fig 3', callout: '7', excerpt }];
 const evidence = { ...componentEvidence, components: [], expected_assemblies: [{ assembly_id: 'a1', assembly_name: 'front_sheet_metal', description: 'd',
   expected_scope: 's', source_status: 'current_public_reference', taxonomy_binding: 'unresolved', expected_piece_count: 2, whole_vehicle_expected_count: null,
   applicability: { status: 'matched_year_make_model_body_style' }, application: { year_start: 1973, year_end: 1973, make: 'GM', model: 'Truck', body_style: 'pickup' },
   positions: [{ key: 'p1', label: 'Fender', subject_id: null, quantity: 1, part_numbers: ['1111111'], part_number_binding: 'exact_position', source_refs: ref('Fender 1111111 left') },
     { key: 'p2', label: 'Panel', subject_id: null, quantity: 1, part_numbers: ['9999999'], part_number_binding: 'exact_position', source_refs: ref('Panel 2222222') }],
   exclusions: [], limitations: [], source: { observation_id: 'o', document_id: 'd', source_url: 'https://example.com/a.pdf', retained_file: 'reference-docs/a.pdf',
     file_sha256: 'c'.repeat(64), title: 'Catalog', retrieved_day: '2026-11-10', retrieved_at: null, reviewed_at: '2026-11-10', reference_revision: 'r' } }] } as unknown as ComponentEvidence;
 await act(async () => root.render(<VisualWorkCards rows={[]} components={evidence} renderSource={() => null} />));
 expect(host.textContent).toContain('1111111');
 expect(host.textContent).not.toContain('9999999');
 expect(host.textContent).toContain('Part number not verified against the page');
});
it('keeps disagreeing views and condition readings attributed instead of inventing a resolved state', async () => {
 const evidence = structuredClone(componentEvidence), c = evidence.components[0], first = c.presence.readings[0];
 c.presence.readings.push({ ...first, observation_id: 'absent-reading', value: 'absent', quote: 'Battery is absent.' });
 c.condition.readings.push({ ...first, observation_id: 'condition-reading', value: undefined, descriptor_id: 'condition-a', quote: 'Corrosion at terminal' });
 await act(async () => root.render(<VisualWorkCards rows={[]} components={evidence} renderSource={() => null} />));
 expect(host.querySelectorAll('.vp-component-reading')).toHaveLength(3);
 expect(host.textContent).toContain('Read as absent in this view'); expect(host.textContent).toContain('Condition reading');
 expect(host.textContent).not.toContain('Verified');
});
it('does not expose hidden recorded charges and removes withdrawn components on refresh and auth transition', async () => {
 const evidence = structuredClone(componentEvidence); evidence.components[0].purchase_candidates[0].documented_amount = 777;
 fixture.user = { id: 'owner-a' };
 fixture.rpc.mockResolvedValue({ data: { work_records: [], component_evidence: evidence }, error: null });
 await renderHook(); await settle(); expect(host.textContent).toContain('Battery'); expect(host.textContent).not.toContain('777');
 fixture.loading = true; await renderHook(); expect(host.textContent).not.toContain('Battery');
 fixture.loading = false; fixture.user = null;
 fixture.rpc.mockResolvedValue({ data: { work_records: [], component_evidence: { ...evidence, components: [] } }, error: null });
 await renderHook(); await settle(); expect(host.textContent).not.toContain('Battery');
 expect(host.querySelector('[aria-label="Component evidence"]')).toBeNull();
});
it('rejects unbounded component regions and incomplete receipt pointers, then drops stale conclusions', async () => {
 const malformed = structuredClone(componentEvidence); malformed.components[0].presence.readings[0].images[0].bbox = [0, 0, 1001, 999];
 expect(isComponentEvidence(malformed)).toBe(false);
 const missingPointer = structuredClone(componentEvidence); missingPointer.components[0].purchase_candidates[0].source_url_sha256 = '';
 expect(isComponentEvidence(missingPointer)).toBe(false);
 fixture.rpc.mockResolvedValue({ data: { work_records: [], component_evidence: componentEvidence }, error: null });
 await renderHook(); await settle(); expect(host.textContent).toContain('Battery');
 fixture.rpc.mockResolvedValue({ data: { work_records: [], component_evidence: malformed }, error: null });
 await act(async () => client.invalidateQueries({ queryKey: ['vehicle-visual-work'] })); await settle();
 expect(host.textContent).toContain('Read failed'); expect(host.textContent).not.toContain('Battery');
});
it('keeps the analysis clock distinct when the photo clock is missing or malformed', async () => {
 const evidence = structuredClone(componentEvidence); evidence.components[0].presence.readings[0].images[0].taken_at = 'Infinity';
 await act(async () => root.render(<VisualWorkCards rows={[]} components={evidence} renderSource={() => null} />));
 expect(host.textContent).toContain('Photo date unknown'); expect(host.textContent).toContain('Read Nov 10, 2026');
 expect(photoDate({ taken_at: null })).toBe('Photo date unknown');
 evidence.components[0].presence.readings[0].evidence_time = 'Invalid'; expect(isComponentEvidence(evidence)).toBe(false);
});
it('scopes the reader to the current viewer and withholds cached private data during auth changes', async () => {
 fixture.user = { id: 'owner-a' };
 fixture.rpc.mockResolvedValue({ data: { work_records: [], visual_work: [{ ...record, receipts: [{ ...record.receipts[0], amount: 420, amounts_visible: true }] }] }, error: null });
 await renderHook(); await settle(); expect(host.textContent).toContain('$420.00');
 expect(fixture.rpc).toHaveBeenCalledWith('vehicle_build_log_public', { p_vehicle_id: 'vehicle-a', p_include_reported: false });
 fixture.loading = true; await renderHook(); expect(host.textContent).not.toContain('$420.00');
 fixture.loading = false; fixture.user = null;
 fixture.rpc.mockResolvedValue({ data: { work_records: [], visual_work: [record] }, error: null });
 await renderHook(); await settle(); expect(host.textContent).not.toContain('$420.00');
 expect(host.textContent).toContain('Amount visible to owner & contributors');
});
it('removes cached conclusions when a current-source refresh fails', async () => {
 fixture.rpc.mockResolvedValue({ data: { work_records: [], visual_work: [record] }, error: null });
 await renderHook(); await settle(); expect(host.textContent).toContain('Cabin upholstery');
 fixture.rpc.mockResolvedValue({ data: null, error: new Error('source unavailable') });
 await act(async () => client.invalidateQueries({ queryKey: ['vehicle-visual-work'] })); await settle();
 expect(host.textContent).toContain('Read failed'); expect(host.textContent).not.toContain('Cabin upholstery');
});

it('puts a reusable stock reference beside the receipt and removes it when its source is withdrawn', async () => {
 const work = structuredClone(record);
 work.receipts[0].product = { catalog_part_id: 'catalog-a', name: 'Supplier upholstery set', part_number: 'SYNTHETIC-1', manufacturer: 'FixtureCo',
 image_url: 'https://images.example/stock.jpg', page_url: 'https://supplier.example/product', captured_at: '2026-11-10T12:00:00Z',
 quote_price: 99, currency: 'USD', price_stale: false, source_role: 'original_receipt_supplier' };
 await render([work]);
 const link = host.querySelector<HTMLAnchorElement>('a[aria-label="View Supplier upholstery set at the supplier"]')!;
 expect(link.href).toBe('https://supplier.example/product');
 expect(link.querySelector('img')?.getAttribute('src')).toBe('https://images.example/stock.jpg');
 expect(host.textContent).toContain('$99.00 supplier quote');
 expect(host.textContent).toContain('Amount visible to owner & contributors');
 expect(host.textContent).toContain('Candidate material · installation not established');
 expect(host.querySelector('details')).toBeNull();
 await render([record]);
 expect(host.querySelector('.vp-catalog-product')).toBeNull();
});

const ledger: MasterCostLedger = {
 version: 1, as_of: '2026-11-11T12:00:00Z', scope: 'supplied_estimate_lines_only',
 coverage: { source_read_limited: false, cards_without_estimates: 1, scope_completeness: 'not_established' },
 current_component_value: { status: 'not_estimated' }, documented_charges: { status: 'separate_not_added' },
 scenarios: [{ scenario: 'reconstruct_observed',
  coverage: { lines: 2, resolved_lines: 1, partial_lines: 0, unresolved_lines: 1, excluded_lines: 0, duplicate_claims_folded: 3, status: 'partial' },
  totals: { hours: { min: 2, typical: 3, max: 4 }, currencies: [{ currency: 'USD', cost: { min: 200, typical: 300, max: 400 }, covered_lines: 1 }],
   labor_currencies: [{ currency: 'USD', cost: { min: 200, typical: 300, max: 400 }, covered_lines: 1 }], material_currencies: [] },
  systems: [{ system_key: 'glass', coverage: { lines: 1, resolved_lines: 1, partial_lines: 0, unresolved_lines: 0, excluded_lines: 0, duplicate_claims_folded: 3, status: 'complete_for_supplied_lines' },
   totals: { hours: { min: 2, typical: 3, max: 4 }, currencies: [{ currency: 'USD', cost: { min: 200, typical: 300, max: 400 }, covered_lines: 1 }],
    labor_currencies: [{ currency: 'USD', cost: { min: 200, typical: 300, max: 400 }, covered_lines: 1 }], material_currencies: [] } },
   { system_key: 'paint', coverage: { lines: 1, resolved_lines: 0, partial_lines: 0, unresolved_lines: 1, excluded_lines: 0, duplicate_claims_folded: 0, status: 'partial' }, totals: { hours: null, currencies: [], labor_currencies: [], material_currencies: [] } }],
  rows: [{ kind: 'labor', physical_key: 'door_glass.install', system_key: 'glass', label: 'Install door-glass pair', status: 'resolved', reasons: [],
   work_observation_ids: ['review-a'], source_observation_ids: ['source-a'], source_images: record.images, quantity: { value: 2, unit: 'pane', basis: 'explicit_assumption', derivation: 'One pane per door.' },
   reference: { code: 'GLASS-DOOR', label: 'seed_uncalibrated' }, pricing: null, rate_basis: { rate: 100, currency: 'USD', derivation: 'Synthetic comparison rate.' },
   evidence_role: 'conditional_reconstruction', hours: { min: 2, typical: 3, max: 4 }, cost: { min: 200, typical: 300, max: 400 }, currency: 'USD',
   overlap_group: null, selected: true, shared_access: false, input_fingerprint: 'a', claim_count: 4, formula: '2 panes × 1–2 person-hours per pane × USD 100 per person-hour' },
   { kind: 'material', physical_key: 'paint.material', system_key: 'paint', label: 'Paint materials', status: 'unresolved', reasons: ['material_price_unresolved'],
    work_observation_ids: ['review-a'], source_observation_ids: ['source-a'], source_images: record.images, quantity: null, reference: null, pricing: null, rate_basis: null,
    evidence_role: null, hours: null, cost: null, currency: null, overlap_group: null, selected: true, shared_access: false, input_fingerprint: 'b', claim_count: 1, formula: null }],
 }],
};

function serviceFeeLedger(): MasterCostLedger {
 const scoped = structuredClone(ledger);
 const scenario = scoped.scenarios[0];
 scenario.rows = [{ ...scenario.rows[0], physical_key: 'machine.pistons', system_key: 'machining', label: 'Mount pistons on rods',
  reference: { type: 'fixed_service_fee', unit_fee: { min: 30, typical: 30, max: 30 }, unit: 'assembly', currency: 'USD',
   price_basis: 'published_starting_price', source_url: 'https://machine.example/services', source_retrieved_at: '2026-01-01T12:00:00Z',
   source_sha256: 'd'.repeat(64), source_role: 'attributed_public_menu_capture', derivation: 'Conditional service comparison; excludes vehicle installation and custom fitting.' },
  rate_basis: null, hours: null, cost: { min: 240, typical: 240, max: 240 },
  quantity: { value: 8, unit: 'assembly', basis: 'explicit_assumption', derivation: 'Eight assemblies in this reconstruction scenario.' },
  formula: '8 assembly × (30 / 30 / 30) USD per assembly; person-hours unknown', claim_count: 1 }];
 scenario.coverage = { lines: 1, resolved_lines: 1, partial_lines: 0, unresolved_lines: 0, excluded_lines: 0,
  duplicate_claims_folded: 0, status: 'complete_for_supplied_lines' };
 scenario.totals = { hours: null, hours_coverage: { labor_lines: 1, estimated_lines: 0, unknown_lines: 1, status: 'unestimated' },
  currencies: [{ currency: 'USD', cost: { min: 240, typical: 240, max: 240 }, covered_lines: 1 }],
  labor_currencies: [{ currency: 'USD', cost: { min: 240, typical: 240, max: 240 }, covered_lines: 1 }], material_currencies: [] };
 scenario.systems = [{ system_key: 'machining', totals: scenario.totals, coverage: scenario.coverage }];
 return scoped;
}

it('opens a fixed service fee with its source and equation while leaving hours unknown', async () => {
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={serviceFeeLedger()} renderSource={() => null} />));
 const totals = host.querySelector('.vp-ledger-totals')!;
 expect(totals.textContent).toContain('Estimated person-hoursUnestimated');
 expect(totals.textContent).toContain('Labor estimate$240.00');
 expect(host.textContent).toContain('1 labor item has unknown person-hours');
 expect(host.textContent).toContain('Starting-price comparison');
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Mount pistons on rods"]')!.click());
 const detail = host.querySelector('#vp-ledger-evidence')!;
 expect(detail.textContent).toContain('8 assembly × (30 / 30 / 30) USD per assembly; person-hours unknown');
 expect(detail.textContent).toContain('Price basis: Published starting-price comparison');
 expect(detail.textContent).toContain('This is not a vehicle-specific quote');
 expect(detail.textContent).toContain('Captured Jan 1, 2026');
 expect(detail.textContent).not.toMatch(/Time basis:|Rate:|fixed_service_fee|0 estimated person-hours/);
 const citation = detail.querySelector<HTMLAnchorElement>('a')!;
 expect(citation.href).toBe('https://machine.example/services');
 expect(citation.rel).toBe('noopener noreferrer');
 const clicked: string[] = [];
 citation.addEventListener('click', event => { event.preventDefault(); clicked.push(citation.href); });
 await act(async () => citation.click());
 expect(clicked).toEqual(['https://machine.example/services']);
 await act(async () => detail.querySelector<HTMLButtonElement>('button[aria-label="Open source photo: Torn seating"]')!.click());
 expect(fixture.open).toHaveBeenCalledWith('before-a');
});

it('marks mixed time coverage as partial and switches to unknown time for the fee-only system', async () => {
 const scoped = serviceFeeLedger();
 scoped.scenarios[0].rows.push(structuredClone(ledger.scenarios[0].rows[0]));
 scoped.scenarios[0].totals = { ...scoped.scenarios[0].totals, hours: { min: 2, typical: 3, max: 4 },
  hours_coverage: { labor_lines: 2, estimated_lines: 1, unknown_lines: 1, status: 'partial' } };
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 expect(host.querySelector('.vp-ledger-totals')?.textContent).toContain('Estimated person-hours (partial)');
 expect(host.textContent).toContain('1 labor item has unknown person-hours');
 const select = host.querySelector<HTMLSelectElement>('select[aria-label="System"]')!;
 await act(async () => { select.value = 'machining'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 expect(host.querySelector('.vp-ledger-totals')?.textContent).toContain('Estimated person-hoursUnestimated');
 expect(host.textContent).not.toContain('Install door-glass pair');
});

it('removes the open service cost and citation when the current-source reader withdraws it', async () => {
 fixture.rpc.mockResolvedValue({ data: { work_records: [], visual_work: [record], master_ledger: serviceFeeLedger() }, error: null });
 await renderHook(); await settle();
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Mount pistons on rods"]')!.click());
 expect(host.textContent).toContain('$240.00');
 expect(host.querySelector('a[href="https://machine.example/services"]')).not.toBeNull();
 fixture.rpc.mockResolvedValue({ data: { work_records: [], visual_work: [], master_ledger: null }, error: null });
 await act(async () => client.invalidateQueries({ queryKey: ['vehicle-visual-work'] })); await settle();
 expect(host.textContent).not.toContain('$240.00');
 expect(host.querySelector('a[href="https://machine.example/services"]')).toBeNull();
});

it('shows the server cost folds and opens a single inline calculation with direct source photos', async () => {
 const work = structuredClone(record);
 work.receipts.push({ ...record.receipts[0], item_id: 'documented-line', relation: 'documented_operation', hours: 3.5 });
 await act(async () => root.render(<VisualWorkCards rows={[work]} ledger={ledger} renderSource={line => <button>Read original {line.source_id}</button>} />));
 expect(host.textContent).toContain('Master ledger');
 expect(host.textContent).toContain('3 repeated references counted once');
 expect(host.textContent).toContain('1 items still need inputs');
 expect(host.textContent).not.toContain('$0.00');
 expect(host.textContent).not.toContain('Photographed work');
 expect(host.querySelector('.vp-ledger-totals')?.textContent).toContain('$300.00');
 expect(host.querySelector('.vp-ledger-totals')?.textContent).toContain('$200.00–$400.00 range');
 const open = host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Install door-glass pair"]')!;
 await act(async () => open.click());
 const region = host.querySelector('[role="region"]')!;
 expect(region.textContent).toContain('2 panes × 1–2 person-hours per pane × USD 100');
 expect(region.textContent).toContain('Synthetic comparison rate.');
 expect(region.textContent).toContain('Read original doc-a');
 expect(region.textContent).toContain('Recorded operation · 3.5 documented person-hours');
 expect(region.textContent).toContain('Receipt candidate · exact installation not established');
 expect(region.textContent).toContain('Reference allowance (not calibrated)');
 expect(region.textContent).not.toContain('seed_uncalibrated');
 expect(region.closest('tr')?.previousElementSibling?.textContent).toContain('Install door-glass pair');
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Open source photo: Torn seating"]')!.click());
 expect(fixture.open).toHaveBeenCalledWith('before-a');
 expect(host.querySelectorAll('details')).toHaveLength(0);
 const close = Array.from(region.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === 'Close')!;
 await act(async () => close.click());
 expect(document.activeElement).toBe(open);
 expect(host.querySelector('[role="region"]')).toBeNull();
});

it('keeps the photographs of ledger-itemized work on the page, one strip per title and each photo once', async () => {
 // Two records of one job cite the same after-photo; the ledger itemizes both. A third record has no cost line.
 const second = { ...record, observation_id: 'review-b', images: [record.images[1], { ...record.images[1], image_id: 'after-b', caption: 'Rear seat covered' }] };
 const other = { ...record, observation_id: 'review-unestimated', title: 'Separate recorded work' };
 const both = structuredClone(ledger);
 both.scenarios[0].rows[0].work_observation_ids = ['review-a', 'review-b'];
 await act(async () => root.render(<VisualWorkCards rows={[record, second, other]} ledger={both} renderSource={() => null} />));
 const photos = host.querySelector('[aria-label="Work photos"]')!;
 expect(photos.querySelectorAll('article')).toHaveLength(1);
 expect(photos.querySelector('article')!.getAttribute('aria-label')).toBe('Cabin upholstery photos');
 expect(Array.from(photos.querySelectorAll('img')).map(img => img.getAttribute('alt'))).toEqual(['Torn seating', 'Covered seating', 'Rear seat covered']);
 // The strip shows photographs only: no summary, lenses or receipt lines are repeated beside the ledger.
 expect(photos.textContent).not.toContain('The earlier seating is torn');
 expect(photos.querySelector('.vp-work-lenses')).toBeNull();
 // It sits before the ledger, and the uncosted record keeps its full card after it.
 expect(photos.compareDocumentPosition(host.querySelector('.vp-master-ledger')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(host.querySelector('[aria-label="Other photographed work"]')!.querySelectorAll('article')).toHaveLength(1);
 await act(async () => photos.querySelector<HTMLButtonElement>('button[aria-label="Open after photo: Rear seat covered"]')!.click());
 expect(fixture.open).toHaveBeenCalledWith('after-b');
 // A ledger whose cited work has no photographs draws no empty section.
 await act(async () => root.render(<VisualWorkCards rows={[{ ...record, images: [] }]} ledger={ledger} renderSource={() => null} />));
 expect(host.querySelector('[aria-label="Work photos"]')).toBeNull();
});

it('filters the same ledger to a system and preserves unknown totals', async () => {
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={ledger} renderSource={() => null} />));
 const select = host.querySelector('select')!;
 await act(async () => { select.value = 'paint'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 expect(host.textContent).toContain('Paint materials');
 expect(host.textContent).not.toContain('Install door-glass pair');
 expect(host.textContent).toContain('Unestimated');
 expect(host.textContent).not.toContain('$0.00');
});

it('renders one readable time basis and opens the supplied labor source URLs', async () => {
 const scoped = structuredClone(ledger);
 scoped.scenarios[0].rows[0].reference = { type: 'analyst_range', label: 'attributed_scenario_uncalibrated',
  derivation: 'Proposed scope from https://reference.example/allowance_(glass). Retained comparison only.' };
 scoped.scenarios[0].rows[0].rate_basis = { rate: 100, currency: 'USD',
  derivation: 'Comparison rate (https://supplier.example/services/rate?unit=hour&region=example). Not measured time.' };
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Install door-glass pair"]')!.click());
 const detail = host.querySelector('#vp-ledger-evidence')!;
 expect(detail.textContent?.match(/Proposed labor range/g)).toHaveLength(1);
 expect(detail.textContent).toContain('(not calibrated)');
 expect(detail.textContent).not.toMatch(/attributed_scenario_uncalibrated|analyst_range|seed_uncalibrated/);
 expect(detail.textContent).toContain('2 panes × 1–2 person-hours per pane × USD 100');
 const links = Array.from(detail.querySelectorAll<HTMLAnchorElement>('a'));
 expect(links.map(link => link.getAttribute('href'))).toEqual([
  'https://reference.example/allowance_(glass)', 'https://supplier.example/services/rate?unit=hour&region=example',
 ]);
 const followed: string[] = [];
 for (const link of links) {
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  link.addEventListener('click', event => { event.preventDefault(); followed.push(link.href); });
  await act(async () => link.click());
 }
 expect(followed).toEqual(links.map(link => link.href));
 expect(detail.textContent).toContain('). Not measured time.');
});

it('shows an identical quantity/time explanation once while retaining the basis, code and distinct explanations', async () => {
 const scoped = structuredClone(ledger);
 const line = scoped.scenarios[0].rows[0];
 line.label = 'Finish-sand & polish';
 line.quantity!.derivation = 'Level and polish the finish; comparison https://reference.example/polish.';
 line.reference = { type: 'analyst_range', label: 'attributed_scenario_uncalibrated', code: 'POLISH',
  derivation: `  ${line.quantity!.derivation}  ` };
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 const open = Array.from(host.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'See calculation: Finish-sand & polish')!;
 await act(async () => open.click());
 const detail = host.querySelector('#vp-ledger-evidence')!;
 expect(detail.textContent?.match(/Level and polish the finish/g)).toHaveLength(1);
 expect(detail.textContent).toContain('Time basis: Proposed labor range (not calibrated) (POLISH).');
 expect(detail.querySelectorAll('a[href="https://reference.example/polish"]')).toHaveLength(1);
 line.reference.derivation = 'Level and polish the finish, excluding primer sanding.';
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 expect(detail.textContent?.match(/Level and polish the finish/g)).toHaveLength(2);
 expect(detail.textContent).toContain('Quantity: Level and polish the finish; comparison');
 expect(detail.textContent).toContain('Level and polish the finish, excluding primer sanding.');
});

it('shows the material price derivation and withdraws its citation when the reader removes it', async () => {
 const scoped = structuredClone(ledger);
 scoped.scenarios[0].rows[1].pricing = { kind: 'analyst_range',
  derivation: 'Dated comparison https://supplier.example/product/%2Akit.html?finish=black&size=15. Freight is excluded.' };
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Paint materials"]')!.click());
 const detail = host.querySelector('#vp-ledger-evidence')!;
 const link = detail.querySelector<HTMLAnchorElement>('a')!;
 expect(link.href).toBe('https://supplier.example/product/%2Akit.html?finish=black&size=15');
 expect(detail.textContent).toContain('Price basis: Dated comparison');
 expect(detail.textContent).toContain('Freight is excluded.');
 expect(detail.textContent).toContain('Unpriced');
 const clicked = vi.fn((event: Event) => event.preventDefault());
 link.addEventListener('click', clicked);
 await act(async () => link.click());
 expect(clicked).toHaveBeenCalledOnce();
 scoped.scenarios[0].rows[1].pricing = null;
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 expect(host.querySelector('#vp-ledger-evidence a')).toBeNull();
 expect(host.textContent).not.toContain('supplier.example/product');
});

it('keeps non-HTTPS, credential-bearing and malformed references as inert text', async () => {
 const scoped = structuredClone(ledger);
 scoped.scenarios[0].rows[0].rate_basis = { derivation: 'http://supplier.example/plain javascript:alert(1) https://user:pass@supplier.example/private https://bad\\host.example/path https://%invalid <img src=x>' };
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Install door-glass pair"]')!.click());
 const detail = host.querySelector('#vp-ledger-evidence')!;
 expect(detail.querySelectorAll('a')).toHaveLength(0);
 expect(detail.querySelector('img[src="x"]')).toBeNull();
 expect(detail.textContent).toContain('javascript:alert(1)');
 expect(detail.textContent).toContain('<img src=x>');
});

it('keeps unestimated work accessible and opens the line witness rather than the containing card photograph', async () => {
 const other = { ...record, observation_id: 'review-unestimated', title: 'Separate recorded work', summary: 'A retained operation without an estimate.', gaps: ['Recorded scope still needs a cost basis.'] };
 const scoped = structuredClone(ledger);
 scoped.scenarios[0].rows[0].source_images = [{ ...record.images[0], image_id: 'line-witness', caption: 'Exact glass installation witness', image_url: 'https://images.example/glass-source.jpg' }];
 await act(async () => root.render(<VisualWorkCards rows={[record, other]} ledger={scoped} renderSource={line => <button>Read original {line.source_id}</button>} />));
 const retained = host.querySelector('[aria-label="Other photographed work"]')!;
 expect(retained.textContent).toContain('Separate recorded work');
 expect(retained.textContent).toContain('Recorded scope still needs a cost basis.');
 expect(retained.querySelectorAll('article')).toHaveLength(1);
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Install door-glass pair"]')!.click());
 const detail = host.querySelector('#vp-ledger-evidence')!;
 expect(detail.querySelector('button[aria-label="Open source photo: Torn seating"]')).toBeNull();
 await act(async () => detail.querySelector<HTMLButtonElement>('button[aria-label="Open source photo: Exact glass installation witness"]')!.click());
 expect(fixture.open).toHaveBeenCalledWith('line-witness');
});

it('reads line photographs by image_id through the ledger image map', async () => {
 const scoped = structuredClone(ledger);
 const witness = { ...record.images[0], image_id: 'mapped-witness', caption: 'Mapped glass witness', image_url: 'https://images.example/mapped.jpg' };
 const inline = { ...witness, image_id: 'inline-witness', caption: 'Row-specific witness', image_url: 'https://images.example/inline.jpg' };
 scoped.images = { 'mapped-witness': witness };
 scoped.scenarios[0].rows[0].source_images = ['mapped-witness', inline, 'missing-from-map'];
 await act(async () => root.render(<VisualWorkCards rows={[record]} ledger={scoped} renderSource={() => null} />));
 expect(host.querySelector('.vp-ledger-table img[src*="mapped.jpg"]')).not.toBeNull();
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="See calculation: Install door-glass pair"]')!.click());
 const detail = host.querySelector('#vp-ledger-evidence')!;
 expect(detail.querySelectorAll('.vp-work-photos button')).toHaveLength(2);
 expect(detail.querySelector('button[aria-label="Open source photo: Row-specific witness"]')).not.toBeNull();
 await act(async () => detail.querySelector<HTMLButtonElement>('button[aria-label="Open source photo: Mapped glass witness"]')!.click());
 expect(fixture.open).toHaveBeenCalledWith('mapped-witness');
});

it('withdraws the cost ledger with a failed current-source refresh', async () => {
 fixture.rpc.mockResolvedValue({ data: { work_records: [], visual_work: [record], master_ledger: ledger }, error: null });
 await renderHook(); await settle(); expect(host.textContent).toContain('Master ledger');
 fixture.rpc.mockResolvedValue({ data: null, error: new Error('source unavailable') });
 await act(async () => client.invalidateQueries({ queryKey: ['vehicle-visual-work'] })); await settle();
 expect(host.textContent).toContain('Read failed');
 expect(host.textContent).not.toContain('Master ledger');
 expect(host.textContent).not.toContain('$300.00');
});
