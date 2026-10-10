import { descriptionPowertrainWitness } from "./retainedDescriptionPowertrain.ts";
import { descriptionCases } from "./retainedDescriptionPowertrainCases.ts";
import { deriveRetainedInterior } from "./retainedInterior.ts";
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
for (const [i, [key, text, expected]] of descriptionCases.entries()) {
  Deno.test(`native description witness ${i}: ${key}`, () => equal(descriptionPowertrainWitness(key, text)?.value ?? null, expected));
}
const id="11111111-1111-4111-8111-111111111111",vid="22222222-2222-4222-8222-222222222222";
export const descriptionParent={id,vehicle_id:vid,kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
 source_id:id,source_url:"https://bringatrailer.com/listing/fixture",extraction_method:"html_description_capture",confidence_score:1,
 observed_at:"2026-10-05T00:20:05.123456Z",ingested_at:"2026-10-05T00:20:06.123456Z",content_text:descriptionCases[0][1],
 structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",description_capture:true,
 source_capture_basis:"direct_fetch",source_capture_sha256:"a".repeat(64),source_captured_at:"2026-10-05T00:20:05.123456Z",
 observation_time_basis:"source_capture",source_event_time_status:"unknown",extractor_input_truncated:false}};
const vehicle={id:vid,is_public:true,deleted_at:null,listing_kind:"vehicle"};
Deno.test("native capture becomes attributed JSON with verbatim quote, separate clocks and unknown configuration",()=>{
 const original=JSON.stringify(descriptionParent);
 for(const key of ["engine_configuration","engine_displacement_l","transmission_type"]){
  const child=deriveRetainedInterior(descriptionParent,vehicle,{id,slug:"bat"},`retained_listing_${key}_v1`)!;
  equal(child.structured_data[key],descriptionPowertrainWitness(key,descriptionParent.content_text)!.value);
  equal(child.structured_data.source_value,descriptionCases[0][1].split(". ")[1]);
  equal(child.structured_data.source_field,"content_text");equal(child.structured_data.source_witness_version,"retained_description_powertrain_v1");
  equal(child.observed_at,descriptionParent.ingested_at);equal(child.structured_data.source_observed_at,descriptionParent.observed_at);
  equal(child.structured_data.factory_configuration_status,"unknown");equal(child.structured_data.current_configuration_status,"unknown");
  equal(child.agent_cost_cents,0);equal(child.structured_data.independent_source,false);
 }
 equal(JSON.stringify(descriptionParent),original);
 for(const key of ["interior_color","exterior_color","drivetrain_layout"]) equal(deriveRetainedInterior(descriptionParent,vehicle,{id,slug:"bat"},`retained_listing_${key}_v1`),null);
});
Deno.test("native capture qualifier, timestamp, truncation, public/source and supersession refusals",()=>{
 const derive=(p:Record<string,any>,v=vehicle,s={id,slug:"bat"})=>deriveRetainedInterior(p,v,s,"retained_listing_engine_configuration_v1");
 for(const [key,value] of [["description_capture",false],["extractor_input_truncated",true],["extractor","other"],["source_capture_sha256","bad"],
  ["source_capture_basis","unverified"],["source_captured_at","2026-10-05T00:20:05.123455Z"],["source_captured_at","invalid"],
  ["source_event_time_status","known"],["observation_time_basis","auction_end"]] as [string,unknown][]){
  equal(derive({...descriptionParent,structured_data:{...descriptionParent.structured_data,[key]:value}}),null);
 }
 equal(derive({...descriptionParent,ingested_at:"2026-10-05T00:20:05.123455Z"}),null);
 equal(derive({...descriptionParent,is_superseded:true}),null);equal(derive(descriptionParent,{...vehicle,is_public:false}),null);
 equal(derive(descriptionParent,vehicle,{id,slug:"other"}),null);
});
