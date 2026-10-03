import { createHash } from 'node:crypto';

export const JEV_MODEL = 'jev-1.13.0';
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const ASSAY_LIMITS = Object.freeze({ records: 30, recordBytes: 12000, totalBytes: 360000,
  concurrency: 2, requestTimeoutMs: 15000, runTimeoutMs: 240000, responseBytes: 1048576 });
export const INPUT_USD_PER_MILLION = 0.042;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const bytes = value => Buffer.byteLength(value, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const allowed = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const fail = code => { throw new AssayError(code); };
export class AssayError extends Error {
  constructor(code) { super(code); this.name = 'AssayError'; this.code = code; }
}
function jsonValue(value, depth = 0) {
  if (depth > 30) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(entry => jsonValue(entry, depth + 1));
  return object(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(entry => jsonValue(entry, depth + 1));
}
function description(value) {
  return (typeof value === 'string' && value.trim().length > 0) ||
    ((object(value) || Array.isArray(value)) && jsonValue(value) && Object.keys(value).length > 0);
}

/** Validate the entire assay before admitting any network work. Expected labels never enter state. */
export function prepareAssay(bank, records) {
  if (!object(bank) || !allowed(bank, ['version', 'model', 'questions']) ||
      typeof bank.version !== 'string' || !bank.version.trim() || bank.version.length > 128 ||
      bank.model !== JEV_MODEL || !object(bank.questions) || Object.keys(bank.questions).length === 0) fail('invalid_question_bank');
  for (const [id, question] of Object.entries(bank.questions)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id) || !object(question) ||
        !allowed(question, ['type', 'instructions', 'criteria']) || !description(question.instructions)) fail('invalid_question');
    if (question.type === 'choice') {
      if (!object(question.criteria) || Object.keys(question.criteria).length < 2 ||
          Object.keys(question.criteria).length > 255 ||
          Object.entries(question.criteria).some(([key, value]) => !key || !(value === null || description(value)))) fail('invalid_choice_criteria');
    } else if (question.type === 'score') {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10 ||
          !question.criteria.every(description)) fail('invalid_score_criteria');
    } else if (question.type === 'noul') {
      if (question.criteria !== undefined && question.criteria !== null &&
          (!object(question.criteria) || !allowed(question.criteria, ['true', 'false']) ||
           Object.values(question.criteria).some(value => value !== null && !description(value)))) fail('invalid_noul_criteria');
    } else fail('unsupported_question_type');
  }
  if (!Array.isArray(records) || records.length === 0 || records.length > ASSAY_LIMITS.records) fail('record_limit_or_shape');
  const ids = new Set();
  let totalBytes = 0;
  let expectedLabels = 0;
  const requests = records.map(record => {
    if (!object(record) || !allowed(record, ['id', 'public', 'state', 'expected']) ||
        typeof record.id !== 'string' || !record.id.trim() || record.id.length > 256 || ids.has(record.id)) fail('invalid_or_duplicate_record');
    ids.add(record.id);
    if (record.public !== true) fail('public_source_attestation_required');
    if (!(typeof record.state === 'string' || object(record.state) || Array.isArray(record.state)) ||
        !jsonValue(record.state) || (typeof record.state === 'string' && !record.state.trim())) fail('invalid_text_state');
    if (record.expected !== undefined) {
      if (!object(record.expected)) fail('invalid_expected_labels');
      for (const [id, expected] of Object.entries(record.expected)) {
        const question = bank.questions[id];
        if (!Object.hasOwn(bank.questions, id) || question.type !== 'choice' ||
            typeof expected !== 'string' || !Object.hasOwn(question.criteria, expected)) fail('invalid_expected_choice');
        expectedLabels++;
      }
    }
    const serialized = JSON.stringify({ model: bank.model, state: record.state, questions: bank.questions });
    const requestBytes = bytes(serialized);
    if (requestBytes > ASSAY_LIMITS.recordBytes) fail('record_input_byte_limit');
    totalBytes += requestBytes;
    if (totalBytes > ASSAY_LIMITS.totalBytes) fail('total_input_byte_limit');
    return { id: record.id, serialized, request_bytes: requestBytes,
      state_sha256: hash(JSON.stringify(record.state)), request_sha256: hash(serialized), expected: record.expected ?? {} };
  });
  return { bank: structuredClone(bank), requests, stats: { records: requests.length,
    questions: Object.keys(bank.questions).length, total_request_bytes: totalBytes,
    maximum_request_bytes: Math.max(...requests.map(request => request.request_bytes)),
    expected_labels: expectedLabels, limits: ASSAY_LIMITS } };
}

