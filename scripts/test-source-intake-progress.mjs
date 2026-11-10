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
import * as collectingCars from '../supabase/functions/poll-listing-feeds/collectingCars.ts';
import { selectCollectingCarsReplay } from '../supabase/functions/poll-listing-feeds/collectingCarsReplay.ts';
import { splitByYear } from '../supabase/functions/poll-listing-feeds/yearFilter.ts';
import { fetchCraigslistFeed } from '../supabase/functions/poll-listing-feeds/feedFetch.ts';
import { emptySearchHtml } from '../supabase/functions/poll-listing-feeds/fixtures/empty-search.ts';
import { vehicleEventWriterFor } from '../supabase/functions/_shared/vehicleEventWrite.ts';
import { purplewaveDescription } from '../supabase/functions/poll-listing-feeds/purplewaveDescription.ts';
const require = createRequire(new URL('../nuke_frontend/package.json', import.meta.url));
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { parse } = require('parse5');
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
  let nowMs = options.nowMs ?? Date.parse('2026-10-15T00:00:00Z');
  const runtimeDate = options.timing ? class extends Date {
    constructor(value = nowMs) { super(value); }
    static now() { return nowMs; }
  } : Date;
  const deadlineControllers=[];
  const runtimeAbortSignal=options.enforcePreparationDeadline ? {
    timeout(ms) { const controller=new AbortController();deadlineControllers.push({at:runtimeDate.now()+ms,controller});return controller.signal; },
    any: signals=>AbortSignal.any(signals),
  } : AbortSignal;
  const advance = ms => { if (options.timing) nowMs += ms; for(const t of deadlineControllers)if(t.at<=runtimeDate.now()&&!t.controller.signal.aborted)t.controller.abort(new DOMException('fixture deadline','TimeoutError')); };
  const calls = [], stored = new Map(), queued = new Map((options.importQueue ?? []).map(row=>[row.listing_url,row])), snapshots = new Map((options.replaySnapshots ?? []).map(row=>[row.id,row])), targets = new Map((options.sourceTargets ?? []).map(row=>[row.listing_url,row])); let serve, patchCount = 0, feedReadCount = 0;
  const transport = async (input, init = {}) => {
    const url = new URL(input), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, query: url.search, method, body, at: runtimeDate.now(), signal: init.signal });
    if(options.enforcePreparationDeadline && init.signal?.aborted)throw init.signal.reason;
    if(url.pathname.startsWith("/storage/v1/object/")) {
      assert.ok(init.signal, "protected preflight storage transport must receive the deadline signal");
      if(options.replayStorageUnavailable)throw new DOMException("fixture abort", "AbortError");
      return new Response(options.replayStorageBody ?? "");
    }
    if (url.hostname === 'collectingcars.com' && /^\/sitemap-listings-[1-5]\.xml$/.test(url.pathname)) {
      advance(options.timing?.sitemapMs ?? 0);
      if (!options.sitemapBodies?.[url.pathname]) throw new Error('unexpected sitemap request');
      return new Response(options.sitemapBodies[url.pathname], {status:options.sitemapHttp ?? 200});
    }
    if (url.hostname === 'dora.production.collecting.com') {
      assert.ok(url.searchParams.get('x-typesense-api-key'));
      if (!options.historyDocuments) throw new Error('unexpected CC search');
      if (options.historyHttp) return new Response('source refusal', { status: options.historyHttp });
      if(options.historyResponse)return Response.json(options.historyResponse);
      const search=body.searches[0], m=search.filter_by.match(/^owningSite:=cars && auctionId:>(\d+) && auctionId:<=(\d+)$/);
      assert.ok(m); assert.equal(search.sort_by,'auctionId:asc'); assert.equal(search.page,1);
      const found=options.historyDocuments.filter(d=>d.owningSite==='cars' && d.auctionId>Number(m[1]) && d.auctionId<=Number(m[2])).sort((a,b)=>a.auctionId-b.auctionId);
      return Response.json({results:[{found:found.length,hits:found.slice(0,search.per_page).map(document=>({document}))}]});
    }
    if (url.pathname === '/rest/v1/listing_page_snapshots') {
      if(method==='POST') {
        if(options.historyRetentionFailure) return Response.json({message:'retention unavailable'},{status:500});
        const id=`00000000-0000-4000-8000-${String(9000+snapshots.size).padStart(12,'0')}`;
        snapshots.set(id,{...body,id});return Response.json({id});
      }
      let rows=[...snapshots.values()].filter(row=>['id','platform','listing_url','success','http_status'].every(field=>
        !url.searchParams.has(field)||String(row[field])===url.searchParams.get(field).slice(3)));
      rows.sort((a,b)=>Date.parse(b.fetched_at)-Date.parse(a.fetched_at)||b.id.localeCompare(a.id));
      if(url.searchParams.has('limit'))rows=rows.slice(0,Number(url.searchParams.get('limit')));
      if(options.postgresTimestampOffsets)rows=rows.map(row=>({...row,fetched_at:row.fetched_at?.replace(/Z$/,'+00:00')}));
      return Response.json(url.searchParams.has('limit')?rows:rows[0]??null);
    }
    if (url.hostname === 'source.invalid') {
      advance(options.timing?.sourceMs ?? 0);
      if (options.sourceFailures?.[url.pathname]) return new Response('', { status: options.sourceFailures[url.pathname] });
      const count = options.itemsByPath?.[url.pathname] ?? options.itemsPerFeed ?? 1;
      return new Response('<rss><channel>' + Array.from({ length: count }, (_, i) =>
        `<item><title>1980 Ford fixture</title><link>https://bringatrailer.com/listing/${url.pathname.slice(1)}-${i}/</link></item>`).join('') + '</channel></rss>');
    }
    if (url.pathname === '/functions/v1/ingest') {
      if (method === "GET") return Response.json({ capabilities: { dealer_microdata_native: options.nativeNotDeployed !== true, collecting_cars_native_listing: options.nativeNotDeployed !== true, collecting_cars_pinned_closed_replay: options.pinnedCapability !== false } });
      advance(options.timing?.ingestMs ?? 0);
      const outcome = options.ingestResult?.(body.url,body) ?? { status: 'created', vehicle_id: vehicleId };
      return outcome instanceof Response ? outcome : Response.json(outcome);
    }
    if (url.pathname === '/rest/v1/observation_sources') return Response.json(options.observationSource ?? { id: 'dealer-source', species: 'dealer', supported_observations: ['listing'] });
    if (url.pathname === '/rest/v1/live_auction_sources') return Response.json(options.retainedInventorySource ?? null);
    if (url.pathname === '/rest/v1/monitored_auctions') {
      const rows = options.monitoredAuctions ?? [];
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
      return Response.json(rows.slice(offset, offset + limit));
    }
    if (url.pathname === '/rest/v1/vehicle_observations') return Response.json(url.searchParams.get('id')?.startsWith('eq.')
      ? (options.nativeObservations ?? []).find(o => o.id === url.searchParams.get('id').slice(3)) ?? null : options.nativeObservations ?? []);
    if (url.pathname === '/rest/v1/source_targets') {
      if(method==='POST') {
        if(options.targetWriteFailure)return Response.json({message:'target write failed'},{status:500});
        for(const row of body)if(!targets.has(row.listing_url))targets.set(row.listing_url,{...row,id:1+Math.max(0,...[...targets.values()].map(r=>r.id??0))});
        return Response.json(body);
      }
      const listed=url.searchParams.get('listing_url')?.slice(4,-1).split(',').map(v=>v.replace(/^\"|\"$/g,''));
      let rows=[...targets.values()].filter(row=>(!url.searchParams.has('source_slug')||row.source_slug===url.searchParams.get('source_slug').slice(3))&&(!listed||listed.some(value=>value===row.listing_url)));
      const idFilter=url.searchParams.get('id');
      if(idFilter?.startsWith('gt.'))rows=rows.filter(row=>row.id>Number(idFilter.slice(3)));
      if(idFilter?.startsWith('in.'))rows=rows.filter(row=>idFilter.slice(4,-1).split(',').map(Number).includes(row.id));
      rows.sort((a,b)=>a.id-b.id);
      if(url.searchParams.has('limit'))rows=rows.slice(0,Number(url.searchParams.get('limit')));
      return Response.json(rows);
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
      if(body.search_criteria && url.searchParams.has('search_criteria')) {
        const target=feeds.find(row=>row.id===url.searchParams.get('id')?.slice(3));
        if(options.historyCheckpointFailure || JSON.stringify(target?.search_criteria)!==url.searchParams.get('search_criteria').slice(3))return Response.json([]);
        Object.assign(target,body);return Response.json([{id:target.id}]);
      }
      if (options.retainLedger) Object.assign(feeds.find(row => row.id === url.searchParams.get('id')?.slice(3)) ?? {}, body);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/rest/v1/vehicles' && url.searchParams.get('listing_url')?.startsWith('eq.') && url.searchParams.get('select')?.includes('origin_metadata'))return Response.json(options.replayOwners ?? []);
    if (url.pathname === '/rest/v1/vehicles') return Response.json(url.searchParams.has('id')
      ? [{ id: vehicleId, description: 'Retained fixture description' }] : (options.knownUrls ?? []).map(listing_url => ({ listing_url })));
    if (url.pathname === '/rest/v1/import_queue') {
      if (method === 'GET') {
        let rows=options.retainLedger?[...queued.values()]:[];
        if(url.searchParams.get('status')==='eq.failed') {
          rows=rows.filter(r=>r.status==='failed'&&r.next_attempt_at&&Date.parse(r.next_attempt_at)<=Date.parse(url.searchParams.get('next_attempt_at').slice(4))
            &&r.listing_url.startsWith('https://collectingcars.com/for-sale/')&&r.raw_data?.collecting_cars_native_version==='cc_native_listing_v1');
          rows.sort((a,b)=>Date.parse(a.next_attempt_at)-Date.parse(b.next_attempt_at)||Date.parse(a.created_at)-Date.parse(b.created_at)||a.listing_url.localeCompare(b.listing_url));
          const cursor=url.searchParams.get('or');
          if(cursor) {
            const values=[...cursor.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(m=>JSON.parse(m[0]));
            assert.equal(values.length,6);
            const [at,,created,,,afterUrl]=values;
            rows=rows.filter(r=>Date.parse(r.next_attempt_at)>Date.parse(at)||(Date.parse(r.next_attempt_at)===Date.parse(at)
              &&(Date.parse(r.created_at)>Date.parse(created)||(Date.parse(r.created_at)===Date.parse(created)&&r.listing_url>afterUrl))));
          }
          rows=rows.slice(0,Number(url.searchParams.get('limit')));
        } else if(url.searchParams.get('listing_url')?.startsWith('in.')) {
          const urls=url.searchParams.get('listing_url').slice(4,-1).split(',').map(v=>v.replace(/^\"|\"$/g,''));rows=rows.filter(r=>urls.includes(r.listing_url));
        }
        return Response.json(rows);
      }
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
  // Execute the native reader too, under the same HTTP/clock fixture. Never
  // stub it to success or let its default fetch escape to the real publisher.
  const purplewave = { exports: {} };
  vm.runInNewContext(compile(readFileSync(new URL('../supabase/functions/poll-listing-feeds/purplewave.ts', import.meta.url), 'utf8')), {
    exports: purplewave.exports, module: purplewave, URL, URLSearchParams, TextEncoder, crypto: webcrypto, AbortSignal, Date: runtimeDate, fetch: transport,
    require(name) {
      if (name.endsWith('/vehicleEventWrite.ts')) return { vehicleEventWriterFor };
      if (name === './purplewaveDescription.ts') return { purplewaveDescription };
      // These generic feed cases never acquire Purple Wave pages. Keep the
      // new custody dependency fail-closed; its real archive path is exercised
      // by purplewave.test.ts in the CI poller contract job.
      if (name.endsWith('/archiveFetch.ts')) return { retainFetchedCapture: () => { throw new Error('unexpected PurpleWave page retention'); } };
      throw new Error(`Unexpected PurpleWave import ${name}`);
    },
  });
  // Run the real capture writer and history reader against the installed SDK transport.
  const archive={exports:{}};
  vm.runInNewContext(compile(readFileSync(new URL('../supabase/functions/_shared/archiveFetch.ts',import.meta.url),'utf8')), {
    exports:archive.exports,module:archive,URL,URLSearchParams,TextEncoder,crypto:webcrypto,Date:runtimeDate,console,
    require(name) {
      if(name.includes('supabase-js'))return {createClient:()=>db};
      if(name.endsWith('/batFetcher.ts'))return {isLoginPage:()=>false}; // Native search JSON, not a rendered login page.
      if(name.endsWith('/supabaseKeys.ts'))return {projectSecretKey:()=> 'synthetic-service-key'};
      return {};
    },
  });
  const ccSupplement={exports:{}};
  vm.runInNewContext(compile(readFileSync(new URL('../supabase/functions/poll-listing-feeds/collectingCarsSupplement.ts',import.meta.url),'utf8')), {
    exports:ccSupplement.exports,module:ccSupplement,URL,TextEncoder,TextDecoder,AbortSignal:runtimeAbortSignal,crypto:webcrypto,Date:runtimeDate,fetch:transport,
    require(name) {
      if(name.endsWith('/archiveFetch.ts'))return archive.exports;
      if(name.endsWith('/ledger.ts'))return ledger;
      throw new Error(`Unexpected CC supplement import ${name}`);
    },
  });
  const ccHistory={exports:{}};
  vm.runInNewContext(compile(readFileSync(new URL('../supabase/functions/poll-listing-feeds/collectingCarsHistory.ts',import.meta.url),'utf8')), {
    exports:ccHistory.exports,module:ccHistory,URL,URLSearchParams,TextEncoder,crypto:webcrypto,AbortSignal:runtimeAbortSignal,Date:runtimeDate,fetch:transport,
    require(name) {
      if(name.endsWith('/archiveFetch.ts'))return archive.exports;
      if(name.endsWith('/ledger.ts'))return ledger;
      if(name.endsWith('/collectingCarsSupplement.ts'))return ccSupplement.exports;
      throw new Error(`Unexpected CC history import ${name}`);
    },
  });
  const source = options.source ?? readFileSync(new URL('../supabase/functions/poll-listing-feeds/index.ts', import.meta.url), 'utf8');
  vm.runInNewContext(compile(source + '\nexport { pollFirecrawlHtmlFeed };'), {
    exports: module.exports, module, Request, Response, URL, AbortSignal:runtimeAbortSignal, AbortController, Date: runtimeDate, crypto: webcrypto,
    console: { log() {}, error() {} }, fetch: transport,
    // The fixture preserves ordering while removing courtesy delays.
    setTimeout: (callback, ms) => { if (callback.toString().includes('abort')) return 0; advance(ms); callback(); return 0; }, clearTimeout() {},
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://database.invalid' : 'synthetic-service-key' }, serve: fn => { serve = fn; } },
    require(name) {
      if (name === 'https://esm.sh/parse5@7.3.0') return { parse };
      if (name.includes('supabase-js')) return { createClient: (url,key,options) => options?.global?.fetch ? createClient(url,key,options) : db };
      if (name.endsWith('/ledger.ts')) return { ...ledger,
        createIntakeBudget: (throttle, start) => ledger.createIntakeBudget(throttle, start, runtimeDate.now) };
      if (name.endsWith('/captureLedger.ts')) return { captureLedgerFields };
      if (name.endsWith('/purplewave.ts')) return purplewave.exports;
      if (name.endsWith('/feedFetch.ts')) return { fetchCraigslistFeed };
      if (name.endsWith('/gatewayParser.ts')) return { gatewayInventoryUrls: options.browserUrls ?? (() => { throw new Error('unexpected browser inventory'); }) };
      if (name.endsWith('/gatewayCapture.ts')) return { readGatewayBrowserCapture: options.browserCapture ?? (() => { throw new Error('unexpected browser capture'); }) };
      if (name.endsWith('/mecumSearch.ts')) return { fetchMecumFeedUrls: options.nativeDiscovery ?? (() => { throw new Error('unexpected native search'); }) };
      if (name.endsWith('/schedule.ts')) return { nextYield: () => ({ rate: 0, interval_minutes: 60 }) };
      if (name.endsWith('/removal.ts')) return { sweepCraigslistRemovals: async () => null, noticeFrom: () => null };
      if (name.endsWith('/kslCards.ts')) return { parseKslSearchCards: () => [] };
      if (name === './collectingCars.ts') return collectingCars;
      if (name === './collectingCarsHistory.ts') return ccHistory.exports;
      if (name === './collectingCarsReplay.ts') return { selectCollectingCarsReplay };
      if (name.endsWith('/yearFilter.ts')) return { splitByYear };
      if (name.endsWith('/firecrawlGate.ts')) return { firecrawlGate: () => ({ allow: async () => true, record: async () => {} }), ALLOWANCE_EXHAUSTED: 'allowance_deferred: test' };
      if (name.endsWith('/extractionMetrics.ts')) return metrics.exports;
      if (name.endsWith('/writeGuard.ts')) return { requireWriteAuth: async () => null };
      if (name.endsWith('/supabaseKeys.ts')) return { projectSecretKey: () => 'synthetic-service-key' };
      if (name.endsWith('/normalizeVehicle.ts')) return { isGarbageMake: () => false };
      if (name.endsWith('/urlNormalization.ts')) return { extractCraigslistCanonicalUrls: () => [] };
      if (name.endsWith('/archiveFetch.ts')) return { archiveFetch: options.archive ?? (() => { throw new Error('unexpected acquisition'); }),
        isGarbageHtml: options.isGarbageHtml ?? (() => false), isAwsWafChallengeHtml: options.isAwsWafChallengeHtml ?? (() => false) };
      if (name.endsWith('/firecrawl.ts')) return { firecrawlScrape: () => { throw new Error('unexpected paid provider'); } };
      throw new Error(`Unexpected feed import ${name}`);
    },
  });
  return { calls, stored, queued, snapshots, targets, db, feed, advance,
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

test('Mecum native discovery reaches the existing ingestion and ledger path', async () => {
  let calls = 0;
  const url = 'https://www.mecum.com/lots/123/1980-ford-f100';
  const f = fixture({ feed: { source_slug: 'mecum', search_criteria: { fetch_strategy: 'mecum_public_index' } },
    nativeDiscovery: async () => { calls++; return { urls: [url], confirmedEmpty: false }; } });
  const result = await f.request();
  assert.equal(calls, 1);
  assert.equal(result.body.results[0].items_found, 1);
  assert(f.calls.some(c => c.path === '/functions/v1/ingest' && c.body.url === url));
  assert(f.calls.some(c => c.path === '/rest/v1/import_queue' && c.body?.listing_url === url));
});

test('a Mecum search refusal fails without a paid fallback or ingestion', async () => {
  const f = fixture({ feed: { source_slug: 'mecum', search_criteria: { fetch_strategy: 'mecum_public_index' } },
    nativeDiscovery: async () => { throw new Error('mecum_index: HTTP 403'); } });
  const result = await f.request();
  assert.equal(result.body.results[0].error, 'fetch_failed: mecum_index: HTTP 403');
  assert(!f.calls.some(c => c.path === '/functions/v1/ingest'));
});

test('Gateway polls only retained inventory entries with captured detail pages', async () => {
  const ready = 'https://www.gatewayclassiccars.com/vehicles/det/42/synthetic';
  const uncaptured = 'https://www.gatewayclassiccars.com/vehicles/det/43/synthetic';
  const f = fixture({ feed: { source_slug: 'gateway_classics', search_criteria: { fetch_strategy: 'firecrawl_html' } },
    browserCapture: async () => ({ html: 'retained inventory', captured_urls: [ready] }),
    browserUrls: () => [ready, uncaptured] });
  const result = await f.request();
  assert.equal(result.body.results[0].items_found, 1);
  assert(f.calls.some(c => c.path === '/functions/v1/ingest' && c.body.url === ready));
  assert(!f.calls.some(c => c.path === '/functions/v1/ingest' && c.body.url === uncaptured));
});

test('Gateway missing or stale browser progress refuses without source fetch or paid fallback', async () => {
  const f = fixture({ feed: { source_slug: 'gateway_classics', search_criteria: { fetch_strategy: 'firecrawl_html' } },
    browserCapture: async () => { throw new Error('gateway_browser_capture_required'); } });
  const result = await f.request();
  assert.match(result.body.results[0].error, /^blocked: (?:Error: )?gateway_browser_capture_required$/);
  assert(!f.calls.some(c => c.path === '/functions/v1/ingest'));
});

test('a challenge body fails as blocked before regex matching or ingestion', async () => {
  const f = fixture({ feed: { source_slug: 'gateway', search_criteria: { fetch_strategy: 'firecrawl_html', prefer_direct_fetch: true,
    listing_url_regex: 'https://www.gatewayclassiccars.com/vehicle/[^" ]+' } },
    archive: async () => ({ html: '<html>challenge</html>', statusCode: 202, error: null }), isAwsWafChallengeHtml: () => true });
  const result = await f.request();
  assert.equal(result.body.results[0].error, 'blocked: source challenge');
  assert(!f.calls.some(c => c.path === '/functions/v1/ingest'));
});

test('an invalid source shell is not mislabeled as a confirmed challenge', async () => {
  const f = fixture({ feed: { source_slug: 'bonhams', search_criteria: { fetch_strategy: 'firecrawl_html', prefer_direct_fetch: true } },
    archive: async () => ({ html: '<html>empty shell</html>', statusCode: 200, error: null }), isGarbageHtml: () => true });
  const result = await f.request();
  assert.equal(result.body.results[0].error, 'fetch_failed: invalid_source_body');
  assert(!f.calls.some(c => c.path === '/functions/v1/ingest'));
});

for (const [source, host, stock] of [['gr_auto_gallery', 'www.grautogallery.com', 'b1234-j'], ['streetside_classics', 'www.streetsideclassics.com', '42-det']]) {
  test(`${source}: current absolute URL criteria read relative stock hrefs through existing intake`, async () => {
    const path = `/vehicles/${stock}/1995-ford-f150`, target = `https://${host}${path}`;
    const f = fixture({ ingestResult: () => ({ status: 'created', vehicle_id: 'vehicle', dealer_receipt: { observation_id: 'observation', snapshot_id: 'snapshot', listing_event_id: 'event', observed_at: new Date().toISOString() } }), feed: { source_slug: source, search_criteria: { fetch_strategy: 'firecrawl_html',
      listing_url_regex: `https://` + host.replaceAll('.', '\\.') + `/vehicles/${stock}/[a-z0-9-]+`, listing_url_prefix: `https://${host}` } },
      archive: async (_url, opts) => { assert.equal(opts.useFirecrawl, false); assert.equal(opts.firecrawlOnBlock, false);
        return { html: `<a href="${path}">stock</a><a href="${path}">duplicate</a><a href="/vehicles/current">nav</a><a href="https://outside.invalid${path}">other</a><template><a href="/vehicles/${stock}/inert">template</a></template>`, statusCode: 200, snapshotId: 'snapshot', error: null }; } });
    const result = await f.request(); assert.equal(result.body.results[0].items_found, 1);
    assert.deepEqual(f.calls.filter(c => c.path === '/functions/v1/ingest' && c.method === 'POST').map(c => c.body.url), [target]);
  });
  test(`${source}: refused direct inventory has no paid fallback or ingestion`, async () => {
    const f = fixture({ feed: { source_slug: source, search_criteria: { fetch_strategy: 'firecrawl_html' } },
      archive: async () => ({ html: null, statusCode: 403, error: 'blocked' }) });
    const result = await f.request(); assert.match(result.body.results[0].error, /^blocked:/);
    assert(!f.calls.some(c => c.path === '/functions/v1/ingest' && c.method === 'POST'));
  });
}

function nativeProgressFixture(extra = {}) {
  const host = 'www.streetsideclassics.com', first = `https://${host}/vehicles/42-det/1995-ford-f150`, second = `https://${host}/vehicles/43-det/1996-ford-f150`;
  const receipt = { observation_id: 'observation', snapshot_id: 'snapshot', listing_event_id: 'event', observed_at: new Date().toISOString() };
  const f = fixture({ retainLedger: true, knownUrls: [first, second],
    feed: { source_slug: 'streetside_classics', search_criteria: { fetch_strategy: 'firecrawl_html', listing_url_prefix: `https://${host}`, listing_url_regex: 'https://www\\.streetsideclassics\\.com/vehicles/\\d+-det/[a-z0-9-]+' } },
    archive: async () => ({ html: '<a href="/vehicles/42-det/1995-ford-f150">first</a><a href="/vehicles/43-det/1996-ford-f150">second</a>', statusCode: 200, snapshotId: 'inventory', error: null }),
    ingestResult: () => ({ status: 'matched', vehicle_id: 'vehicle', dealer_receipt: receipt }), ...extra });
  return { ...f, first, second, receipt };
}

test('native dealers require canonical receipt even when the URL and a complete legacy ledger exist', async () => {
  const f = nativeProgressFixture();
  f.queued.set(f.first, { listing_url: f.first, status: 'complete', vehicle_id: 'vehicle', raw_data: {} });
  const r = await f.request(); assert.equal(r.body.results[0].ingest_outcomes.length, 2);
  assert.equal(f.queued.get(f.first).raw_data.dealer_receipt.observation_id, 'observation');
  assert.equal(f.queued.get(f.first).raw_data.dealer_native_version, 'dealer_microdata_v2');
});

test('native canonical progress skips fresh admitted evidence, revisits stale evidence and prioritizes missing evidence', async () => {
  const f = nativeProgressFixture({ nativeObservations: [{ id: 'observation', vehicle_id: 'vehicle', is_superseded: false, source_id: 'dealer-source', source_url: 'https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150', raw_source_ref: 'listing_page_snapshots:snapshot', extraction_method: 'dealer_microdata_v2', observed_at: new Date().toISOString() }] });
  f.queued.set(f.first, { listing_url: f.first, status: 'complete', vehicle_id: 'vehicle', raw_data: { dealer_native_version: 'dealer_microdata_v2', dealer_receipt: f.receipt } });
  const r = await f.request(); assert.deepEqual(r.body.results[0].ingest_outcomes.map(o => o.url), [f.second]);
  const stale = nativeProgressFixture({ nativeObservations: [{ id: 'observation', vehicle_id: 'vehicle', is_superseded: false, source_id: 'dealer-source', source_url: f.first, raw_source_ref: 'listing_page_snapshots:snapshot', extraction_method: 'dealer_microdata_v2', observed_at: new Date(Date.now()-86400_000).toISOString() }] });
  stale.queued.set(stale.first, { listing_url: stale.first, status: 'complete', vehicle_id: 'vehicle', raw_data: { dealer_native_version: 'dealer_microdata_v2', dealer_receipt: stale.receipt } });
  const rr = await stale.request(); assert.deepEqual(rr.body.results[0].ingest_outcomes.map(o => o.url), [stale.second, stale.first]);
});

test('native intake without a canonical acknowledgement is failed, never complete', async () => {
  const f = nativeProgressFixture({ ingestResult: () => ({ status: 'matched', vehicle_id: 'vehicle' }) });
  const r = await f.request(); assert(r.body.results[0].error);
  assert.equal(f.queued.get(f.first).status, 'failed'); assert.equal(r.body.results[0].matched_existing, 0);
});

test('superseded or reattributed dealer evidence cannot keep a source URL marked complete', async () => {
 for (const change of [{ is_superseded: true }, { vehicle_id: 'different-vehicle' }]) {
  const url = 'https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150';
  const f = nativeProgressFixture({ nativeObservations: [{ id: 'observation', source_id: 'dealer-source', vehicle_id: 'vehicle', source_url: url, raw_source_ref: 'listing_page_snapshots:snapshot', extraction_method: 'dealer_microdata_v2', observed_at: new Date().toISOString(), is_superseded: false, ...change }] });
  f.queued.set(f.first, { listing_url: f.first, status: 'complete', vehicle_id: 'vehicle', raw_data: { dealer_native_version: 'dealer_microdata_v2', dealer_receipt: f.receipt } });
  const r = await f.request(); assert(r.body.results[0].ingest_outcomes.some(o=>o.url===f.first));
 }
});

test('native collection preserves failed-source backoff and fails closed before an old deployment', async () => {
 const f = nativeProgressFixture();
 f.queued.set(f.first, { listing_url: f.first, status: 'failed', attempts: 1, next_attempt_at: new Date(Date.now()+3600_000).toISOString() });
 const r = await f.request(); assert.deepEqual(r.body.results[0].ingest_outcomes.map(o=>o.url), [f.second]);
 let fetched = 0;
 const old = nativeProgressFixture({ nativeNotDeployed: true, archive: async () => { fetched++; throw Error('unexpected source fetch'); } });
 const rr = await old.request(); assert.equal(fetched, 0); assert.match(rr.body.results[0].error, /not deployed/);
});


function ccFixture(overrides = {}) {
  const url = 'https://collectingcars.com/for-sale/1965-porsche-911-2-0-swb-4';
  const clock = new Date(Date.now() - 60_000).toISOString();
  const sourceId = '00000000-0000-4000-8000-000000000071';
  const captureClock = new Date(Date.now() - (overrides.captureAgeMs ?? 60_000)).toISOString();
  const receipt = { observation_id: '00000000-0000-4000-8000-000000000072', snapshot_id: '00000000-0000-4000-8000-000000000073', source_read_at: captureClock, images: 67 };
  const observation = { id: receipt.observation_id, source_id: sourceId, source_url: url, kind: 'listing',
    vehicle_id: '00000000-0000-4000-8000-000000000002', extraction_method: 'cc_native_listing_v1',
    is_superseded: false, raw_source_ref: `listing_page_snapshots:${receipt.snapshot_id}`, observed_at: captureClock };
  const f = fixture({ feed: { source_slug: 'collecting-cars', feed_url: 'https://collectingcars.com/sitemap.xml', poll_interval_minutes: 1440,
    search_criteria: { fetch_strategy: 'firecrawl_html', slug_year_min: 1964, slug_year_max: 1991 } },
    knownUrls: [url], retainLedger: true, observationSource: { id: sourceId, supported_observations: ['listing'] }, nativeObservations: [observation],
    retainedInventorySource: { id: sourceId, last_successful_sync: clock, last_sync_error: null,
      scraping_config: { live_board: { last_run: { at: clock, complete: true, lots: 1, upserted: 1 } } } },
    monitoredAuctions: [{ id: '00000000-0000-4000-8000-000000000074', external_auction_id: '94333', external_auction_url: url,
      auction_end_time: new Date(Date.now() + 86400000).toISOString(), is_live: true, last_synced_at: clock, board: 'collecting-cars' }],
    ingestResult: () => ({ status: 'matched', source: 'collecting-cars', vehicle_id: observation.vehicle_id, collecting_cars_receipt: receipt }), ...overrides });
  return { ...f, url, receipt };
}
test('actual CC handler hands a retained thin Porsche to ingest, verifies full admission, acknowledges ledger and skips it next poll', async () => {
  const f = ccFixture();
  const first = await f.poll();
  assert.equal(first.items_found, 1); assert.equal(first.ingest_outcomes[0].status, 'matched');
  assert.equal(first.ingest_outcomes[0].ledger, 'complete'); assert.equal(first.ingest_outcomes[0].ledger_write_status, 'acknowledged');
  assert.deepEqual(first.ingest_outcomes[0].collecting_cars_receipt, f.receipt);
  assert.equal(f.queued.get(f.url).raw_data.collecting_cars_native_version, 'cc_native_listing_v1');
  const before = f.calls.filter(c => c.path === '/functions/v1/ingest' && c.method === 'POST').length;
  const second = await f.poll(); assert.equal(second.retained_inventory.current_full_listing_receipts, 1);
  assert.equal(f.calls.filter(c => c.path === '/functions/v1/ingest' && c.method === 'POST').length, before);
  assert.equal(f.calls.some(c => c.path.includes('sitemap')), false);
});
test('actual CC handler does not settle a known-price shell or unacknowledged admission as a full listing', async () => {
  for (const override of [{ ingestResult: () => ({ status: 'matched', vehicle_id: '00000000-0000-4000-8000-000000000002' }) }, { nativeObservations: [] }]) {
    const f = ccFixture(override), result = await f.poll();
    assert.equal(result.ingest_outcomes[0].status, 'error'); assert.equal(result.ingest_outcomes[0].ledger, 'failed');
    assert.equal(f.queued.get(f.url).status, 'failed'); assert.equal(f.queued.get(f.url).attempts, 1);
    assert.match(result.error, /ingest_failed/);
  }
});
test('actual CC handler refuses old sink capability before acquiring inventory or spending an ingest attempt', async () => {
  const f = ccFixture({ nativeNotDeployed: true }), result = await f.poll();
  assert.match(result.error, /native listing intake not deployed/);
  assert.equal(f.calls.some(c => c.path === '/rest/v1/monitored_auctions'), false);
  assert.equal(f.calls.some(c => c.path === '/functions/v1/ingest' && c.method === 'POST'), false);
});

test('actual CC handler preserves bounded native extractor errors after HTTP failure', async () => {
  const detail = 'no Collecting Cars lot payload on page';
  const f = ccFixture({ ingestResult: () => Response.json({ status: 'error', error: detail + 'x'.repeat(500) }, { status: 500 }) });
  const result = await f.poll();
  assert.equal(result.ingest_outcomes[0].status, 'error');
  assert.equal(result.ingest_outcomes[0].ledger, 'failed');
  assert.match(result.ingest_outcomes[0].error, /Collecting Cars ingest HTTP 500: no Collecting Cars lot payload on page/);
  assert.ok(result.ingest_outcomes[0].error.length <= 200);
  assert.equal(f.queued.get(f.url).attempts, 1);
});

test('actual CC main handler preserves global/source holds before retained discovery and ingestion', async () => {
  for (const controls of [{ max_ingests: 0 }, { sources: { 'collecting-cars': { enabled: false } } }]) {
    const f = ccFixture({ controls }); const result = await f.request({ source: 'collecting-cars', force: true });
    assert.equal(result.status, 200);
    assert.equal(f.calls.some(c => c.path === '/functions/v1/ingest' || c.path === '/rest/v1/monitored_auctions'), false);
  }
});

test('actual CC feed counts one confirmed match separately from twenty failed backoffs', async () => {
  const clock = new Date(Date.now() - 60_000).toISOString();
  const urls = ['https://collectingcars.com/for-sale/1965-porsche-911-2-0-swb-4',
    ...Array.from({ length: 20 }, (_, i) => `https://collectingcars.com/for-sale/1986-backoff-${i}`)];
  const f = ccFixture({
    retainedInventorySource: { id: '00000000-0000-4000-8000-000000000071', last_successful_sync: clock, last_sync_error: null,
      scraping_config: { live_board: { last_run: { at: clock, complete: true, lots: 21, upserted: 21 } } } },
    monitoredAuctions: urls.map((url, i) => ({ id: `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
      external_auction_id: String(94000 + i), external_auction_url: url, auction_end_time: new Date(Date.now() + 86400000).toISOString(),
      is_live: true, last_synced_at: clock, board: 'collecting-cars' })),
  });
  for (const url of urls.slice(1)) f.queued.set(url, { listing_url: url, status: 'failed', attempts: 1, max_attempts: 3,
    next_attempt_at: new Date(Date.now() + 86400000).toISOString() });
  const result = await f.poll();
  assert.equal(result.matched_existing, 1); assert.equal(result.backing_off, 20);
  assert.equal(result.ingest_outcomes.length, 1); assert.equal(result.ingest_outcomes[0].status, 'matched');
  assert.equal(f.calls.filter(c => c.path === '/functions/v1/ingest' && c.method === 'POST').length, 1);
  for (const url of urls.slice(1)) assert.equal(f.queued.get(url).attempts, 1);
});


test('actual CC short-cadence handler keeps an hour-old full capture settled with the independent daily default', async () => {
  const f = ccFixture({ captureAgeMs: 3600000, feed: { source_slug: 'collecting-cars',
    feed_url: 'https://collectingcars.com/sitemap.xml', poll_interval_minutes: 15, search_criteria: {} } });
  const first = await f.poll(); assert.equal(first.ingest_outcomes[0].ledger, 'complete');
  for (let i = 0; i < 3; i++) {
    const next = await f.poll(); assert.equal(next.retained_inventory.current_full_listing_receipts, 1);
  }
  assert.equal(f.calls.filter(c => c.path === '/functions/v1/ingest' && c.method === 'POST').length, 1);
});

test('actual CC handler executes the oldest due retry before fresh lots under a one-attempt allowance', async () => {
  const clock = new Date(Date.now() - 60000).toISOString();
  const urls = ['https://collectingcars.com/for-sale/1965-new-lot', 'https://collectingcars.com/for-sale/1965-newer-retry',
    'https://collectingcars.com/for-sale/1965-oldest-retry'];
  const f = ccFixture({ controls: { max_ingests: 1 },
    retainedInventorySource: { id: '00000000-0000-4000-8000-000000000071', last_successful_sync: clock, last_sync_error: null,
      scraping_config: { live_board: { last_run: { at: clock, complete: true, lots: 3, upserted: 3 } } } },
    monitoredAuctions: urls.map((url, i) => ({ id: `00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`,
      external_auction_id: String(94000+i), external_auction_url: url, auction_end_time: new Date(Date.now()+86400000).toISOString(),
      is_live: true, last_synced_at: clock, board: 'collecting-cars' })) });
  for (const [i,url] of urls.entries()) if(i) f.queued.set(url, { listing_url: url, status: 'failed', attempts: 1,
    max_attempts: 3, next_attempt_at: new Date(Date.now()-i*3600000).toISOString() });
  const result = await f.request({ source: 'collecting-cars', force: true }); assert.equal(result.status,200);
  assert.deepEqual(f.calls.filter(c => c.path === '/functions/v1/ingest' && c.method === 'POST').map(c=>c.body.url), [urls[2]]);
  assert.equal(f.queued.get(urls[1]).attempts,1);
});


test('actual CC all-year feed admits pre1964 and post1991 full receipts while explicit year filters still exclude them', async () => {
  const urls = ['https://collectingcars.com/for-sale/1960-messerschmitt-kr200',
    'https://collectingcars.com/for-sale/1965-porsche-911-2-0-swb-4', 'https://collectingcars.com/for-sale/2020-porsche-911'];
  const clock = new Date(Date.now()-60000).toISOString();
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const sourceId=uuid(71), vehicleId=uuid(2);
  const receipts=urls.map((url,i)=>({ observation_id:uuid(200+i),snapshot_id:uuid(300+i),source_read_at:clock,images:67+i }));
  const nativeObservations=urls.map((url,i)=>({id:receipts[i].observation_id,vehicle_id:vehicleId,source_id:sourceId,
    source_url:url,kind:'listing',extraction_method:'cc_native_listing_v1',is_superseded:false,
    raw_source_ref:`listing_page_snapshots:${receipts[i].snapshot_id}`,observed_at:clock}));
  for(const restricted of [false,true]) {
    const criteria={full_capture_interval_minutes:1440,...(restricted?{slug_year_min:1964,slug_year_max:1991}:{})};
    const f=ccFixture({ feed:{source_slug:'collecting-cars',feed_url:'https://collectingcars.com/sitemap.xml',poll_interval_minutes:15,search_criteria:criteria},
      knownUrls:urls,nativeObservations,
      retainedInventorySource:{id:sourceId,last_successful_sync:clock,last_sync_error:null,
        scraping_config:{live_board:{last_run:{at:clock,complete:true,lots:3,upserted:3}}}},
      monitoredAuctions:urls.map((url,i)=>({id:uuid(100+i),external_auction_id:String(94000+i),external_auction_url:url,
        auction_end_time:new Date(Date.now()+86400000).toISOString(),is_live:true,last_synced_at:clock,board:'collecting-cars'})),
      ingestResult:url=>({status:'matched',source:'collecting-cars',vehicle_id:vehicleId,collecting_cars_receipt:receipts[urls.indexOf(url)]}) });
    const result=await f.poll(), expected=restricted?[urls[1]]:urls;
    assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body.url),expected);
    assert.equal(result.retained_inventory.eligible_after_year_filter,expected.length);
    for(const url of expected) {
      assert.equal(f.queued.get(url).status,'complete');
      assert.deepEqual(f.queued.get(url).raw_data.collecting_cars_receipt,receipts[urls.indexOf(url)]);
    }
    assert.equal(result.ingest_outcomes.every(row=>row.ledger_write_status==='acknowledged'),true);
    const before=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length;
    await f.poll();
    assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,before);
    if(restricted)assert.deepEqual(f.calls.find(c=>c.path==='/rest/v1/source_targets').body.map(row=>row.listing_url),[urls[0],urls[2]]);
  }
});

function ccHistoryFixture(overrides={}) {
  const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const documents=overrides.historyDocuments??Array.from({length:25},(_,i)=>({auctionId:i+1,owningSite:'cars',
    slug:`1960-history-${i+1}`,lotType:i===0?'plate':'car',listingStage:'sold',productYear:'1960',currencyCode:'GBP',priceSold:100+i}));
  const clock=new Date(Date.now()-7*86400000).toISOString();
  const receipts=new Map(documents.filter(d=>d.lotType==='car').map(d=>[`https://collectingcars.com/for-sale/${d.slug}`,
    {observation_id:uuid(1000+d.auctionId),snapshot_id:uuid(2000+d.auctionId),source_read_at:clock,images:3}]));
  const nativeObservations=[...receipts].map(([url,r])=>({id:r.observation_id,vehicle_id:uuid(2),source_id:uuid(71),source_url:url,
    kind:'listing',extraction_method:'cc_native_listing_v1',is_superseded:false,raw_source_ref:`listing_page_snapshots:${r.snapshot_id}`,observed_at:r.source_read_at}));
  const f=fixture({feed:{source_slug:'collecting-cars',feed_url:'https://collectingcars.com/search/',poll_interval_minutes:15,
    search_criteria:{fetch_strategy:'collecting_cars_history',history_version:1,history_ceiling_id:25,history_after_id:0,history_capture:null,history_pass:1,history_discovery_complete:false}},
    controls:{max_ingests:2},knownUrls:[],retainLedger:true,historyDocuments:documents,
    observationSource:{id:uuid(71),supported_observations:['listing']},nativeObservations,
    ingestResult:url=>({status:'created',vehicle_id:uuid(2),collecting_cars_receipt:receipts.get(url)}),...overrides});
  return {...f,documents,receipts,nativeObservations};
}

test('actual historical handler resumes retained membership after capped batches and reaches the exact cohort boundary',async()=>{
  const f=ccHistoryFixture();
  const first=await f.request({force:true});
  assert.ok(f.feed.search_criteria.history_capture, JSON.stringify(first.body));
  assert.equal(f.feed.search_criteria.history_after_id,0);
  const captured=f.feed.search_criteria.history_capture.id;
  assert.equal(f.snapshots.size,1);assert.equal(f.targets.size,20);
  assert.equal(new URL(f.snapshots.get(captured).listing_url).searchParams.has('x-typesense-api-key'),false);
  assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,2);
  await f.request({force:true});
  assert.equal(f.feed.search_criteria.history_capture.id,captured);
  assert.equal(f.calls.filter(c=>c.path==='/multi_search').length,1);
  for(let i=0;i<8;i++)await f.request({force:true});
  assert.equal(f.feed.search_criteria.history_after_id,20);assert.equal(f.feed.search_criteria.history_capture,null);
  // A new lot outside the census boundary cannot enter the old cohort.
  f.documents.push({auctionId:100,owningSite:'cars',slug:'2020-new-later',lotType:'car'});
  for(let i=0;i<3;i++)await f.request({force:true});
  assert.equal(f.feed.search_criteria.history_after_id,0);assert.equal(f.feed.search_criteria.history_pass,2);
  assert.equal(f.feed.search_criteria.history_discovery_complete,true);
  assert.equal(f.targets.size,25);assert.equal(f.queued.size,24);assert.equal(f.snapshots.size,2);
  assert.equal([...f.queued.values()].every(row=>row.status==='complete'),true);
  const invoked=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body.url);
  assert.equal(new Set(invoked).size,24);assert.equal(invoked.length,24);
  assert.deepEqual(invoked,f.documents.filter(doc=>doc.lotType==='car'&&doc.auctionId<=25).map(doc=>`https://collectingcars.com/for-sale/${doc.slug}`));
  // Current-index retry reconciliation may read again; seven-day-old full receipts stay settled.
  await f.request({force:true});
  assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,24);
});

test('actual historical handler never advances or ingests when page retention or checkpoint fails',async()=>{
  for(const failure of [{historyRetentionFailure:true},{historyCheckpointFailure:true}]){
    const f=ccHistoryFixture(failure);await f.request({force:true});
    assert.equal(f.feed.search_criteria.history_after_id,0);assert.equal(f.feed.search_criteria.history_capture,null);
    assert.equal(f.targets.size,0);assert.equal(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'),false);
  }
});

test('actual historical handler rejects legacy complete testimony as capture evidence and does not advance an unacknowledged lot',async()=>{
  const doc={auctionId:25,owningSite:'cars',slug:'1960-unseen-owner',lotType:'car',listingStage:'sold'};
  const f=ccHistoryFixture({historyDocuments:[doc],ledgerError:true});
  const url=`https://collectingcars.com/for-sale/${doc.slug}`;
  f.queued.set(url,{status:'complete',vehicle_id:'00000000-0000-4000-8000-000000000002',listing_url:url});
  await f.request({force:true});
  assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body),[{url}]);
  assert.equal(f.feed.search_criteria.history_after_id,0);assert.equal(f.feed.search_criteria.history_pass,1);
  assert.ok(f.feed.search_criteria.history_capture);
});

test('actual historical handler retains noncars and durable failed debt without claiming canonical completion',async()=>{
  const docs=[{auctionId:24,owningSite:'cars',slug:'1960-failed-car',lotType:'car',listingStage:'sold'},
    {auctionId:25,owningSite:'cars',slug:'historical-number-plate',lotType:'plate'}];
  const f=ccHistoryFixture({historyDocuments:docs,ingestResult:()=>({status:'error',error:'native parser missing source fields'})});
  await f.request({force:true});
  assert.equal(f.targets.size,2);assert.equal(f.queued.size,1);assert.equal([...f.queued.values()][0].status,'failed');
  assert.equal(f.feed.search_criteria.history_pass,2);
  const attempted=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length;
  await f.request({force:true});
  assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,attempted);
});


test('historical held sources, malformed source pages and access refusals make no paid or canonical attempt',async()=>{
  for(const options of [{controls:{max_ingests:0}},{controls:{sources:{'collecting-cars':{enabled:false}}}},
    {historyHttp:403},{historyResponse:{results:[{found:1,hits:[]}]}},
    {historyResponse:{results:[{found:1,hits:[{document:{auctionId:1,owningSite:'watches',slug:'1960-wrong-site',lotType:'car'}}]}]}}]){
    const f=ccHistoryFixture(options);await f.request({force:true});
    assert.equal(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'),false);
    assert.equal(f.feed.search_criteria.history_after_id,0);assert.equal(f.snapshots.size,0);
  }
});

test('historical retained-page hash and source attribution are required before resume',async()=>{
  for(const patch of [{platform:'another-source'},{html:'tampered body'}]){
    const f=ccHistoryFixture();await f.request({force:true});
    const capture=f.feed.search_criteria.history_capture;
    Object.assign(f.snapshots.get(capture.id),patch);
    const before=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length;
    await f.request({force:true});
    assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,before);
    assert.equal(f.calls.filter(c=>c.path==='/multi_search').length,1);
    assert.equal(f.feed.search_criteria.history_after_id,0);
  }
});

async function ccPinnedFixture(options={}) {
  const url='https://collectingcars.com/for-sale/2017-porsche-911-991-2-carrera-s-2';
  const html=readFileSync(new URL('../supabase/functions/extract-collecting-cars/fixtures/lot-911.html',import.meta.url),'utf8');
  const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const hash=async text=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
  const originalClock='2020-01-01T00:00:00.000Z';
  const closed={id:uuid(501),listing_url:url,platform:'collectingcars',success:true,http_status:200,html,
    html_sha256:await hash(html),fetched_at:originalClock,created_at:originalClock,metadata:{},content_length:html.length};
  const openHtml=html.replaceAll('\\"stage\\":\\"unsold\\"','\\"stage\\":\\"live\\"');
  assert.notEqual(openHtml,html);
  const open={...closed,id:uuid(502),html:openHtml,html_sha256:await hash(openHtml),fetched_at:'2021-01-01T00:00:00.000Z',created_at:'2021-01-01T00:00:00.000Z'};
  const receipt={observation_id:uuid(601),snapshot_id:closed.id,source_read_at:originalClock,images:3};
  const owner={id:uuid(2),listing_url:url,year:2017,make:'Porsche',vin:'WP0ZZZ99ZHS000000',origin_metadata:{auction_id:'93268'}};
  const nativeObservations=[{id:receipt.observation_id,vehicle_id:owner.id,source_id:uuid(71),source_url:url,kind:'listing',
    extraction_method:'cc_native_listing_v1',is_superseded:false,raw_source_ref:`listing_page_snapshots:${closed.id}`,observed_at:originalClock}];
  const f=ccHistoryFixture({feed:{source_slug:'collecting-cars',feed_url:'https://collectingcars.com/search/',poll_interval_minutes:15,
      search_criteria:{fetch_strategy:'collecting_cars_history',history_version:1,history_ceiling_id:93268,history_after_id:0,history_capture:null,history_pass:1}},
    historyDocuments:[{auctionId:93268,slug:url.split('/').pop(),owningSite:'cars',listingStage:'sold',lotType:'car'}],
    knownUrls:[url],replayOwners:[owner],replaySnapshots:[open,closed],nativeObservations,
    ingestResult:()=>({status:'matched',vehicle_id:owner.id,collecting_cars_receipt:receipt}),...options});
  return {...f,url,html,closed,open,owner,receipt,hash};
}

test('history replay skips a newer open candidate then admits the older closed pin with its original source clock',async()=>{
  const f=await ccPinnedFixture();const result=await f.request({force:true});
  const posts=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST');
  assert.deepEqual(posts.map(c=>c.body),[{url:f.url,cc_snapshot:{snapshot_id:f.closed.id,expected_sha256:f.closed.html_sha256}}]);
  assert.equal(result.body.throttle.attempted,1);
  assert.equal(f.queued.get(f.url).status,'complete');
  assert.equal(f.queued.get(f.url).raw_data.collecting_cars_receipt.source_read_at,'2020-01-01T00:00:00.000Z');
  assert.equal(f.calls.filter(c=>c.path==='/multi_search').length,1);
  assert.equal(f.feed.search_criteria.history_pass,2);
});

test('history replay refusal retains a durable failed preflight without a paid or ingest attempt',async()=>{
  for(const kind of ['ambiguous','deleted','native-id','owner-year','hash','withdrawn']){
    const base=await ccPinnedFixture();let options={};
    if(kind==='ambiguous')options.replayOwners=[base.owner,{...base.owner,id:'00000000-0000-4000-8000-000000000003'}];
    if(kind==='deleted')options.replayOwners=[{...base.owner,deleted_at:'2022-01-01'}];
    if(kind==='native-id')options.replayOwners=[{...base.owner,origin_metadata:{}}], options.historyDocuments=[{auctionId:93267,slug:base.url.split('/').pop(),owningSite:'cars',listingStage:'sold',lotType:'car'}];
    if(kind==='owner-year')options.replayOwners=[{...base.owner,year:2016}];
    if(kind==='hash')options.replaySnapshots=[{...base.closed,html_sha256:'a'.repeat(64)}];
    if(kind==='withdrawn'){
      const html=base.html.replaceAll('\\"stage\\":\\"unsold\\"','\\"stage\\":\\"withdrawn\\"');
      options.replaySnapshots=[{...base.closed,html,html_sha256:await base.hash(html)}];
    }
    const f=await ccPinnedFixture(options);const result=await f.request({force:true});
    assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,0,kind);
    assert.equal(result.body.throttle.attempted,0,kind);
    assert.equal(f.queued.get(f.url).status,'failed',kind);
    assert.equal(f.feed.search_criteria.history_pass,2,kind);
    const outcome=result.body.results[0].ingest_outcomes[0];assert.equal(outcome.ingest_attempted,false,kind);
    assert.equal(result.body.results[0].retained_inventory.failed_or_backing_off,1,kind);
    await f.request({force:true});assert.equal(f.queued.get(f.url).attempts,1,kind);
  }
});

test('unknown replay write outcome never falls back to a fresh ingest or another pin',async()=>{
  const f=await ccPinnedFixture({ingestResult:()=>{throw Error('upstream timeout after potential write');}});
  await f.request({force:true});
  const posts=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST');
  assert.equal(posts.length,1);assert.ok(posts[0].body.cc_snapshot);assert.equal(f.queued.get(f.url).status,'failed');
});

test('protected Storage preflight carries the real request signal and unavailable reads defer without an attempt',async()=>{
  const base=await ccPinnedFixture();
  for(const unavailable of [false,true]){
    const f=await ccPinnedFixture({replaySnapshots:[{...base.closed,html:null,html_storage_path:'collectingcars/closed.html'}],
      replayStorageBody:base.html,replayStorageUnavailable:unavailable});
    const result=await f.request({force:true});
    assert.ok(f.calls.find(c=>c.path.startsWith('/storage/v1/object/'))?.signal);
    if(unavailable){assert.equal(result.body.throttle.attempted,0);assert.equal(f.queued.size,0);assert.equal(f.feed.search_criteria.history_pass,1);}
    else {assert.equal(result.body.throttle.attempted,1);assert.equal(f.queued.get(f.url).status,'complete');}
  }
});

test('missing replay capability defers retained candidates; absent owners use the existing fresh intake',async()=>{
  const held=await ccPinnedFixture({pinnedCapability:false});const response=await held.request({force:true});
  assert.equal(response.body.throttle.attempted,0);assert.equal(held.queued.size,0);assert.equal(held.feed.search_criteria.history_pass,1);
  const fresh=await ccPinnedFixture({replayOwners:[]});await fresh.request({force:true});
  assert.deepEqual(fresh.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body),[{url:fresh.url}]);
});

function ccSupplementFixture(overrides={}) {
  const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const urls=Array.from({length:125},(_,i)=>`https://collectingcars.com/for-sale/1960-sitemap-${i+1}`);
  const indexUrl='https://collectingcars.com/for-sale/1960-index-only';
  const clock=new Date(Date.now()-60000).toISOString();
  const receipts=new Map([...urls,indexUrl].map((url,i)=>[url,{observation_id:uuid(1000+i),snapshot_id:uuid(2000+i),source_read_at:clock,images:3}]));
  const nativeObservations=[...receipts].map(([url,r])=>({id:r.observation_id,vehicle_id:uuid(2),source_id:uuid(71),source_url:url,
    kind:'listing',extraction_method:'cc_native_listing_v1',is_superseded:false,raw_source_ref:`listing_page_snapshots:${r.snapshot_id}`,observed_at:r.source_read_at}));
  const xml=`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url=>`<url><loc>${url}</loc></url>`).join('')}</urlset>`;
  const feed={source_slug:'collecting-cars',feed_url:'https://collectingcars.com/search/',poll_interval_minutes:15,
    search_criteria:{fetch_strategy:'collecting_cars_history',history_version:1,history_ceiling_id:1,history_after_id:0,
      history_capture:null,history_pass:1,history_discovery_complete:false,history_supplement_version:1,history_phase:'targets'}};
  const f=fixture({feed,controls:{max_ingests:2},retainLedger:true,historyDocuments:[{auctionId:1,owningSite:'cars',slug:'1960-index-only',lotType:'car',listingStage:'sold'}],
    sitemapBodies:Object.fromEntries(Array.from({length:5},(_,i)=>[`/sitemap-listings-${i+1}.xml`,xml])),
    observationSource:{id:uuid(71),supported_observations:['listing']},nativeObservations,
    ingestResult:url=>({status:'created',vehicle_id:uuid(2),collecting_cars_receipt:receipts.get(url)}),...overrides});
  return {...f,urls,indexUrl,xml,receipts};
}

function retainedDiscoveryManifest(urls, extra={}) {
  return {version:1,origin_sha256:'a'.repeat(64),discovered_at:'2020-01-01T00:00:00Z',urls,...extra};
}

test('retained legacy discovery uses existing source owner, shares100slots and admits only via normal native intake',async()=>{
  const f=ccSupplementFixture(),urls=f.urls.slice(100,112);
  f.feed.search_criteria.history_retained_discovery=retainedDiscoveryManifest(urls);
  const first=await f.request({force:true});
  assert.equal(f.targets.size,100);assert.equal(f.feed.search_criteria.history_sitemap_offset,88);
  assert.match(f.feed.search_criteria.history_retained_discovery_ack,/^[a-f0-9]{64}$/);
  for(const url of urls) {
    const target=f.targets.get(url);
    assert.equal(target.source_slug,'collecting-cars');assert.equal(target.sitemap_file,`retained-discovery:sha256:${'a'.repeat(64)}`);
    assert.notEqual(target.last_seen_at,'2020-01-01T00:00:00Z');
  }
  const receipt=first.body.results[0].retained_inventory.retained_discovery;
  assert.equal(receipt.source_read_at,null);assert.equal(receipt.candidate_urls,12);assert.equal(receipt.discovery_slots_used,12);
  assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body),urls.slice(0,2).map(url=>({url})));
  const writes=()=>f.calls.filter(c=>c.path==='/rest/v1/source_targets'&&c.method==='POST'&&c.body.some(r=>r.sitemap_file?.startsWith('retained-discovery:')));
  assert.equal(writes().length,1);
  const second=await f.request({force:true});assert.equal(writes().length,1);
  assert.equal(second.body.results[0].retained_inventory.retained_discovery.discovery_slots_used,0);
  assert.equal(f.calls.filter(c=>c.path.startsWith('/sitemap-listings-')).length,1);
});

test('retained discovery preserves existing registry provenance and cannot overwrite a foreign source',async()=>{
  for(const source of ['collecting-cars','bat']) {
    const url='https://collectingcars.com/for-sale/1960-sitemap-101';
    const existing={id:1,listing_url:url,source_slug:source,sitemap_file:'prior-native-sitemap',last_seen_at:'2021-01-01T00:00:00Z'};
    const f=ccSupplementFixture({sourceTargets:[existing]});
    f.feed.search_criteria.history_retained_discovery=retainedDiscoveryManifest([url]);
    await f.request({force:true});assert.deepEqual(f.targets.get(url),existing);
    if(source==='bat') {
      assert.equal(f.feed.search_criteria.history_retained_discovery_ack,undefined);
      assert.equal(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'),false);
    }
  }
});

test('invalid retained manifests, source holds and unacknowledged writes never become discovered or ingested success',async()=>{
  const url='https://collectingcars.com/for-sale/1960-sitemap-101';
  for(const patch of [{version:2},{origin_sha256:'bad'},{discovered_at:'2999-01-01T00:00:00Z'},
    {urls:[]},{urls:[url,url]},{urls:[url+'/']},{urls:['https://foreign.invalid/for-sale/a']},
    {urls:Array.from({length:21},(_,i)=>url+i)},{auctionId:1}]) {
    const f=ccSupplementFixture();f.feed.search_criteria.history_retained_discovery=retainedDiscoveryManifest([url],patch);
    await f.request({force:true});assert.equal(f.targets.size,0);
    assert.equal(f.feed.search_criteria.history_retained_discovery_ack,undefined);
    assert.equal(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'),false);
  }
  for(const options of [{controls:{enabled:false,max_ingests:2}},{targetWriteFailure:true},{historyCheckpointFailure:true}]) {
    const f=ccSupplementFixture(options);f.feed.search_criteria.history_retained_discovery=retainedDiscoveryManifest([url]);
    await f.request({force:true});assert.equal(f.feed.search_criteria.history_retained_discovery_ack,undefined);
    assert.equal(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'),false);
  }
});

test('history supplement retains raw sitemap before bounded discoveries and resumes a fixed target page under cap',async()=>{
  const f=ccSupplementFixture();
  const first=await f.request({force:true});assert.equal(first.status,200);
  assert.equal(f.targets.size,100);assert.equal(f.feed.search_criteria.history_sitemap_offset,100);
  assert.equal(f.feed.search_criteria.history_targets_page.rows.length,20);
  const pageIds=f.feed.search_criteria.history_targets_page.rows.map(r=>r.id);
  const capture=f.feed.search_criteria.history_sitemap_capture;
  assert.equal(f.snapshots.get(capture.id).html,f.xml);
  assert.equal(f.snapshots.get(capture.id).platform,'collecting-cars-history-sitemap');
  const retainedAt=f.calls.findIndex(c=>c.path==='/rest/v1/listing_page_snapshots'&&c.method==='POST');
  const discoveredAt=f.calls.findIndex(c=>c.path==='/rest/v1/source_targets'&&c.method==='POST');assert.ok(retainedAt<discoveredAt);
  assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body),f.urls.slice(0,2).map(url=>({url})));
  await f.request({force:true});assert.equal(f.targets.size,125);
  assert.deepEqual(f.feed.search_criteria.history_targets_page.rows.map(r=>r.id),pageIds);
  assert.equal(f.calls.filter(c=>c.path==='/sitemap-listings-1.xml').length,1);
  for(let i=0;i<8;i++)await f.request({force:true});
  assert.equal(f.feed.search_criteria.history_targets_after_id,20);assert.equal(f.feed.search_criteria.history_phase,'index');
  assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,20);
  await f.request({force:true});assert.equal(f.feed.search_criteria.history_phase,'targets');
  assert.ok(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'&&c.body.url===f.indexUrl));
  assert.equal(f.feed.search_criteria.history_discovery_complete,true); // Index traversal only; 105 targets still not admitted.
  assert.equal(f.queued.size,21);
});

test('history supplement retries a due native failure absent current index before new targets with one slot',async()=>{
  const f=ccSupplementFixture({controls:{max_ingests:1}}),url=f.urls[90];
  f.queued.set(url,{listing_url:url,status:'failed',attempts:1,max_attempts:3,next_attempt_at:new Date(Date.now()-3600000).toISOString(),
    created_at:new Date(Date.now()-86400000).toISOString(),raw_data:{collecting_cars_native_version:'cc_native_listing_v1'},error_message:'capture validation failed'});
  await f.request({force:true});
  assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body),[{url}]);
  assert.equal(f.queued.get(url).status,'complete');assert.equal(f.feed.search_criteria.history_targets_after_id??0,0);
  const retryRead=f.calls.find(c=>c.path==='/rest/v1/import_queue'&&new URLSearchParams(c.query).get('status')==='eq.failed');
  assert.equal(new URLSearchParams(retryRead.query).get('limit'),'20');
});

test('supplement does not revive final/backoff/custody-refused retries or bypass a target custody refusal',async()=>{
  const f=ccSupplementFixture({controls:{max_ingests:1}});
  for(const [i,kind] of ['final','future','custody'].entries()) {
    const url=f.urls[90+i];f.queued.set(url,{listing_url:url,status:'failed',attempts:kind==='final'?3:1,max_attempts:3,
      next_attempt_at:new Date(Date.now()+(kind==='future'?3600000:-3600000)).toISOString(),created_at:new Date(Date.now()-86400000).toISOString(),
      raw_data:{collecting_cars_native_version:'cc_native_listing_v1'},error_message:kind==='custody'?'cc_replay_preflight: cc_snapshot_hash_refused':'capture failure'});
  }
  const refused=f.urls[0];f.queued.set(refused,{listing_url:refused,status:'failed',attempts:1,max_attempts:3,next_attempt_at:new Date(Date.now()-1000).toISOString(),created_at:new Date(Date.now()-86400000).toISOString(),
    raw_data:{collecting_cars_native_version:'cc_native_listing_v1'},error_message:'cc_replay_preflight: cc_snapshot_hash_refused'});
  await f.request({force:true});
  const invoked=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body.url);
  assert.deepEqual(invoked,[]);assert.equal(f.queued.get(refused).status,'failed');assert.equal(f.queued.get(refused).attempts,2);
  await f.request({force:true});
  assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body.url),[f.urls[1]]);
  for(const url of f.urls.slice(90,93))assert.equal(invoked.includes(url),false);
});

