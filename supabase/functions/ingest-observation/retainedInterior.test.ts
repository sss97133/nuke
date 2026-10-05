import { deriveRetainedInterior, retainedInteriorSelector, RETAINED_INTERIOR_MODE } from "./retainedInterior.ts";
import { validateObservationProperty } from "./imageProperties.ts";
function assert(value: unknown) { if (!value) throw new Error("assertion failed"); }
const id="11111111-1111-4111-8111-111111111111", vehicleId="22222222-2222-4222-8222-222222222222";
const source = {id,vehicle_id:vehicleId,kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
  source_id:id,source_url:"https://bringatrailer.com/listing/test",extraction_method:"html_match",confidence_score:0.7,
  observed_at:"2026-10-05T00:20:05.123456Z",ingested_at:"2026-10-05T00:20:05.234567Z",structured_data:{interior_color:"Jet Black Leather",engine_size:"unknown"}};
const vehicle={id:vehicleId,is_public:true,deleted_at:null,listing_kind:"vehicle"};
const registry={id,slug:"bat"};
Deno.test("source selector rejects caller-provided testimony",()=>{
 assert(retainedInteriorSelector({mode:RETAINED_INTERIOR_MODE,source_observation_id:id})===id);
 for(const extra of ["structured_data","vehicle_id","source_slug","observed_at","property_key"])
 assert(retainedInteriorSelector({mode:RETAINED_INTERIOR_MODE,source_observation_id:id,[extra]:"fake"})===null);
});
Deno.test("exact retained specification preserves bytes and separate unknown clocks",()=>{
 const result=deriveRetainedInterior(source,vehicle,registry); assert(result);
 assert(result!.structured_data.interior_color===source.structured_data.interior_color);
 assert(result!.observed_at===source.ingested_at);
 assert(result!.structured_data.source_observed_at===source.observed_at);
 assert(result!.structured_data.claim_role==="listing_claim");
 assert(!("agent_model" in result!));
 const unknown=deriveRetainedInterior({...source,observed_at:null},vehicle,registry); assert(unknown);
 assert(unknown!.structured_data.source_observed_at===null);
});
Deno.test("source qualification refuses private, cross-vehicle, wrong-source and uncertain claims",()=>{
 for(const patch of [{kind:"specification"},{is_superseded:true},{subject_type:"organization"},{property_id:id},
 {source_url:"https://bringatrailer.com/listing/test?token=private"},{source_url:"https://example.test/listing/test"},
 {confidence_score:0.5},{confidence_score:NaN},{ingested_at:"unknown"},{extraction_method:"image_analysis"},
 {structured_data:{interior_color:"unknown"}},{structured_data:{interior_color:42}}])
 assert(deriveRetainedInterior({...source,...patch},vehicle,registry)===null);
 for(const patch of [{is_public:false},{deleted_at:"2026-10-01"},{id},{listing_kind:"non_vehicle_item"}])
 assert(deriveRetainedInterior(source,{...vehicle,...patch},registry)===null);
 assert(deriveRetainedInterior(source,vehicle,{id,slug:"mecum"})===null);
});
Deno.test("non-image property requires server-owned verified path and registered compatible property",()=>{
 const input=deriveRetainedInterior(source,vehicle,registry)!;
 const property={id,namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]};
 assert(!validateObservationProperty(input,property).ok);
 assert(validateObservationProperty(input,property,true).ok);
 assert(!validateObservationProperty(input,{...property,namespace:"pending"},true).ok);
 assert(!validateObservationProperty({...input,property_key:"engine_configuration"},property,true).ok);
});
