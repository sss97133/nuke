// node --test scripts/photo-pipeline/stage-queue.test.mjs
// The readers' side of the stage ledger: what is claimed, and which typed receipt each frame result becomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { claimStageWork, claimStageWorkUpTo, FIRST_READS_PER_HOUR, firstReadAllowance, firstReadsSinceQuery, inputFingerprint, ownerFromStageConfig, queuedFirstReads, queuedFirstReadsQuery, receiptForDeepResult, receiptForKeyedResult, receiptForResult, recordStageReceipt, stageQueueEnabled } from './stage-queue.mjs';

const ctx = { reader: 'claude-cli claude-sonnet-5-5 subscription', promptVersion: 'v98' };

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

test('the queue is asked how many first reads are due without claiming any', async () => {
  const asked = [];
  const rest = (rows) => async (q) => { asked.push(q); return rows; };
  const now = new Date('2026-11-21T04:00:00.000Z');
  assert.equal(await queuedFirstReads(rest([{ id: 1 }, { id: 2 }, { id: 3 }]), { now }), 3);
  assert.equal(asked[0], 'image_stage_work?select=id&stage=eq.classifier&lane=eq.live&status=eq.queued&or=(not_before.is.null,not_before.lte.%222026-11-21T04:00:00.000Z%22)&limit=25',
    'newly landed photos (the live lane) queued past their retry pause; the timestamp is quoted for PostgREST; at most 25 rows come back');
  assert.equal(await queuedFirstReads(rest([])), 0, 'nothing queued');
  assert.equal(await queuedFirstReads(rest(null)), 0, 'an empty answer is nothing queued');
  assert.equal(queuedFirstReadsQuery('T', 'deep_reading').includes('stage=eq.deep_reading'), true);
  await assert.rejects(queuedFirstReads(async () => { throw new Error('503'); }), /503/, 'a failed request is an error, never "nothing queued"');
});

