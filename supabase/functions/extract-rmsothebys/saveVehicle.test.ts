// Run: deno test supabase/functions/extract-rmsothebys/
// saveVehicle through a stub PostgREST client and stand-in writers that record what they are asked to do.
import { RM_PLATFORM, saveVehicle, type ExtractedVehicle, type SaveDeps } from './saveVehicle.ts';
import { normalizeSource } from '../_shared/normalizeVehicle.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

type Call = { table: string; op: string; row?: unknown; filters: Array<[string, unknown]> };

/** A chainable stand-in for the PostgREST builder. `answers` gives the result of `table.op`; anything else answers {data:null}. */
function stubClient(answers: Record<string, { data?: unknown; error?: { message: string } | null }> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const answer = () => {
        const a = answers[`${table}.${call.op}`] ?? {};
        return { data: a.data ?? null, error: a.error ?? null };
      };
      const b: any = {
        select() { return b; },
        update(row: unknown) { call.op = 'update'; call.row = row; return b; },
        insert(row: unknown) { call.op = 'insert'; call.row = row; return b; },
        eq(col: string, val: unknown) { call.filters.push([col, val]); return b; },
        in(col: string, val: unknown) { call.filters.push([col, val]); return b; },
        is(col: string, val: unknown) { call.filters.push([col, val]); return b; },
        limit() { return b; },
        maybeSingle() { return Promise.resolve(answer()); },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(answer()).then(resolve); },
      };
      return b;
    },
  };
  return { client, calls };
}

function deps(opts: { resolved?: string | null; episode?: string } = {}) {
  const observations: any[] = [];
  const events: any[] = [];
  const resolverCalls: any[] = [];
  const d: SaveDeps = {
    resolveExisting: async (_s, options) => { resolverCalls.push(options); return { vehicleId: opts.resolved ?? null }; },
    writeObservation: async (_s, input) => { observations.push(input); return {}; },
    writeEvent: async (_s, row) => { events.push(row); return { action: opts.episode ?? 'inserted' }; },
  };
  return { d, observations, events, resolverCalls };
}

const URL_SLASH = 'https://rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark/';
const URL_BARE = 'https://rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark';

function lot(over: Partial<ExtractedVehicle> = {}): ExtractedVehicle {
  return {
    url: URL_SLASH, title: '1954 Buick Skylark', year: 1954, make: 'buick', model: 'skylark', lot_number: '7',
    auction_name: 'The Monterey Auction 2026', auction_code: 'MO26', estimate_text: null, sold_price: 100800,
    sold_price_text: '$100,800 USD', currency: 'USD', sold: true, is_still_for_sale: false, image_url: 'https://cdn.example/x.webp',
    rms_lot_id: 'a', rms_auction_id: 'b', bidding_type: 'Live', collection: null, category_id: 1, auctioned: true,
    ...over,
  };
}

Deno.test('a lot that is not a vehicle is refused before anything is read or written', async () => {
  const { client, calls } = stubClient();
  const { d, observations, events } = deps();
  const res = await saveVehicle(client, lot({ title: '2026 Lando Norris McLaren Formula 1 Signed Bell Helmet', category_id: 2 }), d);
  equal(res, { skipped: 'automobilia' });
  equal(calls.length, 0);
  equal([observations.length, events.length], [0, 0]);
});

Deno.test('a new lot: vehicle, image and episode are written, the sale is dated from the auction table, one timeline row', async () => {
  const { client, calls } = stubClient({ 'vehicles.insert': { data: { id: 'v-new' } } });
  const { d, events, observations } = deps();
  const res = await saveVehicle(client, lot(), d);
  equal(res, { vehicleId: 'v-new', isNew: true });
  const insert = calls.find((c) => c.table === 'vehicles' && c.op === 'insert')!.row as Record<string, unknown>;
  equal([insert.year, insert.make, insert.sale_status, insert.listing_url], [1954, 'Buick', 'sold', URL_SLASH]);
  equal(calls.some((c) => c.table === 'vehicle_images' && c.op === 'insert'), true);
  equal(events.length, 1);
  equal([events[0].vehicle_id, events[0].event_status, events[0].sold_at, events[0].final_price],
    ['v-new', 'sold', '2026-08-13T12:00:00.000Z', 100800]);
  const timeline = calls.filter((c) => c.table === 'timeline_events' && c.op === 'insert');
  equal(timeline.length, 1);
  equal((timeline[0].row as Record<string, unknown>).event_date, '2026-08-13');
  equal(observations[0].observationKind, 'sale_result');
});

