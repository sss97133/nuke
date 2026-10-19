import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {requireCabCapture} from './inspect-cab-snapshot.mjs';

const {createClient}=createRequire(import.meta.url)('@supabase/supabase-js');
const source=readFileSync(new URL('./cab-api-sync.mjs',import.meta.url),'utf8');
const start=source.indexOf('  // 1. Archive JSON snapshot');
const end=source.indexOf('  // 2. Match or create vehicle');
assert(start>0&&end>start,'Run the actual collector archive phase before its model path');
const archive=source.slice(start,end);
const snapshotId='00000000-0000-4000-8000-000000000001';
const sourceUrl='https://carsandbids.com/auctions/AbC12345/synthetic';
const clock='2026-10-18T00:00:00.123Z';
const detail={id:'AbC12345',submission_id:123,status:'sold',listing:{title:'Synthetic retained listing'},stats:{bids:0}};
const rows=[{id:42,type:1,timestamp:'2026-10-17T00:00:00Z',text:'Original source – retained'}];

function fixture(options={}) {
  const requests=[],inserted=[];
  let held=options.existing?{id:snapshotId,platform:'carsandbids',listing_url:sourceUrl,success:true,...options.existing}:null;
  const db=createClient('https://snapshot-fixture.invalid','fixture-key',{
    auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(raw,init)=>{
      const request=raw instanceof Request?raw:new Request(raw,init);
      const u=new URL(request.url);assert.equal(u.pathname,'/rest/v1/listing_page_snapshots');
      requests.push({method:request.method,params:Object.fromEntries(u.searchParams),prefer:request.headers.get('prefer')});
      if(request.method==='GET'){
        if(options.lookupError)return Response.json({code:'42501',message:'snapshot lookup refused'},{status:400});
        const matches=held&&['platform','listing_url','html_sha256','success'].every(k=>
          !u.searchParams.has(k)||u.searchParams.get(k)==='eq.'+String(held[k]));
        return Response.json(matches?[{id:held.id}]:[]);
      }
      assert.equal(request.method,'POST','No snapshot update or deletion');
      const body=await request.json();inserted.push(body);
      if(options.insertError)return Response.json({code:'23514',message:'snapshot insert refused'},{status:400});
      if(options.race||options.existing?.success===false){
        if(options.race)held={...body,id:snapshotId,success:options.race!=='failed',
          ...(options.race==='other-url'?{listing_url:'https://example.test/another'}:{})};
        return Response.json({code:'23505',message:'snapshot key already exists'},{status:409});
      }
      if(options.missingReceipt)return Response.json(null,{status:201});
      held={...body,id:snapshotId};
      if(!request.headers.get('prefer')?.includes('return=representation'))return new Response(null,{status:201});
      return Response.json({id:snapshotId},{status:201});
    }},
  });
  return {requests,inserted,held:()=>held,run:()=>runInNewContext('(async()=>{'+archive+';return {snapshotSaved};})()',{
    crypto:{createHash},supabase:db,d:detail,commentsAndBids:rows,canonicalUrl:sourceUrl,nowIso:clock,
    isEnded:true,allPhotos:[],fullDescription:'Original retained narrative',
    describePgError:error=>`${error.message} code=${error.code}`,
  })};
}

test('C&B archive requires the SDK persisted ID and preserves the exact source payload',async()=>{
  const f=fixture();assert.equal((await f.run()).snapshotSaved,1);
  assert.equal(f.inserted.length,1);assert.equal(f.held().id,snapshotId);
  const row=f.held();assert.equal(row.fetched_at,clock);assert.equal(row.success,true);
  assert.equal(row.html_sha256,createHash('sha256').update(row.html).digest('hex'));
  const body=JSON.parse(row.html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]);
  assert.deepEqual(body,{detail,comments_count:rows.length,comments_and_bids:rows});
  assert(f.requests.at(-1).prefer.includes('return=representation'));
});
test('C&B archive refuses a rejected snapshot insert before the model path',async()=>{
  const f=fixture({insertError:true});await assert.rejects(f.run(),/Snapshot insert failed.*snapshot insert refused/);
  assert.equal(f.held(),null);
});
test('C&B archive refuses missing persisted IDs before the model path',async()=>{
  const f=fixture({missingReceipt:true});await assert.rejects(f.run(),/no persisted snapshot receipt/);
});
test('C&B archive refuses lookup errors without attempting an insert',async()=>{
  const f=fixture({lookupError:true});await assert.rejects(f.run(),/Snapshot lookup failed.*snapshot lookup refused/);
  assert.equal(f.inserted.length,0);
});
test('C&B archive reuses only the exact successful source and hash receipt',async()=>{
  const seed=fixture();await seed.run();const original=seed.held();
  const f=fixture({existing:original});assert.equal((await f.run()).snapshotSaved,1);
  assert.equal(f.inserted.length,0);assert.deepEqual(f.held(),original);
  assert.deepEqual(f.requests[0].params,{select:'id',platform:'eq.carsandbids',listing_url:'eq.'+sourceUrl,
    html_sha256:'eq.'+original.html_sha256,success:'eq.true',limit:'1'});
});
test('C&B archive does not promote or overwrite an unsuccessful existing capture',async()=>{
  const seed=fixture();await seed.run();const original={...seed.held(),success:false};
  const f=fixture({existing:original});await assert.rejects(f.run(),/Snapshot insert failed/);
  assert.deepEqual(f.held(),original);
});
test('C&B archive accepts a unique-key race only after exact successful readback',async()=>{
  const f=fixture({race:'success'});assert.equal((await f.run()).snapshotSaved,1);
  assert.deepEqual(f.requests.map(r=>r.method),['GET','POST','GET']);
});
for(const race of ['failed','other-url'])test(`C&B archive refuses a ${race} race receipt`,async()=>{
  const f=fixture({race});await assert.rejects(f.run(),/Snapshot insert failed/);
  assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});
test('C&B capture quality refusal remains before archival or model writes',async()=>{
  const bodyStart=source.indexOf('{',source.indexOf('async function extractSingleAuctionGoldStandard('));
  const prefix=source.slice(bodyStart+1,end);let calls=0;
  const capRows=Array.from({length:1000},(_,i)=>({...rows[0],id:i}));
  const cab={callApi:async(version)=>version==='v2'?{ok:true,data:detail}:{ok:true,data:{comments_and_bids:capRows}}};
  await assert.rejects(runInNewContext('(async()=>{'+prefix+'})()',{
    cab,auctionId:detail.id,requireCabCapture,supabase:{from(){calls++;throw Error('write reached');}},
  }),/response_limit_reached/);
  assert.equal(calls,0);
});
