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
} } }));
import { VisualWorkCards, photoDate } from './VisualWorkCards';
import { useVisualWork, type MasterCostLedger, type VisualWork } from './hooks/useVisualWork';
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
 return <><span>{work.isError ? 'Read failed' : ''}</span><VisualWorkCards rows={work.rows} ledger={work.ledger} renderSource={() => null} /></>;
}
const renderHook = () => act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
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
   work_observation_ids: ['review-a'], source_observation_ids: ['source-a'], quantity: { value: 2, unit: 'pane', basis: 'explicit_assumption', derivation: 'One pane per door.' },
   reference: { code: 'GLASS-DOOR', label: 'seed_uncalibrated' }, pricing: null, rate_basis: { rate: 100, currency: 'USD', derivation: 'Synthetic comparison rate.' },
   evidence_role: 'conditional_reconstruction', hours: { min: 2, typical: 3, max: 4 }, cost: { min: 200, typical: 300, max: 400 }, currency: 'USD',
   overlap_group: null, selected: true, shared_access: false, input_fingerprint: 'a', claim_count: 4, formula: '2 panes × 1–2 person-hours per pane × USD 100 per person-hour' },
   { kind: 'material', physical_key: 'paint.material', system_key: 'paint', label: 'Paint materials', status: 'unresolved', reasons: ['material_price_unresolved'],
    work_observation_ids: ['review-a'], source_observation_ids: ['source-a'], quantity: null, reference: null, pricing: null, rate_basis: null,
    evidence_role: null, hours: null, cost: null, currency: null, overlap_group: null, selected: true, shared_access: false, input_fingerprint: 'b', claim_count: 1, formula: null }],
 }],
};

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
 expect(region.textContent).toContain('seed uncalibrated');
 expect(region.closest('tr')?.previousElementSibling?.textContent).toContain('Install door-glass pair');
 await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Open source photo: Torn seating"]')!.click());
 expect(fixture.open).toHaveBeenCalledWith('before-a');
 expect(host.querySelectorAll('details')).toHaveLength(0);
 const close = Array.from(region.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === 'Close')!;
 await act(async () => close.click());
 expect(document.activeElement).toBe(open);
 expect(host.querySelector('[role="region"]')).toBeNull();
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

it('withdraws the cost ledger with a failed current-source refresh', async () => {
 fixture.rpc.mockResolvedValue({ data: { work_records: [], visual_work: [record], master_ledger: ledger }, error: null });
 await renderHook(); await settle(); expect(host.textContent).toContain('Master ledger');
 fixture.rpc.mockResolvedValue({ data: null, error: new Error('source unavailable') });
 await act(async () => client.invalidateQueries({ queryKey: ['vehicle-visual-work'] })); await settle();
 expect(host.textContent).toContain('Read failed');
 expect(host.textContent).not.toContain('Master ledger');
 expect(host.textContent).not.toContain('$300.00');
});
