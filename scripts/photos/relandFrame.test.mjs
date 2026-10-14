import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameFromExif, takenAt, parseArgs } from './relandFrame.mjs';

const P = 'users/0b9f107a-0000-4000-8000-000000000001/capture-relay/IMG_0196.HEIC';
const H = 'ab'.repeat(32);

test('a phone frame keeps its own EXIF time, place and camera', () => {
  const f = frameFromExif(P, H, { DateTimeOriginal: '2026:06:25 10:58:12', OffsetTimeOriginal: '-07:00', latitude: 36.1234567, longitude: -115.1234567, Make: 'Apple', Model: 'iPhone 11 Pro' });
  assert.deepEqual(f, { storage_path: P, file_hash: H, taken_at: '2026-06-25T17:58:12.000Z', latitude: 36.123457, longitude: -115.123457, camera_make: 'Apple', camera_model: 'iPhone 11 Pro' });
});

test('no offset and no fallback: no time rather than a guessed one', () => {
  assert.equal(takenAt('2026:06:25 10:58:12', undefined), null);
  assert.equal(takenAt('2026:06:25 10:58:12', undefined, '-07:00'), '2026-06-25T17:58:12.000Z');
  assert.equal(takenAt('not a date', '-07:00'), null);
  assert.equal(takenAt(undefined, '-07:00'), null);
});

test('missing EXIF gives a frame with only what the object proves', () => {
  assert.deepEqual(frameFromExif(P, H, null), { storage_path: P, file_hash: H });
  assert.deepEqual(frameFromExif(P, H, { Make: '  ', latitude: NaN }), { storage_path: P, file_hash: H });
});

test('arguments: dry run by default, bounded limit and concurrency', () => {
  assert.deepEqual(parseArgs([]), { write: false, limit: 50, after: '', concurrency: 3, log: null });
  assert.deepEqual(parseArgs(['--write', '--limit', '99999', '--concurrency', '40', '--after', 'users/x']), { write: true, limit: 5000, after: 'users/x', concurrency: 6, log: null });
  assert.throws(() => parseArgs(['--force']), /unknown argument/);
});
