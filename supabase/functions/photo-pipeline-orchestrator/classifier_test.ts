import { classifyImage, CLASSIFIER_MODEL, CANDIDATE_CLASSIFIER_MODEL, CLASSIFIER_BUDGET } from './classifier.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
const usage = { promptTokenCount: 1024, candidatesTokenCount: 100, totalTokenCount: 1124 };
const valid = { image_type: 'engine_bay', image_medium: 'photograph', confidence: 0, is_automotive: true, description: 'A visible component' };
const response = (text: string, extra = {}) => Response.json({ usageMetadata: usage, candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], ...extra });
function fixture(modelResponse: () => Response = () => response(JSON.stringify(valid)), tokenCount = 1024) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url, init) => {
    calls.push({ url: String(url), init });
    assert((init as RequestInit | undefined)?.signal instanceof AbortSignal);
    if (calls.length === 1) return image();
    if (String(url).endsWith(':countTokens')) return Response.json({ totalTokens: tokenCount });
    return modelResponse();
  }) as typeof fetch;
  return { calls, fetcher };
}
Deno.test('missing key performs no image or provider call', async () => {
  let calls = 0;
  const result = await classifyImage('https://example.invalid/private.jpg?token=secret', undefined,
    (() => { calls++; throw new Error('must not fetch'); }) as typeof fetch);
  assert(calls === 0 && result.classifier_ok === false && result.classifier_receipt?.model === null);
});
for (const kind of ['http', 'timeout', 'transport'] as const) Deno.test(`download ${kind} fails without leaking source or credential`, async () => {
  let calls = 0;
  const result = await classifyImage('https://example.invalid/private.jpg?token=secret', 'synthetic-key', (async () => {
    calls++;
    if (kind === 'http') return new Response('private body', { status: 503 });
    if (kind === 'timeout') throw new DOMException('private URL', 'TimeoutError');
    throw new Error('private credential detail');
  }) as typeof fetch);
  assert(calls === 1 && result.classifier_ok === false && result.classifier_receipt?.attempts === 0);
  assert(!JSON.stringify(result).includes('private') && !JSON.stringify(result).includes('secret'));
});
for (const [name, make, expected] of [
  ['HTTP rejection', () => new Response('private body', { status: 401 }), 'classifier_http_error'],
  ['429 quota failure', () => new Response(null, { status: 429 }), 'classifier_rate_limited'],
  ['empty response', () => response(''), 'classifier_response_empty'],
  ['malformed JSON', () => response('not json'), 'classifier_response_invalid'],
  ['array response', () => response('[]'), 'classifier_response_invalid'],
  ['missing fields', () => response('{}'), 'classifier_response_invalid'],
  ['confidence outside range', () => response(JSON.stringify({ ...valid, confidence: 2 })), 'classifier_response_invalid'],
  ['invalid medium', () => response(JSON.stringify({ ...valid, image_medium: 'unknown' })), 'classifier_response_invalid'],
  ['invalid optional OCR', () => response(JSON.stringify({ ...valid, detected_text: { command: 'x' } })), 'classifier_response_invalid'],
  ['invalid VIN', () => response(JSON.stringify({ ...valid, vin_detected: 'UNKNOWN' })), 'classifier_response_invalid'],
  ['missing usage', () => response(JSON.stringify(valid), { usageMetadata: null }), 'classifier_usage_missing'],
  ['output beyond cap', () => response(JSON.stringify(valid), { usageMetadata: { ...usage, candidatesTokenCount: 769 } }), 'classifier_usage_budget_exceeded'],
  ['truncated response', () => response(JSON.stringify(valid), { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(valid) }] } }] }), 'classifier_response_incomplete'],
] as const) Deno.test(`${name} has one attempt, no retries and no false success`, async () => {
  const { calls, fetcher } = fixture(make);
  const result = await classifyImage('https://example.invalid/photo.jpg', 'synthetic-key', fetcher);
  assert(calls.length === 3 && result.classifier_ok === false);
  assert(result.classifier_receipt?.attempts === 1 && result.classifier_receipt.error_class === expected);
  assert(!JSON.stringify(result).includes('private body'));
});
Deno.test('token count over budget prevents generation', async () => {
  const { calls, fetcher } = fixture(undefined, CLASSIFIER_BUDGET.input_tokens + 1);
  const result = await classifyImage('https://example.invalid/photo.jpg', 'key', fetcher);
  assert(calls.length === 2 && result.classifier_ok === false && result.classifier_receipt?.attempts === 0);
});
for (const header of [true, false]) Deno.test(`oversized image ${header ? 'header' : 'stream'} stops before model calls`, async () => {
  let calls = 0;
  const result = await classifyImage('https://example.invalid/photo.jpg', 'key', (async () => {
    calls++;
    return new Response(new Uint8Array(CLASSIFIER_BUDGET.image_bytes + 1), {
      headers: { 'content-type': 'image/jpeg', ...(header ? { 'content-length': String(CLASSIFIER_BUDGET.image_bytes + 1) } : {}) },
    });
  }) as typeof fetch);
  assert(calls === 1 && !result.classifier_ok && result.classifier_receipt?.error_class === 'payload_too_large');
});
Deno.test('non-image content cannot be sent to provider', async () => {
  let calls = 0;
  const result = await classifyImage('https://example.invalid/photo.jpg', 'key', (async () => { calls++; return new Response('html'); }) as typeof fetch);
  assert(calls === 1 && result.classifier_receipt?.error_class === 'image_mime_invalid');
});
Deno.test('production remains Flash, candidate is explicit; actual usage and hashes survive', async () => {
  for (const candidate of [false, true]) {
    const { calls, fetcher } = fixture();
    const result = await classifyImage('https://example.invalid/photo.jpg', 'secret-key', fetcher,
      candidate ? { model: CANDIDATE_CLASSIFIER_MODEL } : {});
    const r = result.classifier_receipt!;
    assert(result.classifier_ok && result.confidence === 0);
    assert(r.model === (candidate ? CANDIDATE_CLASSIFIER_MODEL : CLASSIFIER_MODEL));
    assert(r.usage?.prompt_tokens === 1024 && r.usage.output_tokens === 100 && r.attempts === 1);
    assert(r.image_bytes === 3 && r.image_sha256?.length === 64 && r.input_sha256?.length === 64);
    assert(r.estimated_cost_usd! > 0 && r.estimated_cost_usd! <= r.reserved_cost_usd!);
    const call = calls[2];
    assert(!call.url.includes('secret-key') && new Headers(call.init?.headers).get('x-goog-api-key') === 'secret-key');
    const body = JSON.parse(String(call.init?.body));
    assert(body.generationConfig.maxOutputTokens === 768 && body.generationConfig.thinkingConfig.thinkingBudget === 0);
  }
});
Deno.test('ambiguous generation timeout retains reservation and unknown actual usage', async () => {
  const { fetcher, calls } = fixture(() => { throw new DOMException('secret URL', 'TimeoutError'); });
  const result = await classifyImage('https://example.invalid/photo.jpg', 'key', fetcher);
  assert(calls.length === 3 && !result.classifier_ok && result.classifier_receipt?.error_class === 'classifier_timeout');
  assert(result.classifier_receipt.reserved_cost_usd! > 0 && result.classifier_receipt.estimated_cost_usd === undefined);
});

Deno.test('quota diagnostics retain only bounded quota metadata, never provider prose or project dimensions', async () => {
  const { fetcher } = fixture(() => Response.json({ error: { message:'secret raw error', details:[
    { '@type':'type.googleapis.com/google.rpc.QuotaFailure', violations:[{quotaMetric:'generativelanguage.googleapis.com/generate_content_free_tier_requests',quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier',quotaValue:'0',quotaDimensions:{model:'gemini-2.5-flash-lite',location:'global',project:'private-project'}}]},
    { '@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'12.5s'},
    { '@type':'type.googleapis.com/google.rpc.ErrorInfo',metadata:{project:'private-project',key:'secret-key'}},
  ] } },{status:429}));
  const result = await classifyImage('https://example.invalid/image.jpg','secret-key',fetcher);
  assert(result.classifier_receipt?.quota?.violations[0].quota_value === 0);
  assert(result.classifier_receipt.quota.retry_delay_seconds === 12.5);
  assert(!JSON.stringify(result).includes('private-project') && !JSON.stringify(result).includes('secret'));
});
