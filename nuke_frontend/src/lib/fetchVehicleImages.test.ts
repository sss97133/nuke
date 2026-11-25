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
import { supabase } from './supabase';
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
const bodyOf = (index: number) => JSON.parse(String(transport.fetch.mock.calls[index][1]?.body));
const SCAN_READER = '/rest/v1/rpc/vehicle_image_scan_metadata_many';

function expectCanonicalAdmission(url: URL) {
  // signed out (this client has no session): the view that omits the withheld columns
  expect(url.pathname).toBe('/rest/v1/vehicle_images_public');
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

beforeEach(() => { transport.fetch.mockReset(); });

describe('gallery database admission', () => {
  it('reports identical coverage to every coalesced caller', async () => {
    transport.fetch.mockResolvedValueOnce(response([photo(0)], 10));
    const first = vi.fn(), second = vi.fn();
    const [a, b] = await Promise.all([
      fetchVehicleImages(vehicleId, 'id,image_url', { maxRows: 1, onLoadCoverage: first }),
      fetchVehicleImages(vehicleId, 'id,image_url', { maxRows: 1, onLoadCoverage: second }),
    ]);
    expect(a).toEqual(b); expect(transport.fetch).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledWith({ loaded: 1, total: 10 });
    expect(second).toHaveBeenCalledWith({ loaded: 1, total: 10 });
  });

  it('refuses a first-page timeout instead of reporting a successful empty inventory', async () => {
    vi.useFakeTimers();
    try {
      transport.fetch.mockReturnValue(new Promise(() => {}));
      const pending = fetchVehicleImages(vehicleId, 'id,image_url', { timeoutMs: 1000 });
      const rejected = expect(pending).rejects.toThrow('timed out before its first page');
      await vi.advanceTimersByTimeAsync(1100);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
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

  it('reports how many admitted rows loaded against the exact count', async () => {
    transport.fetch.mockResolvedValueOnce(response(Array.from({ length: 500 }, (_, index) => photo(index)), 1445));
    const coverage: Array<{ loaded: number; total: number }> = [];

    // A caller that only wants the first page is told the whole it left behind.
    const rows = await fetchVehicleImages(vehicleId, 'id,image_url', { maxRows: 10, onLoadCoverage: c => coverage.push(c) });

    expect(rows).toHaveLength(10);
    expect(coverage).toEqual([{ loaded: 10, total: 1445 }]);
    expect(transport.fetch).toHaveBeenCalledTimes(1);

    transport.fetch.mockResolvedValueOnce(response(Array.from({ length: 500 }, (_, index) => photo(index)), 501));
    transport.fetch.mockResolvedValueOnce(response([photo(500)], 501));
    const all = await fetchVehicleImages(vehicleId, 'id,image_url', { onLoadCoverage: c => coverage.push(c) });
    expect(all).toHaveLength(501);
    expect(coverage.at(-1)).toEqual({ loaded: 501, total: 501 });
  });

  it('asks for the REST cap per page and fetches the rest at its offsets', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, index) => photo(from + index));
    transport.fetch.mockResolvedValueOnce(response(page(0, 1000), 2400));
    transport.fetch.mockResolvedValueOnce(response(page(1000, 1000), 2400));
    transport.fetch.mockResolvedValueOnce(response(page(2000, 400), 2400));

    const rows = await fetchVehicleImages(vehicleId, 'id,image_url', { includeMismatchFilter: true });

    expect(rows).toHaveLength(2400);
    expect(requests()).toHaveLength(3);
    expect(requests()[0].searchParams.get('limit')).toBe('1000');
    expect(requests()[0].searchParams.get('offset')).toBe('0');
    expect(requests().slice(1).map(url => url.searchParams.get('offset')).sort()).toEqual(['1000', '2000']);
    for (const url of requests()) expectCanonicalAdmission(url);
  });

  it('pages by what the server returns when its row cap is below the page size', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, index) => photo(from + index));
    transport.fetch.mockResolvedValueOnce(response(page(0, 500), 1445));
    transport.fetch.mockResolvedValueOnce(response(page(500, 500), 1445));
    transport.fetch.mockResolvedValueOnce(response(page(1000, 445), 1445));

    const rows = await fetchVehicleImages(vehicleId, 'id,image_url');

    expect(rows).toHaveLength(1445);
    expect(requests().slice(1).map(url => url.searchParams.get('offset')).sort()).toEqual(['1000', '500']);
    expect(requests().slice(1).every(url => url.searchParams.get('limit') === '500')).toBe(true);
  });

  it('asks a caller that wants only the first rows for no more than that', async () => {
    transport.fetch.mockResolvedValueOnce(response(Array.from({ length: 500 }, (_, index) => photo(index)), 3716));

    const rows = await fetchVehicleImages(vehicleId, 'id,image_url', { includeMismatchFilter: true, maxRows: 500 });

    expect(rows).toHaveLength(500);
    expect(requests()).toHaveLength(1);
    expect(requests()[0].searchParams.get('limit')).toBe('500');
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
    transport.fetch.mockResolvedValueOnce(response([photo(0)], 399)).mockResolvedValueOnce(response([]));
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

describe('reel reads: newest first, a page from an offset, one view', () => {
  it('orders by the taken clock, cuts the page at the offset and filters the view, keyed apart', async () => {
    const page = Array.from({ length: 12 }, (_, index) => photo(index));
    transport.fetch.mockResolvedValueOnce(response(page, 40)).mockResolvedValueOnce(response([photo(20)]));
    const coverage = vi.fn();
    await fetchVehicleImages(vehicleId, 'id,image_url', { order: 'newest', maxRows: 12, offset: 24, onLoadCoverage: coverage });
    await fetchVehicleImages(vehicleId, 'id,image_url', { order: 'newest', maxRows: 1, angle: 'exterior_side', count: false });
    const [paged, view] = requests();
    expectCanonicalAdmission(paged);
    expect(paged.searchParams.get('order')).toBe('taken_at.desc.nullslast,created_at.desc,id.asc');
    expect(paged.searchParams.get('offset')).toBe('24');
    expect(paged.searchParams.get('limit')).toBe('12');
    // The exact count is of the whole set; the read reports what is left from its offset.
    expect(coverage).toHaveBeenCalledWith({ loaded: 12, total: 16 });
    expect(view.searchParams.get('ai_detected_angle')).toBe('eq.exterior_side');
    expect(view.searchParams.get('limit')).toBe('1');
    expect(transport.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('signed out: the page is cut without the photo reading, then the readings of exactly its rows', () => {
  type Row = Record<string, unknown>;
  const SELECT = 'id, image_url, ai_byok_scene:ai_scan_metadata->byok_deep_analysis->>scene_type, ai_legacy_phase:ai_scan_metadata->>phase';

  it('reads the page from the view without ai_scan_metadata and the readings of its ids from the many-reader', async () => {
    transport.fetch
      .mockResolvedValueOnce(response([photo(0), photo(1), photo(2)], 3))
      .mockResolvedValueOnce(response([
        { image_id: 'image-0', ai_byok_scene: 'engine_bay', ai_legacy_phase: 'paint' },
        { image_id: 'image-2', ai_byok_scene: null, ai_legacy_phase: 'teardown' },
      ]));

    const rows = await fetchVehicleImages<Row>(vehicleId, SELECT, { includeMismatchFilter: true });

    expect(transport.fetch).toHaveBeenCalledTimes(2);
    const [page, readings] = requests();
    expectCanonicalAdmission(page);
    expect(page.searchParams.get('select')).toBe('id,image_url');
    expect(page.searchParams.get('order')).toBe('is_primary.desc,position.asc.nullslast,created_at.asc');
    expect(readings.pathname).toBe(SCAN_READER);
    expect(transport.fetch.mock.calls[1][1]?.method).toBe('POST');
    expect(bodyOf(1)).toEqual({ p_image_ids: ['image-0', 'image-1', 'image-2'] });
    expect(readings.searchParams.get('select'))
      .toBe('image_id,ai_byok_scene:ai_scan_metadata->byok_deep_analysis->>scene_type,ai_legacy_phase:ai_scan_metadata->>phase');
    // Page order kept; a row the reader withholds carries null readings, never another row's.
    expect(rows.map(row => [row.id, row.ai_byok_scene, row.ai_legacy_phase])).toEqual([
      ['image-0', 'engine_bay', 'paint'], ['image-1', null, null], ['image-2', null, 'teardown'],
    ]);
    expect(rows[0].image_url).toBe(photo(0).image_url);
    expect(rows[0]).not.toHaveProperty('image_id');
  });

  it('reads each page\'s readings for that page only', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, index) => photo(from + index));
    transport.fetch.mockImplementation(async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname === SCAN_READER) return response([]);
      const offset = Number(url.searchParams.get('offset'));
      return offset === 0 ? response(page(0, 1000), 1400) : response(page(1000, 400), 1400);
    });

    const rows = await fetchVehicleImages<Row>(vehicleId, SELECT);

    expect(rows).toHaveLength(1400);
    const readerCalls = transport.fetch.mock.calls.map((call, index) => [new URL(String(call[0])).pathname, index] as const)
      .filter(([path]) => path === SCAN_READER).map(([, index]) => bodyOf(index).p_image_ids as string[]);
    expect(readerCalls.map(ids => ids.length).sort()).toEqual([1000, 400]);
    expect(new Set(readerCalls.flat()).size).toBe(1400);
  });

  it('joins on id and returns the rows without it when the caller did not ask for id', async () => {
    transport.fetch.mockResolvedValueOnce(response([{ id: 'image-7', image_url: 'https://images.example/7.jpg' }], 1))
      .mockResolvedValueOnce(response([{ image_id: 'image-7', ai_legacy_phase: 'paint' }]));

    const rows = await fetchVehicleImages<Row>(vehicleId, 'image_url, ai_legacy_phase:ai_scan_metadata->>phase');

    expect(requests()[0].searchParams.get('select')).toBe('id,image_url');
    expect(rows).toEqual([{ image_url: 'https://images.example/7.jpg', ai_legacy_phase: 'paint' }]);
  });

  it('fails the read when the readings fail, instead of showing rows without them', async () => {
    transport.fetch.mockResolvedValueOnce(response([photo(0)], 1)).mockResolvedValueOnce(new Response(
      JSON.stringify({ code: '54000', message: 'too many photo ids' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));

    await expect(fetchVehicleImages(vehicleId, SELECT)).rejects.toMatchObject({ code: '54000' });
  });

  it('makes no reader call for a page with no rows or a select without the reading', async () => {
    transport.fetch.mockResolvedValueOnce(response([], 0)).mockResolvedValueOnce(response([photo(0)], 1));
    expect(await fetchVehicleImages(vehicleId, SELECT, { maxRows: 5 })).toEqual([]);
    await fetchVehicleImages(vehicleId, 'id, image_url', { maxRows: 5 });
    expect(requests().map(url => url.pathname)).toEqual(['/rest/v1/vehicle_images_public', '/rest/v1/vehicle_images_public']);
  });

  it('signed in: keeps the read on the table, one request, the reading in its select', async () => {
    const session = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'fixture', user: { id: 'viewer-fixture' } } }, error: null } as never);
    // A fixed viewer for the read: the client's own INITIAL_SESSION event would report no session.
    const events = vi.spyOn(supabase.auth, 'onAuthStateChange').mockReturnValue({ data: { subscription: { unsubscribe() {} } } } as never);
    try {
      transport.fetch.mockResolvedValueOnce(response([photo(0)], 1));
      await fetchVehicleImages(vehicleId, SELECT, { maxRows: 7 });
      expect(transport.fetch).toHaveBeenCalledTimes(1);
      expect(requests()[0].pathname).toBe('/rest/v1/vehicle_images');
      expect(requests()[0].searchParams.get('select')).toContain('ai_scan_metadata->byok_deep_analysis->>scene_type');
    } finally { session.mockRestore(); events.mockRestore(); }
  });

  it('evidence inventory: page without the reading, then the readings of the 500 it kept', async () => {
    transport.fetch.mockResolvedValueOnce(response([photo(0), photo(1)], 2))
      .mockResolvedValueOnce(response([{ image_id: 'image-1', ai_byok_narrative: 'Fresh paint', ai_byok_components: ['hood'], ai_byok_scene: 'exterior' }]));
    const query = useVehicleImageEvidence(vehicleId, 'vin') as unknown as {
      queryFn: (context: { signal: AbortSignal }) => Promise<{ images: Row[]; total: number; complete: boolean }>;
    };

    const inventory = await query.queryFn({ signal: new AbortController().signal });

    const [page, readings] = requests();
    expectCanonicalAdmission(page);
    expect(page.searchParams.get('select')).not.toContain('ai_scan_metadata');
    expect(page.searchParams.get('limit')).toBe('500');
    expect(readings.pathname).toBe(SCAN_READER);
    expect(bodyOf(1)).toEqual({ p_image_ids: ['image-0', 'image-1'] });
    expect(inventory.images.map(image => [image.id, image.ai_byok_narrative, image.ai_byok_components, image.ai_byok_scene])).toEqual([
      ['image-0', null, null, null], ['image-1', 'Fresh paint', ['hood'], 'exterior'],
    ]);
    expect(inventory.complete).toBe(true);
  });

  it('evidence drill that filters on the reading stays one read with the reading in its filter', async () => {
    transport.fetch.mockResolvedValueOnce(response([photo(0)], 1));
    const query = useVehicleImageEvidence(vehicleId, 'transmission') as unknown as {
      queryFn: (context: { signal: AbortSignal }) => Promise<{ images: Row[] }>;
    };

    await query.queryFn({ signal: new AbortController().signal });

    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(requests()[0].searchParams.get('select')).toContain('ai_byok_narrative:ai_scan_metadata->byok_deep_analysis->>narrative_one_line');
    expect(requests()[0].searchParams.getAll('or').join(',')).toContain('ai_scan_metadata->byok_deep_analysis->>narrative_one_line.ilike');
  });
});
