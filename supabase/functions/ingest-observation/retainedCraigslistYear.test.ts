import { craigslistYearValue,deriveRetainedCraigslistYear } from "./retainedCraigslistYear.ts";
import { deriveRetainedInterior } from "./retainedInterior.ts";
import { validateObservationProperty } from "./imageProperties.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error("assertion failed");};
const cases: [unknown,number|null][] = [
 ["1800",1800],["2100",2100],["1973",1973],["2024",2024],
 ["1799",null],["2101",null],["1973 ",null],[" 1973",null],
 ["73",null],["01973",null],["1973.0",null],["1973/1974",null],
 ["２０２４",null],[1973,null],[null,null],[{},null],
];
for(const [raw,expected]of cases)Deno.test(`Craigslist year ${JSON.stringify(raw)}`,()=>assert(craigslistYearValue(raw)===expected));
const p:any={id:"11111111-1111-4111-8111-111111111111",vehicle_id:"22222222-2222-4222-8222-222222222222",
 source_id:"d7dad87c-0dc3-4b98-a31a-edf511618f8c",source_url:"https://www.craigslist.org/view/d/example-car/abcDEF_123",
 source_identifier:"7000000001",kind:"listing",extraction_method:"html_parse",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
 confidence_score:.8,observed_at:null,ingested_at:"2026-10-10T00:00:00.123456Z",structured_data:{year:1990},
 extraction_metadata:{raw:{post_id:"7000000001",attributes:{raw:{year:"1973",makemodel:"73 midget",auto_miles:"invalid"},odometer:null}}}};
const v={id:p.vehicle_id,is_public:true,deleted_at:null,listing_kind:"vehicle"},s={id:p.source_id,slug:"craigslist",supported_observations:["listing"]};
Deno.test("original year row becomes an unverified listing label independently of odometer or flat physical confirmations",()=>{
 const before=JSON.stringify(p),d=deriveRetainedCraigslistYear(p,v,s)!;
 assert(d.kind==="listing"&&d.structured_data.year===1973&&d.structured_data.source_value==="1973");
 assert(d.structured_data.source_field==="extraction_metadata.raw.attributes.raw.year"&&d.structured_data.source_native_post_id==="7000000001");
 assert(d.structured_data.identity_role==="extractor_vehicle_label"&&d.structured_data.identity_resolution_status==="unverified");
 assert(d.structured_data.source_event_time_status==="unknown"&&d.confidence_score===.4&&d.agent_model===null&&d.agent_cost_cents===0);
 assert(d.observed_at===p.ingested_at&&d.structured_data.source_observed_at===null&&JSON.stringify(p)===before);
 assert(deriveRetainedInterior(p,v,s,"retained_listing_year_v1")?.structured_data.year===1973);
 assert(!deriveRetainedInterior(p,v,s,"retained_listing_mileage_miles_v1")&&!deriveRetainedInterior(p,v,s,"retained_listing_make_v1"));
 const property={id:v.id,namespace:"core",deprecated_at:null,applies_to_kinds:["specification","listing"]};
 assert(validateObservationProperty(d,property,true).ok&&!validateObservationProperty(d,property,false).ok);
 assert(!validateObservationProperty({...d,structured_data:{...d.structured_data,year_label_basis:"vehicle_scalar"}},property,true).ok);
});
Deno.test("year rejects missing/raw-invalid/private/changed-native-post inputs and never parses combined make/model",()=>{
 for(const patch of [{source_identifier:"7000000002"},{is_superseded:true},{subject_type:"organization"},{confidence_score:.39},
  {source_url:p.source_url+"?x=1"},{source_url:"https://WWW.craigslist.org/view/d/example-car/abcDEF_123"},
  {source_url:"https://sfbay.craigslist.org/eby/cto/d/example-car/7000000002.html"}])assert(!deriveRetainedCraigslistYear({...p,...patch},v,s));
 assert(!deriveRetainedCraigslistYear(p,{...v,is_public:false},s));
 assert(!deriveRetainedCraigslistYear(p,v,{...s,supported_observations:["specification"]}));
 const q=structuredClone(p);delete q.extraction_metadata.raw.attributes.raw.year;
 assert(!deriveRetainedCraigslistYear(q,v,s));
 assert(deriveRetainedCraigslistYear({...p,source_url:"https://sfbay.craigslist.org/eby/cto/d/example-car/7000000001.html"},v,s));
});
