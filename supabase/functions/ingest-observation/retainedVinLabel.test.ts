import { retainedListingIdentityValue } from "./retainedListingIdentity.ts";
import { deriveRetainedInterior } from "./retainedInterior.ts";
import { validateObservationProperty } from "./imageProperties.ts";
const assert=(ok:unknown)=>{if(!ok)throw Error('assertion failed');};
// SQL consumes this exact corpus. No checksum, identity match or normalization is implied.
const cases: [unknown,string|null][] = [
 ["1FTFW1E80JFA00001","1FTFW1E80JFA00001"],
 ["1ftfw1e80jfa00001",null],["1FTFW1E80JFA00001 ",null],
 [" 1FTFW1E80JFA00001",null],["30867S100001",null],
 ["1FTFW1E8OJFA00001",null],["1FTFW1E8IJFA00001",null],["1FTFW1E8QJFA00001",null],
 ["11111111111111111",null],["00000000000000000",null],
 ["ABCDEFGHJKLMNPRST",null],[12345678901234567,null],[null,null],[{},null],
 ["1FTFW1E80JFA0000１",null],["unknown",null],
];
for(const [value,expected] of cases)Deno.test(`retained VIN label ${JSON.stringify(value)}`,()=>{
 assert(retainedListingIdentityValue('vin',value)===expected);
});
Deno.test('VIN selector preserves literal source label, namespace and clocks without scalar identity changes',()=>{
 const source:any={id:'11111111-1111-4111-8111-111111111111',vehicle_id:'22222222-2222-4222-8222-222222222222',
  source_id:'33333333-3333-4333-8333-333333333333',kind:'listing',extraction_method:'html_match',is_superseded:false,
  property_id:null,subject_type:'vehicle',subject_id:null,source_url:'https://bringatrailer.com/listing/synthetic',
  confidence_score:.85,observed_at:null,ingested_at:'2026-10-10T00:00:00.123456Z',structured_data:{vin:'1FTFW1E80JFA00001'}};
 const vehicle={id:source.vehicle_id,is_public:true,deleted_at:null,listing_kind:'vehicle',vin:'1FTFW1E80JFA00002'};
 const before=JSON.stringify(vehicle),registry={id:source.source_id,slug:'bat'};
 const d=deriveRetainedInterior(source,vehicle,registry,'retained_listing_vin_v1')!;
 assert(d.structured_data.vin===source.structured_data.vin && d.structured_data.source_value===source.structured_data.vin);
 assert(d.structured_data.identity_resolution_status==='unverified' && d.structured_data.vin_checksum_status==='not_evaluated');
 assert(d.structured_data.vin_identifier_namespace==='standard_17_character_vin_label' && d.structured_data.source_event_time_status==='unknown');
 assert(d.observed_at===source.ingested_at && d.agent_cost_cents===0 && JSON.stringify(vehicle)===before);
 const property={id:'9fc93dd3-3639-439a-8eed-3e9a0f846334',property_key:'vin',namespace:'core',deprecated_at:null,applies_to_kinds:['specification']};
 assert(validateObservationProperty(d,property,true).ok);
 for(const [key,value] of [['vin_checksum_status','verified'],['vin_identifier_namespace','legacy_chassis'],['identity_resolution_status','verified']]){
  assert(!validateObservationProperty({...d,structured_data:{...d.structured_data,[key]:value}},property,true).ok);
 }
 assert(!deriveRetainedInterior({...source,extraction_method:'html_description_capture'},vehicle,registry,'retained_listing_vin_v1'));
 assert(!deriveRetainedInterior(source,{...vehicle,is_public:false},registry,'retained_listing_vin_v1'));
});
