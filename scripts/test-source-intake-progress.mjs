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
import { emptySearchHtml } from '../supabase/functions/poll-listing-feeds/fixtures/empty-search.ts';
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
  const feeds = options.feeds?.map(row => ({ ...feed, ...row })) ?? [feed];
  let nowMs = Date.parse('2026-10-15T00:00:00Z');
  const runtimeDate = options.timing ? class extends Date {
    constructor(value = nowMs) { super(value); }
    static now() { return nowMs; }
  } : Date;
  const advance = ms => { if (options.timing) nowMs += ms; };
  const calls = [], stored = new Map(), queued = new Map(); let serve, patchCount = 0, feedReadCount = 0;
  const transport = async (input, init = {}) => {
    const url = new URL(input), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, query: url.search, method, body, at: runtimeDate.now() });
    if (url.hostname === 'source.invalid') {
      advance(options.timing?.sourceMs ?? 0);
      if (options.sourceFailures?.[url.pathname]) return new Response('', { status: options.sourceFailures[url.pathname] });
      const count = options.itemsByPath?.[url.pathname] ?? options.itemsPerFeed ?? 1;
      return new Response('<rss><channel>' + Array.from({ length: count }, (_, i) =>
        `<item><title>1980 Ford fixture</title><link>https://bringatrailer.com/listing/${url.pathname.slice(1)}-${i}/</link></item>`).join('') + '</channel></rss>');
    }
    if (url.pathname === '/functions/v1/ingest') {
      advance(options.timing?.ingestMs ?? 0);
      const outcome = options.ingestResult?.(body.url) ?? { status: 'created', vehicle_id: vehicleId };
      return outcome instanceof Response ? outcome : Response.json(outcome);
    }
    if (url.pathname === '/rest/v1/platform_config') return Response.json(options.controls ? { config_value: options.controls } : null);
    if (url.pathname === '/rest/v1/listing_feeds') {
      if (method === 'GET') {
        feedReadCount++;
        if (options.feedReadFailureAt === feedReadCount) return Response.json({ code: 'FIXTURE', message: 'metadata unavailable' }, { status: 500 });
        let selected = feeds.filter(row => row.enabled);
        const source = url.searchParams.get('source_slug'), id = url.searchParams.get('id');
        if (source?.startsWith('eq.')) selected = selected.filter(row => row.source_slug === source.slice(3));
        if (source?.startsWith('neq.')) selected = selected.filter(row => row.source_slug !== source.slice(4));
        if (id?.startsWith('eq.')) selected = selected.filter(row => row.id === id.slice(3));
        selected.sort((a, b) => {
          const time = (a.last_polled_at ? Date.parse(a.last_polled_at) : -Infinity)
            - (b.last_polled_at ? Date.parse(b.last_polled_at) : -Infinity);
          return time || (url.searchParams.get('order')?.includes('id.asc') ? a.id.localeCompare(b.id) : 0);
        });
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Math.min(Number(url.searchParams.get('limit') || 1000), options.feedApiCap ?? 1000);
        return Response.json(selected.slice(offset, offset + limit));
      }
      if (options.retainLedger) Object.assign(feeds.find(row => row.id === url.searchParams.get('id')?.slice(3)) ?? {}, body);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/vehicles') return Response.json(url.searchParams.has('id')
      ? [{ id: vehicleId, description: 'Retained fixture description' }] : []);
    if (url.pathname === '/rest/v1/import_queue') {
      if (method === 'GET') return Response.json(options.retainLedger ? [...queued.values()] : []);
      if (options.ledgerError) return Response.json({ code: 'FIXTURE', message: 'PRIVATE_PROVIDER_ERROR' }, { status: 500 });
      if (options.retainLedger) queued.set(body.listing_url, { ...body, id: ledgerId });
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
    exports: module.exports, module, Request, Response, URL, AbortSignal, AbortController, Date: runtimeDate, crypto: webcrypto,
    console: { log() {}, error() {} }, fetch: transport,
    // The fixture preserves ordering while removing courtesy delays.
    setTimeout: (callback, ms) => { if (callback.toString().includes('abort')) return 0; advance(ms); callback(); return 0; }, clearTimeout() {},
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://database.invalid' : 'synthetic-service-key' }, serve: fn => { serve = fn; } },
    require(name) {
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.endsWith('/ledger.ts')) return { ...ledger,
        createIntakeBudget: (throttle, start) => ledger.createIntakeBudget(throttle, start, runtimeDate.now) };
      if (name.endsWith('/captureLedger.ts')) return { captureLedgerFields };
      if (name.endsWith('/feedFetch.ts')) return { fetchCraigslistFeed };
      if (name.endsWith('/schedule.ts')) return { nextYield: () => ({ rate: 0, interval_minutes: 60 }) };
      if (name.endsWith('/removal.ts')) return { sweepCraigslistRemovals: async () => null, noticeFrom: () => null };
      if (name.endsWith('/kslCards.ts')) return { parseKslSearchCards: () => [] };
      if (name.endsWith('/yearFilter.ts')) return { splitByYear: (u) => ({ keep: u, rest: [] }) };
      if (name.endsWith('/firecrawlGate.ts')) return { firecrawlGate: () => ({ allow: async () => true, record: async () => {} }), ALLOWANCE_EXHAUSTED: 'allowance_deferred: test' };
      if (name.endsWith('/extractionMetrics.ts')) return metrics.exports;
      if (name.endsWith('/writeGuard.ts')) return { requireWriteAuth: async () => null };
      if (name.endsWith('/supabaseKeys.ts')) return { projectSecretKey: () => 'synthetic-service-key' };
      if (name.endsWith('/normalizeVehicle.ts')) return { isGarbageMake: () => false };
      if (name.endsWith('/urlNormalization.ts')) return { extractCraigslistCanonicalUrls: () => [] };
      if (name.endsWith('/archiveFetch.ts')) return { archiveFetch: options.archive ?? (() => { throw new Error('unexpected acquisition'); }) };
      if (name.endsWith('/firecrawl.ts')) return { firecrawlScrape: () => { throw new Error('unexpected paid provider'); } };
      throw new Error(`Unexpected feed import ${name}`);
    },
  });
  return { calls, stored, queued, db, feed, advance,
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

const emptySearchFeed = { source_slug: 'craigslist', feed_url: 'https://example.craigslist.org/search/cta',
  search_criteria: { fetch_strategy: 'firecrawl_html' }, error_count: 59, last_error: 'parsed_zero' };

test('explicit empty Craigslist search completes zero and resets errors without spending admission slots', async () => {
  const f = fixture({ feed: emptySearchFeed, archive: async () => ({ html: emptySearchHtml, statusCode: 200, error: null }) });
  const result = await f.request(), target = f.stored.get(result.body.receipt_id).metadata.targets[0];
  assert.equal(target.state, 'completed');
  assert.equal(target.counts.discovered_items, 0);
  assert.equal(target.counts.ingestion_requests, 0);
  assert.equal(target.counts.landed_ledger_acknowledged, 0);
  assert.equal(result.body.throttle.attempted, 0);
  const success = f.calls.find(c => c.path === '/rest/v1/listing_feeds' && c.body?.error_count === 0);
  assert.equal(success.body.last_error, null);
  assert.equal(success.body.last_poll_count, 0);
  assert(!f.calls.some(c => c.path === '/functions/v1/ingest' || c.path === '/rest/v1/import_queue'));
});

test('one Craigslist result still needs the normal ingestion and matching ledger acknowledgement', async () => {
  const url = 'https://www.craigslist.org/view/d/example-car/abc123XYZ';
  const html = emptySearchHtml.replace('"itemListElement":[]', `"itemListElement":[{"url":"${url}"}]`)
    .replace('</ol>', `<li class="cl-static-search-result"><a href="${url}">1980 Ford</a></li></ol>`);
  const f = fixture({ feed: emptySearchFeed, archive: async () => ({ html, statusCode: 200, error: null }),
    ingestResult: () => ({ status: 'created', source: 'craigslist', vehicle_id: '00000000-0000-4000-8000-000000000002',
      listing_capture: { post_id: '1234567890', capture_landing: { observation: 'written',
        observation_id: '00000000-0000-4000-8000-000000000031', listing_event: {
          action: 'inserted', id: '00000000-0000-4000-8000-000000000032' } } } }) });
  const result = await f.request(), target = f.stored.get(result.body.receipt_id).metadata.targets[0];
  assert.equal(target.state, 'completed');
  assert.equal(target.counts.discovered_items, 1);
  assert.equal(target.counts.ingestion_requests, 1);
  assert.equal(target.counts.landed_ledger_acknowledged, 1);
  assert.equal(result.body.throttle.attempted, 1);
  assert(f.calls.some(c => c.path === '/rest/v1/import_queue' && c.method === 'POST' && c.body.status === 'complete'));
});

test('the empty search bypass does not apply to another source strategy', async () => {
  const f = fixture({ feed: { ...emptySearchFeed, source_slug: 'other', search_criteria: {
    fetch_strategy: 'firecrawl_html', prefer_direct_fetch: true } },
    archive: async () => ({ html: emptySearchHtml, statusCode: 200, error: null }) });
  const result = await f.request();
  assert.equal(result.body.results[0].error, 'parsed_zero');
  assert.equal(f.stored.get(result.body.receipt_id).metadata.targets[0].state, 'failed');
  assert.equal(result.body.throttle.attempted, 0);
});

for (const [name, html, criteria] of [
  ['challenge', emptySearchHtml + '<h1>Access Denied</h1>'],
  ['captcha challenge', emptySearchHtml + '<div class="g-recaptcha">Verify you are human</div>'],
  ['unquoted nonempty row', emptySearchHtml.replace('</ol>', '<li class=cl-static-search-result>unreadable item</li></ol>')],
  ['unclosed comment', '<!--' + emptySearchHtml],
  ['nested comment boundaries', '<!-- outer <!-- inner -->' + emptySearchHtml + '-->'],
  ['malformed duplicate script close', emptySearchHtml + '<script type="application/ld+json" id="ld_searchpage_results">{"@type":"ItemList","itemListElement":[{}]}</script\t\n bar>'],
  ['unclosed duplicate script', emptySearchHtml + '<script type="application/ld+json" id="ld_searchpage_results">{"@type":"ItemList","itemListElement":[{}]}'],
  ['malformed JSON', emptySearchHtml.replace('"itemListElement":[]', '"itemListElement":[')],
  ['absent result data', '<html><body>Loading search</body></html>'],
  ['null result data', emptySearchHtml.replace('"itemListElement":[]', '"itemListElement":null')],
  ['nonempty data without extractable links', emptySearchHtml.replace('"itemListElement":[]', '"itemListElement":[{"name":"unreadable item"}]')],
  ['invalid configured regex', emptySearchHtml, { listing_url_regex: '[' }],
  ['nonmatching configured regex', emptySearchHtml, { listing_url_regex: 'https://example.invalid/listing/[^" ]+' }],
]) {
  test(`zero Craigslist links still fail with ${name}`, async () => {
    const f = fixture({ feed: { ...emptySearchFeed, search_criteria: { ...emptySearchFeed.search_criteria, ...criteria } },
      archive: async () => ({ html, statusCode: 200, error: null }) });
    const result = await f.request(), target = f.stored.get(result.body.receipt_id).metadata.targets[0];
    assert.equal(target.state, 'failed');
    assert.equal(result.body.results[0].error, 'parsed_zero');
    assert.equal(result.body.throttle.attempted, 0);
    const failure = f.calls.find(c => c.path === '/rest/v1/listing_feeds' && c.body?.last_error === 'parsed_zero');
    assert.equal(failure.body.error_count, 60);
    assert(!f.calls.some(c => c.path === '/functions/v1/ingest' || c.path === '/rest/v1/import_queue'));
  });
}

const selectedFeeds = count => Array.from({ length: count }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`,
  source_slug: `house_${i % 4}`, feed_url: `https://source.invalid/feed${i}`,
}));

