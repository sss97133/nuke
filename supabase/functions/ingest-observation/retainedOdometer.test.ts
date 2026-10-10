import { retainedOdometerWitness } from "./retainedOdometer.ts";
import { deriveRetainedInterior } from "./retainedInterior.ts";
import { validateObservationProperty } from "./imageProperties.ts";
const prefix = "This vehicle is offered with service records and a clean title. ";
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
const cases: [string,number|null][] = [
 ["The six-digit odometer shows 67k miles, approximately 46k of which were added under current ownership.",67000],
 ["The digital odometer indicates 53k miles.",53000],
 ["The five-digit odometer shows 2,900 miles, approximately 400 of which were ridden under current ownership.",2900],
 ["The six-digit odometer shows 546 kilometers (~339 miles), which is said to represent the distance covered since refurbishment.",339],
 ["The six-digit odometer shows 24k kilometers (~15k miles).",14913],
 ["The digital odometer displays 0 miles.",0],
 ["The digital odometer reads 1.001k miles.",1001],
 ["The digital odometer indicates 660 miles, approximately 500 of which were added under current ownership.",660],
 ["The five-digit odometer shows ~24k miles, though it is not accurate to the chassis and total mileage is unknown.",24000],
 ["The digital odometer shows 5 miles. The digital odometer shows 6 miles.",null],
 ["The digital odometer shows 5 miles or 6 miles.",null],
 ["The digital odometer would show 5 miles after a reset.",null],
 ["The previously installed odometer showed 19k miles.",null],
 ["The digital odometer shows 1,23 miles.",null],
 ["The digital odometer shows -5 miles.",null],
 ["The digital odometer shows 2.5 miles.",null],
 ["The digital odometer shows 10000000 miles.",null],
 ["The seller has driven the vehicle 5,000 miles.",null],
 ["The digital odometer is illegible, and total mileage is unknown.",null],
 ["The retrofitted digital odometer now indicates 38 miles.",38],
];
for(const [i,[body,want]] of cases.entries())Deno.test(`retained odometer ${i}`,()=>equal(retainedOdometerWitness(prefix+body)?.value??null,want));
Deno.test("odometer display retains exact quote, source unit/precision and unknown true mileage",()=>{
 const sentence=cases[0][0];const w=retainedOdometerWitness(prefix+sentence)!;
 equal(w.source_value,sentence);equal(w.source_reading_value,67000);equal(w.source_reading_unit,"miles");
 equal(w.reported_precision_miles,1000);equal(w.value_is_approximate,true);
 equal(w.reading_role,"odometer_display");equal(w.true_mileage_status,"unknown");
 const km=retainedOdometerWitness(prefix+cases[3][0])!;equal(km.source_reading_value,546);equal(km.source_reading_unit,"kilometers");equal(km.value_is_approximate,true);
 equal(retainedOdometerWitness(prefix+"The odometer shows 5 miles and "+"an accessory, ".repeat(50)+"a service record."),null);
});
Deno.test("odometer selector uses ratified condition key, original capture clocks and zero model calls",()=>{
 const id="11111111-1111-4111-8111-111111111111",vid="22222222-2222-4222-8222-222222222222";
 const metadata={extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",description_capture:true,
  source_capture_basis:"direct_fetch",source_capture_sha256:"a".repeat(64),source_captured_at:"2026-10-05T00:20:05.123456Z",
  observation_time_basis:"source_capture",source_event_time_status:"unknown",extractor_input_truncated:false};
 const parent={id,vehicle_id:vid,kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
  source_id:id,source_url:"https://bringatrailer.com/listing/fixture",extraction_method:"html_description_capture",confidence_score:1,
  observed_at:metadata.source_captured_at,ingested_at:"2026-10-05T00:20:06.123456Z",content_text:prefix+cases[0][0],structured_data:metadata};
 const vehicle={id:vid,is_public:true,deleted_at:null,listing_kind:"vehicle"};
 const derive=(p=parent,v=vehicle)=>deriveRetainedInterior(p,v,{id,slug:"bat"},"retained_listing_mileage_miles_v1");
 const w=derive()!;equal(w.kind,"condition");equal(w.structured_data.mileage_miles,67000);
 equal(w.structured_data.source_field,"content_text");equal(w.structured_data.true_mileage_status,"unknown");
 equal(w.structured_data.source_observed_at_basis,"source_capture");equal(w.structured_data.source_event_time_status,"unknown");
 equal(w.observed_at,parent.ingested_at);equal(w.structured_data.source_observed_at,parent.observed_at);equal(w.agent_cost_cents,0);
 const property={id:"abdd7a7a-02c1-4b09-afc6-1a288207dd2d",namespace:"core",deprecated_at:null,applies_to_kinds:["condition","listing","work_record"]};
 equal(validateObservationProperty(w,property,true).ok,true);equal(validateObservationProperty(w,property).ok,false);
 equal(validateObservationProperty({...w,structured_data:{...w.structured_data,true_mileage_status:"verified"}},property,true).ok,false);
 equal(derive({...parent,extraction_method:"html_match"}),null);equal(derive(parent,{...vehicle,is_public:false}),null);
 equal(derive({...parent,structured_data:{...metadata,source_capture_sha256:"bad"}}),null);
});
