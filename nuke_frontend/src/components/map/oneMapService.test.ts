import { describe, expect, it } from 'vitest';
import { foldByZip, type LocationRow } from './oneMapService';

const row = (id: string, vehicle: string, postal_code: string | null, zcta: string | null): LocationRow => ({
  id, observed_at: '2026-11-01T00:00:00Z', source_type: postal_code ? 'listing' : 'exif', source_platform: null, source_url: null,
  postal_code, zcta, county_fips: '32003', city: null, precision: 'city', confidence: 0.7,
  vehicles: { id: vehicle, year: 1970, make: 'Ford', model: 'Bronco', trim: null, primary_image_url: null, city: null, state: null,
    status: null, deleted_at: null, asking_price: null, sale_price: null, sold_price: null, sale_status: null, auction_outcome: null },
});

describe('foldByZip', () => {
  it('folds a photo-GPS row (no postal code) by its zcta', () => {
    const out = foldByZip([row('a', 'v1', '89005-1234', '89005'), row('b', 'v2', null, '89012'), row('c', 'v3', null, null)], {});
    expect([...out.groups.keys()].sort()).toEqual(['89005', '89012']);
    expect(out.noZip).toBe(1);
    expect(out.vehicles).toBe(3);
  });
  it('keeps the postal code first when both are present', () => {
    const out = foldByZip([row('a', 'v1', '89005', '89012')], {});
    expect([...out.groups.keys()]).toEqual(['89005']);
  });
});
