// node --test scripts/broadcast/overlay-barrett-jackson.test.mjs
// Fixtures are Apple Vision OCR lines from real 360p livestream frames cropped with the barrett_jackson crop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBarrettJacksonOverlay, barrettJacksonSaleKey, barrettJacksonSaleFromMeta } from './overlay-barrett-jackson.mjs';
import { PUBLISHERS } from './publishers.mjs';
import { segmentLots } from './segment-lots.mjs';

const line = (text, box, conf = 1) => ({ text, conf, box });

// 0fc5QNgncZk (2024 Scottsdale Fall, Sunday) at 4:02:00.
const FALL_2024 = [
  line('Sanб aolgPr', [0.131, 0.558, 0.103, 0.14], 0.3),
  line('LOT #948.1', [0.542, 0.256, 0.098, 0.14]),
  line('$11,000', [0.855, 0.256, 0.075, 0.14]),
  line('1982 CHEVROLET CIO CUSTOM PICKUP', [0.57, 0.488, 0.364, 0.209]),
];
// y4n7053qQTk (2023 Scottsdale, Sunday) at 5:09:50.
const SCOTTSDALE_2023 = [
  line('LOT#1589', [0.533, 0.233, 0.15, 0.163]),
  line('$45,000', [0.799, 0.233, 0.131, 0.186]),
  line('1969 CHEVROLET C10 CUSTOM PICKUP', [0.486, 0.488, 0.472, 0.14]),
];
// hgPP1J7Ooeo (2025 Fall livestream replay): sponsor logo text merges into the lot line.
const FALL_2025 = [
  line('Braninl Badkepe LOT #1018', [0.374, 0.209, 0.308, 0.209], 0.5),
  line('$160,000', [0.775, 0.177, 0.16, 0.274]),
  line('2018 MCLAREN 720S LUXURY LAUNCH EDITION', [0.201, 0.488, 0.762, 0.279]),
];

test('reads lot, title and displayed bid from the 2024 layout', () => {
  assert.deepEqual(parseBarrettJacksonOverlay(FALL_2024), {
    publisher: 'barrett_jackson', lot: '948.1', title: '1982 CHEVROLET CIO CUSTOM PICKUP', sale: null,
    displayed_bid: 11000, displayed_ask: null, status: null,
  });
});

test('reads the 2023 and 2025 layouts', () => {
  const a = parseBarrettJacksonOverlay(SCOTTSDALE_2023);
  assert.equal(a.lot, '1589'); assert.equal(a.displayed_bid, 45000); assert.equal(a.title, '1969 CHEVROLET C10 CUSTOM PICKUP');
  const b = parseBarrettJacksonOverlay(FALL_2025);
  assert.equal(b.lot, '1018'); assert.equal(b.displayed_bid, 160000); assert.equal(b.title, '2018 MCLAREN 720S LUXURY LAUNCH EDITION');
});

test('joins a two-line title and ignores the sponsor logo', () => {
  const p = parseBarrettJacksonOverlay([
    line('LOT#9569.8', [0.532, 0.226, 0.173, 0.198]),
    line('$2,200', [0.822, 0.256, 0.107, 0.186]),
    line("TWO 1960S HAMM'S BEER WALL SCONCE LIGHT-UP", [0.336, 0.488, 0.621, 0.14]),
    line('SIGNS', [0.879, 0.674, 0.079, 0.14]),
    line('- Swisstrax', [0.047, 0.558, 0.201, 0.302], 0.5),
  ]);
  assert.equal(p.lot, '9569.8');
  assert.equal(p.title, "TWO 1960S HAMM'S BEER WALL SCONCE LIGHT-UP SIGNS");
});

test('the $0 placeholder before the first bid is not a displayed bid', () => {
  const p = parseBarrettJacksonOverlay([
    line('LOT #948.1', [0.542, 0.256, 0.098, 0.14]),
    line('$0', [0.92, 0.256, 0.031, 0.14]),
    line('1982 CHEVROLET CIO CUSTOM PICKUP', [0.57, 0.512, 0.36, 0.186]),
  ]);
  assert.equal(p.lot, '948.1');
  assert.equal(p.displayed_bid, null);
});

test('accepts "#" misread as "$" and a dropped leading L', () => {
  assert.equal(parseBarrettJacksonOverlay([line('LOT $401', [0.537, 0.256, 0.084, 0.14])]).lot, '401');
  assert.equal(parseBarrettJacksonOverlay([line('OT #400', [0.556, 0.256, 0.075, 0.14])]).lot, '400');
});

test('refuses a lot whose "#" was read as a digit', () => {
  // 6WSEO4wbs0k: lot #401 read as "LOT 8401" and "LOT 3401".
  assert.equal(parseBarrettJacksonOverlay([
    line('LOT 8401', [0.537, 0.256, 0.084, 0.14]),
    line('$70,000', [0.836, 0.256, 0.093, 0.186]),
    line('1937 FORD CUSTOM CONVERTIBLE', [0.607, 0.535, 0.346, 0.186]),
  ]), null);
  assert.equal(parseBarrettJacksonOverlay([line('LOT 3401', [0.537, 0.256, 0.089, 0.14])]), null);
});

