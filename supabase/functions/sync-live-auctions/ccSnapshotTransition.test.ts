import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { ccBidObservation } from "./boards.ts";
import { chooseCcTransition, planCcTransitions, refreshCcTransition } from "./ccSnapshotTransition.ts";
import { postObservations } from "./postObservations.ts";
import { projectCcEpisodes } from "./ccEpisodeState.ts";
const url="https://collectingcars.com/for-sale/synthetic-cc-transition", vehicle="00000000-0000-4000-8000-000000000001";
const post=(amount:number,at="2026-11-09T01:00:00Z")=>ccBidObservation({url,external_id:"123",current_bid:amount,bid_count:3,currency:"AUD",ends:"2026-11-12T06:05:00Z"},vehicle,at)!;
Deno.test("CC A→B→A source reads admit three canonical transitions and project the returned state; steady reads reuse", async()=>{
  const obs:any[]=[], raw:any[]=[], episodes:any[]=[]; let admits=0;
  const db:any={rpc:()=>({abortSignal:async()=>({error:null,data:[...obs].sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at)).slice(0,2)})}),from:(table:string)=>{
    const filters:any={};const q:any=new Proxy({}, {get:(_t,k)=>k==="then"?(resolve:any)=>{
      let data:any=table==="observation_sources"?{id:"source"}:table==="vehicle_observations"?obs:table==="vehicle_events"?episodes:table==="listing_page_snapshots"?raw:{id:vehicle,listing_url:url};
      if(Array.isArray(data)) { for(const [key,value] of Object.entries(filters)) data=data.filter((r:any)=>Array.isArray(value)?value.includes(r[key]):r[key]===value); if(table==="listing_page_snapshots")data=data[0]??null; }
      resolve({data,error:null});
    }:(...args:any[])=>{if(k==="eq"||k==="in")filters[args[0]]=args[1];return q;}});return q;
  }};
  const original=globalThis.fetch, originalNow=Date.now;
  Date.now=()=>Date.parse("2026-11-09T01:10:00Z");
  globalThis.fetch=async(_u,init)=>{const p=JSON.parse(String(init?.body));const id=`00000000-0000-4000-8000-${String(++admits+10).padStart(12,"0")}`;
    obs.push({...p,id,source_id:"source",is_superseded:false});return Response.json({success:true,observation_id:id});};
  try {
    for(const [i,amount] of [15000,16000,15000,15000].entries()) {
      const p=post(amount,`2026-11-09T01:0${i}:00Z`), native={document:{auctionId:123,slug:"synthetic-cc-transition",lotType:"car",stage:"live",currentBid:amount,noBids:3,currencyCode:"aud",dtStageEndsUTC:"2026-11-12 06:05:00"},receivedAt:p.observed_at};
      const plan=await planCcTransitions(db,[p],Date.now()+5000);assertEquals(plan.deferred,0);
      await postObservations(db,plan.posts,Date.now()+5000,40,async selected=>{
        if(!await refreshCcTransition(db,p,selected,Date.now()+5000))return null;
        const html=JSON.stringify(native.document),sha=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(html)))].map(b=>b.toString(16).padStart(2,"0")).join("");
        const s={id:`00000000-0000-4000-8000-${String(i+100).padStart(12,"0")}`,platform:"collecting-cars",listing_url:url,html,html_sha256:sha,fetched_at:p.observed_at,success:true,http_status:200,metadata:{capture_kind:"typesense_native_document",representation:"complete_selected_document_json_not_wire_response"}};raw.push(s);
        return {...selected,raw_source_ref:`listing_page_snapshots:${s.id}`,extraction_metadata:{received_at:p.observed_at,source_capture:{snapshot_id:s.id,html_sha256:sha,source_url:url,fetched_at:p.observed_at,source_read_at:p.observed_at}}};
      });
      const result=await projectCcEpisodes(db,plan.posts,new Map([[url,native]]),Date.now()+5000,((_db:any,row:any)=>{episodes.splice(0,episodes.length,row);return{action:"updated"};})as any);
      assertEquals(result.refused,0);assertEquals(episodes[0].current_price,amount);
    }
    assertEquals(admits,3);assertEquals(new Set(obs.map(o=>o.source_identifier)).size,3);
    assertEquals(obs[2].structured_data.previous_observation_id,obs[1].id);
    assertEquals(episodes[0].metadata.source_observed_at,"2026-11-09T01:02:00Z");
  } finally {globalThis.fetch=original;Date.now=originalNow;}
});
Deno.test("CC concurrent same transition dedupes; advanced different prior, tied clocks and stale source fail closed",async()=>{
 const a={...post(15000),id:"A"};const b=post(16000,"2026-11-09T01:01:00Z");
 const one=chooseCcTransition(b,[a]),two=chooseCcTransition(b,[a]);assertEquals(one.source_identifier,two.source_identifier);
 let latest:any[]=[{...one,id:"B"}];const db:any={rpc:()=>({abortSignal:async()=>({data:latest,error:null})})};
 assertEquals(await refreshCcTransition(db,b,one,Date.now()+5000),false);
 latest=[{...post(17000,"2026-11-09T01:02:00Z"),id:"C"}];
 await assertRejects(()=>refreshCcTransition(db,b,one,Date.now()+5000));
 assertThrows(()=>chooseCcTransition(b,[a,{...a,id:"other"}]));
 assertThrows(()=>chooseCcTransition(post(16000,"2026-11-08T00:00:00Z"),[a]));
});
Deno.test("CC first v2 state anchors legacy testimony, then unchanged state keeps admitted identity",()=>{
 const legacy={...post(15000),id:"legacy",extraction_method:"cc_typesense_board_bid_v1",source_identifier:"collecting-cars-bid:123:3:15000"};
 const p=post(15000,"2026-11-09T01:01:00Z"),next=chooseCcTransition(p,[legacy]);
 assertEquals(next.source_identifier.endsWith(":after:legacy"),true);
 assertEquals(chooseCcTransition({...p,observed_at:"2026-11-09T01:02:00Z"},[{...next,id:"new"}]).source_identifier,next.source_identifier);
});

