import { expect, it } from 'vitest';
import { filterTruckMembers, partitionTruckMembers, parseTruckMembers, truckFacet, TRUCK_AXES, type TruckMember } from './truckFacets';
const member = (id: string, model: string, drive: string | null): TruckMember => ({ id, model, drive, year: 1972, usd: 10000, family: 'C10', source: 'Mecum', sale_date: null, body: null, cab: null, series: null, trim: null, drive_observed_at: null, drive_observation_id: null });
const records = [member('a','C-10 Pickup SWB','4WD'), member('b','C10 Custom Truck LWB','RWD'), member('c','3100 Pickup',null), member('d','K10 Short Bed','RWD'), member('e','C10','conflict')];
it('consolidates naming aliases while retaining disclosed conversions and unknowns', () => {
  expect(truckFacet(records[0],'series','Chevrolet')).toBe('C10');
  expect(truckFacet(records[1],'series','Chevrolet')).toBe('C10');
  expect(truckFacet(records[0],'drive','Chevrolet')).toBe('4WD');
  expect(truckFacet(records[3],'drive','Chevrolet')).toBe('2WD');
  expect(truckFacet(records[2],'drive','Chevrolet')).toBe('Unknown drivetrain');
  expect(truckFacet(records[4],'drive','Chevrolet')).toBe('Conflicting drivetrain');
  expect(truckFacet(records[1],'trim','Chevrolet')).toBe('Custom (unspecified)');
  expect(truckFacet({...records[0],trim:'Silverado'},'trim','Chevrolet')).toBe('Silverado');
});
it.each(TRUCK_AXES)('partitions every record exactly once and preserves dollars by %s', axis => {
  const nodes = partitionTruckMembers(records,axis,'Chevrolet');
  expect(nodes.reduce((s,n)=>s+n.count,0)).toBe(5);
  expect(nodes.reduce((s,n)=>s+n.value,0)).toBe(50000);
});
it('makes drill order independent and never falls back to broader membership on empty selection', () => {
  const a = filterTruckMembers(filterTruckMembers(records,{drive:'2WD'},'Chevrolet'),{bed:'Short bed'},'Chevrolet');
  const b = filterTruckMembers(filterTruckMembers(records,{bed:'Short bed'},'Chevrolet'),{drive:'2WD'},'Chevrolet');
  expect(a.map(m=>m.id)).toEqual(['d']); expect(b).toEqual(a);
  expect(filterTruckMembers(records,{drive:'AWD'},'Chevrolet')).toEqual([]);
});
it('keeps contradictory bed designations unresolved and cab/chassis separate from wheelbase', () => {
  expect(truckFacet(member('x','C10 Short Bed Long Bed',null),'bed','Chevrolet')).toBe('Conflicting bed length');
  expect(truckFacet(member('x','C30 Cab & Chassis',null),'wheelbase','Chevrolet')).toBe('Unknown wheelbase');
});
it('rejects incomplete and duplicated memberships', () => {
  const row=['id','3100',1957,50000,'Mecum',null,'3100','4WD',null,null,null,null,null,null];
  const v={n:1,rows:[row],as_of:'2026-10-18',truncated:false};
  expect(parseTruckMembers(v)?.members[0].drive).toBe('4WD');
  expect(parseTruckMembers({...v,n:2})).toBeNull();
  expect(parseTruckMembers({...v,n:2,rows:[row,row]})).toBeNull();
});

it('shares C/K eras and withholds an overlapping transition year', () => {
  expect(truckFacet(records[0],'era','Chevrolet')).toBe(truckFacet(records[3],'era','Chevrolet'));
  expect(truckFacet({...records[2],year:1955},'era','Chevrolet')).toBe('1955 (era unresolved)');
});
