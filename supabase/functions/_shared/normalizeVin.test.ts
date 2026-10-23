// Run: deno test supabase/functions/_shared/normalizeVin.test.ts
// Inputs are real Bonhams chassis fields whose old normalization produced CHASSSN278ENG, 005ENGNE, N660018 and OR82122.
import { normalizeVin } from './normalizeVehicle.ts';

const cases: Array<[string | null, string | null]> = [
  ['Chassis no. NMCL73 Engine no. 37548', 'NMCL73'],
  ['NMCL73 Engine no. 37548', 'NMCL73'],
  ['No. 660018', '660018'],
  ['no. R82122', 'R82122'],
  ['Chassis no. 2383 GT Engine no. 2383 GT', '2383GT'],
  ['Chassis no. 278 Engine no. 278', null],
  ['005 Engine no. 005', null],
  ['chassis no. bs 223 | $57', null],
  ['WP0AA2A97BS106034', 'WP0AA2A97BS106034'],
  ['VIN: 1HGCM82633A004352', '1HGCM82633A004352'],
  ['WP0AA2A97BS1O6034', null],
  ['  1g1yy32g935113601 ', '1G1YY32G935113601'],
  ['AR 1012504', 'AR1012504'],
  ['00000000', null],
  [null, null],
];

for (const [input, expected] of cases) {
  Deno.test(`normalizeVin(${JSON.stringify(input)})`, () => {
    const got = normalizeVin(input);
    if (got !== expected) throw new Error(`expected ${expected}, received ${got}`);
  });
}
