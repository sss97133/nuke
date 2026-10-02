import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyBinding } from '../../supabase/functions/_shared/observationProperty.ts';
const year={id:'ece619f7-c49a-44f7-999f-a41acf5d4dc3',property_key:'year',data_type:'integer',unit:null,applies_to_kinds:['specification','listing'],deprecated_at:null};
test('known catalogue model-year binds without changing the source label or body',()=>{
  const raw={property:'model_year',value:1967,unit:null,claim_role:'catalogue_claim'};
  const before=JSON.stringify(raw); assert.equal(propertyBinding('year','listing',raw,year),year.id);
  assert.equal(JSON.stringify(raw),before);
});
test('media claims stay raw unless registry-kind compatibility is reviewed',()=>{
  assert.equal(propertyBinding(undefined,'media',{property:'model_year',value:1967},null),null);
  assert.throws(()=>propertyBinding('year','media',{value:1967},year),/does not declare kind/);
});
test('427 cubic inches cannot be bound as427liters',()=>{
  const displacement={...year,id:'66b2f1f6-b714-4ac0-85b6-60ba89529c1a',property_key:'engine_displacement_l',data_type:'numeric',unit:'liters',applies_to_kinds:['specification']};
  assert.throws(()=>propertyBinding(displacement.property_key,'specification',{value:427,unit:'cubic_inch'},displacement),/unit mismatch/);
});
test('unknown/deprecated keys and wrong value types are refused, never silently dropped',()=>{
  assert.throws(()=>propertyBinding('year','listing',{value:1967},null),/Unknown/);
  assert.throws(()=>propertyBinding('year','listing',{value:1967},{...year,deprecated_at:'2026-01-01'}),/deprecated/);
  assert.throws(()=>propertyBinding('year','listing',{value:'1967'},year),/requires integer/);
});
