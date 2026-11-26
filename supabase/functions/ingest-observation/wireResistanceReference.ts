/** Protected material-class intake through the existing observation writer.
 * PostgreSQL owns parsing, condition keys, values and source/recipe validation. */
export const WIRE_RESISTANCE_MODE = 'wire_resistance_reference';
export const WIRE_RESISTANCE_METHOD = 'supplied_wire_resistance_v1';
export const WIRE_CURRENT_RATING_MODE = 'wire_current_rating_reference';
export const WIRE_CURRENT_RATING_METHOD = 'supplied_wire_current_rating_v1';
// Closed profiles: the caller cannot choose a property, method or SQL function.
const resistance = {mode:WIRE_RESISTANCE_MODE,method:WIRE_RESISTANCE_METHOD,prefix:'wire-resistance:',
 role:'published_wire_resistance',condition:'wire_condition_key',property:'wire_dc_resistance_per_length',unit:'ohm_per_m'} as const;
const currentRating = {mode:WIRE_CURRENT_RATING_MODE,method:WIRE_CURRENT_RATING_METHOD,prefix:'wire-current-rating:',
 role:'published_wire_current_rating',condition:'wire_current_rating_condition_key',property:'wire_published_current_rating',unit:'A'} as const;
type Obj = Record<string, any>;
const object=(v:unknown):v is Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
interface Result {data?:any;error?:{code?:string;message?:string}|null}
export interface WireResistanceDeps {
 authorize():Promise<boolean>;
 qualify(reading:Obj):PromiseLike<Result>;
 find(recipe:Obj):PromiseLike<Result>;
 insert(recipe:Obj):PromiseLike<Result>;
 project(observationId:string):PromiseLike<Result>;
}
export async function ingestWireResistanceReference(input:unknown,deps:WireResistanceDeps) {
 return await ingestWireReference(input,deps,resistance);
}
export async function ingestWireCurrentRatingReference(input:unknown,deps:WireResistanceDeps) {
 return await ingestWireReference(input,deps,currentRating);
}
async function ingestWireReference(input:unknown,deps:WireResistanceDeps,profile:typeof resistance|typeof currentRating) {
 let observationId:string|null=null,attempted=false,created=false;
 const reply=(status:number,body:Obj):{status:number;body:Obj&{model_calls:number}}=>({status,body:{...body,model_calls:0}});
 try{
  if(!await deps.authorize())return reply(403,{error:'Wire reference intake requires service role',writes:0});
  if(!object(input)||input.mode!==profile.mode||typeof input.dry_run!=='boolean'||!object(input.reading)
   ||Object.keys(input).some(k=>!['mode','reading','dry_run'].includes(k)))
   return reply(400,{error:'Expected only mode, reading and explicit dry_run',writes:0});
  const checked=await deps.qualify(input.reading);
  if(checked.error)return reply(503,{error:'Wire reference qualifier unavailable',writes:0});
  const q=checked.data;
  if(!object(q)||q.ok!==true)return reply(409,{error:'Wire reference source refused',reason:q?.reason??'unqualified',writes:0});
  const r=q.recipe,s=r?.structured_data;
  if(!object(r)||!object(s)||r.kind!=='specification'||r.extraction_method!==profile.method
   ||!uuid(r.source_id)||!uuid(r.property_id)||r.vehicle_id!==null||r.subject_id!==null
   ||r.analysis_deferred!==true||r.confidence_score!==0.6||r.rank!=='normal'
   ||typeof r.content_hash!=='string'||!/^[a-f0-9]{64}$/.test(r.content_hash)
   ||r.source_identifier!==profile.prefix+r.content_hash
   ||s.definition_role!==profile.role||s.applicability_status!=='unassessed'
   ||s.installed_state!=='unestablished'||typeof s[profile.condition]!=='string'
   ||q.condition?.condition_key!==s[profile.condition]
   ||typeof s[profile.property]!=='number'||!Number.isFinite(s[profile.property])
   ||s[profile.property]<=0)
   return reply(503,{error:'Wire reference recipe unavailable',writes:0});
  if(input.dry_run)return reply(200,{success:true,dry_run:true,writes:0,scope:'attributed_material_class_reference',
   property_key:profile.property,value:s[profile.property],unit:profile.unit,
   condition:q.condition,citations:q.citations,source:q.source});
  const prior=await deps.find(r);
  if(prior.error)return reply(503,{error:'Wire reference replay lookup unavailable',writes:0});
  observationId=uuid(prior.data?.id)?prior.data.id:null;
  let duplicate=observationId!==null;
  if(!observationId){
   attempted=true;const inserted=await deps.insert(r);
   if(inserted.error||!uuid(inserted.data?.id)){
    // A unique race or a lost insert acknowledgement may already have committed.
    // Recover only this exact source/kind/identifier/hash tuple, then requalify it.
    const winner=await deps.find(r);
    if(winner.error||!uuid(winner.data?.id))return reply(inserted.error?.code==='23514'?409:503,
     {error:'Wire reference admission not acknowledged',admission_attempted:true});
    observationId=winner.data.id;duplicate=true;
   }else{observationId=inserted.data.id;created=true;}
  }
  const projected=await deps.project(observationId!);
  if(projected.error||projected.data?.success!==true||projected.data?.observation_id!==observationId
   ||projected.data?.condition_key!==s[profile.condition]||projected.data?.current_source_verified!==true)
   return reply(projected.error?.code==='23514'?409:503,{error:'Wire reference projection not currently qualified',
    observation_id:observationId,admission:created?'created':'reused',projected:false});
  return reply(200,{success:true,duplicate,observation_id:observationId,condition_key:s[profile.condition],
   current_source_verified:true,scope:'attributed_material_class_reference',applicability_status:'unassessed',
   installed_state:'unestablished'});
 }catch{
  return reply(503,{error:'Wire reference intake interrupted',observation_id:observationId,admission_attempted:attempted});
 }
}
