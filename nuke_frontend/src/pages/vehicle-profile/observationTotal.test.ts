import { describe, expect, it, vi } from 'vitest';
import { loadVehicleImpl, observationTotal } from './loadVehicleData';

describe('observationTotal', () => {
  it('uses the number the profile RPC carried, a zero included', () => {
    expect(observationTotal(3, { observation_count: 99 })).toBe(3);
    expect(observationTotal(0, { observation_count: 99 })).toBe(0);
  });
  it('reads the vehicle row total when the RPC carried none', () => {
    expect(observationTotal(null, { observation_count: 8470 })).toBe(8470);
    expect(observationTotal(null, { observation_count: 0 })).toBe(0);
  });
  it('is null when nothing usable exists, so the page counts for itself', () => {
    expect(observationTotal(null, null)).toBeNull();
    expect(observationTotal(null, {})).toBeNull();
    expect(observationTotal(null, { observation_count: null })).toBeNull();
    expect(observationTotal(null, { observation_count: '12' })).toBeNull();
    expect(observationTotal(null, { observation_count: -1 })).toBeNull();
    expect(observationTotal(null, { observation_count: Number.NaN })).toBeNull();
  });
});

// The load itself: a profile whose RPC timed out is loaded from the vehicle row, and its observation total comes
// with it, so the context does not run an exact count of vehicle_observations under row security.
const VEHICLE = { id: '00000000-0000-0000-0000-0000000000a1', is_public: true, year: 1977, make: 'Chevrolet', model: 'K5 Blazer' };
function load(vehicleId: string, rpc: { data: unknown; error: unknown }, row: Record<string, unknown>) {
  const supabase: any = {
    rpc: vi.fn(() => Promise.resolve(rpc)),
    from: vi.fn(() => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, limit: () => q,
        single: () => Promise.resolve({ data: { ...VEHICLE, ...row, id: vehicleId }, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return q;
    }),
    functions: { invoke: vi.fn(() => Promise.resolve({})) },
  };
  return loadVehicleImpl({
    vehicleId, session: null, leadImageUrl: null, supabase, navigate: vi.fn(),
    ranBatSyncRef: { current: null }, setLoading: vi.fn(), setVehicle: vi.fn(), setIsPublic: vi.fn(),
    setLeadImageUrl: vi.fn(), setVehicleImages: vi.fn(), setTimelineEvents: vi.fn(), setAuctionPulse: vi.fn(),
  } as any);
}

describe('loadVehicleImpl observation total', () => {
  it('carries the vehicle row total when the profile RPC failed', async () => {
    const out = await load('00000000-0000-0000-0000-0000000000b1', { data: null, error: new Error('get_vehicle_profile_data timed out') }, { observation_count: 8470 });
    expect(out.observationCount).toBe(8470);
  });
  it('keeps the RPC total when the RPC answered', async () => {
    const rpc = { data: { vehicle: { ...VEHICLE, id: '00000000-0000-0000-0000-0000000000b2' }, stats: { observation_count: 7, comment_count: 2 } }, error: null };
    const out = await load('00000000-0000-0000-0000-0000000000b2', rpc, { observation_count: 8470 });
    expect(out.observationCount).toBe(7);
    expect(out.commentCount).toBe(2);
  });
  it('leaves the total unknown when neither the RPC nor the row has one', async () => {
    const out = await load('00000000-0000-0000-0000-0000000000b3', { data: null, error: new Error('statement timeout') }, { observation_count: null });
    expect(out.observationCount).toBeNull();
  });
});
