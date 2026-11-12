// node --test scripts/photo-pipeline/stage-queue.test.mjs
// The readers' side of the stage ledger: what is claimed, and which typed receipt each frame result becomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { claimStageWork, inputFingerprint, receiptForResult, recordStageReceipt, stageQueueEnabled } from './stage-queue.mjs';

const ctx = { reader: 'claude-cli sonnet subscription', promptVersion: 'v98' };

test('the ledger is used only when the reconciler is on and names this owner', async () => {
  const cfg = (config_value) => async () => [{ config_value }];
  assert.equal(await stageQueueEnabled(cfg({ enabled: true }), 'u1'), true, 'no user_ids key: every user');
  assert.equal(await stageQueueEnabled(cfg({ enabled: true, user_ids: ['u1', 'u2'] }), 'u1'), true);
  assert.equal(await stageQueueEnabled(cfg({ enabled: true, user_ids: ['u2'] }), 'u1'), false, 'on for someone else: this owner keeps the status worklist');
  assert.equal(await stageQueueEnabled(cfg({ enabled: true, user_ids: [] }), 'u1'), false, 'the seed names nobody');
  assert.equal(await stageQueueEnabled(cfg({ enabled: 'true', user_ids: ['u1'] }), 'u1'), true, 'the SQL casts the flag to boolean; so does the reader');
  assert.equal(await stageQueueEnabled(cfg({ enabled: false, user_ids: ['u1'] }), 'u1'), false);
  assert.equal(await stageQueueEnabled(async () => [], 'u1'), false, 'no config row (ledger not deployed): off');
  // a failed read is not "off": the fire must fail loudly instead of reading the unqueued worklist
  await assert.rejects(stageQueueEnabled(async () => { throw new Error('platform_config: 503 PGRST002'); }, 'u1'), /503/);
});

test('a claim is bounded, owner-scoped and tolerant of an empty answer', async () => {
  const calls = [];
  const rpc = async (name, body) => { calls.push([name, body]); return [{ work_id: 1, image_id: 'a' }]; };
  assert.deepEqual(await claimStageWork(rpc, { limit: 400, userId: 'u1' }), [{ work_id: 1, image_id: 'a' }]);
  assert.deepEqual(calls[0], ['claim_image_stage_work', { p_stage: 'classifier', p_limit: 25, p_lease_seconds: 900, p_user_id: 'u1' }]);
  assert.deepEqual(await claimStageWork(async () => null), []);
});

test('an accepted reading succeeds; a policy skip is a policy skip', () => {
  const ok = receiptForResult({ orchestrator: { http: 200, success: true }, image_type: 'engine_bay' }, ctx);
  assert.equal(ok.outcome, 'succeeded');
  assert.deepEqual(ok.detail, { reader: ctx.reader, prompt_version: 'v98', image_type: 'engine_bay', orchestrator_http: 200 });
  const skip = receiptForResult({ orchestrator: { http: 200, success: true, skipped: 'cross_sweep_duplicate' } }, ctx);
  assert.equal(skip.outcome, 'policy_skip');
  assert.equal(skip.detail.skipped, 'cross_sweep_duplicate');
});

test('missing bytes block the input; they are never retried blindly', () => {
  for (const status of [400, 403, 404, 410]) {
    const r = receiptForResult({ download: { status } }, ctx);
    assert.deepEqual([r.outcome, r.error_class, r.http_status, r.retry_after_seconds], ['blocked_input', 'image_http_error', status, undefined]);
  }
});

test('transient faults are retried later, with a pause', () => {
  for (const status of [0, 408, 429, 500, 503]) {
    const r = receiptForResult({ download: { status } }, ctx);
    assert.equal(r.outcome, 'unavailable', `download ${status}`);
    assert.equal(r.retry_after_seconds, 900);
  }
  assert.equal(receiptForResult({ reader: { error: 'reader timed out after 240 s' } }, ctx).error_class, 'reader_timeout');
  assert.equal(receiptForResult({ reader: { error: 'no JSON in the reader output' } }, ctx).error_class, 'reader_output_invalid');
  assert.equal(receiptForResult({ reader: { error: 'claude exited 1: boom' } }, ctx).error_class, 'reader_exited');
  const down = receiptForResult({ orchestrator: { http: 500, error_class: 'pipeline_operation_failed' } }, ctx);
  assert.deepEqual([down.outcome, down.error_class, down.retry_after_seconds], ['unavailable', 'pipeline_operation_failed', 900]);
  assert.equal(receiptForResult({ orchestrator: { http: 0, error_class: 'orchestrator_request_error' } }, ctx).outcome, 'unavailable');
});

