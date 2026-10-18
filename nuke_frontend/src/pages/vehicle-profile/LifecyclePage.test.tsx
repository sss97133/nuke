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
import LifecyclePage from './LifecyclePage';
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
  await act(async () => root.render(<MemoryRouter initialEntries={['/vehicle/synthetic-vehicle/lifecycle']}><Routes><Route path="/vehicle/:vehicleId/lifecycle" element={<LifecyclePage />} /></Routes></MemoryRouter>));
}
function tile(label: string) {
  return [...container.querySelectorAll('div')].find(el => el.children.length === 2 && el.firstElementChild?.textContent === label)?.lastElementChild?.textContent;
}
describe('lifecycle permitted work connection', () => {
  it('counts public work and suppliers without promoting build stage to installation or masked spend', async () => {
    await renderPage();
    expect(fixture.rpc).toHaveBeenCalledWith('vehicle_build_log_public', { p_vehicle_id: 'synthetic-vehicle' });
    expect(tile('Work records')).toBe('1');
    expect(tile('Parts installed')).toBe('0');
    expect(tile('Visible spend')).toBe('—');
    const row = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(row.tagName).toBe('DIV');
    expect(row.textContent).toContain('2025-02-03');
    expect(row.textContent).toContain('Installed bracket · Fabrication · 0 min');
    expect(row.textContent).toContain('Build stage: Installed');
    expect(row.textContent).toContain('Owner-only detail');
    expect(container.textContent).toContain('Synthetic supplier');
    expect(container.querySelector('a[href*="/vendor/"]')).toBeNull();
    expect(container.querySelector('a[href*="/observation/"]')).toBeNull();
    expect(container.textContent).toContain('ingestion times are unavailable');
    expect(container.textContent).toContain('visible spend excludes masked amounts');
  });
  it('deduplicates direct, recent and public rows and preserves owner drill and readable spend', async () => {
    fixture.direct = [{ id: 'synthetic-work', kind: 'work_record', observed_at: '2025-02-03T09:10:00Z', content_text: 'Synthetic owner detail', structured_data: { vendor: 'Synthetic supplier', total: 12 } }];
    await renderPage();
    expect(tile('Observations')).toBe('1');
    expect(tile('Work records')).toBe('1');
    expect(tile('Visible spend')).toBe('$12');
    expect(container.querySelectorAll('[data-observation-id="synthetic-work"]')).toHaveLength(1);
    const row = container.querySelector('[data-observation-id="synthetic-work"]')!;
    expect(row.getAttribute('href')).toBe('/vehicle/synthetic-vehicle/observation/synthetic-work');
    expect(row.textContent).toContain('Synthetic owner detail');
    expect(container.textContent).not.toContain('Owner-only detail');
  });
  it('orders by recorded date and preserves unknown dates', async () => {
    fixture.publicRows.push({ observation_id: 'synthetic-newer', done_on: '2025-02-04', item: 'Newer work' }, { observation_id: 'synthetic-undated', done_on: null, item: 'Undated work' });
    await renderPage();
    expect([...container.querySelectorAll('[data-observation-id]')].map(el => el.getAttribute('data-observation-id'))).toEqual(['synthetic-newer', 'synthetic-work', 'synthetic-undated']);
    expect(container.querySelector('[data-observation-id="synthetic-undated"]')?.textContent).toContain('—');
  });
  it('lets older work reach the activity reader when newer conditions fill its twelve-row window', async () => {
    fixture.direct = Array.from({length: 12}, (_, i) => ({ id: `synthetic-condition-${i}`, kind: 'condition', observed_at: '2025-03-01', structured_data: { lifecycle_status: 'installed', part_number: 'synthetic-part' } }));
    await renderPage();
    expect(tile('Parts installed')).toBe('1');
    expect(container.querySelector('[data-observation-id="synthetic-work"]')).toBeNull();
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[data-observation-id="synthetic-work"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-observation-id]')).toHaveLength(1);
    expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelectorAll('[data-observation-id]')).toHaveLength(12);
  });
  it('distinguishes public reader failure from empty history without exposing raw errors', async () => {
    fixture.publicError = { message: 'Synthetic private failure' };
    await renderPage();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('counts and activity may be incomplete');
    expect(container.textContent).not.toContain('Synthetic private failure');
    expect(container.querySelector('[data-observation-id]')).toBeNull();
  });
  it('handles an empty response and rejected transport without remaining in loading state', async () => {
    fixture.publicRows = [];
    await renderPage();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[data-observation-id]')).toBeNull();
    fixture.rpc.mockRejectedValue(new Error('Synthetic transport failure'));
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPage();
    expect(container.textContent).toContain('Lifecycle history could not be loaded.');
    expect(container.textContent).not.toContain('Loading lifecycle stats');
    expect(container.textContent).not.toContain('Synthetic transport failure');
  });
});
