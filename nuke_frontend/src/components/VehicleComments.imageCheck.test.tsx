// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ calls: [] as any[], images: [] as any[], comments: [] as any[] }));
vi.mock('../hooks/useVehicleAllComments', () => ({
  useVehicleAllComments: () => ({ data: fixture.comments, isLoading: false, refetch: vi.fn() }),
}));
vi.mock('./UserReputationBadge', () => ({ default: () => null }));
vi.mock('./ExtractionQueueStatus', () => ({ default: () => null }));
vi.mock('../services/contentDetector', () => ({ ContentDetector: { detect: () => ({}) } }));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  from: (table: string) => {
    const call: any = { table, filters: {}, selectArgs: [] as any[], limit: undefined };
    fixture.calls.push(call);
    const q: any = {
      select: (...args: any[]) => { call.selectArgs = args; return q; },
      eq: (key: string, value: unknown) => { call.filters[key] = value; return q; },
      limit: (n: number) => { call.limit = n; return q; },
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === 'vehicle_images' ? fixture.images : [], error: null }).then(resolve, reject),
    };
    return q;
  },
} }));
import VehicleComments from './VehicleComments';

let container: HTMLDivElement, root: Root;
const comment = (text: string) => ({ id: 'c1', user_id: 'u1', comment_text: text, created_at: '2026-10-01T12:00:00Z', target_type: 'vehicle', target_label: 'Vehicle' });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.calls.length = 0; fixture.images = []; fixture.comments = [];
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(<VehicleComments vehicleId="v1" />));
const imageCalls = () => fixture.calls.filter((c) => c.table === 'vehicle_images');

describe('VehicleComments has-any-image check', () => {
  it('asks for one image row, not an exact count of the vehicle\'s photos', async () => {
    fixture.comments = [comment('looks good')];
    fixture.images = [{ id: 'img-1' }];
    await render();
    expect(imageCalls()).toHaveLength(1);
    expect(imageCalls()[0]).toMatchObject({ filters: { vehicle_id: 'v1' }, selectArgs: ['id'], limit: 1 });
    // an existing image ends the self-healing check: nothing else is read
    expect(fixture.calls.filter((c) => c.table !== 'vehicle_images')).toHaveLength(0);
  });
  it('goes on to look at the comments only when the vehicle has no image', async () => {
    fixture.comments = [comment('see https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/ for the history')];
    fixture.images = [];
    await render();
    expect(imageCalls()).toHaveLength(1);
    expect(fixture.calls.some((c) => c.table === 'profiles')).toBe(true);
  });
});
