// Actual ingest handler and SDK; only extractor/HTTP persistence boundaries are synthetic.
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
const base = 'https://fixture.supabase.test', key = 'sb_secret_cc_handler_fixture';
Deno.env.set('SUPABASE_URL', base);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', key);
Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: key }));
const defaultUrl = 'https://collectingcars.com/for-sale/1965-porsche-911-fixture';
let url = defaultUrl;
const id = '11111111-1111-4111-8111-111111111111';
const snapshot = '22222222-2222-4222-8222-222222222222';
const observationId = '33333333-3333-4333-8333-333333333333';
const clock = '2026-01-01T00:00:00.000Z';
const images = Array.from({ length: 266 }, (_, i) => `https://images.collectingcars.com/fixture/${i}.jpg`);
const defaultFields = { listing_id: '90001', url, listing_url: url, title: '1965 Porsche 911', year: 1965, make: 'Porsche', model: '911',
  vin: '301999', lot_type: 'car', country: 'GB', description: 'Original full seller prose. '.repeat(60),
  price_amount: 17250, price_kind: 'current_bid', currency: 'GBP', bid_count: 8, image_urls: images };
let fields: Omit<typeof defaultFields, 'model'> & { model: string | null } = { ...defaultFields };
let vehicle: Record<string, any>, gallery: any[], observation: any, seen: any[], failure: string;
function reset(mode = '') {
  url = defaultUrl; fields = { ...defaultFields };
  vehicle = { id, listing_url: url, year: 1965, make: 'Porsche', model: '911', vin: null, country: 'USA',
    origin_metadata: { country: 'GB' }, deleted_at: null, merged_into_vehicle_id: null, status: 'active' };
  gallery = []; observation = null; seen = []; failure = mode;
}
reset();
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init), u = new URL(req.url), read = ['GET', 'HEAD'].includes(req.method);
  assertEquals(u.origin, base, 'No publisher or paid-service requests');
  const body = read ? null : JSON.parse(await req.text());
  seen.push({ path: u.pathname, method: req.method, body, search: u.search });
  const object = req.headers.get('accept')?.includes('vnd.pgrst.object');
  if (u.pathname.startsWith('/auth/')) return Response.json({ message: 'synthetic service key has no user' }, { status: 401 });
  if (u.pathname === '/functions/v1/extract-collecting-cars') {
    assertEquals(body.url, url);
    if (failure.startsWith('noncar')) return Response.json({ success: false, skipped: true,
      skip_reason: `Collecting Cars lot type ${fields.lot_type}`, extracted: { listing_id: fields.listing_id, lot_type: fields.lot_type, url },
      ...(failure === 'noncar-no-capture' ? {} : { source_capture: { snapshot_id: snapshot,
        sha256: failure === 'noncar-bad-hash' ? 'invalid' : 'a'.repeat(64), observed_at: clock,
        source_url: failure === 'noncar-wrong-url' ? url + '-other' : url } }) });

    if (body.cc_snapshot) {
      assertEquals(body.cc_snapshot, { snapshot_id: snapshot, expected_sha256: 'a'.repeat(64) });
      return Response.json({ success: true, extracted: { ...fields, stage: failure === 'live-replay' ? 'live' : 'unsold' },
        source_capture: { snapshot_id: failure === 'wrong-replay' ? observationId : snapshot, sha256: 'a'.repeat(64), observed_at: clock, source_url: url },
        replay: { kind: 'pinned_closed_listing' } });
    }
    return Response.json(failure === 'capture' ? { success: true, extracted: fields } : { success: true, extracted: fields,
      source_capture: { snapshot_id: snapshot, sha256: 'a'.repeat(64), observed_at: clock, source_url: url } });
  }
  if (u.pathname === '/functions/v1/ingest-observation') {
    assertEquals(body.kind, 'listing', 'A listing capture must not fabricate eight individual bids');
    if (failure === 'admission') return Response.json({ success: false });
    const duplicate = !!observation;
    observation = { ...body, id: observationId, is_superseded: false };
    return Response.json({ success: true, observation_id: observationId, duplicate });
  }
  if (u.pathname === '/rest/v1/vehicles') {
    if (read) {
      assert(!u.searchParams.has('vin'), 'Exact current URL owner must win before six-character chassis lookup');
      if (failure === 'foreign-vin' && !u.searchParams.has('id')) return Response.json([]);
      if (u.searchParams.has('listing_url')) {
        const ownerReads = seen.filter(x => x.path === '/rest/v1/vehicles' && x.method === 'GET' && x.search.includes('listing_url=eq.')).length;
        if (failure === 'no-owner' || (failure === 'owner-disappeared' && ownerReads > 1)) return Response.json([]);
        if (failure === 'ambiguous-owner') return Response.json([vehicle, { ...vehicle, id: snapshot }]);
      }
      return Response.json(object ? vehicle : [vehicle]);
    }
    if (failure === 'foreign-vin' && req.method === 'POST') {
      vehicle = { ...body, id, country: null, origin_metadata: {}, deleted_at: null, merged_into_vehicle_id: null };
      return Response.json(object ? vehicle : [vehicle]);
    }
    assertEquals(req.method, 'PATCH', 'Existing current presentation must not fork');
    vehicle = { ...vehicle, ...body };
    return Response.json(object ? vehicle : [vehicle]);
  }
  if (u.pathname === '/rest/v1/vehicle_images') {
    if (!read) {
      assertEquals(req.method, 'POST');
      if (failure === 'gallery') return Response.json({ message: 'synthetic image failure' }, { status: 500 });
      gallery.push(...body.map((r: any, i: number) => ({ ...r, id: String(gallery.length + i) })));
      return Response.json(gallery);
    }
    const filter = u.searchParams.get('image_url');
    return Response.json(filter ? gallery.filter(r => filter.includes(r.image_url)) : gallery);
  }
  if (u.pathname === '/rest/v1/vehicle_observations' && read) return Response.json(observation);
  throw Error(`Unexpected handler request ${req.method} ${u.pathname}`);
};
let handler: (request: Request) => Response | Promise<Response>;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; return { finished: Promise.resolve() }; };
await import('./index.ts');
async function run(extra: Record<string, unknown> = {}) {
  const response = await handler(new Request(base + '/functions/v1/ingest', { method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ url, ...extra }) }));
  return await response.json();
}
Deno.test('actual CC ingest routes deterministic capture, inserts all266 photos and reads them back without fabricating bids', async () => {
  reset(); const r = await run();
  assertEquals(r.status, 'matched'); assertEquals(r.vehicle_id, id); assertEquals(r.source, 'collecting_cars');
  assertEquals(r.collecting_cars_receipt.images, 266);
  assertEquals(gallery.length, 266); assertEquals(new Set(gallery.map(r => r.image_url)).size, 266);
  assertEquals(vehicle.description, fields.description); assertEquals(vehicle.vin, fields.vin); assertEquals(vehicle.country, 'GB');
  assertEquals(observation.observed_at, clock); assertEquals(observation.raw_source_ref, `listing_page_snapshots:${snapshot}`);
  assertEquals(observation.structured_data.currency, 'GBP'); assertEquals(observation.structured_data.bid_count, 8);
  assertEquals(vehicle.asking_price, undefined); assertEquals(vehicle.high_bid, undefined);
  const again = await run(); assertEquals(again.status, 'matched'); assertEquals(again.collecting_cars_receipt.duplicate, true);
  assertEquals(gallery.length, 266, 'Replay must not duplicate photos');
  assertEquals(seen.filter(x => x.path === '/rest/v1/vehicle_images' && x.method === 'POST').length, 1);
  assertEquals(seen.filter(x => x.path.includes('auction_events') || x.path.includes('vehicle_events')).length, 0);
});

