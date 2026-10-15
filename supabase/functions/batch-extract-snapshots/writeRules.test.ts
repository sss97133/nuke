// Run: deno test supabase/functions/batch-extract-snapshots/writeRules.test.ts
import { isUniqueViolation, salePriceWritable } from './writeRules.ts';

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
