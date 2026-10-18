// Contract for scripts/ci/invalid-indexes.mjs: the README line, reading it back, and what counts as a new invalid index.
//   node --test scripts/ci/invalid-indexes.test.mjs   (run by scripts/ci/verify.sh)
// Rows are shaped like the live query's: tbl, idx, ready, bytes. Names and sizes are the ones measured on 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INVALID_INDEXES_SQL, invalidIndexesLine, newlyInvalid, previousInvalidIndexes, riseReport } from './invalid-indexes.mjs';

const AC = { tbl: 'auction_comments', idx: 'idx_ac_question_l1', ready: true, bytes: 51_380_224 };
const VI = { tbl: 'vehicle_images', idx: 'idx_vehicle_images_dhash', ready: false, bytes: 0 };
const BL = { tbl: 'bat_listings', idx: 'idx_bat_listings_seller_username', ready: true, bytes: 2_752_512 };

test('no invalid index prints a zero the next run can read back', () => {
  const line = invalidIndexesLine([]);
  assert.equal(line, 'Invalid indexes in `public`: 0.');
  assert.deepEqual(previousInvalidIndexes(line), { count: 0, names: new Set() });
});

test('every index is named with its table, readiness and size', () => {
  const line = invalidIndexesLine([AC, VI, BL]);
  assert.match(line, /^Invalid indexes in `public`: 3\./);
  assert.match(line, /`idx_ac_question_l1` on `auction_comments` \(ready, 49 MB\)/);
  assert.match(line, /`idx_vehicle_images_dhash` on `vehicle_images` \(not ready, 0 bytes\)/);
  assert.match(line, /`idx_bat_listings_seller_username` on `bat_listings` \(ready, 3 MB\)/);
});

test('a line read back from the README returns its count and names', () => {
  const readme = ['before', invalidIndexesLine([AC, VI]), 'after `idx_other` on `t` (ready, 1 MB)'].join('\n');
  const prev = previousInvalidIndexes(readme);
  assert.equal(prev.count, 2);
  assert.deepEqual([...prev.names].sort(), ['idx_ac_question_l1', 'idx_vehicle_images_dhash']);
});

test('a README block with no such line gives nothing to compare, so nothing fails', () => {
  assert.equal(previousInvalidIndexes('The database describing itself: 944 tables.'), null);
  assert.deepEqual(newlyInvalid([AC, VI, BL], null), []);
});

test('only an index the previous block did not list counts as new', () => {
  const prev = previousInvalidIndexes(invalidIndexesLine([AC, VI]));
  assert.deepEqual(newlyInvalid([AC, VI], prev), [], 'the same two are not new');
  assert.deepEqual(newlyInvalid([VI], prev), [], 'a fixed one is not new');
  assert.deepEqual(newlyInvalid([], prev), [], 'none left is not new');
  assert.deepEqual(newlyInvalid([AC, VI, BL], prev), [BL], 'a third is new');
  assert.deepEqual(newlyInvalid([BL], prev), [BL], 'one swapped for another is new even when the count falls');
});

test('after a clean block any invalid index is new', () => {
  const prev = previousInvalidIndexes(invalidIndexesLine([]));
  assert.deepEqual(newlyInvalid([BL], prev), [BL]);
});

test('the query reads public only and leaves out a build that is running', () => {
  assert.match(INVALID_INDEXES_SQL, /nspname = 'public'/);
  assert.match(INVALID_INDEXES_SQL, /not i\.indisvalid/);
  assert.match(INVALID_INDEXES_SQL, /pg_stat_progress_create_index/);
  assert.doesNotMatch(INVALID_INDEXES_SQL, /;/, 'the caller wraps it in a read-only transaction');
});

test('the report names a new index and its table, and stays silent when nothing is new', () => {
  const before = ['x', invalidIndexesLine([AC, VI]), 'y'].join('\n');
  assert.equal(riseReport([AC, VI], before), null);
  assert.equal(riseReport([], before), null);
  assert.equal(riseReport([AC, VI, BL], 'a README block with no such line yet'), null);
  const report = riseReport([AC, VI, BL], before);
  assert.match(report, /^INVALID INDEX appeared since the last measurement: idx_bat_listings_seller_username on bat_listings\./);
  assert.doesNotMatch(report, /idx_ac_question_l1|idx_vehicle_images_dhash/, 'only the new one is named');
});
