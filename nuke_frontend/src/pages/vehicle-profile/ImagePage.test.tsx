// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// Offline contracts only; no synthetic testimony is written to production.
const fixture = vi.hoisted(() => ({ route: { vehicleId: 'offline-vehicle', imageId: 'offline-image' }, read: vi.fn(), calls: [] as any[] }));
vi.mock('react-router-dom', async original => ({ ...await original<typeof import('react-router-dom')>(), useParams: () => fixture.route }));
vi.mock('../../lib/supabase', () => ({ supabase: { from(table: string) {
  const call = { table, filters: [] as any[], selected: '', single: false, limit: 0, signal: undefined as AbortSignal | undefined };
  const query: any = {
    select: (s: string) => { call.selected = s; return query; },
    eq: (k: string, v: unknown) => { call.filters.push([k, v]); return query; },
    in: (k: string, v: unknown) => { call.filters.push([k, v]); return query; },
    limit: (n: number) => { call.limit = n; return query; },
    abortSignal: (s: AbortSignal) => { call.signal = s; return query; },
    maybeSingle: () => { call.single = true; return query; },
    then: (resolve: any, reject: any) => { fixture.calls.push(call); return Promise.resolve().then(() => fixture.read(call)).then(resolve, reject); },
  }; return query;
} } }));
import ImagePage from './ImagePage';
const VEHICLE = 'offline-vehicle', IMAGE = 'offline-image', SOURCE = 'https://example.invalid/offline.jpg';
function id(c: any, key = 'id') { return c.filters.find((f: any) => f[0] === key)?.[1]; }
function image(extra = {}) { return { id: IMAGE, vehicle_id: VEHICLE, image_url: SOURCE, source: 'offline-source', ...extra }; }
function read(c: any) {
  const row = c.table === 'vehicles' ? { id: id(c), year: 1965, make: 'Offline', model: 'Example' } : c.table === 'vehicle_images' ? image() : null;
  return { data: c.single ? row : row ? [row] : [], error: null };
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.route = { vehicleId: VEHICLE, imageId: IMAGE }; fixture.calls = []; fixture.read.mockReset(); fixture.read.mockImplementation(read);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function mount() { await act(async () => root.render(<MemoryRouter><ImagePage /></MemoryRouter>)); }
it('gates the parent and image before dependent reads, including scoped raw refetches', async () => {
  await mount();
  expect(fixture.calls.slice(0, 2).map(c => c.table)).toEqual(['vehicles', 'vehicle_images']);
  expect(fixture.calls.filter(c => c.table === 'vehicle_images').every(c => id(c) === IMAGE && id(c, 'vehicle_id') === VEHICLE)).toBe(true);
  expect(fixture.calls.every(c => c.signal instanceof AbortSignal)).toBe(true);
  expect(host.querySelector('aside img')?.getAttribute('src')).toBe(SOURCE);
  expect(host.textContent).toContain('Device metadata'); expect(host.textContent).not.toContain('Chain of Custody');
  expect(host.textContent).toContain('bounded reads');
});
it.each([{ data: null, error: null }, { data: { id: 'offline-other-vehicle' }, error: null }, { data: null, error: { message: 'offline private contact and SQL' } }])('stops unavailable parent responses before any image/dependent query: %j', async result => {
  fixture.read.mockResolvedValue(result); await mount();
  expect(fixture.calls.map(c => c.table)).toEqual(['vehicles']); expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector('aside')).toBeNull(); expect(host.textContent).not.toContain('private contact');
});
it.each([{ vehicle_id: 'offline-other-vehicle' }, { id: 'offline-other-image' }])('refuses contradictory image identity: %j', async extra => {
  fixture.read.mockImplementation(c => c.table === 'vehicle_images' ? { data: image(extra), error: null } : read(c)); await mount();
  expect(fixture.calls).toHaveLength(2); expect(host.textContent).toContain('Image unavailable for this vehicle.'); expect(host.querySelector('aside')).toBeNull();
});
it.each([{ data: null, error: null }, { data: null, error: { message: 'offline sensitive source' } }])('keeps absent and failed images unavailable: %j', async result => {
  fixture.read.mockImplementation(c => c.table === 'vehicle_images' ? result : read(c)); await mount();
  expect(fixture.calls).toHaveLength(2); expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(host.querySelector('aside')).toBeNull(); expect(host.textContent).not.toContain('sensitive');
});
it('links a recorded witness to its actual vehicle and does not invent a parent for NULL', async () => {
  fixture.read.mockImplementation(c => c.table === 'observation_witnesses' && c.selected !== '*' ? { data: [
    { witness_role: 'source_image', observation: { id: 'offline-other-observation', vehicle_id: 'offline-other-vehicle', kind: 'condition', structured_data: {} } },
    { witness_role: 'source_image', observation: { id: 'offline-parent-unknown', vehicle_id: null, kind: 'condition' } },
  ], error: null } : read(c)); await mount();
  expect(fixture.calls.find(c => c.table === 'observation_witnesses' && c.selected !== '*').selected).toContain('vehicle_id');
  expect(host.querySelector('a[href="/vehicle/offline-other-vehicle/observation/offline-other-observation"]')).not.toBeNull();
  expect(host.querySelector('a[href="/vehicle/offline-vehicle/observation/offline-other-observation"]')).toBeNull();
  expect(host.querySelector('a[href*="offline-parent-unknown"]')).toBeNull();
});
it('distinguishes failed raw/device reads from completed empty projections', async () => {
  fixture.read.mockImplementation(c => c.table === 'device_attributions' || c.table === 'observation_witnesses' && c.selected === '*' ? { data: null, error: { message: 'offline private permission' } } : read(c)); await mount();
  expect(host.querySelector('aside img')).not.toBeNull(); expect(host.textContent).toContain('Device metadata unavailable.');
  expect(host.textContent).toContain('Read unavailable'); expect(host.textContent).toContain('0 rows returned'); expect(host.textContent).not.toContain('private permission');
});
it('retains distinct witness roles as links without counting them as independent observations', async () => {
  fixture.read.mockImplementation(c => c.table === 'observation_witnesses' && c.selected !== '*' ? { data: ['source_image','install_witness'].map(witness_role => ({
    witness_role, observation: { id: 'offline-shared-observation', vehicle_id: VEHICLE, kind: 'condition', structured_data: {} },
  })), error: null } : read(c));
  const errors = vi.spyOn(console, 'error');
  try {
    await mount();
    expect(host.querySelectorAll('a[href="/vehicle/offline-vehicle/observation/offline-shared-observation"]')).toHaveLength(2);
    expect(host.textContent).toContain('Recorded vehicle observation links · 2');
    expect(host.textContent).toContain('Independent support remains unassessed');
    expect(errors.mock.calls.some(call => String(call[0]).includes('same key'))).toBe(false);
  } finally { errors.mockRestore(); }
});
it('refuses foreign raw image and witness payloads that contradict the query filters', async () => {
  fixture.read.mockImplementation(c => c.table === 'vehicle_images' && !c.single ? { data: [image({ id: 'offline-foreign-image', caption: 'offline foreign payload' })], error: null }
    : c.table === 'observation_witnesses' && c.selected === '*' ? { data: [{ image_id: 'offline-foreign-image', observation_id: 'offline-foreign-observation' }], error: null } : read(c)); await mount();
  expect(host.querySelector('aside img')).not.toBeNull(); expect(host.textContent).not.toContain('offline foreign payload');
  expect(host.textContent).not.toContain('offline-foreign-observation'); expect(fixture.calls.some(c => c.table === 'vehicle_observations')).toBe(false);
});
it('withholds the previous image and substrate on a route change', async () => {
  await mount(); let release: (v: any) => void = () => {};
  fixture.read.mockImplementation(() => new Promise(r => { release = r; })); fixture.route = { vehicleId: 'offline-next-vehicle', imageId: 'offline-next-image' }; await mount();
  expect(host.querySelector('aside')).toBeNull(); expect(host.textContent).not.toContain('offline-source'); expect(host.textContent).not.toContain('bounded reads');
  await act(async () => release({ data: null, error: null })); expect(host.textContent).toContain('Vehicle unavailable.');
});
it('ignores a cancelled completion when only the image ID changes', async () => {
  let release: (v: any) => void = () => {};
  fixture.read.mockImplementation(c => c.table === 'vehicle_images' && id(c) === IMAGE ? new Promise(r => { release = r; })
    : c.table === 'vehicle_images' ? { data: c.single ? image({ id: 'offline-next-image', image_url: 'https://example.invalid/next.jpg' }) : [], error: null } : read(c));
  await mount(); const oldSignal = fixture.calls.find(c => c.table === 'vehicle_images').signal;
  fixture.route = { vehicleId: VEHICLE, imageId: 'offline-next-image' }; await mount(); expect(oldSignal.aborted).toBe(true);
  await act(async () => release({ data: image(), error: null })); expect(host.querySelector('aside img')?.getAttribute('src')).toBe('https://example.invalid/next.jpg');
  expect(host.querySelector('a[href="'+SOURCE+'"]')).toBeNull();
});
it.each(['vehicles', 'vehicle_images'])('ends a stalled %s read at a finite deadline', async table => {
  vi.useFakeTimers(); fixture.read.mockImplementation(c => c.table === table ? new Promise((_, reject) => c.signal.addEventListener('abort', () => reject(new Error('offline secret timeout')), { once: true })) : read(c));
  await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(host.querySelector('[role=alert]')).not.toBeNull(); expect(host.querySelector('[role=status]')).toBeNull(); expect(host.querySelector('aside')).toBeNull();
  expect(host.textContent).not.toContain('secret'); expect(fixture.calls.some(c => ['device_attributions','observation_witnesses'].includes(c.table))).toBe(false);
});
