// Run: deno test supabase/functions/extract-rmsothebys/
import { lotStatus } from './lotStatus.ts';
import lots from './fixtures/lots_2026-10-14.json' with { type: 'json' };

type FixtureLot = { a: string; ref: string; cat: number; title: string; sold: boolean; auctioned: boolean };
const FIXTURE = lots as FixtureLot[];

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('sold, for sale, upcoming and not sold each get their own status', () => {
  equal(lotStatus({ sold: true, auctioned: true, is_still_for_sale: false }), { sale_status: 'sold', event_status: 'sold' });
  equal(lotStatus({ sold: false, auctioned: true, is_still_for_sale: true }), { sale_status: 'available', event_status: 'active' });
  equal(lotStatus({ sold: false, auctioned: false, is_still_for_sale: false }), { sale_status: 'upcoming', event_status: 'pending' });
  equal(lotStatus({ sold: false, auctioned: true, is_still_for_sale: false }), { sale_status: 'not_sold', event_status: 'unsold' });
});

Deno.test('the 55 held-auction lots that went through the sale unsold are not sold, never ended', () => {
  const unsold = FIXTURE.filter((l) => l.a !== 'LF26' && !l.sold && l.auctioned);
  equal(unsold.length, 55);
  equal(unsold.every((l) => lotStatus({ sold: l.sold, auctioned: l.auctioned, is_still_for_sale: false }).event_status === 'unsold'), true);
});

Deno.test('a lot whose auctioned flag is unknown stays as before: ended, never upcoming', () => {
  equal(lotStatus({ sold: false, auctioned: null, is_still_for_sale: false }), { sale_status: 'ended', event_status: 'ended' });
});

Deno.test('every sale_status the extractor writes is one vehicles.sale_status allows', () => {
  // vehicles_sale_status_check, read from the live database 2026-10-14
  const allowed = new Set(['not_for_sale', 'for_sale', 'sold', 'pending', 'auction_live', 'ended', 'available', 'discovered', 'not_sold', 'unsold', 'upcoming', 'bid_to']);
  for (const sold of [true, false]) for (const auctioned of [true, false, null]) for (const still of [true, false]) {
    equal(allowed.has(lotStatus({ sold, auctioned, is_still_for_sale: still }).sale_status), true);
  }
});

Deno.test('all 65 lots of the London Auction (not yet held) are upcoming; none of the 577 lots of the seven held auctions are', () => {
  const status = (l: FixtureLot) => lotStatus({ sold: l.sold, auctioned: l.auctioned, is_still_for_sale: false }).sale_status;
  const london = FIXTURE.filter((l) => l.a === 'LF26');
  equal(london.length, 65);
  equal(london.every((l) => status(l) === 'upcoming'), true);
  const held = FIXTURE.filter((l) => l.a !== 'LF26');
  equal(held.length, 577);
  equal(held.some((l) => status(l) === 'upcoming'), false);
});

Deno.test('MO26: 180 sold lots are sold and 19 unsold lots are not sold', () => {
  const counts: Record<string, number> = {};
  for (const l of FIXTURE.filter((x) => x.a === 'MO26')) {
    const s = lotStatus({ sold: l.sold, auctioned: l.auctioned, is_still_for_sale: false }).sale_status;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  equal(counts, { sold: 180, not_sold: 19 });
});
