import { retainedListingIdentityValue } from "./retainedListingIdentity.ts";
import { deriveRetainedInterior } from "./retainedInterior.ts";
import { validateObservationProperty } from "./imageProperties.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error("assertion failed");};
// Shared with the SQL fixture: exact JSON values, including rejected coercions.
const cases: [string, unknown, unknown][] = [
 ["year",2001,2001],["year",1800,1800],["year",2100,2100],
 ["year","2001",null],["year",2001.5,null],["year",null,null],["year",true,null],
 ["year",1799,null],["year",2101,null],["year",0,null],
 ["make","Example Manufacturer","Example Manufacturer"],["make","Škoda","Škoda"],
 ["model","Prototype 2.0","Prototype 2.0"],["model","X-1 / GT","X-1 / GT"],
 ["make","Unknown",null],["model","N/A",null],["model","other",null],["make","",null],
 ["model"," GT",null],["model","GT ",null],["model","GT\n",null],
 ["make",42,null],["model",{},null],["model",[],null],["trim","GT",null],
];
for(const [key,input,expected]of cases)Deno.test(`exact retained identity ${key} ${JSON.stringify(input)}`,()=>{
 assert(retainedListingIdentityValue(key,input)===expected);
});
const source:any={id:"11111111-1111-4111-8111-111111111111",vehicle_id:"22222222-2222-4222-8222-222222222222",
 kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
 source_id:"33333333-3333-4333-8333-333333333333",source_url:"https://bringatrailer.com/listing/synthetic",
 observed_at:null,ingested_at:"2026-10-10T00:00:00.123456Z",extraction_method:"html_match",confidence_score:.85,
 structured_data:{year:2001,make:"Example Manufacturer",model:"Prototype GT"}};
const vehicle={id:source.vehicle_id,is_public:true,deleted_at:null,listing_kind:"vehicle"};
const registrySource={id:source.source_id,slug:"bat"};
Deno.test("identity selectors preserve exact source values and clocks without physical identity resolution",()=>{
 for(const key of ["year","make","model"]){
  const d=deriveRetainedInterior(source,vehicle,registrySource,`retained_listing_${key}_v1`)!;
  assert(d.structured_data[key]===source.structured_data[key] && d.structured_data.source_value===source.structured_data[key]);
  assert(d.structured_data.source_field===key && d.structured_data.identity_role==="extractor_vehicle_label");
  assert(d.structured_data.identity_resolution_status==="unverified" && d.structured_data.source_event_time_status==="unknown");
  assert(d.observed_at===source.ingested_at && d.structured_data.source_observed_at===null && d.agent_cost_cents===0);
  const p={id:vehicle.id,property_key:key,namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]};
  assert(validateObservationProperty(d,p,true).ok);
  assert(!validateObservationProperty({...d,structured_data:{...d.structured_data,identity_resolution_status:"verified"}},p,true).ok);
  assert(!deriveRetainedInterior({...source,extraction_method:"html_description_capture"},vehicle,registrySource,`retained_listing_${key}_v1`));
 }
 assert(!deriveRetainedInterior(source,{...vehicle,is_public:false},registrySource,"retained_listing_make_v1"));
 assert(!deriveRetainedInterior({...source,structured_data:{...source.structured_data,year:"2001"}},vehicle,registrySource,"retained_listing_year_v1"));
});
Deno.test("identity text bounds count Unicode characters consistently with SQL",()=>{
 assert(retainedListingIdentityValue("model","🚙".repeat(120))!==null);
 assert(retainedListingIdentityValue("model","🚙".repeat(121))===null);
 assert(retainedListingIdentityValue("model","a\u007fb")===null);
});
Deno.test("BaT sale-result labels retain source clocks and never become verified identity",()=>{
 const closed={...source,kind:"sale_result"};
 for(const key of ["year","make","model"]){
  const mode=`retained_listing_${key}_v1`;
  const d=deriveRetainedInterior(closed,vehicle,registrySource,mode)!;
  assert(d && d.structured_data[key]===closed.structured_data[key as keyof typeof closed.structured_data]);
  assert(d.observed_at===closed.ingested_at && d.raw_source_ref===`vehicle_observations:${closed.id}`);
  assert(d.structured_data.identity_resolution_status==="unverified" && d.structured_data.source_event_time_status==="unknown");
  assert(d.structured_data.source_observed_at===closed.observed_at && !("source_captured_at" in d.structured_data));
  for(const patch of [{kind:"bid"},{extraction_method:"backfill-sale-results"},{extraction_method:"html_description_capture"},
   {is_superseded:true},{source_url:"https://bringatrailer.com.evil.invalid/listing/test"},{source_url:"https://bringatrailer.com/listing/test?private=1"}])
   assert(!deriveRetainedInterior({...closed,...patch},vehicle,registrySource,mode));
  for(const patch of [{is_public:false},{deleted_at:"2026-10-01"},{listing_kind:"non_vehicle_item"}])
   assert(!deriveRetainedInterior(closed,{...vehicle,...patch},registrySource,mode));
  assert(!deriveRetainedInterior(closed,vehicle,{...registrySource,slug:"mecum"},mode));
 }
 for(const key of ["mileage_miles","engine_family_label"])
  assert(!deriveRetainedInterior(closed,vehicle,registrySource,`retained_listing_${key}_v1`));
});
Deno.test("Mecum index identity keeps the exact source and admits no other source shape or property",()=>{
 const index={...source,kind:"sale_result",extraction_method:"public_lot_index",
  source_url:"https://www.mecum.com/lots/1/1971-chevrolet-k10-custom-pickup/",
  structured_data:{year:1971,make:"Chevrolet",model:"K10 Custom"}};
 const registry={id:source.source_id,slug:"mecum"};
 for(const key of ["year","make","model"]){
  const d=deriveRetainedInterior(index,vehicle,registry,`retained_listing_${key}_v1`)!;
  assert(d && d.source_slug==="mecum" && d.kind==="specification");
  assert(d.structured_data[key]===index.structured_data[key as keyof typeof index.structured_data]);
  assert(d.structured_data.source_extraction_method==="public_lot_index" && d.structured_data.identity_resolution_status==="unverified");
  assert(d.structured_data.source_observed_at===index.observed_at && d.structured_data.source_recorded_at===index.ingested_at);
 }
 for(const patch of [{kind:"comment"},{extraction_method:"html_match"},{is_superseded:true},
  {source_url:"https://mecum.com.evil.invalid/lots/1/lot/"},{source_url:"https://www.mecum.com/lots/1/lot/?x=1"}])
  assert(!deriveRetainedInterior({...index,...patch},vehicle,registry,"retained_listing_model_v1"));
 for(const key of ["vin","engine_configuration","transmission_type","interior_color"])
  assert(!deriveRetainedInterior(index,vehicle,registry,`retained_listing_${key}_v1`));
 assert(!deriveRetainedInterior(index,{...vehicle,is_public:false},registry,"retained_listing_model_v1"));
 assert(!deriveRetainedInterior(index,vehicle,{...registry,slug:"bat"},"retained_listing_model_v1"));
});
