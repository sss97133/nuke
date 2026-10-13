// Execute the real feed handler and installed SDK against an HTTP fixture.
// No source acquisition, inference, live database writes or provider calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';
import * as ledger from '../supabase/functions/poll-listing-feeds/ledger.ts';
import { captureLedgerFields } from '../supabase/functions/poll-listing-feeds/captureLedger.ts';
import { fetchCraigslistFeed } from '../supabase/functions/poll-listing-feeds/feedFetch.ts';
const require = createRequire(new URL('../nuke_frontend/package.json', import.meta.url));
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const metrics = { exports: {} };
vm.runInNewContext(compile(readFileSync(new URL('../supabase/functions/_shared/extractionMetrics.ts', import.meta.url), 'utf8')),
  { exports: metrics.exports, module: metrics, crypto: webcrypto, Date, console });

export function fixture(options = {}) {
  const feed = { id: '00000000-0000-4000-8000-000000000001', source_slug: 'bat', display_name: 'Synthetic feed',
    feed_url: 'https://source.invalid/feed', enabled: true, poll_interval_minutes: 60,
    search_criteria: { fetch_strategy: 'rss_direct_ingest' }, ...options.feed };
  const vehicleId = '00000000-0000-4000-8000-000000000002';
  const ledgerId = '00000000-0000-4000-8000-000000000003';
  const calls = [], stored = new Map(); let serve, patchCount = 0;
  const transport = async (input, init = {}) => {
    const url = new URL(input), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    if (url.hostname === 'source.invalid') return new Response(
      '<rss><channel><item><title>1980 Ford fixture</title><link>https://bringatrailer.com/listing/fixture/</link></item></channel></rss>');
    if (url.pathname === '/functions/v1/ingest') return Response.json({ status: 'created', vehicle_id: vehicleId });
    if (url.pathname === '/rest/v1/platform_config') return Response.json(options.controls ? { config_value: options.controls } : null);
    if (url.pathname === '/rest/v1/listing_feeds') return method === 'GET' ? Response.json([feed]) : new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/vehicles') return Response.json(url.searchParams.has('id')
      ? [{ id: vehicleId, description: 'Retained fixture description' }] : []);
    if (url.pathname === '/rest/v1/import_queue') {
      if (method === 'GET') return Response.json([]);
      if (options.ledgerError) return Response.json({ code: 'FIXTURE', message: 'PRIVATE_PROVIDER_ERROR' }, { status: 500 });
      return Response.json(options.missingLedgerReceipt ? [] : [{ id: ledgerId, status: body.status,
        listing_url: options.wrongLedgerTarget ? 'https://bringatrailer.com/listing/unrelated/' : body.listing_url }]);
    }
    if (url.pathname === '/rest/v1/extraction_runs') {
      const id = method === 'POST' ? body.id : url.searchParams.get('id').slice(3);
      if (method === 'PATCH') patchCount++;
      if (options.progressFailure === patchCount && method === 'PATCH') return Response.json(
        { code: 'FIXTURE', message: 'PRIVATE_PROGRESS_FAILURE' }, { status: 500 });
      if (options.runInsertError && method === 'POST') return Response.json({ code: 'FIXTURE', message: 'PRIVATE_INSERT_FAILURE' }, { status: 500 });
      stored.set(id, { ...stored.get(id), ...body });
      return Response.json(options.missingProgressReceipt ? [] : [{ id }]);
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  const db = createClient('https://database.invalid', 'synthetic-service-key', {
    auth: { persistSession: false }, global: { fetch: transport },
  });
  const module = { exports: {} };
  const source = options.source ?? readFileSync(new URL('../supabase/functions/poll-listing-feeds/index.ts', import.meta.url), 'utf8');
  vm.runInNewContext(compile(source + '\nexport { pollFirecrawlHtmlFeed };'), {
    exports: module.exports, module, Request, Response, URL, AbortSignal, AbortController, Date, crypto: webcrypto,
    console: { log() {}, error() {} }, fetch: transport,
    // The fixture preserves ordering while removing courtesy delays.
    setTimeout: callback => { if (callback.toString().includes('abort')) return 0; callback(); return 0; }, clearTimeout() {},
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://database.invalid' : 'synthetic-service-key' }, serve: fn => { serve = fn; } },
    require(name) {
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.endsWith('/ledger.ts')) return ledger;
      if (name.endsWith('/captureLedger.ts')) return { captureLedgerFields };
      if (name.endsWith('/feedFetch.ts')) return { fetchCraigslistFeed };
      if (name.endsWith('/extractionMetrics.ts')) return metrics.exports;
      if (name.endsWith('/writeGuard.ts')) return { requireWriteAuth: async () => null };
      if (name.endsWith('/normalizeVehicle.ts')) return { isGarbageMake: () => false };
      if (name.endsWith('/urlNormalization.ts')) return { extractCraigslistCanonicalUrls: () => [] };
      if (name.endsWith('/archiveFetch.ts')) return { archiveFetch: options.archive ?? (() => { throw new Error('unexpected acquisition'); }) };
      if (name.endsWith('/firecrawl.ts')) return { firecrawlScrape: () => { throw new Error('unexpected paid provider'); } };
      throw new Error(`Unexpected feed import ${name}`);
    },
  });
  return { calls, stored, db, feed,
    async poll() { return module.exports.pollFirecrawlHtmlFeed(db, feed, ledger.createIntakeBudget(ledger.intakeThrottle({}), Date.now())); },
    async request(body = {}) { const response = await serve(new Request('https://fixture.invalid/poll-listing-feeds', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })); return { status: response.status, body: await response.json() }; },
  };
}

