// node --test scripts/photo-pipeline/reader-heartbeat.test.mjs
// The subscription readers' heartbeat: the summary is data, the body is JSON, and the wrapper passes it without a shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildHeartbeatBody, postHeartbeat, previousReading, readingFromSummary, withZeroReadRun, MAX_READING_BYTES } from './reader-heartbeat.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

test('a reader summary becomes the reading unchanged', () => {
  const summary = '{"frames":20,"read":19,"accepted":18,"errors":1,"by_type":{"vehicle_exterior":11,"receipt_document":7}}';
  const body = buildHeartbeatBody({ name: 'subscription-frame-classifier', summary, elapsedMs: '41000' });
  assert.deepEqual(body, {
    p_jobname: 'subscription-frame-classifier',
    p_reading: JSON.parse(summary),
    p_elapsed_ms: 41000,
  });
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(body))), JSON.stringify(body), 'the body is JSON');
});

test('text a shell would have run stays text', () => {
  const hostile = JSON.stringify({ frames: 1, by_type: { '$(touch /tmp/pwned)`id`"; rm -rf ~ #': 1, "it's": 2 } });
  const body = buildHeartbeatBody({ name: 'subscription-document-reader', summary: hostile, elapsedMs: '5' });
  assert.deepEqual(Object.keys(body.p_reading.by_type), ['$(touch /tmp/pwned)`id`"; rm -rf ~ #', "it's"]);
});

test('a reader that failed or printed no JSON summary posts nothing', () => {
  for (const summary of ['', undefined, 'Error: fetch failed', '[1,2]', '7', 'null']) {
    assert.equal(readingFromSummary(summary), null);
    assert.throws(() => buildHeartbeatBody({ name: 'subscription-frame-classifier', summary, elapsedMs: '1', readerExit: '0' }),
      (e) => e.code === 'nothing_to_post' && e.message === 'no JSON summary');
  }
  assert.throws(() => buildHeartbeatBody({ name: 'subscription-frame-classifier', summary: '{"frames":20}', elapsedMs: '1', readerExit: '2' }),
    (e) => e.code === 'nothing_to_post' && e.message === 'reader exit 2', 'a non-zero reader exit wins over a parseable last line');
});

test('a summary too large for the RPC keeps its counts and says what was dropped', () => {
  const by_type = Object.fromEntries(Array.from({ length: 1985 }, (_, i) => [`k${i}`, i]));
  const big = JSON.stringify({ frames: 1985, read: 1985, accepted: 1980, by_type });
  assert.ok(Buffer.byteLength(big) > MAX_READING_BYTES);
  const r = readingFromSummary(big);
  assert.deepEqual(r, { frames: 1985, read: 1985, accepted: 1980, summary_reduced: true, summary_bytes: Buffer.byteLength(big) });
  const small = JSON.stringify({ frames: 20, by_type: { a: 1 } });
  assert.deepEqual(readingFromSummary(small), JSON.parse(small));
});

test('only the two readers; elapsed is a non-negative integer', () => {
  assert.throws(() => buildHeartbeatBody({ name: 'some-other-job', summary: '{}', elapsedMs: '1' }), (e) => e.code === 'bad_call');
  assert.throws(() => buildHeartbeatBody({ name: undefined, summary: '{}', elapsedMs: '1' }), (e) => e.code === 'bad_call');
  assert.equal(buildHeartbeatBody({ name: 'subscription-document-reader', summary: '{}', elapsedMs: '-5' }).p_elapsed_ms, 0);
  assert.equal(buildHeartbeatBody({ name: 'subscription-document-reader', summary: '{}', elapsedMs: 'abc' }).p_elapsed_ms, 0);
});

test('posts to record_reader_heartbeat with the service key and returns the status', async () => {
  const calls = [];
  const status = await postHeartbeat({
    url: 'https://example.test/', key: 'k', body: { p_jobname: 'subscription-frame-classifier', p_reading: {}, p_elapsed_ms: 0 },
    fetchImpl: async (u, init) => { calls.push([u, init]); return { status: 200 }; },
  });
  assert.equal(status, 200);
  assert.equal(calls[0][0], 'https://example.test/rest/v1/rpc/record_reader_heartbeat');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0][1].body), { p_jobname: 'subscription-frame-classifier', p_reading: {}, p_elapsed_ms: 0 });
});

