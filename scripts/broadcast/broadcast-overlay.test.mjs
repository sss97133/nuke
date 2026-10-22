import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMecumOverlay } from './overlay-mecum.mjs';
import { segmentLots } from './segment-lots.mjs';

// OCR lines read by Apple Vision from Mecum Kissimmee 2026 (c9fxArnD3IY), top band of 360p frames.
const camaroReserveOff = [
  { text: 'MECLM', box: [0.066, 0.253, 0.094, 0.192] },
  { text: 'KISSIMMEE 2026', box: [0.066, 0.512, 0.106, 0.093] },
  { text: 'LOT', box: [0.203, 0.326, 0.028, 0.116] },
  { text: 'S98', box: [0.2, 0.442, 0.031, 0.116] },
  { text: '1969 CHEVROLET CAMARO SS', box: [0.259, 0.372, 0.188, 0.14] },
  { text: 'ПOLLW IKANSPUK1', box: [0.575, 0.0, 0.178, 0.093] },
  { text: '$77,000', box: [0.528, 0.279, 0.084, 0.209] },
  { text: 'RESERVE OFF', box: [0.5, 0.512, 0.087, 0.093] },
];
const lincolnTwoLineTitle = [
  { text: 'MECUM', box: [0.066, 0.256, 0.094, 0.186] },
  { text: 'KISSIMMEE 2026', box: [0.053, 0.488, 0.119, 0.14] },
  { text: 'LOT', box: [0.203, 0.326, 0.028, 0.116] },
  { text: 'S99', box: [0.2, 0.442, 0.031, 0.116] },
  { text: '1965 LINCOLN CONTINENTAL', box: [0.262, 0.326, 0.175, 0.116] },
  { text: 'CONVERTIBLE', box: [0.262, 0.442, 0.088, 0.116] },
  { text: '$140,000', box: [0.516, 0.279, 0.097, 0.186] },
  { text: 'CURRENT BID', box: [0.497, 0.512, 0.091, 0.116] },
];

test('reads lot, sale, title, displayed bid and status from a Mecum overlay', () => {
  assert.deepEqual(parseMecumOverlay(camaroReserveOff), {
    publisher: 'mecum', lot: 'S98', title: '1969 CHEVROLET CAMARO SS', sale: 'KISSIMMEE 2026',
    displayed_bid: 77000, displayed_ask: null, status: 'reserve_off',
  });
});

test('joins a title that wraps onto a second line', () => {
  const r = parseMecumOverlay(lincolnTwoLineTitle);
  assert.equal(r.title, '1965 LINCOLN CONTINENTAL CONVERTIBLE');
  assert.equal(r.displayed_bid, 140000);
  assert.equal(r.status, 'current_bid');
});

test('the SOLD stamp outranks RESERVE OFF and the S prefix misread as $ is recovered', () => {
  // Frame 820: the stamp animates over the lot box, so S99 reads "$99"; stage signage also says SOLD.
  const r = parseMecumOverlay([
    { text: 'MECLM', box: [0.07, 0.26, 0.09, 0.19] },
    { text: 'KISSIMMEE 2026', box: [0.06, 0.51, 0.11, 0.09] },
    { text: 'LOT', box: [0.2, 0.33, 0.02, 0.12] },
    { text: '$99', box: [0.2, 0.44, 0.02, 0.12] },
    { text: '1965 LINCOLN CONTINENTAL', box: [0.26, 0.33, 0.18, 0.12] },
    { text: 'CONVERTIBLE', box: [0.26, 0.44, 0.09, 0.12] },
    { text: '$180,000', box: [0.51, 0.27, 0.1, 0.22] },
    { text: 'RESERVE OFF', box: [0.5, 0.51, 0.09, 0.12] },
    { text: 'SOLD', box: [0.63, 0.35, 0.06, 0.28] },
  ]);
  assert.equal(r.lot, 'S99');
  assert.equal(r.displayed_bid, 180000);
  assert.equal(r.status, 'sold');
});

test('SOLD outside the stamp position is signage, not an outcome', () => {
  const r = parseMecumOverlay([...camaroReserveOff, { text: 'SOLD', box: [0.85, 0.27, 0.09, 0.26] }]);
  assert.equal(r.status, 'reserve_off');
});

