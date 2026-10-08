// Actual shared archive/parser code and installed Supabase SDK; synthetic HTTP only.
// NODE_PATH=nuke_frontend/node_modules node --test scripts/test-archive-source-custody.mjs
import assert from 'node:assert/strict';
import { createHash, createHmac, webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
const eventId='00000000-0000-4000-8000-000000000005';
const episode={id:eventId,vehicle_id:vehicleId,source_platform:'bat',source_url:sourceUrl,source_listing_id:'opaque-lot-123',
  event_type:'auction',event_status:'sold',final_price:12345,sold_at:'2025-06-15T00:00:00.000000+00:00',ended_at:null,
  created_at:'2025-06-16T00:00:00.123456Z',updated_at:'2025-06-16T00:00:00.234567Z',extracted_at:'2025-06-16T00:00:00.345678Z'};
const jsonb = value => Array.isArray(value) ? value.map(jsonb)
  : value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,jsonb(value[k])])):value;

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
  ['chassis',compile('../supabase/functions/_shared/batChassis.ts')],
  ['handler',compile('../supabase/functions/batch-extract-snapshots/index.ts')],
  ['batSaleQueue',compile('../supabase/functions/batch-extract-snapshots/batSaleQueue.ts')],
  ['intake',compile('../supabase/functions/ingest-observation/index.ts')],
  ['liveIntake',compile('../supabase/functions/ingest-observation/batLive.ts')],
  ['liveEvents',compile('../supabase/functions/_shared/batLiveEvents.ts')],
  ['auctionRecord',compile('../supabase/functions/_shared/batAuctionRecord.ts')],
  ['property',compile('../supabase/functions/ingest-observation/imageProperties.ts')],
  ['retainedInterior',compile('../supabase/functions/ingest-observation/retainedInterior.ts')],
  ['retainedIdentity',compile('../supabase/functions/ingest-observation/retainedIdentity.ts')],
  ['retainedVin',compile('../supabase/functions/ingest-observation/retainedVinReference.ts')],
  ['hash',compile('../supabase/functions/_shared/observationContentHash.ts')],
  ['proxy',compile('../supabase/functions/ingest-observation-batch/index.ts')],
  ['cached',compile('../supabase/functions/ingest-observation-batch/cachedProperties.ts')],
  ['guard',compile('../supabase/functions/_shared/writeGuard.ts')],
]);