test('refuses a box still sliding in, a five-digit lot, and frames without a lot', () => {
  assert.equal(parseBarrettJacksonOverlay([
    line('LOT#1:', [0.897, 0.233, 0.098, 0.163]), line('1954 CHEVRO', [0.836, 0.488, 0.159, 0.14]),
  ]), null);
  assert.equal(parseBarrettJacksonOverlay([line('LOT #15', [0.85, 0.233, 0.09, 0.163])]), null);
  assert.equal(parseBarrettJacksonOverlay([
    line('LOT #95471', [0.542, 0.254, 0.108, 0.144]),
    line('CIRCA1950S TRAILWAYS BUS DEPOT PORCELAIN SIGN', [0.43, 0.512, 0.5, 0.186]),
  ]), null);
  assert.equal(parseBarrettJacksonOverlay([]), null);
  assert.equal(parseBarrettJacksonOverlay([line('$58,000', [0.836, 0.256, 0.093, 0.163])]), null);
});

test('a sub-lot read without its decimal point stays one presentation', () => {
  // 0fc5QNgncZk 3:07:33-3:08:39: "LOT #921.1" was read as "LOT #9211" in most frames.
  const seq = ['9211', '9211', '921.1', '9211', '9211', '921.1', '9211', '9211', '9211', '921.1', '921.1', '9211'];
  const readings = seq.map((lot, i) => ({ t: i, publisher: 'barrett_jackson', lot, title: '1986 FORD MUSTANG SVO', sale: null,
    displayed_bid: null, displayed_ask: null, status: null }));
  const presentations = segmentLots(readings);
  assert.equal(presentations.length, 1);
  assert.equal(presentations[0].lot, '921.1');
  assert.equal(presentations[0].overlay_samples, 12);
});

test('a dotless lot with a different title is left alone', () => {
  const mk = (lot, title, t) => ({ t, lot, title, displayed_bid: null, status: null });
  const readings = [0, 1, 2].map(t => mk('921.1', '1986 FORD MUSTANG SVO', t)).concat([3, 4, 5].map(t => mk('9211', 'VINTAGE TEXACO SIGN', t)));
  assert.deepEqual(segmentLots(readings).map(p => p.lot), ['921.1', '9211']);
});

test('sale keys agree between docket slugs and video titles', () => {
  assert.equal(barrettJacksonSaleKey('SUNDAY - 2024 SCOTTSDALE FALL AUCTION LIVESTREAM // SUNDAY, OCTOBER 13, 2024'), 'scottsdale-fall-2024');
  assert.equal(barrettJacksonSaleKey('scottsdale-fall-2024'), 'scottsdale-fall-2024');
  assert.equal(barrettJacksonSaleKey('2023 SCOTTSDALE SUNDAY LIVESTREAM - Sunday, January 29, 2023 - BARRETT-JACKSON 2023 AUCTION'), 'scottsdale-2023');
  assert.equal(barrettJacksonSaleKey('2026-scottsdale'), 'scottsdale-2026');
  assert.equal(barrettJacksonSaleKey('2020-fall-auction-at-westworld-of-scottsdale'), 'scottsdale-fall-2020');
  assert.equal(barrettJacksonSaleKey('scottsdale-march-2021'), 'scottsdale-march-2021');
  assert.equal(barrettJacksonSaleKey('Palm Beach 2025'), 'palm-beach-2025');
  assert.equal(barrettJacksonSaleKey('LIVE - BARRETT-JACKSON CUP'), null);
  assert.equal(barrettJacksonSaleKey('Barrett-Jackson 2025 Fall Auction'), null);
  assert.equal(barrettJacksonSaleKey('LIVE STREAM - Day 2 Online May 2020 Auction - BARRETT-JACKSON'), null);
});

test('saleFromMeta uses the title, falls back to a hint, and checks the publication year', () => {
  const fall2024 = { title: 'SUNDAY - 2024 SCOTTSDALE FALL AUCTION LIVESTREAM // SUNDAY, OCTOBER 13, 2024', published_at: '2024-10-13T15:00:00.000Z' };
  assert.deepEqual(barrettJacksonSaleFromMeta(fall2024), { sale: 'scottsdale-fall-2024', basis: 'video_title' });
  const fall2025 = { title: 'Super Saturday Livestream Replay "All the cars, all the time" // Barrett-Jackson 2025 Fall Auction',
    published_at: '2025-11-08T00:00:00.000Z' };
  assert.equal(barrettJacksonSaleFromMeta(fall2025), null);
  const hint = { value: 'Scottsdale Fall 2025 Livestream', source: 'broadcast_backfill_queue.auction_name' };
  assert.deepEqual(barrettJacksonSaleFromMeta({ ...fall2025, sale_hint: hint }),
    { sale: 'scottsdale-fall-2025', basis: 'broadcast_backfill_queue.auction_name' });
  assert.equal(barrettJacksonSaleFromMeta({ ...fall2024, sale_hint: hint }), null);
  assert.equal(barrettJacksonSaleFromMeta({ ...fall2024, published_at: '2026-01-02T00:00:00.000Z' }), null);
});

test('saleMatches scopes events by the docket URL slug', () => {
  const { saleMatches } = PUBLISHERS.barrett_jackson;
  const event = { source_url: 'https://www.barrett-jackson.com/scottsdale-fall-2024/docket/vehicle/1995-bmw-m3-280109', raw_data: null };
  assert.equal(saleMatches('scottsdale-fall-2024', event), true);
  assert.equal(saleMatches('SCOTTSDALE FALL 2024', event), true);
  assert.equal(saleMatches('scottsdale-2024', event), false);
  assert.equal(saleMatches(null, event), false);
  assert.equal(saleMatches('scottsdale-2026', { source_url: 'https://barrett-jackson.com/2026-scottsdale/docket/vehicle/x-1' }), true);
  assert.equal(saleMatches('scottsdale-2026', { source_url: null }), false);
});