Deno.test('new CC presentation never reads or enriches a foreign deleted VIN alias before admission', async () => {
  reset('foreign-vin');
  fields = { ...fields, year: 1982, make: 'Land Rover', model: 'Series III', vin: 'SALLBCAV2AA102505',
    title: '1982 Land Rover Series III', listing_id: '78' };
  const foreign = { id: snapshot, vin: fields.vin, year: 1986, listing_url: 'conceptcarz://foreign',
    deleted_at: '2026-03-10T05:03:39Z', status: 'inactive' };
  vehicle = { ...foreign };
  const r = await run();
  assertEquals(r.status, 'created'); assertEquals(r.vehicle_id, id);
  assertEquals(vehicle.listing_url, url); assertEquals(vehicle.vin, fields.vin);
  assertEquals(observation.vehicle_id, id); assertEquals(gallery.length, 266);
  assertEquals(seen.some(x => /(?:vin=|marketplace_listings|vehicle_events)/.test(x.search + x.path)), false);
  assertEquals(seen.some(x => x.method === 'PATCH' && x.search.includes(snapshot)), false);
  assertEquals(gallery.every(row => row.vehicle_id === id), true);
  assertEquals(foreign.deleted_at, '2026-03-10T05:03:39Z');
});

for (const conflict of ['deleted', 'merged', 'native-id', 'vin', 'year']) {
  Deno.test(`CC exact URL ${conflict} conflict refuses before any enrichment`, async () => {
    reset();
    if (conflict === 'deleted') vehicle.deleted_at = clock;
    if (conflict === 'merged') vehicle.merged_into_vehicle_id = snapshot;
    if (conflict === 'native-id') vehicle.origin_metadata.auction_id = 'other';
    if (conflict === 'vin') vehicle.vin = 'DIFFERENT';
    if (conflict === 'year') vehicle.year = 1986;
    const r = await run(); assertEquals(r.status, 'error');
    assertEquals(seen.some(x => x.path.startsWith('/rest/') && !['GET', 'HEAD'].includes(x.method)), false);
    assertEquals(gallery.length, 0); assertEquals(observation, null);
  });
}
for (const mode of ['capture', 'admission', 'gallery']) Deno.test(`actual CC handler ${mode} failure cannot report complete capture`, async () => {
  reset(mode); const r = await run(); assertEquals(r.status, 'error'); assertEquals(r.collecting_cars_receipt, undefined);
  if (mode === 'capture') assertEquals(seen.filter(x => x.method !== 'GET' && x.path.startsWith('/rest/')).length, 0);
});

