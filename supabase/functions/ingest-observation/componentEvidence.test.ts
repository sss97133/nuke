import { prepareComponentEvidence, COMPONENT_PRESENCE_PROPERTY, type ComponentEvidenceInput } from './componentEvidence.ts';
import { validateObservationProperty } from './imageProperties.ts';
const assert=(v:unknown,m='assertion failed')=>{if(!v)throw Error(m)};
const V='10000000-0000-4000-8000-000000000001', I='20000000-0000-4000-8000-000000000001',
 S='30000000-0000-4000-8000-000000000001', T='40000000-0000-4000-8000-000000000001';
export async function componentFixture(label='Battery 78PRMJ',key='fluid.battery') {
 const digest=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const input:ComponentEvidenceInput={component_key:key,property_key:COMPONENT_PRESENCE_PROPERTY,vehicle_id:V,kind:'condition',agent_inferred:true,defer_analysis:true,
 structured_data:{component_visible_present:true},component_reading:{source_observation_id:S,image_id:I,source_url:'https://images.example/battery.jpg',
 path:['components_seen','0','label'],value_sha256:await digest(label),quote:label}};
 const subject={subject_id:T,subject_key:key,display_name:'Battery',is_active:true,domain:'mechanical',category:'fluid'};
 const source={id:S,vehicle_id:V,is_superseded:false,extraction_method:'reviewed_image_analysis_v1',source_url:'https://images.example/battery.jpg',
 observed_at:'2026-11-10T16:25:10.731Z',structured_data:{image_id:I,components_seen:[{label,bbox:[10,20,980,990],part_number_guess:'78PRMJ'}]}};
 const image={id:I,vehicle_id:V,image_url:source.source_url,is_sensitive:false,is_document:false,redaction_level:'none'};
 return {input,subject,source,image,digest};
}
Deno.test('registered component positions retain exact source quote, selector, clock and independent unknowns',async()=>{
 for(const [label,key] of [['Battery 78PRMJ','fluid.battery'],['Alternator housing','engine.alternator'],['Windshield with silver-gray molding','glass.windshield']]) {
  const f=await componentFixture(label,key);const r=await prepareComponentEvidence(f.input,f.subject,f.source,f.image,true);
  assert(r.ok);if(!r.ok)return;assert(r.sourceId===S&&r.observedAt===f.source.observed_at);
  assert((r.structuredData.component_ref as any).identity_basis==='position_only');
  assert((r.structuredData.component_reading as any).physical_unit_identity==='unestablished');
  assert((r.structuredData.component_reading as any).clock_basis==='source_analysis_time');
 }
});
Deno.test('changed, missing, wrong-vehicle, unbound and withdrawn source refuses before any write',async()=>{
 const f=await componentFixture();
 for(const source of [null,{...f.source,is_superseded:true},{...f.source,vehicle_id:I},{...f.source,source_url:'https://images.example/replaced.jpg'},
  {...f.source,structured_data:{components_seen:[{label:'replacement label'}]}}]) assert(!(await prepareComponentEvidence(f.input,f.subject,source,f.image,true)).ok);
 for(const image of [null,{...f.image,is_sensitive:true},{...f.image,is_document:true},{...f.image,redaction_level:'full'},
  {...f.image,vehicle_id:I},{...f.image,image_url:'https://images.example/replaced.jpg'}]) assert(!(await prepareComponentEvidence(f.input,f.subject,f.source,image,true)).ok);
 assert(!(await prepareComponentEvidence(f.input,f.subject,f.source,f.image,false)).ok);
 assert(!(await prepareComponentEvidence(f.input,{...f.subject,is_active:false},f.source,f.image,true)).ok);
});
Deno.test('absence requires exact explicit retained scope and coverage; not visible and cannot tell never become absent',async()=>{
 const f=await componentFixture();
 for(const phrase of ['Battery is absent.','Battery is not missing.','No evidence battery has been removed.','Battery is not visible.','Cannot tell if battery is missing.','Battery is obscured.']) {
  const notes='Battery tray is fully visible from above. '+phrase;
  const selector={source_observation_id:S,image_id:I,source_url:f.source.source_url,path:['agent_notes'],value_sha256:await f.digest(notes),quote:notes,
   absence:{scope:'fluid.battery',view_coverage_quote:'Battery tray is fully visible from above.',absence_quote:phrase,bbox:[10,20,800,900]}};
  const r=await prepareComponentEvidence({...f.input,structured_data:{component_visible_present:false},component_reading:selector},f.subject,
   {...f.source,structured_data:{agent_notes:notes}},f.image,true);
  assert(r.ok===(phrase==='Battery is absent.'),phrase);
 }
 const r=await prepareComponentEvidence({...f.input,structured_data:{component_visible_present:false}},f.subject,f.source,f.image,true);assert(!r.ok);
 const notes='Battery tray is fully visible. No evidence Battery has been removed.';
 const selector={source_observation_id:S,image_id:I,source_url:f.source.source_url,path:['agent_notes'],value_sha256:await f.digest(notes),quote:notes,
 absence:{scope:'fluid.battery',view_coverage_quote:'Battery tray is fully visible.',absence_quote:'Battery has been removed.',bbox:[10,20,800,900]}};
 assert(!(await prepareComponentEvidence({...f.input,structured_data:{component_visible_present:false},component_reading:selector},f.subject,
  {...f.source,structured_data:{agent_notes:notes}},f.image,true)).ok,'embedded negated substring cannot become absence');
});
Deno.test('unknown values, whole-image properties, fabricated selector and wrong-subject condition are refused',async()=>{
 const f=await componentFixture();
 for(const value of [null,'not_visible','cannot_tell',0]) assert(!(await prepareComponentEvidence({...f.input,structured_data:{component_visible_present:value}},f.subject,f.source,f.image,true)).ok);
 assert(!(await prepareComponentEvidence({...f.input,property_key:'image_visible_assembly_state'},f.subject,f.source,f.image,true)).ok);
 assert(!(await prepareComponentEvidence({...f.input,component_reading:{...(f.input.component_reading as object),path:['components_seen','0','part_number_guess']}},f.subject,f.source,f.image,true)).ok);
 const data={damage_localized:[{label:'Glass crack',bbox:[10,20,400,500]}]};
 const input={...f.input,property_key:undefined,descriptor_key:'exterior.glass.fracture',structured_data:{},component_reading:{...(f.input.component_reading as object),path:['damage_localized','0','label'],value_sha256:await f.digest('Glass crack'),quote:'Glass crack'}};
 assert(!(await prepareComponentEvidence(input,f.subject,{...f.source,structured_data:data},f.image,true)).ok);
 assert((await prepareComponentEvidence(input,{...f.subject,domain:'exterior',category:'glass'},{...f.source,structured_data:data},f.image,true)).ok);
});
Deno.test('new property cannot enter through generic intake, pending registry or arbitrary string enum',()=>{
 const input={property_key:COMPONENT_PRESENCE_PROPERTY,kind:'condition',agent_inferred:true,structured_data:{[COMPONENT_PRESENCE_PROPERTY]:true}};
 const registry={id:T,namespace:'core',deprecated_at:null,applies_to_kinds:['condition']};
 assert(!validateObservationProperty(input,registry).ok);
 assert(validateObservationProperty(input,registry,false,false,true).ok);
 assert(!validateObservationProperty(input,{...registry,namespace:'pending'},false,false,true).ok);
});
