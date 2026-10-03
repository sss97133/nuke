import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://gallery-fixture.supabase.co', 'fixture-public-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: transport.fetch },
    }),
  };
});
// Expose the hook's query without rendering React or changing its production API.
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => options }));

import { fetchVehicleImages } from './fetchVehicleImages';
import { hasImageAnalysis, useVehicleImageEvidence } from '../pages/vehicle-profile/hooks/useVehicleImageEvidence';

const vehicleId = '2e61fa34-c5b4-4709-9636-4823546a5bc4';
const photo = (id: number) => ({
  id: `image-${id}`, vehicle_id: vehicleId, image_url: `https://images.example/${id}.jpg`,
  vision_gate_status: 'pending', ai_processing_status: 'pending', source: 'bat_import',
});
const response = (rows: unknown[], total = rows.length) => new Response(JSON.stringify(rows), {
  status: 200,
  headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${rows.length - 1}/${total}` },
});
const requests = () => transport.fetch.mock.calls.map(([input]) => new URL(String(input)));

function expectCanonicalAdmission(url: URL) {
  expect(url.pathname).toBe('/rest/v1/vehicle_images');
  expect(url.searchParams.get('vehicle_id')).toBe(`eq.${vehicleId}`);
  // The database proves public listing provenance; the browser must not duplicate
  // that join or fall back to the old NULL/approved-only gate when it fails.
  expect(url.searchParams.get('vehicle_image_gallery_eligible')).toBe('eq.true');
  expect(url.searchParams.get('vision_gate_status')).toBeNull();
  expect(url.searchParams.get('or') || '').not.toContain('vision_gate_status');
  expect(url.searchParams.get('is_duplicate')).toBe('not.is.true');
  expect(url.searchParams.get('is_superseded')).toBe('not.is.true');
  expect(url.searchParams.get('image_url')).toBe('not.is.null');
}

beforeEach(() => transport.fetch.mockReset());

describe('gallery database admission', () => {
  it('requests all 399 admitted public listing photos without manufacturing analysis', async () => {
    const rows = Array.from({ length: 399 }, (_, index) => photo(index));
    transport.fetch.mockResolvedValueOnce(response(rows));

    const images = await fetchVehicleImages(vehicleId, 'id,image_url,vision_gate_status,ai_processing_status', { includeMismatchFilter: true });

    expect(images).toEqual(rows);
    expect(images).toHaveLength(399);
    expectCanonicalAdmission(requests()[0]);
    expect(requests()[0].searchParams.get('is_document')).toBe('not.is.true');
    expect(requests()[0].searchParams.get('or')).toContain('image_vehicle_match_status');
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });

  it('retains the canonical admission on every page beyond the REST page cap', async () => {
    transport.fetch.mockResolvedValueOnce(response(Array.from({ length: 500 }, (_, index) => photo(index)), 501));
    transport.fetch.mockResolvedValueOnce(response([photo(500)], 501));

    expect(await fetchVehicleImages(vehicleId, 'id,image_url', { includeMismatchFilter: true })).toHaveLength(501);
    expect(requests()).toHaveLength(2);
    for (const url of requests()) expectCanonicalAdmission(url);
    expect(requests()[1].searchParams.get('offset')).toBe('500');
  });

  it('does not retry without admission when the computed database field fails', async () => {
    transport.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: '42703', message: 'computed field unavailable' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    }));

    await expect(fetchVehicleImages(vehicleId, 'id,image_url')).rejects.toMatchObject({ code: '42703' });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expectCanonicalAdmission(requests()[0]);
  });

  it('uses the same database admission for the evidence inventory and keeps pending analysis unknown', async () => {
    transport.fetch.mockResolvedValueOnce(response([photo(0)], 399));
    const query = useVehicleImageEvidence(vehicleId) as unknown as {
      queryFn: (context: { signal: AbortSignal }) => Promise<{ images: any[]; total: number; complete: boolean }>;
    };

    const inventory = await query.queryFn({ signal: new AbortController().signal });

    expectCanonicalAdmission(requests()[0]);
    expect(requests()[0].searchParams.get('is_sensitive')).toBe('not.is.true');
    expect(inventory.total).toBe(399);
    expect(inventory.complete).toBe(false);
    expect(hasImageAnalysis(inventory.images[0])).toBe(false);
    expect(inventory.images[0].vision_gate_status).toBe('pending');
  });
});
