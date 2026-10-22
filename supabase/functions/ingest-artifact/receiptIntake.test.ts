import { assertEquals, assertThrows } from "jsr:@std/assert";
import { admitReceiptEvidence, handleReceiptIntake, originalPath, ReceiptRefusal, sha256, validateExtraction } from "./receiptIntake.ts";
const owner="00000000-0000-4000-8000-000000000001", org="00000000-0000-4000-8000-000000000002";
const actor="00000000-0000-4000-8000-000000000003", key="00000000-0000-4000-8000-000000000004";
const extraction={method:"fixture-ocr",version:"1",raw_text:"RETURN TOTAL -12.00",fields:{total:{value:-12,evidence:"RETURN TOTAL -12.00"},transaction_date:{value:null}},items:[]};
const bytes=new TextEncoder().encode("original fixture");
const original={sha256:await sha256(bytes),filename:"receipt.jpeg",mime_type:"image/jpeg"};
function fixture(options: { allowed?:boolean; publicBucket?:boolean; changedBytes?:boolean; duplicate?:boolean; refuseAdmission?:boolean }={}) {
 const calls: Array<{name:string;args:Record<string,unknown>}>=[];
 return {calls,db:{
  rpc:async(name:string,args:Record<string,unknown>)=>{
   calls.push({name,args});
   if(name==="check_receipt_intake_access") return {data:{allowed:options.allowed!==false,membership_id:"membership"},error:null};
   if(name==="ingest_receipt_evidence") return options.refuseAdmission?{error:{message:"revoked"}}:{data:{artifact_id:"artifact",observation_id:"observation"}};
   if(name==="record_receipt_participation")return {data:"audit-id"};
   if(name==="read_receipt_intake")return {data:{records:[]}};
   throw Error("Unexpected RPC "+name);
  },
  storage:{getBucket:async()=>({data:{public:options.publicBucket??false}}),from:(bucket:string)=>{
   assertEquals(bucket,"user-documents");return {
    upload:async(path:string,_data:unknown,settings:Record<string,unknown>)=>{assertEquals(path,originalPath(owner,original));assertEquals(settings.upsert,false);return {error:options.duplicate?{statusCode:409,message:"exists"}:null};},
    download:async(path:string)=>{assertEquals(path,originalPath(owner,original));return {data:new Blob([options.changedBytes?"different":bytes])};},
   };
  }},
  functions:{invoke:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data:{artifact_id:"artifact",observation_id:"observation",status:"captured_needs_review",expense_posted:false}};}}
 }};
}
function request(body:Record<string,unknown>){return new Request("https://fixture.invalid/functions/v1/ingest-artifact",{method:"POST",headers:{"x-api-key":"nk_live_synthetic"},body:JSON.stringify(body)});}
async function withKeyAuth(run:()=>Promise<void>){
 const old=globalThis.fetch;const names=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEYS"];const previous=names.map(x=>Deno.env.get(x));
 Deno.env.set("SUPABASE_URL","https://fixture.invalid");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","sb_secret_fixture");Deno.env.delete("SUPABASE_SECRET_KEYS");
 globalThis.fetch=async(input)=>{const url=String(input);if(!url.includes("/rest/v1/rpc/check_api_key_rate_limit"))throw Error("Unexpected network "+url);
  return Response.json({allowed:true,user_id:actor,key_id:key,scopes:["read","write"]});};
 try{await run();}finally{globalThis.fetch=old;names.forEach((x,i)=>previous[i]===undefined?Deno.env.delete(x):Deno.env.set(x,previous[i]!));}
}
Deno.test("same bytes are owner-scoped and arbitrary paths refused",()=>{
 assertEquals(originalPath(owner,original),`${owner}/receipt-originals/sha256/${original.sha256}.jpeg`);
 assertThrows(()=>originalPath(actor,{...original,storage_path:originalPath(owner,original)}),ReceiptRefusal);
 assertThrows(()=>originalPath(owner,{...original,sha256:"../escape"}),ReceiptRefusal);
});
Deno.test("signed return amount and unknown date remain interpretations",()=>{
 assertEquals(validateExtraction(extraction),extraction);
 assertThrows(()=>validateExtraction({...extraction,fields:{total:{value:12}}}),ReceiptRefusal);
 assertThrows(()=>validateExtraction({...extraction,items:[null]}),ReceiptRefusal);
});
Deno.test("authenticated account is authority; body submitter cannot impersonate owner",()=>withKeyAuth(async()=>{
 const f=fixture();const body={mode:"receipt_intake_v1",action:"submit",owner_user_id:owner,organization_id:org,contributor_user_id:owner,original,extraction};
 const response=await handleReceiptIntake(request(body),body,f.db);assertEquals(response.status,200);
 const call=f.calls.find(x=>x.name==="ingest-observation")!;const payload=call.args.body as Record<string,unknown>;
 assertEquals(payload.contributor_user_id,actor);assertEquals(payload.key_id,key);assertEquals(payload.owner_user_id,owner);
 assertEquals(payload.extraction,extraction);assertEquals((await response.json()).expense_posted,false);
}));
Deno.test("API key without current accounting membership cannot submit or read",()=>withKeyAuth(async()=>{
 for(const action of ["upload","submit","read"]){const f=fixture({allowed:false});const body={action,owner_user_id:owner,organization_id:org,original,extraction};
  assertEquals((await handleReceiptIntake(request(body),body,f.db)).status,403);assertEquals(f.calls.length,1);}
}));
Deno.test("canonical intake checks original bytes before any admission",async()=>{
 for(const options of [{changedBytes:true},{publicBucket:true}]){const f=fixture(options);
  const response=await admitReceiptEvidence({key_id:key,contributor_user_id:actor,owner_user_id:owner,organization_id:org,original,extraction},f.db);
  assertEquals(response.status,options.publicBucket?503:409);assertEquals(f.calls.some(x=>x.name==="ingest_receipt_evidence"),false);}
});
Deno.test("canonical intake passes verified source to atomic writer and preserves correction",async()=>{
 const f=fixture();const corrected="00000000-0000-4000-8000-000000000008";
 const response=await admitReceiptEvidence({key_id:key,contributor_user_id:actor,owner_user_id:owner,organization_id:org,original,extraction,supersedes_artifact_id:corrected},f.db);
 assertEquals(response.status,200);const args=f.calls.find(x=>x.name==="ingest_receipt_evidence")!.args;
 assertEquals((args.p_original as Record<string,unknown>).file_size,bytes.length);assertEquals(args.p_supersedes_artifact_id,corrected);
 assertEquals(args.p_extraction,extraction);
});
Deno.test("revocation at atomic admission cannot be reported as success",async()=>{
 const f=fixture({refuseAdmission:true});const r=await admitReceiptEvidence({key_id:key,contributor_user_id:actor,owner_user_id:owner,organization_id:org,original,extraction},f.db);
 assertEquals(r.status,409);
});
Deno.test("duplicate uploads require matching stored bytes and never overwrite",()=>withKeyAuth(async()=>{
 const body={action:"upload",owner_user_id:owner,organization_id:org,original,file_base64:btoa(new TextDecoder().decode(bytes))};
 for(const changedBytes of [false,true]){const f=fixture({duplicate:true,changedBytes});const r=await handleReceiptIntake(request(body),body,f.db);assertEquals(r.status,changedBytes?409:200);}
}));
