import {proposedDescriptionEngineFamilyLabelWitness,proposedRetainedEngineFamilyLabelWitness,descriptionPowertrainWitness} from "./retainedDescriptionPowertrain.ts";
import {deriveRetainedInterior} from "./retainedInterior.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error("assertion failed");};
const opening="This vehicle is described by its publisher with records. ";
const rest=" Factory and current configuration remain unverified.";
const cases:[string,string|null][]=[
 ["Powered by a 2.5-liter M50 inline-six paired with a five-speed manual transmission, the car is described by its publisher.","M50"],
 ["The car is powered by a 5.7-liter LS1 V8 paired with a manual transmission.","LS1"],
 ["The truck is powered by a 4.7-liter 2UZ-FE V8 linked to an automatic transmission.","2UZ-FE"],
 ["Power comes from a 2.6-liter RB26DETT inline-six.","RB26DETT"],
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
 ["The car is powered by a 2.0-liter N20 inline-four and includes an LS6-style throttle body.","N20"],
];
for(const [sentence,expected]of cases)Deno.test(`proposed engine family label: ${sentence}`,()=>{
 const witness=proposedDescriptionEngineFamilyLabelWitness(opening+sentence+rest);
 assert((witness?.value??null)===expected);
 if(witness)assert(witness.source_value===sentence.split('. Power comes',1)[0]+(sentence.includes('. Power comes')?'.':''));
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
Deno.test("proposed family label does not add a casting-code or unratified family intake route",()=>{
 const p:any={content_text:opening+cases[0][0]+rest};
 assert(proposedDescriptionEngineFamilyLabelWitness(p.content_text)?.value==="M50");
 assert(descriptionPowertrainWitness("engine_code",p.content_text)===null);
 assert(descriptionPowertrainWitness("engine_family_label",p.content_text)===null);
 assert(deriveRetainedInterior(p,null,null,"retained_listing_engine_code_v1")===null);
 assert(deriveRetainedInterior(p,null,null,"retained_listing_engine_family_label_v1")===null);
});