import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
Deno.test("CC concurrent different reads may both retain testimony, but older source cannot win final episode projection", async()=>{
 const a={...post(15000),id:"A"};
 const b=chooseCcTransition(post(16000,"2026-11-09T01:01:00Z"),[a]);
 const c=chooseCcTransition(post(17000,"2026-11-09T01:02:00Z"),[a]);
 // Both workers passed pre-admission refresh against A; C projected before slower B.
 const live={id:"episode",event_type:"auction",event_status:"active",source_url:url,sold_at:null,ended_at:"2026-11-12T06:05:00Z",
  metadata:{source_observed_at:c.observed_at,auction_observation_id:"C"},vehicle_event_metadata_digest:"a".repeat(64)};
 let writes=0;
 const db:any={from:()=>{const q:any=new Proxy({}, {get:(_t,k)=>k==="then"?(resolve:any)=>resolve({data:[live],error:null}):()=>{if(k==="update"||k==="insert")writes++;return q;}});return q;}};
 const result=await writeVehicleEventByKey(db,{vehicle_id:vehicle,source_platform:"collecting_cars",source_listing_id:"collectingcars.com/for-sale/synthetic-cc-transition",source_url:url,
  event_type:"auction",event_status:"active",current_price:16000,ended_at:"2026-11-12T06:05:00Z",metadata:{source_observed_at:b.observed_at}},
  {sourceObservedAt:b.observed_at,compactMetadataCas:true,preserveEventStatus:true,activeAuction:{sourceUrl:url,now:"2026-11-09T01:03:00Z"}});
 assertEquals(result.action,"skipped");assertEquals(writes,0);
});

Deno.test("CC equal-clock writers refuse a different observation, allow same receipt retry, and leave default callers unchanged",async()=>{
 const clock="2026-11-09T01:01:00Z";
 const live={id:"episode",metadata:{source_observed_at:clock,auction_observation_id:"first"},sold_at:null,ended_at:null,vehicle_event_metadata_digest:"a".repeat(64)};
 let writes=0;const filters:string[]=[];
 const db:any={from:()=>{let writing=false;const q:any=new Proxy({}, {get:(_t,k)=>k==="then"?(resolve:any)=>resolve({data:writing?[{id:"episode"}]:[live],error:null}):(...args:any[])=>{if(k==="update"){writes++;writing=true;}if(k==="eq")filters.push(args[0]);return q;}});return q;}};
 const row=(id:string)=>({vehicle_id:vehicle,source_platform:"collecting_cars",source_listing_id:"lot",metadata:{source_observed_at:clock,auction_observation_id:id},current_price:16000});
 const policy={sourceObservedAt:clock,compactMetadataCas:true,rejectEqualClockDifferentObservation:true};
 assertEquals((await writeVehicleEventByKey(db,row("second"),policy)).action,"skipped");assertEquals(writes,0);
 assertEquals((await writeVehicleEventByKey(db,row("first"),policy)).action,"updated");assertEquals(writes,1);
 assertEquals(filters.includes("vehicle_event_metadata_digest"),true);
 assertEquals((await writeVehicleEventByKey(db,row("second"),{sourceObservedAt:clock,compactMetadataCas:true})).action,"updated");
 assertEquals(writes,2);
});