test('failed database acknowledgement cannot report complete or landed', async () => {
  for (const options of [{ ledgerError: true }, { missingLedgerReceipt: true }, { wrongLedgerTarget: true }]) {
    const f = fixture(options), result = await f.poll();
    assert.equal(result.ingest_outcomes.length, 1);
    assert.equal(result.ingest_outcomes[0].ingest_attempted, true);
    assert.equal(result.ingest_outcomes[0].ledger_write_status, 'unavailable');
    assert.equal(result.ingest_outcomes[0].ledger, undefined);
  }
});
test('actual readback and matching database receipt establish one ledger completion', async () => {
  const f = fixture(), result = await f.poll();
  assert.equal(result.ingest_outcomes[0].ledger, 'complete');
  assert.equal(result.ingest_outcomes[0].ledger_write_status, 'acknowledged');
  const readback = f.calls.findIndex(c => c.path === '/rest/v1/vehicles' && c.method === 'GET' && c !== f.calls.find(c => c.path === '/rest/v1/vehicles'));
  const write = f.calls.findIndex(c => c.path === '/rest/v1/import_queue' && c.method === 'POST');
  assert(readback >= 0 && readback < write);
});
test('real handler retains source progress, distinct request/write stages and no provider bodies', async () => {
  const f = fixture({ ledgerError: true }), result = await f.request();
  assert.equal(result.status, 200);
  const run = f.stored.get(result.body.receipt_id), source = run.metadata.source_totals[0];
  assert.equal(run.status, 'completed'); assert.equal(source.selected_targets, 1);
  assert.equal(source.attempted_targets, 1); assert.equal(source.counts.ingestion_requests, 1);
  assert.equal(source.counts.landed_ledger_acknowledged, 0); assert.equal(source.counts.ledger_write_failures, 1);
  assert.equal(source.consumer_usable, null); assert.equal(source.source_population, null);
  assert(!JSON.stringify(run).includes('PRIVATE_'));
  assert.deepEqual(Object.keys(run.metadata.targets[0]).sort(),
    ['target_id', 'source', 'state', 'attempted_at', 'completed_at', 'reason', 'counts'].sort());
});
test('a progress-store failure stops source dispatch and preserves only the last acknowledged stage', async () => {
  const f = fixture({ progressFailure: 2 }), result = await f.request();
  assert.equal(result.status, 500);
  assert.equal(f.calls.filter(c => c.path === '/feed' || c.path === '/functions/v1/ingest').length, 0);
  const run = [...f.stored.values()][0];
  assert.equal(run.status, 'running'); assert.equal(run.metadata.targets[0].state, 'selected');
  assert.equal(run.metadata.source_totals[0].attempted_targets, 0);
  assert.equal(run.metadata.source_totals[0].counts.landed_ledger_acknowledged, 0);
});
test('no durable run receipt means no source work', async () => {
  for (const options of [{ runInsertError: true }, { missingProgressReceipt: true }]) {
    const f = fixture(options), result = await f.request(); assert.equal(result.status, 500);
    assert.equal(f.calls.filter(c => c.path === '/feed' || c.path === '/functions/v1/ingest').length, 0);
  }
});
test('zero intake capacity is a persisted deferral, not an attempt or a landing', async () => {
  const f = fixture({ controls: { max_ingests: 0 } }), result = await f.request();
  assert.equal(result.status, 200); assert.equal(result.body.status, 'throttled');
  const run = f.stored.get(result.body.receipt_id);
  assert.equal(run.status, 'throttled'); assert.equal(run.metadata.reason, 'controls_zero');
  assert.equal(run.metadata.targets.length, 0);
  assert.equal(f.calls.filter(c => c.path === '/feed' || c.path === '/functions/v1/ingest').length, 0);
});