test('exhausted compute is rate_limited and stops the batch; it is not an image failure', () => {
  const limits = [
    'reader error: Claude usage limit reached. Your limit will reset at 3pm', 'claude exited 1: 429 rate_limit_error', 'reader error: quota exceeded',
    // the CLI's current wording
    "reader error: You've hit your 5-hour limit · resets 3pm (America/New_York)", "reader error: You've hit your weekly limit · resets Nov 14, 3pm",
    "reader error: You've hit your session limit · resets 3pm", "reader error: You're out of extra usage", 'reader error: API Error: 529 Overloaded',
    "reader error: You've reached your Fable limit.", 'reader error: 5-hour limit reached ∙ resets 3pm', 'reader error: Weekly limit reached',
  ];
  for (const error of limits) {
    const r = receiptForResult({ reader: { error } }, ctx);
    assert.deepEqual([r.outcome, r.error_class, r.stop, r.retry_after_seconds], ['rate_limited', 'reader_usage_limit', true, 3600], error);
  }
  // the CLI's own status field decides when the text does not
  const byStatus = receiptForResult({ reader: { error: 'reader error: something new', apiStatus: 429 } }, ctx);
  assert.deepEqual([byStatus.outcome, byStatus.stop, byStatus.http_status], ['rate_limited', true, 429]);
  assert.equal(receiptForResult({ orchestrator: { http: 429 } }, ctx).outcome, 'rate_limited');
});

test('a number or the word limit alone is not a usage limit', () => {
  const cases = [
    ["Expected ',' or '}' after property value in JSON at position 429 (line 1 column 430)", 'reader_output_invalid'],
    ['reader error: Context limit reached', 'reader_exited'],
    ['reader error: API Error: 400 Could not process image (req 4291)', 'reader_exited'],
    ['claude exited 1: ', 'reader_exited'],
  ];
  for (const [error, cls] of cases) {
    const r = receiptForResult({ reader: { error } }, ctx);
    assert.deepEqual([r.outcome, r.error_class, r.stop], ['unavailable', cls, undefined], error);
  }
  // the reader script marks an answer that did not parse; the parser's message is not consulted
  const marked = receiptForResult({ reader: { error: 'rate limit 429', invalidOutput: true } }, ctx);
  assert.deepEqual([marked.outcome, marked.error_class, marked.stop], ['unavailable', 'reader_output_invalid', undefined]);
});

test('a fault that is the batch\'s, not the photo\'s, stops the batch', () => {
  const login = receiptForResult({ reader: { error: 'reader error: Invalid API key · Please run /login', apiStatus: 401 } }, ctx);
  assert.deepEqual([login.outcome, login.error_class, login.stop], ['unavailable', 'reader_unauthorized', true]);
  const key = receiptForResult({ orchestrator: { http: 401, error: 'unauthorized' } }, ctx);
  assert.deepEqual([key.outcome, key.error_class, key.stop], ['unavailable', 'orchestrator_unauthorized', true]);
  const tool = receiptForResult({ convert: { missingTool: true } }, ctx);
  assert.deepEqual([tool.outcome, tool.error_class, tool.stop], ['unavailable', 'reader_tool_missing', true]);
  const noCli = receiptForResult({ reader: { error: 'spawn claude ENOENT', missingTool: true } }, ctx);
  assert.deepEqual([noCli.outcome, noCli.error_class, noCli.stop], ['unavailable', 'reader_tool_missing', true]);
  // the API cannot be reached: not this photo's fault, and not a usage limit either
  for (const down of [{ error: 'reader error: API Error: Connection refused' }, { error: 'reader error: API Error: 503 upstream', apiStatus: 503 },
    { error: 'claude exited 1: Error: connect ETIMEDOUT 160.79.104.10:443 (req 4291)' }, { error: 'reader error: something', apiStatus: 500 }]) {
    const r = receiptForResult({ reader: down }, ctx);
    assert.deepEqual([r.outcome, r.error_class, r.stop], ['unavailable', 'reader_api_unreachable', true], down.error);
  }
  assert.equal(receiptForResult({ orchestrator: { http: 500 } }, ctx).stop, undefined, 'a 500 is retried, the batch goes on');
});

test('bytes that are not an image, or no URL at all, block the input until the URL changes', () => {
  const r = receiptForResult({ convert: { missingTool: false } }, ctx);
  assert.deepEqual([r.outcome, r.error_class, r.retry_after_seconds, r.stop], ['blocked_input', 'image_unreadable', undefined, undefined]);
  const none = receiptForResult({ input: {} }, ctx);
  assert.deepEqual([none.outcome, none.error_class, none.retry_after_seconds, none.stop], ['blocked_input', 'image_url_missing', undefined, undefined]);
});

