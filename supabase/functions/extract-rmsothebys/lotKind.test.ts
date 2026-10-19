// Run: deno test supabase/functions/extract-rmsothebys/
// The vehicles-only rule on lots read from RM Sotheby's lot search on 2026-10-14: every lot of MO26, MC26, LF26, PA26,
// AZ26, CC26, MI26 and S0226 (642 lots), kept as title, reference id, categoryId and the sold / auctioned flags in
// fixtures/lots_2026-10-14.json. The per-auction expectations below were counted from the API responses with a
// separate script (jq and python), not by running this code.
import { classifyLot, leadsWithYear, partitionLots, titleIdentity } from './lotKind.ts';
import { parseTitle } from './lotTitle.ts';
import { normalizeMake } from '../_shared/normalizeVehicle.ts';
import lots from './fixtures/lots_2026-10-14.json' with { type: 'json' };

type FixtureLot = { a: string; ref: string; cat: number; title: string; sold: boolean; auctioned: boolean };
const FIXTURE = lots as FixtureLot[];

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const verdictFor = (cat: unknown, title: string) => classifyLot({ categoryId: cat, title });

Deno.test('the lots the lead named: a year-led helmet, a bicycle, a luggage set and a badge are not vehicles', () => {
  equal(verdictFor(2, '2026 Lando Norris McLaren Formula 1 Signed Bell Helmet'), { write: false, reason: 'automobilia' });
  equal(verdictFor(2, '1919 Harley-Davidson Motorcyke Model 4-19 Bicycle'), { write: false, reason: 'automobilia' });
  equal(verdictFor(2, 'Ferrari Enzo Three-Piece Luggage Set'), { write: false, reason: 'automobilia' });
  equal(verdictFor(2, '1947 Automovil Club Argentino Badge'), { write: false, reason: 'automobilia' });
  equal(verdictFor(2, '1995 Gerhard Berger Ferrari Race Helmet, Signed'), { write: false, reason: 'automobilia' });
  equal(verdictFor(2, "c. 1965 Ferrari 330 P2 Children's Car by Automobile S.C.A.F."), { write: false, reason: 'automobilia' });
  equal(verdictFor(2, '1987 Ferrari F1/87 Formula 1 Tipo 33 Display Engine'), { write: false, reason: 'automobilia' });
});

Deno.test('cars and motorcycles with a year-led title are written, with the year and make the writer reads', () => {
  equal(verdictFor(1, '1954 Buick Skylark'), { write: true, kind: 'automobile', year: 1954, make: 'Buick' });
  equal(verdictFor(1, '1923 Rolls-Royce Silver Ghost Piccadilly Roadster by Merrimac'),
    { write: true, kind: 'automobile', year: 1923, make: 'Rolls-Royce' });
  equal(verdictFor(1, '2024 Bentley Continental GT V8 S'), { write: true, kind: 'automobile', year: 2024, make: 'Bentley' });
  equal(verdictFor(3, "2001 Piaggio Vespa ET4 'Scuderia Ferrari'"), { write: true, kind: 'motorcycle', year: 2001, make: 'Piaggio' });
  equal(verdictFor(3, '1954 Vincent Black Shadow Series C'), { write: true, kind: 'motorcycle', year: 1954, make: 'Vincent' });
});

Deno.test("a circa lot is written: 'c. 1904 MMC 8 HP Rear-Entrance Tonneau'", () => {
  const v = verdictFor(1, 'c. 1904 MMC 8 HP Rear-Entrance Tonneau');
  equal(v.write, true);
  if (v.write) equal([v.year, v.make], [1904, 'Mmc']);
});

Deno.test('RM calls a Jordan EJ13 show car an automobile, so it is written; the category decides, not our reading of the title', () => {
  equal(verdictFor(1, '2003 Jordan EJ13 Show Car'), { write: true, kind: 'automobile', year: 2003, make: 'Jordan' });
});

Deno.test('a boat is skipped as watercraft; a caravan (category 5) is skipped and counted by its number', () => {
  equal(verdictFor(4, "1963 Riva Ariston 'Telstar'"), { write: false, reason: 'watercraft' });
  equal(verdictFor(5, '1928 Eccles Jacobean Caravan'), { write: false, reason: 'category_5' });
  equal(verdictFor(9, '1999 Anything'), { write: false, reason: 'category_9' });
});

Deno.test('a missing or non-numeric category fails closed', () => {
  for (const cat of [undefined, null, '', '1', 'automobile', NaN, {}]) {
    equal(verdictFor(cat, '1954 Buick Skylark'), { write: false, reason: 'category_missing' }, `category ${String(cat)}:`);
  }
});

Deno.test('a vehicle category with a title that does not state the vehicle is skipped, each with its own reason', () => {
  // two vehicles in one lot, and the first number in it is not the lot's year
  equal(verdictFor(1, 'Range Rover Matched Pair - 2027 Range Rover SV Ultra LWB & 1993 Range Rover Classic'),
    { write: false, reason: 'no_leading_year' });
  // before 1885: not a motor vehicle's year, and vehicles.year takes it as null
  equal(verdictFor(1, '1858 Button & Blake Hand Pumper'), { write: false, reason: 'no_plausible_year' });
  // a year and nothing after it
  equal(verdictFor(1, '1954'), { write: false, reason: 'no_leading_year' });
  equal(verdictFor(1, ''), { write: false, reason: 'no_leading_year' });
  equal(verdictFor(1, undefined as unknown as string), { write: false, reason: 'no_leading_year' });
  // a "make" that is a number is no make
  equal(verdictFor(1, '1954 1/2 Scale Model'), { write: false, reason: 'no_make' });
  // circa before 1900 is a year the writer's parse cannot read, so it is not written with a null year
  equal(verdictFor(1, 'c. 1895 Benz Velo'), { write: false, reason: 'no_plausible_year' });
});

