import {proposedDescriptionEngineFamilyLabelWitness,proposedRetainedEngineFamilyLabelWitness,descriptionPowertrainWitness} from "./retainedDescriptionPowertrain.ts";
import {deriveRetainedInterior, retainedInteriorSelector} from "./retainedInterior.ts";
import {validateObservationProperty, type ObservationPropertyRegistryRow} from "./imageProperties.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error("assertion failed");};
const opening="This vehicle is described by its publisher with records. ";
const rest=" Factory and current configuration remain unverified.";
const cases:[string,string|null][]=[
 ["Powered by a 2.5-liter M50 inline-six paired with a five-speed manual transmission, the car is described by its publisher.","M50"],
 ["The car is powered by a 5.7-liter LS1 V8 paired with a manual transmission.","LS1"],
 ["The truck is powered by a 4.7-liter 2UZ-FE V8 linked to an automatic transmission.","2UZ-FE"],
 ["Power comes from a 2.6-liter RB26DETT inline-six.","RB26DETT"],
 ["This vehicle is powered by a 2.0-liter N20 inline-four.","N20"],
 ["The car was powered by a 2.0-liter N20 inline-four.","N20"],
 ["It is powered by a 2.0-liter N20 inline-four.","N20"],
 ["Power is provided by a 2.0-liter N20 inline-four.","N20"],
 ["Power is supplied by a 2.0-liter N20 inline-four.","N20"],
 ["Power is from a 2.0-liter N20 inline-four.","N20"],
 ["The car is powered by a turbocharged 2.0-liter N20 inline-four.","N20"],
 ["The car is powered by a supercharged 2.0-liter N20 inline-four.","N20"],
 ["The car is powered by twin-turbocharged 2.0-liter N20 inline-four.","N20"],
 ["The car is powered by a 2.0-liter N20 inline-four. Power comes from a 2.0-liter N20 inline-four.","N20"],
 ["The car is powered by a 2.0-liter N20 inline-four. Power comes from a 2.0-liter B48 inline-four.",null],
 ["The car is powered by a 2.0-liter N20 inline-four. Power comes from a 3.0-liter N20 inline-six.",null],
 ["The 2.0-liter N20 inline-four was factory rated at a stated output.",null],
 ["The engine stamping includes sequence 1234567.",null],
 ["The engine stamp pad is blank, and a casting number is shown in the gallery.",null],
 ["The car is powered by a 2.0-liter 16V inline-four.",null],
 ["The car is powered by a 2.0-liter DOHC inline-four.",null],
 ["The car is powered by a 2.0-liter N20-style inline-four.",null],
 ["The car would be powered by a 2.0-liter N20 inline-four.",null],
 ["The car was formerly powered by a 2.0-liter N20 inline-four.",null],
 ["The other car is powered by a 2.0-liter N20 inline-four.",null],
 ["The car is powered by a 2.0-liter N20 inline-four and a spare engine.",null],
 ["The car is powered by a 2.0-liter N20 inline-four or a replacement engine.",null],
 ["The seller says the car is powered by a 2.0-liter N20 inline-four.",null],
 ["The car is powered by a 2.0-liter N20 inline-four?",null],
 ["This model is powered by a 2.0-liter N20 inline-four.",null],
 ["This brochure describes a car powered by a 2.0-liter N20 inline-four.",null],
 ["The car is powered by electricity and includes a brochure describing a 2.0-liter N20 inline-four.",null],
 ["The car shown in a reference photograph is powered by a 2.0-liter N20 inline-four.",null],
 ["The car is allegedly powered by a 2.0-liter N20 inline-four.",null],
 ["The car is powered by a 2.0-liter N20 inline-four, reportedly.",null],
 ["The car is powered by a 2.0-liter N20 inline-four, apparently.",null],
 ["The car is powered by a possible 2.0-liter N20 inline-four.",null],
 ["The car is powered by a presumed 2.0-liter N20 inline-four.",null],
 ["The car is powered by what is believed to be a 2.0-liter N20 inline-four.",null],
 ["The car is powered by what is said to be a 2.0-liter N20 inline-four.",null],
 ["The car is powered by a 2.0-liter N20 inline-four. This model is powered by a 2.0-liter N20 inline-four.",null],
 ["The car is powered by a 2.0-liter N20 inline-four. The car is powered by a 2.0-liter N20 inline-four?",null],
 ["The car is powered by a 2.0-liter N20 inline-four and includes an LS6-style throttle body.","N20"],
];
for(const [sentence,expected]of cases)Deno.test(`proposed engine family label: ${sentence}`,()=>{
 const witness=proposedDescriptionEngineFamilyLabelWitness(opening+sentence+rest);
 assert((witness?.value??null)===expected);
 if(witness)assert(witness.source_value===sentence.split('. Power comes',1)[0]+(sentence.includes('. Power comes')?'.':''));
});
Deno.test("narrow family subject qualification preserves the existing powertrain witness grammar",()=>{
 const text=opening+"Finished in black, the car is powered by a 2.0-liter N20 inline-four."+rest;
 assert(descriptionPowertrainWitness("engine_configuration",text)?.value==="I4");
 assert(descriptionPowertrainWitness("engine_displacement_l",text)?.value===2);
 assert(proposedDescriptionEngineFamilyLabelWitness(text)===null);
});
Deno.test("proposed family label preserves the exact quote and capture envelope, refuses byte bounds",()=>{
 const text=opening+cases[0][0]+rest;
 const p:any={extraction_method:"html_description_capture",observed_at:"2026-10-11T08:00:00.123456Z",ingested_at:"2026-10-11T08:00:01.123456Z",content_text:text,
 structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",description_capture:true,extractor_input_truncated:false,
 source_capture_basis:"protected_snapshot",source_capture_sha256:"a".repeat(64),source_captured_at:"2026-10-11T08:00:00.123456Z",observation_time_basis:"source_capture",source_event_time_status:"unknown"}};
 const original=JSON.stringify(p);assert(proposedRetainedEngineFamilyLabelWitness(p)?.value==="M50"&&JSON.stringify(p)===original);
 for(const patch of [{source_capture_sha256:null},{source_capture_basis:"unqualified"},{extractor_input_truncated:true},{source_text_field:"vehicles.description"},
  {source_captured_at:"2026-10-11T08:00:00.123457Z"},{source_event_time_status:"known"}])assert(!proposedRetainedEngineFamilyLabelWitness({...p,structured_data:{...p.structured_data,...patch}}));
 assert(!proposedDescriptionEngineFamilyLabelWitness(cases[0][0].slice(0,80)));
 assert(!proposedDescriptionEngineFamilyLabelWitness(text+"x".repeat(32000)));
 assert(!proposedDescriptionEngineFamilyLabelWitness(opening+cases[0][0].slice(0,-1)+" x".repeat(300)+"."+rest));
});
Deno.test("family witness never treats publisher labels as casting or serial engine codes",()=>{
 const p:any={content_text:opening+cases[0][0]+rest};
 assert(proposedDescriptionEngineFamilyLabelWitness(p.content_text)?.value==="M50");
 assert(descriptionPowertrainWitness("engine_code",p.content_text)===null);
 assert(descriptionPowertrainWitness("engine_family_label",p.content_text)===null);
 assert(deriveRetainedInterior(p,null,null,"retained_listing_engine_code_v1")===null);
 assert(deriveRetainedInterior(p,null,null,"retained_listing_engine_family_label_v1")===null);
});

