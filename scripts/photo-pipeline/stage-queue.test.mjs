// node --test scripts/photo-pipeline/stage-queue.test.mjs
// The readers' side of the stage ledger: what is claimed, and which typed receipt each frame result becomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimStageWork, receiptForResult, recordStageReceipt, stageQueueEnabled } from './stage-queue.mjs';

const ctx = { reader: 'claude-cli sonnet subscription', promptVersion: 'v98' };

test('the ledger is used only when the reconciler flag is on', async () => {
  assert.equal(await stageQueueEnabled(async () => [{ config_value: { enabled: true } }]), true);
  assert.equal(await stageQueueEnabled(async () => [{ config_value: { enabled: false } }]), false);
  assert.equal(await stageQueueEnabled(async () => []), false, 'no config row: off');
  assert.equal(await stageQueueEnabled(async () => { throw new Error('404'); }), false, 'ledger not deployed: off');
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
  for (const error of ['reader error: Claude usage limit reached. Your limit will reset at 3pm', 'claude exited 1: 429 rate_limit_error', 'reader error: quota exceeded']) {
    const r = receiptForResult({ reader: { error } }, ctx);
    assert.deepEqual([r.outcome, r.error_class, r.stop, r.retry_after_seconds], ['rate_limited', 'reader_usage_limit', true, 3600], error);
  }
  assert.equal(receiptForResult({ orchestrator: { http: 429 } }, ctx).outcome, 'rate_limited');
});

test('a refused reading is a typed failure', () => {
  const r = receiptForResult({ orchestrator: { http: 200, success: false, classifier_ok: false, error_class: 'classifier_response_invalid' }, image_type: '-' }, ctx);
  assert.deepEqual([r.outcome, r.error_class], ['failed', 'classifier_response_invalid']);
});

test('every receipt satisfies the table checks: a reason on every non-success, retry only on retryable outcomes', () => {
  const results = [
    { orchestrator: { http: 200, success: true } }, { orchestrator: { http: 200, skipped: 'junk_url' } }, { download: { status: 404 } },
    { download: { status: 503 } }, { reader: { error: 'timed out' } }, { reader: { error: 'usage limit' } },
    { orchestrator: { http: 200, success: false, classifier_ok: false } }, { orchestrator: { http: 502 } }, { orchestrator: {} },
  ];
  for (const res of results) {
    const r = receiptForResult(res, ctx);
    assert.ok(['succeeded', 'policy_skip', 'blocked_input', 'unavailable', 'rate_limited', 'failed'].includes(r.outcome));
    if (!['succeeded', 'policy_skip'].includes(r.outcome)) assert.ok(r.error_class, `${r.outcome} carries an error_class`);
    if (r.retry_after_seconds != null) assert.ok(['unavailable', 'rate_limited'].includes(r.outcome), `${r.outcome} has no retry time`);
  }
});

test('recording a receipt never throws', async () => {
  const sent = [];
  const good = await recordStageReceipt(async (n, b) => { sent.push([n, b]); return 41; }, { imageId: 'img', version: 1, receipt: { outcome: 'blocked_input', error_class: 'image_http_error', http_status: 404, detail: { reader: 'x' } } });
  assert.deepEqual(good, { ok: true, id: 41 });
  assert.deepEqual(sent[0], ['record_image_stage_receipt', { p_image_id: 'img', p_stage: 'classifier', p_producer_version: 1, p_outcome: 'blocked_input', p_error_class: 'image_http_error', p_http_status: 404, p_retry_after_seconds: null, p_input_fingerprint: null, p_detail: { reader: 'x' } }]);
  const bad = await recordStageReceipt(async () => { throw new Error('record_image_stage_receipt: 500 boom'); }, { imageId: 'img', version: 1, receipt: { outcome: 'succeeded' } });
  assert.equal(bad.ok, false);
});
