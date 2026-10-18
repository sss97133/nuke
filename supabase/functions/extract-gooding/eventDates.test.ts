// Run: deno test supabase/functions/extract-gooding/eventDates.test.ts
// Session shapes are the ones lane S classified on 2026-10-05 (S-gooding-page-classification.json, 2,062 pages) and the
// live page-data of goodingco.com/lot/1914-stutz-model-4e-bearcat (Pebble Beach 2026), fetched 2026-10-06.
import { goodingEventDates } from './eventDates.ts';
import { writeVehicleEventByKey } from '../_shared/vehicleEventWrite.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const VIEWING = { __typename: 'ContentfulSubEventViewing' };
const auction = (startDate: string) => ({ __typename: 'ContentfulSubEventAuction', startDate });

Deno.test('the 2004–2019 placeholder (one 09:00 session, no viewings) dates nothing, sold or not', () => {
  const placeholder = [auction('2008-08-01T09:00+02:00')];
  for (const sold of [true, false]) {
    equal(goodingEventDates(placeholder, sold), {
      ended_at: null, sold_at: null, basis: 'placeholder_session', session_days: ['2008-08-01'],
    });
  }
});

Deno.test('Pebble Beach 2026 (two sessions, four viewings) names no lot day: both dates NULL, days kept', () => {
  const pebble2026 = [VIEWING, VIEWING, VIEWING, VIEWING, auction('2026-08-14T16:00-08:00'), auction('2026-08-15T11:00-08:00')];
  equal(goodingEventDates(pebble2026, true), {
    ended_at: null, sold_at: null, basis: 'multiple_auction_sessions_no_lot_day', session_days: ['2026-08-14', '2026-08-15'],
  });
});

Deno.test('a single real session dates the episode; sold_at only when the lot sold', () => {
  const amelia = [VIEWING, VIEWING, auction('2024-03-01T11:00-05:00')];
  equal(goodingEventDates(amelia, true), {
    ended_at: '2024-03-01T00:00:00.000Z', sold_at: '2024-03-01T00:00:00.000Z', basis: 'single_auction_session', session_days: ['2024-03-01'],
  });
  equal(goodingEventDates(amelia, false).sold_at, null);
  equal(goodingEventDates(amelia, false).ended_at, '2024-03-01T00:00:00.000Z');
});

Deno.test('a single 09:00 session is real when the page lists viewings', () => {
  equal(goodingEventDates([VIEWING, auction('2022-01-28T09:00-07:00')], true).basis, 'single_auction_session');
});

Deno.test('a single session at another hour with no viewings is real (lane S: placeholder is 09:00 only)', () => {
  equal(goodingEventDates([auction('2023-05-20T13:00+01:00')], true).basis, 'single_auction_session');
});

Deno.test('the local day is the page day, not the UTC day of the timestamp', () => {
  // 16:00 at -08:00 is 00:00 UTC on the next day; the page states the 14th.
  equal(goodingEventDates([VIEWING, auction('2026-08-14T16:00-08:00')], true).session_days, ['2026-08-14']);
  equal(goodingEventDates([VIEWING, auction('2026-08-14T16:00-08:00')], true).sold_at, '2026-08-14T00:00:00.000Z');
});

Deno.test('no auction session, a missing list or an unparseable date leaves both dates NULL', () => {
  for (const events of [[], null, undefined, [VIEWING], [{ __typename: 'ContentfulSubEventAuction' }], [auction('TBD')]]) {
    equal(goodingEventDates(events as never, true), { ended_at: null, sold_at: null, basis: 'no_auction_session', session_days: [] });
  }
});

Deno.test('a sold lot on a placeholder page never carries a sold_at or ended_at, insert or update', async () => {
  // Pebble Beach 2005 as lane S classified it: one session at 09:00 +02:00, no viewings, sale price on the page.
  const dates = goodingEventDates([auction('2005-08-05T09:00+02:00')], true);
  const row = {
    vehicle_id: 'v-1', source_platform: 'gooding', source_listing_id: 'goodingco.com/lot/x', event_status: 'sold',
    final_price: 41800, ended_at: dates.ended_at, sold_at: dates.sold_at, metadata: { sold_at_basis: dates.basis },
  };
  const written: Record<string, unknown>[] = [];
  const stub = (live: unknown[]) => ({
    from: () => ({
      select: () => ({ eq() { return this; }, limit: () => Promise.resolve({ data: live, error: null }) }),
      insert: (r: Record<string, unknown>) => { written.push(r); return { select: () => ({ limit: () => Promise.resolve({ data: [{ id: 'n' }], error: null }) }) }; },
      update: (r: Record<string, unknown>) => { written.push(r); return { eq() { return this; }, select() { return this; }, limit: () => Promise.resolve({ data: [{ id: 'l' }], error: null }) }; },
    }),
  });
  await writeVehicleEventByKey(stub([]), row);                                   // insert path
  await writeVehicleEventByKey(stub([{ id: 'l', metadata: {} }]), row);          // update path
  equal(written.length, 2);
  // Insert: the clocks are written as NULL. Update: a NULL clock is not sent at all, so a live value is never cleared.
  equal([written[0].sold_at, written[0].ended_at], [null, null]);
  equal(['sold_at' in written[1], 'ended_at' in written[1]], [false, false]);
  for (const w of written) equal((w.metadata as Record<string, unknown>).sold_at_basis, 'placeholder_session');
});
