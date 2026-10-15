// Run: deno test supabase/functions/_shared/identityMatch.test.ts
import { fillOnlyIdentity, identityConflict } from './identityMatch.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

// The 50caf39a case: a BaT 1967 Chevrolet custom sport truck against the Barrett-Jackson docket car.
const bat = { year: 1967, make: 'Chevrolet', model: 'Custom Sport Truck', vin: null };
const bj = { year: 1967, make: 'Chevrolet', model: 'Corvette 427/435', vin: '194677S117588' };

Deno.test('a Corvette docket car is not the BaT sport truck', () => {
  equal(identityConflict(bat, bj)?.startsWith('model'), true);
});

Deno.test('a different VIN is a different car, whatever else matches', () => {
  equal(identityConflict({ ...bj, vin: '194677S100001' }, bj)?.startsWith('vin'), true);
});

Deno.test('the same car passes, and missing values never disagree', () => {
  equal(identityConflict(bj, { ...bj }), null);
  equal(identityConflict({ year: 1967, make: 'chevrolet', model: 'corvette', vin: null }, bj), null);
  equal(identityConflict({ year: null, make: null, model: null, vin: null }, bj), null);
  equal(identityConflict(bj, { year: 1968, make: 'Chevrolet', model: 'Corvette Convertible', vin: null }), null);
});

Deno.test('a different make or year is refused', () => {
  equal(identityConflict(bj, { ...bj, make: 'Ford' })?.startsWith('make'), true);
  equal(identityConflict(bj, { ...bj, year: 1972 })?.startsWith('year'), true);
});

Deno.test('identity fields are fill-only; other fields pass', () => {
  equal(fillOnlyIdentity({ year: 1967, make: 'Chevrolet', model: 'Corvette', vin: 'X1234', color: 'red' }, { year: 1967, make: 'Chevrolet', model: null, vin: null }),
    { model: 'Corvette', vin: 'X1234', color: 'red' });
});
