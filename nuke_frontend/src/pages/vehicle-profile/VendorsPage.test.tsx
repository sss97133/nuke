// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ direct: [] as any[], publicRows: [] as any[], publicError: null as any, rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  rpc: fixture.rpc,
  from: (table: string) => {
    let kinds: string[] = [];
    const query: any = {
      select: () => query,
      eq: (key: string, value: string) => { if (key === 'kind') kinds = [value]; return query; },
      in: (_key: string, values: string[]) => { kinds = values; return query; },
      not: () => query, order: () => query, limit: () => query,
      maybeSingle: () => Promise.resolve({ data: { id: 'synthetic-vehicle', year: 1983, make: 'GMC', model: 'Synthetic' }, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === 'observation_sources' ? [{ id: 'synthetic-source', slug: 'synthetic-owner-source' }] : fixture.direct.filter(r => kinds.includes(r.kind)), error: null }).then(resolve, reject),
    };
    return query;
  },
} }));
import VendorsPage from './VendorsPage';
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.direct = []; fixture.publicError = null;
  fixture.publicRows = [{ observation_id: 'synthetic-work', done_on: '2025-02-03', item: 'Installed bracket', category: 'Fabrication', supplier: 'Synthetic supplier', labor_minutes: 0, build_stage: 'Installed' }];
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(() => Promise.resolve({ data: fixture.publicRows, error: fixture.publicError }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function renderPage() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/vehicle/synthetic-vehicle/vendors']}><Routes><Route path="/vehicle/:vehicleId/vendors" element={<VendorsPage />} /></Routes></MemoryRouter>));
}
describe('permitted supplier directory', () => {
  it('connects the masked work source to a supplier group without amounts or inaccessible drills', async () => {
    await renderPage();
    expect(fixture.rpc).toHaveBeenCalledWith('vehicle_build_log_public', { p_vehicle_id: 'synthetic-vehicle' });
    const row = container.querySelector('[data-vendor-group="synthetic supplier"]')!;
    expect(row).not.toBeNull();
    expect(row.tagName).toBe('A');
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).toContain('View permitted work');
    expect(row.getAttribute('href')).toContain('supplier=Synthetic%20supplier');
    expect(container.textContent).not.toContain('$');
    expect(container.querySelector('a[href$="/table"]')).not.toBeNull();
    expect(container.textContent).toContain('not verified organizations');
    expect(container.textContent).toContain('ingestion times are unavailable');
  });
  it('counts a direct observation once, preserves owner amounts and supplier fallback', async () => {
    fixture.direct = [{ id: 'synthetic-work', kind: 'work_record', observed_at: '2025-02-05', structured_data: { supplier: 'Synthetic supplier', total: 12, transaction_date: '2025-02-03' } }];
    await renderPage();
    const row = container.querySelector('[data-vendor-group="synthetic supplier"]')!;
    expect(row.children[1].textContent).toBe('1');
    expect(row.tagName).toBe('A');
    expect(row.textContent).toContain('$12');
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).not.toContain('2025-02-05');
    expect(row.textContent).not.toContain('View permitted work');
  });
  it('groups all permitted work once and retains unknown dates and missing suppliers', async () => {
    fixture.publicRows.push({ observation_id: 'synthetic-second', done_on: '2025-03-04', supplier: 'Synthetic supplier' }, { observation_id: 'synthetic-undated', supplier: 'Undated supplier' }, { observation_id: 'synthetic-unknown', supplier: null }, { ...fixture.publicRows[0] });
    await renderPage();
    expect(container.querySelectorAll('[data-vendor-group]')).toHaveLength(3);
    expect(container.querySelector('[data-vendor-group="__unrecorded__"]')?.textContent).toContain('Supplier unrecorded');
    const row = container.querySelector('[data-vendor-group="synthetic supplier"]')!;
    expect(row.children[1].textContent).toBe('2');
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).toContain('2025-03-04');
    expect(container.querySelector('[data-vendor-group="undated supplier"]')?.textContent).toContain('—');
  });
  it('does not turn punctuation-colliding supplier names into a canonical identity', async () => {
    fixture.publicRows = [{ observation_id: 'a', supplier: 'A B' }, { observation_id: 'b', supplier: 'A-B' }];
    await renderPage();
    expect(container.querySelectorAll('[data-vendor-group]')).toHaveLength(2);
  });
  it('reports incomplete reads and rejected transport without raw errors or stuck loading', async () => {
    fixture.publicError = { message: 'Synthetic private failure' };
    await renderPage();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('may be incomplete');
    expect(container.textContent).not.toContain('Synthetic private failure');
    fixture.rpc.mockRejectedValue(new Error('Synthetic transport failure'));
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPage();
    expect(container.textContent).toContain('Vendor history could not be loaded.');
    expect(container.textContent).not.toContain('Loading vendors');
    expect(container.textContent).not.toContain('Synthetic transport failure');
  });
  it('retains unresolved work and links to its explicit supplier selector', async () => {
    fixture.publicRows = [{ observation_id: 'unknown-one', done_on: '2025-02-03', supplier: null }, { observation_id: 'unknown-two', done_on: '2025-02-04' }];
    await renderPage();
    const row = container.querySelector('[data-vendor-group="__unrecorded__"]')!;
    expect(row.children[1].textContent).toBe('2');
    expect(row.textContent).toContain('Supplier unrecorded');
    expect(row.tagName).toBe('A');
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).toContain('2025-02-04');
    expect(row.getAttribute('href')).toContain('unrecorded=1');
  });
  it('keeps an empty source empty without inventing a supplier', async () => {
    fixture.publicRows = [];
    await renderPage();
    expect(container.querySelectorAll('[data-vendor-group]')).toHaveLength(0);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('No vendors found');
  });
});