const sourceId="11111111-1111-4111-8111-111111111111",vehicleId="22222222-2222-4222-8222-222222222222";
const source={id:sourceId,vehicle_id:vehicleId,kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
 source_id:sourceId,source_url:"https://bringatrailer.com/listing/engine-family-fixture/",extraction_method:"html_description_capture",confidence_score:.85,
 observed_at:"2026-10-11T08:00:00.123456Z",ingested_at:"2026-10-11T08:00:01.123456Z",content_text:opening+cases[0][0]+rest,
 structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",description_capture:true,extractor_input_truncated:false,
 source_capture_basis:"protected_snapshot",source_capture_sha256:"a".repeat(64),source_captured_at:"2026-10-11T08:00:00.123456Z",
 observation_time_basis:"source_capture",source_event_time_status:"unknown"}};
const vehicle={id:vehicleId,is_public:true,deleted_at:null,listing_kind:"vehicle"};
const registeredSource={id:sourceId,slug:"bat"};
const mode="retained_listing_engine_family_label_v1";
const property:ObservationPropertyRegistryRow={id:"33333333-3333-4333-8333-333333333333",namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]};
const derive=(parent:Record<string,any>=source)=>deriveRetainedInterior(parent,vehicle,registeredSource,mode);

Deno.test("explicit retained family selector preserves the complete witness tuple and exact capture clocks",()=>{
 const before=JSON.stringify(source),child=derive()!;
 assert(child!==null&&child.property_key==="engine_family_label"&&child.kind==="specification");
 assert(retainedInteriorSelector({mode,source_observation_id:sourceId})===sourceId);
 assert(retainedInteriorSelector({mode,source_observation_id:sourceId,engine_family_label:"B48"})===null);
 const expected={engine_family_label:"M50",source_value:cases[0][0],normalization_version:"retained_engine_family_label_v1",
  source_witness_version:"retained_description_engine_family_label_v1",source_field:"content_text",source_observation_id:sourceId,
  source_capture_sha256:"a".repeat(64),source_captured_at:source.structured_data.source_captured_at,source_capture_basis:"protected_snapshot",
  source_observed_at:source.observed_at,source_recorded_at:source.ingested_at,observed_at_basis:"source_testimony_recorded_at",
  source_extraction_method:"html_description_capture",projection_version:mode,property_key:"engine_family_label",claim_role:"listing_claim",
  label_role:"publisher_powering_engine_label",engine_identity_status:"unverified",source_event_time_status:"unknown",
  factory_configuration_status:"unknown",current_configuration_status:"unknown",independent_source:false};
 for(const [key,value]of Object.entries(expected))assert(child.structured_data[key]===value);
 assert(child.observed_at===source.ingested_at&&child.raw_source_ref===`vehicle_observations:${sourceId}`);
 assert(child.source_identifier===`${mode}:${sourceId}`&&child.source_url===source.source_url);
 assert("agent_inferred" in child&&child.agent_inferred===true&&child.agent_cost_cents===0&&"defer_analysis" in child&&child.defer_analysis===true);
 assert(child.content_text.includes(cases[0][0])&&!Object.hasOwn(child.structured_data,"engine_code"));
 assert(JSON.stringify(source)===before);
 for(const [sentence,value]of cases){
  const candidate=derive({...source,content_text:opening+sentence+rest});
  assert((candidate?.structured_data.engine_family_label??null)===value);
  if(candidate)assert(validateObservationProperty(candidate,property,true).ok);
 }
});

