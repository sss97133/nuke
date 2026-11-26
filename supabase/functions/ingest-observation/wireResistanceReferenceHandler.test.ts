/** Actual handler and Supabase SDK; transport fixture only. No database testimony
 * fixtures or external HTTP/model calls. SQL owns the separately tested recipe. */
function assert(v:unknown,m:string):void{if(!v)throw Error(m)}
Deno.test('wire resistance HTTP: service source mode, exact recipe, replay, hold and generic spoof refusal',async()=>{
 const savedFetch=globalThis.fetch,savedServe=Deno.serve;
 const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEYS'];const saved=names.map(n=>Deno.env.get(n));
 const key='wire-reference-test-key',id='10000000-0000-4000-8000-000000000001',origin='https://wire-reference-fixture.test';
 Deno.env.set('SUPABASE_URL',origin);Deno.env.set('SUPABASE_SERVICE_ROLE_KEY',key);Deno.env.set('SUPABASE_SECRET_KEYS',JSON.stringify({default:key}));
 let handler:(r:Request)=>Promise<Response>;
 (Deno as any).serve=(f:typeof handler)=>{handler=f};await import('./index.ts');Deno.serve=savedServe;
 const hash='a'.repeat(64),condition='wire-rdc:v1:fixture';let sourceCurrent=true,inserts=0,lookups=0,rpcs=0,stored:any=null;
 const recipe={source_id:id,property_id:id,kind:'specification',extraction_method:'supplied_wire_resistance_v1',
  vehicle_id:null,subject_id:null,analysis_deferred:true,confidence_score:0.6,rank:'normal',content_hash:hash,
  source_identifier:'wire-resistance:'+hash,structured_data:{definition_role:'published_wire_resistance',applicability_status:'unassessed',
   installed_state:'unestablished',wire_condition_key:condition,wire_dc_resistance_per_length:.000600393700788}};
 const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(resource,init)=>{
  const req=new Request(resource,init),url=new URL(req.url);
  assert(url.origin===origin,'no external HTTP or model request');
  assert(req.headers.get('apikey')===key&&req.headers.get('authorization')==='Bearer '+key,'actual SDK service headers');
  assert(req.headers.get('x-nuke-writer')==='ingest-observation','existing sanctioned writer declaration');
  if(url.pathname==='/rest/v1/rpc/qualify_wire_resistance_reference'){
   rpcs++;const body=await req.json();assert(body.p_reading.profile==='fixture','exact source selector forwarded');
   return response(sourceCurrent?{ok:true,recipe,condition:{condition_key:condition},citations:[],source:{}}:{ok:false,reason:'reference_not_current'});
  }
  if(url.pathname==='/rest/v1/rpc/project_wire_resistance_reference'){
   rpcs++;const body=await req.json();assert(body.p_observation_id===id&&stored,'persisted identity projected');
   return response({success:true,observation_id:id,condition_key:condition,current_source_verified:true});
  }
  assert(url.pathname==='/rest/v1/vehicle_observations','only canonical observation transport');
  if(req.method==='GET'){
   lookups++;assert(url.searchParams.get('source_id')==='eq.'+id&&url.searchParams.get('source_identifier')==='eq.'+recipe.source_identifier
    &&url.searchParams.get('kind')==='eq.specification'&&url.searchParams.get('content_hash')==='eq.'+hash,'exact source/kind/identifier/hash tuple');
   return response(stored?[{id}]:[]);
  }
  assert(req.method==='POST','no updates or deletes');const body=await req.json();
  assert(JSON.stringify(body)===JSON.stringify(recipe),'actual SDK serialized only the qualified DB recipe');
  inserts++;stored=body;return response({id},201);
 };
 const call=(body:unknown,authenticated=true)=>handler!(new Request(origin+'/functions/v1/ingest-observation',{method:'POST',
  headers:{...(authenticated?{apikey:key}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
 const input={mode:'wire_resistance_reference',reading:{profile:'fixture'},dry_run:false};
 try{
  const unauthorized=await call(input,false);assert([401,403].includes(unauthorized.status)&&rpcs===0&&inserts===0,'authorization before source effects');
  const preview=await call({...input,dry_run:true}),p=await preview.json();assert(preview.status===200&&p.writes===0&&inserts===0&&lookups===0,'explicit source-only preview');
  const first=await call(input),a=await first.json();assert(first.status===200&&a.current_source_verified===true&&a.observation_id===id&&inserts===1,'actual protected handler admission');
  const again=await call(input),b=await again.json();assert(again.status===200&&b.duplicate===true&&b.observation_id===id&&inserts===1,'exact replay retains identity');
  sourceCurrent=false;const beforeLookup=lookups;const held=await call(input),h=await held.json();assert(held.status===409&&h.reason==='reference_not_current'&&lookups===beforeLookup&&inserts===1,'cached receipt not treated as current source');
  const spoof=await call({source_slug:'component-maker-documentation',kind:'specification',extraction_method:'supplied_wire_resistance_v1'});
  assert(spoof.status===400&&inserts===1,'generic mode cannot forge protected receipt');
 }finally{
  globalThis.fetch=savedFetch;Deno.serve=savedServe;
  for(let i=0;i<names.length;i++){if(saved[i]===undefined)Deno.env.delete(names[i]);else Deno.env.set(names[i],saved[i]!);}
 }
});
