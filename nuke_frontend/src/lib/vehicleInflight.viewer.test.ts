import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ viewer: 'A' as string | null, rows: vi.fn(), rpc: vi.fn(), listeners: new Set<(event: string, session: unknown) => void>() }));
vi.mock('./supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: fixture.viewer ? { user: { id: fixture.viewer } } : null }, error: null }),
    onAuthStateChange: (fn: (event: string, session: unknown) => void) => { fixture.listeners.add(fn); return { data: { subscription: { unsubscribe: () => fixture.listeners.delete(fn) } } }; } },
  rpc: fixture.rpc,
  from: (table: string) => {
    let columns = '';
    const query: Record<string, unknown> = {};
    for (const method of ['eq','not','order','range','or','limit','maybeSingle','single','in']) query[method] = () => query;
    query.select = (selection: string) => { columns = selection; return query; };
    query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(fixture.rows(table, columns)).then(resolve, reject);
    return query;
  },
} }));
import { supabase } from './supabase';
import { fetchVehicleImages } from './fetchVehicleImages';
import { loadVehicleImpl, resolveVehicleVinAddress, selectBestHeroImage } from '../pages/vehicle-profile/loadVehicleData';
const id = '00000000-0000-4000-a000-000000000001';
const image = (name: string) => ({ id: name, vehicle_id: id, image_url: `https://images.example/${name}.jpg`, source: 'user_upload', is_approved: true, vision_gate_status: 'approved', taken_at: '2026-10-01T00:00:00Z' });
const rows = (name: string) => ({ data: [image(name)], count: 1, error: null });
const profile = (name: string) => ({ data: { vehicle: { id, is_public: true, make: name }, images: [], timeline_events: [], stats: {} }, error: null });
const switchViewer = (viewer: string | null) => { fixture.viewer = viewer; fixture.listeners.forEach(fn => fn(viewer ? 'SIGNED_IN' : 'SIGNED_OUT', viewer ? { user: { id: viewer } } : null)); };
beforeEach(() => { fixture.viewer = 'A'; fixture.rows.mockReset().mockResolvedValue({ data: [], count: 0, error: null }); fixture.rpc.mockReset().mockResolvedValue(profile('B')); });

it.each(['B', null])('does not share a former viewer gallery response with %s', async viewer => {
  let finish!: (value: unknown) => void; fixture.rows.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(rows('PUBLIC B'));
  const prior = fetchVehicleImages(id, 'id,image_url,exif_data').catch(() => []); await vi.waitFor(() => expect(fixture.rows).toHaveBeenCalledTimes(1));
  switchViewer(viewer); const current = fetchVehicleImages(id, 'id,image_url,exif_data'); finish({ ...rows('PRIVATE A'), data: [{ ...image('PRIVATE A'), exif_data: { private: 'A' } }] });
  const [oldImages, currentImages] = await Promise.all([prior, current]);
  expect(currentImages).toEqual([image('PUBLIC B')]); expect(oldImages).toEqual([]);
  if (viewer === null) { expect(fixture.rows.mock.calls[1][0]).toBe('vehicle_images_public'); expect(fixture.rows.mock.calls[1][1]).not.toContain('exif_data'); }
});

it.each(['B', null])('does not share a former viewer hero candidate promise with %s', async viewer => {
  let finish!: (value: unknown) => void; fixture.rows.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const prior = selectBestHeroImage(id, supabase); await vi.waitFor(() => expect(fixture.rows.mock.calls.length).toBe(2));
  switchViewer(viewer); fixture.rows.mockResolvedValue(rows('PUBLIC B')); const current = selectBestHeroImage(id, supabase); finish(rows('PRIVATE A'));
  const [oldHero, currentHero] = await Promise.all([prior, current]); expect(currentHero?.url).toBe(image('PUBLIC B').image_url); expect(oldHero).toBeNull();
});

it.each(['B', null])('keeps the current profile separate from a former viewer pending RPC for %s', async viewer => {
  let finish!: (value: unknown) => void; fixture.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const start = () => { const setVehicle = vi.fn(), navigate = vi.fn(); const promise = loadVehicleImpl({ vehicleId: id, session: { user: { id: fixture.viewer } }, supabase, navigate, setVehicle, setLoading: vi.fn(), leadImageUrl: null, ranBatSyncRef: { current: null }, setIsPublic: vi.fn(), setLeadImageUrl: vi.fn(), setVehicleImages: vi.fn(), setTimelineEvents: vi.fn(), setAuctionPulse: vi.fn() }); return { promise, setVehicle, navigate }; };
  const prior = start(); await vi.waitFor(() => expect(fixture.rpc).toHaveBeenCalledTimes(1)); switchViewer(viewer); const current = start(); finish(profile('PRIVATE A'));
  await Promise.all([prior.promise, current.promise]); expect(current.setVehicle).toHaveBeenCalledWith(expect.objectContaining({ make: 'B' })); expect(current.setVehicle).not.toHaveBeenCalledWith(expect.objectContaining({ make: 'PRIVATE A' }));
  expect(prior.setVehicle).not.toHaveBeenCalled(); expect(prior.navigate).not.toHaveBeenCalled();
});


it('preserves public VIN coalescing across viewer transitions without reading a private profile', async () => {
  const vin = '1GCEK14K8EJ123456';
  let finish!: (value: unknown) => void;
  fixture.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const prior = resolveVehicleVinAddress(vin, supabase);
  switchViewer(null);
  const current = resolveVehicleVinAddress(vin.toLowerCase(), supabase);
  finish({ data: [{ id, vin }], error: null });
  expect(await Promise.all([prior, current])).toEqual([{ status: 'resolved', id }, { status: 'resolved', id }]);
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  expect(fixture.rpc).toHaveBeenCalledWith('vehicle_by_vin_public', { p_vin: vin });
});
