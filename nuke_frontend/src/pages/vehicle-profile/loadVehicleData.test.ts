import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loadVehicleImpl, mergedTargetOf, selectBestHeroImage } from './loadVehicleData';

describe('profile fallback transport', () => {
  const id = '00000000-0000-0000-0000-0000000000a1';
  const target = '00000000-0000-0000-0000-0000000000b2';
  async function load(row: Row | null, emptyRpc = false) {
    const requests: URL[] = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.pathname === '/rest/v1/rpc/get_vehicle_profile_data') {
        return emptyRpc ? json({ vehicle: null }) : json({ code: '57014', message: 'statement timeout' }, 500);
      }
      if (url.pathname === '/rest/v1/vehicles') {
        if (!row) return json({ code: 'PGRST116', message: 'No visible row' }, 406);
        // Return only the requested columns, as PostgREST does: merge routing must carry its field.
        const columns = new Set(url.searchParams.get('select')?.split(','));
        return json(Object.fromEntries(Object.entries(row).filter(([key]) => columns.has(key))));
      }
      if (url.pathname === '/rest/v1/vehicle_events') return json([]);
      return json({ code: 'PGRST205', message: 'Relation not found in schema cache' }, 404);
    });
    const supabase = createClient('https://profile-fallback.test', 'anonymous-fixture', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetcher },
    });
    const navigate = vi.fn(), setVehicle = vi.fn(), setLoading = vi.fn();
    const result = await loadVehicleImpl({
      vehicleId: id, session: null, supabase, navigate, setVehicle, setLoading,
      leadImageUrl: null, ranBatSyncRef: { current: null }, setIsPublic: vi.fn(),
      setLeadImageUrl: vi.fn(), setVehicleImages: vi.fn(), setTimelineEvents: vi.fn(), setAuctionPulse: vi.fn(),
    });
    return { result, requests, navigate, setVehicle, setLoading };
  }

  it.each([false, true])('loads the public record after an unusable RPC (empty=%s)', async empty => {
    const row = { id, is_public: true, year: 1977, make: 'Chevrolet', model: 'K5 Blazer', observation_count: 12 };
    const out = await load(row, empty);
    expect(out.setVehicle).toHaveBeenCalledWith(expect.objectContaining(row));
    expect(out.result.observationCount).toBe(12);
    expect(out.navigate).not.toHaveBeenCalled();
    expect(out.requests.map(url => url.pathname)).toEqual([
      '/rest/v1/rpc/get_vehicle_profile_data', '/rest/v1/vehicles', '/rest/v1/vehicle_events',
    ]);
    expect(out.requests[1].searchParams.get('id')).toBe(`eq.${id}`);
    expect(out.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('routes a merged fallback record to its target before displaying the stub', async () => {
    const out = await load({ id, is_public: true, merged_into_vehicle_id: target });
    expect(out.navigate).toHaveBeenCalledWith(`/vehicle/${target}`, { replace: true });
    expect(out.setVehicle).not.toHaveBeenCalled();
    expect(out.requests).toHaveLength(2);
  });

  it('retains the anonymous private-record refusal', async () => {
    const out = await load({ id, is_public: false });
    expect(out.navigate).toHaveBeenCalledWith('/login');
    expect(out.setVehicle).not.toHaveBeenCalled();
  });

  it('leaves a denied or missing fallback record undisplayed', async () => {
    const out = await load(null);
    expect(out.setVehicle).toHaveBeenCalledWith(null);
    expect(out.navigate).not.toHaveBeenCalled();
    expect(out.setLoading).toHaveBeenLastCalledWith(false);
  });
});

type Row = Record<string, unknown>;
const photo = (id: string, extra: Row = {}): Row => ({
  id, image_url: `https://images.example/${id}.jpg`, source: 'external_import',
  created_at: '2026-02-21T12:00:00Z', ...extra,
});

// Keep primary and recent reads separate: this reproduces a primary that is
// outside the recent limit, rather than accidentally putting it in that window.
function imageClient(recent: Row[], primaries: Row[] = []) {
  const calls: { filters: Record<string, unknown>; limit: number }[] = [];
  return {
    calls,
    from: vi.fn(() => {
      const call = { filters: {} as Record<string, unknown>, limit: 0 };
      calls.push(call);
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn((key, value) => { call.filters[key] = value; return query; }),
        order: vi.fn(() => query),
        limit: vi.fn((limit) => { call.limit = limit; return query; }),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve({ data: call.filters.is_primary === true ? primaries : recent, error: null })
            .then(resolve, reject),
      };
      return query;
    }),
  };
}

