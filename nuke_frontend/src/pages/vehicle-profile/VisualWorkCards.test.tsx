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
import { useVisualWork, type VisualWork } from './hooks/useVisualWork';
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
 return <><span>{work.isError ? 'Read failed' : ''}</span><VisualWorkCards rows={work.rows} renderSource={() => null} /></>;
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