Deno.test('a vehicle a listing feed wrote (listing_url only, no discovery_url, no episode) is found, not written twice', async () => {
  const { client, calls } = stubClient({ 'vehicles.select': { data: { id: 'v-feed' } } });
  const { d, events } = deps({ resolved: null, episode: 'inserted' });
  const res = await saveVehicle(client, lot(), d);
  equal(res, { vehicleId: 'v-feed', isNew: false });
  equal(calls.some((c) => c.table === 'vehicles' && c.op === 'insert'), false, 'no second vehicle:');
  const lookup = calls.find((c) => c.table === 'vehicles' && c.op === 'select')!;
  equal(lookup.filters[0], ['listing_url', [URL_SLASH, URL_BARE]]);
  equal(lookup.filters[1], ['deleted_at', null]);
  const update = calls.find((c) => c.table === 'vehicles' && c.op === 'update')!;
  equal(update.filters, [['id', 'v-feed']]);
  equal((update.row as Record<string, unknown>).sale_status, 'sold');
  // it had no episode, so it gets one, and its sale is recorded on the timeline once
  equal(events.length, 1);
  equal(events[0].vehicle_id, 'v-feed');
  equal(calls.filter((c) => c.table === 'timeline_events').length, 1);
});

Deno.test('a vehicle the resolver finds by its episode is updated, its episode refreshed, and the sale is not put on the timeline again', async () => {
  const { client, calls } = stubClient();
  const { d, events } = deps({ resolved: 'v-known', episode: 'updated' });
  const res = await saveVehicle(client, lot(), d);
  equal(res, { vehicleId: 'v-known', isNew: false });
  equal(calls.some((c) => c.table === 'vehicles' && c.op === 'select'), false, 'the resolver answered; no second lookup:');
  equal(events.length, 1);
  equal(calls.some((c) => c.table === 'timeline_events'), false);
});

Deno.test('an upcoming lot is upcoming / pending, undated, a listing observation, and has no timeline row', async () => {
  const { client, calls } = stubClient({ 'vehicles.insert': { data: { id: 'v-up' } } });
  const { d, events, observations } = deps();
  const upcoming = lot({
    url: 'https://rmsothebys.com/auctions/lf26/lots/r0002-1899-locomobile/', title: '1899 Locomobile Type 1 Runabout',
    year: 1899, make: 'locomobile', model: 'type 1 runabout', auction_code: 'LF26', auction_name: 'The London Auction 2026',
    sold: false, auctioned: false, sold_price: null, sold_price_text: null, estimate_text: '£100,000 - £150,000 GBP',
  });
  await saveVehicle(client, upcoming, d);
  const insert = calls.find((c) => c.table === 'vehicles' && c.op === 'insert')!.row as Record<string, unknown>;
  equal([insert.sale_status, insert.sale_price], ['upcoming', null]);
  equal([events[0].event_status, events[0].sold_at], ['pending', null]);
  equal(observations[0].observationKind, 'listing');
  equal(calls.some((c) => c.table === 'timeline_events'), false);
});

Deno.test('after the sale the same lot, re-read, becomes sold: status, price, event and sale day follow', async () => {
  const { client, calls } = stubClient();
  const { d, events, observations } = deps({ resolved: 'v-up', episode: 'updated' });
  const sold = lot({
    url: 'https://rmsothebys.com/auctions/lf26/lots/r0002-1899-locomobile/', title: '1899 Locomobile Type 1 Runabout',
    year: 1899, make: 'locomobile', model: 'type 1 runabout', auction_code: 'LF26', auction_name: 'The London Auction 2026',
    sold: true, auctioned: true, sold_price: 130000,
  });
  await saveVehicle(client, sold, d);
  const update = calls.find((c) => c.table === 'vehicles' && c.op === 'update')!.row as Record<string, unknown>;
  equal([update.sale_status, update.sale_price], ['sold', 130000]);
  equal([events[0].event_status, events[0].sold_at, events[0].final_price], ['sold', '2026-10-31T12:00:00.000Z', 130000]);
  equal(observations[0].observationKind, 'sale_result');
});