function fixture(options = {}) {
  const requests = [], writes = [], observations = [], completions = [];
  const identities = [];
  const retainedAccount = { id: snapshotId, vehicle_id: vehicleId, platform: 'bat', author_username: 'abc123',
    bat_author_id: 123, source_url: sourceUrl, posted_at: '2026-10-01T00:00:00.123456Z',
    created_at: '2026-10-05T00:00:00.234567Z', content_hash: 'a'.repeat(64), external_identity_id: null, author_external_identity_id: null };
  const actualSnapshot = { ...snapshot, ...(options.snapshot ?? {}) };
  const actualParent = { ...parent, ...(options.parent ?? {}) };
  const actualEpisode = {...episode,...options.episode};
  const retainedParent={id:snapshotId,vehicle_id:vehicleId,kind:'listing',is_superseded:false,property_id:null,
    subject_type:'vehicle',subject_id:null,source_id:'00000000-0000-4000-8000-000000000004',source_url:sourceUrl,
    observed_at:null,ingested_at:'2026-10-05T00:20:05.123456Z',extraction_method:'html_match',confidence_score:0.85,
    structured_data:{color:'Signal Red',interior_color:'Black Vinyl'}};
  const bytes = options.bytes ?? Buffer.from(html);
  async function http(raw,init) {
    const request = raw instanceof Request ? raw : new Request(raw,init);
    const u = new URL(request.url);requests.push({method:request.method,path:u.pathname,query:Object.fromEntries(u.searchParams)});
    if(u.pathname==='/rest/v1/rpc/claim_bat_sale_snapshots') {
      assert.equal(options.sourceQueue,true);const input=await request.json();
      assert.equal(input.p_limit,20);assert(input.p_worker.startsWith('bat-sale-'));
      return Response.json([{id:'00000000-0000-4000-8000-000000000009',source_snapshot_id:snapshotId,source_vehicle_id:vehicleId}]);
    }
    if(u.pathname==='/rest/v1/rpc/finish_bat_sale_snapshot') {
      assert.equal(options.sourceQueue,true);const input=await request.json();completions.push(input);
      assert.equal(input.p_id,'00000000-0000-4000-8000-000000000009');assert(input.p_worker.startsWith('bat-sale-'));
      if(input.p_status==='done')assert(observations.some(o=>o.id===input.p_observation&&o.source_snapshot_id===snapshotId));
      return Response.json(options.completionRejected!==true);
    }
    if(u.pathname==='/functions/v1/ingest-observation') {
      load('intake');return handlers.get('intake')(request);
    }
    if(u.pathname==='/rest/v1/observation_sources') {
      if(options.retained){assert.equal(request.method,'GET');return Response.json({id:retainedParent.source_id,slug:'bat',base_trust_score:0.85,supported_observations:['listing','specification']});}
      assert.equal(request.method,'GET');assert.equal(u.searchParams.get('slug'),'eq.bat');
      return Response.json({id:'00000000-0000-4000-8000-000000000004',base_trust_score:0.85,supported_observations:options.retainedIdentity?['comment']:['sale_result']});
    }
    if(options.retainedIdentity && u.pathname==='/rest/v1/auction_comments') {
      assert.equal(request.method,'GET','Native testimony cannot be changed');
      return Response.json(u.searchParams.has('id')?retainedAccount:[{bat_author_id:123}]);
    }
    if(options.retainedIdentity && u.pathname==='/rest/v1/external_identities') {
      if(request.method==='GET')return Response.json(identities);
      assert.equal(request.method,'POST');assert.equal(identities.length,0);
      const [row]=await request.json();identities.push({id:'00000000-0000-4000-8000-000000000008',...row});
      return Response.json(null,{status:201});
    }
    if(options.retainedIdentity && u.pathname==='/rest/v1/rpc/refresh_bat_user_profile') {
      assert.deepEqual(await request.json(),{p_username:'abc123'});return Response.json(null);
    }
    if(u.pathname==='/rest/v1/vehicle_observations') {
      if(request.method==='GET') {
        if(options.retained && u.searchParams.get('id')==='eq.'+snapshotId)return Response.json(retainedParent);
        if(options.typedReplayReadError&&u.searchParams.get('select')?.includes('source_vehicle_event_id'))return Response.json({code:'42703',message:'typed column unavailable'},{status:400});
        return Response.json(observations.find(o=>['content_hash','source_id','source_identifier','kind'].every(key=>
          !u.searchParams.has(key)||u.searchParams.get(key)==='eq.'+o[key]))??null);
      }
      assert.equal(request.method,'POST');assert(options.allowObservationWrite,'Explicit productive observation fixture only');
      const row=await request.json();assert(!('ingested_at'in row),'Database owns ingestion time');
      assert(row.extractor_id == null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.extractor_id),
        'Production extractor_id is nullable UUID, not a method string');
      if(options.retained){assert.equal(row.kind,'specification');assert.equal(row.source_observation_id,snapshotId);
        assert.equal(row.extraction_method,'retained_listing_property_projection_v1');}
      else assert.equal(row.kind,'sale_result');
      if(options.allowGenericWrite){
        assert(!('source_snapshot_id'in row),'Generic intake ignores caller typed capture key');
        assert(!('source_vehicle_event_id'in row),'Generic intake ignores caller typed episode key');
      }
      else if(!options.retained){assert.equal(row.extraction_method,'protected_archived_sale_observation_v1');assert.equal(row.source_snapshot_id,snapshotId);}
      if(row.source_vehicle_event_id&&options.guardRefusal)return Response.json({code:'23514',message:'pinned source headers changed'},{status:409});
      const keys=['source_id','source_identifier','kind','content_hash'];
      if(keys.every(k=>row[k]!=null)&&observations.some(o=>keys.every(k=>o[k]===row[k])))return Response.json({code:'23505',message:'unique_observation'},{status:409});
      const saved={is_superseded:false,extractor_id:null,source_vehicle_event_id:null,...row,id:'00000000-0000-4000-8000-000000000003',ingested_at:'2026-01-02T00:00:00.000123+00:00'};
      if(options.jsonbOrder)saved.extraction_metadata=jsonb(saved.extraction_metadata);
      observations.push(saved);writes.push(row);return Response.json(saved);
    }
    if(options.retained && u.pathname==='/rest/v1/observation_properties'){
      assert.equal(request.method,'GET');const key=u.searchParams.get('property_key')?.slice(3);
      assert(['exterior_color','interior_color'].includes(key));
      return Response.json({id:'efcb8c61-1ff5-4790-890e-2e09118e87e3',property_key:key,namespace:'core',deprecated_at:null,applies_to_kinds:['specification']});
    }
    if(u.pathname==='/rest/v1/rpc/vehicle_price_facts') {
      assert.deepEqual(await request.json(),{p_vehicle_ids:[vehicleId]});
      return Response.json([{...fact,...(options.fact??{})}]);
    }
    if(u.pathname==='/rest/v1/vehicle_events') {
      assert.equal(request.method,'GET');assert(!u.searchParams.has('order'),'Explicit source event PK only');
      if(options.episodeReadError)return Response.json({code:'57014',message:'native read unavailable'},{status:500});
      return Response.json(options.episodeMissing||u.searchParams.get('id')!=='eq.'+actualEpisode.id?null:actualEpisode);
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
  const handlers=new Map();
  const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'svc-test',SUPABASE_JWT_SECRET:'test-jwt'};
  function load(name) {
    if(modules.has(name))return modules.get(name);
    const exports={};modules.set(name,exports);
    runInNewContext(sources.get(name),{exports,URL,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,Date,crypto:webcrypto,AbortSignal,atob,btoa,fetch:http,
      console:{log(){},warn(){},error(){}},Deno:{env:{get:key=>env[key]},serve:callback=>{handlers.set(name,callback);}},
      require:specifier=>{
        if(specifier.startsWith('https://esm.sh/@supabase/supabase-js@'))return {createClient:()=>supabase};
        if(specifier==='./batFetcher.ts')return {fetchBatPage:()=>assert.fail('No crawl'),logFetchCost:()=>assert.fail('No paid fetch'),isLoginPage:()=>false};
        if(specifier==='./hybridFetcher.ts')return {fetchPage:()=>assert.fail('No crawl')};
        if(specifier==='./firecrawl.ts')return {firecrawlScrape:()=>assert.fail('No paid fetch')};
        if(specifier==='./batParser.ts')return load('parser');
        if(specifier==='./batChassis.ts')return load('chassis');
        if(specifier==='../_shared/archiveFetch.ts')return load('archive');
        if(specifier==='../_shared/batParser.ts')return load('parser');
        if(specifier==='./batLive.ts')return load('liveIntake');
        if(specifier==='../_shared/batLiveEvents.ts')return load('liveEvents');
        if(specifier==='./batAuctionRecord.ts')return load('auctionRecord');
        if(specifier==='../_shared/writeGuard.ts')return load('guard');
        if(specifier==='./batSaleQueue.ts')return load('batSaleQueue');
        if(specifier==='./apiKeyAuth.ts')return {hashApiKey:()=>assert.fail('No API-key route')};
        if(specifier==='../_shared/agentTiers.ts')return {callTier:()=>assert.fail('No paid inference'),parseJsonResponse:()=>assert.fail('No inference')};
        if(specifier==='../_shared/observationWriter.ts')return {writeObservation:()=>assert.fail('No testimony write')};
        if(specifier==='../_shared/urlNormalization.ts')return {normalizeListingUrl:value=>value,normalizeVin:value=>value};
        if(specifier==='../_shared/rateLimit.ts')return {checkRateLimit:()=>assert.fail('No anonymous intake'),getClientIp:()=>assert.fail('No anonymous intake')};
        if(specifier==='./imageProperties.ts')return load('property');
        if(specifier==='./retainedInterior.ts')return load('retainedInterior');
        if(specifier==='./retainedVinReference.ts')return load('retainedVin');
        if(specifier==='./retainedIdentity.ts')return load('retainedIdentity');
        if(specifier==='../_shared/batAuctionRecord.ts')return load('auctionRecord');
        if(specifier==='../_shared/observationContentHash.ts')return load('hash');
        if(specifier==='../ingest-observation/imageProperties.ts')return load('property');
        if(specifier==='./cachedProperties.ts')return load('cached');
        if(specifier==='../_shared/cors.ts')return {corsHeaders:{'Access-Control-Allow-Origin':'*'}};
        assert.fail(`Unexpected import ${specifier}`);
      }});
    return exports;
  }
  return {requests,writes,observations,completions,snapshot:actualSnapshot,episode:actualEpisode,parser:load('parser'),
    read:(extra={})=>load('archive').readPinnedArchivedPage({snapshotId,vehicleId,sourceUrl,...extra},{supabase,now:()=>new Date('2026-01-03T00:00:00Z')}),
    attach:(capture,receipt)=>load('archive').attachPinnedArchivedSaleQualification(capture,receipt,{supabase}),
    intake:async(body={},token='svc-test')=>{
      load('intake');const response=await handlers.get('intake')(new Request('https://fixture.invalid/ingest-observation',{method:'POST',
        headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
        body:JSON.stringify({mode:'source_sale_qualification',vehicle_id:vehicleId,...body})}));
      return {status:response.status,body:await response.json()};
    },
    proxy:async(body,token='svc-test')=>{
      load('proxy');const response=await handlers.get('proxy')(new Request('https://fixture.invalid/ingest-observation-batch',{method:'POST',
        headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));
      return {status:response.status,body:await response.json()};
    },
    run:async(body={},token='svc-test')=>{
      load('handler');const response=await handlers.get('handler')(new Request('https://fixture.invalid/batch-extract-snapshots',{method:'POST',
        headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
        body:JSON.stringify({mode:'source_sale_qualification',vehicle_ids:[vehicleId],...body})}));
      return {status:response.status,body:await response.json()};
    }};
}

for(const property of ['exterior','interior'])test(`actual retained ${property} selector reaches canonical insert and replays`,async()=>{
 const f=fixture({retained:true,allowObservationWrite:true});
 const body={mode:`retained_listing_${property}_color_v1`,source_observation_id:snapshotId,vehicle_id:undefined};
 const first=await f.intake(body);assert.equal(first.status,200,JSON.stringify(first));assert.equal(f.writes.length,1);
 const row=f.writes[0];assert.equal(row.structured_data[`${property}_color`],property==='exterior'?'Signal Red':'Black Vinyl');
 assert.equal(row.structured_data.source_field,property==='exterior'?'color':'interior_color');
 assert.equal(row.observed_at,'2026-10-05T00:20:05.123456Z');assert.equal(row.structured_data.source_observed_at,null);
 assert.equal(row.structured_data.claim_role,'listing_claim');assert.equal(row.source_observation_id,snapshotId);
 if(property==='exterior')assert(row.content_text.includes('not established verbatim seller text'));
 const replay=await f.intake(body);assert.equal(replay.status,200);assert.equal(f.writes.length,1);
 const forged=await f.intake({...body,structured_data:{exterior_color:'Invented'}});assert.equal(forged.status,400);assert.equal(f.writes.length,1);
 const anonymous=await f.intake(body,'');assert.equal(anonymous.status,401);assert.equal(f.writes.length,1);
});

test('actual retained account selector builds only account/profile and replay never writes testimony',async()=>{
  const f=fixture({retainedIdentity:true});
  const body={mode:'retained_bat_source_account_v1',source_comment_id:snapshotId,vehicle_id:undefined};
  const first=await f.intake(body);assert.equal(first.status,200,JSON.stringify(first));assert.equal(f.writes.length,0);
  assert.equal(first.body.identity_id,'00000000-0000-4000-8000-000000000008');
  assert.equal(first.body.source_lineage,'untyped_metadata_citation');assert.equal(first.body.native_comment_binding,'unresolved');
  assert.equal(first.body.source_citation.source_event_at,'2026-10-01T00:00:00.123456Z');
  assert.equal(first.body.source_citation.source_recorded_at,'2026-10-05T00:00:00.234567Z');
  const replay=await f.intake(body);assert.equal(replay.status,200);assert.equal(replay.body.insert_attempted,false);
  assert.equal((await f.intake({...body,handle:'forged'})).status,400);
  assert.equal((await f.intake(body,'')).status,401);assert.equal(f.writes.length,0);
  assert(f.requests.filter(r=>r.path==='/rest/v1/auction_comments').every(r=>r.method==='GET'));
  assert(!f.requests.some(r=>r.path==='/rest/v1/vehicle_observations'||r.path.includes('analysis-engine')));
  assert.equal(f.requests.filter(r=>r.path==='/rest/v1/external_identities'&&r.method==='POST').length,1);
});

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
  assert.equal(receipt.method,'protected_archived_sale_observation_v1');assert.equal(receipt.original_parsed_at,snapshot.metadata.parsed_at);
  assert(!('qualified_at'in receipt));assert.equal(r.body.results[0].derived_ingested_at,null);
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
  assert.equal(privateResult.body.results[0].reason,'parent_not_public_real_vehicle');assert.equal(privateParent.requests.length,2);
  for(const body of [{vehicle_ids:[]},{vehicle_ids:Array(21).fill(vehicleId)},{force:true},{use_queue:true},{platform:'other'}])assert.equal((await fixture().run(body)).status,400);
});
test('canonical productive qualification appends once and replay preserves first database ingestion',async()=>{
  const f=fixture({allowObservationWrite:true});const original=JSON.stringify(f.snapshot),first=await f.run({dry_run:false});
  assert.equal(first.body.results[0].status,'stored');assert.equal(f.writes.length,1);
  const result=first.body.results[0],saved=f.observations[0];assert.equal(saved.ingested_at,result.derived_ingested_at);
  assert.equal(saved.observed_at,'2025-06-15T00:00:00.000Z');assert.equal(saved.structured_data.source_sale_receipt.event_grain,'date');
  assert(!('producer_qualified_at'in saved.structured_data.source_sale_receipt));assert(saved.extraction_metadata.producer_qualified_at);
  const duplicate=await f.run({dry_run:false});assert.equal(duplicate.body.results[0].duplicate,true);
  assert.equal(duplicate.body.results[0].observation_id,result.observation_id);assert.equal(duplicate.body.results[0].derived_ingested_at,result.derived_ingested_at);
  assert.equal(f.writes.length,1);assert.equal(JSON.stringify(f.snapshot),original);
});
test('concurrent protected metadata change refuses rather than overwriting the winning update',async()=>{
  const f=fixture({allowQualificationWrite:true,concurrentMetadata:true}),capture=await f.read();
  const r=await f.attach(capture,legacyReceipt(capture));
  assert.equal(r.reason,'capture_changed_or_already_qualified');assert.equal(f.writes.length,0);
  assert.equal(f.snapshot.metadata.concurrent_note,'preserve');assert(!f.snapshot.metadata.source_sale_qualification_v1);
});
test('registered archive owner refuses a forged tuple or backdated/future qualification clock',async()=>{
  const f=fixture(),capture=await f.read(),receipt=legacyReceipt(capture);
  assert.equal((await f.attach(capture,{...receipt,currency:'GBP'})).reason,'qualification_attribution_conflict');
  assert.equal((await f.attach(capture,{...receipt,qualified_at:'2025-06-15T00:00:00.000Z'})).reason,'qualification_clock_conflict');
  assert.equal((await f.attach(capture,{...receipt,qualified_at:'2999-01-01T00:00:00.000Z'})).reason,'qualification_clock_conflict');
  assert.equal(f.writes.length,0);assert(!f.requests.some(r=>r.method==='PATCH'));
});
test('qualification cannot precede source knowledge within the same millisecond',async()=>{
  const f=fixture({snapshot:{created_at:'2025-06-16T12:00:00.000001Z'}});
  const capture=await f.read(),receipt=legacyReceipt(capture);
  const earlier='2025-06-16T12:00:00.000Z';
  assert.equal((await f.attach(capture,{...receipt,qualified_at:earlier,knowledge_at:earlier})).reason,'qualification_clock_conflict');
  assert.equal(f.writes.length,0);assert(!f.requests.some(r=>r.method==='PATCH'));
});

