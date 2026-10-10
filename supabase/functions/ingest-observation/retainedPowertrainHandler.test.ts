import { RETAINED_POWERTRAIN_FIELDS } from "./retainedPowertrain.ts";
const assert=(ok: unknown)=>{if(!ok)throw Error("assertion failed");};
const VID="22222222-2222-4222-8222-222222222222", SID="4cdc735c-f117-42f2-889f-ba33805639a5", PARENT="11111111-1111-4111-8111-111111111111";
const saved=[Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
Deno.env.set("SUPABASE_URL","https://db.test");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-key");
let handler:(req:Request)=>Promise<Response>;
const serve=Deno.serve;(Deno as any).serve=(fn:typeof handler)=>{handler=fn;};
await import("./index.ts");Deno.serve=serve;
Deno.test("real powertrain selector uses registered keys, canonical hash/dedup and typed parent; no model calls",async()=>{
 Deno.env.set("SUPABASE_URL","https://db.test");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-key");
 const original=globalThis.fetch,rows=new Map<string,any>();let writes=0;let native=false;
 const nativeText="This vehicle is offered with service records and a clean title. The car is powered by a 1.8-liter inline-four paired with a five-speed manual transmission.";
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
 globalThis.fetch=async(resource,init)=>{
  const url=new URL(typeof resource==="string"?resource:resource instanceof URL?resource.href:resource.url);
  assert(url.pathname.startsWith("/rest/v1/"));
  const options=init as {method?:string;body?:unknown}|undefined;
  const body=typeof options?.body==="string"?JSON.parse(options.body):null;
  if(url.pathname.endsWith("vehicles"))return respond([{id:VID,is_public:true,deleted_at:null,listing_kind:"vehicle"}]);
  if(url.pathname.endsWith("observation_sources"))return respond([{id:SID,slug:"bat",base_trust_score:.85,supported_observations:["listing","specification"]}]);
  if(url.pathname.endsWith("observation_properties"))return respond([{id:VID,namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]}]);
  if(url.pathname.endsWith("vehicle_observations")){
   if(options?.method==="POST"){
    assert(body.source_observation_id===PARENT && body.vehicle_id===VID && body.property_id===VID);
    assert(body.confidence_score<=.6 && body.agent_cost_cents===0 && body.agent_model===null);
    assert(body.structured_data.source_value && body.structured_data.normalization_version==="retained_powertrain_v1");
    if(native)assert(body.structured_data.source_field==="content_text" && body.structured_data.source_witness_version==="retained_description_powertrain_v1");
    const row={...body,id:`77777777-7777-4777-8777-${String(++writes).padStart(12,"0")}`};rows.set(body.content_hash,row);return respond(row,201);
   }
   if(url.searchParams.has("id"))return respond([{id:PARENT,vehicle_id:VID,source_id:SID,kind:"listing",is_superseded:false,
    property_id:null,subject_type:"vehicle",subject_id:null,source_url:"https://bringatrailer.com/listing/fixture",observed_at:native?"2026-10-05T00:20:04.123456Z":null,
    ingested_at:"2026-10-05T00:20:05.123456Z",extraction_method:native?"html_description_capture":"html_match",confidence_score:.85,
    ...(native?{content_text:nativeText,
    structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",description_capture:true,
    source_capture_basis:"direct_fetch",source_capture_sha256:"a".repeat(64),source_captured_at:"2026-10-05T00:20:04.123456Z",
    observation_time_basis:"source_capture",source_event_time_status:"unknown",extractor_input_truncated:false}}:
    {structured_data:{engine_size:"302ci V8",transmission:"Four-Speed Manual",drivetrain:"4WD"}})}]);
   const hash=url.searchParams.get("content_hash")?.slice(3);return respond(hash&&rows.has(hash)?[rows.get(hash)]:[]);
  }
  throw Error(`unexpected route ${url.pathname}`);
 };
 try{
  for(const nativeMode of [false,true]){
   native=nativeMode;
   for(const key of Object.keys(RETAINED_POWERTRAIN_FIELDS).filter(k=>!native || k!=="drivetrain_layout")){
   const request=(extra={})=>new Request("https://db.test/functions/v1/ingest-observation",{method:"POST",
    headers:{Authorization:"Bearer test-key","Content-Type":"application/json"},
    body:JSON.stringify({mode:`retained_listing_${key}_v1`,source_observation_id:PARENT,...extra})});
   const first=await handler(request());assert(first.status===200 && (await first.json()).success);
   const replay=await handler(request());assert(replay.status===200 && (await replay.json()).duplicate===true);
   assert((await handler(request({structured_data:{[key]:"forged"}}))).status===400);
  }
  }
  assert(writes===7 && rows.size===7);
 }finally{
  globalThis.fetch=original;
  for(const [i,key] of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].entries()){
   if(saved[i]===undefined)Deno.env.delete(key);else Deno.env.set(key,saved[i]!);
  }
 }
});
Deno.test("service replay reuses qualified inputs only within its batch and still proves every completion",async()=>{
 const original=globalThis.fetch;
 Deno.env.set("SUPABASE_URL","https://db.test");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-key");
 const properties=[
  ["c0f743ae-dc94-4dfd-98ef-514b76f74a9b","engine_configuration"],
  ["66b2f1f6-b714-4ac0-85b6-60ba89529c1a","engine_displacement_l"],
  ["235aed17-9bd3-4886-90be-9b1a8e2d1844","transmission_type"],
  ["32b51f19-e5cf-4f67-81d9-96c2d30885a1","drivetrain_layout"],
 ];
 const counts={parent:0,vehicle:0,source:0,property:0,insert:0,finish:0};
 let privateVehicle=false, failFirstParent=false, rejectCompletion=false;
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
 globalThis.fetch=async(resource,init)=>{
  const url=new URL(typeof resource==="string"?resource:resource instanceof URL?resource.href:resource.url);
  assert(url.pathname.startsWith("/rest/v1/"));
  const options=init as {method?:string;body?:unknown}|undefined;
  const body=typeof options?.body==="string"?JSON.parse(options.body):null;
  if(url.pathname.endsWith("claim_retained_listing_properties"))return respond(properties.map(([property_id,key])=>({
   source_observation_id:PARENT,property_id,mode:`retained_listing_${key}_v1`})));
  if(url.pathname.endsWith("finish_retained_listing_property")){
   counts.finish++;
   // Models the live DB proof refusing stale custody even if a prior read was cached.
   return respond(!(rejectCompletion && body.p_status==="done"));
  }
  if(url.pathname.endsWith("vehicles")){counts.vehicle++;return respond([{id:VID,is_public:!privateVehicle,deleted_at:null,listing_kind:"vehicle"}]);}
  if(url.pathname.endsWith("observation_sources")){counts.source++;return respond([{id:SID,slug:"bat",base_trust_score:.85,supported_observations:["listing","specification"]}]);}
  if(url.pathname.endsWith("observation_properties")){
   counts.property++;const key=url.searchParams.get("property_key")!.slice(3);
   return respond([{id:properties.find(p=>p[1]===key)![0],property_key:key,namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]}]);
  }
  if(url.pathname.endsWith("vehicle_observations")){
   if(options?.method==="POST"){
    counts.insert++;assert(body.source_observation_id===PARENT && body.agent_cost_cents===0 && body.agent_model===null);
    return respond({...body,id:`77777777-7777-4777-8777-${String(counts.insert).padStart(12,"0")}`},201);
   }
   if(url.searchParams.has("id")){
    counts.parent++;if(failFirstParent && counts.parent===1)return respond({code:"fixture_unavailable",message:"unavailable"},400);
    return respond([{id:PARENT,vehicle_id:VID,source_id:SID,kind:"listing",is_superseded:false,property_id:null,
     subject_type:"vehicle",subject_id:null,source_url:"https://bringatrailer.com/listing/fixture",observed_at:null,
     ingested_at:"2026-10-05T00:20:05.123456Z",extraction_method:"html_match",confidence_score:.85,
     structured_data:{engine_size:"302ci V8",transmission:"Four-Speed Manual",drivetrain:"4WD"}}]);
   }
   return respond([]);
  }
  throw Error(`unexpected route ${url.pathname}`);
 };
 const request=(body:unknown)=>new Request("https://db.test/functions/v1/ingest-observation",{method:"POST",
  headers:{Authorization:"Bearer test-key","Content-Type":"application/json"},body:JSON.stringify(body)});
 const drain=async()=>{const r=await handler(request({mode:"retained_listing_property_drain_v1",batch_size:120}));assert(r.status===200);return r.json();};
 const reset=()=>{for(const k of Object.keys(counts))counts[k as keyof typeof counts]=0;};
 try{
  for(let batch=0;batch<2;batch++){
   reset();const receipt=await drain();
   assert(receipt.writes===4 && receipt.stored===4 && receipt.model_calls===0);
   assert(counts.parent===1 && counts.vehicle===1 && counts.source===1 && counts.property===4 && counts.finish===4);
  }
  reset();privateVehicle=true;const refused=await drain();
  assert(refused.refused===4 && counts.parent===4 && counts.vehicle===4 && counts.insert===0);
  privateVehicle=false;reset();failFirstParent=true;const recovered=await drain();
  assert(recovered.retries===1 && recovered.stored===3 && counts.parent===2);failFirstParent=false;
  reset();rejectCompletion=true;const stale=await drain();
  assert(stale.stored===0 && stale.writes===0 && stale.completion_failures===4 && stale.retries===4 && counts.finish===8);
  rejectCompletion=false;reset();
  for(let i=0;i<2;i++)assert((await handler(request({mode:"retained_listing_engine_configuration_v1",source_observation_id:PARENT}))).status===200);
  assert(counts.parent===2 && counts.vehicle===2 && counts.source===4);
  const forged=await handler(request({mode:"retained_listing_property_drain_v1",batch_size:120,lookups:{}}));
  assert(forged.status===400);
 }finally{globalThis.fetch=original;for(const [i,key] of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].entries()){
  if(saved[i]===undefined)Deno.env.delete(key);else Deno.env.set(key,saved[i]!);
 }}
});
for(const [i,key] of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].entries()){
 if(saved[i]===undefined)Deno.env.delete(key);else Deno.env.set(key,saved[i]!);
}
