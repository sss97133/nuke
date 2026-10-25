// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ calls: [] as any[], images: [] as any[], responses: [] as Promise<any>[] }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const call: any = { table, filters: {}, selectArgs: [] as any[], limit: undefined };
    fixture.calls.push(call);
    const q: any = {
      select: (...args: any[]) => { call.selectArgs = args; return q; },
      eq: (key: string, value: unknown) => { call.filters[key] = value; return q; },
      limit: (n: number) => { call.limit = n; return q; },
      then: (resolve: any, reject: any) => (fixture.responses.shift() || Promise.resolve({ data: fixture.images, error: null })).then(resolve, reject),
    };
    return q;
  },
} }));
import OrphanedVehicleBanner from './OrphanedVehicleBanner';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.calls.length = 0; fixture.images = []; fixture.responses.length = 0;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (vehicle: Record<string, unknown>, viewer: string | null = null) =>
  act(async () => root.render(<OrphanedVehicleBanner vehicle={vehicle} session={viewer ? { user: { id: viewer } } : null} permissions={{}} />));
const pendingVehicle = (id: string) => ({ id, vin: '', uploaded_by: 'u1', status: 'pending' });
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: unknown) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

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


it('does not announce missing images during a pending read', async () => {
  const read = deferred(); fixture.responses.push(read.promise);
  await render(pendingVehicle('pending'));
  expect(container.textContent).toContain('Checking images');
  expect(container.textContent).not.toContain('No images');
  await act(async () => read.resolve({ data: [], error: null }));
  expect(container.textContent).toContain('No images visible');
});
it.each(['returned', 'thrown', 'malformed'])('keeps %s failures unknown and can retry without claiming or editing', async failure => {
  const read = deferred(); fixture.responses.push(read.promise);
  await render(pendingVehicle('failure'));
  await act(async () => {
    if (failure === 'thrown') read.reject(new Error('offline'));
    else read.resolve(failure === 'returned' ? { data: null, error: { message: 'denied' } } : { data: null, error: null });
  });
  expect(container.textContent).toContain('Image status unavailable');
  expect(container.textContent).not.toContain('No images');
  fixture.images = [{ id: 'visible' }];
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry image check')!.click());
  expect(container.textContent).not.toContain('unavailable');
  expect(container.textContent).not.toContain('No images');
  expect(fixture.calls).toHaveLength(2);
  expect(fixture.calls.every(call => call.table === 'vehicle_images')).toBe(true);
});
it('never reuses an empty result or late response from a different vehicle', async () => {
  await render(pendingVehicle('empty'));
  expect(container.textContent).toContain('No images');
  const stale = deferred(); fixture.responses.push(stale.promise);
  await render(pendingVehicle('slow'));
  expect(container.textContent).not.toContain('No images');
  fixture.images = [{ id: 'present' }];
  await render(pendingVehicle('new'));
  await act(async () => stale.resolve({ data: [], error: null }));
  expect(container.textContent).not.toContain('No images');
  expect(container.textContent).not.toContain('Checking images');
});
it('scopes dismissal and image status to vehicle and viewer', async () => {
  await render(pendingVehicle('first'), 'viewer-a');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss vehicle notice"]')!.click());
  expect(container.textContent).toBe('');
  const nextRead = deferred(); fixture.responses.push(nextRead.promise);
  await render(pendingVehicle('first'), 'viewer-b');
  expect(container.textContent).toContain('Checking images');
  expect(container.textContent).not.toContain('No images');
  await act(async () => nextRead.resolve({ data: [{ id: 'image' }], error: null }));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss vehicle notice"]')!.click());
  await render(pendingVehicle('second'), 'viewer-b');
  expect(container.textContent).toContain('Missing VIN');
});
