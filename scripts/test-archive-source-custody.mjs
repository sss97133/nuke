// Actual shared archive/parser code and installed Supabase SDK; synthetic HTTP only.
// NODE_PATH=nuke_frontend/node_modules node --test scripts/test-archive-source-custody.mjs
import assert from 'node:assert/strict';
import { createHash, createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const vehicleId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000002';
const sourceUrl = 'https://bringatrailer.com/listing/synthetic-one/';
const html = 'Sold for <strong>USD $12,345</strong> <span>on 6/15/25';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parent = { id: vehicleId, is_public: true, deleted_at: null, listing_kind: null,
  origin_metadata: { bat_snapshot_parsed: { snapshot_id: snapshotId } } };
const fact = { vehicle_id: vehicleId, price_kind: 'sold', sold_basis: 'status', outcome: 'sold',
  sold_amount: 12345, sold_on: '2025-06-15', source_url: sourceUrl };
const snapshot = { id: snapshotId, platform: 'bat', listing_url: sourceUrl, success: true, http_status: 200,
  html: null, html_storage_path: 'bat/synthetic-one.html', html_sha256: digest(html),
  fetched_at: '2025-06-16T00:00:00Z', created_at: '2025-06-16T06:00:00Z',
  metadata: { vehicle_id: vehicleId, vehicle_matched: true, parsed_at: '2025-06-16T12:00:00Z' } };

function compile(path) {
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0,0,`${path} transpiles`);
  return outputText;
}
const sources = new Map([
  ['archive',compile('../supabase/functions/_shared/archiveFetch.ts')],
  ['parser',compile('../supabase/functions/_shared/batParser.ts')],
  ['handler',compile('../supabase/functions/batch-extract-snapshots/index.ts')],
  ['guard',compile('../supabase/functions/_shared/writeGuard.ts')],
]);

