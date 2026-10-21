import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { matches, gradeField, gradeLot, scorecard, normOutcome, candidates, lotSql, FIELDS, gradeSelectedSale, assaySelectedSale } from './extraction-gold.mjs';
import { anonymousConfiguration, publicClient } from './public-reader-coverage.mjs';

const fixture = JSON.parse(readFileSync(new URL('./extraction-gold-v1.json', import.meta.url), 'utf8'));

const sourceBody = Buffer.from('Synthetic independent terminal source: sold USD 12345 on 2026-01-01');
const sourceHash = createHash('sha256').update(sourceBody).digest('hex');
const vehicleId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000002';
const episodeId = '00000000-0000-4000-8000-000000000003';
const cutoff = '2026-01-05T00:00:00Z';
const strictContext = { vehicleId, episodeId, cutoff };
const strictLot = { key: 'synthetic', house: 'bat', stage: 'sold', url: 'https://bringatrailer.com/listing/synthetic/',
  evidence: { sha256: sourceHash, fetched_at: '2026-01-02T00:00:00Z' },
  truth: { year: 2000, make: 'Synthetic', model: { value: 'Example' }, outcome: 'sold', hammer_price: 12345, currency: 'USD', sale_date: '2026-01-01' } };
const selected = { vehicleId, sourceUrl: strictLot.url, sourceKey: 'bringatrailer.com/listing/synthetic',
  amount: 12345, outcome: 'sold', currency: 'USD', eventAt: '2026-01-01', priceBasis: 'published_bid_excluding_fees',
  snapshotId, sourceSha256: sourceHash, sourceVehicleEventId: '00000000-0000-4000-8000-000000000003',
  sourceEpisodeAncestry: 'canonical_current_context_verified', snapshotFetchedAt: '2026-01-02T00:00:00Z',
  snapshotCreatedAt: '2026-01-02T00:01:00Z', parsedAt: '2026-01-02T00:02:00Z', knownAt: '2026-01-02T00:02:00Z' };
const selectedResponse = row => ({ ok: true, value: { receipt: { method: 'source_sale_price_midrank_v1',
  knowledge_mode: 'known_at', evidence_as_of: cutoff, cohort: { complete: true }, coverage: { complete: true }, currency: 'USD',
  price_basis: 'published_bid_excluding_fees', price_basis_rule: 'bat_published_result_fee_separate_v1', eligible: row } } });

test('strict selected-answer contract cannot be rescued by a correct unused candidate', () => {
  assert.equal(gradeField('hammer_price', 12345, [{ at: 'wrong_selected', value: 15000 }, { at: 'unused', value: 12345 }]).verdict, 'pass');
  const wrong = gradeSelectedSale(strictLot, sourceBody, selectedResponse([{ ...selected, amount: 15000 }]), strictContext);
  assert.equal(wrong.verdict, 'fail'); assert.equal(wrong.supported_answer, false);
  assert(wrong.reasons.includes('selected_amount_mismatch'));
  assert.equal(gradeSelectedSale(strictLot, sourceBody, selectedResponse([selected]), strictContext).verdict, 'pass');
  assert.equal(gradeSelectedSale(strictLot, sourceBody, selectedResponse([selected, { ...selected, amount: 15000 }]), strictContext).verdict, 'fail');
  assert.equal(gradeSelectedSale(strictLot, sourceBody, selectedResponse([selected]), { vehicleId, cutoff }).verdict, 'not_assessed');
});

test('strict selected answers require independently retained bytes and exact source, unit, episode and cutoff', () => {
  for (const patch of [{ vehicleId: snapshotId }, { sourceSha256: 'bad' }, { currency: 'EUR' },
    { outcome: 'reserve_not_met' }, { priceBasis: 'buyer_total' }, { sourceEpisodeAncestry: 'unestablished' },
    { amount: 12346 }, { eventAt: '2026-01-02' }, { knownAt: '2026-01-05T00:00:00.000001Z' },
    { parsedAt: '2026-01-06T00:00:00Z' }, { sourceVehicleEventId: snapshotId }]) {
    assert.equal(gradeSelectedSale(strictLot, sourceBody, selectedResponse([{ ...selected, ...patch }]), strictContext).verdict, 'fail', JSON.stringify(patch));
  }
  for (const body of [null, Buffer.from('different source')])
    assert.equal(gradeSelectedSale(strictLot, body, selectedResponse([selected]), strictContext).verdict, 'not_assessed');
  const withheld = gradeSelectedSale(strictLot, sourceBody, selectedResponse([]), strictContext);
  assert.equal(withheld.verdict, 'withheld'); assert.equal(withheld.supported_answer, false);
  assert.equal(gradeSelectedSale({ ...strictLot, truth: { ...strictLot.truth, outcome: 'not_sold' } }, sourceBody,
    selectedResponse([selected]), strictContext).verdict, 'fail');
  const incomplete = selectedResponse([selected]); incomplete.value.receipt.coverage.complete = false;
  assert.equal(gradeSelectedSale(strictLot, sourceBody, incomplete, strictContext).verdict, 'not_assessed');
  assert.equal(gradeSelectedSale(strictLot, sourceBody, selectedResponse([selected]), { cutoff }).verdict, 'not_assessed');
  assert.equal(gradeSelectedSale(strictLot, sourceBody, selectedResponse([null]), strictContext).verdict, 'not_assessed');
  assert.equal(gradeSelectedSale(strictLot, sourceBody, selectedResponse([selected]),
    { ...strictContext, cutoff: '2999-01-01T00:00:00Z' }).verdict, 'not_assessed');
});