const selected = (rows: Row[], primaryImageUrl?: string) =>
  selectBestHeroImage('fixture-vehicle', imageClient(rows), primaryImageUrl, rows);

describe('selectBestHeroImage', () => {
  it('retains an older explicit primary outside the newest 60 imported images', async () => {
    const recent = Array.from({ length: 60 }, (_, i) => photo(`new-import-${i}`));
    const primary = photo('original-primary', { is_primary: true, created_at: '2026-01-26T12:00:00Z' });
    const client = imageClient(recent, [primary]);
    expect((await selectBestHeroImage('older-primary', client))?.url).toBe(primary.image_url);
    expect(client.calls).toEqual([
      { filters: { vehicle_id: 'older-primary' }, limit: 60 },
      { filters: { vehicle_id: 'older-primary', is_primary: true }, limit: 10 },
    ]);
  });

  it('still prefers the newest eligible owner exterior to an older explicit primary', async () => {
    const old = photo('old', { is_primary: true, source: 'iphoto', vehicle_zone: 'ext_front', taken_at: '2026-01-01T12:00:00Z' });
    const newest = photo('newest', { source: 'iphoto', vehicle_zone: 'ext_front_driver', taken_at: '2026-05-24T12:00:00Z' });
    expect((await selected([old, newest]))?.url).toBe(newest.image_url);
  });

  it('finds the explicit primary even with a partial prefetched image list', async () => {
    const primary = photo('original', { is_primary: true });
    const client = imageClient([], [primary]);
    expect((await selectBestHeroImage('prefetch-without-primary', client, null, [photo('new')]))?.url).toBe(primary.image_url);
    expect(client.calls).toHaveLength(1);
  });

  it.each([
    { is_document: true }, { vehicle_zone: 'int_dashboard' },
    { vehicle_zone: 'mech_engine_bay' }, { vehicle_zone: 'mech_transmission' },
    { vehicle_zone: 'ext_undercarriage' }, { vehicle_zone: 'detail_vin' },
    { vehicle_zone: 'panel_hood' }, { vehicle_zone: 'wheel_fl' },
    { category: 'documentation' }, { image_type: 'receipt_document' },
    { angle: 'interior_dashboard' }, { ai_detected_angle: 'engine_bay' },
  ])('excludes known non-heroes at primary and scored fallback stages: %j', async (classification) => {
    const invalid = photo('invalid', { is_primary: true, photo_quality_score: 1000, ...classification });
    const fallback = photo('unknown');
    expect((await selected([invalid, fallback], String(invalid.image_url)))?.url).toBe(fallback.image_url);
    expect(await selected([invalid], String(invalid.image_url))).toBeNull();
  });

  it.each([
    { is_sensitive: true }, { is_superseded: true }, { is_duplicate: true },
    { image_vehicle_match_status: 'mismatch' }, { image_vehicle_match_status: 'unrelated' },
    { vision_gate_status: 'rejected_personal' }, { vision_gate_status: 'rejected_misattributed' },
    { vision_gate_status: 'rejected' },
  ])('does not display a blocked primary or revive its vehicle URL: %j', async (flags) => {
    const invalid = photo('blocked', { is_primary: true, ...flags });
    expect(await selected([invalid], String(invalid.image_url))).toBeNull();
  });

  it('keeps an unknown pending image eligible without manufacturing classification', async () => {
    const unknown = photo('unclassified', { category: 'general', angle: 'unknown', ai_processing_status: 'pending' });
    expect(await selected([unknown])).toEqual({ url: unknown.image_url, meta: {} });
    expect(unknown).not.toHaveProperty('vehicle_zone');
  });

  it('does not promote an unchecked vehicle URL when rows are absent', async () => {
    expect(await selectBestHeroImage('no-image-rows', imageClient([]), 'https://images.example/unchecked.jpg')).toBeNull();
  });
});

describe('mergedTargetOf', () => {
  const target = '83f6f033-a3c3-4cf4-a85e-a60d2c588838';
  it('names the record a merged-away vehicle was folded into', () => {
    expect(mergedTargetOf({ id: '8bde1dda-ebb4-480e-8942-e561feb36667', merged_into_vehicle_id: target })).toBe(target);
  });
  it('names nothing for a live vehicle, a missing pointer, or a pointer to itself', () => {
    expect(mergedTargetOf({ id: target, merged_into_vehicle_id: null })).toBeNull();
    expect(mergedTargetOf({ id: target })).toBeNull();
    expect(mergedTargetOf({ id: target, merged_into_vehicle_id: target })).toBeNull();
    expect(mergedTargetOf({ id: 'x', merged_into_vehicle_id: 'short' })).toBeNull();
    expect(mergedTargetOf(null)).toBeNull();
  });
});