test('a refused reading is retried, never retired: the ledger does not re-offer a failed receipt', () => {
  const r = receiptForResult({ orchestrator: { http: 200, success: false, classifier_ok: false, error_class: 'classifier_response_invalid', requeued: true }, image_type: '-' }, ctx);
  assert.deepEqual([r.outcome, r.error_class, r.retry_after_seconds], ['unavailable', 'classifier_response_invalid', 900]);
  const results = [{ download: { status: 404 } }, { download: { status: 0 } }, { convert: {} }, { reader: { error: 'x' } }, { orchestrator: { http: 200, success: false } }, { orchestrator: { http: 400 } }];
  for (const x of results) assert.notEqual(receiptForResult(x, ctx).outcome, 'failed');
});

test('a policy skip keeps the name of the decision', () => {
  const named = receiptForResult({ orchestrator: { http: 200, success: true, skipped: true, classification: 'junk_url' } }, ctx);
  assert.deepEqual([named.outcome, named.detail.skipped], ['policy_skip', 'junk_url']);
  assert.equal(receiptForResult({ orchestrator: { http: 200, skipped: true } }, ctx).detail.skipped, 'skipped');
});

test('every receipt satisfies the table checks: a reason on every non-success, retry only on retryable outcomes', () => {
  const results = [
    { orchestrator: { http: 200, success: true } }, { orchestrator: { http: 200, skipped: 'junk_url' } }, { download: { status: 404 } },
    { download: { status: 503 } }, { reader: { error: 'timed out' } }, { reader: { error: 'usage limit' } },
    { orchestrator: { http: 200, success: false, classifier_ok: false } }, { orchestrator: { http: 502 } }, { orchestrator: {} },
    { convert: { missingTool: true } }, { convert: { missingTool: false } }, { reader: { error: 'x', apiStatus: 401 } }, { orchestrator: { http: 403 } },
    { input: {} }, { reader: { error: 'x', missingTool: true } }, { reader: { error: 'x', apiStatus: 502 } },
  ];
  for (const res of results) {
    const r = receiptForResult(res, ctx);
    assert.ok(['succeeded', 'policy_skip', 'blocked_input', 'unavailable', 'rate_limited', 'failed'].includes(r.outcome));
    if (!['succeeded', 'policy_skip'].includes(r.outcome)) assert.ok(r.error_class, `${r.outcome} carries an error_class`);
    if (r.retry_after_seconds != null) assert.ok(['unavailable', 'rate_limited'].includes(r.outcome), `${r.outcome} has no retry time`);
  }
});

test('recording a receipt never throws, and carries the fingerprint of the URL that was read', async () => {
  const md5 = (t) => createHash('md5').update(t, 'utf8').digest('hex');
  // the value Postgres computes for md5('https://example.test/13.jpg'), which image_stage_gaps compares against
  assert.equal(inputFingerprint('https://example.test/13.jpg', md5), md5('https://example.test/13.jpg'));
  assert.equal(inputFingerprint(null, md5), 'd41d8cd98f00b204e9800998ecf8427e', 'a missing URL is md5 of the empty string, as coalesce(image_url, \'\') gives');
  const sent = [];
  const good = await recordStageReceipt(async (n, b) => { sent.push([n, b]); return 41; }, { imageId: 'img', version: 1, fingerprint: 'abc', receipt: { outcome: 'blocked_input', error_class: 'image_http_error', http_status: 404, detail: { reader: 'x' } } });
  assert.deepEqual(good, { ok: true, id: 41, tries: 1 });
  assert.deepEqual(sent[0], ['record_image_stage_receipt', { p_image_id: 'img', p_stage: 'classifier', p_producer_version: 1, p_outcome: 'blocked_input', p_error_class: 'image_http_error', p_http_status: 404, p_retry_after_seconds: null, p_input_fingerprint: 'abc', p_detail: { reader: 'x' } }]);
  await recordStageReceipt(async (n, b) => { sent.push([n, b]); return 42; }, { imageId: 'img', version: 1, receipt: { outcome: 'succeeded' } });
  assert.equal(sent[1][1].p_input_fingerprint, null, 'no fingerprint given: null');
  // a failed write is tried again: without the receipt the photo would be read a second time
  let calls = 0;
  const flaky = await recordStageReceipt(async () => { if (++calls < 3) throw new Error('record_image_stage_receipt: 503'); return 43; }, { imageId: 'img', version: 1, receipt: { outcome: 'succeeded' }, pauseMs: 0 });
  assert.deepEqual([flaky.ok, flaky.id, flaky.tries, calls], [true, 43, 3, 3]);
  calls = 0;
  const bad = await recordStageReceipt(async () => { calls++; throw new Error('record_image_stage_receipt: 500 boom'); }, { imageId: 'img', version: 1, receipt: { outcome: 'succeeded' }, pauseMs: 0 });
  assert.deepEqual([bad.ok, calls], [false, 3], 'three tries, then it gives up without throwing');
  assert.match(bad.error, /500 boom/);
});