function fixture(options = {}) {
  const requests = [], writes = [];
  const actualSnapshot = { ...snapshot, ...(options.snapshot ?? {}) };
  const actualParent = { ...parent, ...(options.parent ?? {}) };
  const bytes = options.bytes ?? Buffer.from(html);
  async function http(raw,init) {
    const request = raw instanceof Request ? raw : new Request(raw,init);
    const u = new URL(request.url);requests.push({method:request.method,path:u.pathname,query:Object.fromEntries(u.searchParams)});
    if(u.pathname==='/rest/v1/rpc/vehicle_price_facts') {
      assert.deepEqual(await request.json(),{p_vehicle_ids:[vehicleId]});
      return Response.json([{...fact,...(options.fact??{})}]);
    }
    if(u.pathname==='/rest/v1/vehicles') {
      assert.equal(request.method,'GET');
      if(u.searchParams.get('id')?.startsWith('in.')) {
        assert.equal(u.searchParams.get('is_public'),'eq.true');assert.equal(u.searchParams.get('deleted_at'),'is.null');
        assert(u.searchParams.get('or')?.includes('listing_kind.is.null'));
        return Response.json(options.parentMissing||!actualParent.is_public||actualParent.deleted_at||actualParent.listing_kind==='non_vehicle_item'?[]:[actualParent]);
      }
      assert.equal(u.searchParams.get('id'),`eq.${vehicleId}`);
      return Response.json(options.parentMissing ? null : actualParent);
    }
    if(u.pathname==='/rest/v1/listing_page_snapshots') {
      assert.equal(u.searchParams.get('id'),`eq.${snapshotId}`,'Exact capture, no URL/latest');
      assert(!u.searchParams.has('order'));
      if(request.method==='PATCH') {
        assert(options.allowQualificationWrite,'Only explicit qualification fixture allows metadata PATCH');
        const body=await request.json();assert.deepEqual(Object.keys(body),['metadata']);
        assert.deepEqual(JSON.parse(u.searchParams.get('metadata').slice(3)),actualSnapshot.metadata,'Whole protected metadata compare-and-set');
        assert.equal(u.searchParams.get('html_sha256'),`eq.${snapshot.html_sha256}`);
        assert.equal(u.searchParams.get('created_at'),`eq.${snapshot.created_at}`);
        if(options.concurrentMetadata){actualSnapshot.metadata={...actualSnapshot.metadata,concurrent_note:'preserve'};return Response.json([]);}
        writes.push(body);actualSnapshot.metadata=body.metadata;return Response.json([{id:snapshotId}]);
      }
      assert.equal(request.method,'GET');
      return Response.json(options.snapshotMissing ? null : actualSnapshot);
    }
    if(u.pathname.startsWith('/storage/v1/object/')) {
      assert.equal(request.method,'GET');
      assert(u.pathname.endsWith('/listing-snapshots/'+actualSnapshot.html_storage_path));
      return new Response(options.storageMissing ? null : bytes,{status:options.storageMissing?404:200});
    }
    assert.fail(`Unexpected HTTP path ${u.pathname}`);
  }
  const supabase=createClient('https://fixture.invalid','svc-test',{global:{fetch:http},auth:{persistSession:false,autoRefreshToken:false}});
  const modules=new Map();
  let handler;
  const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'svc-test',SUPABASE_JWT_SECRET:'test-jwt'};
  function load(name) {
    if(modules.has(name))return modules.get(name);
    const exports={};modules.set(name,exports);
    runInNewContext(sources.get(name),{exports,URL,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,Date,crypto:webcrypto,AbortSignal,atob,btoa,fetch:http,
      console:{log(){},warn(){},error(){}},Deno:{env:{get:key=>env[key]},serve:callback=>{handler=callback;}},
      require:specifier=>{
        if(specifier.startsWith('https://esm.sh/@supabase/supabase-js@'))return {createClient:()=>supabase};
        if(specifier==='./batFetcher.ts')return {fetchBatPage:()=>assert.fail('No crawl'),logFetchCost:()=>assert.fail('No paid fetch'),isLoginPage:()=>false};
        if(specifier==='./hybridFetcher.ts')return {fetchPage:()=>assert.fail('No crawl')};
        if(specifier==='./firecrawl.ts')return {firecrawlScrape:()=>assert.fail('No paid fetch')};
        if(specifier==='./batParser.ts')return load('parser');
        if(specifier==='../_shared/archiveFetch.ts')return load('archive');
        if(specifier==='../_shared/batParser.ts')return load('parser');
        if(specifier==='../_shared/writeGuard.ts')return load('guard');
        if(specifier==='./apiKeyAuth.ts')return {hashApiKey:()=>assert.fail('No API-key route')};
        if(specifier==='../_shared/agentTiers.ts')return {callTier:()=>assert.fail('No paid inference'),parseJsonResponse:()=>assert.fail('No inference')};
        if(specifier==='../_shared/observationWriter.ts')return {writeObservation:()=>assert.fail('No testimony write')};
        assert.fail(`Unexpected import ${specifier}`);
      }});
    return exports;
  }
  return {requests,writes,snapshot:actualSnapshot,parser:load('parser'),
    read:(extra={})=>load('archive').readPinnedArchivedPage({snapshotId,vehicleId,sourceUrl,...extra},{supabase,now:()=>new Date('2026-01-03T00:00:00Z')}),
    attach:(capture,receipt)=>load('archive').attachPinnedArchivedSaleQualification(capture,receipt,{supabase}),
    run:async(body={},token='svc-test')=>{
      load('handler');const response=await handler(new Request('https://fixture.invalid/batch-extract-snapshots',{method:'POST',
        headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
        body:JSON.stringify({mode:'source_sale_qualification',vehicle_ids:[vehicleId],...body})}));
      return {status:response.status,body:await response.json()};
    }};
}

