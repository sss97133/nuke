import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSAY_LIMITS, JEV_MODEL, JEV_ENDPOINT, prepareAssay, validateAssayResponse,
  runQuestionnaireAssay } from './jev-questionnaire-assay.mjs';
import { main, parseArgs } from '../assay-jev-questionnaire.mjs';

const bank = () => ({ version: 'synthetic-v1', model: JEV_MODEL, questions: {
  planned: { type: 'noul', instructions: 'Does this public text describe planned work?' },
  relation: { type: 'choice', instructions: 'Classify this pair of public statements.',
    criteria: { answers: 'The second statement answers the first.', unrelated: 'It does not answer the first.' } },
  coverage: { type: 'score', instructions: 'How fully does the second statement answer the first?',
    criteria: ['No answer', 'Partial answer', 'Full answer'] },
} });
const records = (count = 1) => Array.from({ length: count }, (_, index) => ({ id: `synthetic-${index}`,
  public: true, state: { question: 'Has the tire replacement happened?',
    response: 'The appointment is tomorrow.', sequence: index }, expected: { relation: 'answers' } }));
const response = () => ({ model: JEV_MODEL, usage: { input_tokens: 500, output_tokens: 30 }, answers: {
  planned: { type: 'noul', noul: 0.95 },
  relation: { type: 'choice', choice: 'answers', confidence: 0.6,
    probabilities: { answers: 0.8, unrelated: 0.2 } },
  coverage: { type: 'score', score: 1.4, confidence: 0.6,
    probabilities: { 0: 0.1, 1: 0.4, 2: 0.5 }, legend: { 0: 'No answer', 1: 'Partial answer', 2: 'Full answer' } },
} });
const jsonResponse = (value = response(), status = 200) => new Response(JSON.stringify(value), { status });
const key = 'synthetic-typesafe-test-key';
const run = options => runQuestionnaireAssay({ bank: bank(), records: records(), run: true, apiKey: key, ...options });
const hasCode = code => error => error.code === code;

test('default dry run has no implicit execution or key requirement', async () => {
  let calls = 0;
  const result = await runQuestionnaireAssay({ bank: bank(), records: records(), apiKey: key,
    fetchImpl() { calls++; throw Error('must not call'); } });
  assert.equal(calls, 0);
  assert.equal(result.summary.mode, 'dry_run');
  assert.equal(result.summary.requests_attempted, 0);
  assert.equal(result.summary.calculated_usd_reported, 0);
  assert.equal(result.summary.expected_labels, 1);
  assert.ok(result.summary.total_request_bytes > 0);
  assert.deepEqual(result.results, []);
});

test('successful requests use pinned official endpoint, complete typed answers, measured receipts and at most two workers', async () => {
  let active = 0, peak = 0, calls = 0;
  const result = await run({ records: records(5), fetchImpl: async (url, init) => {
    calls++; active++; peak = Math.max(peak, active);
    assert.equal(url, JEV_ENDPOINT);
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body), ['model', 'state', 'questions']);
    assert.equal(body.model, JEV_MODEL);
    assert.equal(body.expected, undefined);
    await new Promise(resolve => setTimeout(resolve, 4));
    active--;
    return jsonResponse();
  } });
  assert.equal(calls, 5); assert.equal(peak, 2);
  assert.equal(result.summary.successful_records, 5);
  assert.equal(result.summary.input_tokens_reported, 2500);
  assert.equal(result.summary.output_tokens_reported, 150);
  assert.equal(result.summary.calculated_usd_reported, 2500 * 0.042 / 1e6);
  assert.equal(result.summary.usage_unreported_requests, 0);
  assert.equal(result.summary.expected_label_agreement.fraction, 1);
  assert.equal(result.summary.expected_label_agreement.interpretation, 'supplied_choice_label_agreement_not_calibration');
  assert.ok(result.summary.p95_ms >= result.summary.p50_ms);
  for (const item of result.results) {
    assert.equal(item.returned_model, JEV_MODEL);
    assert.deepEqual(item.response, response());
    assert.deepEqual(JSON.parse(item.raw_response), response());
    assert.match(item.state_sha256, /^[0-9a-f]{64}$/);
    assert.match(item.request_sha256, /^[0-9a-f]{64}$/);
    assert.equal(item.http_status, 200);
    assert.equal(item.error, null);
  }
});