test('strict live path uses the existing anonymous bounded reader and makes no source request', async () => {
  const calls = [], client = publicClient(anonymousConfiguration({ SUPABASE_ANON_KEY: 'sb_publishable_synthetic' }), async (url, init) => {
    calls.push({ url, init });
    if (!init.body) return Response.json([{ id: vehicleId, is_public: true, deleted_at: null, listing_kind: null,
      year: 2000, make: 'Synthetic', model: 'Example Special' }]);
    const args = JSON.parse(init.body);
    const response = selectedResponse([selected]).value;
    response.query = { year: args.p_year, make: args.p_make, model: args.p_model };
    Object.assign(response.receipt, { event_from: args.p_event_from, event_before: args.p_event_before });
    response.receipt.knowledge_mode = args.p_knowledge_mode;
    return Response.json(response);
  });
  assert.equal((await assaySelectedSale(strictLot, null, { ...strictContext, client })).verdict, 'not_assessed');
  assert.equal(calls.length, 0);
  assert.equal((await assaySelectedSale(strictLot, sourceBody, { ...strictContext, client })).verdict, 'pass');
  assert.equal(calls.length, 2); assert(calls[1].url.endsWith('/rest/v1/rpc/valuation_by_ymm'));
  assert.equal(calls[1].init.headers.Authorization, undefined);
  const args = JSON.parse(calls[1].init.body);
  assert.equal(args.p_model, 'Example Special');
  assert.equal(args.p_knowledge_mode, 'retrospective'); assert.equal(args.p_event_from, '2026-01-01T00:00:00.000Z');
  assert.throws(() => client.rpc('valuation_by_ymm', { ...args, p_knowledge_mode: 'known_at' }), /invalid_reader_scope/);
  assert.throws(() => client.rpc('valuation_by_ymm', { ...args, p_subject_vehicle_id: vehicleId }), /invalid_reader_scope/);
  assert.throws(() => client.rpc('valuation_by_ymm', { ...args, p_event_from: '2020-01-01T00:00:00Z' }), /invalid_reader_scope/);
});

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
  const live = candidates({ v: { origin_metadata: { currency: 'EUR' } }, ma: { bid_count: 36, stream_state: { currency: 'EUR' } } });
  assert.equal(gradeField('bid_count', 36, live.bid_count).at, 'monitored_auctions.bid_count');
  assert.equal(gradeField('currency', 'EUR', live.currency).verdict, 'pass');
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

test('sale_date: a stored session window passes only when every day in it is a day the truth allows', () => {
  const truth = { one_of: ['2026-08-14', '2026-08-15'] };
  assert.equal(matches('sale_date', truth, ['2026-08-14', '2026-08-15']), true);
  assert.equal(matches('sale_date', truth, ['2026-08-14', '2026-08-22']), false);
  assert.equal(matches('sale_date', { value: '2022-08-19' }, ['2022-08-19']), true);
  assert.equal(matches('sale_date', truth, []), null);
  const c = candidates({ v: {}, ve: { sold_at: null, ended_at: null, metadata: { auction_session_days: ['2026-11-20', '2026-11-21'] } } });
  const g = gradeField('sale_date', { one_of: ['2026-11-20', '2026-11-21'] }, c.sale_date);
  assert.equal(g.verdict, 'pass');
  assert.equal(g.at, 'vehicle_events.metadata.auction_session_days');
  const real = candidates({ v: {}, ve: { sold_at: '2022-08-19T12:00:00Z', metadata: { auction_session_days: ['2022-08-19', '2022-08-20'] } } });
  assert.equal(gradeField('sale_date', { one_of: ['2022-08-19', '2022-08-20'] }, real.sale_date).at, 'vehicle_events.sold_at');
});
