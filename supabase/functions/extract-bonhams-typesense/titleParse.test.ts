// Run: deno test supabase/functions/extract-bonhams-typesense/
import { parseTitle } from './titleParse.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

Deno.test('a dash between the year and the make is not part of the make', () => {
  const p = parseTitle('1970 – Lamborghini Espada SII');
  equal([p.year, p.make, p.model], [1970, 'Lamborghini', 'Espada SII']);
  const q = parseTitle('1963 - Bentley S3');
  equal([q.year, q.make, q.model], [1963, 'Bentley', 'S3']);
});

Deno.test('an ordinary title and its chassis still parse', () => {
  const p = parseTitle('1966 Ferrari 330 GT Chassis no. 8023 Engine no. 8023');
  equal([p.year, p.make, p.model, p.chassis], [1966, 'Ferrari', '330 GT', '8023']);
});

Deno.test('a multi-word make is kept whole', () => {
  const p = parseTitle('1959 Aston Martin DB4 Series II Chassis no. DB4/1234/R');
  equal([p.year, p.make, p.model], [1959, 'Aston Martin', 'DB4 Series II']);
});
