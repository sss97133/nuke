import { strict as assert } from "node:assert";
import { admitBatHtmlRecovery, findBatHtmlRecoveryMonitor } from "./batHtmlRecovery.ts";
import { ingestBatLive } from "../ingest-observation/batLive.ts";

const monitor = "00000000-0000-0000-0000-000000000001";
const vehicle = "00000000-0000-0000-0000-000000000002";
const source = "00000000-0000-0000-0000-000000000003";
const url = "https://bringatrailer.com/listing/fixture-k5/";
const receivedAt = "2026-11-08T19:30:09.602Z";
Deno.test("normal monitor lookup stays on the vehicle index without fallback reads",async()=>{
  const row={id:monitor,vehicle_id:vehicle,external_auction_url:url};
  let reads=0;
  const q:any={select(){return q;},eq(key:string,value:string){assert.equal(key,"vehicle_id");assert.equal(value,vehicle);return q;},
    in(){return q;},limit(){return Promise.resolve({data:[row],error:null});}};
  assert.deepEqual(await findBatHtmlRecoveryMonitor({from(table:string){reads++;assert.equal(table,"monitored_auctions");return q;}},[url],vehicle),row);
  assert.equal(reads,1);
});
Deno.test("exact unique monitor locator survives canonical vehicle resolution without a rebind",async()=>{
  const row={id:monitor,vehicle_id:vehicle,external_auction_url:url,is_live:true};
  let limited=0;const filters:any[]=[];
  const db={from(table:string){const eqs:any[]=[];return {
    select(){return this;},eq(key:string,value:string){eqs.push([key,value]);filters.push([table,key,value]);return this;},
    in(column:string,urls:string[]){assert.equal(column,"external_auction_url");assert.deepEqual(urls,[url]);return this;},
    single(){return Promise.resolve({data:{id:source},error:null});},
    limit(n:number){limited=n;return Promise.resolve({data:eqs.some(([k])=>k==="vehicle_id")?[]:[row],error:null});}};}};
  assert.deepEqual(await findBatHtmlRecoveryMonitor(db,[url],"canonical-vehicle"),row);assert.equal(limited,2);
  assert.ok(filters.some(([t,k,v])=>t==="monitored_auctions"&&k==="external_auction_id"&&v==="fixture-k5"));
  assert.ok(filters.some(([t,k,v])=>t==="monitored_auctions"&&k==="source_id"&&v===source));
});
Deno.test("recovery refuses ambiguous, foreign and failed locator reads",async()=>{
  for(const data of [[{id:monitor,external_auction_url:url},{id:vehicle,external_auction_url:url}],
    [{id:monitor,external_auction_url:"https://bringatrailer.com/listing/foreign/"}],null]) {
    const q:any={select(){return q;},eq(){return q;},in(){return q;},limit(){return Promise.resolve({data,error:null});}};
    await assert.rejects(()=>findBatHtmlRecoveryMonitor({from(){return q;}},[url],vehicle));
  }
  const q:any={select(){return q;},eq(){return q;},in(){return q;},limit(){return Promise.resolve({data:null,error:{message:"unavailable"}});}};
  await assert.rejects(()=>findBatHtmlRecoveryMonitor({from(){return q;}},[url],vehicle),/unavailable/);
});
// Eight historical bid values/source clocks from the measured K5 shape; aliases
// and member identifiers are synthetic. All native fields remain attributable.
const bids = [100,222,50000,51000,60000,70000,72000,75000].map((bidAmount,i)=>({
  id: 1000+i,post:"125706455",type:"bat-bid",bidAmount,timestamp:1793909610+i*1000,
  authorId:2000+i,authorName:`Fixture${i}`,authorUrl:`https://bringatrailer.com/member/fixture${i}/`,
  authorDeleted:false,approved:"1",wasEdited:false,end_timestamp:1794515340,
  content:`USD $${bidAmount} bid placed by Fixture${i}`,markup:`<p>Native bid ${i}</p>`,
  likes:2,authorLikes:4,likers:["source-public-reference"],channels:[`comment;item;${1000+i}`],
  images:[],videos:[],featured:false,commentParent:null,unflaggable:false,unratable:false,
}));
function fixture() {
  const calls:any[]=[];
  const db={from(table:string){
    const data = table==="monitored_auctions" ? [{id:monitor,source_id:source,vehicle_id:vehicle,external_auction_url:url,stream_state:{}}]
      : table==="vehicles" ? [{id:vehicle,listing_url:url,origin_metadata:{source:"bat_auctions_page",external_id:"125706455"}}] : {id:source};
    const q:any={select(){return q;},eq(){return q;},in(){return q;},is(){return q;},single(){return Promise.resolve({data,error:null});},
      then(resolve:any,reject:any){return Promise.resolve({data,error:null}).then(resolve,reject);}};
    return q;
  },rpc(_name:string,body:any){calls.push(body);return Promise.resolve({data:{recorded:body.p_frames.length,duplicates:0},error:null});}};
  return {db,calls};
}
Deno.test("scheduled historical bids retain every field through the actual bound canonical intake",async()=>{
  const f=fixture();
  const recorded=await admitBatHtmlRecovery({monitorId:monitor,comments:[...bids,{post:"125706455",id:9000,type:"comment"}],
    receivedAt,bidsOnly:true,admit:body=>ingestBatLive(f.db,body)});
  assert.equal(recorded,8);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].p_heartbeats,[]);
  f.calls[0].p_frames.forEach((frame:any,i:number)=>{
    assert.deepEqual(JSON.parse(frame.raw_frame_json).data.comment,bids[i]);
    assert.equal(frame.post_id,125706455);assert.equal(frame.vehicle_id,vehicle);
    assert.equal(frame.kind,"bid");assert.equal(frame.transport,"direct_html");
    assert.equal(frame.observed_at,new Date(bids[i].timestamp*1000).toISOString());
    assert.equal(frame.received_at,receivedAt);assert.equal(frame.clock_basis,"native_comment_timestamp");
    assert.equal(frame.comment_row.bat_author_id,bids[i].authorId);
    assert.equal(frame.projection_error,null);
    // Existing public tape marks direct_html as recovered, never native-live activity.
    assert.notEqual(frame.transport,"public_pusher");
  });
});
Deno.test("foreign native post refuses the entire batch before canonical admission",async()=>{
  const f=fixture();
  await assert.rejects(()=>admitBatHtmlRecovery({monitorId:monitor,comments:[bids[0],{...bids[1],post:"999999"}],
    receivedAt,bidsOnly:true,admit:body=>ingestBatLive(f.db,body)}),/bat_live_post_mismatch/);
  assert.equal(f.calls.length,0);
});
Deno.test("missing capture clock cannot manufacture a current arrival",async()=>{
  let invoked=false;
  await assert.rejects(()=>admitBatHtmlRecovery({monitorId:monitor,comments:bids,receivedAt:null,bidsOnly:true,
    admit:async()=>{invoked=true;return {success:true};}}),/actual capture clock/);
  assert.equal(invoked,false);
});
Deno.test("closing comments preserve existing50-frame limit and canceled bid payloads",async()=>{
  const batches:any[]=[];
  const comments=Array.from({length:51},(_,i)=>({...bids[0],id:10000+i}));
  comments.push({...bids[1],type:"bat-bid-canceled"});
  await admitBatHtmlRecovery({monitorId:monitor,comments,receivedAt,bidsOnly:false,
    admit:async body=>{batches.push(body);return {success:true};}});
  assert.deepEqual(batches.map(b=>b.frames.length),[50,2]);
  assert.equal(batches[1].frames[1].data.comment.type,"bat-bid-canceled");
});
Deno.test("rejected admission is not converted to successful normalized-only recovery",async()=>{
  await assert.rejects(()=>admitBatHtmlRecovery({monitorId:monitor,comments:bids,receivedAt,bidsOnly:true,
    admit:async()=>({success:false})}),/no lossy bid fallback/);
});
