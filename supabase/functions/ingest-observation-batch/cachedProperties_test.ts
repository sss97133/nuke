import { prepareCachedClaims,validateCachedReceipt,readBatchBody,ingestCachedProperties,BatchAdmissionError,MAX_BATCH_BYTES,CACHED_PROPERTY_MODE } from './cachedProperties.ts';
import { observationContentHash } from '../_shared/observationContentHash.ts';
import { projectImageProperties } from '../../../scripts/lib/image-property-projection.mjs';
function assert(value:unknown,message='assertion failed'):asserts value {if(!value)throw new Error(message);}
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
function claims() {
 const image={id:id(1),vehicle_id:id(2),vision_gate_status:'approved'};
 const parent={id:id(3),vehicle_id:id(2),kind:'condition',is_superseded:false,confidence:'medium',confidence_score:0.8,
   agent_model:'fixture-model',agent_tier:'professional',extraction_method:'image_analysis',observed_at:'2026-10-02T00:00:00Z',
   ingested_at:'2026-10-03T02:00:00.000001Z',structured_data:{image_id:image.id,analysis_kind:'image_deep_byok',state_observations:{rust_severity:'surface',paint_state:'primer',completeness:'partial'}}};
 return projectImageProperties(parent,image).claims;
}
function receipt(prepared:Record<string,any>[],duplicates=false) {
 return {success:true,source_id:id(4),submitted:prepared.length,verified:prepared.length,inserted:duplicates?0:prepared.length,duplicates:duplicates?prepared.length:0,
  results:prepared.map((claim,index)=>({index,observation_id:id(100+index),witness_id:id(200+index),property_id:id(300+index),duplicate:duplicates,
   vehicle_id:claim.vehicle_id,image_id:claim.structured_data.image_id,property_key:claim.property_key,value:claim.structured_data[claim.property_key],
   source_observation_id:claim.structured_data.source_observation_id,source_result_hash:claim.structured_data.source_result_hash,
   source_recorded_at:claim.structured_data.source_recorded_at,confidence_score:0.6}))};
}
async function rejected(work:()=>unknown|Promise<unknown>,code?:string){
 let error:unknown;try{await work();}catch(e){error=e;}
 assert(error instanceof BatchAdmissionError);
 if(code)assert(error.code===code,`wanted ${code}, got ${error.code}`);
}
Deno.test('real cached projector payload is admitted without rewriting bytes or clocks',async()=>{
 const original=claims();assert(original.length===3);
 const prepared=await prepareCachedClaims(original);
 for(let i=0;i<3;i++){
  const {content_hash,...unchanged}=prepared[i];
  assert(JSON.stringify(unchanged)===JSON.stringify(original[i]));
  assert(content_hash===await observationContentHash(original[i]));
 }
 assert(prepared[0].observed_at==='2026-10-03T02:00:00.000001Z');
});
Deno.test('one invalid item rejects the entire collection before any transaction',async()=>{
 let calls=0;const batch=claims();Object.assign(batch[2].structured_data,{image_visible_assembly_state:'invented'});
 await rejected(()=>ingestCachedProperties({rpc(){calls++;throw new Error('must not write');}},batch),'cached_claim_invalid');assert(calls===0);
});
for(const patch of [{source_slug:'other'},{agent_inferred:false},{defer_analysis:false},{agent_cost_cents:1},{content_hash:'0'.repeat(64)},
 {kind:'comment'},{extraction_method:'different'},{source_identifier:'different'},{raw_source_ref:'different'},{vehicle_id:'invalid'},
 {observed_at:'not-a-time'},{agent_model:''}])Deno.test(`admission rejects ${Object.keys(patch)[0]}`,async()=>{
 const batch=claims();Object.assign(batch[0],patch);await rejected(()=>prepareCachedClaims(batch),'cached_claim_invalid');
});
for(const patch of [{source_recorded_at:'2020-01-01'},{capture_at:'2020-01-01'},{analyzed_at:'2020-01-01'},{source_model_confidence:0.5},
 {claim_role:'verified'},{projection_version:'new'},{source_observation_id:'invalid'},{source_result_hash:'invalid'},{image_visible_rust_severity:'unknown'}])
 Deno.test(`provenance admission rejects ${Object.keys(patch)[0]}`,async()=>{
  const batch=claims();Object.assign(batch[0].structured_data,patch);await rejected(()=>prepareCachedClaims(batch),'cached_claim_invalid');
 });
