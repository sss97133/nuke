import { pollMcCormick, projectionWithdrawal } from './mccormick.ts';
import { createIntakeBudget, intakeThrottle } from './ledger.ts';
const origin='https://www.classic-carauction.com';
const now=Date.parse('2026-11-10T17:00:00Z');
const feed={id:'feed',display_name:'Synthetic publisher',source_slug:'mccormicks',feed_url:origin+'/Home',search_criteria:{organization_id:'org'}};
const eq=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
const pages: Record<string,string>={
  '/Home':'Auction 91 is OPEN for registration <a href="/Auction-91">Event</a>',
  '/Auction-91':'Our next auction will be our 91st event. It will take place November 20-22, 2026 at Synthetic Outdoor area.',
  '/Schedule':'FRIDAY, November 20th LOTS 1-140',
  '/auction-cars':'Auction 91 Auction Cars Lots 1-180 Friday <TR><TD><a href="auction-cars?auctionid=1">1</a></TD><TD>photo</TD><TD>1970</TD><TD>FORD</TD><TD>MUSTANG</TD><TD>COUPE</TD></TR>',
  '/Showroom-Inventory':'Showroom Inventory <TR><TD><a href="Showroom-Inventory?sp=1&id=1">41</a></TD><TD>2007</TD><TD>AUDI</TD><TD>A4</TD><TD>$8,500</TD><TD>Available</TD></TR>',
};
async function harness(options:{badCatalog?:boolean;cached?:boolean;nativeFailure?:boolean;staleReadback?:boolean;publicBinding?:boolean;movedDay?:boolean}={}) {
  const snapshots=new Map<string,any>(), writes:any[]=[], calls:any[]=[];
  let census:any;
  let episodes:any[]=options.movedDay?[{id:'old-event',vehicle_id:'public-parent',source_platform:'mccormicks',
    source_listing_id:'mccormicks-91:1',ended_at:'2026-11-19T12:00:00Z',event_status:'upcoming',
    metadata:{native_id:'1',sale_key:'mccormicks-91',projection_method:'mccormick_live_v1'}}]:[];
  const capture=async(url:string,_options:any)=>{
    const html=options.badCatalog&&url.endsWith('/auction-cars')?'Auction 91 Auction Cars':pages[new URL(url).pathname];
    const id=crypto.randomUUID();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(html)))].map(b=>b.toString(16).padStart(2,'0')).join('');
    snapshots.set(id,{id,platform:'mccormicks',listing_url:url,fetched_at:'2026-11-01T00:00:00Z',html_sha256:hash,success:true});
    return {html,snapshotId:id,statusCode:200,cached:options.cached??false} as any;
  };
  const db:any={from:(table:string)=>{
    const filters:any={}, q:any={}; let mutation:any;
    const done=()=>{
      if(mutation){writes.push({table,...mutation});if(table==='source_census')census=mutation.value;
        if(table==='vehicle_events'){
          if(mutation.method==='insert'){const e={id:'inserted',...mutation.value};episodes.push(e);return {data:[{id:e.id}],error:null};}
          const e=episodes.find(e=>e.id===filters.id);if(e)Object.assign(e,mutation.value);return {data:e?[{id:e.id}]:[],error:null};
        }return {data:null,error:null};}
      if(table==='observation_sources')return {data:{id:'source',species:'block_house'},error:null};
      if(table==='vehicle_events')return {data:episodes.filter(e=>Object.entries(filters).every(([k,v])=>k==='metadata->>sale_key'?e.metadata.sale_key===v:e[k]===v)),error:null};
      if(table==='listing_page_snapshots')return {data:snapshots.get(filters.id),error:null};
      return {data:[],error:null};
    };
    for(const method of ['select','limit','in'])q[method]=()=>q;
    q.eq=(key:string,value:any)=>{filters[key]=value;return q;};q.is=q.eq;
    for(const method of ['insert','upsert','update'])q[method]=(value:any)=>{mutation={method,value};return q;};
    q.maybeSingle=async()=>done(); q.then=(yes:any,no:any)=>Promise.resolve(done()).then(yes,no);return q;
  },rpc:async(name:string,args:any)=>{
    if(name==='supersede_vehicle_event_episode'){
      writes.push({table:'supersession',value:args});const e=episodes.find(e=>e.id===args.p_event_id);
      if(!e)throw Error('Missing superseded event');e.id='replacement';e.ended_at=args.p_corrections.ended_at.value;
      e.metadata={...e.metadata,clock_locked_by_supersession:{fields:['ended_at']}};
      return {data:{status:'superseded',replacement_event_id:e.id},error:null};
    }
    if(name==='record_census'){census={census_at:args.p_checked_at,raw_response:args.p_raw_response};writes.push({table:'source_census',value:census});return {data:'census',error:null};}return {data:{source:'mccormicks',checked_at:options.staleReadback?'2020-01-01T00:00:00Z':census?.census_at,inventory:(census?.raw_response.inventory??[]).map((r:any)=>options.publicBinding&&r.inventory_kind==='auction'?{...r,vehicle_id:'public-parent',observation_id:'public-observation'}:r)},error:null};},
    functions:{invoke:async(name:string,invocation:any)=>{
      if(invocation.method==='GET')return {data:{capabilities:{mccormicks_native_fresh_capture:true,mccormicks_native_listing:true}},error:null};
      calls.push({name,...invocation});
      if(options.nativeFailure)return {data:null,error:{message:'HTTP 504 timeout'}};
      const u=new URL(invocation.body.url), native=u.searchParams.has('auctionid')?'1':'showroom:1';
      return {data:{status:'unresolved',vehicle_id:null,mccormick_receipt:{source_id:native,source_checked_at:new Date(now).toISOString(),observation_id:'observation',snapshot_id:'snapshot',source_capture_gaps:[]}},error:null};
    }}};
  const budget=createIntakeBudget(intakeThrottle({max_ingests:4}),now,()=>now);
  const result=await pollMcCormick(db,feed,budget,2,{capture,clock:()=>now});
  return {result,writes,calls,episodes};
}
Deno.test('complete catalogs retained before bounded canonical intake; immutable capture and fresh check clocks remain distinct',async()=>{
  const {result,writes,calls}=await harness();eq(result.error,null);eq(calls.length,2);
  const census=writes.find(w=>w.table==='source_census').value;
  eq(census.raw_response.inventory.map((r:any)=>r.native_id),['1','showroom:1']);
  eq(census.census_at,new Date(now).toISOString());eq(census.raw_response.captures[0].content_captured_at,'2026-11-01T00:00:00Z');
  eq(writes.filter(w=>w.table==='import_queue').map(w=>[w.value.status,w.value.vehicle_id]),[['complete',null],['complete',null]]);
  eq(writes.filter(w=>w.table==='vehicle_events').length,0);
});
Deno.test('incomplete or cached source pages cannot replace a good roster with empty inventory',async()=>{
  for(const options of [{badCatalog:true},{cached:true}]){
    const {result,writes,calls}=await harness(options);
    if(!result.error)throw Error('Expected capture refusal');
    eq(writes.filter(w=>w.table==='source_census').length,0);eq(calls.length,0);
    eq(writes.at(-1).table,'listing_feeds');
  }
});
Deno.test('detail failure preserves complete catalog and retry receipt instead of false success',async()=>{
  const {result,writes}=await harness({nativeFailure:true});
  eq(result.error,'HTTP 504 timeout');eq(writes.filter(w=>w.table==='source_census').length,1);
  const ack=writes.find(w=>w.table==='import_queue').value;
  eq([ack.status,ack.failure_category],['failed','timeout']);
  if(!ack.next_attempt_at)throw Error('Missing retry backoff');
});