test('pinned private object verifies original bytes and returns separate capture/ingest/parse clocks',async()=>{
  const f=fixture(),r=await f.read();assert.equal(r.ok,true);assert.equal(r.html,html);
  assert.equal(r.snapshot.bodySource,'protected_storage');assert.equal(r.snapshot.sourceSha256,digest(html));
  assert.equal(r.snapshot.ingestedAt,snapshot.created_at);assert.equal(r.snapshot.knownAt,'2025-06-16T12:00:00.000Z');
  assert.equal(f.requests.length,3);assert.equal(f.parser.parseQualifiedBaTSale(r.html).ok,true);
});
test('inline source verification avoids storage and never falls back after hash mismatch',async()=>{
  const f=fixture({snapshot:{html}});assert.equal((await f.read()).snapshot.bodySource,'inline');assert.equal(f.requests.length,2);
  const bad=fixture({snapshot:{html:html+' altered'}});assert.equal((await bad.read()).reason,'source_hash_conflict');assert.equal(bad.requests.length,2);
});
for(const [label,patch] of Object.entries({private:{is_public:false},deleted:{deleted_at:'2025-07-01T00:00:00Z'},nonvehicle:{listing_kind:'non_vehicle_item'}})){
  test(`${label} parent refuses before any raw snapshot or storage access`,async()=>{
    const f=fixture({parent:patch});assert.equal((await f.read()).reason,'parent_not_public_real_vehicle');assert.equal(f.requests.length,1);
  });
}
for(const [label,patch] of Object.entries({wrong_vehicle:{metadata:{...snapshot.metadata,vehicle_id:'00000000-0000-4000-8000-000000000003'}},unmatched:{metadata:{...snapshot.metadata,vehicle_matched:false}},wrong_source:{listing_url:'https://bringatrailer.com/listing/other/'},wrong_platform:{platform:'other'},failed:{success:false},bad_status:{http_status:403}})){
  test(`${label} capture refuses before private object access`,async()=>{
    const f=fixture({snapshot:patch});assert.equal((await f.read()).reason,'snapshot_attribution_conflict');assert.equal(f.requests.length,2);
  });
}
test('late row ingestion and invalid parse clocks cannot borrow an earlier capture clock',async()=>{
  const f=fixture({snapshot:{created_at:'2026-01-02T00:00:00Z'}});
  assert.equal((await f.read({evidenceAsOf:'2026-01-01T00:00:00Z'})).reason,'learned_later');assert.equal(f.requests.length,2);
  const r=await f.read();assert.equal(r.snapshot.knownAt,'2026-01-02T00:00:00.000Z');
  for(const parsed_at of ['2025-06-16 12:00:00','2025-02-30T12:00:00Z'])assert.equal((await fixture({snapshot:{metadata:{...snapshot.metadata,parsed_at}}}).read()).reason,'source_clock_unknown');
  assert.equal((await fixture().read({evidenceAsOf:'2026-01-01 00:00:00'})).reason,'invalid_knowledge_cutoff');
});
test('explicitly zoned SQL producer timestamp is accepted',async()=>{
  assert.equal((await fixture({snapshot:{metadata:{...snapshot.metadata,parsed_at:'2025-06-16 12:00:00.123424+00'}}}).read()).ok,true);
});
test('submillisecond ingestion remains distinct from an earlier knowledge cutoff',async()=>{
  const f=fixture({snapshot:{created_at:'2026-01-02T00:00:00.000001Z'}});
  assert.equal((await f.read({evidenceAsOf:'2026-01-02T00:00:00.000000Z'})).reason,'learned_later');
  assert.equal((await f.read()).snapshot.sourceKnownAt,'2026-01-02T00:00:00.000001Z');
});
test('parse cannot precede capture within the same millisecond',async()=>{
  const f=fixture({snapshot:{fetched_at:'2025-06-16T12:00:00.000002Z',
    metadata:{...snapshot.metadata,parsed_at:'2025-06-16T12:00:00.000001Z'}}});
  assert.equal((await f.read()).reason,'source_clock_conflict');assert.equal(f.requests.length,2);
});
test('missing/corrupt/oversize/invalid-UTF8 objects remain explicit unknowns',async()=>{
  assert.equal((await fixture({storageMissing:true}).read()).reason,'storage_body_unavailable');
  assert.equal((await fixture({bytes:Buffer.from(html+' corrupt')}).read()).reason,'source_hash_conflict');
  assert.equal((await fixture({bytes:Buffer.alloc(2097153)}).read()).reason,'source_body_over_limit');
  const invalid=Buffer.from([0xff,0xfe]);assert.equal((await fixture({bytes:invalid,snapshot:{html_sha256:digest(invalid)}}).read()).reason,'source_encoding_unknown');
  const traversal=fixture({snapshot:{html_storage_path:'../other/secret'}});assert.equal((await traversal.read()).reason,'storage_locator_unknown');assert.equal(traversal.requests.length,2);
});
test('strict sale tuple refuses unsupported units, malformed amounts/dates, ambiguity and bid-to',()=>{
  const parser=fixture().parser;
  for(const sample of [html.replace('USD','UNKNOWN'),html.replace('12,345','12,34'),html.replace('6/15/25','2/30/25'),html+' Bid to <strong>USD $1,234</strong> <span>on 6/15/25',html.replace('Sold for','Bid to')])assert.equal(parser.parseQualifiedBaTSale(sample).ok,false);
  for(const currency of ['USD','EUR','GBP']){const r=parser.parseQualifiedBaTSale(html.replace('USD',currency));assert.equal(r.ok,true);assert.equal(r.currency,currency);assert.equal(r.eventDay,'2025-06-15');}
});
for(const sample of JSON.parse(readFileSync(new URL('./discovery/bat-sale-parser-fixtures.json',import.meta.url),'utf8'))){
  test(`shared SQL/parser fixture: ${sample.name}`,()=>{
    const result=fixture().parser.parseQualifiedBaTSale(sample.html);assert.equal(result.ok,sample.eligible);
    if(result.ok){assert.equal(result.currency,sample.canonical.currency);assert.equal(result.amount,sample.canonical.price);}
  });
}

