import { descriptionIdentityWitness,retainedDescriptionIdentityWitness } from "./retainedDescriptionIdentity.ts";
import { deriveRetainedInterior } from "./retainedInterior.ts";
const assert=(v:unknown)=>{if(!v)throw Error("assertion failed");};
const rest=" The vehicle is offered with service records, factory literature, and a clean title. Identity and configuration remain unverified.";
const cases:[string,string|null,string|null][]=[
 ["This 1977 Ford F-150 Ranger was purchased by its seller.","Ford","F-150 Ranger"],
 ["This 1972 BMW 2002tii is offered with service records.","BMW","2002tii"],
 ["This 1992 Mercedes-Benz 600SL has been refinished.","Mercedes-Benz","600SL"],
 ["This 2017 Mercedes-AMG GLS63 was acquired by its seller.","Mercedes-AMG","GLS63"],
 ["This 2012 Land Rover Range Rover HSE is described by its publisher.","Land Rover","Range Rover HSE"],
 ["This 1994 Porsche 911 Carrera 4 coupe is offered for sale.","Porsche","911 Carrera 4 coupe"],
 ["This 1963 Chevrolet Corvette convertible is finished in red.","Chevrolet","Corvette convertible"],
 ["This 1952 MG TD is described by its publisher.","MG","TD"],
 ["This 1983 Porsche is described by its publisher.","Porsche",null],
 ["This 1990 Ford-based replica is described by its publisher.",null,null],
 ["This 1990 Unknown Company Roadster is described by its publisher.",null,null],
 ["This 1990 BMW engine is offered separately.",null,null],
 ["This 1990 Toyota other is offered for sale.","Toyota",null],
 ["This 1963 Chevrolet Corvette might be a different year.",null,null],
 ["A previous subject. This 1963 Chevrolet Corvette is offered for sale.",null,null],
 ["This 1973 Alpine White-over-black BMW 2002 is offered for sale.",null,null],
 ["This 2014 Airstream Interstate 24 Lounge Extended was built on a Mercedes-Benz chassis.","Airstream","Interstate 24 Lounge Extended"],
 ["This 1963 chevrolet Corvette is offered for sale.",null,null],
];
for(const [opening,make,model]of cases)Deno.test(`native identity ${opening}`,()=>{
 for(const [key,want]of [["make",make],["model",model]]as const){
  const w=descriptionIdentityWitness(key,opening+rest);assert((w?.value??null)===want);
  if(w)assert(w.source_value===opening&&w.source_subject_label.startsWith(w.source_make_label)&&w.source_year_token.length===4);
 }
});
Deno.test("native identity selector preserves source bounds and model label qualifiers",()=>{
 const p:any={id:"11111111-1111-4111-8111-111111111111",vehicle_id:"22222222-2222-4222-8222-222222222222",
  source_id:"4cdc735c-f117-42f2-889f-ba33805639a5",source_url:"https://bringatrailer.com/listing/native-identity-fixture/",
  kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,confidence_score:.8,
  extraction_method:"html_description_capture",observed_at:"2026-10-11T04:00:00.123456Z",ingested_at:"2026-10-11T04:00:01.123456Z",
  content_text:cases[4][0]+rest,structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",
   description_capture:true,extractor_input_truncated:false,source_capture_basis:"direct_fetch",source_capture_sha256:"a".repeat(64),
   observation_time_basis:"source_capture",source_event_time_status:"unknown",source_captured_at:"2026-10-11T04:00:00.123456Z",make:"invented",model:"invented"}};
 const v={id:p.vehicle_id,is_public:true,deleted_at:null,listing_kind:"vehicle"},s={id:p.source_id,slug:"bat",supported_observations:["listing","specification"]};
 const before=JSON.stringify(p);
 for(const [key,want]of [["make","Land Rover"],["model","Range Rover HSE"]]){
  const d=deriveRetainedInterior(p,v,s,`retained_listing_${key}_v1`)!;assert(d&&d.structured_data[key]===want);
  assert(d.agent_cost_cents===0&&d.structured_data.source_profile==="bat_description_identity_label_v1");
  assert(d.structured_data.model_label_scope==="publisher_subject_label_remainder"&&d.structured_data.identity_resolution_status==="unverified");
  assert(d.structured_data.source_value===cases[4][0]&&d.structured_data.source_make_label==="Land Rover");
  assert(d.structured_data.source_event_time_status==="unknown"&&d.structured_data.independent_source===false);
  assert(!deriveRetainedInterior(p,{...v,is_public:false},s,`retained_listing_${key}_v1`));
  assert(!deriveRetainedInterior({...p,is_superseded:true},v,s,`retained_listing_${key}_v1`));
  assert(!retainedDescriptionIdentityWitness({...p,structured_data:{...p.structured_data,extractor_input_truncated:true}},key));
 }
 assert(!deriveRetainedInterior(p,v,s,"retained_listing_vin_v1")&&JSON.stringify(p)===before);
});
