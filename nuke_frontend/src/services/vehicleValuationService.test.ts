import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Offline contracts only. These amounts are never sent to production.
const fixture = vi.hoisted(() => ({ read: vi.fn(), calls: [] as any[] }));
vi.mock('../lib/supabase', () => {
  const query = (name: string, args?: unknown) => {
    const call = { name, args, signal: undefined as AbortSignal | undefined };
    const q: any = {
      select: () => q, eq: () => q, in: () => q, not: () => q, or: () => q,
      order: () => q, limit: () => q, maybeSingle: () => q, single: () => q,
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; },
      then: (resolve: any, reject: any) => {
        fixture.calls.push(call);
        return Promise.resolve().then(() => fixture.read(call)).then(resolve, reject);
      },
    };
    return q;
  };
  return { supabase: { from: query, rpc: query } };
});
import { VehicleValuationService } from './vehicleValuationService';

beforeEach(() => {
  fixture.calls = []; fixture.read.mockReset(); VehicleValuationService.clearCache();
  fixture.read.mockImplementation(({ name }) => ({
    data: name === 'get_vehicle_total_invested' ? { total_invested: 0 } :
      name === 'vehicles' ? { make: 'Offline', year: 2000, current_value: 20000 } :
      ['vehicle_valuations', 'vehicle_builds', 'profile_image_insights'].includes(name) ? null : [],
    error: null,
  }));
});
afterEach(() => vi.useRealTimers());

describe('required investment reader failure', () => {
  it.each([
    { data: null, error: { code: '42P01', message: 'private database detail' } },
    { data: { total_invested: 0 }, error: { code: '42501' } },
    { data: null, error: null },
    { data: {}, error: null },
    { data: { total_invested: null }, error: null },
    { data: { total_invested: '1000' }, error: null },
    { data: { total_invested: -1 }, error: null },
    { data: { total_invested: NaN }, error: null },
    { data: { total_invested: Infinity }, error: null },
  ])('rejects unavailable or malformed evidence instead of returning a zero/partial assessment: %j', async result => {
    fixture.read.mockImplementation(({ name }) => name === 'vehicle_valuations'
      ? { data: null, error: null } : result);
    await expect(VehicleValuationService.getValuation('offline-a')).rejects.toThrow('Unable to load valuation evidence.');
    expect(fixture.calls.map(c => c.name)).toEqual(['vehicle_valuations', 'get_vehicle_total_invested']);
    expect(fixture.calls[1].args).toEqual({ p_vehicle_id: 'offline-a' });
    expect(fixture.calls.every(c => c.signal instanceof AbortSignal)).toBe(true);
  });

  it('does not cache failures; the same vehicle can recover on the next read', async () => {
    fixture.read.mockImplementationOnce(() => ({ data: null, error: null }))
      .mockRejectedValueOnce(new Error('private source detail'));
    await expect(VehicleValuationService.getValuation('offline-a')).rejects.toThrow('Unable to load valuation evidence.');
    const value = await VehicleValuationService.getValuation('offline-a');
    expect(value.estimatedValue).toBe(20000);
    expect(fixture.calls.filter(c => c.name === 'get_vehicle_total_invested')).toHaveLength(2);
  });

  it('preserves a successfully answered zero as distinct from a failed read', async () => {
    const value = await VehicleValuationService.getValuation('offline-a');
    expect(value.totalInvested).toBe(0);
    expect(value.estimatedValue).toBe(20000);
    expect(fixture.calls.some(c => c.name === 'get_vehicle_work_sessions')).toBe(true);
  });

  it('retains independently stored assessments without invoking the cost reader', async () => {
    fixture.read.mockResolvedValue({ data: {
      estimated_value: 30000, confidence_score: 40, valuation_date: '2025-01-01T00:00:00Z',
    }, error: null });
    expect((await VehicleValuationService.getValuation('offline-a')).estimatedValue).toBe(30000);
    expect(fixture.calls.map(c => c.name)).toEqual(['vehicle_valuations']);
  });

  it('passes the caller cancellation signal to every downstream query', async () => {
    const controller = new AbortController();
    await VehicleValuationService.getValuation('offline-a', controller.signal);
    expect(fixture.calls.length).toBeGreaterThan(10);
    expect(fixture.calls.every(c => c.signal === controller.signal)).toBe(true);
    controller.abort();
    await expect(VehicleValuationService.getValuation('offline-a', controller.signal)).rejects.toThrow();
  });

  it('refuses an assessment if a dependency ignores cancellation and returns late', async () => {
    const controller = new AbortController();
    const base = fixture.read.getMockImplementation()!;
    fixture.read.mockImplementation(call => {
      if (call.name === 'get_vehicle_work_sessions') controller.abort();
      return base(call);
    });
    await expect(VehicleValuationService.getValuation('offline-a', controller.signal)).rejects.toThrow('Unable to load valuation evidence.');
  });
});