test('partial progress keeps completed targets and names unattempted selected targets', async () => {
  const f = fixture(), run = await metrics.exports.createIntakeRunReceipt(f.db, Date.now());
  const second = { id: '00000000-0000-4000-8000-000000000004', source_slug: 'craigslist' };
  await run.select([f.feed, second], false, { max_feeds: 2, max_ingests: 1 });
  await run.begin(f.feed.id);
  await run.record(f.feed.id, { items_found: 1, error: null, ingest_outcomes: [{ ingest_attempted: true, ledger: 'complete', ledger_write_status: 'acknowledged' }] });
  const partial = f.stored.get(run.id);
  assert.equal(partial.status, 'running'); assert.equal(partial.metadata.targets[0].state, 'completed');
  assert.equal(partial.metadata.targets[1].state, 'selected'); assert.equal(partial.metadata.targets[1].attempted_at, null);
  await run.finish('completed', 'worker_deadline');
  const final = f.stored.get(run.id), deferred = final.metadata.source_totals.find(s => s.source === 'craigslist');
  assert.equal(deferred.attempted_targets, 0); assert.equal(deferred.deferred_targets, 1);
  assert.equal(deferred.unattempted_targets, 1); assert.equal(deferred.unfinished_started_targets, 0);
  assert.equal(deferred.reasons[0], 'worker_deadline'); assert.equal(final.metadata.target_scope_complete, false);
});

for (const status of [403, 429]) {
  test(`real CL feed handler retains HTTP ${status} failure, no ingest/capture ACK and existing backoff`, async () => {
    const archived = [];
    const f = fixture({ feed: { source_slug: 'craigslist',
      search_criteria: { fetch_strategy: 'firecrawl_html' } },
      archive: async (url, policy) => { archived.push({ url, policy });
        return { html: null, error: `HTTP ${status}`, statusCode: status }; },
    });
    const result = await f.request();
    assert.equal(result.status, 200); // completed dispatch, failed source target
    assert.equal(archived.length, 1);
    assert.equal(archived[0].policy.useFirecrawl, false);
    assert.deepEqual(archived[0].policy.directFetchOptions, { publicOnly: true });
    assert.equal(result.body.total_items_found, 0);
    assert.equal(f.calls.filter(c => c.path === '/functions/v1/ingest').length, 0);
    assert.equal(f.calls.filter(c => c.path === '/rest/v1/import_queue' && c.method === 'POST').length, 0);
    const failure = f.calls.find(c => c.path === '/rest/v1/listing_feeds' && c.body?.last_error);
    assert.equal(failure.body.last_error, `fetch_failed: direct: HTTP ${status}`);
    assert.equal(failure.body.error_count, 1);
    const target = f.stored.get(result.body.receipt_id).metadata.targets[0];
    assert.equal(target.state, 'failed');
    assert.equal(target.counts.discovered_items, 0);
    assert.equal(target.counts.landed_ledger_acknowledged, 0);
    assert.deepEqual(ledger.selectIntakeFeeds([{ ...f.feed, ...failure.body }], 1,
      ledger.intakeThrottle(), Date.parse(failure.body.last_polled_at) + 15 * 60_000), []);
  });
}