Deno.test('leadsWithYear: the year-led shapes only', () => {
  for (const t of ['1954 Buick Skylark', 'c. 1904 MMC 8 HP', 'c.1904 MMC', ' 1954 Buick']) equal(leadsWithYear(t), true, t);
  for (const t of ['Range Rover Matched Pair - 2027', '19 Buick', 'Circa 1904 MMC', 'Ferrari Enzo Three-Piece Luggage Set', '1954']) {
    equal(leadsWithYear(t), false, t);
  }
});

Deno.test('every lot the rule writes lands with the year and make the writer reads (the stop rule, held in code)', () => {
  let written = 0;
  for (const lot of FIXTURE) {
    const v = verdictFor(lot.cat, lot.title);
    if (!v.write) continue;
    written++;
    // saveVehicle writes parseTitle(publicName) through normalizeYear / normalizeMake; the verdict must be the same words
    const parsed = parseTitle(lot.title);
    equal(v.year, parsed.year, `${lot.a} ${lot.ref} year:`);
    equal(v.make, normalizeMake(parsed.make), `${lot.a} ${lot.ref} make:`);
    equal(typeof v.year === 'number' && v.year >= 1885, true, `${lot.a} ${lot.ref} year plausible:`);
    equal(typeof v.make === 'string' && v.make.length > 0, true, `${lot.a} ${lot.ref} make set:`);
  }
  equal(written, 581);
});

// Counted from the API responses, per auction: [lots, written, automobile, motorcycle, skips by reason]
const EXPECTED: Record<string, { lots: number; write: number; automobile: number; motorcycle: number; skipped: Record<string, number> }> = {
  MO26: { lots: 199, write: 192, automobile: 188, motorcycle: 4, skipped: { automobilia: 6, no_leading_year: 1 } },
  MC26: { lots: 77, write: 57, automobile: 56, motorcycle: 1, skipped: { automobilia: 19, watercraft: 1 } },
  LF26: { lots: 65, write: 61, automobile: 61, motorcycle: 0, skipped: { automobilia: 4 } },
  PA26: { lots: 95, write: 78, automobile: 77, motorcycle: 1, skipped: { automobilia: 16, category_5: 1 } },
  AZ26: { lots: 93, write: 90, automobile: 87, motorcycle: 3, skipped: { automobilia: 3 } },
  CC26: { lots: 17, write: 11, automobile: 11, motorcycle: 0, skipped: { automobilia: 6 } },
  MI26: { lots: 93, write: 89, automobile: 88, motorcycle: 1, skipped: { automobilia: 3, no_plausible_year: 1 } },
  S0226: { lots: 3, write: 3, automobile: 3, motorcycle: 0, skipped: {} },
};

Deno.test('the three auctions job 450 will read, and the five already read, give the counted writes and skips', () => {
  for (const [code, want] of Object.entries(EXPECTED)) {
    const auction = FIXTURE.filter((l) => l.a === code).map((l) => ({
      title: l.title, lot_number: l.ref, category_id: l.cat,
    }));
    equal(auction.length, want.lots, `${code} lots:`);
    const part = partitionLots(auction);
    equal(part.writable.length, want.write, `${code} written:`);
    equal(part.skipped.length, want.lots - want.write, `${code} skipped:`);
    equal(part.skipped_by_reason, want.skipped, `${code} skipped by reason:`);
    const kinds = { automobile: 0, motorcycle: 0 };
    for (const lot of part.writable) {
      const v = verdictFor(lot.category_id, lot.title);
      if (v.write) kinds[v.kind]++;
    }
    equal(kinds, { automobile: want.automobile, motorcycle: want.motorcycle }, `${code} kinds:`);
  }
});

Deno.test('partitionLots keeps RM order, counts skips by reason, and names each skipped lot', () => {
  const part = partitionLots([
    { title: '1954 Buick Skylark', lot_number: '10', category_id: 1 },
    { title: 'Ferrari Enzo Three-Piece Luggage Set', lot_number: '101', category_id: 2 },
    { title: '2024 Aston Martin Valkyrie Spider', lot_number: '11', category_id: 1 },
    { title: "1963 Riva Ariston 'Telstar'", lot_number: '12', category_id: 4 },
    { title: 'Range Rover Matched Pair - 2027 Range Rover SV Ultra LWB & 1993 Range Rover Classic', lot_number: '13', category_id: 1 },
    { title: '2026 Lando Norris McLaren Formula 1 Signed Bell Helmet', lot_number: null, category_id: 2 },
  ]);
  equal(part.writable.map((l) => l.lot_number), ['10', '11']);
  equal(part.skipped_by_reason, { automobilia: 2, watercraft: 1, no_leading_year: 1 });
  equal(part.skipped[0], { lot_number: '101', title: 'Ferrari Enzo Three-Piece Luggage Set', reason: 'automobilia' });
  equal(part.skipped[3], { lot_number: null, title: '2026 Lando Norris McLaren Formula 1 Signed Bell Helmet', reason: 'automobilia' });
});

Deno.test('titleIdentity reads the same words the writer does', () => {
  equal(titleIdentity('1937 Delage D8-120 S Aerodynamic Coupe by Pourtout'), { year: 1937, make: 'Delage' });
  equal(titleIdentity('1904 Oldsmobile Model 6C "Curved-Dash" Runabout'), { year: 1904, make: 'Oldsmobile' });
  equal(titleIdentity('Ferrari Enzo Three-Piece Luggage Set'), { reason: 'no_leading_year' });
});