Deno.test("family selector refuses inferred html-match fields, conflicting labels and unqualified source captures",()=>{
 assert(derive({...source,extraction_method:"html_match",structured_data:{engine_family_label:"M50",engine_size:"2.5-liter M50 inline-six"}})===null);
 for(const patch of [{source_capture_sha256:null},{source_capture_basis:"unqualified"},{extractor_input_truncated:true},
  {source_text_field:"vehicles.description"},{source_captured_at:"2026-10-11T08:00:00.123457Z"},{source_event_time_status:"known"}]){
  assert(derive({...source,structured_data:{...source.structured_data,...patch}})===null);
 }
 assert(derive({...source,is_superseded:true})===null);
 assert(deriveRetainedInterior(source,{...vehicle,is_public:false},registeredSource,mode)===null);
 assert(deriveRetainedInterior(source,vehicle,{...registeredSource,slug:"other"},mode)===null);
});

Deno.test("qualified family testimony still refuses absent, pending, deprecated and incompatible registry entries",()=>{
 const child=derive()!;
 for(const row of [null,{...property,namespace:"pending"},{...property,namespace:"deprecated"},
  {...property,deprecated_at:"2026-10-11T08:00:02Z"},{...property,applies_to_kinds:null},{...property,applies_to_kinds:["listing"]}]){
  const result=validateObservationProperty(child,row,true);
  assert(!result.ok&&result.status===400);
 }
 assert(!validateObservationProperty(child,property,false).ok);
 const admitted=validateObservationProperty(child,property,true);
 assert(admitted.ok&&admitted.propertyId===property.id);
});

Deno.test("family admission requires literal-label qualifiers and never certifies engine identity",()=>{
 const child=derive()!;
 for(const [key,value]of [["engine_family_label","DOHC"],["engine_family_label",123],["source_value",null],
  ["normalization_version","retained_powertrain_v1"],["source_witness_version","retained_description_powertrain_v1"],
  ["source_field","engine_size"],["label_role","engine_code"],["engine_identity_status","verified"],
  ["source_event_time_status","known"],["factory_configuration_status","verified"],["current_configuration_status","verified"],
  ["independent_source",true]] as [string,unknown][]){
  assert(!validateObservationProperty({...child,structured_data:{...child.structured_data,[key]:value}},property,true).ok);
 }
 assert(!validateObservationProperty({...child,agent_inferred:false},property,true).ok);
 assert(!validateObservationProperty({...child,kind:"condition"},{...property,applies_to_kinds:["condition"]},true).ok);
});
