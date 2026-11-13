const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m)};
const saved=[Deno.env.get('SUPABASE_URL'),Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')];
Deno.env.set('SUPABASE_URL','https://db.test');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-key');
let handler:(req:Request)=>Promise<Response>;
const serve=Deno.serve;(Deno as any).serve=(fn:typeof handler)=>{handler=fn};
await import('./index.ts');Deno.serve=serve;
const V='10000000-0000-4000-8000-000000000001',I='20000000-0000-4000-8000-000000000001',
 P='30000000-0000-4000-8000-000000000001',T='40000000-0000-4000-8000-000000000001',S='80000000-0000-4000-8000-000000000001',R='90000000-0000-4000-8000-000000000001';
Deno.test('actual component handler binds source/part/property/witness, replays current receipt and refuses changed-source result without inference',async()=>{
 const original=globalThis.fetch;const rows=new Map<string,any>();let current=true,writes=0,readFailure=false,pending=false;
 const label='Battery 78PRMJ';const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(label)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const payload={source_slug:'photo_pipeline',kind:'condition',observed_at:'1900-01-01T00:00:00Z',vehicle_id:V,component_key:'fluid.battery',
  property_key:'component_visible_present',agent_inferred:true,defer_analysis:true,structured_data:{component_visible_present:true},
  component_reading:{source_observation_id:P,image_id:I,source_url:'https://images.example/battery.jpg',path:['components_seen','0','label'],value_sha256:hash,quote:label}};
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(resource,init)=>{
  const url=new URL(typeof resource==='string'?resource:resource instanceof URL?resource.href:resource.url);
  const body=typeof init?.body==='string'?JSON.parse(init.body):null;
  if(!url.pathname.startsWith('/rest/v1/'))throw Error(`unexpected external/model route ${url}`);
  if(url.pathname.endsWith('subject_taxonomy'))return respond([{subject_id:T,subject_key:'fluid.battery',display_name:'Battery',is_active:true,domain:'mechanical',category:'fluid'}]);
  if(url.pathname.endsWith('vehicle_images'))return respond([{id:I,vehicle_id:V,image_url:'https://images.example/battery.jpg',is_sensitive:false,is_document:false,redaction_level:'none'}]);
  if(url.pathname.endsWith('observation_witnesses'))return respond([{id:I}]);
  if(url.pathname.endsWith('observation_sources'))return respond([{id:S,base_trust_score:.6,supported_observations:['condition']}]);
  if(url.pathname.endsWith('observation_properties'))return respond([{id:R,namespace:pending?'pending':'core',deprecated_at:null,applies_to_kinds:['condition']}]);
  if(url.pathname.endsWith('rpc/component_reading_current'))return respond(current);
  if(url.pathname.endsWith('vehicle_observations')){
   if(init?.method==='POST'){
    assert(body.component_subject_id===T&&body.source_observation_id===P&&body.property_id===R,'typed FKs');
    assert(body.extraction_method==='retained_component_reading_v1'&&body.observed_at==='2026-11-10T16:25:10.731Z','source analysis clock wins over caller clock');
    assert(body.analysis_deferred===true&&body.confidence_score<=.6&&body.source_event_at===null);
    const row={...body,id:`a0000000-0000-4000-8000-${String(++writes).padStart(12,'0')}`,is_superseded:false};rows.set(body.content_hash,row);return respond(row,201);
   }
   if(url.searchParams.has('id'))return readFailure?respond({message:'source lookup failed'},500):respond([{id:P,vehicle_id:V,is_superseded:false,
    extraction_method:'reviewed_image_analysis_v1',source_url:'https://images.example/battery.jpg',observed_at:'2026-11-10T16:25:10.731Z',
    structured_data:{image_id:I,components_seen:[{label,bbox:[10,20,800,900],part_number_guess:'78PRMJ'}]}}]);
   const key=url.searchParams.get('content_hash')?.slice(3);return respond(key&&rows.has(key)?[rows.get(key)]:[]);
  }
  throw Error(`unexpected route ${url}`);
 };
 const request=(p:unknown=payload)=>new Request('https://db.test/functions/v1/ingest-observation',{method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:JSON.stringify(p)});
 try{
  const first=await handler(request());const answer=await first.json();assert(first.status===200&&answer.current_source_verified===true,JSON.stringify(answer));
  assert(answer.installation_status==='unestablished'&&answer.model_calls===0&&writes===1);
  const replay=await handler(request());assert(replay.status===200&&(await replay.json()).duplicate===true&&writes===1);
  current=false;assert((await handler(request())).status===409&&writes===1,'withdrawn duplicate never passes');current=true;
  readFailure=true;assert((await handler(request())).status===503&&writes===1);readFailure=false;
  pending=true;assert((await handler(request())).status===400&&writes===1);pending=false;
  assert((await handler(request({...payload,structured_data:{component_visible_present:true,installed:true}}))).status===400&&writes===1);
  assert((await handler(request({...payload,component_key:undefined,component_reading:undefined}))).status===400&&writes===1);
 }finally{globalThis.fetch=original;for(const [i,key] of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].entries()){
  if(saved[i]===undefined)Deno.env.delete(key);else Deno.env.set(key,saved[i]!);
 }}
});
