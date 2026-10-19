// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ workOrders: [] as any[], payments: [] as any[], vehicleSelect: '' }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from(table: string) {
    const query: any = {
      select: (cols: string) => { if (table === 'vehicles') fixture.vehicleSelect = cols; return query; },
      eq: () => query, in: () => query,
      maybeSingle: () => Promise.resolve({ data: { id: 'vehicle-1', year: 1977, make: 'Synthetic', model: 'Wagon', vin: 'SYNTH0000000000001' }, error: null }),
      order: () => Promise.resolve({ data: table === 'work_orders' ? fixture.workOrders : fixture.payments, error: null }),
    };
    return query;
  },
} }));
import BuildDashboard from './BuildDashboard';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  fixture.workOrders = []; fixture.payments = [];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
async function open() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/builds/vehicle-1']}>
      <Routes>
        <Route path="/builds/:vehicleId" element={<BuildDashboard />} />
        <Route path="/vehicle/:vehicleId" element={<div>vehicle page</div>} />
      </Routes>
    </MemoryRouter>,
  ));
}

describe('BuildDashboard: the books are the owner\'s', () => {
  it('a visitor who can read no work orders goes to the vehicle page, with no money drawn', async () => {
    await open();
    expect(container.textContent).toBe('vehicle page');
    expect(fixture.vehicleSelect).not.toMatch(/current_value/);
  });

  it('a reader of the work orders gets the cost meter', async () => {
    fixture.workOrders = [{ id: 'wo-1', title: 'Frame', description: null, status: 'open', estimated_total: 1200, actual_total: 900, metadata: {}, created_at: '2026-10-01T00:00:00Z' }];
    await open();
    expect(container.textContent).toContain('Cost Meter');
    expect(container.textContent).toContain('$1,200');
  });
});