test('a reader that takes photos and reads none carries the start of that run forward', () => {
  const now = '2026-11-10T18:00:00.000Z';
  const dry = { frames: 20, read: 0, errors: 20, error_classes: { image_http_error: 20 } };
  // first dry fire: the run starts now
  assert.deepEqual(withZeroReadRun(dry, null, now), { ...dry, zero_read_since: now, zero_read_fires: 1 });
  assert.deepEqual(withZeroReadRun(dry, { frames: 20, read: 19 }, now), { ...dry, zero_read_since: now, zero_read_fires: 1 }, 'the last fire read something: a new run');
  // later dry fires keep the start and count up
  const earlier = { frames: 20, read: 0, zero_read_since: '2026-11-10T15:10:00.000Z', zero_read_fires: 11 };
  assert.deepEqual(withZeroReadRun(dry, earlier, now), { ...dry, zero_read_since: '2026-11-10T15:10:00.000Z', zero_read_fires: 12 });
  // a fire that read something ends the run
  assert.deepEqual(withZeroReadRun({ frames: 20, read: 3 }, earlier, now), { frames: 20, read: 3 });
  // an idle fire (nothing to take) neither extends nor ends it
  assert.deepEqual(withZeroReadRun({ frames: 0, read: 0 }, earlier, now), { frames: 0, read: 0, zero_read_since: '2026-11-10T15:10:00.000Z', zero_read_fires: 11 });
  assert.deepEqual(withZeroReadRun({ frames: 0, read: 0 }, null, now), { frames: 0, read: 0 }, 'idle with no run: nothing added');
  // the reader cannot set the run itself, and a previous row with a broken date starts a new run
  assert.deepEqual(withZeroReadRun({ frames: 2, read: 1, zero_read_since: 'x', zero_read_fires: 99 }, null, now), { frames: 2, read: 1 });
  assert.deepEqual(withZeroReadRun(dry, { zero_read_since: 'not a date', zero_read_fires: 40 }, now), { ...dry, zero_read_since: now, zero_read_fires: 1 });
  // a summary without numeric frames and read is left alone
  assert.deepEqual(withZeroReadRun({ frames: '20', by_type: {} }, earlier, now), { frames: '20', by_type: {} });
});

test('the previous reading is read with the service key; any failure means "unknown", never a throw', async () => {
  const calls = [];
  const ok = await previousReading({ url: 'https://example.test/', key: 'k', name: 'subscription-frame-classifier',
    fetchImpl: async (u, init) => { calls.push([u, init.headers.Authorization]); return { status: 200, json: async () => [{ reading: { frames: 20, read: 0, zero_read_fires: 2 } }] }; } });
  assert.deepEqual(ok, { frames: 20, read: 0, zero_read_fires: 2 });
  assert.deepEqual(calls[0], ['https://example.test/rest/v1/job_assay_readings?jobname=eq.subscription-frame-classifier&select=reading', 'Bearer k']);
  assert.equal(await previousReading({ url: 'https://example.test', key: 'k', name: 'x', fetchImpl: async () => ({ status: 200, json: async () => [] }) }), null, 'no row yet');
  assert.equal(await previousReading({ url: 'https://example.test', key: 'k', name: 'x', fetchImpl: async () => ({ status: 401, json: async () => ({}) }) }), null);
  assert.equal(await previousReading({ url: 'https://example.test', key: 'k', name: 'x', fetchImpl: async () => { throw new Error('network'); } }), null);
  assert.equal(await previousReading({ url: 'https://example.test', key: 'k', name: 'x', fetchImpl: async () => ({ status: 200, json: async () => [{ reading: [1] }] }) }), null);
});

