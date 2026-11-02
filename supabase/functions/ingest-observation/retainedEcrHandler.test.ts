import { ECR_MODE, ECR_METHOD } from "./retainedEcr.ts";
const assert=(v:unknown,message="assertion failed")=>{if(!v)throw Error(message);};
const sid="11111111-1111-4111-8111-111111111111", oid="22222222-2222-4222-8222-222222222222",sourceId="fe8c5cce-6918-421f-8c10-0f9338de4333";
const oldEnv=[Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
Deno.env.set("SUPABASE_URL","https://fixture.supabase.co");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","sb_secret_ecr_test");
let handler:(req:Request)=>Promise<Response>;
const serve=Deno.serve;(Deno as any).serve=(fn:typeof handler)=>{handler=fn;};
await import("./index.ts");Deno.serve=serve;
Deno.test("real intake: hash qualification, dry run, admission, duplicate, corruption and source-species refusal",async()=>{
  const html='<main><h1>Fixture</h1><div class="car_timeline"><div data-box="cars_1"><div class="car_item"><a class="content" href="/details/pagani/zonda/123"><p class="title">Pagani Zonda F</p></a></div></div></div></main>';
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(html));
  const snapshot={id:sid,platform:"ecr",listing_url:"https://exclusivecarregistry.com/collection/fixture",success:true,http_status:200,
    fetched_at:"2026-02-16T03:00:00.123456Z",created_at:"2026-02-16T03:00:01.123456Z",html_sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join(""),html,html_storage_path:null};
  let saved:any=null,writes=0,species:string|null="aggregator";
  const original=globalThis.fetch;
  const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{"Content-Type":"application/json"}});
  globalThis.fetch=async(resource,init)=>{
    const u=new URL(resource instanceof Request?resource.url:String(resource));
    assert(u.origin==="https://fixture.supabase.co"&&u.pathname.startsWith("/rest/v1/"),"unexpected source or model request");
    if(u.pathname.endsWith("observation_sources"))return response([{id:sourceId,species,base_trust_score:.85,supported_observations:["listing"]}]);
    if(u.pathname.endsWith("listing_page_snapshots"))return response([snapshot]);
    if(u.pathname.endsWith("vehicle_observations")){
      if(init?.method==="POST"){
        const body=JSON.parse(String(init.body));writes++;
        assert(body.source_snapshot_id===sid&&body.source_id===sourceId&&body.confidence_score===.6);
        assert(body.extraction_method===ECR_METHOD&&body.analysis_deferred===true&&!body.vehicle_id);
        assert(body.subject_type==="organization"&&!body.subject_id);
        saved={...body,id:oid,vehicle_id:null,subject_id:null,is_superseded:false,ingested_at:"2026-10-31T03:30:00Z"};return response(saved,201);
      }
      return response(saved?[saved]:[]);
    }
    throw Error(`Unexpected SDK route ${u.pathname}`);
  };
  const request=(body:unknown,key="sb_secret_ecr_test")=>handler(new Request("https://fixture.supabase.co/functions/v1/ingest-observation",{method:"POST",headers:{"Content-Type":"application/json",apikey:key},body:JSON.stringify(body)}));
  try {
    const selector={mode:ECR_MODE,snapshot_id:sid,dry_run:true};
    let r=await request(selector,"invalid");assert(r.status===401&&writes===0);
    r=await request({...selector,vehicle_id:oid});assert(r.status===400&&writes===0);
    r=await request({extraction_method:ECR_METHOD});assert(r.status===400&&writes===0);
    r=await request(selector);let body=await r.json();assert(r.ok&&body.dry_run===true&&body.writes===0&&writes===0);
    species=null;r=await request(selector);assert(r.status===422&&writes===0);species="aggregator";
    snapshot.html+="tampered";r=await request(selector);assert(r.status===422&&writes===0);snapshot.html=html;
    r=await request({...selector,dry_run:false});body=await r.json();assert(r.ok&&body.observation_id===oid&&body.writes===1&&writes===1,JSON.stringify(body));
    r=await request({...selector,dry_run:false});body=await r.json();assert(r.ok&&body.duplicate===true&&body.writes===0&&writes===1);
    saved.source_snapshot_id=oid;r=await request({...selector,dry_run:false});assert(r.status===503&&writes===1);
  } finally {
    globalThis.fetch=original;
    for(const [i,k] of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].entries()) oldEnv[i]===undefined?Deno.env.delete(k):Deno.env.set(k,oldEnv[i]!);
  }
});
