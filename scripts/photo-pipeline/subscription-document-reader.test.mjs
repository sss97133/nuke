// node --test scripts/photo-pipeline/subscription-document-reader.test.mjs
// The document reader end to end with stand-ins: a local HTTP server plays PostgREST, receipt-photo-ocr and the image
// host; `claude` is a small script on PATH. What is checked is the worklist and the bookkeeping: privacy holds in the
// query, a frame whose bytes could not be fetched is remembered and not taken again, and a spent subscription ends the
// batch.
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

// `claude -p --output-format json`: the prompt arrives on stdin and names the image file.
const FAKE_CLAUDE = `#!${process.execPath}
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (input.includes('-limit')) {
    process.stdout.write(JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: "You've hit your 5-hour limit · resets 3pm" }));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, duration_ms: 1000, result: '{"document_type":"receipt","confidence":0.9,"vendor":"x"}' }));
});
`;

async function withStandIns(frameNames, fn, { blocked = [], ledger = true } = {}) {
  const calls = { receipts: [], lands: [], queries: [] };
  let port;
  const url = (n) => `http://127.0.0.1:${port}/img/${n}`;
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
      const path = decodeURIComponent(req.url);
      if (path.startsWith('/img/')) return path.includes('gone') ? res.writeHead(404).end() : res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      if (path.startsWith('/rest/v1/capture_document_pages_to_land')) return json(200, []);
      if (path.startsWith('/rest/v1/capture_document_pages')) return json(200, [{ image_id: 'z-already-read.jpg' }]);
      if (path.startsWith('/rest/v1/image_stage_current')) {
        calls.queries.push(path);
        return ledger ? json(200, blocked.map((n) => ({ image_id: n, input_fingerprint: md5(url(n)) }))) : json(404, { code: 'PGRST205' });
      }
      if (path.startsWith('/rest/v1/vehicle_images')) {
        calls.queries.push(path);
        // the frames come back from the "typed" query; the "routed" one adds nothing
        if (!path.includes('document_type')) return json(200, []);
        return json(200, [...frameNames, 'z-already-read.jpg'].map((n) => ({ id: n, vehicle_id: null, image_url: url(n), file_name: null, taken_at: null, document_type: 'receipt' })));
      }
      if (path === '/rest/v1/rpc/record_image_stage_receipt') { calls.receipts.push(JSON.parse(data)); return json(200, calls.receipts.length); }
      if (path === '/functions/v1/receipt-photo-ocr') { calls.lands.push(JSON.parse(data)); return json(200, { page: true, landed: true, receipt_id: 'r1' }); }
      json(404, { error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  const bin = mkdtempSync(join(tmpdir(), 'doc-reader-bin-'));
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE); chmodSync(join(bin, 'claude'), 0o755);
  try {
    const result = await run(process.execPath, [join(here, 'subscription-document-reader.mjs'), '--owner', OWNER, '--concurrency', '1', '--limit', '20'], {
      // PATH holds only the stand-in, which runs under this node by absolute path: a real `claude` is never reached
      env: { PATH: bin, HOME: bin, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
    }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
    let summary = null; try { summary = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* failed before its summary */ }
    await fn({ calls, summary, url, result });
  } finally {
    server.close();
    rmSync(bin, { recursive: true, force: true });
  }
}

test('holds are in the worklist query; an unreachable file is remembered; a spent subscription ends the batch', async () => {
  await withStandIns(['a-ok.jpg', 'b-gone.jpg', 'c-blocked-before.jpg', 'd-limit.jpg', 'e-never-started.jpg'], ({ calls, summary, url }) => {
    const queries = calls.queries.filter((q) => q.startsWith('/rest/v1/vehicle_images'));
    assert.equal(queries.length, 2);
    for (const q of queries) {
      for (const hold of ['image_url=like.http*', 'is_sensitive=not.is.true', 'is_duplicate=not.is.true', 'is_superseded=not.is.true', 'is_external=not.is.true',
        'or=(vision_gate_status.is.null,vision_gate_status.neq.rejected_personal)', `user_id=eq.${OWNER}`]) assert.ok(q.includes(hold), `worklist carries ${hold}`);
    }
    // a-ok was read and landed; b-gone answered 404; c was blocked on an earlier fire and is not taken; d hit the
    // limit and ended the batch; e was never started; z already has a page
    assert.deepEqual(calls.lands.map((l) => l.image_id), ['a-ok.jpg']);
    assert.deepEqual(calls.receipts.map((r) => [r.p_image_id, r.p_stage, r.p_outcome, r.p_error_class, r.p_http_status]), [
      ['a-ok.jpg', 'receipt_ocr', 'succeeded', null, null],
      ['b-gone.jpg', 'receipt_ocr', 'blocked_input', 'image_http_error', 404],
    ]);
    assert.equal(calls.receipts[1].p_input_fingerprint, md5(url('b-gone.jpg')), 'the fingerprint the next fire compares against');
    assert.deepEqual([summary.frames, summary.read, summary.landed, summary.errors, summary.receipts, summary.stopped], [4, 1, 1, 2, 2, 'reader_usage_limit'],
      'four frames on the list (the remembered one is not), one read, two failures, two receipts, stopped at the limit');
    assert.deepEqual(summary.error_classes, { image_http_error: 1, reader_usage_limit: 1 });
  }, { blocked: ['c-blocked-before.jpg'] });
});

test('with no ledger the reader works as before, with no memory', async () => {
  await withStandIns(['a-ok.jpg', 'b-gone.jpg'], ({ calls, summary }) => {
    assert.deepEqual(calls.lands.map((l) => l.image_id), ['a-ok.jpg']);
    assert.deepEqual([summary.frames, summary.read, summary.errors], [2, 1, 1]);
    assert.deepEqual(summary.error_classes, { image_http_error: 1 });
  }, { ledger: false });
});