Deno.test('public auction binding projects a day-precision source episode through the shared writer',async()=>{
  const {result,writes}=await harness({publicBinding:true});
  eq(result.error,null);
  const event=writes.find(w=>w.table==='vehicle_events')?.value;
  if(!event)throw Error('No public source episode projected');
  eq(event.source_organization_id,'org');eq(event.organization_id,undefined);
  eq(event.metadata.ended_at_precision,'day');eq(event.metadata.projection_method,'mccormick_live_v1');
  eq(event.source_listing_id,'mccormicks-91:1');
});
Deno.test('a newer or unrelated census cannot be projected as this invocation reading',async()=>{
  const {result,calls}=await harness({staleReadback:true});
  eq(result.error,'mccormick_inventory_readback_failed');eq(calls.length,0);
});

Deno.test('unchanged catalog membership retracts an obsolete parent or unverified run day',()=>{
  const old={vehicle_id:'old'}; const lot={run_on:'2026-11-20'} as any;
  eq(projectionWithdrawal(old,undefined,{vehicle_id:'old'}),'not_in_complete_current_catalog');
  eq(projectionWithdrawal(old,{run_on:null} as any,{vehicle_id:'old'}),'current_run_day_unverified');
  eq(projectionWithdrawal(old,lot,{}),'current_public_binding_unavailable');
  eq(projectionWithdrawal(old,lot,{vehicle_id:'new'}),'current_public_binding_changed');
  eq(projectionWithdrawal(old,lot,{vehicle_id:'old'}),null);
});

Deno.test('a moved lot hides its obsolete projection, supersedes the clock, then publishes the consistent replacement',async()=>{
  const {result,writes,episodes}=await harness({publicBinding:true,movedDay:true});eq(result.error,null);
  const retirement=writes.findIndex(w=>w.table==='vehicle_events'&&w.value.metadata?.withdrawal_basis==='scheduled_run_day_changed');
  const correction=writes.findIndex(w=>w.table==='supersession');
  if(retirement<0||correction<=retirement)throw Error('Old run-day projection must be hidden before correction');
  eq(writes[correction].value.p_corrections.ended_at,{expected:'2026-11-19T12:00:00Z',value:'2026-11-20T12:00:00Z',precision:'day'});
  eq(episodes[0].ended_at,'2026-11-20T12:00:00Z');eq(episodes[0].metadata.auction_session_days,['2026-11-20']);
  eq(episodes[0].metadata.withdrawn_at,null);
});