test('metadata pagination reaches a source beyond the 1,000-row API cap before selecting targets', async () => {
  const feeds = selectedFeeds(1201).map((feed, i) => ({ ...feed, source_slug: i === 1200 ? 'single' : 'crowded',
    last_polled_at: i === 1200 ? '2026-10-14T22:00:00Z' : '2026-10-14T21:00:00Z' }));
  const f = fixture({ feeds, feedApiCap: 1000, controls: { max_feeds: 2, max_ingests: 2 }, timing: {} });
  const result = await f.request({ batch_size: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.feed_selection_complete, true);
  const run = f.stored.get(result.body.receipt_id);
  assert.equal(run.metadata.target_scope_complete, true);
  assert.deepEqual(run.metadata.targets.map(target => target.source), ['crowded', 'single']);
  const reads = f.calls.filter(call => call.path === '/rest/v1/listing_feeds' && call.method === 'GET');
  assert.deepEqual(reads.map(call => new URLSearchParams(call.query).get('offset')), ['0', '500', '1000']);
  assert(reads.every(call => new URLSearchParams(call.query).get('limit') === '500'));
  assert(reads.every(call => new URLSearchParams(call.query).get('order') === 'last_polled_at.asc.nullsfirst,id.asc'));
  assert(f.calls.findIndex(call => call.path.startsWith('/feed')) > f.calls.indexOf(reads.at(-1)));
});

for (const size of [1000, 2000, 2001]) {
  test(`metadata boundary ${size} distinguishes exhaustion from the 2,001st sentinel`, async () => {
    const feeds = selectedFeeds(size);
    // The sentinel would win its source's priority if it leaked into selection.
    if (size > 2000) feeds[2000].search_criteria = { tier: 1 };
    feeds.reverse(); // Equal clocks still have a stable id order across pages.
    const f = fixture({ feeds, controls: { max_feeds: 2, max_ingests: 2 }, feedApiCap: 1000 });
    const result = await f.request({ batch_size: 2 });
    assert.equal(result.status, 200);
    assert.equal(result.body.feed_selection_complete, size <= 2000);
    const run = f.stored.get(result.body.receipt_id);
    assert.equal(run.metadata.target_scope_complete, size <= 2000);
    assert.equal(run.metadata.targets.length, 2);
    assert.equal(run.metadata.targets[0].target_id, selectedFeeds(1)[0].id);
    assert.equal(result.body.throttle.attempted, 2);
    const reads = f.calls.filter(call => call.path === '/rest/v1/listing_feeds' && call.method === 'GET');
    assert.equal(reads.length, size === 1000 ? 3 : 5);
    assert.equal(new URLSearchParams(reads.at(-1).query).get('limit'), size === 1000 ? '500' : '1');
    assert(run.metadata.targets.every(target => target.target_id !== selectedFeeds(2001)[2000].id));
  });
}

test('a later metadata page failure stops source work and never claims a complete target scope', async () => {
  const f = fixture({ feeds: selectedFeeds(1201), feedReadFailureAt: 2 });
  const result = await f.request({ batch_size: 40 });
  assert.equal(result.status, 500);
  const run = [...f.stored.values()][0];
  assert.equal(run.status, 'failed');
  assert.equal(run.metadata.target_scope_complete, null);
  assert.equal(run.metadata.targets.length, 0);
  assert(!f.calls.some(call => call.path.startsWith('/feed') || call.path === '/functions/v1/ingest'));
  assert(!f.calls.some(call => call.path === '/rest/v1/listing_feeds' && call.method === 'PATCH'));
});

test('each metadata page retains enabled and explicit source filters', async () => {
  const feeds = selectedFeeds(1201).map((feed, i) => ({ ...feed, source_slug: i % 2 ? 'included' : 'excluded' }));
  feeds.push({ ...feeds[0], id: '00000000-0000-4000-8000-999999999999', enabled: false });
  for (const body of [{ source: 'included' }, { exclude_source: 'excluded' }]) {
    const f = fixture({ feeds, controls: { max_feeds: 2, max_ingests: 2 } });
    const result = await f.request({ ...body, batch_size: 2 });
    assert.equal(result.status, 200);
    const run = f.stored.get(result.body.receipt_id);
    assert(run.metadata.targets.every(target => target.source === 'included'));
    const reads = f.calls.filter(call => call.path === '/rest/v1/listing_feeds' && call.method === 'GET');
    assert.equal(reads.length, 2);
    assert(reads.every(call => new URLSearchParams(call.query).get('enabled') === 'eq.true'));
    assert(reads.every(call => new URLSearchParams(call.query).get('source_slug') === (body.source ? 'eq.included' : 'neq.excluded')));
  }
  const f = fixture({ feeds });
  const result = await f.request({ feed_id: feeds[1200].id });
  assert.equal(f.stored.get(result.body.receipt_id).metadata.targets[0].target_id, feeds[1200].id);
});

test('busy selected feeds finish across sources before the unchanged deadline, and next run reaches untouched feeds', async () => {
  const f = fixture({ feeds: selectedFeeds(1200), controls: { max_feeds: 40, max_ingests: 40 },
    itemsPerFeed: 20, timing: { sourceMs: 1_000, ingestMs: 10_000 }, retainLedger: true });
  const first = await f.request({ batch_size: 40 });
  assert.equal(first.status, 200);
  const run = f.stored.get(first.body.receipt_id), targets = run.metadata.targets;
  const completed = targets.filter(target => target.state === 'completed');
  assert.equal(completed.length, 8);
  assert.equal(new Set(completed.map(target => target.source)).size, 4);
  assert(completed.every(target => target.counts.ingestion_requests === 1 && target.counts.landed_ledger_acknowledged === 1));
  assert.equal(first.body.throttle.attempted, 8);
  assert.equal(first.body.elapsed_ms, 94_000);
  assert.equal(first.body.throttle.max_ingests, 40);
  assert.equal(targets.filter(target => target.attempted_at === null).length, 32);
  const second = await f.request({ batch_size: 40 });
  const later = f.stored.get(second.body.receipt_id).metadata.targets.filter(target => target.attempted_at !== null);
  assert(later.length > 0);
  assert(later.every(target => !completed.some(previous => previous.target_id === target.target_id)));
  assert(second.body.elapsed_ms < 110_000);
});

test('empty and blocked targets redistribute unspent slots while source and invocation caps survive', async () => {
  const feeds = selectedFeeds(3);
  for (const first of [{ itemsByPath: { '/feed0': 0 } }, { sourceFailures: { '/feed0': 403 } }]) {
    const f = fixture({ feeds, controls: { max_ingests: 4 }, itemsPerFeed: 20, ...first });
    const result = await f.request({ batch_size: 3 });
    const run = f.stored.get(result.body.receipt_id);
    assert.equal(result.body.throttle.attempted, 4);
    assert.equal(run.metadata.targets[0].counts.ingestion_requests, 0);
    assert.deepEqual(run.metadata.targets.slice(1).map(target => target.counts.landed_ledger_acknowledged), [2, 2]);
    assert.equal(result.body.throttle.sources.house_0.attempted, 0);
    assert.equal(result.body.throttle.sources.house_1.attempted, 2);
  }
});

test('billing refusal and source pause retain their boundaries under target allocation', async () => {
  const f = fixture({ feeds: selectedFeeds(3), controls: { max_ingests: 6,
    sources: { house_0: { enabled: false }, house_1: { max_ingests: 1 } } }, itemsPerFeed: 20,
    ingestResult: url => url.includes('feed1-') ? { status: 'error', error: 'HTTP 402 payment required' } : undefined });
  const result = await f.request({ batch_size: 3 }), run = f.stored.get(result.body.receipt_id);
  assert(!f.calls.some(call => call.path === '/feed0'));
  assert.equal(result.body.throttle.sources.house_1.hold, 'billing');
  assert.equal(result.body.throttle.sources.house_1.attempted, 1);
  assert.equal(result.body.throttle.sources.house_2.attempted, 3);
  assert.equal(run.metadata.targets.find(target => target.source === 'house_1').reason, 'billing');
  assert.equal(run.metadata.targets.find(target => target.source === 'house_2').counts.landed_ledger_acknowledged, 3);
});

test('article hops spend the target allocation even when no vehicle URL is found', async () => {
  const feeds = selectedFeeds(2), articles = [];
  feeds[0].search_criteria = { fetch_strategy: 'rss_article_hop', article_link_regex: 'https://target.invalid/listing/[^" ]+' };
  const f = fixture({ feeds, controls: { max_ingests: 4 }, itemsPerFeed: 20,
    archive: async url => { articles.push(url); return { html: '<html>No target listing here</html>' }; } });
  const result = await f.request({ batch_size: 2 }), run = f.stored.get(result.body.receipt_id);
  assert.equal(articles.length, 2);
  assert.equal(result.body.throttle.attempted, 4);
  assert.equal(run.metadata.targets[0].counts.ingestion_requests, 0);
  assert.equal(run.metadata.targets[1].counts.ingestion_requests, 2);
  assert.equal(run.metadata.targets[1].counts.landed_ledger_acknowledged, 2);
});

for (const failure of ['http-500-json', 'http-500-non-json', 'transport-error']) {
  test(`one-slot target progresses past a failed first URL on its next due visit: ${failure}`, async () => {
    const f = fixture({ feeds: selectedFeeds(2), controls: { max_ingests: 2 }, itemsPerFeed: 2,
      timing: {}, retainLedger: true,
      ingestResult: url => {
        if (!url.endsWith('/feed0-0')) return undefined;
        if (failure === 'transport-error') throw new Error('connection closed before ingestion acknowledgement');
        if (failure === 'http-500-non-json') return new Response('Upstream failed', { status: 500 });
        return Response.json({ status: 'error', error: 'ingest HTTP 500' }, { status: 500 });
      } });
    const first = await f.request({ batch_size: 2 });
    assert.equal(first.body.throttle.attempted, 2);
    const failedUrl = 'https://bringatrailer.com/listing/feed0-0';
    const failed = f.queued.get(failedUrl);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.raw_data.ingest_result_unknown, true);
    assert.equal(failed.raw_data.landed, undefined);
    assert.equal(failed.attempts, 1);
    assert.equal(first.body.results[0].ingest_outcomes[0].ledger, 'failed');
    assert.equal(first.body.results[0].ingest_outcomes[0].ledger_write_status, 'acknowledged');
    assert.equal(first.body.results[0].landed_no_data, 0);
    assert.equal(f.stored.get(first.body.receipt_id).metadata.targets[0].counts.landed_ledger_acknowledged, 0);
    f.advance(61 * 60_000); // Feed due again; failed URL still in its existing backoff window.
    const second = await f.request({ batch_size: 2 });
    assert.equal(second.body.throttle.attempted, 2);
    assert.equal(f.calls.filter(call => call.path === '/functions/v1/ingest' && call.body.url === failedUrl).length, 1);
    assert.equal(f.queued.get('https://bringatrailer.com/listing/feed0-1').status, 'complete');
    const resumed = f.stored.get(second.body.receipt_id).metadata.targets[0];
    assert.equal(resumed.counts.backing_off, 1);
    assert.equal(resumed.counts.ingestion_requests, 1);
    assert.equal(resumed.counts.landed_ledger_acknowledged, 1);
  });
}
