// Run: deno test supabase/functions/batch-extract-snapshots/writeRules.test.ts
import { admitSnapshotObservation, isUniqueViolation, salePriceWritable } from './writeRules.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('a price is written only to a vehicle that says it sold (guard_vehicle_sale_price)', () => {
  equal(salePriceWritable({ sale_status: 'sold', auction_outcome: null }), true);
  equal(salePriceWritable({ sale_status: 'available', auction_outcome: 'sold' }), true);
  // the statuses measured on the live Barrett-Jackson queue: 64 'available', 1 'available' with outcome no_sale
  equal(salePriceWritable({ sale_status: 'available', auction_outcome: null }), false);
  equal(salePriceWritable({ sale_status: 'available', auction_outcome: 'no_sale' }), false);
  for (const s of ['for_sale', 'ended', 'unsold', 'not_sold', 'upcoming', 'pending', 'discovered', null, undefined]) {
    equal(salePriceWritable({ sale_status: s as string | null | undefined, auction_outcome: null }), false, String(s));
  }
  equal(salePriceWritable({}), false);
});

Deno.test('a VIN already on another vehicle is a unique violation, as PostgREST reports it from the trigger', () => {
  // enforce_vin_uniqueness: errcode unique_violation, message "VIN % already exists on vehicle %"
  equal(isUniqueViolation({ code: '23505', message: 'VIN 1G1YY22G965123456 already exists on vehicle 3b2f7c0e-1111-4222-8333-444455556666' }), true);
  // the native unique index
  equal(isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "vehicles_vin_unique_17char_v2"' }), true);
  equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint "vehicles_vin_unique_17char_v2"' }), true);
  equal(isUniqueViolation({ message: 'VIN 1G1YY22G965123456 already exists on vehicle 3b2f7c0e' }), true);
});

Deno.test('other refusals are not unique violations, so they still fail the row', () => {
  equal(isUniqueViolation({ code: '23514', message: 'vehicles.sale_price = 99000 refused for 3b2f: no sold status (sale_status = \'available\', auction_outcome = <NULL>)' }), false);
  equal(isUniqueViolation({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  equal(isUniqueViolation({ message: 'permission denied for table vehicles' }), false);
  equal(isUniqueViolation(null), false);
  equal(isUniqueViolation(undefined), false);
  equal(isUniqueViolation({}), false);
});

// The rules are only as good as the call sites. index.ts must use them where the row is built and where the update is retried.
Deno.test('index.ts uses the rules: the price check in the fill loop, the unique-violation retry, and the status columns it reads', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  equal((src.match(/salePriceWritable\(vehicle\)/g) ?? []).length, 1, 'price check call sites:');
  equal((src.match(/isUniqueViolation\(uErr\)/g) ?? []).length, 1, 'VIN retry condition:');
  equal(src.includes('uErr?.message?.includes("unique constraint")'), false, 'the old retry test is gone:');
  equal(/const selectFields = `[^`]*\bsale_status\b[^`]*\bauction_outcome\b/.test(src), true, 'selectFields reads sale_status and auction_outcome:');
});

const captureInput = {
  vehicleId: 'vehicle-a', platform: 'barrett-jackson',
  snapshot: { id: 'capture-a', listing_url: 'https://www.barrett-jackson.com/lot/a', fetched_at: '2026-10-14T03:00:00Z' },
  fields: { year: 1970, make: 'Chevrolet', transmission: '4-speed manual' },
  method: 'snapshot_regex_parse', version: 'batch-extract-snapshots:2.0.1',
};

function admissionDb(options: { duplicate?: boolean; reply?: any; change?: (row: any) => any } = {}) {
  const calls: any[] = [];
  let stored: any;
  return {
    calls,
    functions: { invoke(name: string, { body }: any) {
      calls.push({ name, body });
      stored = { id: 'observation-a', vehicle_id: body.vehicle_id, kind: body.kind,
        source: { slug: body.source_slug }, source_url: body.source_url,
        observed_at: '2026-10-14T03:00:00+00:00', raw_source_ref: body.raw_source_ref,
        // PostgreSQL jsonb does not preserve object-key order.
        structured_data: Object.fromEntries(Object.entries(body.structured_data).reverse()),
        extraction_method: body.extraction_method, analysis_deferred: body.defer_analysis, is_superseded: false };
      return Promise.resolve(options.reply ?? { data: { success: true, observation_id: stored.id, duplicate: options.duplicate }, error: null });
    } },
    from(table: string) {
      equal(table, 'vehicle_observations');
      return { select(_columns: string) { return { eq(_column: string, id: string) {
        equal(id, 'observation-a');
        return { maybeSingle: () => Promise.resolve({ data: options.change ? options.change(stored) : stored, error: null }) };
      } }; } };
    },
  };
}

Deno.test('snapshot reading reaches canonical listing intake with its original capture clock and no analysis wake', async () => {
  const db = admissionDb();
  equal(await admitSnapshotObservation(db, captureInput), { observationId: 'observation-a', duplicate: false });
  equal(db.calls[0].name, 'ingest-observation');
  const body = db.calls[0].body;
  equal([body.source_slug, body.kind, body.observed_at, body.raw_source_ref, body.defer_analysis],
    ['barrett-jackson', 'listing', captureInput.snapshot.fetched_at, 'listing_page_snapshots:capture-a', true]);
  equal(body.structured_data, captureInput.fields);
  equal(body.agent_inferred, false);
});

Deno.test('C&B snapshot storage spelling resolves to its registered source on canonical intake', async () => {
  const db = admissionDb({ duplicate: true });
  equal(await admitSnapshotObservation(db, { ...captureInput, platform: 'carsandbids' }),
    { observationId: 'observation-a', duplicate: true });
  equal(db.calls[0].body.source_slug, 'cars-and-bids');
});

Deno.test('AI readings retain inferred qualification and exact sub-millisecond capture clocks', async () => {
  const db = admissionDb({ change: row => ({ ...row, observed_at: '2026-10-14T03:00:00.123455+00:00' }) });
  let refused = false;
  try { await admitSnapshotObservation(db, { ...captureInput, method: 'snapshot_ai_parse',
    snapshot: { ...captureInput.snapshot, fetched_at: '2026-10-14T03:00:00.123456Z' } }); }
  catch (error) { refused = String(error).includes('readback'); }
  equal(refused, true);
  equal(db.calls[0].body.agent_inferred, true);
});

Deno.test('an HTTP success or duplicate reply cannot hide missing, misattributed, changed or superseded testimony', async () => {
  const changes = [
    () => null,
    (row: any) => ({ ...row, vehicle_id: 'vehicle-b' }),
    (row: any) => ({ ...row, source: { slug: 'mecum' } }),
    (row: any) => ({ ...row, raw_source_ref: 'listing_page_snapshots:capture-b' }),
    (row: any) => ({ ...row, observed_at: '2026-10-30T00:00:00Z' }),
    (row: any) => ({ ...row, structured_data: { ...row.structured_data, year: 1971 } }),
    (row: any) => ({ ...row, analysis_deferred: false }),
    (row: any) => ({ ...row, is_superseded: true }),
  ];
  for (const change of changes) {
    let refused = false;
    try { await admitSnapshotObservation(admissionDb({ duplicate: true, change }), captureInput); }
    catch (error) { refused = String(error).includes('readback'); }
    equal(refused, true);
  }
});

Deno.test('refused admission and an unknown capture clock stop before a successful receipt', async () => {
  for (const reply of [{ data: { success: false, error: 'unsupported kind' } },
    { error: { message: 'intake unavailable' } }, { data: { success: true } }]) {
    let refused = false;
    try { await admitSnapshotObservation(admissionDb({ reply }), captureInput); }
    catch (error) { refused = String(error).includes('admission failed'); }
    equal(refused, true);
  }
  const db = admissionDb();
  try { await admitSnapshotObservation(db, { ...captureInput, snapshot: { ...captureInput.snapshot, fetched_at: '' } }); }
  catch { /* missing clocks must never become the time of parsing */ }
  equal(db.calls.length, 0);
});
