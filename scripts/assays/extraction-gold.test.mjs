import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matches, gradeField, gradeLot, scorecard, normOutcome, candidates, lotSql, FIELDS } from './extraction-gold.mjs';

const fixture = JSON.parse(readFileSync(new URL('./extraction-gold-v1.json', import.meta.url), 'utf8'));

test('fixture: every lot names house, platform, stage, url, evidence and known fields only', () => {
  const keys = new Set();
  for (const lot of fixture.lots) {
    assert.ok(!keys.has(lot.key), `duplicate key ${lot.key}`); keys.add(lot.key);
    assert.ok(lot.house && lot.platform && lot.url.startsWith('https://'), lot.key);
    assert.ok(['sold', 'not_sold', 'live', 'upcoming'].includes(lot.stage), lot.key);
    assert.match(lot.evidence.sha256, /^[0-9a-f]{64}$/, lot.key);
    assert.ok(lot.evidence.fetched_at, lot.key);
    for (const f of Object.keys(lot.truth)) assert.ok(FIELDS.includes(f), `${lot.key}: unknown field ${f}`);
    assert.equal(lot.truth.outcome, lot.stage, `${lot.key}: outcome must equal stage`);
    if (lot.perishable) assert.ok(lot.truth.auction_end, `${lot.key}: perishable lot needs auction_end`);
  }
  const houses = new Set(fixture.lots.map((l) => l.house));
  for (const h of ['bat', 'cars_and_bids', 'mecum', 'barrettjackson', 'bonhams', 'rm-sothebys', 'gooding', 'collecting_cars', 'pcarmarket', 'broad_arrow']) {
    assert.ok(fixture.lots.filter((l) => l.house === h).length >= 3, `${h} needs at least 3 lots`);
    assert.ok(houses.has(h));
  }
});

test('matches: text tokens, makes, VINs and lot numbers ignore case and punctuation', () => {
  assert.equal(matches('make', 'Mercedes-Benz', 'Mercedes Benz'), true);
  assert.equal(matches('exterior_color', { value: 'Mineral Grey Metallic', match_any: ['grey'] }, 'Gray'), true);
  assert.equal(matches('engine', { value: '3.0L Turbo I6', match: ['3.0'] }, '2.0L I4'), false);
  assert.equal(matches('vin', 'AM101.2716', 'am1012716'), true);
  assert.equal(matches('lot_number', '269031', '#269,031'), true);
  assert.equal(matches('model', { value: 'Corvette' }, 'Corvette Z06'), true);
  assert.equal(matches('model', { value: '911' }, 'Turbo'), false);
});

test('matches: numbers, mileage tolerance, km witness, dates and one_of', () => {
  assert.equal(matches('hammer_price', 77000, '77000.00'), true);
  assert.equal(matches('hammer_price', 77000, 76000), false);
  assert.equal(matches('mileage', { value: 13000, approx: true }, 13400), true);
  assert.equal(matches('mileage', { value: 13000 }, 13400), false);
  assert.equal(matches('mileage', { value: 168652, unit: 'km' }, 104796), true);
  assert.equal(matches('sale_date', '2026-10-17', '2026-10-17T19:01:00Z'), true);
  assert.equal(matches('sale_date', '2026-10-17', '2026-10-20'), false);
  assert.equal(matches('sale_date', { one_of: ['2022-08-19', '2022-08-20'] }, '2022-08-20'), true);
  assert.equal(matches('auction_end', '2026-10-18T17:13:00Z', '2026-10-18T17:15:00Z'), true);
  assert.equal(matches('auction_end', '2026-10-18T17:13:00Z', '2026-10-18T18:13:00Z'), false);
});

test('outcomes: house vocabularies fold to sold / not_sold / live / upcoming; ended is not an outcome', () => {
  assert.equal(normOutcome('reserve_not_met'), 'not_sold');
  assert.equal(normOutcome('bid-goes-on'), 'not_sold');
  assert.equal(normOutcome('sold_after'), 'sold');
  assert.equal(normOutcome('auction_live'), 'live');
  assert.equal(normOutcome('ended'), 'unrecognized:ended');
  assert.equal(matches('outcome', 'not_sold', 'ended'), false);
});

test('gradeField: pass, wrong, missing, and a hammer held where the premium price is the truth', () => {
  assert.deepEqual(gradeField('year', 2019, [{ at: 'v.year', value: null }]), { verdict: 'missing' });
  assert.equal(gradeField('year', 2019, [{ at: 'v.year', value: 2019 }]).verdict, 'pass');
  const w = gradeField('vin', 'WP0ZZZ99Z4S691363', [{ at: 'vehicles.vin', value: 'WP0CB29964S676676' }]);
  assert.equal(w.verdict, 'wrong'); assert.equal(w.value, 'WP0CB29964S676676');
  const h = gradeField('price_with_premium', 21850, [{ at: 'vehicle_events.final_price', value: 19000 }]);
  assert.equal(h.verdict, 'missing'); assert.equal(h.reason, 'held_hammer_only');
  assert.equal(gradeField('price_with_premium', 161000, [{ at: 'x', value: 62700 }]).verdict, 'wrong');
});

test('gradeLot: unresolved lots are missing everywhere; perishable lots go stale after their end', () => {
  const lot = { key: 'k', house: 'bat', stage: 'live', perishable: true, truth: { year: 1977, outcome: 'live', bid_count: 4, auction_end: '2026-10-18T17:13:00Z' } };
  const unresolved = gradeLot(lot, null, Date.parse('2026-10-18T05:00:00Z'));
  assert.equal(unresolved.resolved, false);
  assert.ok(Object.values(unresolved.fields).every((g) => g.verdict === 'missing'));
  const model = { vehicle_id: 'v', v: { year: 1977, sale_status: 'auction_live' }, comments: { bid: 4, non_bid: 5 }, ma: { auction_end_time: '2026-10-18T17:13:00Z' } };
  const open = gradeLot(lot, model, Date.parse('2026-10-18T05:00:00Z'));
  assert.equal(open.fields.outcome.verdict, 'pass');
  assert.equal(open.fields.bid_count.verdict, 'pass');
  const later = gradeLot(lot, model, Date.parse('2026-10-19T05:00:00Z'));
  assert.equal(later.fields.outcome.verdict, 'stale');
  assert.equal(later.fields.year.verdict, 'pass');
});

test('scorecard and candidates: tallies per house; comment counts read the lot thread', () => {
  const c = candidates({ v: {}, comments: { bid: 14, non_bid: 20 } });
  assert.equal(c.comment_count[0].value, 20);
  assert.equal(c.bid_count[0].value, 14);
  const s = scorecard([{ house: 'bat', resolved: true, fields: { year: { verdict: 'pass' }, vin: { verdict: 'wrong' } } }]);
  assert.deepEqual(s.bat.totals, { pass: 1, wrong: 1, missing: 0, stale: 0 });
});

test('lotSql: read-only shape, every url spelling, no unbounded scans', () => {
  const sql = lotSql(fixture.lots[0]);
  assert.match(sql, /source_url = any\(ARRAY\['https:\/\/bringatrailer\.com\/listing\/2019-chevrolet-corvette-z06-coupe-60'/);
  assert.match(sql, /www\.bringatrailer\.com/);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\b/i);
  assert.doesNotMatch(sql, /case when/i);
});