test('a frame without a lot number is not an overlay', () => {
  assert.equal(parseMecumOverlay([{ text: 'MECUM', box: [0.06, 0.25, 0.09, 0.19] }, { text: '$5,000', box: [0.5, 0.3, 0.08, 0.2] }]), null);
  assert.equal(parseMecumOverlay([]), null);
});

const reading = (t, lot, bid, status = 'current_bid') => ({ t, publisher: 'mecum', lot, title: `TITLE ${lot}`, sale: 'KISSIMMEE 2026', displayed_bid: bid, displayed_ask: null, status });

test('segments lots, ignores single-frame misreads and keeps a monotone ladder', () => {
  const readings = [
    ...[0, 1, 2, 3].map(t => reading(t, 'S98', 77000, 'reserve_off')),
    reading(4, 'S88', 77000),                      // one-frame lot misread
    ...[5, 6].map(t => reading(t, 'S98', 80000, 'reserve_off')),
    reading(7, 'S98', 8000, 'reserve_off'),        // dropped digit, unconfirmed
    ...[8, 9, 10].map(t => reading(t, 'S98', 85000, 'sold')),
    ...[40, 41, 42].map(t => reading(t, 'S99', 75000)),
  ];
  const [s98, s99] = segmentLots(readings);
  assert.equal(s98.lot, 'S98');
  assert.deepEqual(s98.bid_ladder.map(b => b.amount), [77000, 80000, 85000]);
  assert.equal(s98.displayed_outcome, 'sold');
  assert.equal(s98.reserve_off_at_s, 0);
  assert.equal(s98.start_s, 0);
  assert.equal(s98.end_s, 11);
  assert.equal(s99.lot, 'S99');
  assert.equal(s99.displayed_outcome, 'unknown');
});

test('a briefly confirmed higher misread is dropped when the lower value holds the screen after it', () => {
  // S150 in c9fxArnD3IY: $1,700,000 read as $1,800,000 for a few frames, then $1,700,000 until SOLD.
  const readings = [
    ...[0, 1, 2].map(t => reading(t, 'S150', 1600000)),
    ...[3, 4, 5].map(t => reading(t, 'S150', 1700000)),
    ...[6, 7].map(t => reading(t, 'S150', 1800000)),
    ...[8, 9, 10, 11, 12].map(t => reading(t, 'S150', 1700000)),
    reading(13, 'S150', 1700000, 'sold'),
  ];
  const [s150] = segmentLots(readings);
  assert.deepEqual(s150.bid_ladder.map(b => b.amount), [1600000, 1700000]);
  assert.equal(s150.final_displayed_bid, 1700000);
});

test('an overlay gap shorter than the merge window does not split a lot', () => {
  const readings = [...[0, 1, 2].map(t => reading(t, 'S99', 75000)), ...[120, 121, 122].map(t => reading(t, 'S99', 90000))];
  const out = segmentLots(readings);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].bid_ladder.map(b => b.amount), [75000, 90000]);
});

test('retains descending asks and corrected screen bids independently of the filtered ladder', () => {
  const readings = [
    { ...reading(0, 'S1', 30000), displayed_ask: 50000 },
    { ...reading(1, 'S1', 30000), displayed_ask: 50000 },
    { ...reading(2, 'S1', 35000), displayed_ask: 40000 },
    { ...reading(3, 'S1', 35000), displayed_ask: 35000 },
    { ...reading(4, 'S1', 30000), displayed_ask: 35000 },
  ];
  const [lot] = segmentLots(readings);
  assert.deepEqual(lot.ask_ladder, [{ t: 0, amount: 50000 }, { t: 2, amount: 40000 }, { t: 3, amount: 35000 }]);
  assert.deepEqual(lot.displayed_bid_readings, [{ t: 0, amount: 30000 }, { t: 2, amount: 35000 }, { t: 4, amount: 30000 }]);
  assert.equal(lot.bid_ladder.at(-1).amount, 35000);
  assert.equal(lot.displayed_outcome, 'unknown');
});