const inputFaults = [
  ['private source', ({ records }) => { records[0].public = false; }, 'public_source_attestation_required'],
  ['missing public attestation', ({ records }) => { delete records[0].public; }, 'public_source_attestation_required'],
  ['unknown model', ({ bank }) => { bank.model = 'jev-latest'; }, 'invalid_question_bank'],
  ['missing version', ({ bank }) => { delete bank.version; }, 'invalid_question_bank'],
  ['unknown question type', ({ bank }) => { bank.questions.planned.type = 'text'; }, 'unsupported_question_type'],
  ['unordered score criteria', ({ bank }) => { bank.questions.coverage.criteria = { low: 'No', high: 'Yes' }; }, 'invalid_score_criteria'],
  ['unknown expected option', ({ records }) => { records[0].expected.relation = 'unknown'; }, 'invalid_expected_choice'],
  ['expected label for non-choice', ({ records }) => { records[0].expected.planned = 'yes'; }, 'invalid_expected_choice'],
  ['duplicate record', ({ records }) => { records.push(structuredClone(records[0])); }, 'invalid_or_duplicate_record'],
  ['31 records', input => { input.records = records(31); }, 'record_limit_or_shape'],
  ['empty records', input => { input.records = []; }, 'record_limit_or_shape'],
  ['UTF8 byte oversize', ({ records }) => { records[0].state = '🚗'.repeat(3000); }, 'record_input_byte_limit'],
  ['non-JSON state', ({ records }) => { records[0].state = { value: Infinity }; }, 'invalid_text_state'],
];
for (const [name, mutate, code] of inputFaults) test(`${name} rejects entire cohort before a request`, async () => {
  const input = { bank: bank(), records: records() }; mutate(input);
  let calls = 0;
  await assert.rejects(run({ ...input, fetchImpl() { calls++; } }), hasCode(code));
  assert.equal(calls, 0);
});

test('exact serialized input boundary includes questionnaire and UTF8 bytes', () => {
  const cohort = records(30);
  for (const record of cohort) {
    record.state = '';
    const overhead = Buffer.byteLength(JSON.stringify({ model: JEV_MODEL, state: '', questions: bank().questions }));
    record.state = 'a'.repeat(ASSAY_LIMITS.recordBytes - overhead);
  }
  const prepared = prepareAssay(bank(), cohort);
  assert.equal(prepared.stats.maximum_request_bytes, 12000);
  assert.equal(prepared.stats.total_request_bytes, 360000);
  cohort[0].state += 'a';
  assert.throws(() => prepareAssay(bank(), cohort), hasCode('record_input_byte_limit'));
});

const answerFaults = [
  ['model', value => { value.model = 'jev-1.12'; }, 'returned_model_mismatch'],
  ['missing usage', value => { delete value.usage; }, 'invalid_usage'],
  ['negative usage', value => { value.usage.input_tokens = -1; }, 'invalid_usage'],
  ['fractional usage', value => { value.usage.output_tokens = 0.5; }, 'invalid_usage'],
  ['missing answer', value => { delete value.answers.planned; }, 'answer_coverage_mismatch'],
  ['extra answer', value => { value.answers.extra = {}; }, 'answer_coverage_mismatch'],
  ['wrong type', value => { value.answers.planned.type = 'choice'; }, 'answer_type_mismatch'],
  ['noul out of range', value => { value.answers.planned.noul = 1.1; }, 'invalid_noul_probability'],
  ['noul nonfinite', value => { value.answers.planned.noul = NaN; }, 'invalid_noul_probability'],
  ['noul string', value => { value.answers.planned.noul = '0.9'; }, 'invalid_noul_probability'],
  ['choice unknown option', value => { value.answers.relation.choice = 'maybe'; }, 'invalid_choice_answer'],
  ['choice confidence', value => { value.answers.relation.confidence = Infinity; }, 'invalid_choice_answer'],
  ['choice sum', value => { value.answers.relation.probabilities.answers = 0.6; }, 'invalid_choice_answer'],
  ['choice extra key', value => { value.answers.relation.probabilities.maybe = 0; }, 'invalid_choice_answer'],
  ['choice negative probability', value => { value.answers.relation.probabilities = { answers: 1.1, unrelated: -0.1 }; }, 'invalid_choice_answer'],
  ['choice not maximum', value => { value.answers.relation.choice = 'unrelated'; }, 'choice_not_probability_maximum'],
  ['score range', value => { value.answers.coverage.score = 3; }, 'invalid_score_answer'],
  ['score legend order', value => { value.answers.coverage.legend[0] = 'Full answer'; }, 'invalid_score_answer'],
  ['score missing probability', value => { delete value.answers.coverage.probabilities[2]; }, 'invalid_score_answer'],
  ['score expectation mismatch', value => { value.answers.coverage.score = 0.1; }, 'score_probability_mismatch'],
];
for (const [name, mutate, code] of answerFaults) test(`malformed ${name} is never accepted`, () => {
  const value = response(); mutate(value);
  assert.throws(() => validateAssayResponse(value, bank()), hasCode(code));
});

