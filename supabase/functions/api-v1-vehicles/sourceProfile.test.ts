import { ECR_METHOD, qualifyEcrCapture } from "../ingest-observation/retainedEcr.ts";
import { readSourceProfile } from "./sourceProfile.ts";
const assert=(v:unknown,message="assertion failed")=>{if(!v)throw Error(message);};
const car="https://exclusivecarregistry.com/details/pagani/zonda/123";
const collection="https://exclusivecarregistry.com/collection/fixture";
async function fixture(previous=false){
  const card='<div class="car_item"><a class="content" href="'+car+'"><img class="image" src="/images/cars/123.jpg"><p class="title">Pagani Zonda F</p></a></div>';
  const html='<main><h1>Fixture collection</h1><div class="car_timeline"><div data-box="cars_1">'+card+'</div>'+(previous?'<div data-box="cars_4">'+card+'</div>':'')+'</div></main>';
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(html))),n=>n.toString(16).padStart(2,"0")).join("");
  const snapshot={id:"11111111-1111-4111-8111-111111111111",platform:"ecr",listing_url:collection,success:true,http_status:200,html_sha256:hash,html,
    fetched_at:"2026-02-16T03:00:00.123456Z",created_at:"2026-02-16T03:00:01.123456Z"};
  const qualified=await qualifyEcrCapture(snapshot,html);assert(qualified.ok);if(!qualified.ok)throw Error("fixture");
  const row={id:"22222222-2222-4222-8222-222222222222",source_id:"source",source_snapshot_id:snapshot.id,source_identifier:qualified.input.source_identifier,
    source_url:collection,kind:"listing",extraction_method:ECR_METHOD,is_superseded:false,vehicle_id:null,subject_type:"organization",subject_id:null,
    observed_at:snapshot.fetched_at,ingested_at:"2026-10-31T04:00:00Z",observed_at_basis:"source_capture_time",source_event_time_precision:"unknown",source_event_at:null,
    structured_data:qualified.input.structured_data};
  let species="aggregator",failRead=false,copies=1;const requests:string[]=[];
  const db={from:(table:string)=>{
    requests.push(table);let urls:string[]=[],contains=false,active=true,captureId:string|null=null;
    const q:any={select:()=>q,eq:(k:string,v:unknown)=>{if(k==="is_superseded")active=v===false;if(k==="source_snapshot_id")captureId=String(v);return q;},in:(k:string,v:string[])=>{if(k==="source_url")urls=v;return q;},order:()=>q,
      contains:()=>{contains=true;return q;},limit:async()=>({data:!active||row.is_superseded||(captureId&&captureId!==row.source_snapshot_id)?[]:contains||urls.includes(row.source_url)?Array.from({length:copies},(_,i)=>({...row,id:row.id.slice(0,-3)+String(i).padStart(3,"0")})):[],error:failRead?{}:null}),
      maybeSingle:async()=>table==="observation_sources"?{data:{id:"source",species},error:null}:{data:snapshot,error:failRead?{}:null}};
    return q;}};
  return {db,row,snapshot,requests,setSpecies:(v:string)=>{species=v;},fail:()=>{failRead=true;},repeat:(n:number)=>{copies=n;}};
}
Deno.test("source URL already embodies a vehicle profile without year, VIN or physical merge",async()=>{
  const f=await fixture();const answer=await readSourceProfile(f.db,car);assert(answer.status===200);
  const data=answer.body.data as any;
  assert(data.source_profile_id==="ecr:123"&&data.vehicle_id===null&&data.label==="Pagani Zonda F");
  assert(data.claims[0].captured_at===f.snapshot.fetched_at&&data.claims[0].relationship==="source_current");
  assert(data.image_url==="https://exclusivecarregistry.com/images/cars/123.jpg");
  assert(data.image_observation_id===data.claims[0].observation_id&&data.image_page_captured_at===f.snapshot.fetched_at);
  assert(data.model_use.attributed_registry_presentation&&!data.model_use.verified_physical_identity&&!data.model_use.independent_corroboration);
  assert(!f.requests.includes("vehicles"),"must not read, restore or reuse deleted/private physical profiles");
  assert(!("vin" in data)&&!("year" in data),"unknowns must not be fabricated");
});
Deno.test("repeated admission of one capture stays one witness and a capped history stays explicitly partial",async()=>{
  const f=await fixture();f.repeat(21);
  const answer=await readSourceProfile(f.db,car),data=answer.body.data as any;
  assert(answer.status===200&&data.claims.length===1&&!data.history.complete);
  assert(data.claims[0].supporting_observation_ids.length===20&&!data.model_use.independent_corroboration);
  assert(f.requests.filter(t=>t==="listing_page_snapshots").length===1,"reuse the verified original within this request");
});
Deno.test("source profile retains both current and previous testimony and traverses its collection",async()=>{
  const f=await fixture(true);const answer=await readSourceProfile(f.db,car);const data=answer.body.data as any;
  assert(data.claims.length===2&&data.claims[1].relationship==="source_previous");
  const own=await readSourceProfile(f.db,collection);const c=own.body.data as any;
  assert(c.members.length===2&&c.enumeration==="captured_cards_only"&&c.members[0].profile_path.includes("source_url="));
  assert(c.members[0].profile_path.includes("capture_id="+f.snapshot.id)&&data.claims[0].collection_profile_path.includes("capture_id="+f.snapshot.id));
  const selected=await readSourceProfile(f.db,collection,f.snapshot.id.toUpperCase());
  assert(selected.status===200&&(selected.body.data as any).history.selected_snapshot_id===f.snapshot.id);
  assert((await readSourceProfile(f.db,collection,"33333333-3333-4333-8333-333333333333")).status===404);
  assert((await readSourceProfile(f.db,collection,"not-a-capture")).status===400);
});
Deno.test("withdrawal, failed reads, source/hash/custody disagreement and hostile URLs refuse a usable profile",async()=>{
  for(const change of [(f:any)=>{f.snapshot.html+="tampered";},(f:any)=>{f.row.structured_data={ecr_capture_receipt:{label:"forged"}};},
    (f:any)=>{f.row.vehicle_id="private-vehicle";},(f:any)=>{f.row.observed_at="2026-02-16T03:00:00Z";},(f:any)=>f.setSpecies("dealer"),(f:any)=>f.fail()]){
    const f=await fixture();change(f);assert((await readSourceProfile(f.db,car)).status===503);
  }
  const f=await fixture();f.row.is_superseded=true;assert((await readSourceProfile(f.db,car)).status===404);
  for(const bad of [car+"?x=1",car.replace(".com/",".com.evil/"),"javascript:alert(1)"])
    assert((await readSourceProfile(f.db,bad)).status===400);
});

