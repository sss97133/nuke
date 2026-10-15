// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  rpc: vi.fn(),
  tables: [] as string[],
}));

// A chainable stand-in for the query builder: every method returns the builder, awaiting it yields the table's rows.
const builder = (rows: any[]) => {
  const b: any = { then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }) };
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit']) b[m] = () => b;
  return b;
};
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      fixture.tables.push(table);
      if (table === 'vehicle_images') throw new Error('every image of every vehicle is not read');
      return builder(fixture.rows[table] ?? []);
    },
    rpc: (...args: unknown[]) => fixture.rpc(...args),
  },
}));
vi.mock('../../lib/privateMoney', () => ({
  fetchOrganizationVehicleBooks: async () => new Map(),
  withOrganizationVehicleBook: (ov: any) => ov,
}));
import SoldInventoryBrowser from './SoldInventoryBrowser';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  fixture.tables = [];
  fixture.rows = {
    organization_vehicles: [
      { id: 'l1', vehicle_id: 'v1', relationship_type: 'sold_by', status: 'sold', listing_status: 'sold', sale_date: '2026-09-01' },
      { id: 'l2', vehicle_id: 'v2', relationship_type: 'sold_by', status: 'sold', listing_status: 'sold', sale_date: '2026-09-02' },
    ],
    vehicles: [
      { id: 'v1', year: 1972, make: 'Synthetic', model: 'One', sale_status: 'sold', sale_price: 30000, sale_date: '2026-09-01', image_count: 4667 },
      { id: 'v2', year: 1984, make: 'Synthetic', model: 'Two', sale_status: 'sold', sale_price: 12000, sale_date: '2026-09-02', image_count: 6 },
    ],
  };
  fixture.rpc.mockImplementation(async () => ({
    data: [{ vehicle_id: 'v1', thumbnail_url: 'https://img.example.test/v1-thumb.jpg', medium_url: null, image_url: 'https://img.example.test/v1.jpg', variants: {} }],
    error: null,
  }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('takes one card image per vehicle from vehicle_card_images and the count from vehicles.image_count', async () => {
  await act(async () => root.render(<MemoryRouter><SoldInventoryBrowser organizationId="org-1" /></MemoryRouter>));
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  expect(fixture.rpc).toHaveBeenCalledWith('vehicle_card_images', { p_vehicle_ids: ['v1', 'v2'] });
  expect(fixture.tables).not.toContain('vehicle_images');
  // the gallery view draws the card image and the photo count
  const gallery = [...host.querySelectorAll('button')].find((el) => el.textContent?.trim().toLowerCase() === 'gallery')!;
  await act(async () => { gallery.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(host.textContent).toContain('4667 photos');
  expect(host.innerHTML).toContain('v1-thumb');
});
