import { describe, expect, it, vi } from 'vitest';
import { selectBestHeroImage } from './loadVehicleData';

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
