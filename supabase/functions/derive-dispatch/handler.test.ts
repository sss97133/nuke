// Real dispatcher and Supabase HTTP client; no real server, database, or provider.
// deno test --allow-env supabase/functions/derive-dispatch/handler.test.ts
function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const SERVICE_KEY = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role' })}.offline`;
const OWNER_ID = '90000000-0000-4000-8000-000000000001';
const SOURCE_ID = '20000000-0000-4000-8000-000000000001';
const OBSERVATION_ID = '30000000-0000-4000-8000-000000000001';
const EXTRACTOR = 'comment-refinery-atoms-v1';
const envNames = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const saved = envNames.map(name => Deno.env.get(name));
Deno.env.set(envNames[0], 'https://db.test');
Deno.env.set(envNames[1], SERVICE_KEY);
let handler: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
try { await import('./index.ts'); } finally { Deno.serve = originalServe; }

function item(number = 1, patch: Record<string, unknown> = {}) {
  return { id: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    evidence_type: 'auction_comment', evidence_id: SOURCE_ID, extractor_slug: EXTRACTOR,
    user_id: null, attempts: 1, max_attempts: 3, ...patch };
}
function receipt(patch: Record<string, unknown> = {}) {
  return { success: true, derivation_complete: true, source_comment_id: SOURCE_ID,
    source_hash: 'a'.repeat(64), empty_source_result: false,
    derived: [{ observation_id: OBSERVATION_ID, comment_id: SOURCE_ID, credential: 'system_api_key' }], ...patch };
}
type Call = { path: string; method: string; body: any; headers: Headers; signal?: AbortSignal | null; url: URL };
type Scenario = {
  items?: ReturnType<typeof item>[];
  output?: unknown;
  readerStatus?: number;
  readerThrows?: boolean;
  doneWrite?: 'error' | 'missing' | 'wrong_id' | 'wrong_status';
  requeueError?: boolean;
  inactive?: boolean;
  body?: Record<string, unknown>;
  token?: string;
};
async function run(scenario: Scenario = {}) {
  const calls: Call[] = [];
  const originalFetch = globalThis.fetch;
  const items = scenario.items ?? [item()];
  globalThis.fetch = async (request, options) => {
    const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url);
    const method = options?.method ?? (request instanceof Request ? request.method : 'GET');
    const payload = typeof options?.body === 'string' ? JSON.parse(options.body) : undefined;
    calls.push({ path: url.pathname, method, body: payload,
      headers: new Headers(options?.headers), signal: options?.signal, url });
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { 'content-type': 'application/json' },
    });
    if (url.pathname === '/rest/v1/rpc/claim_derivation_work') return respond(items);
    if (url.pathname === '/rest/v1/observation_extractors') {
      if (method === 'PATCH') return respond([]);
      const slug = url.searchParams.get('slug')?.replace(/^eq\./, '') ?? EXTRACTOR;
      return respond([{ slug, edge_function_name: slug === EXTRACTOR ? 'batch-comment-discovery' : 'owner-reader',
        extractor_type: 'llm', is_active: !scenario.inactive }]);
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      if (scenario.readerThrows) throw new Error('synthetic reader interruption');
      return respond(scenario.output === undefined ? receipt() : scenario.output, scenario.readerStatus ?? 200);
    }
    if (url.pathname === '/rest/v1/derivation_queue' && method === 'PATCH') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      if (payload.status === 'done') {
        if (scenario.doneWrite === 'error') return respond({ message: 'synthetic completion rejected' }, 400);
        if (scenario.doneWrite === 'missing') return respond(null);
        if (scenario.doneWrite === 'wrong_id') return respond({ id: OWNER_ID, status: 'done' });
        if (scenario.doneWrite === 'wrong_status') return respond({ id, status: 'claimed' });
      }
      if (payload.status === 'pending' && scenario.requeueError) return respond({ message: 'synthetic retry rejected' }, 400);
      return respond({ id, status: payload.status });
    }
    throw new Error(`Unexpected offline request: ${method} ${url.pathname}`);
  };
  try {
    const response = await handler!(new Request('https://handler.test', {
      method: 'POST', headers: { Authorization: `Bearer ${scenario.token ?? SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(scenario.body ?? {}),
    }));
    return { status: response.status, data: await response.json(), calls };
  } finally { globalThis.fetch = originalFetch; }
}
const readerCalls = (r: Awaited<ReturnType<typeof run>>) => r.calls.filter(c => c.path.startsWith('/functions/v1/'));
const queueWrites = (r: Awaited<ReturnType<typeof run>>, status?: string) => r.calls.filter(c =>
  c.path === '/rest/v1/derivation_queue' && (!status || c.body.status === status));

Deno.test('public comment routes its source and queue IDs with system identity', async () => {
  const r = await run();
  equal(r.status, 200); equal(r.data.done, 1); equal(r.data.failed, 0);
  const invokes = readerCalls(r); equal(invokes.length, 1);
  equal(invokes[0].path, '/functions/v1/batch-comment-discovery');
  equal(invokes[0].body, { user_id: null, comment_id: SOURCE_ID, limit: 1, dry_run: false,
    platform_credential: true, mode: 'derive_comment', derivation_queue_id: item().id });
  equal(invokes[0].headers.get('authorization'), `Bearer ${SERVICE_KEY}`);
  equal(invokes[0].headers.get('x-nuke-internal'), SERVICE_KEY);
  assert(invokes[0].signal instanceof AbortSignal);
  equal(queueWrites(r, 'done')[0].body.observation_ids, [OBSERVATION_ID]);
  equal(queueWrites(r, 'done')[0].body.credential_source, 'system_api_key');
});

Deno.test('two public invocations cap each tick and unstarted work restores attempts', async () => {
  const r = await run({ items: [item(1), item(2), item(3, { attempts: 2 }), item(4)] });
  equal(readerCalls(r).length, 2); equal(r.data.done, 2); equal(r.data.failed, 0);
  const pending = queueWrites(r, 'pending'); equal(pending.length, 2);
  equal(pending.map(c => c.body.attempts), [1, 0]);
  assert(pending.every(c => c.body.locked_at === null && c.body.locked_by === null));
  equal(r.data.results.filter((x: any) => x.status === 'requeued').length, 2);
  assert(pending.every(c => Date.parse(c.body.next_attempt_at) > Date.now()));
});

Deno.test('public cap never changes owner route payload or consumes its compute identity', async () => {
  const owner = item(4, { evidence_type: 'secure_document', evidence_id: SOURCE_ID,
    extractor_slug: 'owner-document-reader', user_id: OWNER_ID });
  const r = await run({ items: [item(1), item(2), item(3), owner] });
  equal(readerCalls(r).length, 3); equal(r.data.done, 3);
  const invocation = readerCalls(r).find(c => c.path.endsWith('owner-reader'))!;
  equal(invocation.body, { user_id: OWNER_ID, document_id: SOURCE_ID, limit: 1, dry_run: false,
    platform_credential: false });
  equal(invocation.signal, undefined);
  const platform = await run({ items: [owner], body: { platform_credential: true }, output: { derived: [] } });
  equal(readerCalls(platform)[0].body.platform_credential, true);
  equal(platform.data.done, 1);
});

Deno.test('false or incomplete 2xx public receipts cannot mark work done', async () => {
  for (const output of [null, {}, { derived: [] }, receipt({ success: false }),
    receipt({ derivation_complete: false }), receipt({ derived: [] }), receipt({ derived: {} }),
    receipt({ derived: 'not an array' }), receipt({ derived: undefined, empty_source_result: true }),
    receipt({ derived: null, empty_source_result: true })]) {
    const r = await run({ output });
    equal(r.data.done, 0); equal(queueWrites(r, 'done').length, 0);
    equal(queueWrites(r, 'failed').length, 1);
  }
});

Deno.test('only explicitly examined empty source results may complete with zero observations', async () => {
  const r = await run({ output: receipt({ derived: [], empty_source_result: true }) });
  equal(r.data.done, 1); equal(queueWrites(r, 'done')[0].body.observation_ids, []);
  for (const patch of [{ success: false }, { derivation_complete: false }, { source_comment_id: OWNER_ID }]) {
    const failed = await run({ output: receipt({ derived: [], empty_source_result: true, ...patch }) });
    equal(failed.data.done, 0); equal(queueWrites(failed, 'done').length, 0);
  }
});

Deno.test('receipt must identify the requested source and every derived observation', async () => {
  for (const patch of [
    { source_comment_id: null }, { source_comment_id: OWNER_ID },
    { derived: [{ observation_id: OBSERVATION_ID }] },
    { derived: [{ observation_id: OBSERVATION_ID, comment_id: OWNER_ID }] },
    { derived: [{ observation_id: 'not-a-uuid', comment_id: SOURCE_ID }] },
    { derived: [null] },
  ]) {
    const r = await run({ output: receipt(patch) });
    equal(r.data.done, 0); equal(queueWrites(r, 'done').length, 0);
    equal(queueWrites(r, 'failed').length, 1);
  }
});

Deno.test('public budget denial requeues without consuming an attempt', async () => {
  const r = await run({ items: [item(1, { attempts: 2 })], readerStatus: 429,
    output: { success: false, derivation_complete: false, budget_not_admitted: true, retry_after_seconds: 3600 } });
  equal(r.data.done, 0); equal(r.data.failed, 0);
  const pending = queueWrites(r, 'pending'); equal(pending.length, 1);
  equal(pending[0].body.attempts, 1);
  equal(r.data.results[0].retry_after_seconds, 3600);
  equal(queueWrites(r, 'failed').length, 0);
});

Deno.test('owner rate limits retain the existing attempt and payload behavior', async () => {
  const owner = item(1, { evidence_type: 'secure_document', extractor_slug: 'owner-reader', user_id: OWNER_ID, attempts: 2 });
  const r = await run({ items: [owner], readerStatus: 429, output: { retry_after_seconds: 120 } });
  equal(r.data.done, 0); equal(queueWrites(r, 'pending').length, 1);
  assert(!Object.hasOwn(queueWrites(r, 'pending')[0].body, 'attempts'));
  equal(r.data.results[0].retry_after_seconds, 120);
});

Deno.test('a reported terminal provider failure finishes failed with no automatic retry', async () => {
  for (const readerStatus of [400, 500, 503]) {
    const r = await run({ readerStatus, output: { success: false, derivation_complete: false,
      retryable: false, error: 'comment_model_transport_failed', derived: [] } });
    equal(r.data.done, 0); equal(queueWrites(r, 'failed').length, 1);
    equal(queueWrites(r, 'pending').length, 0); equal(readerCalls(r).length, 1);
  }
});

Deno.test('cached persistence failures retry within three attempts then stop', async () => {
  for (const attempts of [1, 2, 3]) {
    const r = await run({ items: [item(1, { attempts, max_attempts: 3 })], readerStatus: 503,
      output: { success: false, derivation_complete: false, retryable: true,
        error: 'comment_claim_persistence_incomplete', derived: [] } });
    equal(r.data.done, 0); equal(readerCalls(r).length, 1);
    equal(queueWrites(r, 'pending').length, attempts < 3 ? 1 : 0);
    equal(queueWrites(r, 'failed').length, attempts === 3 ? 1 : 0);
    for (const pending of queueWrites(r, 'pending')) assert(!Object.hasOwn(pending.body, 'attempts'));
  }
});

Deno.test('unknown reader interruption has bounded retry instead of false completion', async () => {
  for (const attempts of [1, 3]) {
    const r = await run({ items: [item(1, { attempts })], readerThrows: true });
    equal(r.data.done, 0); equal(queueWrites(r, 'done').length, 0);
    equal(queueWrites(r, 'pending').length, attempts === 1 ? 1 : 0);
    equal(queueWrites(r, 'failed').length, attempts === 3 ? 1 : 0);
  }
});

Deno.test('finish errors and mismatched completion readbacks cannot report done', async () => {
  for (const doneWrite of ['error', 'missing', 'wrong_id', 'wrong_status'] as const) {
    const r = await run({ doneWrite });
    equal(r.data.done, 0);
    assert(!r.data.results.some((x: any) => x.status === 'done'));
    equal(queueWrites(r, 'pending').length, 1);
  }
  const owner = item(1, { evidence_type: 'secure_document', extractor_slug: 'owner-reader', user_id: OWNER_ID });
  const r = await run({ items: [owner], doneWrite: 'error' });
  equal(r.data.done, 0); equal(queueWrites(r, 'failed').length, 1);
});

Deno.test('invalid public ownership and extractor routes never invoke a reader', async () => {
  for (const patch of [{ user_id: OWNER_ID }, { extractor_slug: 'other-reader' }]) {
    const r = await run({ items: [item(1, patch)] });
    equal(readerCalls(r).length, 0); equal(r.data.done, 0);
    equal(queueWrites(r, 'failed').length, 1);
  }
});

Deno.test('failed retry persistence returns an error without claiming completion or requeue success', async () => {
  const r = await run({ requeueError: true, readerStatus: 429,
    output: { budget_not_admitted: true, retry_after_seconds: 3600 } });
  equal(r.status, 500);
  assert(r.data.done === undefined || r.data.done === 0);
  equal(queueWrites(r, 'done').length, 0);
  assert(typeof r.data.error === 'string');
});

Deno.test('missing credentials are refused before database or reader access', async () => {
  const r = await run({ token: 'bad-token' });
  equal(r.status, 401); equal(r.calls.length, 0);
});

Deno.test('an empty claimed batch makes no reader calls and no completion writes', async () => {
  const r = await run({ items: [] });
  equal(r.data, { claimed: 0, done: 0, failed: 0, results: [] });
  equal(readerCalls(r).length, 0); equal(queueWrites(r).length, 0);
});

addEventListener('unload', () => envNames.forEach((name, index) => {
  if (saved[index] === undefined) Deno.env.delete(name); else Deno.env.set(name, saved[index]!);
}));
