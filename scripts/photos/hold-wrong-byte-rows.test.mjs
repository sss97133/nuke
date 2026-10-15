// Offline checks for hold-wrong-byte-rows.mjs: which rows count as wrong, which copy is named canonical, how the list is
// read and batched, and that a run is a dry run unless --apply is given.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addTally, batches, chooseCanonical, findWrongRows, isContentPath, parseArgs, pathOf, readList } from './hold-wrong-byte-rows.mjs';

const U = '00000000-0000-4000-9000-000000000001';
const h = (c) => c.repeat(64);
const pfx = `users/${U}/capture-relay/`;
const url = 'https://x.supabase.co/storage/v1/object/public/vehicle-photos/';

test('a run is a dry run unless --apply, and the bounds hold', () => {
  assert.equal(parseArgs(['list.jsonl']).apply, false);
  assert.equal(parseArgs(['list.jsonl', '--apply']).apply, true);
  assert.equal(parseArgs(['list.jsonl', '--limit', '5', '--batch', '50']).limit, 5);
  assert.throws(() => parseArgs(['list.jsonl', '--batch', '501']));
  assert.throws(() => parseArgs(['list.jsonl', '--limit', '0']));
  assert.throws(() => parseArgs(['--build', 'list.jsonl']), /--user/);
  assert.throws(() => parseArgs(['--build', 'list.jsonl', '--user', U, '--apply']));
  assert.throws(() => parseArgs([]));
});

test('the object path comes from storage_path, else from the public URL', () => {
  assert.equal(pathOf({ storage_path: `${pfx}IMG_0001.JPG` }), `${pfx}IMG_0001.JPG`);
  assert.equal(pathOf({ storage_path: null, image_url: `${url}${pfx}IMG_0001.JPG` }), `${pfx}IMG_0001.JPG`);
  assert.equal(pathOf({ storage_path: null, image_url: '' }), null);
  assert.ok(isContentPath({ user_id: U, file_hash: h('b'), storage_path: `${pfx}${h('b')}/IMG_0002.JPG` }));
  assert.ok(!isContentPath({ user_id: U, file_hash: h('b'), storage_path: `${pfx}IMG_0002.JPG` }));
});

test('a row is wrong when its file_hash is not the hash of the object it points at', () => {
  const rows = [
    { id: '00000000-0000-4000-a000-0000000000a0', storage_path: `${pfx}IMG_0001.JPG`, file_hash: h('a') },
    { id: '00000000-0000-4000-a000-0000000000a1', storage_path: null, image_url: `${url}${pfx}IMG_0001.JPG`, file_hash: h('c') },
    { id: '00000000-0000-4000-a000-0000000000a2', storage_path: `${pfx}IMG_0002.JPG`, file_hash: null },
    { id: '00000000-0000-4000-a000-0000000000a3', storage_path: null, image_url: '', file_hash: h('d') },
  ];
  const sha = new Map([[`${pfx}IMG_0001.JPG`, h('a')], [`${pfx}IMG_0002.JPG`, h('e')]]);
  assert.deepEqual(findWrongRows(rows, sha), [{ image_id: '00000000-0000-4000-a000-0000000000a1',
    storage_path: `${pfx}IMG_0001.JPG`, object_sha256: h('a'), row_file_hash: h('c') }]);
  assert.throws(() => findWrongRows([{ id: 'x', storage_path: 'missing', file_hash: h('a') }], sha), /no object hash/);
});

test('the canonical copy is the earliest unsuperseded, unwrong row whose object hashes to the photo', () => {
  const sib = (id, path, created_at, extra = {}) => ({ id, user_id: U, file_hash: h('c'), storage_path: path, created_at, ...extra });
  const siblings = [
    sib('b', `users/${U}/photo-sync/B.jpg`, '2026-09-28T18:00:00Z'),
    sib('a', `users/${U}/photo-sync/A.jpg`, '2026-09-28T17:00:00Z', { is_superseded: true }),
    sib('w', `${pfx}IMG_0001.JPG`, '2026-06-14T00:00:00Z'),
    sib('c', `${pfx}${h('c')}/IMG_0001.JPG`, '2026-06-01T00:00:00Z'),
    sib('d', `users/${U}/photo-sync/D.jpg`, '2026-09-28T16:00:00Z'),
    sib('e', `users/${U}/photo-sync/E.jpg`, '2026-09-28T19:00:00Z'),
  ];
  const sha = new Map([[`users/${U}/photo-sync/B.jpg`, h('c')], [`users/${U}/photo-sync/A.jpg`, h('c')],
    [`${pfx}IMG_0001.JPG`, h('a')], [`users/${U}/photo-sync/D.jpg`, h('f')], [`users/${U}/photo-sync/E.jpg`, h('c')]]);
  assert.equal(chooseCanonical(h('c'), siblings, sha, new Set(['w']))?.id, 'b');
  assert.equal(chooseCanonical(h('c'), siblings, sha, new Set(['w', 'b']))?.id, 'e');
  assert.equal(chooseCanonical(h('9'), siblings, sha, new Set()), null);
});

test('the list is validated, batched and tallied', () => {
  const line = (o) => JSON.stringify(o);
  const ok = { image_id: '00000000-0000-4000-a000-0000000000a1', storage_path: `${pfx}IMG_0001.JPG`, object_sha256: h('a'),
    row_file_hash: h('c'), canonical_id: '00000000-0000-4000-a000-0000000000c1', canonical_storage_path: 'p', canonical_sha256: h('c') };
  assert.deepEqual(readList(`${line(ok)}\n\n`), [{ image_id: ok.image_id, storage_path: ok.storage_path, object_sha256: h('a'),
    canonical_id: ok.canonical_id, canonical_storage_path: 'p', canonical_sha256: h('c') }]);
  assert.throws(() => readList(line({ ...ok, object_sha256: 'ABC' })), /line 1/);
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(addTally({ held: 1 }, { held: 2, linked: 1 }), { held: 3, linked: 1 });
});