Deno.test('an auction code with no known day gets no timeline row: the day of extraction is not the sale day', async () => {
  const { client, calls } = stubClient({ 'vehicles.insert': { data: { id: 'v-x' } } });
  const { d, events } = deps();
  await saveVehicle(client, lot({ auction_code: 'ZZ99' }), d);
  equal(events[0].sold_at, null);
  equal(calls.some((c) => c.table === 'timeline_events'), false);
});

Deno.test('an unsold lot of a held auction stays ended, as before', async () => {
  const { client, calls } = stubClient({ 'vehicles.insert': { data: { id: 'v-un' } } });
  const { d, events } = deps();
  await saveVehicle(client, lot({ sold: false, sold_price: null, sold_price_text: null }), d);
  const insert = calls.find((c) => c.table === 'vehicles' && c.op === 'insert')!.row as Record<string, unknown>;
  equal(insert.sale_status, 'ended');
  equal(events[0].event_status, 'ended');
});

Deno.test('a failed vehicle insert is thrown, not swallowed', async () => {
  const { client } = stubClient({ 'vehicles.insert': { error: { message: 'duplicate key value' } } });
  const { d } = deps();
  let message = '';
  try { await saveVehicle(client, lot(), d); } catch (e) { message = (e as Error).message; }
  equal(message.includes('duplicate key value'), true);
});

Deno.test("RM's events, resolver lookups and observations use the canonical slug 'rm-sothebys', never 'rmsothebys'", async () => {
  equal(RM_PLATFORM, 'rm-sothebys');
  equal(RM_PLATFORM, normalizeSource('rmsothebys'), 'the constant is what the shared normalizer says:');
  const paths: Array<[string, { resolved?: string | null; episode?: string }, Record<string, unknown>]> = [
    ['a new lot', { episode: 'inserted' }, { 'vehicles.insert': { data: { id: 'v-new' } } }],
    ['a vehicle found by its listing_url', { episode: 'inserted' }, { 'vehicles.select': { data: { id: 'v-feed' } } }],
    ['a vehicle the resolver finds by its episode', { resolved: 'v-known', episode: 'updated' }, {}],
  ];
  for (const [label, opts, answers] of paths) {
    const { client } = stubClient(answers as Record<string, { data?: unknown }>);
    const { d, events, observations, resolverCalls } = deps(opts);
    await saveVehicle(client, lot(), d);
    equal(resolverCalls.map((c) => c.platform), [RM_PLATFORM], `${label}: resolver platform:`);
    equal(events.map((e) => e.source_platform), [RM_PLATFORM], `${label}: event source_platform:`);
    equal(observations.map((o) => o.source.platform), [RM_PLATFORM], `${label}: observation source:`);
  }
});

Deno.test('an upcoming London lot lands the calendar keys and a numeric estimate on its episode', async () => {
  const { client } = stubClient({ 'vehicles.insert': { data: { id: 'v-new' } } });
  const { d, events } = deps();
  await saveVehicle(client, lot({
    url: 'https://rmsothebys.com/auctions/lf26/lots/r0010-1962-jaguar-e-type/', auction_code: 'LF26', auction_name: 'The London Auction 2026',
    sold: false, sold_price: null, sold_price_text: null, is_still_for_sale: true, auctioned: false, currency: 'GBP',
    estimate_text: '£500,000 - £800,000 GBP',
  }), d);
  const e = events[0];
  equal(e.sold_at, null);
  equal(e.ended_at, '2026-10-31T12:00:00.000Z');
  equal([e.metadata.sale_key, e.metadata.sale_starts_on, e.metadata.sale_ends_on, e.metadata.auction_session_days, e.metadata.sale_location],
    ['lf26', '2026-10-31', '2026-10-31', ['2026-10-31'], 'London']);
  equal([e.metadata.estimate_low, e.metadata.estimate_high, e.metadata.estimate_currency, e.metadata.lot_number], [500000, 800000, 'GBP', '7']);
});
