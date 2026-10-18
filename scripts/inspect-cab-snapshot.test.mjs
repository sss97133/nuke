import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessCabCapture, requireCabCapture } from './inspect-cab-snapshot.mjs';

const row = (id, extra = {}) => ({ id, type: 1, timestamp: '2026-10-18T12:00:00Z', ...extra });
function input(items = [row('comment'), row('bid', { type: 2, amount: 12000 })]) {
  return {
    auctionId: 'lot-1',
    detailRes: { ok: true, data: { id: 'lot-1', listing: {}, stats: { bids: 1, comments: 1 } } },
    commentsRes: { ok: true, data: { comments_and_bids: items } },
  };
}

test('ordinary capture reconciles bids without certifying comments, database or public readiness', () => {
  const result = requireCabCapture(input());
  assert.equal(result.received_bids, 1);
  assert.equal(result.distinct_source_ids, 2);
  assert.equal(result.bid_reconciliation, 'matched');
  for (const key of ['comment_reconciliation', 'database_reconciliation', 'public_readiness']) {
    assert.equal(result[key], 'not_assessed');
  }
  assert.deepEqual(requireCabCapture(input()), result, 'repeat capture assessment is deterministic');
});

test('actual collector refuses failed thread requests before any database operation', async () => {
  const value = input();
  value.commentsRes = { ok: false, status: 503, data: null };
  assert.throws(() => requireCabCapture(value), /comments_request_failed/);
  const source = readFileSync(new URL('./cab-api-sync.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function extractSingleAuctionGoldStandard');
  const end = source.indexOf('\n/**', start);
  const collector = new Function('requireCabCapture', 'supabase',
    `${source.slice(start, end)}; return extractSingleAuctionGoldStandard;`)(requireCabCapture, {
    from() { assert.fail('refused capture must not reach a database operation'); },
  });
  const cab = { callApi: async (version) => version === 'v2' ? value.detailRes : value.commentsRes };
  await assert.rejects(collector(cab, value.auctionId), /comments_request_failed/);
  value.commentsRes = input([row('no-clock', { timestamp: null })]).commentsRes;
  await assert.rejects(collector(cab, value.auctionId), /source_time_missing/);
});

test('malformed response and wrong auction cannot supply a capture', () => {
  const value = input();
  value.commentsRes.data = {};
  assert.throws(() => requireCabCapture(value), /comments_payload_missing/);
  value.detailRes.data.id = 'another-lot';
  assert(assessCabCapture(value).blockers.includes('listing_identity_mismatch'));
});

test('missing IDs, duplicate IDs and missing clocks refuse lossy downstream fallback', () => {
  for (const [items, reason] of [
    [[row(null)], 'source_id_missing'],
    [[row('a'), row('a')], 'duplicate_source_id'],
    [[row('a', { timestamp: null })], 'source_time_missing'],
    [[row('a', { timestamp: 'bad-clock' })], 'source_time_missing'],
    [[null], 'source_id_missing'],
  ]) assert(assessCabCapture(input(items)).blockers.includes(reason));
});

test('unknown and explicit zero source bid counts remain distinct', () => {
  const value = input([]);
  delete value.detailRes.data.stats.bids;
  assert.equal(requireCabCapture(value).bid_reconciliation, 'not_assessed');
  value.detailRes.data.stats.bids = 0;
  assert.equal(requireCabCapture(value).bid_reconciliation, 'matched');
  value.detailRes.data.stats.bids = 1;
  assert.throws(() => requireCabCapture(value), /bid_count_mismatch/);
});

test('bad bid amounts and a full limited response cannot masquerade as complete history', () => {
  assert.throws(() => requireCabCapture(input([row('bid', { type: 2, amount: -1 })])), /bid_amount_invalid/);
  const value = input();
  value.limit = 2;
  assert.throws(() => requireCabCapture(value), /response_limit_reached/);
});

test('comment count disagreement stays unassessed while independently reconciled bids pass', () => {
  const value = input();
  value.detailRes.data.stats.comments = 77;
  const result = requireCabCapture(value);
  assert.equal(result.source_reported_comments, 77);
  assert.equal(result.comment_reconciliation, 'not_assessed');
  assert.equal(result.bid_reconciliation, 'matched');
});

test('actual historical dispatch preserves its skip population and labels it previously processed', async () => {
  const source = readFileSync(new URL('./cab-api-sync.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function runHistoricalBackfill');
  const end = source.indexOf('\nasync function main()', start);
  const messages = [];
  const data = {
    auction_events: [{ source_listing_id: 'lot-1', vehicle_id: 'vehicle-1', comments_count: 1 }],
    vehicles: [{ id: 'vehicle-1', vin: 'ABCDE' }],
    vehicle_observations: [{ vehicle_id: 'vehicle-1' }],
  };
  const database = { from(table) { return {
    select() { return this; }, eq() { return this; }, in() { return this; },
    then(resolve) { return Promise.resolve({ data: data[table] }).then(resolve); },
  }; } };
  const run = new Function('supabase', 'fs', 'console', 'waitForIoGate', 'cabObservationSourceIds',
    `${source.slice(start, end)}; return runHistoricalBackfill;`)(database,
    { mkdirSync() {}, writeFileSync() { assert.fail('no unrequested processing'); } },
    { log(message) { messages.push(message); }, warn() { assert.fail('unexpected warning'); } },
    async () => {}, async () => ['source-1']);
  let calls = 0;
  await run({ async callApi() { calls++; return { ok: true, data: { auctions: [{ id: 'lot-1' }] } }; } }, 1, 1);
  assert.equal(calls, 1, 'only the existing source-page request; no lot re-extraction');
  assert(messages.some(message => message.includes('1 previously processed; completeness not assessed, 0 to extract')));
});

test('offline retained capture CLI emits counts without source bodies, identities or network credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cab-capture-'));
  try {
    const file = join(directory, 'capture.json');
    const value = input();
    value.commentsRes.data.comments_and_bids[0].text = 'PRIVATE_SOURCE_TEXT';
    writeFileSync(file, JSON.stringify({ detail: value.detailRes.data, ...value.commentsRes.data }));
    const result = spawnSync(process.execPath, ['scripts/inspect-cab-snapshot.mjs', '--api-json', file], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).transport_verification, 'not_assessed');
    assert(!result.stdout.includes('PRIVATE_SOURCE_TEXT'));
    writeFileSync(file, JSON.stringify({ detail: value.detailRes.data }));
    const failed = spawnSync(process.execPath, ['scripts/inspect-cab-snapshot.mjs', '--api-json', file], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.equal(failed.status, 1);
    assert(JSON.parse(failed.stdout).blockers.includes('comments_payload_missing'));
  } finally {
    rmSync(directory, { recursive: true });
  }
});