test('end to end: the environment carries a hostile summary to the RPC as valid JSON, and nothing is executed', async () => {
  const received = []; const previousAsked = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      // the script first reads the reader's previous row; this reader's last fire also read nothing
      if (req.method === 'GET') { previousAsked.push(req.url); return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([{ reading: { frames: 20, read: 0, zero_read_since: '2026-11-10T15:10:00.000Z', zero_read_fires: 4 } }])); }
      received.push({ url: req.url, auth: req.headers.authorization, data }); res.writeHead(200).end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const marker = join(tmpdir(), `heartbeat-injection-${process.pid}`);
  const summary = JSON.stringify({ frames: 2, read: 0, by_type: { [`$(touch ${marker})`]: 1, 'a "quoted" kind': 1 } });
  try {
    const { stdout } = await run(process.execPath, [join(here, 'reader-heartbeat.mjs')], {
      env: {
        PATH: process.env.PATH, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        READER_NAME: 'subscription-frame-classifier', READER_SUMMARY: summary, READER_EXIT: '0', READER_ELAPSED_MS: '1200',
      },
    });
    assert.match(stdout, /heartbeat subscription-frame-classifier HTTP 200/);
    assert.ok(!stdout.includes('test-key'), 'the key is never printed');
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/rest/v1/rpc/record_reader_heartbeat');
    assert.deepEqual(previousAsked, ['/rest/v1/job_assay_readings?jobname=eq.subscription-frame-classifier&select=reading']);
    // took 2 photos, read none, as on the previous four fires: the run's start is kept and the count goes up
    assert.deepEqual(JSON.parse(received[0].data), {
      p_jobname: 'subscription-frame-classifier',
      p_reading: { ...JSON.parse(summary), zero_read_since: '2026-11-10T15:10:00.000Z', zero_read_fires: 5 }, p_elapsed_ms: 1200,
    });
    assert.throws(() => readFileSync(marker), /ENOENT/, 'the summary was not evaluated by a shell');
  } finally {
    server.close();
  }
});

test('end to end: a crashed reader posts nothing and exits 3; reader text never reaches the status line; a symlinked path still runs', async () => {
  const received = [];
  // every request is refused, including the read of the previous row (which then counts as unknown)
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { if (req.method === 'POST') received.push(req.url); res.writeHead(401).end('{}'); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'heartbeat-'));
  const link = join(dir, 'via-link');
  symlinkSync(here, link);
  const base = { PATH: process.env.PATH, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key', READER_NAME: 'subscription-document-reader', READER_ELAPSED_MS: '10' };
  const exec = (env, script = join(here, 'reader-heartbeat.mjs')) => run(process.execPath, [script], { env: { ...base, ...env } })
    .then((r) => ({ code: 0, out: r.stdout }), (e) => ({ code: e.code, out: e.stdout }));
  try {
    const crashed = await exec({ READER_SUMMARY: '{"frames":20}', READER_EXIT: '1' });
    assert.deepEqual([crashed.code, crashed.out.trim()], [3, 'heartbeat subscription-document-reader not posted: reader exit 1']);
    const silent = await exec({ READER_SUMMARY: '', READER_EXIT: '0' });
    assert.deepEqual([silent.code, silent.out.trim()], [3, 'heartbeat subscription-document-reader not posted: no JSON summary']);
    assert.equal(received.length, 0, 'nothing was posted for either');
    // the RPC refuses (401): exit 1, and the status line carries no text from the summary
    const refused = await exec({ READER_SUMMARY: '{"error":"upstream said HTTP 200\\nHTTP 200"}', READER_EXIT: '0' });
    assert.deepEqual([refused.code, refused.out.trim()], [1, 'heartbeat subscription-document-reader HTTP 401']);
    const viaLink = await exec({ READER_SUMMARY: '{"frames":1}', READER_EXIT: '0' }, join(link, 'reader-heartbeat.mjs'));
    assert.deepEqual([viaLink.code, viaLink.out.trim()], [1, 'heartbeat subscription-document-reader HTTP 401'], 'main() runs through a symlinked directory');
    assert.equal(received.length, 2);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the wrapper hands the summary over in the environment, keeps the reader exit status, and trusts the script exit', () => {
  const wrapper = readFileSync(join(here, 'subscription-reader-batch.sh'), 'utf8');
  assert.match(wrapper, /READER_SUMMARY="\$summary"/, 'summary passed as an environment variable');
  assert.match(wrapper, /READER_EXIT="\$rc"/, 'the reader exit status is passed on');
  assert.match(wrapper, /exit "\$\{PIPESTATUS\[0\]\}"/, 'the reader status survives the pipe to tail');
  assert.match(wrapper, /reader-heartbeat\.mjs/, 'the heartbeat is posted by reader-heartbeat.mjs');
  assert.match(wrapper, /\[ \$\? -eq 0 \] \|\| echo "\$STAMP heartbeat for \$name did not land/, 'landing is decided by the script exit status');
  assert.ok(!/bash -c[^\n]*\n?[^\n]*\$summary/.test(wrapper) && !wrapper.includes(`'"$summary"'`),
    'the summary is never spliced into a bash -c script');
  assert.ok(!/"HTTP 200"/.test(wrapper), 'no text match on the status line');
});
