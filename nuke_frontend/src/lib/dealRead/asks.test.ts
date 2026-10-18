import { describe, it, expect } from 'vitest';
import { buildAsks, listingItemId, type AskVehicleRow, type ListingObservationRow } from './asks';

const row = (over: Partial<AskVehicleRow> & { id: string }): AskVehicleRow => ({
  year: 1975, make: 'Porsche', model: '914', trim: null, asking_price: 11000, price: 11000, sale_price: null, sale_status: 'available',
  listing_url: `https://www.facebook.com/marketplace/item/${over.id}/`, listing_source: 'facebook_marketplace', source: null,
  location: 'Las Vegas, NV', city: null, state: null, mileage: null, transmission: null, engine_type: '1.8L flat-four', engine_size: null,
  color: null, created_at: '2026-09-27T14:50:00Z', ...over,
});

describe('buildAsks', () => {
  it('keeps asks, drops anything that carries a sale, sorts by price, reads the latest listing observation', () => {
    const rows = [
      row({ id: '1071480528946284' }),
      row({ id: '1071645065290000', year: 1973, asking_price: 4500, engine_type: '2.0L flat-four' }),
      row({ id: 'sold-one', asking_price: 6800, sale_price: 6800, sale_status: 'for_sale' }),
      row({ id: 'no-ask', asking_price: null }),
    ];
    const obs: ListingObservationRow[] = [
      { id: 'o-old', vehicle_id: '1071645065290000', observed_at: '2026-09-01T00:00:00Z', source_url: null, structured_data: { asking_price_previous: 9000 } },
      { id: 'o-new', vehicle_id: '1071645065290000', observed_at: '2026-09-27T17:30:00Z', source_url: null, structured_data: { asking_price_previous: 5500, firm: true, road_ready: false, runs: 'on a bottle of gas', rust: 'rust-free (seller claim)' } },
      { id: 'o-3', vehicle_id: '1071480528946284', observed_at: '2026-09-27T17:30:00Z', source_url: null, structured_data: { listed_for_approx_days: 21, same_seller_as_item: '3213551119035357' } },
    ];
    const asks = buildAsks(rows, obs);
    expect(asks.map(a => a.vehicleId)).toEqual(['1071645065290000', '1071480528946284']);
    expect(asks[0]).toMatchObject({ price: 4500, previousPrice: 5500, firm: true, roadReady: false, engine: 'four_2_0', observationId: 'o-new' });
    expect(asks[1]).toMatchObject({ price: 11000, listedDays: 21, sameSellerAsItem: '3213551119035357', engine: 'four_1_7_1_8', roadReady: null });
  });
  it('reads the marketplace item id off a listing URL', () => {
    expect(listingItemId('https://www.facebook.com/marketplace/item/3213551119035357/')).toBe('3213551119035357');
    expect(listingItemId('https://lasvegas.craigslist.org/cto/d/x/7812345678.html')).toBe('7812345678');
    expect(listingItemId(null)).toBeNull();
  });
});