function legacyReceipt(capture) {
  const sale=fixture().parser.parseQualifiedBaTSale(capture.html),qualifiedAt=new Date().toISOString(),s=capture.snapshot;
  return {method:'protected_archived_sale_qualification_v1',verification_basis:'producer_attested_archived_hash_parser',
    snapshot_id:s.id,vehicle_id:s.vehicleId,source_url:s.sourceUrl,source_sha256:s.sourceSha256,
    parser:sale.parser,amount:sale.amount,currency:sale.currency,event_day:sale.eventDay,outcome:'sold',event_grain:'date',
    body_source:s.bodySource,byte_length:s.byteLength,price_basis:'published_bid_excluding_fees',
    price_basis_rule:'bat_published_result_fee_separate_v1',price_basis_source:'https://bringatrailer.com/policies/',
    captured_at:s.fetchedAt,source_ingested_at:s.ingestedAt,original_parsed_at:s.parsedAt,source_known_at:s.sourceKnownAt,
    qualified_at:qualifiedAt,knowledge_at:qualifiedAt};
}

test('concurrent identical canonical submissions converge on one row and original ingestion clock',async()=>{
  const f=fixture({allowObservationWrite:true});const [a,b]=await Promise.all([f.intake({dry_run:false}),f.intake({dry_run:false})]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(f.observations.length,1);
  assert.equal(a.body.observation_id,b.body.observation_id);assert.equal(a.body.derived_ingested_at,b.body.derived_ingested_at);
  assert.equal(Number(a.body.duplicate)+Number(b.body.duplicate),1);
  assert.equal(f.observations[0].extractor_id,null);assert.equal(f.observations[0].extraction_method,'protected_archived_sale_observation_v1');
});
test('canonical intake derives preview from raw source and refuses generic protected-marker forgery',async()=>{
  const f=fixture(),r=await f.intake({amount:1,currency:'GBP',observed_at:'1900-01-01',ingested_at:'1900-01-01',structured_data:{fake:true}});
  assert.equal(r.body.receipt.amount,12345);assert.equal(r.body.receipt.currency,'USD');assert.equal(r.body.derived_ingested_at,null);
  assert.equal(r.body.availability_known_at,null);assert.equal(r.body.writes,0);assert.equal(f.writes.length,0);
  for(const forged of [{extraction_method:'protected_archived_sale_observation_v1'},
    {extractor_id:'protected_archived_sale_observation_v1'},
    {structured_data:{source_sale_receipt:{method:'protected_archived_sale_observation_v1'}}}]){
    assert.equal((await f.intake({mode:undefined,source_slug:'bat',kind:'sale_result',observed_at:'2025-01-01',...forged})).status,403);
  }
});
test('canonical protected mode refuses anonymous and signed-in callers before reading source evidence',async()=>{
  const anon=fixture();assert.equal((await anon.intake({},null)).status,401);assert.equal(anon.requests.length,0);
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({role:'authenticated',sub:vehicleId,exp:4102444800})).toString('base64url');
  const signing=`${header}.${payload}`,token=signing+'.'+createHmac('sha256','test-jwt').update(signing).digest('base64url');
  const user=fixture();assert.equal((await user.intake({},token)).status,403);assert.equal(user.requests.length,0);
});
test('canonical intake holds corrupt raw, incompatible current facts and unknown outcomes without writing',async()=>{
  for(const options of [{bytes:Buffer.from('corrupt')},{fact:{sold_amount:12000}},
    {fact:{sold_on:'2025-06-14'}},{fact:{outcome:'unknown'}},{snapshot:{metadata:{...snapshot.metadata,vehicle_id: snapshotId}}}]){
    const f=fixture(options),r=await f.intake({dry_run:false});assert.equal(r.status,422);assert.equal(f.writes.length,0);
  }
});
test('legacy badge-only duplicate sharing the exact hash is refused and never promoted',async()=>{
  const f=fixture({allowObservationWrite:true});await f.intake({dry_run:false});
  f.observations[0].source_snapshot_id=null;const legacy=JSON.stringify(f.observations[0]);
  const replay=await f.intake({dry_run:false});assert.equal(replay.status,503);
  assert.equal(JSON.stringify(f.observations[0]),legacy);assert.equal(f.observations.length,1);assert.equal(f.writes.length,1);
});
test('superseded or differently attributed duplicate is refused without restoring its claim',async()=>{
  for(const patch of [{is_superseded:true},{extractor_id:'00000000-0000-4000-8000-000000000004'},{raw_source_ref:'unknown'},
    {vehicle_id:'00000000-0000-4000-8000-000000000099'}]){
    const f=fixture({allowObservationWrite:true});await f.intake({dry_run:false});Object.assign(f.observations[0],patch);
    const original=JSON.stringify(f.observations[0]);assert.equal((await f.intake({dry_run:false})).status,503);
    assert.equal(JSON.stringify(f.observations[0]),original);assert.equal(f.writes.length,1);
  }
});
test('actual generic intake ignores caller-provided typed capture and episode keys',async()=>{
  const f=fixture({allowObservationWrite:true,allowGenericWrite:true});
  const r=await f.intake({mode:undefined,source_slug:'bat',kind:'sale_result',observed_at:'2025-06-15T00:00:00Z',
    vehicle_id:vehicleId,source_snapshot_id:snapshotId,source_vehicle_event_id:'00000000-0000-4000-8000-000000000099',defer_analysis:true});
  assert.equal(r.status,200);assert.equal(f.observations.length,1);
  assert(!('source_snapshot_id'in f.writes[0]));assert(!('source_vehicle_event_id'in f.writes[0]));
  assert.equal(f.observations[0].source_vehicle_event_id,null,'Database default carries no caller ancestry');
});
test('actual current v1 protected intake refuses an unestablished caller episode key',async()=>{
  const f=fixture({allowObservationWrite:true});
  const r=await f.intake({mode:'source_sale_qualification',vehicle_id:vehicleId,snapshot_id:snapshotId,
    source_vehicle_event_id:'00000000-0000-4000-8000-000000000099',dry_run:false});
  assert.equal(r.status,422);assert.equal(f.observations.length,0);assert.equal(f.writes.length,0);
  assert(!f.requests.some(q=>q.path.endsWith('/vehicle_observations')&&q.method==='POST'));
});
test('generic batch cannot elevate a signed-in or service caller into protected mode',async()=>{
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({role:'authenticated',sub:vehicleId,exp:4102444800})).toString('base64url');
  const signing=`${header}.${payload}`,user=signing+'.'+createHmac('sha256','test-jwt').update(signing).digest('base64url');
  for(const token of ['svc-test',user]){
    const f=fixture(),r=await f.proxy({observations:[{mode:'source_sale_qualification',vehicle_id:vehicleId,dry_run:false}]},token);
    assert.equal(r.status,403);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
  }
});

