import { craigslistOdometerValue,deriveRetainedCraigslistOdometer } from "./retainedCraigslistOdometer.ts";
import { deriveRetainedInterior } from "./retainedInterior.ts";
import { validateObservationProperty } from "./imageProperties.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error("assertion failed");};
const cases: [unknown,number|null][] = [
 ["60,000",60000],["96213",96213],["0",0],["9,999,999",9999999],
 ["10,000,000",null],["53k",null],["~60000",null],["60000 km",null],
 ["1,23",null],["60000 ",null],[" 60000",null],["60000.5",null],
 ["-1",null],[60000,null],[null,null],[{},null],
];
for(const [raw,expected]of cases)Deno.test(`Craigslist auto_miles ${JSON.stringify(raw)}`,()=>assert(craigslistOdometerValue(raw)===expected));
const p:any={id:"11111111-1111-4111-8111-111111111111",vehicle_id:"22222222-2222-4222-8222-222222222222",
 source_id:"d7dad87c-0dc3-4b98-a31a-edf511618f8c",source_url:"https://www.craigslist.org/view/d/example-car/abcDEF_123",
 source_identifier:"7000000001",kind:"listing",extraction_method:"html_parse",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
 confidence_score:.4,observed_at:null,ingested_at:"2026-10-10T00:00:00.123456Z",structured_data:{mileage:123456},
 extraction_metadata:{raw:{post_id:"7000000001",attributes:{raw:{auto_miles:"60,000",odometer_broken:"odometer broken"},odometer_raw:"60,000",odometer:60000,odometer_broken:true,odometer_rolled_over:false}}}};
const v={id:p.vehicle_id,is_public:true,deleted_at:null,listing_kind:"vehicle"},s={id:p.source_id,slug:"craigslist",supported_observations:["listing"]};
Deno.test("Craigslist reading comes from exact native attribute, preserves disclosures and does not use physical scalar confirmation",()=>{
 const d=deriveRetainedCraigslistOdometer(p,v,s)!;
 assert(d.kind==="listing"&&d.structured_data.mileage_miles===60000&&d.structured_data.source_value==="60,000");
 assert(d.structured_data.odometer_broken===true&&d.structured_data.odometer_rolled_over===false&&d.structured_data.true_mileage_status==="unknown");
 assert(d.structured_data.reading_role==="listing_odometer_label"&&d.structured_data.reading_unit_basis==="platform_auto_miles_attribute");
 assert(d.confidence_score===.4&&d.observed_at===p.ingested_at&&d.agent_cost_cents===0&&d.agent_model===null);
 assert(deriveRetainedInterior(p,v,s,"retained_listing_mileage_miles_v1")?.structured_data.mileage_miles===60000);
 const registry={id:v.id,namespace:"core",deprecated_at:null,applies_to_kinds:["condition","listing"]};
 assert(validateObservationProperty(d,registry,true).ok&&!validateObservationProperty(d,registry,false).ok);
 assert(!validateObservationProperty({...d,kind:"condition"},registry,true).ok);
 assert(!deriveRetainedInterior(p,v,s,"retained_listing_transmission_type_v1"));
});
Deno.test("Craigslist source envelope, native post identity and public vehicle qualification stay strict",()=>{
 for(const patch of [{extraction_metadata:null},{source_identifier:"7000000002"},{is_superseded:true},{subject_type:"organization"},{confidence_score:.39},
   {source_url:"https://evil.test/view/d/example-car/abcDEF_123"},{source_url:p.source_url+"?x=1"},{source_url:"https://user@www.craigslist.org/view/d/example-car/abcDEF_123"},
   {source_url:"https://www.craigslist.org/apa/d/example-car/7000000001.html"}])assert(!deriveRetainedCraigslistOdometer({...p,...patch},v,s));
 assert(!deriveRetainedCraigslistOdometer(p,{...v,is_public:false},s));assert(!deriveRetainedCraigslistOdometer(p,v,{...s,supported_observations:["specification"]}));
 for(const patch of [{odometer_raw:"60000"},{odometer:123456},{odometer_broken:false},{odometer_rolled_over:true}]){
  const q=structuredClone(p);Object.assign(q.extraction_metadata.raw.attributes,patch);assert(!deriveRetainedCraigslistOdometer(q,v,s));
 }
 assert(deriveRetainedCraigslistOdometer({...p,source_url:"https://sfbay.craigslist.org/eby/cto/d/example-car/7000000001.html"},v,s));
  assert(!deriveRetainedCraigslistOdometer({...p,source_url:"https://sfbay.craigslist.org/eby/cto/d/example-car/7000000002.html"},v,s));
});
