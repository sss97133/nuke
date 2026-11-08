import { strict as assert } from "node:assert";
import { pcarBidCapture, pcarBidObservation } from "./pcarBidCapture.ts";
import { parsePcarBids } from "./boards.ts";
import { sha256Hex } from "../_shared/batAuctionRecord.ts";
import { observationHashInput } from "../_shared/observationIdentity.ts";

const snapshot="00000000-0000-4000-8000-000000000001", vehicle="00000000-0000-4000-8000-000000000002";
const url="https://www.pcarmarket.com/auction/fixture-911";
const fetchedAt="2026-11-08T19:20:33.789123Z", receivedAt="2026-11-08T19:20:34.000Z";
// Measured native object shape and clocks; bidder reference is synthetic.
const html='<html><body><script>lot={bids:$R[1]=[$R[2]={id:"32edc5e5-fd57-4d33-be08-1c02aee149b2",amount:3400000,date:"2026-11-08T19:13:58Z",bidStatus:"WINNING",bidderIdentifier:"FixtureBidder",reactiveBid:!1,maxAmount:null}]}</script></body></html>';
async function fixture(patch:Record<string,unknown>={}, snapshotId:string|null=snapshot) {
 const hash=await sha256Hex(html);
 const row={id:snapshot,platform:"pcarmarket",listing_url:url,success:true,http_status:200,html,html_storage_path:null,html_sha256:hash,fetched_at:fetchedAt,...patch};
 const filters:any[]=[];
 const q:any={select(){return q;},eq(...args:any[]){filters.push(args);return q;},lte(...args:any[]){filters.push(args);return q;},order(){return q;},limit(){return Promise.resolve({data:[row],error:null});}};
 const db:any={from(){return q;},storage:{from(){return {download:async()=>({data:new Blob([html]),error:null})};}}};
 const fetched:any={html,markdown:null,source:"direct",cached:false,snapshotId,url,platform:"pcarmarket",statusCode:200,error:null,costCents:0};
 return {db,fetched,filters,row,hash};
}
Deno.test("real SSR bid builder carries exact retained capture and distinct clocks into canonical payload",async()=>{
 const f=await fixture(),capture=await pcarBidCapture(f.db,f.fetched,receivedAt);
 const bids=parsePcarBids(html);assert.equal(bids.length,1);
 const body=pcarBidObservation(bids[0],{url:url.replace("www.",""),vehicle_id:vehicle},capture);
 assert.equal(body.raw_source_ref,`listing_page_snapshots:${snapshot}`);
 assert.equal(body.observed_at,"2026-11-08T19:13:58Z");assert.equal(body.structured_data.amount,34000);
 assert.equal(body.structured_data.bidder,"FixtureBidder");assert.equal(body.structured_data.bid_status,"WINNING");
 assert.equal(body.extraction_metadata.source_capture.fetched_at,fetchedAt);
 assert.equal(body.extraction_metadata.received_at,receivedAt);
 assert.equal(body.extraction_metadata.source_capture_sha256,await sha256Hex(html));
 assert.equal(body.source_identifier,"pcarmarket-bid:32edc5e5-fd57-4d33-be08-1c02aee149b2");
 assert.equal(body.defer_analysis,true);
 assert.ok(f.filters.some(v=>v[0]==="html_sha256" && v[1]===f.hash));
});
Deno.test("deduplicated same body finds exact original capture without inventing a fresh capture clock",async()=>{
 const f=await fixture({},null),capture=await pcarBidCapture(f.db,f.fetched,receivedAt);
 assert.equal(capture.snapshot_id,snapshot);assert.equal(capture.fetched_at,fetchedAt);
 assert.ok(!f.filters.some(v=>v[0]==="id"));
});
Deno.test("capture clocks and refs do not fork a native bid hash on retry or enrich an existing receipt silently",async()=>{
 const f=await fixture(),capture=await pcarBidCapture(f.db,f.fetched,receivedAt),bid=parsePcarBids(html)[0];
 const lot={url,vehicle_id:vehicle},body=pcarBidObservation(bid,lot,capture);
 const retry=pcarBidObservation(bid,lot,{...capture,snapshot_id:"00000000-0000-4000-8000-000000000009",received_at:"2026-11-08T19:21:00Z"});
 const legacy={...body,raw_source_ref:undefined,extraction_metadata:undefined};
 assert.equal(observationHashInput(body),observationHashInput(retry));
 assert.equal(observationHashInput(body),observationHashInput(legacy));
});
Deno.test("matching storage body is verified without an additional publisher fetch",async()=>{
 const f=await fixture({html:null,html_storage_path:"pcarmarket/fixture.html"});
 assert.equal((await pcarBidCapture(f.db,f.fetched,receivedAt)).html_sha256,f.hash);
});
for(const [label,patch] of Object.entries({
 "foreign URL":{listing_url:"https://www.pcarmarket.com/auction/other"},
 "foreign platform":{platform:"bat"},"wrong returned id":{id:"00000000-0000-4000-8000-000000000009"},
 "wrong hash":{html_sha256:"0".repeat(64)},"body changed":{html:html+"changed"},"receipt only":{html:null},
 "future capture":{fetched_at:"2026-11-08T19:21:00Z"},"missing clock":{fetched_at:null},
 "failed capture":{success:false},"HTTP failure":{http_status:403},"unsafe storage":{html:null,html_storage_path:"../private"},
})) Deno.test(`capture refuses ${label}`,async()=>{
 const f=await fixture(patch);await assert.rejects(()=>pcarBidCapture(f.db,f.fetched,receivedAt));
});
Deno.test("missing/ambiguous retention and archive failures stay visible",async()=>{
 const f=await fixture();f.db.from=()=>({select(){return this;},eq(){return this;},lte(){return this;},order(){return this;},limit:async()=>({data:[],error:null})});
 await assert.rejects(()=>pcarBidCapture(f.db,f.fetched,receivedAt),/missing or ambiguous/);
 const g=await fixture();g.fetched.archiveError="write refused";
 await assert.rejects(()=>pcarBidCapture(g.db,g.fetched,receivedAt),/retained source required/);
});
Deno.test("bid payload cannot attach another lot's proven capture",async()=>{
 const f=await fixture(),capture=await pcarBidCapture(f.db,f.fetched,receivedAt);
 assert.throws(()=>pcarBidObservation(parsePcarBids(html)[0],{url:"https://pcarmarket.com/auction/other",vehicle_id:vehicle},capture),/lot\/capture mismatch/);
});