Deno.test("actual vehicles API authenticates, reads retained evidence, and refuses source-profile writes or mixed physical IDs",async()=>{
  const keys=["SUPABASE_URL","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY"];
  const prior=keys.map(k=>Deno.env.get(k)),base="https://source-fixture.supabase.co",key="sb_secret_source_fixture";
  Deno.env.set(keys[0],base);Deno.env.set(keys[1],key);Deno.env.set(keys[2],key);
  let handler:(request:Request)=>Promise<Response>=async()=>{throw Error("API handler did not initialize");};
  const serve=Deno.serve;(Deno as any).serve=(fn:typeof handler)=>{handler=fn;};
  try { await import("./index.ts"); } finally { Deno.serve=serve; }
  const f=await fixture();const original=globalThis.fetch;let sourceReads=0;
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
  globalThis.fetch=async(resource,init)=>{
    const u=new URL(resource instanceof Request?resource.url:String(resource));assert(u.origin===base,"unexpected network target");
    if(init?.method==="HEAD") return new Response(null,{status:new Headers(init.headers).get("apikey")==="sb_secret_rotated_fixture"?200:403});
    if(u.pathname.endsWith("/rpc/check_api_key_rate_limit"))return json({allowed:false,error:"invalid_key"});
    assert(!init?.method||init.method==="GET","profile read must never mutate source or vehicle records");
    sourceReads++;
    if(u.pathname.endsWith("/observation_sources"))return json([{id:"source",species:"aggregator"}]);
    if(u.pathname.endsWith("/vehicle_observations"))return json(u.searchParams.has("structured_data")&&!f.row.is_superseded?[f.row]:[]);
    if(u.pathname.endsWith("/listing_page_snapshots"))return json([f.snapshot]);
    throw Error(`Unexpected SDK read ${u.pathname}`);
  };
  const request=(suffix="",method="GET",valid=true)=>handler(new Request(base+"/functions/v1/api-v1-vehicles"+suffix+"?source_url="+encodeURIComponent(car),{
    method,headers:valid?{Authorization:`Bearer ${key}`}:{"X-API-Key":"invalid"},...(method==="POST"?{body:"{}"}:{})}));
  try {
    let r=await request("","GET",false);assert(r.status===401&&sourceReads===0);
    r=await request("","POST");assert(r.status===405&&sourceReads===0);
    r=await request("/22222222-2222-4222-8222-222222222222");assert(r.status===400&&sourceReads===0);
    r=await request();const body=await r.json();assert(r.status===200&&body.data.source_profile_id==="ecr:123",JSON.stringify(body));
    assert(r.headers.get("Cache-Control")==="no-store"&&body.data.claims[0].snapshot_id===f.snapshot.id);
    const address=base+"/functions/v1/api-v1-vehicles?source_url="+encodeURIComponent(car);
    r=await handler(new Request(address+"&capture_id="+f.snapshot.id.toUpperCase(),{headers:{Authorization:`Bearer ${key}`}}));
    assert(r.status===200&&(await r.json()).data.history.selected_snapshot_id===f.snapshot.id);
    r=await handler(new Request(address+"&capture_id=33333333-3333-4333-8333-333333333333",{headers:{Authorization:`Bearer ${key}`}}));
    assert(r.status===503,"a mismatched DB response cannot change the selected capture");
    const forgedFixture="sb_secret_forged",rotatedFixture="sb_secret_rotated_fixture";
    r=await handler(new Request(address,{headers:{apikey:forgedFixture}}));assert(r.status===401);
    r=await handler(new Request(address,{headers:{apikey:rotatedFixture}}));assert(r.status===200);
    f.snapshot.html+="tampered";r=await request();assert(r.status===503);
  } finally {
    globalThis.fetch=original;
    keys.forEach((k,i)=>prior[i]===undefined?Deno.env.delete(k):Deno.env.set(k,prior[i]!));
  }
});