test('what a fast fire may start: queued first reads held to the hourly ceiling, which the database can name', async () => {
  const now = new Date('2026-11-21T04:00:00.000Z');
  const world = ({ queued, read, cfg }) => {
    const asked = [];
    return { asked,
      rest: async (q) => { asked.push(q); return q.startsWith('platform_config') ? (cfg === undefined ? [] : [{ config_value: cfg }]) : Array.from({ length: queued }, (_, i) => ({ id: i })); },
      count: async (q) => { asked.push(q); return read; } };
  };
  const w = world({ queued: 6, read: 40, cfg: { enabled: true } });
  assert.deepEqual(await firstReadAllowance({ ...w, now }), { queued: 6, read_last_hour: 40, per_hour: FIRST_READS_PER_HOUR, start: 6 }, 'under the ceiling: everything queued may start');
  assert.equal(w.asked.includes(firstReadsSinceQuery('2026-11-21T03:00:00.000Z')), true, 'reads are counted over the hour before now');
  assert.equal(firstReadsSinceQuery('2026-11-21T03:00:00.000Z'), 'image_stage_receipts?select=id&stage=eq.classifier&detail-%3E%3Ereader=like.claude-cli*&observed_at=gte.2026-11-21T03%3A00%3A00.000Z&limit=1',
    'only the readers that spend the subscription count against its ceiling');
  assert.equal((await firstReadAllowance({ ...world({ queued: 25, read: FIRST_READS_PER_HOUR - 4, cfg: {} }), now })).start, 4, 'near the ceiling: only the room that is left');
  assert.equal((await firstReadAllowance({ ...world({ queued: 25, read: FIRST_READS_PER_HOUR + 80, cfg: {} }), now })).start, 0, 'past the ceiling: nothing starts, the photos stay queued');
  assert.deepEqual(await firstReadAllowance({ ...world({ queued: 25, read: 10, cfg: { first_reads_per_hour: 12 } }), now }), { queued: 25, read_last_hour: 10, per_hour: 12, start: 2 }, 'the database names the ceiling');
  assert.equal((await firstReadAllowance({ ...world({ queued: 5, read: 0, cfg: { first_reads_per_hour: 0 } }), now })).start, 0, 'a ceiling of zero in the database stops fast fires');
  assert.equal((await firstReadAllowance({ ...world({ queued: 5, read: 0, cfg: { first_reads_per_hour: 'many' } }), now })).per_hour, FIRST_READS_PER_HOUR, 'a value that is not a number is not a ceiling');
  assert.equal((await firstReadAllowance({ ...world({ queued: 5, read: 0, cfg: undefined }), now })).start, 5, 'no config row: the default ceiling');
  await assert.rejects(firstReadAllowance({ rest: w.rest, count: async () => { throw new Error('503'); }, now }), /503/, 'a count that fails is an error, never "nothing to read"');
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

test('a stage claims across calls (the database hands out 25 at most), and a stage the database lacks is a quiet no-op', async () => {
  const asked = [];
  const rpc = async (name, body) => { asked.push(body.p_limit); return Array.from({ length: asked.length < 3 ? body.p_limit : 5 }, (_, i) => ({ work_id: asked.length * 100 + i, image_id: `i${asked.length}-${i}` })); };
  const got = await claimStageWorkUpTo(rpc, { stage: 'keyed_values', limit: 60, leaseSeconds: 1800, userId: 'u1' });
  assert.deepEqual([got.work.length, got.error, asked], [55, null, [25, 25, 10]], 'a short answer ends the claims');
  const none = await claimStageWorkUpTo(async () => [], { stage: 'deep_reading', limit: 20, leaseSeconds: 900, userId: 'u1' });
  assert.deepEqual([none.work, none.error], [[], null], 'claim_image_stage_work answers an empty list for a stage that is not registered');
  const failed = await claimStageWorkUpTo(async () => { throw new Error('claim_image_stage_work: 500 boom'); }, { stage: 'deep_reading', limit: 20, leaseSeconds: 900, userId: 'u1' });
  assert.deepEqual([failed.work, failed.error], [[], 'claim_failed'], 'returned, never thrown');
});

test('deep reading: every answer the intake can give is a typed receipt', () => {
  const dctx = { reader: 'claude-cli claude-sonnet-5-5 subscription', promptVersion: 'reviewed_image_analysis_v1' };
  const of = (result) => { const r = receiptForDeepResult(result, dctx); return [r.outcome, r.error_class ?? r.detail.skipped ?? null, r.retry_after_seconds ?? null, r.stop === true]; };
  assert.deepEqual(of({ intake: { http: 200, success: true, observation_id: 'o1' } }), ['succeeded', null, null, false]);
  assert.equal(receiptForDeepResult({ intake: { http: 200, success: true, observation_id: 'o1' } }, dctx).detail.observation_id, 'o1');
  // an automatic reading lands as its observation alone (no placement on the photo): the receipt says so, and how many older readings it replaced
  const thin = receiptForDeepResult({ intake: { http: 200, success: true, observation_id: 'o1', image_observation_id: null, thin_tier: true, superseded_readings: 1 } }, dctx);
  assert.deepEqual([thin.outcome, thin.detail.observation_id, thin.detail.thin_tier, thin.detail.superseded_readings], ['succeeded', 'o1', true, 1]);
  const placed = receiptForDeepResult({ intake: { http: 200, success: true, observation_id: 'o1', image_observation_id: 'p1', thin_tier: 'yes', superseded_readings: '1' } }, dctx);
  assert.deepEqual(['thin_tier' in placed.detail, 'superseded_readings' in placed.detail], [false, false], 'only the projection\'s own boolean and count are kept');
  // the source changed during the read: retried in about two minutes
  for (const code of ['review_source_changed', 'review_source_changed_during_projection', 'review_projection_not_persisted']) assert.deepEqual(of({ intake: { http: 409, success: false, error: code } }), ['unavailable', code, 120, false]);
  // a refusal with no reason the reader can see, a stored reading the projection calls not eligible, and a withdrawal wait an hour
  for (const code of ['review_projection_refused', 'review_observation_not_eligible', 'review_source_withdrawn']) assert.deepEqual(of({ intake: { http: 409, success: false, error: code } }), ['unavailable', code, 3600, false]);
  // a word of the projection the reader has no rule of its own for keeps its name and is retried
  assert.deepEqual(of({ intake: { http: 409, success: false, error: 'review_search_projection_not_persisted' } }), ['unavailable', 'review_search_projection_not_persisted', 900, false]);
  // withdrawn or not eligible: closed with its reason
  assert.deepEqual(of({ intake: { http: 409, success: false, error: 'review_source_previously_withdrawn' } }), ['policy_skip', 'review_source_previously_withdrawn', null, false]);
  assert.deepEqual(of({ policy: 'document' }), ['policy_skip', 'document', null, false]);
  // a gate that has not passed yet can pass: a pause the ledger reopens, never a policy_skip (which no gap rule reopens)
  assert.deepEqual(of({ policy: 'gate_not_approved' }), ['unavailable', 'gate_not_approved', 3600, false]);
  // the contract refused the answer
  for (const code of ['invalid_review_envelope', 'invalid_review_identity', 'invalid_review_verdict', 'invalid_review_state', 'invalid_review_presence', 'invalid_review_workshop', 'invalid_review_camera',
    'invalid_review_regions', 'invalid_review_flags', 'invalid_review_notes', 'invalid_review_lists', 'invalid_review_source', 'invalid_review_provenance', 'review_too_large']) assert.deepEqual(of({ intake: { http: 400, success: false, error: code } }), ['unavailable', 'reader_output_invalid', 1800, false], code);
  assert.equal(receiptForDeepResult({ intake: { http: 400, error: 'invalid_review_camera' } }, dctx).detail.intake_error, 'invalid_review_camera', 'the refusal\'s own word is kept in the detail');
  // the intake or its writer is down: retried, the batch goes on
  for (const [http, code] of [[503, 'review_source_unavailable'], [500, 'review_persistence_failed']]) assert.deepEqual(of({ intake: { http, success: false, error: code } }), ['unavailable', code, 900, false]);
  // not written (the ingest failed, or the database's rule for the reader's tier refused the row): an hour, each attempt spends two reads
  assert.deepEqual(of({ intake: { http: 502, success: false, error: 'review_observation_not_persisted' } }), ['unavailable', 'review_observation_not_persisted', 3600, false]);
  // the reader's own reading by the same method already stands (found in the observations; its landing was finished): the
  // stage is done, no read was spent, and the receipt names the reading
  assert.deepEqual([receiptForDeepResult({ policy: 'already_read_same_method' }, dctx).outcome, receiptForDeepResult({ policy: 'already_read_same_method' }, dctx).detail.already_read], ['succeeded', 'same_method']);
  const finished = receiptForDeepResult({ policy: 'already_read_same_method', detail: { observation_id: 'o9', landing_finished: true, superseded_readings: 0 } }, dctx);
  assert.deepEqual([finished.outcome, finished.detail.already_read, finished.detail.observation_id, finished.detail.landing_finished, finished.detail.superseded_readings], ['succeeded', 'same_method', 'o9', true, 0]);
  assert.deepEqual(of({ intake: { http: 0, error: 'orchestrator_request_error' } }), ['unavailable', 'orchestrator_request_error', 900, false]);
  // the service key was refused: the batch stops
  assert.deepEqual(of({ intake: { http: 403, success: false, error: 'review_requires_service_role' } }), ['unavailable', 'orchestrator_unauthorized', 900, true]);
  assert.deepEqual(of({ intake: { http: 401, error: 'unauthorized' } }), ['unavailable', 'orchestrator_unauthorized', 900, true]);
  assert.deepEqual(of({ intake: { http: 429 } }), ['rate_limited', 'orchestrator_rate_limited', 900, false]);
  // faults before the intake are the first read's receipts, unchanged
  assert.deepEqual(of({ download: { status: 404 } }), ['blocked_input', 'image_http_error', null, false]);
  assert.deepEqual(of({ download: { status: 0 } }), ['unavailable', 'image_download_error', 900, false]);
  assert.deepEqual(of({ convert: { missingTool: true } }), ['unavailable', 'reader_tool_missing', 3600, true]);
  assert.deepEqual(of({ reader: { error: 'You\'ve hit your 5-hour limit', apiStatus: 429 } }), ['rate_limited', 'reader_usage_limit', 3600, true]);
  assert.deepEqual(of({ reader: { error: 'no valid pair', invalidOutput: true } }), ['unavailable', 'reader_output_invalid', 1800, false], 'fewer than two valid reads: retryable');
  assert.deepEqual(of({ reader: { error: 'reader timed out after 240 s' } }), ['unavailable', 'reader_timeout', 1800, false]);
  assert.equal(receiptForDeepResult({ reader: { invalidOutput: true }, detail: { run_id: 'r' } }, dctx).detail.run_id, 'r', 'the stage detail is kept');
});

test('keyed values: the number written, or the projection\'s own reason', () => {
  const kctx = { reader: 'r', promptVersion: 'byok_image_properties_v1' };
  const of = (projection, error) => { const r = receiptForKeyedResult({ projection, error }, kctx); return [r.outcome, r.error_class ?? r.detail.skipped ?? null, r.detail.values ?? null]; };
  const base = { source_rows: 1, eligible_claims: 0, inserted: 0, duplicates: 0, failed: 0, deferred: {} };
  assert.deepEqual(of({ ...base, eligible_claims: 3, inserted: 3, verified: 3 }), ['succeeded', null, 3]);
  assert.deepEqual(of({ ...base, eligible_claims: 3, inserted: 1, duplicates: 2 }), ['succeeded', null, 3], 'a claim the database already held counts: it is keyed');
  const already = receiptForKeyedResult({ projection: { ...base, already_projected: 3 } }, kctx);
  assert.deepEqual([already.outcome, already.detail.values, already.detail.already_there], ['succeeded', 3, true]);
  for (const why of ['receipt_document', 'no_known_scalar_values', 'source_requires_review', 'image_not_eligible', 'child_not_public', 'not_current_byok_testimony']) {
    assert.deepEqual(of({ ...base, deferred: { [why]: 1 } }), ['policy_skip', why, 0], why);
  }
  assert.equal(of({ ...base, deferred: { a_reason: 1, receipt_document: 2 } })[1], 'receipt_document', 'the commonest reason');
  assert.deepEqual(of({ ...base, deferred: { privacy_check_unavailable: 1 } }), ['unavailable', 'privacy_check_unavailable', 0], 'a check that could not be asked is retried, not closed');
  assert.deepEqual(of({ ...base, source_rows: 0 }), ['unavailable', 'reading_not_found', 0], 'the ledger says a reading landed but the projection found none');
  assert.deepEqual(of({ ...base, eligible_claims: 3, failed: 1, reason: 'batch_receipt_invalid' }), ['unavailable', 'projection_failed', 0]);
  assert.deepEqual(of({ ...base, eligible_claims: 3, inserted: 1, unattempted: 2, failed: 1, reason: 'run_budget_exhausted' }), ['unavailable', 'projection_failed', 1], 'a partial landing is retried; the rest is landed next time');
  assert.deepEqual(of(null, 'project-cached: source query failed'), ['unavailable', 'projection_error', null]);
  assert.equal(receiptForKeyedResult({ projection: { ...base, failed: 1 } }, kctx).retry_after_seconds, 900);
  // every receipt of a projection that ran names the reading it is about, whatever the outcome: a receipt is never
  // taken as the answer for a later reading of the same photo
  const named = { ...base, current_reading_ids: ['30000000-0000-4000-8000-000000000009'] };
  for (const projection of [{ ...named, eligible_claims: 3, inserted: 3 }, { ...named, already_projected: 3 }, { ...named, deferred: { receipt_document: 1 } },
    { ...named, deferred: { privacy_check_unavailable: 1 } }, { ...named, source_rows: 0 }, { ...named, eligible_claims: 3, failed: 1, reason: 'ingest_failed' }]) {
    assert.equal(receiptForKeyedResult({ projection }, kctx).detail.source_observation_id, '30000000-0000-4000-8000-000000000009', JSON.stringify(projection));
  }
  // no current reading, more than one, or a projection that never ran: no reading is named
  for (const projection of [base, { ...base, current_reading_ids: [] }, { ...base, current_reading_ids: ['a', 'b'] }, { ...base, current_reading_ids: [5] }, { ...base, current_reading_ids: 'a' }]) {
    assert.ok(!('source_observation_id' in receiptForKeyedResult({ projection }, kctx).detail), JSON.stringify(projection));
  }
  assert.ok(!('source_observation_id' in receiptForKeyedResult({ error: 'boom' }, kctx).detail));
});

test('--owner config takes the one owner the reconciler names, and refuses anything else', async () => {
  const id = '0b9f107a-d124-49de-9ded-94698f63c1c4';
  const asked = [];
  const rest = (cfg) => async (q) => { asked.push(q); return cfg === undefined ? [] : [{ config_value: cfg }]; };
  assert.equal(await ownerFromStageConfig(rest({ enabled: true, user_ids: [id] })), id);
  assert.match(asked[0], /config_key=eq\.image_stage_reconciler/);
  for (const cfg of [undefined, { enabled: true }, { user_ids: [] }, { user_ids: [id, id] }, { user_ids: [id.toUpperCase()] }, { user_ids: ['x'] }, { user_ids: [7] }]) {
    await assert.rejects(ownerFromStageConfig(rest(cfg)), (e) => e.code === 'owner_config' && !e.message.includes(id));
  }
});
