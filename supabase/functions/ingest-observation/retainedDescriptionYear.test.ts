import {descriptionYearWitness,retainedDescriptionYearWitness} from "./retainedDescriptionYear.ts";
import {deriveRetainedInterior} from "./retainedInterior.ts";
import {validateObservationProperty} from "./imageProperties.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error("assertion failed");};
const rest=" It was acquired in 2026 and has a replacement engine. Its factory configuration and true identity remain unverified.";
// Original introduction years survive; later component/event years are different roles.
const cases:[string,number|null,string|null][]=[
 ["This 1963 Chevrolet Corvette convertible is powered by a V8.",1963,"Chevrolet Corvette convertible"],
 ["This 2001 BMW X5 4.4i remained with its original owner until 2024.",2001,"BMW X5 4.4i"],
 ["This 2014 Airstream Interstate 24 Lounge Extended was built on a 2013 Mercedes-Benz Sprinter 3500 chassis.",2014,"Airstream Interstate 24 Lounge Extended"],
 ["This 1976 GMC is a 26′ motorhome.",1976,"GMC"],
 ["This 1800 Example Vehicle is presented as a vehicle.",1800,"Example Vehicle"],
 ["This 2100 Example Vehicle was described by its publisher.",2100,"Example Vehicle"],
 ["This 1799 Example Vehicle is outside the property meaning.",null,null],
 ["This 2101 Example Vehicle is outside the property meaning.",null,null],
 ["This 73 Chevrolet Corvette is described as a vehicle.",null,null],
 ["This １９７３ Chevrolet Corvette is described as a vehicle.",null,null],
 ["This 1973 Chevrolet Corvette engine was removed from a car.",null,null],
 ["This 1973 Chevrolet Corvette chassis is available separately.",null,null],
 ["This 1973 scale model is a collector's item.",null,null],
 ["This 1973 Chevrolet Corvette might be a different year.",null,null],
 ["The seller acquired a Chevrolet Corvette in 1973.",null,null],
 ["A retained heading. This 1973 Chevrolet Corvette is in the second sentence.",null,null],
];
for(const [opening,year,label]of cases)Deno.test(`native opening year ${opening}`,()=>{
 const w=descriptionYearWitness(opening+rest);
 assert((w?.value??null)===year&&(w?.source_subject_label??null)===label);
 if(w)assert(w.source_value===opening&&w.source_year_token===String(year));
});
Deno.test("native year requires the protected original capture envelope and bounded original quote",()=>{
 const p:any={extraction_method:"html_description_capture",observed_at:"2026-10-11T04:00:00.123456Z",ingested_at:"2026-10-11T04:00:01.123456Z",
  content_text:cases[0][0]+rest,structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",
   description_capture:true,extractor_input_truncated:false,source_capture_basis:"direct_fetch",source_capture_sha256:"a".repeat(64),
   observation_time_basis:"source_capture",source_event_time_status:"unknown",source_captured_at:"2026-10-11T04:00:00.123456Z"}};
 assert(retainedDescriptionYearWitness(p)?.value===1963);
 for(const patch of [{source_capture_sha256:null},{source_captured_at:"2026-10-11T04:00:00.123457Z"},{extractor_input_truncated:true},
  {source_text_field:"vehicles.description"},{source_event_time_status:"known"}])assert(!retainedDescriptionYearWitness({...p,structured_data:{...p.structured_data,...patch}}));
 assert(!descriptionYearWitness(cases[0][0]));
 assert(!descriptionYearWitness(cases[0][0]+"x".repeat(32000)));
 assert(!descriptionYearWitness("This 1973 Chevrolet Corvette is "+"x".repeat(480)+"."+rest));
});
Deno.test("native year selector preserves the quote and separate label token with unverified identity",()=>{
 const p:any={id:"11111111-1111-4111-8111-111111111111",vehicle_id:"22222222-2222-4222-8222-222222222222",
  source_id:"4cdc735c-f117-42f2-889f-ba33805639a5",source_url:"https://bringatrailer.com/listing/native-year-fixture/",
  kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,confidence_score:.8,
  extraction_method:"html_description_capture",observed_at:"2026-10-11T04:00:00.123456Z",ingested_at:"2026-10-11T04:00:01.123456Z",
  content_text:cases[2][0]+rest,structured_data:{extractor:"extract-bat-core",source_text_field:"extract-bat-core.extractDescription",
   description_capture:true,extractor_input_truncated:false,source_capture_basis:"direct_fetch",source_capture_sha256:"a".repeat(64),
   observation_time_basis:"source_capture",source_event_time_status:"unknown",source_captured_at:"2026-10-11T04:00:00.123456Z",year:1990}};
 const v={id:p.vehicle_id,is_public:true,deleted_at:null,listing_kind:"vehicle"},s={id:p.source_id,slug:"bat",supported_observations:["listing","specification"]};
 const before=JSON.stringify(p),d=deriveRetainedInterior(p,v,s,"retained_listing_year_v1")!;
 assert(d.kind==="specification"&&d.structured_data.year===2014&&d.structured_data.source_year_token==="2014");
 assert(d.structured_data.source_value===cases[2][0]&&d.structured_data.source_subject_label==="Airstream Interstate 24 Lounge Extended");
 assert(d.structured_data.year_label_basis==="native_listing_subject_introduction"&&d.structured_data.identity_resolution_status==="unverified");
 assert(d.structured_data.source_event_time_status==="unknown"&&d.structured_data.factory_configuration_status==="unknown"&&d.agent_cost_cents===0);
 assert(d.structured_data.source_field==="content_text"&&d.structured_data.source_capture_sha256===p.structured_data.source_capture_sha256&&JSON.stringify(p)===before);
 assert(validateObservationProperty(d,{id:v.id,namespace:"core",deprecated_at:null,applies_to_kinds:["specification","listing"]},true).ok);
 assert(deriveRetainedInterior(p,v,s,"retained_listing_make_v1")?.structured_data.make==="Airstream"&&deriveRetainedInterior(p,v,s,"retained_listing_model_v1")?.structured_data.model==="Interstate 24 Lounge Extended");
 assert(!deriveRetainedInterior({...p,content_text:cases[10][0]+rest},v,s,"retained_listing_year_v1"));
 assert(!deriveRetainedInterior(p,{...v,is_public:false},s,"retained_listing_year_v1"));
});