test('supplement retention, source ownership, and checkpoint failures cannot advance into intake',async()=>{
  for(const options of [{historyRetentionFailure:true},{targetWriteFailure:true},{historyCheckpointFailure:true},
    {sourceTargets:[{id:1,source_slug:'bat',listing_url:'https://collectingcars.com/for-sale/1960-sitemap-1'}]}]) {
    const f=ccSupplementFixture(options);await f.request({force:true});
    assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,0);
    assert.equal(f.feed.search_criteria.history_sitemap_offset??0,0);assert.equal(f.feed.search_criteria.history_targets_after_id??0,0);
  }
});

test('supplement refuses foreign sitemap locations, unknown format, and protected source responses without fallback',async()=>{
  for(const options of [{sitemapHttp:403},...['<html>blocked</html>', '<urlset><url><loc>https://foreign.invalid/for-sale/1960-car</loc></url></urlset>',
    '<!DOCTYPE urlset><urlset><url><loc>https://collectingcars.com/for-sale/1960-car</loc></url></urlset>'].map(xml=>({sitemapBodies:{'/sitemap-listings-1.xml':xml}}))]) {
    const f=ccSupplementFixture(options);await f.request({force:true});
    assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,0);assert.equal(f.targets.size,0);
    assert.equal(f.calls.filter(c=>c.path==='/sitemap-listings-1.xml').length,1);
  }
});