const ccPin = { snapshot_id: snapshot, expected_sha256: 'a'.repeat(64) };
Deno.test('actual historical ingest forwards pin and retains full gallery/canonical old-clock receipt', async () => {
  reset(); const r = await run({ cc_snapshot: ccPin }); assertEquals(r.status, 'matched');
  assertEquals(r.collecting_cars_receipt.images, 266); assertEquals(observation.observed_at, clock);
  assertEquals(observation.structured_data.stage, 'unsold');
  assertEquals(seen.filter(x => x.path === '/functions/v1/extract-collecting-cars').length, 1);
});
for (const mode of ['no-owner', 'ambiguous-owner', 'wrong-replay', 'live-replay']) Deno.test(`actual pinned ${mode} refuses without attribution writes`, async () => {
  reset(mode); const r = await run({ cc_snapshot: ccPin }); assertEquals(r.status, 'error');
  assertEquals(gallery.length, 0); assertEquals(observation, null);
  assertEquals(seen.filter(x => x.method === 'PATCH' || (x.method === 'POST' && x.path.startsWith('/rest/'))).length, 0);
});
Deno.test('historical pin cannot mix caller-supplied identity or price', async () => {
  reset(); const r = await run({ cc_snapshot: ccPin, price: 99 }); assertEquals(r.status, 'rejected');
  assertEquals(seen.some(x => x.path.startsWith('/functions/')), false);
});

