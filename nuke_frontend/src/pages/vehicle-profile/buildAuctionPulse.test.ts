import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuctionPulseFromExternalListings } from './buildAuctionPulse';

const listing = {
  id: 'event-1', source_platform: 'bat', source_url: 'https://bringatrailer.com/listing/synthetic-soft-close',
  event_status: 'active', ended_at: '2026-10-04T17:36:00Z', current_price: 118888,
  bid_count: 10, final_price: null, sold_at: null, updated_at: '2026-10-04T16:45:00Z',
};
afterEach(() => vi.useRealTimers());

describe('canonical auction telemetry across a soft close', () => {
  it('reads vehicle_events on initial load and keeps an elapsed active deadline unconfirmed', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T17:38:00Z'));
    const pulse = buildAuctionPulseFromExternalListings([listing], 'vehicle-1');
    expect(pulse).toMatchObject({ platform: 'bat', listing_status: 'active', current_bid: 118888, bid_count: 10, end_date: listing.ended_at });
    expect(pulse.external_listing_id).toBeFalsy(); // Canonical event IDs cannot trigger the legacy writer.
  });

  it('uses the extended deadline instead of a stale duplicate countdown', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T17:35:00Z'));
    const pulse = buildAuctionPulseFromExternalListings([listing, { ...listing, ended_at: '2026-10-04T17:39:00Z', current_price: 122000 }], 'vehicle-1');
    expect(pulse.end_date).toBe('2026-10-04T17:39:00Z');
    expect(pulse.current_bid).toBe(122000);
  });

  it('keeps a source-confirmed sold result through the same reader', () => {
    const pulse = buildAuctionPulseFromExternalListings([{ ...listing, event_status: 'sold', final_price: 123000, sold_at: '2026-10-04T17:39:00Z' }], 'vehicle-1');
    expect(pulse).toMatchObject({ listing_status: 'sold', final_price: 123000, sold_at: '2026-10-04T17:39:00Z' });
  });

  it('continues to read the legacy listing shape', () => {
    const pulse = buildAuctionPulseFromExternalListings([{ id: 'legacy', platform: 'bat', listing_url: listing.source_url, listing_status: 'active', current_bid: 1000 }], 'vehicle-1');
    expect(pulse).toMatchObject({ external_listing_id: 'legacy', current_bid: 1000 });
  });
});
