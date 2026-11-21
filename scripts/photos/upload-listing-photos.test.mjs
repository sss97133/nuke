import assert from 'node:assert/strict';
import { test } from 'node:test';

import { batches, parseArgs, readUrls, send, unshift } from './upload-listing-photos.mjs';

const VEHICLE = '0a0a0a0a-0000-4000-8000-00000000000a';
const shiftUp = (text) => Array.from(text, (c) => String.fromCodePoint(c.codePointAt(0) + 1)).join('');

test('parseArgs takes a vehicle id and a file, and refuses anything else', () => {
  assert.deepEqual(parseArgs([VEHICLE, 'urls.txt']), { vehicleId: VEHICLE, file: 'urls.txt', shifted: false, batch: 3, dryRun: false });
  assert.deepEqual(parseArgs(['--shifted', VEHICLE, 'urls.txt', '--batch', '2', '--dry-run']),
    { vehicleId: VEHICLE, file: 'urls.txt', shifted: true, batch: 2, dryRun: true });
  assert.throws(() => parseArgs(['not-an-id', 'urls.txt']), /vehicle id/);
  assert.throws(() => parseArgs([VEHICLE]), /usage/);
  assert.throws(() => parseArgs([VEHICLE, 'urls.txt', '--batch']), /needs a value/);
  assert.throws(() => parseArgs([VEHICLE, 'urls.txt', '--batch', '0']), /1 to 10/);
  assert.throws(() => parseArgs([VEHICLE, 'urls.txt', '--apply']), /unknown option/);
});

test('readUrls reads lines or a JSON array, drops blanks and repeats, and refuses what is not https', () => {
  assert.deepEqual(readUrls('https://a.example/1.jpg\n\n https://a.example/2.jpg \nhttps://a.example/1.jpg\n'),
    ['https://a.example/1.jpg', 'https://a.example/2.jpg']);
  assert.deepEqual(readUrls('["https://a.example/1.jpg", "https://a.example/2.jpg"]'),
    ['https://a.example/1.jpg', 'https://a.example/2.jpg']);
  assert.throws(() => readUrls('http://a.example/1.jpg'), /not an https URL/);
  assert.throws(() => readUrls('[1, 2]'), /array of strings/);
});

test('--shifted moves every character back one code point, and a wrong setting fails before anything is sent', () => {
  const plain = 'https://a.example/photo_1.jpg?x=1&y=2';
  assert.equal(unshift(shiftUp(plain)), plain);
  assert.deepEqual(readUrls(shiftUp(plain), { shifted: true }), [plain]);
  assert.throws(() => readUrls(shiftUp(plain)), /check --shifted/);
  assert.throws(() => readUrls(plain, { shifted: true }), /check --shifted/);
});

test('batches splits in order', () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
});

test('send posts each batch with the key on apikey and adds up what the function reports', async () => {
  const calls = [];
  const lines = [];
  const answers = [
    { ok: true, status: 200, body: { uploaded: 3, failed: 0, results: [] } },
    { ok: true, status: 200, body: { uploaded: 1, failed: 1, results: [{ index: 0, success: true }, { index: 1, success: false, error: 'HTTP 403' }] } },
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const a = answers[calls.length - 1];
    return { ok: a.ok, status: a.status, text: async () => JSON.stringify(a.body) };
  };
  const urls = [1, 2, 3, 4, 5].map((n) => `https://a.example/${n}.jpg`);
  const total = await send({ url: 'https://project.example', key: 'sb_secret_test' }, { vehicleId: VEHICLE, batch: 3 }, urls,
    { fetchImpl, log: (line) => lines.push(line) });

  assert.deepEqual(total, { urls: 5, stored: 4, failed: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://project.example/functions/v1/fb-photo-upload');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, { apikey: 'sb_secret_test', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { vehicle_id: VEHICLE, image_urls: urls.slice(0, 3) });
  assert.deepEqual(JSON.parse(calls[1].init.body), { vehicle_id: VEHICLE, image_urls: urls.slice(3) });
  assert.deepEqual(lines, ['call 1: stored 3, failed 0', 'call 2: stored 1, failed 1 (#2 HTTP 403)']);
  assert.ok(lines.every((line) => !line.includes('sb_secret_')));
});

test('a refused call, a broken answer and a request error each count every URL in the call as failed', async () => {
  const lines = [];
  const answers = [
    async () => ({ ok: false, status: 401, text: async () => '{"error":"unauthorized"}' }),
    async () => ({ ok: true, status: 200, text: async () => 'not json' }),
    async () => { throw new Error('timed out'); },
  ];
  let n = 0;
  const fetchImpl = (...args) => answers[n++](...args);
  const urls = [1, 2, 3, 4, 5].map((i) => `https://a.example/${i}.jpg`);
  const total = await send({ url: 'https://project.example', key: 'sb_secret_test' }, { vehicleId: VEHICLE, batch: 2 }, urls,
    { fetchImpl, log: (line) => lines.push(line) });

  assert.deepEqual(total, { urls: 5, stored: 0, failed: 5 });
  assert.match(lines[0], /^call 1: 2 failed, HTTP 401/);
  assert.match(lines[1], /^call 2: 2 failed, the answer was not JSON/);
  assert.match(lines[2], /^call 3: 1 failed, request error: timed out/);
});
