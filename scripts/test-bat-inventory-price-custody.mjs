// Actual inventory parser, retained receipt reader and existing upsert payload,
// with real Supabase request construction and fail-closed source/DB transport.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { webcrypto } from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript'),{createClient}=require('@supabase/supabase-js');
const root=resolve(import.meta.dirname,'../supabase/functions');
const snapshot='00000000-0000-4000-8000-000000000001',readAt='2026-11-09T02:46:53.776Z';
async function exercise(bid,missingReceipt=false){
 const calls=[],modules=new Map();let sourceCalls=0;
 const item={active:true,id:125541777,url:'https://bringatrailer.com/listing/1994-mazda-rx-7-r2-2/',
 title:'1994 Mazda RX-7',year:1994,current_bid:bid,timestamp_end:Math.floor(Date.now()/1000)+86400};
 const html='var auctionsCurrentInitialData = '+JSON.stringify({items:[item]})+';';
 const transport=async(input,init={})=>{
  const url=new URL(input),body=init.body?JSON.parse(init.body):undefined;calls.push({url,body});
  if(url.pathname==='/rest/v1/listing_page_snapshots'){
   assert.equal(url.searchParams.get('id'),'eq.'+snapshot);
   assert.equal(url.searchParams.get('listing_url'),'eq.https://bringatrailer.com/auctions');
   return Response.json(missingReceipt?null:{id:snapshot,fetched_at:readAt,html_sha256:'a'.repeat(64)});
  }
  if(url.pathname==='/rest/v1/rpc/upsert_live_auction_vehicles')return Response.json(1);
  if(url.pathname==='/rest/v1/rpc/end_live_auctions_absent')return Response.json(0);
  throw Error('Unexpected database/source request '+url.pathname);
 };
 const db=createClient('https://fixture.invalid','fixture-key',{global:{fetch:transport},auth:{persistSession:false,autoRefreshToken:false}});
 const unused=new Proxy({}, {get:(_target,key)=>()=>{throw Error('Unexpected dependency '+String(key));}});
 function load(path){
  if(modules.has(path))return modules.get(path).exports;
  const mod={exports:{}};modules.set(path,mod);
  let source=readFileSync(path,'utf8');
  const entry=path===resolve(root,'sync-live-auctions/index.ts');
  if(entry)source+='\nexport {syncBaT,syncToDatabase};';
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(js,{module:mod,exports:mod.exports,console:{log(){},warn(){},error(){}},Date,URL,TextEncoder,crypto:webcrypto,
   Deno:{serve(){},env:{get(){return undefined;}}},
   require(spec){
    if(spec.startsWith('jsr:'))return {};
    if(spec.startsWith('https://esm.sh/@supabase/supabase-js'))return {createClient};
    if(spec==='../_shared/archiveFetch.ts')return {archiveFetch:async()=>{sourceCalls++;return {html,snapshotId:snapshot,error:null};}};
    if(entry&&!['./batEpisodeState.ts','../_shared/batParser.ts'].includes(spec))return unused;
    if(spec.startsWith('.'))return load(resolve(dirname(path),spec));
    throw Error('Unexpected import '+spec);
   }});
  return mod.exports;
 }
 const sync=load(resolve(root,'sync-live-auctions/index.ts'));
 const parsed=await sync.syncBaT(db);
 if(!parsed.error)await sync.syncToDatabase(db,parsed.auctions,'bringatrailer');
 return {parsed,calls,sourceCalls};
}
test('actual parsed quote, retained snapshot and original source clock travel in one existing writer payload',async()=>{
 const f=await exercise(57500);
 assert.equal(f.parsed.error,null);assert.equal(f.sourceCalls,1);
 const writes=f.calls.filter(c=>c.url.pathname.endsWith('/upsert_live_auction_vehicles'));
 assert.equal(writes.length,1);const row=writes[0].body.p_rows[0];
 assert.equal(row.sale_price,57500);
 assert.equal(row.origin_metadata.source_current_bid,57500);
 assert.equal(row.origin_metadata.source_snapshot_id,snapshot);
 assert.equal(row.origin_metadata.source_read_at,readAt);
 assert.equal(row.origin_metadata.external_id,'125541777');
 assert.equal(row.listing_url,'https://bringatrailer.com/listing/1994-mazda-rx-7-r2-2');
 assert.notEqual(row.origin_metadata.last_sync,readAt);
});
test('no-bid and string-valued publisher quotes remain unknown, never coerced',async()=>{
 for(const bid of [false,'57500',null]){
  const f=await exercise(bid);const row=f.calls.find(c=>c.url.pathname.endsWith('/upsert_live_auction_vehicles')).body.p_rows[0];
  assert.equal(row.origin_metadata.source_current_bid,null);assert.equal(row.sale_price,null);
 }
});
test('missing retained source receipt stops inventory write rather than inventing custody',async()=>{
 const f=await exercise(57500,true);assert.match(f.parsed.error,/receipt unavailable/);
 assert.equal(f.calls.some(c=>c.url.pathname.endsWith('/upsert_live_auction_vehicles')),false);
});
