// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  events: [] as any[],
  vehicles: [] as any[],
  images: [] as any[],
  rpc: vi.fn(),
  tables: [] as string[],
}));

// A chainable stand-in for the query builder: every method returns the builder, awaiting it yields the table's rows.
const builder = (rows: any[]) => {
  const b: any = { then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }) };
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = () => b;
  return b;
};
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      fixture.tables.push(table);
      return builder(table === 'vehicle_events' ? fixture.events : table === 'vehicles' ? fixture.vehicles : []);
    },
    rpc: (...args: unknown[]) => fixture.rpc(...args),
  },
}));
vi.mock('../vehicles/VehicleCardDense', () => ({
  default: ({ vehicle }: any) => <div data-testid="card" data-vehicle={vehicle.id} data-image={vehicle.primary_image_url ?? ''} />,
}));
import { OrganizationAuctionsTab } from './OrganizationAuctionsTab';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.clearAllMocks();
  fixture.tables = [];
  fixture.events = [
    { id: 'e1', vehicle_id: 'v1', source_platform: 'bat', source_url: 'https://x/1', event_status: 'sold', ended_at: '2026-10-01T00:00:00Z', final_price: 100 },
    { id: 'e2', vehicle_id: 'v2', source_platform: 'bat', source_url: 'https://x/2', event_status: 'ended', ended_at: '2026-10-02T00:00:00Z' },
    { id: 'e3', vehicle_id: 'v1', source_platform: 'bat', source_url: 'https://x/3', event_status: 'ended', ended_at: '2026-10-03T00:00:00Z' },
  ];
  fixture.vehicles = [{ id: 'v1', year: 1970, make: 'Ford', model: 'Bronco' }, { id: 'v2', year: 1980, make: 'Jeep', model: 'CJ' }];
  fixture.images = [
    { vehicle_id: 'v1', thumbnail_url: 'row-thumb-1', medium_url: null, image_url: 'row-full-1', variants: { thumbnail: 'variant-thumb-1' } },
    { vehicle_id: 'v2', thumbnail_url: null, medium_url: 'row-medium-2', image_url: 'row-full-2', variants: {} },
  ];
  fixture.rpc.mockImplementation(async () => ({ data: fixture.images, error: null }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = async () => {
  await act(async () => root.render(<MemoryRouter><OrganizationAuctionsTab organizationId="org-1" /></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
};

it('gets each vehicle\'s thumbnail from the one-image-per-vehicle reader, not from vehicle_images', async () => {
  await mount();
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  expect(fixture.rpc).toHaveBeenCalledWith('vehicle_card_images', { p_vehicle_ids: ['v1', 'v2'] });
  expect(fixture.tables).not.toContain('vehicle_images');
});

it('shows the variant thumbnail first, then the row\'s thumbnail, medium and full urls', async () => {
  await mount();
  const byVehicle = Object.fromEntries([...host.querySelectorAll<HTMLElement>('[data-testid="card"]')]
    .map((el) => [el.dataset.vehicle!, el.dataset.image!]));
  expect(byVehicle.v1).toBe('variant-thumb-1');
  expect(byVehicle.v2).toBe('row-medium-2');
});
