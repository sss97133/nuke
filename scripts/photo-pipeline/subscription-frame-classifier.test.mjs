// node --test scripts/photo-pipeline/subscription-frame-classifier.test.mjs
// The frame reader against the stage queue, end to end with stand-ins: a local HTTP server plays PostgREST, the
// orchestrator and the image host; `claude` and `sips` are small scripts on PATH. What is checked is the bookkeeping:
// every photo the reader starts gets exactly one typed receipt, and a spent subscription ends the batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { AUTOMATIC_TIER, admitsFrom, automaticMethod, standingReadingQuery } from './deep-stage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// the database's row for this reader, with the admitted set of the shared cases
const TIERS = { reviewed_tiers: ['caller-byok subscription'], automatic: { tier: 'subscription automatic',
  admits: JSON.parse(readFileSync(join(here, 'fixtures', 'automatic-thin-verdicts.json'), 'utf8')).admits } };
const run = promisify(execFile);
const OWNER = '00000000-0000-4000-8000-0000000000aa';
const md5 = (t) => createHash('md5').update(t, 'utf8').digest('hex');

// `claude -p --output-format json`: the prompt arrives on stdin and names the image file; the file name picks the answer.
const FAKE_CLAUDE = `#!${process.execPath}
if (process.argv.includes('--help')) { console.log(process.env.FAKE_CLAUDE_OLD ? 'Usage: claude [options]\\n  --model <model>' : 'Usage: claude [options]\\n  --safe-mode\\n  --json-schema <schema>'); process.exit(0); }
if (process.argv.includes('--safe-mode') && process.env.FAKE_CLAUDE_OLD) { console.error("error: unknown option '--safe-mode'"); process.exit(1); }
let input = '';
process.getBuiltinModule('node:fs').appendFileSync(process.getBuiltinModule('node:path').join(process.env.HOME, 'claude-args.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n');
process.getBuiltinModule('node:fs').appendFileSync(process.getBuiltinModule('node:path').join(process.env.HOME, 'claude-runs.jsonl'), JSON.stringify({ cwd: process.cwd(), service_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) }) + '\\n');
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

// @supabase/supabase-js as the keyed stage sees it: a database that holds no reading for the photo
const FAKE_SUPABASE_JS = `exports.createClient = () => ({
  from: () => { const b = { select: () => b, eq: () => b, lt: () => b, in: () => b, or: () => b, order: () => b, limit: () => b, abortSignal: () => b,
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) }; return b; },
});`;

async function withStandIns(frameNames, fn, { sips = true, claude = true, config = { enabled: true, user_ids: [OWNER] }, tiers = TIERS, failFirstReceipt = false, statusFrames = [], deepFrames = [], keyedFrames = [], rows = {}, standing = {}, extraArgs = [], supabaseJs = false, failClaims = [], failClaimsAfter = {}, oldCli = false } = {}) {
  const calls = { receipts: [], claims: [], readings: [], status: [], receiptAttempts: 0, snapshots: [], snapshotQueries: [], standing: [], tiers: 0 };
  const cursor = {};   // each stage hands out its photos once, at most p_limit a call, like the database
  const claimCount = {};   // failClaimsAfter: { stage: n } answers that stage's first n claims and fails the ones after
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
      // the row that says which closed values the database admits from this reader (read once, before any deep reading is claimed)
      if (req.url.startsWith('/rest/v1/platform_config') && req.url.includes('config_key=eq.image_reading_tiers')) {
        calls.tiers++;
        return tiers === 'error' ? json(503, { code: 'PGRST002' }) : json(200, tiers ? [{ config_value: tiers }] : []);
      }
      if (req.url.startsWith('/rest/v1/platform_config')) return config === 'error' ? json(503, { code: 'PGRST002' }) : json(200, config ? [{ config_value: config }] : []);
      // the photo's deep readings, asked of the observations themselves once the stamp says the photo is free
      if (req.url.startsWith('/rest/v1/vehicle_observations')) {
        const q = decodeURIComponent(req.url); calls.standing.push(q);
        return json(200, standing[q.match(/structured_data->>image_id=eq\.([^&]+)/)?.[1]] ?? []);
      }
      if (req.url.startsWith('/rest/v1/vehicle_images') && /[?&]id=eq\./.test(req.url)) {
        const id = req.url.match(/id=eq\.([^&]+)/)[1]; calls.snapshots.push(id); calls.snapshotQueries.push(req.url);
        return json(200, [{ id, vehicle_id: '00000000-0000-4000-8000-0000000000cc', image_url: `https://example.test/${id}`, updated_at: '2026-11-20T18:00:00.123456+00:00', file_name: null,
          deep_scene: null, is_sensitive: false, is_superseded: false, is_duplicate: false, is_document: false, doc_flag: null, vision_gate_status: 'approved', image_vehicle_match_status: 'match', ...(rows[id] ?? {}) }]);
      }
      if (req.url.startsWith('/rest/v1/vehicle_images')) {
        calls.status.push(decodeURIComponent(req.url));
        return json(200, statusFrames.map((n) => ({ id: n, vehicle_id: null, user_id: OWNER, image_url: `http://127.0.0.1:${port}/img/${n}`, file_name: null, taken_at: null, ai_processing_status: 'failed' })));
      }
      if (req.url === '/rest/v1/rpc/claim_image_stage_work') {
        const claim = JSON.parse(data); calls.claims.push(claim);
        claimCount[claim.p_stage] = (claimCount[claim.p_stage] ?? 0) + 1;
        if (failClaims.includes(claim.p_stage) || claimCount[claim.p_stage] > (failClaimsAfter[claim.p_stage] ?? Infinity)) return json(404, { code: 'PGRST202', message: 'Could not find the function' });
        const names = claim.p_stage === 'deep_reading' ? deepFrames : claim.p_stage === 'keyed_values' ? keyedFrames : frameNames;
        const from = cursor[claim.p_stage] ?? 0, take = names.slice(from, from + claim.p_limit); cursor[claim.p_stage] = from + take.length;
        return json(200, take.map((n, i) => ({ work_id: from + i + 1, image_id: n, image_url: n.includes('no-url') ? '' : `http://127.0.0.1:${port}/img/${n}`, user_id: OWNER, vehicle_id: claim.p_stage === 'classifier' ? null : '00000000-0000-4000-8000-0000000000cc', lane: 'live', reason: 'missing', target_version: 1 })));
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
    // the project's own checkout holds node_modules; the reader resolves @supabase/supabase-js from its working directory
    const project = join(bin, 'project');
    if (supabaseJs) {
      mkdirSync(join(project, 'node_modules', '@supabase', 'supabase-js'), { recursive: true });
      writeFileSync(join(project, 'node_modules', '@supabase', 'supabase-js', 'index.js'), FAKE_SUPABASE_JS);
    } else mkdirSync(project, { recursive: true });
    const result = await run(process.execPath, [join(here, 'subscription-frame-classifier.mjs'), '--owner', OWNER, '--concurrency', '1', '--limit', '20', ...extraArgs], {
      cwd: project,
      // PATH holds only the stand-ins (they run under this node by absolute path): a real `claude` or `sips` on the
      // machine, which can sit in node's own directory, is never reached
      env: { PATH: bin, HOME: bin, ...(oldCli ? { FAKE_CLAUDE_OLD: '1' } : {}), SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
    }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
    let summary = null; try { summary = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* the run failed before its summary */ }
    let claudeArgs = []; try { claudeArgs = readFileSync(join(bin, 'claude-args.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* no CLI call */ }
    let claudeRuns = []; try { claudeRuns = readFileSync(join(bin, 'claude-runs.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* no CLI call */ }
    if (process.env.DEBUG_STAND_INS) console.error(result.stderr, JSON.stringify(calls.receipts));
    await fn({ calls, summary, port, result, claudeArgs, claudeRuns });
  } finally {
    server.close();
    rmSync(bin, { recursive: true, force: true });
  }
}

test('every started photo gets one typed receipt with the URL fingerprint; a spent subscription ends the batch', async () => {
  const frames = ['a-ok.jpg', 'b-gone.jpg', 'c-corrupt.png', 'd-garbage.jpg', 'e-refused.jpg', 'f-limit.jpg', 'g-never-started.jpg'];
  await withStandIns(frames, ({ calls, summary, port }) => {
    assert.deepEqual(calls.claims, [{ p_stage: 'classifier', p_limit: 20, p_lease_seconds: 6000, p_user_id: OWNER }, { p_stage: 'keyed_values', p_limit: 25, p_lease_seconds: 1800, p_user_id: OWNER }],
      'the first-read claim is owner-scoped and leased for the whole batch (20 photos one at a time, 300 s each); the spent subscription skips the deep readings, and keyed values (no model call) still run');
    assert.equal(summary.stages.deep_reading.skipped, 'first_read_fault', 'phase skipped on a batch-level fault, and the heartbeat says so');
    assert.equal(summary.stages.deep_reading.claimed, 0);
    assert.equal(summary.stages.keyed_values.skipped, null);
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
      assert.deepEqual([r.p_detail.reader, r.p_detail.prompt_version], ['claude-cli claude-sonnet-5-5 subscription', 'v98']);
    }
    assert.deepEqual(calls.readings.map((b) => b.image_id), ['a-ok.jpg', 'e-refused.jpg'], 'only parsed readings reach the orchestrator');
    assert.equal(calls.readings[0].reader, 'claude-cli claude-sonnet-5-5 subscription');
    assert.deepEqual([summary.source, summary.frames, summary.receipts, summary.receipt_errors, summary.accepted, summary.stopped],
      ['stage-queue', 7, 6, 0, 1, 'reader_usage_limit'], 'the summary counts receipts and names why the batch stopped');
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

test('every model call starts lean and asks for the exact model id', async () => {
  await withStandIns(['a-ok.jpg'], ({ claudeArgs, claudeRuns }) => {
    assert.equal(claudeArgs.length, 1);
    const argv = claudeArgs[0];
    for (const flag of ['-p', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(argv.includes(flag), flag);
    assert.equal(argv[argv.indexOf('--model') + 1], 'claude-sonnet-5-5');
    assert.equal(argv[argv.indexOf('--tools') + 1], 'Read');
    assert.ok(!argv.includes('--json-schema') && !argv.includes('--bare'));
    // a first read may open files under its own photo's directory only (the pixels are not trusted), loads no settings
    // file that could widen that, and starts without the service key
    const run1 = claudeRuns[0];
    assert.match(run1.cwd, /\/nuke-classify-[^/]+\/photo_[^/]+$/);
    assert.equal(argv[argv.indexOf('--allowedTools') + 1], `Read(/${run1.cwd}/**)`);
    assert.equal(argv[argv.indexOf('--setting-sources') + 1], '');
    assert.equal(run1.service_key, false);
  });
  await withStandIns(['a-ok.jpg'], ({ claudeArgs, calls }) => {
    assert.equal(claudeArgs[0][claudeArgs[0].indexOf('--model') + 1], 'sonnet', '--model still overrides');
    assert.equal(calls.readings[0].reader, 'claude-cli sonnet subscription');
  }, { extraArgs: ['--model', 'sonnet'] });
});

test('a database without the new stages: both claim nothing, the fire is clean, and the heartbeat reading keeps its shape', async () => {
  await withStandIns(['a-ok.jpg'], ({ calls, summary, result }) => {
    assert.equal(result.code, 0);
    assert.deepEqual(calls.claims.map((c) => [c.p_stage, c.p_limit]), [['classifier', 20], ['deep_reading', 2], ['keyed_values', 25]],
      'first reads, then deep readings (default 20, claimed 2 x concurrency a call), then keyed values (default 60, claimed 25 a call)');
    assert.deepEqual([summary.frames, summary.accepted, summary.receipts, summary.stopped], [1, 1, 1, null], 'the existing top-level fields keep their meaning');
    assert.deepEqual(Object.keys(summary.stages), ['deep_reading', 'keyed_values']);
    for (const stage of ['deep_reading', 'keyed_values']) {
      const s = summary.stages[stage];
      assert.deepEqual([s.claimed, s.started, s.receipts, s.receipt_errors, s.claim_error, s.skipped, s.stopped], [0, 0, 0, 0, null, null, null], `${stage}: a quiet no-op`);
    }
    assert.equal(calls.receipts.length, 1, 'only the first read wrote a receipt');
    assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 2000, 'the reading stays far under the 20 kB the database takes');
  });
  // the claim itself fails (function or grant missing on the database side): noted in the summary, not a crash, the other stage still runs
  await withStandIns([], ({ calls, summary, result }) => {
    assert.equal(result.code, 0);
    assert.equal(summary.stages.deep_reading.claim_error, 'claim_failed');
    assert.equal(summary.stages.keyed_values.claim_error, null);
    assert.ok(calls.claims.some((c) => c.p_stage === 'keyed_values'));
  }, { failClaims: ['deep_reading'] });
});

test('deep readings: claimed with a lease that covers the batch; a photo that no longer satisfies the intake is closed as a policy skip with no read', async () => {
  const gone = { 'a-document.jpg': { is_document: true }, 'b-unfiled.jpg': { vehicle_id: null }, 'c-http.jpg': { image_url: 'http://example.test/c.jpg' }, 'd-read.jpg': { deep_scene: 'engine_bay' } };
  await withStandIns([], ({ calls, summary, claudeArgs }) => {
    const deep = calls.claims.find((c) => c.p_stage === 'deep_reading');
    assert.deepEqual(deep, { p_stage: 'deep_reading', p_limit: 2, p_lease_seconds: 1200, p_user_id: OWNER },
      'claimed two at a time (twice the concurrency), leased for those two only');
    assert.equal(calls.claims.filter((c) => c.p_stage === 'deep_reading').length, 3, 'a claim that comes back short (2, 2, 0 of the 4 held) ends the stage: no claim for the 12th');
    assert.deepEqual(calls.snapshots, Object.keys(gone), 'the row is read again before anything is fetched');
    const got = calls.receipts.filter((r) => r.p_stage === 'deep_reading').map((r) => [r.p_image_id, r.p_outcome, r.p_detail.skipped]);
    assert.deepEqual(got, [['a-document.jpg', 'policy_skip', 'document'], ['b-unfiled.jpg', 'policy_skip', 'unfiled'], ['c-http.jpg', 'policy_skip', 'image_url_not_https'], ['d-read.jpg', 'policy_skip', 'already_read']]);
    assert.equal(claudeArgs.length, 0, 'no read was spent');
    const s = summary.stages.deep_reading;
    assert.deepEqual([s.claimed, s.started, s.policy_skip, s.receipts, s.skip_reasons], [4, 4, 4, 4, { document: 1, unfiled: 1, image_url_not_https: 1, already_read: 1 }]);
    for (const r of calls.receipts) assert.equal(r.p_producer_version, 1);
    assert.equal(calls.tiers, 1, 'the admitted set is read once a fire');
  }, { deepFrames: Object.keys(gone), rows: gone, extraArgs: ['--deep-limit', '12'] });
});

test('deep readings wait for the database to say what this reader may post: no row, an empty row or an unreadable one claims nothing', async () => {
  for (const [tiers, why] of [[null, 'nothing_admitted'], [{ automatic: { admits: { scene_type: [], rust_severity: ['surface'] } } }, 'nothing_admitted'], ['error', 'admitted_values_unreadable']]) {
    await withStandIns([], ({ calls, summary, claudeArgs, result }) => {
      assert.equal(result.code, 0);
      assert.equal(summary.stages.deep_reading.skipped, why);
      assert.ok(!calls.claims.some((c) => c.p_stage === 'deep_reading'), 'nothing is claimed that could not be posted');
      assert.ok(calls.claims.some((c) => c.p_stage === 'keyed_values'), 'the keyed stage still runs');
      assert.equal(claudeArgs.length, 0);
    }, { tiers, deepFrames: ['a.jpg'] });
  }
});

test('deep readings: the reader\'s own reading by the same method closes the stage without a read; by an older method it is read again', async () => {
  const method = automaticMethod(admitsFrom(TIERS));
  await withStandIns([], ({ calls, summary, claudeArgs }) => {
    const got = calls.receipts.filter((r) => r.p_stage === 'deep_reading').map((r) => [r.p_image_id, r.p_outcome, r.p_detail.already_read ?? null, r.p_detail.skipped ?? null]);
    assert.deepEqual(got, [['a-mine.jpg', 'succeeded', 'same_method', null], ['b-reviewed.jpg', 'policy_skip', null, 'already_read'], ['c-standing.jpg', 'policy_skip', null, 'already_read']]);
    assert.equal(claudeArgs.length, 0, 'no read was spent on any of them');
    assert.deepEqual([summary.stages.deep_reading.succeeded, summary.stages.deep_reading.policy_skip], [1, 2]);
    // only the photo whose stamp is free is asked about; the question is the guard's own (same filter, same index)
    assert.deepEqual(calls.standing.map((u) => decodeURIComponent(u)), [`/rest/v1/${standingReadingQuery('c-standing.jpg')}`]);
    assert.match(decodeURIComponent(calls.snapshotQueries[0]), /deep_tier:ai_scan_metadata->byok_deep_analysis->>agent_tier,deep_method:ai_scan_metadata->byok_deep_analysis->>extraction_method/);
  }, { deepFrames: ['a-mine.jpg', 'b-reviewed.jpg', 'c-standing.jpg'], extraArgs: ['--deep-limit', '3'],
    // c: no stamp on the photo, yet a reviewed reading of it is current (its stamp is missing): found by the observation
    standing: { 'c-standing.jpg': [{ id: '30000000-0000-4000-8000-000000000009', kind: 'condition', is_superseded: false, agent_tier: 'caller-byok subscription' }] },
    rows: { 'a-mine.jpg': { deep_scene: 'undercarriage', deep_tier: AUTOMATIC_TIER, deep_method: method }, 'b-reviewed.jpg': { deep_scene: 'undercarriage', deep_tier: 'caller-byok subscription', deep_method: 'three passes' } } });
});

const K1 = 'aaaaaaaa-0000-4000-8000-000000000001', K2 = 'aaaaaaaa-0000-4000-8000-000000000002';
test('keyed values: claimed per photo, one receipt each, no model call', async () => {
  await withStandIns([], ({ calls, summary, claudeArgs }) => {
    assert.deepEqual(calls.claims.find((c) => c.p_stage === 'keyed_values'), { p_stage: 'keyed_values', p_limit: 2, p_lease_seconds: 1800, p_user_id: OWNER });
    const got = calls.receipts.filter((r) => r.p_stage === 'keyed_values').map((r) => [r.p_image_id, r.p_outcome, r.p_error_class]);
    assert.deepEqual(got, [[K1, 'unavailable', 'reading_not_found'], [K2, 'unavailable', 'reading_not_found']], 'the projection ran for each photo and found no reading to project: retried later');
    assert.equal(claudeArgs.length, 0);
    assert.deepEqual([summary.stages.keyed_values.claimed, summary.stages.keyed_values.receipts, summary.stages.keyed_values.error_classes], [2, 2, { reading_not_found: 2 }]);
  }, { keyedFrames: [K1, K2], supabaseJs: true, extraArgs: ['--keyed-limit', '2'] });
  // a claim whose second page fails: the 25 photos the first page leased are still worked, and the summary says the claim failed
  const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  await withStandIns([], ({ calls, summary }) => {
    assert.deepEqual(calls.claims.filter((c) => c.p_stage === 'keyed_values').map((c) => c.p_limit), [25, 5]);
    assert.equal(calls.receipts.filter((r) => r.p_stage === 'keyed_values').length, 25, 'every photo the first page leased got its receipt');
    assert.deepEqual([summary.stages.keyed_values.claimed, summary.stages.keyed_values.receipts, summary.stages.keyed_values.claim_error], [25, 25, 'claim_failed']);
  }, { keyedFrames: many, supabaseJs: true, extraArgs: ['--keyed-limit', '30'], failClaimsAfter: { keyed_values: 1 } });
  // switched off with 0: neither claimed nor counted
  await withStandIns([], ({ calls, summary }) => {
    assert.deepEqual(calls.claims.map((c) => c.p_stage), ['classifier']);
    assert.deepEqual([summary.stages.deep_reading.skipped, summary.stages.keyed_values.skipped], ['off', 'off']);
  }, { extraArgs: ['--deep-limit', '0', '--keyed-limit', '0'] });
});

test('the stages run only from the ledger: the status worklist has no stage', async () => {
  await withStandIns([], ({ calls, summary }) => {
    assert.equal(calls.claims.length, 0);
    assert.equal('stages' in summary, false);
  }, { config: { enabled: false, user_ids: [] }, statusFrames: [] });
});

test('a CLI that cannot start lean keeps the first reads as they were and waits to deep-read', async () => {
  await withStandIns(['a-ok.jpg'], ({ calls, summary, claudeArgs }) => {
    assert.equal(summary.cli, 'legacy_no_safe_mode');
    assert.equal(claudeArgs.length, 1);
    assert.deepEqual(claudeArgs[0], ['-p', '--output-format', 'json', '--model', 'claude-sonnet-5-5', '--allowedTools', 'Read'], 'the call that has always worked, with the exact model id');
    assert.equal(calls.receipts[0].p_outcome, 'succeeded');
    assert.equal(summary.stages.deep_reading.skipped, 'cli_without_safe_mode');
    assert.ok(!calls.claims.some((c) => c.p_stage === 'deep_reading'), 'no deep reading is claimed that cannot be read');
    assert.ok(calls.claims.some((c) => c.p_stage === 'keyed_values'), 'keyed values need no model');
  }, { oldCli: true });
});