function usageOf(output) {
  const usage = output?.usage;
  return object(usage) && Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0 &&
    Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0
    ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } : null;
}
function distribution(actual, expectedKeys) {
  if (!object(actual) || Object.keys(actual).length !== expectedKeys.length ||
      expectedKeys.some(key => !Object.hasOwn(actual, key)) || !Object.values(actual).every(probability)) return false;
  return Math.abs(Object.values(actual).reduce((sum, p) => sum + p, 0) - 1) <= 0.001;
}
export function validateAssayResponse(output, bank) {
  if (!object(output) || output.model !== bank.model) fail('returned_model_mismatch');
  if (!usageOf(output)) fail('invalid_usage');
  const questionIds = Object.keys(bank.questions);
  if (!object(output.answers) || Object.keys(output.answers).length !== questionIds.length ||
      questionIds.some(id => !Object.hasOwn(output.answers, id))) fail('answer_coverage_mismatch');
  for (const [id, question] of Object.entries(bank.questions)) {
    const answer = output.answers[id];
    if (!object(answer) || answer.type !== question.type) fail('answer_type_mismatch');
    if (question.type === 'noul') {
      if (!probability(answer.noul)) fail('invalid_noul_probability');
    } else if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice) ||
          !probability(answer.confidence) || !distribution(answer.probabilities, Object.keys(question.criteria))) fail('invalid_choice_answer');
      if (answer.probabilities[answer.choice] < Math.max(...Object.values(answer.probabilities)) - 1e-9) fail('choice_not_probability_maximum');
    } else {
      const keys = question.criteria.map((_, index) => String(index));
      if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 ||
          answer.score > question.criteria.length - 1 || !probability(answer.confidence) ||
          !distribution(answer.probabilities, keys) || !object(answer.legend) ||
          Object.keys(answer.legend).length !== keys.length ||
          keys.some(key => JSON.stringify(answer.legend[key]) !== JSON.stringify(question.criteria[Number(key)]))) fail('invalid_score_answer');
      const expected = keys.reduce((sum, key) => sum + Number(key) * answer.probabilities[key], 0);
      if (Math.abs(expected - answer.score) > 0.001) fail('score_probability_mismatch');
    }
  }
  return output.answers;
}
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;
const redact = (value, key) => key ? value.split(key).join('[REDACTED_API_KEY]') : value;