test('HTTP, transport, malformed JSON and invalid typed responses each fail once while other records continue', async () => {
  let calls = 0;
  const result = await run({ records: records(5), fetchImpl: async (_url, init) => {
    calls++;
    switch (JSON.parse(init.body).state.sequence) {
      case 0: return jsonResponse({ error: 'Synthetic provider failure' }, 429);
      case 1: throw Error('sensitive provider message');
      case 2: return new Response('not JSON');
      case 3: { const value = response(); value.answers.planned.noul = 2; return jsonResponse(value); }
      default: return jsonResponse();
    }
  } });
  assert.equal(calls, 5);
  assert.equal(result.summary.successful_records, 1);
  assert.equal(result.summary.failed_records, 4);
  assert.deepEqual(result.summary.failures, { http_429: 1, transport_failed: 1, invalid_response_json: 1, invalid_noul_probability: 1 });
  assert.equal(result.summary.input_tokens_reported, 1000);
  assert.equal(result.summary.usage_unreported_requests, 3);
  assert.equal(result.summary.expected_label_agreement.expected, 5);
  assert.equal(result.summary.expected_label_agreement.compared, 1);
  assert.ok(!JSON.stringify(result).includes('sensitive provider message'));
});

test('request timeout aborts without retry or false success', async () => {
  let calls = 0, signal;
  const result = await run({ requestTimeoutMs: 5, fetchImpl: (_url, init) => {
    calls++; signal = init.signal; return new Promise(() => {});
  } });
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
  assert.equal(result.results[0].error, 'request_timeout');
  assert.equal(result.summary.failed_records, 1);
  assert.equal(result.summary.usage_unreported_requests, 1);
});

test('response size ceiling fails closed', async () => {
  const result = await run({ fetchImpl: async () => new Response('x'.repeat(ASSAY_LIMITS.responseBytes + 1)) });
  assert.equal(result.results[0].error, 'response_byte_limit');
  assert.equal(result.summary.successful_records, 0);
});

test('credential in input is refused, provider credential echo is redacted from full artifact', async () => {
  const cohort = records(); cohort[0].id = key;
  await assert.rejects(run({ records: cohort }), hasCode('credential_in_input'));
  const value = response(); value.metadata = { accidental_echo: key };
  const result = await run({ fetchImpl: async () => jsonResponse(value) });
  assert.equal(result.summary.successful_records, 1);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.equal(result.results[0].response.metadata.accidental_echo, '[REDACTED_API_KEY]');
});

test('supplied label disagreement is measured as agreement, never calibrated truth', async () => {
  const cohort = records(2); cohort[1].expected.relation = 'unrelated';
  const result = await run({ records: cohort, fetchImpl: async () => jsonResponse() });
  assert.equal(result.summary.expected_label_agreement.compared, 2);
  assert.equal(result.summary.expected_label_agreement.matched, 1);
  assert.equal(result.summary.expected_label_agreement.fraction, 0.5);
});

test('explicit run requires a key and bounded timeout', async () => {
  await assert.rejects(run({ apiKey: '' }), hasCode('typesafe_api_key_required'));
  await assert.rejects(run({ run: 'true' }), hasCode('run_flag_must_be_boolean'));
  await assert.rejects(run({ requestTimeoutMs: 15001 }), hasCode('invalid_timeout_budget'));
});

test('CLI flags are exact; importing CLI did not implicitly execute it', () => {
  assert.deepEqual(parseArgs(['--bank', 'b.json', '--records', 'r.json', '--out', 'o.json']),
    { run: false, bank: 'b.json', records: 'r.json', out: 'o.json' });
  assert.throws(() => parseArgs(['--execute']), hasCode('unknown_argument'));
  assert.throws(() => parseArgs(['--run', '--run']), hasCode('duplicate_run_flag'));
  assert.throws(() => parseArgs([]), hasCode('bank_records_out_required'));
});

test('CLI creates private dry/live artifacts, prints only compact summary, and refuses overwrite before spending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jev-assay-test-'));
  try {
    const bankPath = join(directory, 'bank.json'), recordPath = join(directory, 'records.json');
    await Promise.all([writeFile(bankPath, JSON.stringify(bank())), writeFile(recordPath, JSON.stringify(records()))]);
    const args = out => ['--bank', bankPath, '--records', recordPath, '--out', join(directory, out)];
    let calls = 0; const printed = [];
    const deps = { apiKey: key, print: text => printed.push(text), fetchImpl: async () => { calls++; return jsonResponse(); } };
    assert.equal(await main(args('dry.json'), deps), 0);
    assert.equal(calls, 0);
    assert.equal((await stat(join(directory, 'dry.json'))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(join(directory, 'dry.json'), 'utf8')).summary.mode, 'dry_run');
    assert.equal(await main([...args('live.json'), '--run'], deps), 0);
    assert.equal(calls, 1);
    assert.equal((await stat(join(directory, 'live.json'))).mode & 0o777, 0o600);
    const full = JSON.parse(await readFile(join(directory, 'live.json'), 'utf8'));
    assert.deepEqual(full.results[0].response, response());
    assert.equal(await main([...args('live.json'), '--run'], deps), 1);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(printed.at(-1)).error, 'output_exists_or_unwritable');
    for (const text of printed) {
      assert.ok(!text.includes(key));
      assert.ok(!text.includes('appointment'));
      assert.ok(!text.includes('probabilities'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
