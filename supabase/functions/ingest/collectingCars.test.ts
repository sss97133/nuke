import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { collectingCarsCapture, collectingCarsOwner, landCollectingCarsCapture } from './collectingCars.ts';

const url = 'https://collectingcars.com/for-sale/1965-example-4';
const fields: any = { listing_id: '90001', url, year: 1965, make: 'Porsche', model: '911', vin: '301999', lot_type: 'car',
  country: 'GB', description: 'Source description', price_amount: 17250, currency: 'GBP', price_kind: 'current_bid',
  image_urls: Array.from({ length: 266 }, (_, i) => `https://images.collectingcars.com/fixture/${i}.jpg`) };
const capture = { snapshot_id: '11111111-1111-4111-8111-111111111111', sha256: 'a'.repeat(64), observed_at: '2026-01-01T00:00:00Z', source_url: url };
Deno.test('CC capture requires durable exact-source receipt; never accepts summary-only extraction', () => {
  assertEquals(collectingCarsCapture({ success: true, extracted: fields, source_capture: capture }, url).fields.country, 'GB');
  for (const bad of [{}, { ...capture, source_url: url + '-other' }, { ...capture, sha256: 'x' }, { ...capture, observed_at: '2099-01-01' }]) {
    assertThrows(() => collectingCarsCapture({ success: true, extracted: fields, source_capture: bad }, url));
  }
});
Deno.test('CC exact presentation wins over short chassis matching; competing or conflicting owners refuse', () => {
  const row = { id: 'vehicle', listing_url: url, year: 1965, make: 'Porsche', vin: null };
  assertEquals(collectingCarsOwner([row], fields), 'vehicle');
  assertEquals(collectingCarsOwner([], fields), null);
  for (const rows of [[row, row], [{ ...row, vin: 'different' }], [{ ...row, make: 'Ford' }], [{ ...row, merged_into_vehicle_id: 'other' }]]) {
    assertThrows(() => collectingCarsOwner(rows, fields));
  }
});
function fixture(options: Record<string, any> = {}) {
  const calls: any[] = []; let observation: any; let country = options.country ?? 'USA';
  const db = createClient('https://fixture.invalid', 'synthetic', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init = {}) => {
    const u = new URL(String(input)), method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: u.pathname, method, body, search: u.search });
    if (u.pathname === '/rest/v1/vehicles') {
      if (method === 'PATCH') { country = body.country; return Response.json([{ id: 'vehicle' }]); }
      return Response.json({ id: 'vehicle', listing_url: url, country, origin_metadata: { country: options.boardCountry ?? 'GB' } });
    }
    if (u.pathname === '/functions/v1/ingest-observation') {
      if (options.admissionFailure) return Response.json({ success: false });
      const duplicate = !!observation;
      observation = { id: 'observation', vehicle_id: body.vehicle_id, source_url: body.source_url, raw_source_ref: body.raw_source_ref };
      return Response.json({ success: true, observation_id: 'observation', duplicate });
    }
    if (u.pathname === '/rest/v1/vehicle_observations') return Response.json(options.badRead ? { ...observation, vehicle_id: 'other' } : observation);
    if (u.pathname === '/rest/v1/vehicle_images') {
      const selected = fields.image_urls.filter((image_url: string) => decodeURIComponent(u.search).includes(image_url));
      assertEquals(selected.length <= 80, true);
      return Response.json(selected.filter((_: any, i: number) => !options.missingPhoto || i !== 0).map((image_url: string) => ({ image_url })));
    }
    throw Error('Unexpected request ' + u);
  } } });
  return { db, calls, country: () => country };
}
Deno.test('CC full listing preserves native currency, capture clock and all 266 gallery URLs, then replays idempotently', async () => {
  const f = fixture(), c = collectingCarsCapture({ success: true, extracted: fields, source_capture: capture }, url);
  const r = await landCollectingCarsCapture(f.db, c, 'vehicle');
  assertEquals(r.images, 266); assertEquals(f.country(), 'GB');
  const p = f.calls.find(c => c.path === '/functions/v1/ingest-observation').body;
  assertEquals(p.observed_at, capture.observed_at);
  assertEquals(p.structured_data.currency, 'GBP'); assertEquals(p.structured_data.price_kind, 'current_bid');
  assertEquals(p.extraction_metadata.prior_vehicle_country, 'USA');
  assertEquals((await landCollectingCarsCapture(f.db, c, 'vehicle')).duplicate, true);
});
for (const option of ['admissionFailure', 'badRead', 'missingPhoto']) Deno.test(`CC ${option} cannot report successful full-listing ingestion`, async () => {
  const f = fixture({ [option]: true });
  await assertRejects(() => landCollectingCarsCapture(f.db, { ...capture, fields }, 'vehicle'));
});
Deno.test('CC country disagreement or existing specific country is retained without overwrite', async () => {
  for (const options of [{ boardCountry: 'FR' }, { country: 'DE' }]) {
    const f = fixture(options); await landCollectingCarsCapture(f.db, { ...capture, fields }, 'vehicle');
    assertEquals(f.calls.some(c => c.method === 'PATCH'), false);
  }
});
