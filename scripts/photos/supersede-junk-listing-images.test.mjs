// Offline checks for supersede-junk-listing-images.mjs: how the list is read and batched, and that a run is a dry run
// unless --apply is given.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addTally, batches, parseArgs, readList } from './supersede-junk-listing-images.mjs';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

test('a run is a dry run unless --apply, and the bounds hold', () => {
  assert.equal(parseArgs(['list.json']).apply, false);
  assert.equal(parseArgs(['list.json']).batch, 25);
  assert.equal(parseArgs(['list.json', '--apply']).apply, true);
  assert.equal(parseArgs(['list.json', '--limit', '5', '--batch', '100']).limit, 5);
  assert.throws(() => parseArgs(['list.json', '--batch', '101']));
  assert.throws(() => parseArgs(['list.json', '--limit', '0']));
  assert.throws(() => parseArgs(['list.json', '--bogus']));
  assert.throws(() => parseArgs([]));
});

test('the list is a JSON array or JSONL of ids or {vehicle_id}, deduplicated in order', () => {
  assert.deepEqual(readList(JSON.stringify([{ vehicle_id: A, source: 'Bonhams' }, { vehicle_id: B }, { vehicle_id: A }])), [A, B]);
  assert.deepEqual(readList(JSON.stringify([B, A.toUpperCase()])), [B, A]);
  assert.deepEqual(readList(`{"vehicle_id":"${A}"}\n\n"${B}"\n`), [A, B]);
  assert.throws(() => readList(JSON.stringify([{ id: A }])), /item 1/);
});

test('batches cover the list in order and tallies add up', () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(addTally({ superseded: 2 }, { superseded: 3, nominated: 1 }), { superseded: 5, nominated: 1 });
});
