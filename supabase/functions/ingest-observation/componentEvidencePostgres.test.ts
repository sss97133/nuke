/** Real handler/SDK, guarded insert, witness projection and existing consumer.
 * Narrow local test transport replaces HTTP/PostgREST, not the database owners.
 * All rows are synthetic; this never imports or writes production testimony. */
const enabled=Deno.env.get('RUN_COMPONENT_PG')==='1';
function assert(v:unknown,m:string):asserts v {if(!v)throw Error(m)}
const quote=(v:string)=>{if(v.includes('\0'))throw Error('NUL refused');return `'${v.replaceAll("'","''")}'`};
const V='10000000-0000-4000-8000-000000000001';
Deno.test({name:'component PostgreSQL: actual intake to canonical source guard, fold and source withdrawal',ignore:!enabled,async fn(){
 const host=Deno.env.get('PGHOST')??'',port=Deno.env.get('PGPORT')??'',db=Deno.env.get('PGDATABASE')??'',user=Deno.env.get('PGUSER')??'',psql=Deno.env.get('PSQL_BIN')??'';
 assert((host==='localhost'||/^\/(?:private\/)?tmp\/[A-Za-z0-9_./-]+$/.test(host))&&!host.includes('..'),'explicit local host');
 assert(/^dm_refinement_[A-Za-z0-9_]+$/.test(db)&&/^\d+$/.test(port)&&/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(user)&&/^\/.*\/psql$/.test(psql),'explicit isolated fixture');
 const decoder=new TextDecoder();
 async function sql(statement:string){
  const result=await new Deno.Command(psql,{args:['-X','-qAt','-h',host,'-p',port,'-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c',statement],
   env:{PGCONNECT_TIMEOUT:'3',PGOPTIONS:'-c statement_timeout=10000 -c lock_timeout=1000 -c standard_conforming_strings=on'},stdout:'piped',stderr:'piped'}).output();
  if(!result.success)throw Error(decoder.decode(result.stderr));return decoder.decode(result.stdout).trim();
 }
 const identity=JSON.parse(await sql("select jsonb_build_object('db',current_database(),'address',host(inet_server_addr()),'fixture',to_regprocedure('public.test_component(integer)')::text)"));
 const ci=Deno.env.get('GITHUB_ACTIONS')==='true'&&Deno.env.get('GITHUB_JOB')==='db-contracts'&&host==='localhost'&&db==='dm_refinement_component_ci';
 assert(identity.db===db&&identity.fixture==='test_component(integer)'&&(identity.address===null||identity.address==='127.0.0.1'||identity.address==='::1'||ci&&/^(10\.|172\.|192\.168\.)/.test(identity.address)),'fixture identity');
 const before=globalThis.fetch,serve=Deno.serve,saved=[Deno.env.get('SUPABASE_URL'),Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')];
 Deno.env.set('SUPABASE_URL','https://component-fixture.test');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','component-test-key');
 let handler:(r:Request)=>Promise<Response>;let writes=0;
 (Deno as any).serve=(f:typeof handler)=>{handler=f};await import('./index.ts');Deno.serve=serve;
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const tables=new Set(['subject_taxonomy','vehicle_observations','vehicle_images','observation_witnesses','observation_sources','observation_properties']);
 globalThis.fetch=async(resource,init)=>{
  try{
   const req=new Request(resource,init),url=new URL(req.url);assert(url.origin==='https://component-fixture.test','no external HTTP or model calls');
   assert(req.headers.get('authorization')==='Bearer component-test-key'&&req.headers.get('apikey')==='component-test-key','actual SDK service headers');
   if(url.pathname==='/rest/v1/rpc/component_reading_current'){
    const body=await req.json();return respond(JSON.parse(await sql(`select to_jsonb(component_reading_current(${quote(body.p_observation)}::uuid))`)));
   }
   const table=url.pathname.slice('/rest/v1/'.length);assert(tables.has(table),'bounded table route');
   if(req.method==='POST'){
    assert(table==='vehicle_observations','only existing observation writer');const body=await req.json();writes++;
    // jsonb_populate_record preserves actual serialized values. All request
    // columns must exist in the fixture, so unknown fields cannot disappear.
    const columns=JSON.parse(await sql("select jsonb_agg(column_name) from information_schema.columns where table_schema='public' and table_name='vehicle_observations'"));
    assert(Object.keys(body).every(k=>columns.includes(k)),'actual request column retained');
    return respond(JSON.parse(await sql(`BEGIN; SET LOCAL test.role='service_role'; WITH inserted AS(
      INSERT INTO vehicle_observations SELECT (jsonb_populate_record(NULL::vehicle_observations,
      jsonb_build_object('id',gen_random_uuid(),'ingested_at',now(),'is_superseded',false,'subject_type','vehicle')||${quote(JSON.stringify(body))}::jsonb)).* RETURNING *)
      SELECT to_jsonb(inserted) FROM inserted; COMMIT;`)),201);
   }
   assert(req.method==='GET','read or existing writer only');const where:string[]=[];
   for(const [key,value] of url.searchParams){if(['select','limit'].includes(key))continue;
    assert(/^[a-z_]+$/.test(key),'column identifier');
    if(value.startsWith('eq.'))where.push(`${key}=${quote(value.slice(3))}`);
    else if(value==='is.null')where.push(`${key} IS NULL`);else throw Error(`unexpected filter ${key}`);
   }
   const limit=url.searchParams.get('limit');assert(!limit||/^\d+$/.test(limit),'bounded limit');
   return respond(JSON.parse(await sql(`select coalesce(jsonb_agg(to_jsonb(q)),'[]') from(select * from ${table}${where.length?' WHERE '+where.join(' AND '):''}${limit?' LIMIT '+limit:''})q`)));
  }catch(e){return respond({message:String(e)},400)}
 };
 try{
  const ids:string[]=[];
  for(let n=1;n<=3;n++){
   const c=JSON.parse(await sql(`select to_jsonb(test_component(${n}))`));
   const retained=c.structured_data.component_reading;
   const {bbox:_bbox,source_role:_role,clock_basis:_clock,physical_unit_identity:_identity,...selector}=retained;
   const input={source_slug:'photo_pipeline',kind:'condition',observed_at:c.observed_at,vehicle_id:V,component_key:c.structured_data.component_ref.key,
    property_key:'component_visible_present',component_reading:selector,agent_inferred:true,defer_analysis:true,
    structured_data:{component_visible_present:true,component_receipt_candidates:c.structured_data.component_receipt_candidates}};
   const request=()=>new Request('https://component-fixture.test/functions/v1/ingest-observation',{method:'POST',headers:{Authorization:'Bearer component-test-key','Content-Type':'application/json'},body:JSON.stringify(input)});
   const first=await handler!(request()),body=await first.json();assert(first.status===200&&body.current_source_verified===true,JSON.stringify(body));ids.push(body.observation_id);
   const second=await handler!(request()),replay=await second.json();assert(second.status===200&&replay.duplicate===true&&replay.observation_id===body.observation_id,'exact replay');
  }
  assert(writes===3,'three actual admissions only');
  const result=JSON.parse(await sql(`SET test.role='anon'; select vehicle_build_log_public(${quote(V)},false)`));
  assert(result.component_evidence.components.length===3,'all three components reach existing consumer');
  for(const id of ids)assert(JSON.stringify(result.component_evidence).includes(id),'each actual admission retained in folded evidence');
  await sql("UPDATE vehicle_images SET image_url='https://images.example/withdrawn.jpg' WHERE id='20000000-0000-4000-8000-000000000001'");
  assert(JSON.parse(await sql(`select to_jsonb(component_reading_current(${quote(ids[0])}))`))===false,'current source reader detects replacement');
  const after=JSON.parse(await sql(`SET test.role='anon'; select vehicle_build_log_public(${quote(V)},false)`));
  assert(after.component_evidence.components.length===2&&!JSON.stringify(after.component_evidence).includes(ids[0]),'withdrawn read absent from consumer');
  assert(JSON.parse(await sql(`select count(*)::integer from vehicle_observations where id=${quote(ids[0])}`))===1,'original testimony retained');
 }finally{globalThis.fetch=before;Deno.serve=serve;for(const [n,k] of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].entries()){
  if(saved[n]===undefined)Deno.env.delete(k);else Deno.env.set(k,saved[n]!);
 }}
}});
