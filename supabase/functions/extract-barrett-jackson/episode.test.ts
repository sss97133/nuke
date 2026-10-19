// Run: deno test supabase/functions/extract-barrett-jackson/
import { docketLotNumber, docketStatus, episodeSoldAt, episodeStatus, statesResult } from './episode.ts';
import { patchForLiveRow } from '../_shared/vehicleEventWrite.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('a preview docket (lot "Preview", is_sold false) is an upcoming lot with no lot number, never not sold', () => {
  equal(docketLotNumber('Preview'), null);
  equal(docketStatus(false, 'Preview'), 'Upcoming');
  equal(episodeStatus(docketStatus(false, 'Preview')), 'pending');
  equal(statesResult('Upcoming'), false);
});

Deno.test('a numbered docket keeps its lot; is_sold true is sold, false is not sold', () => {
  equal(docketLotNumber('487'), '487');
  equal(docketStatus(true, '487'), 'Sold');
  equal(docketStatus(false, '845'), 'Not Sold');
  equal(episodeStatus('Not Sold'), 'unsold');
  equal(episodeStatus('Withdrawn'), 'cancelled');
  equal(statesResult('Sold'), true);
  equal(statesResult('Not Sold'), true);
});

Deno.test('only a sold lot gets a sale day', () => {
  equal(episodeSoldAt('Sold', '2026-04-16'), '2026-04-16T00:00:00.000Z');
  equal(episodeSoldAt('Not Sold', '2026-04-16'), null);
  equal(episodeSoldAt('Upcoming', '2026-04-16'), null);
});

Deno.test('a post-sale read updates the preview episode: sold, lot 487, price; the stored sale day is kept (fill-only)', () => {
  // The Palm Beach 2026 Camaro RS episode as stored on 2026-04-01 (event 3395a14c).
  const live = { id: '3395a14c', metadata: { lot_number: 'Preview', auction_name: '2026 Palm Beach' }, sold_at: '2026-04-15T00:00:00+00:00', ended_at: null };
  const row = {
    vehicle_id: 'v', source_platform: 'barrettjackson', source_listing_id: null, event_type: 'auction', source_url: 'u',
    event_status: episodeStatus('Sold'), final_price: 71500, sold_at: episodeSoldAt('Sold', '2026-04-16'),
    metadata: { lot_number: docketLotNumber('487'), auction_name: '2026 Palm Beach' },
  };
  const { patch } = patchForLiveRow(live, row);
  equal([patch.event_status, patch.final_price, (patch.metadata as any).lot_number, 'sold_at' in patch], ['sold', 71500, '487', false]);
});