test('optional current-v1 event selector derives exact server-owned headers, never caller metadata',async()=>{
  const f=fixture(),r=await f.intake({source_vehicle_event_id:eventId.toUpperCase(),amount:1,
    extraction_metadata:{source_episode_context:{id:snapshotId},source_snapshot_context:{id:eventId}},ingested_at:'1900-01-01'});
  assert.equal(r.status,200);assert.equal(r.body.proposed_source_vehicle_event_id,eventId);
  assert.deepEqual(r.body.source_episode_context,episode);
  assert.deepEqual(r.body.source_snapshot_context,{id:snapshotId,platform:'bat',listing_url:sourceUrl,success:true,http_status:200,
    html_sha256:snapshot.html_sha256,fetched_at:snapshot.fetched_at,created_at:snapshot.created_at,html_storage_path:snapshot.html_storage_path,
    inline_body_present:false,metadata:{vehicle_id:vehicleId,vehicle_matched:true,parsed_at:snapshot.metadata.parsed_at}});
  assert.equal(r.body.source_episode_context.created_at,episode.created_at);assert.equal(r.body.derived_ingested_at,null);
  assert.equal(r.body.availability_known_at,null);assert.equal(r.body.source_public_visibility,'unestablished');
  assert.equal(r.body.recorded_clock_basis,'database_transaction_start_not_commit_availability');assert.equal(f.writes.length,0);
});
test('optional current-v1 persists event/capture edges and replays JSONB-reordered contexts with original database clock',async()=>{
  const f=fixture({allowObservationWrite:true,jsonbOrder:true});
  const plain=fixture({allowObservationWrite:true});await plain.intake({dry_run:false});
  const first=await f.intake({dry_run:false,source_vehicle_event_id:eventId});assert.equal(first.status,200,JSON.stringify(first.body));
  const saved=f.observations[0];assert.equal(saved.source_vehicle_event_id,eventId);assert.equal(saved.source_snapshot_id,snapshotId);
  assert.equal(saved.content_hash,plain.observations[0].content_hash,'Typed context is outside frozen captured claim hash');
  assert(!('source_vehicle_event_id' in plain.writes[0]));assert(!('ingested_at' in f.writes[0]));
  assert.equal(first.body.source_vehicle_event_id,eventId);assert.equal(first.body.availability_known_at,null);
  const replay=await f.intake({dry_run:false,source_vehicle_event_id:eventId});assert.equal(replay.status,200);
  assert.equal(replay.body.duplicate,true);assert.equal(replay.body.observation_id,first.body.observation_id);
  assert.equal(replay.body.derived_ingested_at,first.body.derived_ingested_at);assert.equal(f.writes.length,1);
  for(const request of f.requests.filter(q=>q.path.endsWith('/vehicle_observations')&&q.method==='GET')){
    assert.equal(request.query.source_id,'eq.00000000-0000-4000-8000-000000000004');
    assert.equal(request.query.kind,'eq.sale_result');assert.equal(request.query.source_identifier,'eq.'+saved.source_identifier);
  }
});
test('concurrent optional current-v1 submissions converge on one native edge and original recording clock',async()=>{
  const f=fixture({allowObservationWrite:true}),body={dry_run:false,source_vehicle_event_id:eventId};
  const [a,b]=await Promise.all([f.intake(body),f.intake(body)]);
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(f.observations.length,1);assert.equal(f.writes.length,1);
  assert.equal(a.body.observation_id,b.body.observation_id);assert.equal(a.body.derived_ingested_at,b.body.derived_ingested_at);
  assert.equal(Number(a.body.duplicate)+Number(b.body.duplicate),1);assert.equal(f.observations[0].source_vehicle_event_id,eventId);
});
test('legacy NULL episode ancestry collision is retained and refused without promotion or a second claim',async()=>{
  const f=fixture({allowObservationWrite:true});await f.intake({dry_run:false});const original=JSON.stringify(f.observations[0]);
  const r=await f.intake({dry_run:false,source_vehicle_event_id:eventId});assert.equal(r.status,503);
  assert.equal(f.writes.length,1);assert.equal(f.observations.length,1);assert.equal(JSON.stringify(f.observations[0]),original);
});
for(const [label,patch] of [
  ['different event',{source_vehicle_event_id:snapshotId}],['missing event',{source_vehicle_event_id:null}],
  ['missing context',{extraction_metadata:{}}],['different pinned headers',{extraction_metadata:{source_episode_context:{...episode,updated_at:'2025-07-01T00:00:00Z'}}}],
  ['superseded',{is_superseded:true}],
  ['unknown DB clock',{ingested_at:null}],['unzoned DB clock',{ingested_at:'2026-01-02 00:00:00'}],
  ['submillisecond event mismatch',{observed_at:'2025-06-15T00:00:00.000001Z'}],
])test(`optional current-v1 persisted replay refuses ${label} without rewriting testimony`,async()=>{
  const f=fixture({allowObservationWrite:true});await f.intake({dry_run:false,source_vehicle_event_id:eventId});
  Object.assign(f.observations[0],patch);const original=JSON.stringify(f.observations[0]);
  assert.equal((await f.intake({dry_run:false,source_vehicle_event_id:eventId})).status,503);
  assert.equal(JSON.stringify(f.observations[0]),original);assert.equal(f.writes.length,1);
});
test('later native header mutation refuses replay with original immutable claim retained',async()=>{
  const f=fixture({allowObservationWrite:true});await f.intake({dry_run:false,source_vehicle_event_id:eventId});
  const original=JSON.stringify(f.observations[0]);f.episode.updated_at='2025-07-01T00:00:00.654321Z';
  const r=await f.intake({dry_run:false,source_vehicle_event_id:eventId});assert.equal(r.status,503);
  assert.equal(JSON.stringify(f.observations[0]),original);assert.equal(f.writes.length,1);
});
for(const [label,options,reason] of [
  ['missing',{episodeMissing:true},'source_episode_attribution_conflict'],['unavailable',{episodeReadError:true},'source_episode_read_failed'],
  ['another parent',{episode:{vehicle_id:snapshotId}},'source_episode_attribution_conflict'],
  ['another platform',{episode:{source_platform:'other'}},'source_episode_attribution_conflict'],
  ['another source',{episode:{source_url:'https://bringatrailer.com/listing/another/'}},'source_episode_identity_conflict'],
  ['URL-shaped contradictory listing ID',{episode:{source_listing_id:'bringatrailer.com/listing/another/'}},'source_episode_identity_conflict'],
  ['unknown status',{episode:{event_status:'ended'}},'source_episode_current_sale_conflict'],
  ['not sold',{episode:{event_status:'reserve_not_met'}},'source_episode_current_sale_conflict'],
  ['unknown amount',{episode:{final_price:null}},'source_episode_current_sale_conflict'],
  ['price disagreement',{episode:{final_price:12346}},'source_episode_current_sale_conflict'],
  ['earlier date',{episode:{sold_at:'2025-06-14T00:00:00Z'}},'source_episode_current_sale_conflict'],
  ['nonmidnight instant',{episode:{sold_at:'2025-06-15T01:00:00.123456Z'}},'source_episode_civil_day_unestablished'],
  ['unknown date',{episode:{sold_at:null}},'source_episode_civil_day_unestablished'],
  ['unzoned secondary clock',{episode:{ended_at:'2025-06-15 00:00:00'}},'source_episode_clock_unknown'],
  ['invalid recorded clock',{episode:{created_at:'2025-02-30T00:00:00Z'}},'source_episode_clock_unknown'],
])test(`optional current-v1 refuses ${label} native event before any insert`,async()=>{
  const f=fixture(options),r=await f.intake({dry_run:false,source_vehicle_event_id:eventId});
  assert.equal(r.status,422,JSON.stringify(r.body));assert.equal(r.body.reason,reason);assert.equal(f.writes.length,0);
  assert(!f.requests.some(q=>q.method==='POST'&&q.path.endsWith('/vehicle_observations')));
});
test('optional current-v1 preserves opaque IDs/NULL recording clocks and supported URL aliases without inferred units',async()=>{
  for(const source_listing_id of ['opaque-lot-123','https://www.bringatrailer.com/listing/synthetic-one/?x=1']){
    const f=fixture({episode:{source_listing_id,created_at:null,updated_at:null,extracted_at:null}});
    const r=await f.intake({source_vehicle_event_id:eventId});assert.equal(r.status,200);
    assert.equal(r.body.source_episode_context.source_listing_id,source_listing_id);assert.equal(r.body.source_episode_context.created_at,null);
    assert(!('currency' in r.body.source_episode_context));assert.equal(r.body.availability_known_at,null);
  }
});
test('optional event cannot bypass existing current-sale, private parent, raw bytes or parser eligibility',async()=>{
  for(const options of [{fact:{sold_amount:20000}},{fact:{sold_on:'2025-07-01'}},{parent:{is_public:false}},
    {bytes:Buffer.from('corrupt')},{bytes:Buffer.from('bid to USD $12,345 on 6/15/25'),snapshot:{html_sha256:digest('bid to USD $12,345 on 6/15/25')}}]){
    const f=fixture(options);assert.equal((await f.intake({dry_run:false,source_vehicle_event_id:eventId})).status,422);assert.equal(f.writes.length,0);
    assert(!f.requests.some(q=>q.path.endsWith('/vehicle_events')),'Source episode cannot replace current-v1 proof');
  }
});
for(const source_vehicle_event_id of [null,'invalid',[eventId]])test(`optional event requires one UUID: ${JSON.stringify(source_vehicle_event_id)}`,async()=>{
  const f=fixture(),r=await f.intake({source_vehicle_event_id});assert.equal(r.status,422);assert.equal(r.body.reason,'invalid_source_episode_locator');
  assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);
});
test('optional current-v1 fails closed when typed schema or atomic source guard refuses, with no fallback insert',async()=>{
  const missing=fixture({typedReplayReadError:true}),r=await missing.intake({dry_run:false,source_vehicle_event_id:eventId});
  assert.equal(r.status,503);assert.equal(missing.writes.length,0);assert(!missing.requests.some(q=>q.path.endsWith('/vehicle_observations')&&q.method==='POST'));
  const changed=fixture({allowObservationWrite:true,guardRefusal:true}),refusal=await changed.intake({dry_run:false,source_vehicle_event_id:eventId});
  assert.equal(refusal.status,500);assert.equal(changed.writes.length,0);assert.equal(changed.observations.length,0);
  assert.equal(changed.requests.filter(q=>q.path.endsWith('/vehicle_observations')&&q.method==='POST').length,1);
});
test('generic caller event/capture keys cannot assign ancestry',async()=>{
  const f=fixture({allowObservationWrite:true,allowGenericWrite:true}),r=await f.intake({mode:undefined,source_slug:'bat',kind:'sale_result',
    observed_at:'2025-06-15T00:00:00Z',source_vehicle_event_id:eventId,source_snapshot_id:snapshotId,defer_analysis:true});
  assert.equal(r.status,200);assert(!('source_vehicle_event_id' in f.writes[0]));assert(!('source_snapshot_id' in f.writes[0]));
  assert(!f.requests.some(q=>q.path.endsWith('/vehicle_events')));
});
test('episode-v2/unknown version and reserved preview marker never fall through to v1 admission',async()=>{
  for(const qualification_version of ['episode_v2','unknown'])for(const dry_run of [true,false]){
    const f=fixture({allowObservationWrite:true}),r=await f.intake({qualification_version,dry_run,source_vehicle_event_id:eventId});
    assert.equal(r.status,409);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
  }
  for(const input of [{extraction_method:'protected_archived_sale_episode_preview_v2'},
    {structured_data:{source_sale_receipt:{method:'protected_archived_sale_episode_preview_v2'}}}]){
    const f=fixture();assert.equal((await f.intake({mode:undefined,...input})).status,403);assert.equal(f.requests.length,0);
  }
});
test('actual optional-v1 producer payloads cover inline and protected-storage custody at the canonical boundary',async()=>{
  const cases=[];
  for(const inline of [true,false]){
    const f=fixture({allowObservationWrite:true,snapshot:inline?{html}:{}});
    const r=await f.intake({dry_run:false,source_vehicle_event_id:eventId});assert.equal(r.status,200);
    assert.equal(f.writes[0].extraction_metadata.source_snapshot_context.inline_body_present,inline);
    assert.equal(f.writes[0].structured_data.source_sale_receipt.body_source,inline?'inline':'protected_storage');
    cases.push({input:f.writes[0],episode:f.episode,snapshot:f.snapshot,synthetic_html:html});
  }
  // Optional private artifact for the disposable PG17 guard cross-check. Never
  // captures live rows or performs a production connection.
  if(process.env.CURRENT_SALE_WRITER_FIXTURE_OUTPUT)writeFileSync(process.env.CURRENT_SALE_WRITER_FIXTURE_OUTPUT,JSON.stringify(cases,null,2));
});

