// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ direct: [] as any[], publicRows: [] as any[], publicError: null as any, rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  rpc: fixture.rpc,
  from: (table: string) => {
    let kind: string | undefined;
    const query: any = {
      select: () => query,
      eq: (key: string, value: string) => { if (key === 'kind') kind = value; return query; },
      not: () => query, order: () => query, limit: () => query,
      maybeSingle: () => Promise.resolve({ data: { id: 'synthetic-vehicle', year: 1983, make: 'GMC', model: 'Synthetic' }, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === 'observation_sources' ? [{ id: 'synthetic-source', slug: 'synthetic-owner-source' }] : fixture.direct.filter(r => r.kind === kind), error: null }).then(resolve, reject),
    };
    return query;
  },
} }));
import TablePage from './TablePage';
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.direct = []; fixture.publicError = null;
  fixture.publicRows = [{ observation_id: 'synthetic-work', done_on: '2025-02-03', item: 'Installed bracket', category: 'Fabrication', supplier: 'Synthetic supplier', labor_minutes: 0, build_stage: 'Mock-up' }];
  fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(() => Promise.resolve({ data: fixture.publicRows, error: fixture.publicError }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function renderPage() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/vehicle/synthetic-vehicle/table']}><Routes><Route path="/vehicle/:vehicleId/table" element={<TablePage />} /></Routes></MemoryRouter>));
}
async function filter(value: string) {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('vehicle table public build-log reader', () => {
  it('searches permitted work with original ID/date, masked detail and zero labor', async () => {
    await renderPage();
    expect(fixture.rpc).toHaveBeenCalledWith('vehicle_build_log_public', { p_vehicle_id: 'synthetic-vehicle' });
    const row = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(row.tagName).toBe('DIV');
    expect(row.querySelector('a')).toBeNull();
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).toContain('Installed bracket · Fabrication · Mock-up · 0 min');
    expect(row.textContent).toContain('Synthetic supplier');
    expect(row.textContent).toContain('Owner-only detail');
    expect(container.textContent).toContain('ingestion times are unavailable');
    expect(container.textContent).not.toContain('TOTAL $');
    await filter('synthetic supplier');
    expect(container.textContent).toContain('SHOWING 1 OF 1');
    await filter('absent supplier');
    expect(container.textContent).toContain('SHOWING 0 OF 1');
  });
  it('keeps an owner-readable row once with its original drill and source', async () => {
    fixture.direct = [{ id: 'synthetic-work', kind: 'work_record', observed_at: '2025-02-03T09:10:00Z', ingested_at: '2025-02-04T10:00:00Z', content_text: 'Synthetic owner detail', source_id: 'synthetic-source', structured_data: { vendor: 'Synthetic supplier', total: 12 } }];
    await renderPage();
    expect(container.querySelectorAll('[data-observation-id="synthetic-work"]')).toHaveLength(1);
    const row = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(row.tagName).toBe('A');
    expect(row.getAttribute('href')).toBe('/vehicle/synthetic-vehicle/observation/synthetic-work');
    expect(row.textContent).toContain('Synthetic owner detail');
    expect(row.textContent).toContain('synthetic-owner-source');
    expect(container.textContent).not.toContain('Owner-only detail');
  });
  it('reports reader failure instead of claiming empty history', async () => {
    fixture.publicError = { message: 'Synthetic RPC failure' };
    await renderPage();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('work history may be incomplete');
    expect(container.querySelector('[data-observation-id]')).toBeNull();
    expect(container.textContent).not.toContain('Synthetic RPC failure');
  });
  it('preserves unknown dates and distinguishes an empty response from failure', async () => {
    fixture.publicRows = [{ observation_id: 'synthetic-undated', done_on: null, item: 'Undated repair', supplier: null, labor_minutes: null }];
    await renderPage();
    expect(container.querySelector('[data-observation-id="synthetic-undated"]')!.textContent).toContain('—');
    expect(container.querySelector('[role="status"]')).toBeNull();
    fixture.publicRows = [];
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPage();
    expect(container.textContent).toContain('SHOWING 0 OF 0');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