test('publisher timestamp-suffix routes remain discovery-only and do not poison the supported sitemap siblings',async()=>{
  const alias='https://collectingcars.com/for-sale/1967-ford-mustang-gt-fastback-ts=2024-10-14:15:32:41';
  const regular='https://collectingcars.com/for-sale/1960-sitemap-1';
  const xml=`<urlset><url><loc>${alias}</loc></url><url><loc>${regular}</loc></url></urlset>`;
  const f=ccSupplementFixture({sitemapBodies:{'/sitemap-listings-1.xml':xml}});
  const run=await f.request({force:true});
  assert.equal(f.targets.size,2);assert.equal(f.targets.has(alias),true);
  assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body),[{url:regular}]);
  const receipt=run.body.results[0].retained_inventory;
  assert.equal(receipt.unsupported_route_unresolved,1);assert.equal(receipt.page_advanced,true);
  assert.equal(f.queued.has(alias),false);
});


test('supplement source hold prevents even sitemap discovery and oversized bodies never reach retention',async()=>{
  const held=ccSupplementFixture({controls:{enabled:false,max_ingests:2}});await held.request({force:true});
  assert.equal(held.calls.some(c=>c.path.startsWith('/sitemap-listings-')),false);
  assert.equal(held.targets.size,0);
  const large=ccSupplementFixture({sitemapBodies:{'/sitemap-listings-1.xml':'<urlset>'+ ' '.repeat(2_097_153) +'</urlset>'}});
  await large.request({force:true});
  assert.equal(large.snapshots.size,0);assert.equal(large.targets.size,0);
  assert.equal(large.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'),false);
});

test('supplement resumed sitemap hash and retained target ownership are checked before any additional intake',async()=>{
  for(const tamper of ['capture','target']) {
    const f=ccSupplementFixture();await f.request({force:true});
    const attempts=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length;
    const sitemapOffset=f.feed.search_criteria.history_sitemap_offset;
    if(tamper==='capture')f.snapshots.get(f.feed.search_criteria.history_sitemap_capture.id).html+='changed';
    else f.targets.get(f.urls[19]).source_slug='bat';
    await f.request({force:true});
    assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,attempts);
    assert.equal(f.feed.search_criteria.history_targets_after_id??0,0);
    assert.equal(f.calls.filter(c=>c.path==='/sitemap-listings-1.xml').length,1);
    if(tamper==='capture')assert.equal(f.feed.search_criteria.history_sitemap_offset,sitemapOffset);
  }
});

