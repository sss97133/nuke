// node --test scripts/photo-pipeline/subscription-frame-classifier.test.mjs
// The frame reader against the stage queue, end to end with stand-ins: a local HTTP server plays PostgREST, the
// orchestrator and the image host; `claude` and `sips` are small scripts on PATH. What is checked is the bookkeeping:
// every photo the reader starts gets exactly one typed receipt, and a spent subscription ends the batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const OWNER = '00000000-0000-4000-8000-0000000000aa';
const md5 = (t) => createHash('md5').update(t, 'utf8').digest('hex');

// `claude -p --output-format json`: the prompt arrives on stdin and names the image file; the file name picks the answer.
const FAKE_CLAUDE = `#!${process.execPath}
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const name = (input.match(/file at (\\S+)\\./) || [])[1] || '';
  if (name.includes('-limit')) {
    process.stdout.write(JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: "You've hit your 5-hour limit · resets 3pm" }));
    process.exit(1);
  }
  if (name.includes('-garbage')) { process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'I could not decide.' })); return; }
  if (name.includes('-refused')) { process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '{"image_type":"nonsense"}' })); return; }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, duration_ms: 1000, result: 'Here it is: {"image_type":"engine_bay","confidence":0.9}' }));
});
`;
const FAKE_SIPS = `#!${process.execPath}
const args = process.argv.slice(2);
const raw = args[args.indexOf('--out') - 1], out = args[args.indexOf('--out') + 1];
if (raw.includes('corrupt')) { console.error('Error: Cannot extract image from file.'); process.exit(13); }
require('node:fs').copyFileSync(raw, out);
`;