const queueBody={use_source_queue:true,vehicle_ids:undefined,dry_run:false};
test('actual source queue pins capture, admits only through canonical intake, and repeat converges',async()=>{
 const f=fixture({sourceQueue:true,allowObservationWrite:true});
 const first=await f.run(queueBody);assert.equal(first.status,200,JSON.stringify(first));
 assert.equal(first.body.stored,1);assert.equal(first.body.writes,1);assert.equal(first.body.model_calls,0);
 assert.equal(f.writes.length,1);assert.equal(f.completions[0].p_status,'done');
 assert.equal(f.completions[0].p_observation,f.observations[0].id);
 const again=await f.run(queueBody);assert.equal(again.body.stored,1);assert.equal(again.body.writes,0);assert.equal(f.writes.length,1);
});
test('canonical admission followed by failed completion remains explicitly unverified',async()=>{
 const f=fixture({sourceQueue:true,allowObservationWrite:true,completionRejected:true});
 const r=await f.run(queueBody);assert.equal(r.status,503);assert.equal(r.body.success,false);
 assert.equal(r.body.writes_reported,1);assert.equal(r.body.writes,0);assert.equal(f.writes.length,1);
 assert.equal(r.body.completion_failures,1);
});
for(const [label,patch,reason,status] of [
 ['unknown sale',{fact:{sold_on:null}},'current_sourced_sale_unknown','skipped'],
 ['hash conflict',{snapshot:{html:html+' changed'}},'source_hash_conflict','skipped'],
 ['private parent',{parent:{is_public:false}},'parent_not_public_real_vehicle','skipped'],
 ['missing stored body',{storageMissing:true},'storage_body_unavailable','retry'],
])test(`source queue ${label} preserves refusal and never writes`,async()=>{
 const f=fixture({sourceQueue:true,...patch});const r=await f.run(queueBody);
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(f.writes.length,0);
 assert.equal(f.completions[0].p_status,status);assert.equal(f.completions[0].p_reason,reason);
 assert.equal(f.completions[0].p_observation,null);assert.equal(r.body.model_calls,0);
});
test('source queue refuses previews, mixed selectors, paid flags and held episode versions before claiming',async()=>{
 for(const patch of [{dry_run:undefined},{dry_run:true},{vehicle_ids:[vehicleId]},
   {platform_credential:true},{qualification_version:'episode_v2'},{batch_size:21},{batch_size:0},{force:true}]){
  const f=fixture({sourceQueue:true});const r=await f.run({...queueBody,...patch});
  assert.equal(r.status,400);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
 }
});
test('source queue remains service-only before claim or raw access',async()=>{
 const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({role:'authenticated',sub:vehicleId,exp:4102444800})).toString('base64url');
 const signing=`${header}.${payload}`,token=signing+'.'+createHmac('sha256','test-jwt').update(signing).digest('base64url');
 for(const actor of ['',token]){
  const f=fixture({sourceQueue:true});const r=await f.run(queueBody,actor);
  assert([401,403].includes(r.status));assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
 }
});