function blueBird(mode = '') {
  reset(mode);
  url = 'https://collectingcars.com/for-sale/1986-bluebird-wanderlodge-pt38';
  fields = { ...fields, url, listing_url: url, listing_id: '94590', title: '1986 Blue Bird Wanderlodge PT38',
    year: 1986, make: 'Blue Bird', model: null, vin: 'GF0711857',
    image_urls: Array.from({ length: 276 }, (_, i) => `https://images.collectingcars.com/bluebird/${i}.jpg`) };
  vehicle = { ...vehicle, listing_url: url, year: 1986, make: 'Blue Bird', model: null, origin_metadata: { auction_id: '94590', country: 'GB' } };
}
Deno.test('actual CC handler retains known Blue Bird owner with native null model and all276 photos', async () => {
  blueBird(); const r = await run();
  assertEquals(r.status, 'matched'); assertEquals(r.vehicle_id, id);
  assertEquals(r.collecting_cars_receipt.images, 276); assertEquals(gallery.length, 276);
  assertEquals(vehicle.model, null); assertEquals(observation.structured_data.model, null);
  assertEquals(observation.structured_data.title, fields.title); assertEquals(vehicle.vin, 'GF0711857');
  assertEquals(observation.observed_at, clock); assertEquals(observation.raw_source_ref, `listing_page_snapshots:${snapshot}`);
  assertEquals(seen.some(x => x.path === '/rest/v1/vehicles' && x.method === 'POST'), false);
});
for (const mode of ['no-owner', 'ambiguous-owner', 'owner-disappeared', 'foreign-owner']) {
  Deno.test(`native null model cannot create or attach to ${mode}`, async () => {
    blueBird(mode);
    if (mode === 'foreign-owner') vehicle.origin_metadata.auction_id = 'different';
    const r = await run();
    assert(['error', 'rejected'].includes(r.status)); assertEquals(r.collecting_cars_receipt, undefined);
    assertEquals(gallery.length, 0); assertEquals(observation, null);
    assertEquals(seen.some(x => x.path.startsWith('/rest/') && !['GET', 'HEAD'].includes(x.method)), false);
  });
}

for (const lotType of ['plate', 'part', 'bike', 'boat']) Deno.test(`retained native ${lotType} is a structural rejection without vehicle writes`, async () => {
 reset('noncar'); fields.lot_type = lotType;
 const r = await run(); assertEquals(r.status, 'rejected');
 assertEquals(r.reason, `quality_gate_reject: Collecting Cars car intake excludes native lot type ${lotType}`);
 assertEquals(r.collecting_cars_noncar, { snapshot_id: snapshot, sha256: 'a'.repeat(64), observed_at: clock, source_url: url, listing_id: fields.listing_id, lot_type: lotType });
 const { ledgerWriteFor } = await import('../poll-listing-feeds/ledger.ts');
 const write = ledgerWriteFor({url,feedId:id,ingest:r,batch:{rows:new Map(),error:null},now:new Date()});
 assertEquals(write?.status, 'skipped'); assertEquals(write?.row.vehicle_id, null);
 assertEquals(seen.some(x => x.path.startsWith('/rest/') || x.path === '/functions/v1/ingest-observation'), false);
});
for (const mode of ['noncar-no-capture','noncar-bad-hash','noncar-wrong-url']) Deno.test(`unproved native classification ${mode} remains retryable failure`, async () => {
 reset(mode); fields.lot_type = 'plate'; const r=await run();
 assertEquals(r.status,'error'); assertEquals(r.collecting_cars_noncar,undefined);
 assertEquals(seen.some(x=>x.path.startsWith('/rest/')),false);
});
Deno.test('unknown native type and skipped pin cannot become permanent non-car decisions', async () => {
 reset('noncar'); fields.lot_type='unknown'; assertEquals((await run()).status,'error');
 reset('noncar'); fields.lot_type='plate'; assertEquals((await run({cc_snapshot:ccPin})).status,'error');
});
