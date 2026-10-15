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

Deno.test('a headline ahead of the car line is provenance, not the make; the year glued to it is still read', () => {
  const a = parseTitle('The ex-Peter Thornton, Ian Dalglish actively and successfully campaigned,1960 Aston Martin DB4 GT Chassis no. 370/0110/GT (original engine offered with it)');
  equal([a.year, a.make, a.model], [1960, 'Aston Martin', 'DB4 GT']);
  equal(a.blurb, 'The ex-Peter Thornton, Ian Dalglish actively and successfully campaigned');
  const b = parseTitle('Formerly the property of Rudolf Lilljeqvist,1915/1919 Mercedes 22/50hp Open Tourer Chassis no. 17-759 Engine no. 25-546');
  equal([b.year, b.make, b.year_range], [null, 'Mercedes-Benz', '1915-1919']);
  const c = parseTitle('Unrestored survivor, 31,370 miles from new 1963 Maserati 3500 GTi Superleggera Coupe Coachwork by Touring');
  equal([c.year, c.make], [1963, 'Maserati']);
  const d = parseTitle('The Ex-Barry Sheene 1983 Suzuki RG500 XR40 Racing');
  equal([d.year, d.make, d.blurb], [1983, 'Suzuki', 'The Ex-Barry Sheene']);
  const e = parseTitle('Ex-Charles Pozzi 1952 FERRARI 212 EUROPA COUPE Chassis no. 0277EU');
  equal([e.year, e.make], [1952, 'Ferrari']);
});

Deno.test('an out-of-range year is not a year, and a make the list lacks falls back to the comma split', () => {
  equal(parseTitle('1790 Ferrari 365GTB/4 Daytona Chassis no. 16035').year, null);
  const a = parseTitle('Originally the property of Olry Roederer of the champagne house Louis Roderer, Reims,1904 CGV 6¼-Litre Type H1 Four-Cylinder Side-entrance Phaeton');
  equal([a.year, a.make], [1904, 'CGV']);
});

Deno.test('a make is matched on a word boundary and longest first', () => {
  equal(parseTitle('1963 Acura NSX').make, 'Acura');
  equal(parseTitle('1965 Lotus-Ford Type 30').model, 'Ford Type 30');
  equal(parseTitle('1931 Rolls-Royce Phantom II').make, 'Rolls-Royce');
});

Deno.test('an engine size ahead of the make stays with the model', () => {
  const a = parseTitle("The Ex-Giuseppe Campari,1933 2-litre Maserati 4 Cilindri Monoposto Chassis no. 2000");
  equal([a.year, a.make, a.model], [1933, 'Maserati', '2-litre 4 Cilindri Monoposto']);
});

Deno.test('a headline, a year range and a make: the year stays null and the range is kept', () => {
  const a = parseTitle('The Ex-Dan Hagerty,1969-70 Lola-Chevrolet T70GT Mark IIIB Group 4 Racing Coupe Chassis no. SL73/128');
  equal([a.year, a.make, a.year_range], [null, 'Lola', '1969-70']);
  const b = parseTitle('1937/8 Buick Sedan Chassis no. 844198084');
  equal([b.year, b.make, b.year_range], [1937, 'Buick', '1937-1938']);
  const c = parseTitle('Property of a deceased estate,Jaguar D-Type 4.5-Litre Replica Chassis no. 12700');
  equal([c.year, c.make, c.blurb], [null, 'Jaguar', 'Property of a deceased estate']);
});
