// node --test scripts/photo-pipeline/reader-heartbeat.test.mjs
// The subscription readers' heartbeat: the summary is data, the body is JSON, and the wrapper passes it without a shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildHeartbeatBody, postHeartbeat, readingFromSummary, MAX_READING_BYTES } from './reader-heartbeat.mjs';

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

test('a summary that is not a JSON object is reported, never forwarded as a shape the RPC refuses', () => {
  assert.deepEqual(readingFromSummary(''), { error: 'no_summary' });
  assert.deepEqual(readingFromSummary(undefined), { error: 'no_summary' });
  assert.equal(readingFromSummary('Error: fetch failed').error, 'summary_not_json');
  assert.equal(readingFromSummary('Error: fetch failed').summary_excerpt, 'Error: fetch failed');
  assert.deepEqual(readingFromSummary('[1,2]'), { error: 'summary_not_object', summary_type: 'array' });
  assert.deepEqual(readingFromSummary('7'), { error: 'summary_not_object', summary_type: 'number' });
  const big = JSON.stringify({ blob: 'x'.repeat(MAX_READING_BYTES) });
  assert.equal(readingFromSummary(big).error, 'summary_too_large');
});

test('only the two readers; elapsed is a non-negative integer', () => {
  assert.throws(() => buildHeartbeatBody({ name: 'some-other-job', summary: '{}', elapsedMs: '1' }), /unknown reader/);
  assert.throws(() => buildHeartbeatBody({ name: undefined, summary: '{}', elapsedMs: '1' }), /unknown reader/);
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

test('end to end: the environment carries a hostile summary to the RPC as valid JSON, and nothing is executed', async () => {
  const received = [];
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { received.push({ url: req.url, auth: req.headers.authorization, data }); res.writeHead(200).end('{}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const marker = join(here, `.heartbeat-injection-${process.pid}`);
  const summary = JSON.stringify({ frames: 2, by_type: { [`$(touch ${marker})`]: 1, 'a "quoted" kind': 1 } });
  try {
    const { stdout } = await run(process.execPath, [join(here, 'reader-heartbeat.mjs')], {
      env: {
        PATH: process.env.PATH, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        READER_NAME: 'subscription-frame-classifier', READER_SUMMARY: summary, READER_ELAPSED_MS: '1200',
      },
    });
    assert.match(stdout, /heartbeat subscription-frame-classifier HTTP 200/);
    assert.ok(!stdout.includes('test-key'), 'the key is never printed');
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/rest/v1/rpc/record_reader_heartbeat');
    assert.deepEqual(JSON.parse(received[0].data), {
      p_jobname: 'subscription-frame-classifier', p_reading: JSON.parse(summary), p_elapsed_ms: 1200,
    });
    assert.throws(() => readFileSync(marker), /ENOENT/, 'the summary was not evaluated by a shell');
  } finally {
    server.close();
  }
});

test('the wrapper hands the summary over in the environment, not inside a shell command', () => {
  const wrapper = readFileSync(join(here, 'subscription-reader-batch.sh'), 'utf8');
  assert.match(wrapper, /READER_SUMMARY="\$summary"/, 'summary passed as an environment variable');
  assert.match(wrapper, /reader-heartbeat\.mjs/, 'the heartbeat is posted by reader-heartbeat.mjs');
  assert.ok(!/bash -c[^\n]*\n?[^\n]*\$summary/.test(wrapper) && !wrapper.includes(`'"$summary"'`),
    'the summary is never spliced into a bash -c script');
});