test('canonical service preview defaults to no writes or inference and ignores forged caller values',async()=>{
  const f=fixture(),r=await f.run({amount:1,currency:'GBP',html:'forged raw',source_url:'https://other.invalid'});
  assert.equal(r.status,200);assert.equal(r.body.dry_run,true);assert.equal(r.body.qualified,1);assert.equal(f.writes.length,0);
  const receipt=r.body.results[0].receipt;assert.equal(receipt.amount,12345);assert.equal(receipt.currency,'USD');
  assert.equal(receipt.verification_basis,'producer_attested_archived_hash_parser');assert.equal(receipt.source_ingested_at,snapshot.created_at);
  assert(Date.parse(receipt.knowledge_at)>=Date.parse(receipt.qualified_at));assert.equal(receipt.original_parsed_at,snapshot.metadata.parsed_at);
  assert(!JSON.stringify(r.body).includes('html_storage_path'));assert(!JSON.stringify(r.body).includes(html));
});
test('anonymous and signed-in user cannot become protected qualification writers',async()=>{
  const noAuth=fixture();assert.equal((await noAuth.run({},null)).status,401);assert.equal(noAuth.requests.length,0);
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({role:'authenticated',sub:vehicleId,exp:4102444800})).toString('base64url');
  const signing=`${header}.${payload}`,token=signing+'.'+createHmac('sha256','test-jwt').update(signing).digest('base64url');
  const user=fixture();assert.equal((await user.run({},token)).status,403);assert.equal(user.requests.length,0);
});
test('qualification source disagreement, private parents and invalid batch boundary do not mutate',async()=>{
  for(const patch of [{sold_amount:20000},{sold_on:'2025-06-14'}]){
    const f=fixture({fact:patch}),r=await f.run({dry_run:false});assert.equal(r.body.results[0].reason,'source_sale_conflict');assert.equal(f.writes.length,0);
  }
  const privateParent=fixture({parent:{is_public:false}});const privateResult=await privateParent.run({dry_run:false});
  assert.equal(privateResult.body.results[0].reason,'parent_not_public_real_vehicle');assert.equal(privateParent.requests.length,1);
  for(const body of [{vehicle_ids:[]},{vehicle_ids:Array(21).fill(vehicleId)},{force:true},{use_queue:true},{platform:'other'}])assert.equal((await fixture().run(body)).status,400);
});
test('productive qualification only adds protected receipt with atomic metadata/hash/clock custody guards',async()=>{
  const f=fixture({allowQualificationWrite:true});const first=await f.run({dry_run:false});
  assert.equal(first.body.results[0].status,'stored');assert.equal(f.writes.length,1);
  assert.equal(f.snapshot.metadata.parsed_at,snapshot.metadata.parsed_at);assert.equal(f.snapshot.metadata.vehicle_id,vehicleId);
  const receipt=f.snapshot.metadata.source_sale_qualification_v1;
  const duplicate=await f.run({dry_run:false});assert.equal(duplicate.body.results[0].reason,'existing_qualification_preserved');
  assert.equal(f.writes.length,1);assert.equal(f.snapshot.metadata.source_sale_qualification_v1,receipt);
});
test('concurrent protected metadata change refuses rather than overwriting the winning update',async()=>{
  const f=fixture({allowQualificationWrite:true,concurrentMetadata:true});const r=await f.run({dry_run:false});
  assert.equal(r.body.results[0].reason,'capture_changed_or_already_qualified');assert.equal(f.writes.length,0);
  assert.equal(f.snapshot.metadata.concurrent_note,'preserve');assert(!f.snapshot.metadata.source_sale_qualification_v1);
});
test('registered archive owner refuses a forged tuple or backdated/future qualification clock',async()=>{
  const f=fixture(),capture=await f.read(),preview=await f.run(),receipt=preview.body.results[0].receipt;
  assert.equal((await f.attach(capture,{...receipt,currency:'GBP'})).reason,'qualification_attribution_conflict');
  assert.equal((await f.attach(capture,{...receipt,qualified_at:'2025-06-15T00:00:00.000Z'})).reason,'qualification_clock_conflict');
  assert.equal((await f.attach(capture,{...receipt,qualified_at:'2999-01-01T00:00:00.000Z'})).reason,'qualification_clock_conflict');
  assert.equal(f.writes.length,0);assert(!f.requests.some(r=>r.method==='PATCH'));
});
test('qualification cannot precede source knowledge within the same millisecond',async()=>{
  const f=fixture({snapshot:{created_at:'2025-06-16T12:00:00.000001Z'}});
  const capture=await f.read(),preview=await f.run(),receipt=preview.body.results[0].receipt;
  const earlier='2025-06-16T12:00:00.000Z';
  assert.equal((await f.attach(capture,{...receipt,qualified_at:earlier,knowledge_at:earlier})).reason,'qualification_clock_conflict');
  assert.equal(f.writes.length,0);assert(!f.requests.some(r=>r.method==='PATCH'));
});
