import { expect, it } from 'vitest';
import { applyGarageOwnerCorrections, unresolvedGarageSources, type GarageOwnerCorrection } from './garageOwnerCorrections';
import type { GarageVehicle } from './useVehiclesDashboard';

const old = { id: 'car', relationship_type: 'VERIFIED OWNER', relationship_source: 'verification',
  primary_image_url: 'old-photo', resolved_image_url: 'old-photo',
  ownership_start_date: '2020-01-01', ownership_end_date: null } as GarageVehicle;
function statement(roles: string[], extra = {}): GarageOwnerCorrection {
  return { id: 'statement', vehicle_id: 'car', observed_at: '2026-10-07T00:00:00Z', cover_image_url: null,
    correction: { relationship: { roles, ownership_denied: false, title_status: 'unknown',
      disputed: false, start_date: null, end_date: null, ...extra } } };
}
it('retains unresolved source testimony separately without minting a vehicle or changing asset measures', () => {
  const source: GarageOwnerCorrection = { id: 'raw', vehicle_id: null, observed_at: '2026-10-08', cover_image_url: null,
    source_excerpt: 'Synthetic shared interest; physical identity unknown.',
    correction: { unresolved_vehicle: { label: 'Synthetic vehicle', stated_roles: ['shared_interest'] } } };
  expect(applyGarageOwnerCorrections([], [source])).toEqual([]);
  expect(applyGarageOwnerCorrections([old], [source])).toEqual([old]);
  expect(unresolvedGarageSources([source, statement(['owner_past'])])).toEqual([{
    id: 'raw', label: 'Synthetic vehicle', stated_roles: ['shared_interest'],
    source_excerpt: source.source_excerpt, observed_at: '2026-10-08',
  }]);
  expect(unresolvedGarageSources([{ ...source, vehicle_id: 'approximate-match' }])).toEqual([]);
});
it('uses account corrections over a stale proof without inventing transfer or tenure dates', () => {
  const [car] = applyGarageOwnerCorrections([old], [statement(['owner_past'])]);
  expect(car.relationship_type).toBe('PREVIOUSLY OWNED');
  expect(car.ownership_start_date).toBeNull(); expect(car.ownership_end_date).toBeNull();
  expect(car.relationship_source).toBe('owner_statement');
});
it('keeps consignment, business handling and sales representation out of personal ownership', () => {
  for (const [role, group] of [['consignment','CONSIGNED'],['business_handling','BUSINESS HANDLING'],
    ['sales_representative','SALES REPRESENTATIVE']]) {
    const [car] = applyGarageOwnerCorrections([old], [statement([role], { ownership_denied: true })]);
    expect(car.relationship_type).toBe(group);
    expect(car.relationship_detail).toContain('PERSONAL OWNERSHIP REJECTED');
  }
});
it('keeps disputed interest and pending transfers distinct from registered ownership', () => {
  const [interest] = applyGarageOwnerCorrections([old], [statement(['claimed_interest'],
    { title_status: 'not_in_name', disputed: true })]);
  expect(interest.relationship_type).toBe('CLAIMED INTEREST');
  expect(interest.relationship_detail).toContain('DISPUTED');
  expect(interest.relationship_detail).toContain('TITLE NOT IN');
  const [pending] = applyGarageOwnerCorrections([old], [statement(['transfer_pending'], { title_status: 'transfer_pending' })]);
  expect(pending.relationship_type).toBe('TRANSFER PENDING');
  expect(pending.ownership_start_date).toBeNull();
});
it('retains a denial without inventing another role, and preserves simultaneous roles', () => {
  expect(applyGarageOwnerCorrections([old], [statement([], { ownership_denied: true })])[0].relationship_type)
    .toBe('RELATIONSHIP REVIEW');
  const [car] = applyGarageOwnerCorrections([old], [statement(['consignment','sales_representative'])]);
  expect(car.relationship_roles).toEqual(['CONSIGNED','SALES REPRESENTATIVE']);
});
it('shows conflicting live statements as review independently of receipt order', () => {
  const a = statement(['owner_current']); const b = { ...statement(['owner_past']), id: 'other' };
  for (const rows of [[a,b],[b,a]]) {
    expect(applyGarageOwnerCorrections([old], rows)[0].relationship_type).toBe('RELATIONSHIP REVIEW');
  }
});
it('uses only a same-vehicle eligible account cover and preserves the global primary', () => {
  const cover: GarageOwnerCorrection = { id: 'cover', vehicle_id: 'car', correction: { cover_image_id: 'image' },
    observed_at: '2026-10-07', cover_image_url: 'chosen-photo' };
  const [car] = applyGarageOwnerCorrections([old], [cover]);
  expect(car.resolved_image_url).toBe('chosen-photo'); expect(car.primary_image_url).toBe('old-photo');
  expect(applyGarageOwnerCorrections([old], [{ ...cover, vehicle_id: 'another-car' }])[0].resolved_image_url).toBe('old-photo');
  expect(applyGarageOwnerCorrections([old], [{ ...cover, cover_image_url: null }])[0].resolved_image_url).toBeNull();
  expect(applyGarageOwnerCorrections([old], [{ ...cover, cover_image_url: null }])[0].primary_image_url).toBeNull();
});
