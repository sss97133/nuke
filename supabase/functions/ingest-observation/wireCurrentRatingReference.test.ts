import {ingestWireCurrentRatingReference, WIRE_CURRENT_RATING_MODE, type WireResistanceDeps} from './wireResistanceReference.ts';
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m)}
const id='10000000-0000-4000-8000-000000000001';
const recipe=()=>({source_id:id,property_id:id,kind:'specification',extraction_method:'supplied_wire_current_rating_v1',
 vehicle_id:null,subject_id:null,analysis_deferred:true,confidence_score:0.6,rank:'normal',content_hash:'a'.repeat(64),
 source_identifier:'wire-current-rating:'+'a'.repeat(64),structured_data:{definition_role:'published_wire_current_rating',applicability_status:'unassessed',
 installed_state:'unestablished',wire_current_rating_condition_key:'wire-current:v1:fixture',wire_published_current_rating:150}});
const input=(dry_run=false)=>({mode:WIRE_CURRENT_RATING_MODE,reading:{profile:'fixture'},dry_run});
function fixture(){const calls:string[]=[];let stored=false;const r=recipe();const deps:WireResistanceDeps={
 async authorize(){calls.push('auth');return true},async qualify(){calls.push('qualify');return{data:{ok:true,recipe:r,condition:{condition_key:r.structured_data.wire_current_rating_condition_key},citations:[],source:{}}}},
 async find(){calls.push('find');return{data:stored?{id}:null}},async insert(value){calls.push('insert');assert(value===r,'only DB-owned recipe inserted');stored=true;return{data:{id}}},
 async project(value){calls.push('project');assert(value===id,'exact observation projected');return{data:{success:true,observation_id:id,condition_key:r.structured_data.wire_current_rating_condition_key,current_source_verified:true}}}};
 return{calls,deps,r,setStored:()=>{stored=true}};}
Deno.test('wire current rating: authorization precedes source reads and validation',async()=>{const f=fixture();f.deps.authorize=async()=>false;const r=await ingestWireCurrentRatingReference(null,f.deps);assert(r.status===403&&f.calls.length===0,'no source effects');});
Deno.test('wire current rating: explicit dry run returns source-only preview without admission',async()=>{const f=fixture();const r=await ingestWireCurrentRatingReference(input(true),f.deps);assert(r.status===200&&r.body.writes===0&&r.body.scope==='attributed_material_class_reference'&&f.calls.join(',')==='auth,qualify','preview only');});
Deno.test('wire current rating: arbitrary outer fields cannot override source recipe',async()=>{const f=fixture();const r=await ingestWireCurrentRatingReference({...input(),vehicle_id:id},f.deps);assert(r.status===400&&f.calls.join(',')==='auth','unknown field refused before source lookup');});
Deno.test('wire current rating: dry_run is mandatory',async()=>{const f=fixture();const {dry_run:_v,...p}=input();const r=await ingestWireCurrentRatingReference(p,f.deps);assert(r.status===400&&f.calls.join(',')==='auth','no implicit write mode');});
Deno.test('wire current rating: unqualified source cannot be admitted',async()=>{const f=fixture();f.deps.qualify=async()=>({data:{ok:false,reason:'reference_not_current'}});const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===409&&r.body.writes===0&&!f.calls.includes('insert'),'source hold');});
Deno.test('wire current rating: qualified DB recipe creates one observation and typed projection',async()=>{const f=fixture();const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===200&&r.body.observation_id===id&&r.body.current_source_verified===true&&r.body.installed_state==='unestablished'&&f.calls.join(',')==='auth,qualify,find,insert,project','one protected admission');});
Deno.test('wire current rating: replay requalifies and projects existing observation',async()=>{const f=fixture();f.setStored();const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===200&&r.body.duplicate===true&&f.calls.join(',')==='auth,qualify,find,project','no duplicate insert');});
Deno.test('wire current rating: source withdrawal refuses even an existing receipt',async()=>{const f=fixture();f.setStored();f.deps.qualify=async()=>({data:{ok:false,reason:'reference_not_current'}});const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===409&&!f.calls.includes('find')&&!f.calls.includes('project'),'cached identity not a source proof');});
Deno.test('wire current rating: lost insert acknowledgement recovers only exact tuple',async()=>{const f=fixture();f.deps.insert=async()=>{f.setStored();return{error:{message:'connection lost'}}};const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===200&&r.body.duplicate===true&&f.calls.filter(x=>x==='find').length===2&&f.calls.at(-1)==='project','recovered and requalified');});
Deno.test('wire current rating: failed projection preserves admitted observation identity',async()=>{const f=fixture();f.deps.project=async()=>({error:{code:'23514'}});const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===409&&r.body.observation_id===id&&r.body.projected===false,'no false current-source acknowledgement');});
Deno.test('wire current rating: bound vehicle or malformed recipe never reaches insert',async()=>{const f=fixture();f.r.vehicle_id=id as any;const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===503&&!f.calls.includes('find')&&!f.calls.includes('insert'),'material class cannot become installed vehicle evidence');});
Deno.test('wire current rating: backend failure acknowledges uncertain admission, not zero writes',async()=>{const f=fixture();f.deps.insert=async()=>{throw Error('interrupted')};const r=await ingestWireCurrentRatingReference(input(),f.deps);assert(r.status===503&&r.body.admission_attempted===true&&r.body.writes===undefined,'ambiguous write not misstated');});

Deno.test('wire current rating: resistance profile cannot enter current-rating mode',async()=>{
 const f=fixture();const wrong=await ingestWireCurrentRatingReference({...input(),mode:'wire_resistance_reference'},f.deps);
 assert(wrong.status===400&&f.calls.join(',')==='auth','closed source mode');
 f.r.extraction_method='supplied_wire_resistance_v1';const crossed=await ingestWireCurrentRatingReference(input(),f.deps);
 assert(crossed.status===503&&!f.calls.includes('find'),'closed recipe method');
});
Deno.test('wire current rating: preview identifies A and rejects non-finite published values',async()=>{
 const f=fixture();const preview=await ingestWireCurrentRatingReference(input(true),f.deps);
 assert(preview.body.unit==='A'&&preview.body.property_key==='wire_published_current_rating'&&preview.body.value===150,'thermal value is not resistance');
 for(const value of [NaN,Infinity,0,-1]){
  f.r.structured_data.wire_published_current_rating=value;const result=await ingestWireCurrentRatingReference(input(),f.deps);
  assert(result.status===503&&!f.calls.includes('find'),'invalid source scalar cannot be admitted');
 }
});
