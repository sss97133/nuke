// node --test scripts/photo-pipeline/subscription-document-reader.test.mjs
// The document reader end to end with stand-ins: a local HTTP server plays PostgREST, receipt-photo-ocr and the image
// host; `claude` is a small script on PATH. What is checked is the worklist and the bookkeeping: privacy holds in the
// query, a frame whose bytes could not be fetched is remembered and not taken again, and a spent subscription ends the
// batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
const OWNER = '00000000-0000-4000-8000-0000000000aa';
const md5 = (t) => createHash('md5').update(t, 'utf8').digest('hex');

// `claude -p --output-format json`: the prompt arrives on stdin and names the image file. Each run records its argv, its
// working directory and whether the service key reached it, beside HOME (the stand-in's directory).
const FAKE_CLAUDE = `#!${process.execPath}
const { appendFileSync } = process.getBuiltinModule('node:fs'), { join } = process.getBuiltinModule('node:path');
appendFileSync(join(process.env.HOME, 'claude-args.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n');
appendFileSync(join(process.env.HOME, 'claude-runs.jsonl'), JSON.stringify({ cwd: process.cwd(), service_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) }) + '\\n');
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

async function withStandIns(frameNames, fn, { blocked = [], ledger = true, extraArgs = [], rereads = null } = {}) {
  const calls = { receipts: [], lands: [], queries: [], rereads: [] };
  let port;
  const url = (n) => `http://127.0.0.1:${port}/img/${n}`;
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
      const path = decodeURIComponent(req.url);
      if (path.startsWith('/img/')) return path.includes('gone') ? res.writeHead(404).end() : res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      if (path.startsWith('/rest/v1/receipt_reread_worklist')) { calls.queries.push(path); return rereads ? json(200, rereads(url)) : json(404, { code: 'PGRST205' }); }
      if (path === '/rest/v1/rpc/receipt_record_reread') { const b = JSON.parse(data); calls.rereads.push(b); return json(200, { stored: true, lines: 0 }); }
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
    const result = await run(process.execPath, [join(here, 'subscription-document-reader.mjs'), '--owner', OWNER, '--concurrency', '1', '--limit', '20', ...extraArgs], {
      // PATH holds only the stand-in, which runs under this node by absolute path: a real `claude` is never reached
      env: { PATH: bin, HOME: bin, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
    }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
    let summary = null; try { summary = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* failed before its summary */ }
    const lines = (f) => (existsSync(join(bin, f)) ? readFileSync(join(bin, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    await fn({ calls, summary, url, result, claudeArgs: lines('claude-args.jsonl'), claudeRuns: lines('claude-runs.jsonl') });
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

test('every read starts lean: no session file, the Read tool scoped to the page\'s own directory, the exact model id', async () => {
  await withStandIns(['a-ok.jpg', 'b-ok.jpg'], ({ claudeArgs, claudeRuns, calls }) => {
    assert.equal(claudeArgs.length, 2);
    assert.deepEqual(calls.lands.map((l) => l.image_id), ['a-ok.jpg', 'b-ok.jpg']);
    claudeArgs.forEach((argv, i) => {
      for (const flag of ['-p', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(argv.includes(flag), flag);
      assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5-5');
      assert.equal(argv[argv.indexOf('--output-format') + 1], 'json');
      assert.equal(argv[argv.indexOf('--tools') + 1], 'Read');
      assert.ok(!argv.includes('--json-schema') && !argv.includes('--bare'));
      // the page is not trusted: the one tool opens files under this page's directory only, no settings file widens that,
      // and the child starts there without the service key
      const r = claudeRuns[i];
      assert.match(r.cwd, /\/nuke-docread-[^/]+\/page_[^/]+$/);
      assert.equal(argv[argv.indexOf('--allowedTools') + 1], `Read(/${r.cwd}/**)`);
      assert.equal(argv[argv.indexOf('--setting-sources') + 1], '');
      assert.equal(r.service_key, false);
    });
    assert.notEqual(claudeRuns[0].cwd, claudeRuns[1].cwd, 'each page has its own directory');
  });
  await withStandIns(['a-ok.jpg'], ({ claudeArgs, calls }) => {
    assert.equal(claudeArgs[0][claudeArgs[0].indexOf('--model') + 1], 'sonnet', '--model still overrides');
    assert.equal(calls.lands[0].reader, 'claude-cli sonnet subscription');
  }, { extraArgs: ['--model', 'sonnet'] });
});

test('held receipts: storage and local papers are re-read and stored through the writer; a missing local file is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reread-local-'));
  const local = join(dir, 'IMG_1.jpeg'); writeFileSync(local, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const rows = (url) => [
    { receipt_id: 'r-storage', source_kind: 'storage', source: url('IMG_2.jpeg'), file_name: 'IMG_2.jpeg', reason: 'no_lines_held' },
    { receipt_id: 'r-local', source_kind: 'local', source: local, file_name: 'IMG_1.json', reason: 'held_unreconciled' },
    { receipt_id: 'r-missing', source_kind: 'local', source: join(dir, 'nope.jpeg'), file_name: 'nope.json', reason: 'no_lines_held' },
  ];
  try {
    await withStandIns([], ({ calls, summary }) => {
      assert.equal(summary.rereads, 3);
      assert.equal(summary.reread_stored, 2);
      assert.equal(summary.reread_errors, 1);
      assert.equal(summary.error_classes.local_file_missing, 1);
      assert.deepEqual(calls.rereads.map((c) => c.p_receipt).sort(), ['r-local', 'r-storage']);
      for (const c of calls.rereads) { assert.equal(c.p_extraction.document_type, 'receipt'); assert.match(c.p_reader, /subscription$/); }
      assert.ok(calls.queries.some((q) => q.includes('receipt_reread_worklist') && q.includes('user_id=eq.')));
      assert.equal(calls.lands.length, 0, 'a re-read never lands a new receipt through the frame route');
    }, { rereads: rows });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without the work list (view not deployed) the reader runs as before', async () => {
  await withStandIns(['a.jpg'], ({ summary, calls }) => {
    assert.equal(summary.rereads, 0);
    assert.equal(calls.rereads.length, 0);
    assert.equal(summary.read, 1);
  });
});
