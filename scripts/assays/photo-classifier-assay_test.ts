import { runPhotoClassifierAssay,validateManifest,ASSAY_VEHICLE,ASSAY_EVENT,ASSAY_POSITIONS } from './photo-classifier-assay.ts';
import type { classifyImage,ClassificationResult } from '../../supabase/functions/photo-pipeline-orchestrator/classifier.ts';
function assert(value:unknown):asserts value {if(!value)throw new Error('assertion failed');}
const manifest = () => ({images:ASSAY_POSITIONS.map((position,index)=>({image_id:`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`,
  vehicle_id:ASSAY_VEHICLE,auction_event_id:ASSAY_EVENT,position,image_url:`https://bringatrailer.com/wp-content/uploads/fixture${index}.jpg`,
  source_url:'https://bringatrailer.com/listing/2006-pontiac-solstice-92',listing_url:'https://bringatrailer.com/listing/2006-pontiac-solstice-92',
  source:'bat_import',is_document:false,is_sensitive:false,is_duplicate:false,is_superseded:false,vision_gate_status:'pending'}))});
const verdict:ClassificationResult={image_type:'other',image_medium:'photograph',is_automotive:true,confidence:0.5,description:'Fixture',classifier_ok:true,
  classifier_receipt:{model:'gemini-2.5-flash-lite',attempts:1,estimated_cost_usd:0.0002}};
for(const change of [{is_sensitive:true},{vehicle_id:'other'},{auction_event_id:'other'},{vision_gate_status:'review_needed'},
  {image_url:'https://bringatrailer.com.evil.invalid/wp-content/uploads/a.jpg'},{position:400}])Deno.test(`manifest rejects ${Object.keys(change)[0]} mismatch`,()=>{
    const m=manifest();Object.assign(m.images[0],change);let failed=false;try{validateManifest(m);}catch{failed=true;}assert(failed);
});
Deno.test('20 fixed public sources fit $0.04 and do not touch a database',async()=>{
 let calls=0; const result=await runPhotoClassifierAssay(manifest(),'fixture',{classify:(async(_url,_key,_fetch,options)=>{calls++;assert(options?.model==='gemini-2.5-flash-lite');return structuredClone(verdict);}) as typeof classifyImage});
 assert(calls===20&&result.passed===20&&result.database_writes===0&&result.reserved_generation_cost_usd<0.04&&result.unattempted_image_ids.length===0);
});
for(const status of [400,401,403,404,429])Deno.test(`provider ${status} stops after one request and preserves19 IDs`,async()=>{
 let calls=0;const result=await runPhotoClassifierAssay(manifest(),'fixture',{classify:(async()=>{calls++;return {...verdict,classifier_ok:false,classifier_receipt:{model:'gemini-2.5-flash-lite',attempts:1,failure_phase:'classification',http_status:status}};})as typeof classifyImage});
 assert(calls===1&&result.status==='stopped'&&result.unattempted_image_ids.length===19&&result.unresolved_usage_attempts===1&&result.known_estimated_cost_usd===0);
});
Deno.test('two ambiguous provider failures stop cohort; usage stays unresolved',async()=>{
 const result=await runPhotoClassifierAssay(manifest(),'fixture',{classify:(async()=>({...verdict,classifier_ok:false,classifier_receipt:{model:'gemini-2.5-flash-lite',attempts:1,failure_phase:'classification',error_class:'classifier_timeout'}}))as typeof classifyImage});
 assert(result.calls===2&&result.unresolved_usage_attempts===2&&result.unattempted_image_ids.length===18);
});
Deno.test('failed durable receipt prevents spending',async()=>{
 let called=false,failed=false;try{await runPhotoClassifierAssay(manifest(),'fixture',{classify:(async()=>{called=true;return verdict;})as typeof classifyImage,save:async()=>{throw new Error('disk');}});}catch{failed=true;}
 assert(failed&&!called);
});
