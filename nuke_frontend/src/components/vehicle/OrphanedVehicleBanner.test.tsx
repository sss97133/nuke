// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ calls: [] as any[], images: [] as any[] }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const call: any = { table, filters: {}, selectArgs: [] as any[], limit: undefined };
    fixture.calls.push(call);
    const q: any = {
      select: (...args: any[]) => { call.selectArgs = args; return q; },
      eq: (key: string, value: unknown) => { call.filters[key] = value; return q; },
      limit: (n: number) => { call.limit = n; return q; },
      then: (resolve: any, reject: any) => Promise.resolve({ data: fixture.images, error: null, count: fixture.images.length }).then(resolve, reject),
    };
    return q;
  },
} }));
import OrphanedVehicleBanner from './OrphanedVehicleBanner';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.calls.length = 0; fixture.images = [];
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (vehicle: Record<string, unknown>) =>
  act(async () => root.render(<OrphanedVehicleBanner vehicle={vehicle} session={null} permissions={{}} />));

describe('OrphanedVehicleBanner image check', () => {
  it('asks nothing when no banner shows', async () => {
    await render({ id: 'v1', vin: '1GCEK14K8EJ123456', uploaded_by: 'u1', status: 'active' });
    expect(container.textContent).toBe('');
    expect(fixture.calls).toHaveLength(0);
  });
  it('asks for one image row, not a count, when the banner shows', async () => {
    fixture.images = [{ id: 'img-1' }];
    await render({ id: 'v2', vin: '', uploaded_by: 'u1', status: 'pending' });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toMatchObject({ table: 'vehicle_images', filters: { vehicle_id: 'v2' }, selectArgs: ['id'], limit: 1 });
    expect(container.textContent).toContain('Missing VIN');
    expect(container.textContent).not.toContain('No images');
  });
  it('names a missing image when the vehicle has none', async () => {
    fixture.images = [];
    await render({ id: 'v3', vin: '', uploaded_by: 'u1', status: 'pending' });
    expect(container.textContent).toContain('No images');
  });
});
