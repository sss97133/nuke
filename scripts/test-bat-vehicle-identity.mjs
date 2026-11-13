// Actual extractor handler, parsers, identity guard and SDK request construction;
// downstream writer adapters are recorded boundaries, never production calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript'),{createClient}=require('@supabase/supabase-js');
const locatorId='00000000-0000-4000-8000-000000000001',ownerId='00000000-0000-4000-8000-000000000002';
const vin='1HGCM82633A004352',url='https://bringatrailer.com/listing/2003-honda-accord-fixture';
async function exercise(conflict=false,provided=true,liveStream=false){
 const events=[],modules=new Map();let handler;
 const locator={id:locatorId,vin:conflict?'1HGCM82643A004352':null,listing_url:url,status:'active',
  origin_metadata:{source:'bat_auctions_page',platform:'bringatrailer',external_id:'123456'}};
 const owner={id:ownerId,vin,year:2003,make:'Honda',model:'Accord',listing_url:'https://bringatrailer.com/listing/prior-lot',
  discovery_url:'https://bringatrailer.com/listing/prior-lot',platform_source:'bringatrailer',status:'active'};
 const html=`<title>2003 Honda Accord</title><div class="essentials"><strong>Listing Details</strong><ul><li>Chassis: ${vin}</li></ul></div>
 <div class="post-excerpt">${'This vehicle has documented source history and a manual transmission. '.repeat(20)}</div>
 <script>var data={"comments":[{"id":12345,"post":123456,"type":"bat-bid","bidAmount":15000,"timestamp":1700000000,"authorName":"fixture"}]};</script>`;
 const network=async(raw,init={})=>{
  const u=new URL(raw),method=init.method??'GET',body=init.body?JSON.parse(init.body):null;
  assert.equal(u.origin,'https://fixture.invalid','no publisher or paid calls');
  const table=u.pathname.split('/').at(-1);
  events.push({table,method,body,params:Object.fromEntries(u.searchParams)});
  if(table==='ingest-observation')return Response.json({success:true,recorded:1});
  if(method!=='GET'&&method!=='HEAD') return Response.json([{id:'00000000-0000-4000-8000-000000000003'}]);
  if(table==='listing_page_snapshots')return Response.json([{id:'00000000-0000-4000-8000-000000000004',html,http_status:200,
   fetched_at:'2026-11-09T00:00:00Z',metadata:{},success:true}]);
  if(table==='live_auction_sources')return Response.json({id:'00000000-0000-4000-8000-000000000005'});
  if(table==='external_identities')return Response.json([{id:'00000000-0000-4000-8000-000000000006',handle:'fixture'}]);
  if(table==='monitored_auctions'&&liveStream==='error')return Response.json({message:'ownership unavailable'},{status:503});
  if(table==='monitored_auctions'&&liveStream==='overflow')return Response.json([{}, {}, {}]);
  if(table==='monitored_auctions'&&liveStream){
   const owners=u.searchParams.get('vehicle_id')??'';
   if(owners&&!owners.includes(locatorId))return Response.json([]);
   return Response.json([{id:'00000000-0000-4000-8000-000000000007',vehicle_id:locatorId,external_auction_url:url,
    auction_end_time:new Date(Date.now()+86400000).toISOString(),is_live:true,
    stream_state:{sessions:liveStream==='newer_frame'?{}:{fixture:{connected:true,at:new Date().toISOString()}},last_frame_received_at:new Date().toISOString()}}]);
  }
  if(table==='vehicles'){
   const selected=u.searchParams.get('id');
   return Response.json(selected===`eq.${locatorId}`?[locator]:selected===`eq.${ownerId}`?[owner]:u.searchParams.has('vin')?[owner]:u.searchParams.has('listing_url')?[locator]:[]);
  }
  return Response.json([]);
 };
 const writer=(name,id)=>{events.push({writer:name,vehicleId:id});};
 const stubs={
  '../_shared/writeGuard.ts':{requireWriteAuth:async()=>null},
  '../_shared/supabaseKeys.ts':{projectSecretKey:()=> 'fixture-secret'},
  '../_shared/batUpsertWithProvenance.ts':{batchUpsertWithProvenance:async(_db,id)=>{writer('provenance',id);return {stats:{}};},quarantineRecord:async()=>assert.fail('unexpected quarantine')},
  '../_shared/observationWriter.ts':{writeObservation:async(_db,p)=>writer('observation',p.vehicleId)},
  './descriptionObservation.ts':{recordListingDescription:async(_db,p)=>{writer('description',p.vehicleId);return {status:'recorded'};}},
  '../_shared/landIdentifierClaims.ts':{landIdentifierClaims:async(_db,p)=>writer('identifiers',p.vehicleId)},
 };
 function load(file){
  if(modules.has(file.href))return modules.get(file.href).exports;
  const module={exports:{}};modules.set(file.href,module);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports:module.exports,module,Date,performance,URL,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,
   crypto:webcrypto,fetch:network,setTimeout,clearTimeout,AbortSignal,atob,btoa,console:{log(){},warn(){},error(){}},
   Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://fixture.invalid':undefined},serve:fn=>{handler=fn;}},
   require:name=>{
    if(stubs[name])return stubs[name];
    if(name.startsWith('https://esm.sh/@supabase/supabase-js'))return {createClient:(base,key,config={})=>createClient(base,key,{...config,global:{...config.global,fetch:network},auth:{persistSession:false}})};
    if(name.startsWith('node:'))return require(name);
    assert.ok(name.startsWith('.'),`unexpected dependency ${name}`);
    return load(new URL(name,file));
   }});
  return module.exports;
 }
 load(new URL('../supabase/functions/extract-bat-core/index.ts',import.meta.url));
 const response=await handler(new Request('https://fixture.invalid/extract',{method:'POST',body:JSON.stringify({url,...(provided?{vehicle_id:locatorId}:{})})}));
 return {status:response.status,body:await response.json(),events,owner};
}
for(const provided of [true,false])test(`actual ${provided?'provided':'URL-resolved'} locator extraction routes downstream identity to the exact VIN owner`,async()=>{
 const r=await exercise(false,provided);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.vehicle_resolution.canonical_vehicle_id,ownerId);
 for(const name of ['description','observation','provenance'])assert.ok(r.events.some(e=>e.writer===name&&e.vehicleId===ownerId),name);
 const writes=r.events.filter(e=>e.method&&e.method!=='GET'&&e.method!=='HEAD');
 for(const table of ['auction_events','vehicle_events','auction_comments'])assert.ok(writes.some(e=>e.table===table),table+' '+JSON.stringify(r.body));
 for(const e of writes)for(const p of Array.isArray(e.body)?e.body:[e.body])if(p?.vehicle_id)assert.equal(p.vehicle_id,ownerId,e.table);
 const scalar=writes.find(e=>e.table==='vehicles'&&e.method==='PATCH');
 assert.equal(scalar.params.id,`eq.${ownerId}`);assert.equal(scalar.body.listing_url,r.owner.listing_url);
 assert.ok(r.events.findIndex(e=>e.table==='vehicles'&&e.params?.vin) < r.events.findIndex(e=>e.writer||e.method==='PATCH'));
});
test('actual conflicting provided identity refuses before any testimony or scalar write',async()=>{
 const r=await exercise(true);assert.equal(r.status,500);assert.match(r.body.error,/contradicts/);
 assert.equal(r.events.filter(e=>e.writer||(e.method&&e.method!=='GET'&&e.method!=='HEAD')).length,0);
});
for(const stream of [true,'newer_frame'])test(`redirected locator stream (${stream}) retains auction authority while description uses canonical vehicle`,async()=>{
 const r=await exercise(false,true,stream);assert.equal(r.status,200,JSON.stringify(r.body));
 assert.ok(r.events.some(e=>e.writer==='description'&&e.vehicleId===ownerId));
 assert.ok(r.events.some(e=>e.table==='monitored_auctions'&&e.params.vehicle_id?.includes(locatorId)&&e.params.vehicle_id?.includes(ownerId)));
 assert.equal(r.events.filter(e=>['auction_events','vehicle_events'].includes(e.table)&&e.method!=='GET').length,0);
});
test('unknown redirected stream ownership refuses scalar and testimony writes',async()=>{
 const r=await exercise(false,true,'error');assert.equal(r.status,500);assert.match(r.body.error,/ownership unavailable/);
 assert.equal(r.events.filter(e=>e.writer||(e.method&&e.method!=='GET'&&e.method!=='HEAD')).length,0);
});
test('monitor lookup overflow refuses rather than dropping a potentially newer stream',async()=>{
 const r=await exercise(false,true,'overflow');assert.equal(r.status,500);assert.match(r.body.error,/ownership ambiguous/);
 assert.ok(r.events.some(e=>e.table==='monitored_auctions'&&e.params.limit==='3'));
 assert.equal(r.events.filter(e=>e.writer||(e.method&&e.method!=='GET'&&e.method!=='HEAD')).length,0);
});
