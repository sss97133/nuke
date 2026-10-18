// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ direct: [] as any[], publicRows: [] as any[], publicError: null as any, rpc: vi.fn(), route: '/vehicle/synthetic-vehicle/vendor/synthetic-supplier?supplier=Synthetic%20supplier', directError: null as any }));
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
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === 'observation_sources' ? [{ id: 'synthetic-source', slug: 'synthetic-owner-source' }] : fixture.direct.filter(r => kinds.includes(r.kind)), error: fixture.directError }).then(resolve, reject),
    };
    return query;
  },
} }));
import VendorPage from './VendorPage';
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.direct = []; fixture.publicError = null; fixture.directError = null; fixture.route = '/vehicle/synthetic-vehicle/vendor/synthetic-supplier?supplier=Synthetic%20supplier';
  fixture.publicRows = [{ observation_id: 'synthetic-work', done_on: '2025-02-03', item: 'Installed bracket', category: 'Fabrication', supplier: 'Synthetic supplier', labor_minutes: 0, build_stage: 'Installed' }];
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(() => Promise.resolve({ data: fixture.publicRows, error: fixture.publicError }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function renderPage() {
  await act(async () => root.render(<MemoryRouter initialEntries={[fixture.route]}><Routes><Route path="/vehicle/:vehicleId/vendor/:vendorSlug" element={<VendorPage />} /></Routes></MemoryRouter>));
}
describe('permitted supplier detail', () => {
  it('connects public work by exact supplier with original IDs and recorded dates, without withheld links or money', async () => {
    await renderPage();
    expect(fixture.rpc).toHaveBeenCalledWith('vehicle_build_log_public', { p_vehicle_id: 'synthetic-vehicle' });
    const row = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(row.tagName).toBe('DIV');
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).toContain('Installed bracket');
    expect(container.querySelector('a[href*="/observation/"]')).toBeNull();
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).toContain('ingestion times are unavailable');
  });
  it('replays six unresolved sources once without admitting a named supplier', async () => {
    fixture.route = '/vehicle/synthetic-vehicle/vendor/supplier-unrecorded?unrecorded=1';
    fixture.publicRows = Array.from({length: 6}, (_, i) => ({observation_id: `work-${i}`, done_on: '2025-02-03', supplier: null}));
    fixture.publicRows.push({...fixture.publicRows[0]}, {observation_id: 'named', supplier: 'Another supplier'});
    await renderPage();
    expect(container.querySelectorAll('[data-observation-id]')).toHaveLength(6);
    expect(container.textContent).toContain('Supplier unrecorded');
    expect(container.querySelector('[data-observation-id="named"]')).toBeNull();
    expect(container.textContent).not.toContain('$');
  });
  it('prefers directly readable overlap and preserves zero amounts and transaction dates', async () => {
    fixture.direct = [{id: 'synthetic-work', kind:'work_record', observed_at:'2025-04-05', structured_data:{supplier:'Synthetic supplier', transaction_date:'2025-02-03', total:0}}];
    await renderPage();
    const rows = container.querySelectorAll('[data-observation-id]');
    expect(rows).toHaveLength(1);
    expect(rows[0].tagName).toBe('A');
    expect(rows[0].textContent).toContain('$0');
    expect(rows[0].textContent).toContain('2025-02-03');
    expect(rows[0].textContent).not.toContain('2025-04-05');
  });
  it('keeps punctuation-distinct names separate and retains legacy substring routes', async () => {
    fixture.route = '/vehicle/synthetic-vehicle/vendor/a-b?supplier=A%20B';
    fixture.publicRows = [{observation_id:'space', supplier:'A B'}, {observation_id:'hyphen', supplier:'A-B'}];
    await renderPage();
    expect(container.querySelectorAll('[data-observation-id]')).toHaveLength(1);
    expect(container.querySelector('[data-observation-id="space"]')).not.toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
    fixture.route = '/vehicle/synthetic-vehicle/vendor/holley';
    fixture.direct = [{id:'legacy', kind:'specification', structured_data:{merchant:'Holley Performance'}}];
    await renderPage();
    expect(container.querySelector('[data-observation-id="legacy"]')).not.toBeNull();
  });
  it('reports partial reads and transport failures without raw errors', async () => {
    fixture.directError = {message:'private diagnostic'};
    await renderPage();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('may be incomplete');
    expect(container.querySelectorAll('[data-observation-id]')).toHaveLength(1);
    await act(async () => root.unmount()); root = createRoot(container);
    fixture.rpc.mockRejectedValue(new Error('private diagnostic'));
    await renderPage();
    expect(container.textContent).toContain('Vendor history could not be loaded.');
    expect(container.textContent).not.toContain('private diagnostic');
    expect(container.textContent).not.toContain('Loading vendor');
  });
  it('keeps empty sources empty and unknown dates unknown', async () => {
    fixture.publicRows = [{observation_id:'undated', supplier:'Synthetic supplier'}];
    await renderPage();
    expect(container.textContent).toContain('unknown');
    await act(async () => root.unmount()); root = createRoot(container);
    fixture.publicRows=[];
    await renderPage();
    expect(container.querySelectorAll('[data-observation-id]')).toHaveLength(0);
    expect(container.textContent).toContain('No observations match');
  });
});