async function withStandIns(frameNames, fn, { sips = true, claude = true, config = { enabled: true, user_ids: [OWNER] }, failFirstReceipt = false, statusFrames = [], extraArgs = [] } = {}) {
  const calls = { receipts: [], claims: [], readings: [], status: [], receiptAttempts: 0 };
  let port;
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
      if (req.url.startsWith('/img/')) {
        if (req.url.includes('gone')) return res.writeHead(404).end();
        return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      }
      if (req.url.startsWith('/rest/v1/platform_config')) return config === 'error' ? json(503, { code: 'PGRST002' }) : json(200, config ? [{ config_value: config }] : []);
      if (req.url.startsWith('/rest/v1/vehicle_images')) {
        calls.status.push(decodeURIComponent(req.url));
        return json(200, statusFrames.map((n) => ({ id: n, vehicle_id: null, user_id: OWNER, image_url: `http://127.0.0.1:${port}/img/${n}`, file_name: null, taken_at: null, ai_processing_status: 'failed' })));
      }
      if (req.url === '/rest/v1/rpc/claim_image_stage_work') {
        // the line hands out one photo per claim, in order, then nothing
        calls.claims.push(JSON.parse(data));
        const n = frameNames[calls.claims.length - 1];
        return json(200, n === undefined ? [] : [{ work_id: calls.claims.length, image_id: n, image_url: n.includes('no-url') ? '' : `http://127.0.0.1:${port}/img/${n}`, user_id: OWNER, vehicle_id: null, lane: 'live', reason: 'missing', target_version: 1 }]);
      }
      if (req.url === '/rest/v1/rpc/record_image_stage_receipt') {
        if (failFirstReceipt && ++calls.receiptAttempts === 1) return json(503, { message: 'upstream connect error' });
        calls.receipts.push(JSON.parse(data)); return json(200, calls.receipts.length);
      }
      if (req.url === '/functions/v1/photo-pipeline-orchestrator') {
        const body = JSON.parse(data);
        if (body.action === 'classifier_prompt') return json(200, { prompt: 'Classify the photo.', prompt_version: 'v98' });
        calls.readings.push(body);
        if (body.classification_raw?.image_type === 'nonsense') return json(200, { success: false, classifier_ok: false, error_class: 'classifier_response_invalid', requeued: true });
        return json(200, { success: true, classifier_ok: true });
      }
      json(404, { error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  const bin = mkdtempSync(join(tmpdir(), 'frame-reader-bin-'));
  if (claude) { writeFileSync(join(bin, 'claude'), FAKE_CLAUDE); chmodSync(join(bin, 'claude'), 0o755); }
  if (sips) { writeFileSync(join(bin, 'sips'), FAKE_SIPS); chmodSync(join(bin, 'sips'), 0o755); }
  try {
    const result = await run(process.execPath, [join(here, 'subscription-frame-classifier.mjs'), '--owner', OWNER, '--concurrency', '1', '--limit', '20', ...extraArgs], {
      // PATH holds only the stand-ins (they run under this node by absolute path): a real `claude` or `sips` on the
      // machine, which can sit in node's own directory, is never reached
      env: { PATH: bin, HOME: bin, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
    }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
    let summary = null; try { summary = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* the run failed before its summary */ }
    await fn({ calls, summary, port, result });
  } finally {
    server.close();
    rmSync(bin, { recursive: true, force: true });
  }
}

test('every started photo gets one typed receipt with the URL fingerprint; a spent subscription ends the batch', async () => {
  const frames = ['a-ok.jpg', 'b-gone.jpg', 'c-corrupt.png', 'd-garbage.jpg', 'e-refused.jpg', 'f-limit.jpg', 'g-never-started.jpg'];
  await withStandIns(frames, ({ calls, summary, port }) => {
    // one photo per claim: six photos taken, and the seventh is never claimed because the limit ended the fire
    assert.equal(calls.claims.length, 6);
    for (const c of calls.claims) assert.deepEqual(c, { p_stage: 'classifier', p_limit: 1, p_lease_seconds: 600, p_user_id: OWNER }, 'owner-scoped, one photo, a 10-minute lease');
    const got = calls.receipts.map((r) => [r.p_image_id, r.p_outcome, r.p_error_class, r.p_http_status]);
    assert.deepEqual(got, [
      ['a-ok.jpg', 'succeeded', null, null],
      ['b-gone.jpg', 'blocked_input', 'image_http_error', 404],
      ['c-corrupt.png', 'blocked_input', 'image_unreadable', null],
      ['d-garbage.jpg', 'unavailable', 'reader_output_invalid', null],
      ['e-refused.jpg', 'unavailable', 'classifier_response_invalid', 200],
      ['f-limit.jpg', 'rate_limited', 'reader_usage_limit', 429],
    ]);
    for (const r of calls.receipts) {
      assert.equal(r.p_input_fingerprint, md5(`http://127.0.0.1:${port}/img/${r.p_image_id}`), 'fingerprint is md5 of the URL that was read');
      assert.equal(r.p_producer_version, 1);
      assert.deepEqual([r.p_detail.reader, r.p_detail.prompt_version], ['claude-cli sonnet subscription', 'v98']);
    }
    assert.deepEqual(calls.readings.map((b) => b.image_id), ['a-ok.jpg', 'e-refused.jpg'], 'only parsed readings reach the orchestrator');
    assert.equal(calls.readings[0].reader, 'claude-cli sonnet subscription');
    assert.deepEqual([summary.source, summary.frames, summary.receipts, summary.receipt_errors, summary.accepted, summary.stopped],
      ['stage-queue', 6, 6, 0, 1, 'reader_usage_limit'], 'six photos taken, six receipts; the summary names why the fire stopped');
    assert.deepEqual(summary.error_classes, { image_http_error: 1, image_unreadable: 1, reader_output_invalid: 1, classifier_response_invalid: 1, reader_usage_limit: 1 },
      'the summary (the heartbeat reading) says why frames failed, in fixed words');
  });
});

test('a row with no URL is settled without a fetch; a receipt write that fails once is tried again', async () => {
  await withStandIns(['a-no-url', 'b-ok.jpg'], ({ calls, summary }) => {
    assert.deepEqual(calls.receipts.map((r) => [r.p_image_id, r.p_outcome, r.p_error_class]), [['a-no-url', 'blocked_input', 'image_url_missing'], ['b-ok.jpg', 'succeeded', null]]);
    assert.equal(calls.receipts[0].p_input_fingerprint, 'd41d8cd98f00b204e9800998ecf8427e', 'md5 of the empty URL, as the ledger computes it');
    assert.deepEqual([summary.receipts, summary.receipt_errors], [2, 0], 'the first write failed with 503 and was repeated');
  }, { failFirstReceipt: true });
});

test('the queue is used only for an owner the reconciler names; a failed config read fails the run', async () => {
  // switched on for someone else: this owner keeps the status worklist, with the ledger's holds in the query
  await withStandIns(['a-ok.jpg'], ({ calls, summary }) => {
    assert.equal(calls.claims.length, 0);
    assert.equal(summary.source, 'status');
    assert.equal(calls.status.length, 1);
    for (const hold of ['is_sensitive=not.is.true', 'is_duplicate=not.is.true', 'is_superseded=not.is.true', 'is_external=not.is.true',
      'or=(vision_gate_status.is.null,vision_gate_status.neq.rejected_personal)', 'image_url=like.http*', `user_id=eq.${OWNER}`]) {
      assert.ok(calls.status[0].includes(hold), `status worklist carries ${hold}`);
    }
  }, { config: { enabled: true, user_ids: ['00000000-0000-4000-8000-0000000000bb'] } });
  // the config could not be read: no fallback to the unqueued worklist, no summary line, non-zero exit (so no heartbeat)
  await withStandIns(['a-ok.jpg'], ({ calls, summary, result }) => {
    assert.notEqual(result.code, 0);
    assert.equal(summary, null);
    assert.deepEqual([calls.claims.length, calls.status.length, calls.receipts.length], [0, 0, 0]);
  }, { config: 'error' });
});

test('on the status worklist nothing is written to the ledger, and the summary still says why frames failed', async () => {
  await withStandIns([], ({ calls, summary }) => {
    assert.deepEqual([calls.claims.length, calls.receipts.length], [0, 0], 'ledger off: no claim, no receipt');
    assert.deepEqual([summary.source, summary.frames, summary.accepted, summary.errors], ['status', 3, 1, 2]);
    assert.deepEqual(summary.error_classes, { image_http_error: 2 }, 'two photos whose URL answers 404');
    assert.equal(summary.stopped, null);
  }, { config: { enabled: false, user_ids: [] }, statusFrames: ['a-gone.jpg', 'b-ok.jpg', 'c-gone.jpg'] });
  // a spent subscription ends the batch on this worklist too, instead of failing every remaining photo
  await withStandIns([], ({ calls, summary }) => {
    assert.equal(calls.receipts.length, 0);
    assert.deepEqual([summary.stopped, summary.error_classes], ['reader_usage_limit', { reader_usage_limit: 1 }]);
    assert.equal(calls.readings.length, 0, 'the photo after the limit was not started');
  }, { config: null, statusFrames: ['a-limit.jpg', 'b-ok.jpg'] });
});

test('the reader keeps taking photos until the line is empty, and takes none once its time budget has passed', async () => {
  const many = Array.from({ length: 27 }, (_, i) => `p${String(i).padStart(2, '0')}-ok.jpg`);
  await withStandIns(many, ({ calls, summary }) => {
    assert.equal(calls.receipts.length, 27, 'more than one old batch of 20: every photo in the line is read in this fire');
    assert.equal(calls.claims.length, 28, '27 claims that returned a photo and the one that found the line empty');
    assert.deepEqual([summary.frames, summary.accepted, summary.receipts, summary.stopped], [27, 27, 27, null]);
  });
  await withStandIns(many, ({ calls, summary }) => {
    assert.deepEqual([calls.claims.length, calls.receipts.length, summary.frames, summary.stopped], [0, 0, 0, 'time_budget'], 'budget spent: nothing is claimed, so nothing is left claimed and unread');
  }, { extraArgs: ['--budget-seconds', '0'] });
});

test('no CLI on the machine stops the batch at the first photo', async () => {
  await withStandIns(['a-first.jpg', 'b-second.jpg'], ({ calls, summary }) => {
    assert.deepEqual(calls.receipts.map((r) => [r.p_image_id, r.p_outcome, r.p_error_class]), [['a-first.jpg', 'unavailable', 'reader_tool_missing']]);
    assert.equal(summary.stopped, 'reader_tool_missing');
  }, { claude: false });
});

test('no converter on the machine stops the batch instead of blocking every non-JPEG photo', async () => {
  await withStandIns(['a-first.heic', 'b-second.heic'], ({ calls, summary }) => {
    assert.deepEqual(calls.receipts.map((r) => [r.p_image_id, r.p_outcome, r.p_error_class]), [['a-first.heic', 'unavailable', 'reader_tool_missing']]);
    assert.equal(summary.stopped, 'reader_tool_missing');
  }, { sips: false });
});