test('supplement cannot advance an intake page on an unacknowledged canonical ledger write',async()=>{
  const f=ccSupplementFixture({missingLedgerReceipt:true,controls:{max_ingests:20}});
  await f.request({force:true});
  assert.equal(f.feed.search_criteria.history_targets_after_id??0,0);
  assert.equal(f.feed.search_criteria.history_targets_page.rows.length,20);
  assert.equal(f.feed.search_criteria.history_phase,'targets');
});


test('due retry scan reaches the 21st eligible failure after twenty final or custody-refused rows without increasing its bound',async()=>{
  const f=ccSupplementFixture({controls:{max_ingests:1}}),at=new Date(Date.now()-3600000).toISOString(),created=new Date(Date.now()-86400000).toISOString();
  for(let i=0;i<20;i++)f.queued.set(`https://collectingcars.com/for-sale/1900-held-${String(i).padStart(2,'0')}`,{
    listing_url:`https://collectingcars.com/for-sale/1900-held-${String(i).padStart(2,'0')}`,status:'failed',attempts:i%2?1:3,max_attempts:3,
    next_attempt_at:at,created_at:created,raw_data:{collecting_cars_native_version:'cc_native_listing_v1'},
    error_message:i%2?'cc_replay_preflight: cc_snapshot_hash_refused':'failed'});
  const eligible=f.urls[99];f.queued.set(eligible,{listing_url:eligible,status:'failed',attempts:1,max_attempts:3,next_attempt_at:at,created_at:created,
    raw_data:{collecting_cars_native_version:'cc_native_listing_v1'},error_message:'extract_failed'});
  await f.request({force:true});assert.ok(f.feed.search_criteria.history_retry_scan_after);
  assert.equal(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'&&c.body.url===eligible),false);
  await f.request({force:true});assert.equal(f.queued.get(eligible).status,'complete');
  const retryReads=f.calls.filter(c=>c.path==='/rest/v1/import_queue'&&new URLSearchParams(c.query).get('status')==='eq.failed');
  assert.equal(retryReads.length,2);assert.ok(retryReads.every(c=>new URLSearchParams(c.query).get('limit')==='20'));
  assert.ok(new URLSearchParams(retryReads[1].query).has('or'));
});


test('history finish uses a fresh checkpoint deadline after slow ingestion expires the preparation transport',async()=>{
  for(const phase of ['index','targets']) {
    const f=ccSupplementFixture({controls:{max_ingests:1},enforcePreparationDeadline:true,nowMs:Date.now(),timing:{ingestMs:20000}});
    // Use a single target/index candidate so one successful admission drains its page.
    const only=f.urls[0];
    f.feed.search_criteria.history_phase=phase;
    if(phase==='targets')f.feed.search_criteria.history_targets_page={after_id:0,read_at:'2020-01-01T00:00:00Z',rows:[{id:1,source_slug:'collecting-cars',listing_url:only}]};
    const run=await f.request({force:true});
    assert.equal(run.status,200);
    assert.equal(f.feed.search_criteria.history_phase,phase==='index'?'targets':'index');
    assert.equal(f.queued.get(phase==='index'?f.indexUrl:only).status,'complete');
    const patches=f.calls.filter(c=>c.path==='/rest/v1/listing_feeds'&&c.method==='PATCH'&&c.body.search_criteria);
    assert.ok(patches.length>0);assert.equal(patches.at(-1).signal.aborted,false);
    const preparation=f.calls.find(c=>c.path==='/rest/v1/listing_page_snapshots'&&c.method==='POST');
    assert.equal(preparation.signal.aborted,true);
  }
});

test('expired sitemap preparation cannot checkpoint or advance into intake',async()=>{
  const f=ccSupplementFixture({enforcePreparationDeadline:true,timing:{sitemapMs:16000}});
  await f.request({force:true});
  assert.equal(f.calls.some(c=>c.path==='/functions/v1/ingest'&&c.method==='POST'),false);
  assert.equal(f.feed.search_criteria.history_sitemap_capture,undefined);
  assert.equal(f.feed.search_criteria.history_targets_page,undefined);
});


test('unavailable or four-second-stalled sitemap acquisition does not block independently retained target or index intake',async()=>{
  for(const scenario of ['target403','index403','targetTimeout']) {
    const url='https://collectingcars.com/for-sale/1960-sitemap-1';
    const f=ccSupplementFixture({controls:{max_ingests:1},sourceTargets:[{id:1,source_slug:'collecting-cars',listing_url:url}],
      ...(scenario==='targetTimeout'?{enforcePreparationDeadline:true,nowMs:Date.now(),timing:{sitemapMs:4100}}:{sitemapHttp:403})});
    if(scenario==='index403')f.feed.search_criteria.history_phase='index';
    const run=await f.request({force:true});assert.equal(run.status,200);
    const expected=scenario==='index403'?f.indexUrl:url;
    assert.deepEqual(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').map(c=>c.body),[{url:expected}]);
    assert.equal(f.queued.get(expected).status,'complete');
    assert.equal(f.feed.search_criteria.history_sitemap_capture,undefined);assert.equal(f.feed.search_criteria.history_sitemap_offset??0,0);
    assert.equal([...f.snapshots.values()].some(row=>row.platform==='collecting-cars-history-sitemap'),false);
    const discovery=run.body.results[0].retained_inventory.sitemap_discovery;
    assert.equal(discovery.status,'unavailable');assert.equal(discovery.source_read_at,null);assert.equal(discovery.retained_file_urls,null);
    assert.equal(f.calls.filter(c=>c.path==='/sitemap-listings-1.xml').length,1);
  }
});


test('history resumes the same retained page when PostgreSQL normalizes its UTC clock spelling',async()=>{
  const f=ccHistoryFixture({postgresTimestampOffsets:true});await f.request({force:true});
  const capture=f.feed.search_criteria.history_capture,raw=f.snapshots.get(capture.id).html;
  assert.ok(capture.read_at.endsWith('+00:00'));assert.ok(JSON.parse(raw).read_at.endsWith('Z'));
  assert.equal(Date.parse(capture.read_at),Date.parse(JSON.parse(raw).read_at));
  const before=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length;
  await f.request({force:true});
  assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,before+2);
  assert.equal(f.calls.filter(c=>c.path==='/multi_search').length,1);assert.equal(f.snapshots.size,1);
  assert.equal(f.snapshots.get(capture.id).html,raw);assert.equal(f.feed.search_criteria.history_capture.id,capture.id);
});

test('equivalent clock spelling never permits changed source time, query, malformed clocks or mismatched raw hashes',async()=>{
  for(const kind of ['shifted','invalid','query','hash']) {
    const f=ccHistoryFixture({postgresTimestampOffsets:true});await f.request({force:true});
    const capture=f.feed.search_criteria.history_capture,row=f.snapshots.get(capture.id),envelope=JSON.parse(row.html);
    if(kind==='shifted')envelope.read_at=new Date(Date.parse(envelope.read_at)+1).toISOString();
    if(kind==='invalid')envelope.read_at='not-a-source-clock';
    if(kind==='query')envelope.search.q='another-query';
    row.html=kind==='hash'?row.html+'tampered':JSON.stringify(envelope);
    if(kind!=='hash') {
      const sha=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(row.html))).toString('hex');
      row.html_sha256=sha;capture.sha256=sha;
    }
    const before=f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length;
    await f.request({force:true});
    assert.equal(f.calls.filter(c=>c.path==='/functions/v1/ingest'&&c.method==='POST').length,before,kind);
    assert.equal(f.calls.filter(c=>c.path==='/multi_search').length,1,kind);
    assert.equal(f.feed.search_criteria.history_after_id,0,kind);assert.equal(f.feed.search_criteria.history_capture.id,capture.id,kind);
  }
});
