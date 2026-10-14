import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => fixture.rpc(...args) } }));
import { fetchVehicleCardImages } from './vehicleCardImages';

beforeEach(() => { fixture.rpc.mockReset(); });

it('asks for one image per distinct vehicle through the reader', async () => {
  fixture.rpc.mockResolvedValue({ data: [{ vehicle_id: 'a', thumbnail_url: 't', medium_url: null, image_url: 'f', variants: {} }], error: null });
  const out = await fetchVehicleCardImages(['a', 'b', 'a', '']);
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  expect(fixture.rpc).toHaveBeenCalledWith('vehicle_card_images', { p_vehicle_ids: ['a', 'b'] });
  expect(out.error).toBeNull();
  expect(out.data).toHaveLength(1);
});

it('does not call the database for an empty list', async () => {
  const out = await fetchVehicleCardImages([]);
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(out).toEqual({ data: [], error: null });
});

it('passes an error through and keeps data null', async () => {
  const failure = { message: 'boom' };
  fixture.rpc.mockResolvedValue({ data: null, error: failure });
  const out = await fetchVehicleCardImages(['a']);
  expect(out.data).toBeNull();
  expect(out.error).toBe(failure);
});