async function readBody(response, signal) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) fail('request_timeout');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ASSAY_LIMITS.responseBytes) { await reader.cancel(); fail('response_byte_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** No run flag means no key lookup, no fetch, no implicit paid execution. */
export async function runQuestionnaireAssay({ bank, records, run = false, apiKey = '', fetchImpl = globalThis.fetch,
  requestTimeoutMs = ASSAY_LIMITS.requestTimeoutMs } = {}) {
  const prepared = prepareAssay(bank, records);
  if (typeof run !== 'boolean') fail('run_flag_must_be_boolean');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > ASSAY_LIMITS.requestTimeoutMs) fail('invalid_timeout_budget');
  const base = { assay_version: 'jev-questionnaire-assay-v1', mode: run ? 'run' : 'dry_run',
    model: bank.model, bank_version: bank.version, ...prepared.stats };
  if (!run) return { summary: { ...base, requests_attempted: 0, input_tokens_reported: 0,
    calculated_usd_reported: 0 }, results: [] };
  if (typeof apiKey !== 'string' || !apiKey.trim()) fail('typesafe_api_key_required');
  if (JSON.stringify(records).includes(apiKey) || JSON.stringify(bank).includes(apiKey)) fail('credential_in_input');
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + ASSAY_LIMITS.runTimeoutMs;
  const results = new Array(prepared.requests.length);
  let cursor = 0;
  async function worker() {
    while (cursor < prepared.requests.length) {
      const index = cursor++;
      const request = prepared.requests[index];
      const result = { id: request.id, state_sha256: request.state_sha256, request_sha256: request.request_sha256,
        request_bytes: request.request_bytes, expected: request.expected, attempted: false, success: false,
        error: null, http_status: null, elapsed_ms: null, returned_model: null, usage: null, response: null, raw_response: null };
      results[index] = result;
      if (Date.now() >= deadline) { result.error = 'assay_time_budget_exceeded'; continue; }
      const controller = new AbortController();
      let timer;
      const started = performance.now();
      try {
        result.attempted = true;
        await Promise.race([
          (async () => {
            const response = await fetchImpl(JEV_ENDPOINT, { method: 'POST', redirect: 'error', signal: controller.signal,
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: request.serialized });
            const raw = await readBody(response, controller.signal);
            if (controller.signal.aborted) return;
            result.http_status = response.status;
            result.raw_response = redact(raw, apiKey);
            let output;
            try { output = JSON.parse(result.raw_response); } catch { fail(response.ok ? 'invalid_response_json' : `http_${response.status}`); }
            result.response = output;
            result.returned_model = typeof output?.model === 'string' ? output.model : null;
            result.usage = usageOf(output);
            if (!response.ok) fail(`http_${response.status}`);
            validateAssayResponse(output, prepared.bank);
            result.success = true;
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new AssayError('request_timeout')); },
              Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now())));
          }),
        ]);
      } catch (error) { result.error = error instanceof AssayError ? error.code : 'transport_failed'; }
      finally { clearTimeout(timer); result.elapsed_ms = Math.round((performance.now() - started) * 1000) / 1000; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ASSAY_LIMITS.concurrency, prepared.requests.length) }, worker));
  const attempted = results.filter(result => result.attempted);
  const inputTokens = attempted.reduce((sum, result) => sum + (result.usage?.input_tokens ?? 0), 0);
  const outputTokens = attempted.reduce((sum, result) => sum + (result.usage?.output_tokens ?? 0), 0);
  let compared = 0, matched = 0;
  for (const result of results.filter(result => result.success)) {
    for (const [id, expected] of Object.entries(result.expected)) {
      compared++; if (result.response.answers[id].choice === expected) matched++;
    }
  }
  const failures = {};
  for (const result of results.filter(result => !result.success)) failures[result.error] = (failures[result.error] ?? 0) + 1;
  const summary = { ...base, requests_attempted: attempted.length, successful_records: results.filter(result => result.success).length,
    failed_records: results.filter(result => !result.success).length, failures, input_tokens_reported: inputTokens,
    output_tokens_reported: outputTokens, calculated_usd_reported: inputTokens * INPUT_USD_PER_MILLION / 1e6,
    usage_unreported_requests: attempted.filter(result => !result.usage).length,
    p50_ms: percentile(attempted.map(result => result.elapsed_ms), 0.5),
    p95_ms: percentile(attempted.map(result => result.elapsed_ms), 0.95),
    expected_label_agreement: { interpretation: 'supplied_choice_label_agreement_not_calibration',
      expected: prepared.stats.expected_labels, compared, matched, fraction: compared ? matched / compared : null } };
  return { started_at: startedAt, completed_at: new Date().toISOString(), endpoint: JEV_ENDPOINT,
    question_bank: prepared.bank, summary, results };
}