Deno.test('empty, excessive and duplicate identities cannot become successful batches',async()=>{
 await rejected(()=>prepareCachedClaims([]),'cached_claim_count_invalid');
 await rejected(()=>prepareCachedClaims(Array(3001).fill(claims()[0])),'cached_claim_count_invalid');
 await rejected(()=>prepareCachedClaims([claims()[0],claims()[0]]),'duplicate_batch_identity');
});
Deno.test('receipt counts only actual typed rows and supports exact replay duplicates',async()=>{
 const prepared=await prepareCachedClaims(claims());
 const created=validateCachedReceipt(receipt(prepared),prepared);assert(created.ingested===3&&created.failed===0);
 const replay=validateCachedReceipt(receipt(prepared,true),prepared);assert(replay.ingested===0&&replay.duplicates===3);
});
for(const patch of [{witness_id:null},{property_id:null},{observation_id:null},{vehicle_id:id(999)},{image_id:id(999)},
 {source_observation_id:id(999)},{source_result_hash:'a'.repeat(64)},{value:'different'},{confidence_score:0.601},
 {source_recorded_at:'2026-10-03T02:00:00.000999Z'},{index:99}])Deno.test(`receipt rejects missing or changed ${Object.keys(patch)[0]}`,async()=>{
 const prepared=await prepareCachedClaims(claims()),r=receipt(prepared);Object.assign(r.results[0],patch);
 await rejected(()=>validateCachedReceipt(r,prepared),'batch_receipt_mismatch');
});
Deno.test('receipt duplicate IDs, missing rows, or dishonest counts cannot report success',async()=>{
 const prepared=await prepareCachedClaims(claims());
 for(const change of [(r:any)=>r.results.pop(),(r:any)=>r.results[1].observation_id=r.results[0].observation_id,
  (r:any)=>r.results[1].witness_id=r.results[0].witness_id,(r:any)=>r.verified=0,
  (r:any)=>{r.inserted=2;r.duplicates=1;}]){
  const r=receipt(prepared);change(r);await rejected(()=>validateCachedReceipt(r,prepared));
 }
});
Deno.test('one RPC carries the full validated batch and receives an abort signal',async()=>{
 let calls=0;const result=await ingestCachedProperties({rpc(name:string,args:any){calls++;assert(name==='ingest_cached_image_property_batch');
  return{abortSignal(signal:AbortSignal){assert(signal instanceof AbortSignal);return Promise.resolve({data:receipt(args.p_claims),error:null});}};}},claims());
 assert(calls===1&&result.ingested===3);
});
Deno.test('SQL errors and transport failures yield static rejection rather than partial success',async()=>{
 await rejected(()=>ingestCachedProperties({rpc(){return{abortSignal(){return Promise.resolve({error:{message:'private SQL'},data:null});}};}},claims()),'batch_transaction_rejected');
 await rejected(()=>ingestCachedProperties({rpc(){throw new Error('private SQL');}},claims()),'batch_transaction_unavailable');
});
Deno.test('body ceiling checks actual streamed bytes even with absent or false Content-Length',async()=>{
 for(const contentLength of [undefined,'1',String(MAX_BATCH_BYTES+1)]){
  const request=new Request('https://example.invalid',{method:'POST',headers:contentLength?{'content-length':contentLength}:{},body:new Uint8Array(MAX_BATCH_BYTES+1)});
  await rejected(()=>readBatchBody(request),'batch_too_large');
 }
});
Deno.test('body parser refuses malformed JSON, arrays and empty bodies',async()=>{
 for(const text of ['','{','[]','null'])await rejected(()=>readBatchBody(new Request('https://example.invalid',{method:'POST',body:text})));
 assert((await readBatchBody(new Request('https://example.invalid',{method:'POST',body:'{"observations":[]}'}))).observations.length===0);
});

