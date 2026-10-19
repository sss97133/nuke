import { retainedPowertrainValue } from "./retainedPowertrain.ts";
import { deriveRetainedInterior, retainedInteriorSelector } from "./retainedInterior.ts";
import { validateObservationProperty } from "./imageProperties.ts";
function equal(a: unknown,b: unknown) { if (JSON.stringify(a)!==JSON.stringify(b)) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
const cases: [string,string,string|number|null][] = [
 ["engine_configuration","Supercharged 6.2-Liter High-Output V8","V8"],
 ["engine_configuration","Turbocharged 1.6-Liter Inline-Three","I3"],
 ["engine_configuration","3.4-Liter Flat-Six","flat-6"],
 ["engine_configuration","Air-Cooled 82ci V-Twin",null],
 ["engine_configuration","V6 or V8",null],
 ["engine_configuration","V6 / V8",null],
 ["engine_displacement_l","302ci V8",4.948893],
 ["engine_displacement_l","Turbocharged 1,493cc Inline-Four",1.493],
 ["engine_displacement_l","6.4L Hemi V8",6.4],
 ["engine_displacement_l","5.0L / 302ci V8",null],
 ["engine_displacement_l","V8",null],
 ["engine_displacement_l","0L",null],
 ["engine_displacement_l","-5.0L",null],
 ["engine_displacement_l","1.2.3L",null],
 ["engine_displacement_l","1,23cc",null],
 ["transmission_type","Six-Speed Manual Transaxle","manual"],
 ["transmission_type","Five-Speed Automatic","automatic"],
 ["transmission_type","CVT","cvt"],
 ["transmission_type","Five-Speed",null],
 ["transmission_type","9-Speed AMG Speedshift TCT",null],
 ["transmission_type","manual or automatic",null],
 ["transmission_type","not automatic",null],
 ["drivetrain_layout","AWD","AWD"],
 ["drivetrain_layout"," 4wd ","4WD"],
 ["drivetrain_layout","AWD conversion",null],
];
for (const [key,raw,want] of cases) Deno.test(`retained powertrain ${key}: ${raw}`,()=>equal(retainedPowertrainValue(key,raw),want));
const id="11111111-1111-4111-8111-111111111111",vid="22222222-2222-4222-8222-222222222222";
const parent={id,vehicle_id:vid,kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
 source_id:id,source_url:"https://bringatrailer.com/listing/fixture",extraction_method:"html_match",confidence_score:.85,
 observed_at:null,ingested_at:"2026-10-05T00:20:05.123456Z",structured_data:{engine_size:"302ci V8",transmission:"Four-Speed Manual",drivetrain:"4WD"}};
const vehicle={id:vid,is_public:true,deleted_at:null,listing_kind:"vehicle"};
Deno.test("four registered keys preserve source text, parent, clock and unknown roles; forged input refused",()=>{
 const original=JSON.stringify(parent);
 for (const key of ["engine_configuration","engine_displacement_l","transmission_type","drivetrain_layout"]) {
  const mode=`retained_listing_${key}_v1`;
  equal(retainedInteriorSelector({mode,source_observation_id:id}),id);
  equal(retainedInteriorSelector({mode,source_observation_id:id,structured_data:{[key]:"forged"}}),null);
  const output=deriveRetainedInterior(parent,vehicle,{id,slug:"bat"},mode)!;
  equal(output.structured_data.source_value,parent.structured_data[output.structured_data.source_field as keyof typeof parent.structured_data]);
  equal(output.observed_at,parent.ingested_at); equal(output.structured_data.source_observed_at,null);
  equal(output.structured_data.factory_configuration_status,"unknown");equal(output.structured_data.independent_source,false);
  equal(output.structured_data.normalization_version,"retained_powertrain_v1");
  const property={id,namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]};
  equal(validateObservationProperty(output,property,true).ok,true);
  equal(validateObservationProperty(output,property).ok,false);
  equal(deriveRetainedInterior(parent,{...vehicle,is_public:false},{id,slug:"bat"},mode),null);
  equal(deriveRetainedInterior({...parent,is_superseded:true},vehicle,{id,slug:"bat"},mode),null);
 }
 equal(JSON.stringify(parent),original);
});
