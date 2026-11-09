import { CC_LISTING_METHOD, collectingCarsReceipt, collectingCarsAdmissionMatches, prepareCollectingCarsLedger, readCollectingCarsInventory } from "./collectingCars.ts";
import { planIngests, createIntakeBudget, intakeThrottle, selectIntakeFeeds } from "./ledger.ts";
import { splitByYear } from "./yearFilter.ts";
const equal = (a: unknown,b: unknown) => { if(JSON.stringify(a)!==JSON.stringify(b)) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const now = Date.parse("2026-11-09T18:10:00Z"), at = "2026-11-09T18:06:17.990123+00:00";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const porsche = "https://collectingcars.com/for-sale/1965-porsche-911-2-0-swb-4";
function fixture(count=221) {
  const rows = Array.from({length:count},(_,i)=>({id:id(i+1), external_auction_id:String(94000+i),
    external_auction_url:i===220?porsche:`https://collectingcars.com/for-sale/1978-test-${i}`,
    auction_end_time:"2026-11-16T06:00:00Z",is_live:true,last_synced_at:at,board:"collecting-cars"}));
  const source:any = {id:id(3000),last_successful_sync:at,last_sync_error:null,scraping_config:{live_board:{last_run:{at,complete:true,lots:count,upserted:count}}}};
  const calls:any[]=[];let fail=false;
  const db={from(table:string){let range=[0,199];const q:any={then(fn:any){return Promise.resolve({data:table==="live_auction_sources"?source:rows.slice(range[0],range[1]+1),error:fail?{message:"unavailable"}:null}).then(fn)}};
    for(const method of ["select","eq","order","range","abortSignal","maybeSingle"])q[method]=(...args:any[])=>{calls.push([table,method,...args]);if(method==="range")range=args;if(method==="abortSignal")args[0].throwIfAborted();return q;};return q;}};
  return {rows,source,calls,db,fail:()=>fail=true};
}
const read=(f:ReturnType<typeof fixture>)=>readCollectingCarsInventory(f.db,now,new AbortController().signal);
async function rejects(fn:()=>Promise<unknown>,message:string){try{await fn();}catch(error){if(String(error).includes(message))return;throw error;}throw Error("Expected refusal");}
Deno.test("retained CC discovery pages one exact complete batch and includes the real thin Porsche without a source request",async()=>{
  const f=fixture();const r=await read(f);equal(r.urls,f.rows.map(row=>row.external_auction_url));equal(r.urls[220],porsche);equal(r.receipt,{scope:"retained_current_collecting_cars_inventory",inventory_recorded_at:at,inventory_lots:221,eligible_lots:221,pages:2,complete:true});
  equal(f.calls.filter(c=>c[1]==="range").map(c=>c.slice(2)),[[0,199],[200,220]]);
  equal(f.calls.filter(c=>c[1]==="eq"&&c[2]==="last_synced_at").every(c=>c[3]===at),true);
  equal(splitByYear([...r.urls,"https://collectingcars.com/for-sale/2023-porsche-test"],1964,1991).keep,r.urls);
  equal(splitByYear([...r.urls,"https://collectingcars.com/for-sale/2023-porsche-test"],1964,1991).rest.length,1);
});
Deno.test("complete retained inventory can honestly be empty; retired/elapsed lots are not current",async()=>{
  equal((await read(fixture(0))).receipt.eligible_lots,0);
  const f=fixture(3);f.rows[0].is_live=false;f.rows[1].auction_end_time="2026-11-09T17:00:00Z";
  equal((await read(f)).urls,[f.rows[2].external_auction_url]);
});
Deno.test("retained inventory refuses stale/future/partial/mismatched/error/oversized source batches",async()=>{
  for(const patch of [{complete:false},{lots:2001,upserted:2001},{lots:-1},{lots:1.5},{upserted:220},{at:"2026-11-09T17:00:00Z"},{at:"2026-11-09T19:00:00Z"}]){
    const f=fixture();Object.assign(f.source.scraping_config.live_board.last_run,patch);await rejects(()=>read(f),"retained_inventory_not_current_complete");
  }
  const f=fixture();f.source.last_sync_error="reader error";await rejects(()=>read(f),"retained_inventory_not_current_complete");
});
Deno.test("retained pagination refuses a changing or truncated batch rather than acknowledging a partial fleet",async()=>{
  const f=fixture();f.rows.pop();await rejects(()=>read(f),"retained_inventory_batch_changed_or_truncated");
  const bad=fixture();bad.fail();await rejects(()=>read(bad),"retained_inventory_source_unavailable");
});
Deno.test("retained inventory rejects wrong source, unknown ID, foreign URL and receipt-clock mutation",async()=>{
  for(const patch of [{board:"bat"},{id:"invalid"},{external_auction_id:""},{external_auction_url:"https://foreign.test/for-sale/1965-porsche"},{external_auction_url:porsche+"?other=lot"},{last_synced_at:"2026-11-09T18:07:00Z"}]){
    const f=fixture(2);Object.assign(f.rows[0],patch);await rejects(()=>read(f),"retained_inventory_identity_invalid");
  }
  const f=fixture(2);f.rows[1].external_auction_url=f.rows[0].external_auction_url;await rejects(()=>read(f),"retained_inventory_duplicate_url");
});
Deno.test("retained inventory preserves the caller cancellation boundary",async()=>{
  const f=fixture();await rejects(()=>readCollectingCarsInventory(f.db,now,AbortSignal.abort()),"AbortError");
});
const receipt={observation_id:id(4000),snapshot_id:id(5000),source_read_at:"2026-11-09T17:00:00Z",images:67};
const obs={id:receipt.observation_id,vehicle_id:id(6000),source_id:id(7000),source_url:porsche,kind:"listing",extraction_method:CC_LISTING_METHOD,is_superseded:false,raw_source_ref:`listing_page_snapshots:${receipt.snapshot_id}`,observed_at:receipt.source_read_at};
Deno.test("full-listing receipt is exact and whitelisted, not a scalar price/vehicle presence",()=>{
  equal(collectingCarsReceipt({...receipt,raw_html:"private"},now),receipt);
  equal(collectingCarsAdmissionMatches(receipt,obs,porsche,id(6000),id(7000)),true);
  for(const patch of [{source_url:porsche+"/"},{vehicle_id:id(1)},{source_id:id(2)},{kind:"bid"},{extraction_method:"cc_native_bid_v2"},{is_superseded:true},{raw_source_ref:"wrong"},{observed_at:"2026-11-09T16:00:00Z"}])equal(collectingCarsAdmissionMatches(receipt,{...obs,...patch},porsche,id(6000),id(7000)),false);
  for(const patch of [{images:-1},{images:1.5},{observation_id:"wrong"},{snapshot_id:"wrong"},{source_read_at:"invalid"},{source_read_at:"2026-11-09T19:00:00Z"}])equal(collectingCarsReceipt({...receipt,...patch},now),null);
});
Deno.test("old complete scalar ledgers re-enter bounded intake; valid full capture settles; failed backoff/caps survive",()=>{
  const urls=[porsche,"old-complete","backoff","exhausted","good","old-skipped","native-skipped"];
  const ledger=new Map<string,any>([
    ["old-complete",{status:"complete",vehicle_id:id(6000)}],["backoff",{status:"failed",attempts:1,max_attempts:3,next_attempt_at:"2026-11-10T00:00:00Z"}],
    ["exhausted",{status:"failed",attempts:3,max_attempts:3}],["good",{status:"complete",vehicle_id:id(6000)}],
    ["old-skipped",{status:"skipped"}],["native-skipped",{status:"skipped"}],
  ]);
  const raw=new Map([["good",{collecting_cars_receipt:receipt}],["native-skipped",{collecting_cars_native_version:CC_LISTING_METHOD}]]);
  const admitted=new Map([[receipt.observation_id,{...obs,source_url:"good"}]]);
  const proved=prepareCollectingCarsLedger(urls,ledger,raw,admitted,id(7000),1440,now);
  equal([...proved],["good"]);
  const plan=planIngests(urls,new Set(),ledger,new Date(now),2);equal(plan.toIngest,[porsche,"old-complete"]);equal(plan.backoff,1);equal(plan.settled,3);
  equal(ledger.get("exhausted").attempts,3);equal(ledger.get("backoff").attempts,1);
});
Deno.test("full listing admission must be current within existing feed interval and exact immutable source clock",()=>{
  const ledger=new Map<string,any>([[porsche,{status:"complete",vehicle_id:id(6000)}]]);
  const raw=new Map([[porsche,{collecting_cars_receipt:receipt}]]);
  prepareCollectingCarsLedger([porsche],ledger,raw,new Map([[receipt.observation_id,obs]]),id(7000),30,now);equal(ledger.size,0);
});
Deno.test("CC remains subject to existing feed cadence and global zero allowance",()=>{
  const feed={id:id(1),source_slug:"collecting-cars",last_polled_at:new Date(now-60_000).toISOString(),poll_interval_minutes:1440,enabled:true,error_count:0};
  const throttle=intakeThrottle({enabled:true,max_ingests:0});
  equal(createIntakeBudget(throttle,now).reserve("collecting-cars"),null);
  equal(selectIntakeFeeds([feed],1,intakeThrottle({}),now,false),[]);
});

Deno.test("retained CC inventory preserves legitimate plus and uppercase native slugs",async()=>{
  const f=fixture(2);f.rows[0].external_auction_url="https://collectingcars.com/for-sale/1965-Porsche-911+SWB";
  equal((await read(f)).urls,f.rows.map(row=>row.external_auction_url));
});

Deno.test("retained inventory respects the explicit2000-lot ceiling using bounded200-row pages",async()=>{
  const f=fixture(2000);const result=await read(f);equal(result.urls.length,2000);equal(result.receipt.pages,10);
  equal(f.calls.filter(c=>c[1]==="range").every(c=>c[3]-c[2]<200),true);
});