// Exercise the actual service-only HTTP handler using a fake PostgREST transport.
let handler:(request:Request)=>Promise<Response>;
const originalServe=Deno.serve,originalFetch=globalThis.fetch;
Deno.env.set('SUPABASE_URL','https://batch-fixture.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-key');Deno.env.set('SUPABASE_JWT_SECRET','fixture-signing-secret');
Deno.serve=((callback:typeof handler)=>{handler=callback;})as typeof Deno.serve;
let rpcCalls=0;
globalThis.fetch=(async(input,init)=>{
 const url=new URL(String(input));assert(url.pathname==='/rest/v1/rpc/ingest_cached_image_property_batch','unexpected network request');
 rpcCalls++;const body=JSON.parse(String(init?.body));return Response.json(receipt(body.p_claims));
})as typeof fetch;
await import('./index.ts');Deno.serve=originalServe;
function request(body:unknown,token='test-key'){
 return new Request('https://batch-fixture.invalid/functions/v1/ingest-observation-batch',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
}
async function userToken(){
 const b64=(value:unknown)=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 const data=`${b64({alg:'HS256',typ:'JWT'})}.${b64({role:'authenticated',sub:id(999),exp:Math.floor(Date.now()/1000)+60})}`;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('fixture-signing-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data)));
 return`${data}.${btoa(String.fromCharCode(...signature)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
}
Deno.test('actual batch handler rejects anonymous and signed-in user before SQL',async()=>{
 rpcCalls=0;
 for(const [token,status]of [['',401],['bogus',401],[await userToken(),403]]as const){
  const response=await handler(request({mode:CACHED_PROPERTY_MODE,observations:claims()},token));assert(response.status===status);
 }
 assert(rpcCalls===0);
});
Deno.test('actual service-only route issues one transaction and preserves replay-shaped receipt',async()=>{
 rpcCalls=0;const response=await handler(request({mode:CACHED_PROPERTY_MODE,observations:claims()}));const data=await response.json();
 assert(response.status===200&&data.success===true&&data.ingested===3&&rpcCalls===1);
});
Deno.test('unsupported modes, options and one invalid item never reach SQL',async()=>{
 rpcCalls=0;
 for(const body of [{mode:'other',observations:claims()},{mode:CACHED_PROPERTY_MODE,observations:claims(),options:{gap_fill:true}},
  {mode:CACHED_PROPERTY_MODE,observations:[...claims(),{source_slug:'unrelated'}]}]){
  const response=await handler(request(body));assert(response.status===400);
 }
 assert(rpcCalls===0);
});
Deno.test('unreadable body emits only a static error',async()=>{
 const body=new ReadableStream({start(controller){controller.error(new Error('private secret upstream details'));}});
 const response=await handler(new Request('https://batch-fixture.invalid',{method:'POST',headers:{authorization:'Bearer test-key'},body}));
 const text=await response.text();assert(response.status===500&&!text.includes('private')&&!text.includes('secret')&&text.includes('batch_request_failed'));
});
Deno.test('restore batch transport fixture',()=>{globalThis.fetch=originalFetch;});

Deno.test('transport proof cannot forge a stable projection identity',async()=>{
 let calls=0;const batch=claims();batch[0].structured_data.source_result_hash='a'.repeat(64);
 batch[0].source_identifier=`byok_image_properties_v1:${batch[0].structured_data.source_observation_id}:${'a'.repeat(64)}:${batch[0].property_key}`;
 await rejected(()=>ingestCachedProperties({rpc(){calls++;}},batch),'cached_source_proof_hash_mismatch');assert(calls===0);
});
Deno.test('source proof must be complete, bounded and agree with the submitted scalar',async()=>{
 for(const proof of [undefined,'','{','{}',' '.repeat(16385),JSON.stringify({observation_id:'wrong'})]){
  const batch=claims();Object.assign(batch[0],{source_result_json:proof});await rejected(()=>prepareCachedClaims(batch),'cached_source_proof_invalid');
 }
 const batch=claims();const proof=JSON.parse(batch[0].source_result_json);proof.state_observations.rust_severity='perforation';batch[0].source_result_json=JSON.stringify(proof);
 await rejected(()=>prepareCachedClaims(batch),'cached_source_proof_invalid');
});
