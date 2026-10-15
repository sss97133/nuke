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

Deno.test('a leading year range names the car by its first year and keeps the range', () => {
  const a = parseTitle('1965/2016 Shelby Cobra 427 FIA Competition by Burgol Chassis no. CSX3120 (see text)');
  equal([a.year, a.make, a.model, a.year_range, a.chassis], [1965, 'Shelby', 'Cobra 427 FIA Competition by Burgol', '1965-2016', 'CSX3120']);
  const b = parseTitle('1960-2000 Aston Martin DB4GT Zagato Sanction III Coup\u00e9 Chassis no. DB4/424/R');
  equal([b.year, b.make, b.year_range], [1960, 'Aston Martin', '1960-2000']);
  const c = parseTitle('1959/1964 AC Ace to Cobra 289 Specification Roadster Chassis no. AEX 141 Engine no. 7C9W');
  equal([c.year, c.make, c.year_range], [1959, 'AC', '1959-1964']);
});

Deno.test('a year that is not first, or a reversed range, is not read as a range', () => {
  equal(parseTitle('2016/1965 Shelby Cobra').year_range, undefined);
});

Deno.test('a claim ahead of the car is kept as a blurb, not read as the make', () => {
  const a = parseTitle('58,000 kms from new,1976 Ferrari 308GTB Vetroresina Coup\u00e9 Chassis no. 18889');
  equal([a.year, a.make, a.blurb, a.chassis], [1976, 'Ferrari', '58,000 kms from new', '18889']);
  const b = parseTitle('1 of only 70 built,1963 Aston Martin DB4 Convertible Chassis no. DB4C/1091/R Engine no. 370/1085');
  equal([b.year, b.make, b.blurb], [1963, 'Aston Martin', '1 of only 70 built']);
});

Deno.test('a two-digit range end is read in the first year\'s century', () => {
  const a = parseTitle("1954-55 Ferrari Tipo 555 'Super Squalo' 2.5-litre Formula 1 Racing Single-Seater Chassis no. 555/1");
  equal([a.year, a.make, a.year_range], [1954, 'Ferrari', '1954-1955']);
});

Deno.test('a title with no year anywhere stays without one', () => {
  equal(parseTitle('1840s Tilley Horsedrawn Manual Fire Pump').year, null);
  equal(parseTitle('The Ferrari factory team, Mille Miglia, Le Mans').year, null);
});

Deno.test('a year at the end of an older catalogue title is the car\'s year', () => {
  const a = parseTitle('Mercedes-Benz 280 SL cabriolet avec hardtop 1969');
  equal([a.year, a.make, a.model], [1969, 'Mercedes-Benz', '280 SL cabriolet avec hardtop']);
  const b = parseTitle("Ford Escort RS Cosworth 'Motorsport' 1994");
  equal([b.year, b.make], [1994, 'Ford']);
  const c = parseTitle('Minerva mod\u00e8le CC 38 HP tourer 1912');
  equal([c.year, c.make], [1912, 'Minerva']);
});

Deno.test('a trailing number that is not a year is left alone', () => {
  equal(parseTitle('A set of 12 spark plugs 7777').year, null);
});
