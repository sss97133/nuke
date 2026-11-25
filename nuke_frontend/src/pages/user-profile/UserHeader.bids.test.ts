import { describe, expect, it } from 'vitest';
import { bidOrderBookHref } from './UserHeader';

const bid = (vehicle: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  id: 'b1', vehicle_id: 'v1', auction_event_id: 'e1', bid_amount: 1, auction: { vehicle }, ...extra,
});

describe('bidOrderBookHref', () => {
  it('links a bid on a readable, live car to its lot in the order book', () => {
    expect(bidOrderBookHref(bid({ id: 'v1', deleted_at: null, merged_into_vehicle_id: null })))
      .toBe('/stacks/order-book/v1?lot=e1&at=b1');
  });
  it('leaves a bid unlinked when the car is deleted (its order book opens empty)', () => {
    expect(bidOrderBookHref(bid({ id: 'v1', deleted_at: '2026-11-01T00:00:00Z', merged_into_vehicle_id: null }))).toBeNull();
  });
  it('leaves a bid unlinked when the car is a merged stub', () => {
    expect(bidOrderBookHref(bid({ id: 'v1', deleted_at: '2026-11-01T00:00:00Z', merged_into_vehicle_id: 'v2' }))).toBeNull();
  });
  it('leaves a bid unlinked when the car is not readable to this viewer (the embed is empty)', () => {
    expect(bidOrderBookHref(bid(null))).toBeNull();
  });
  it('leaves a bid unlinked without a lot key', () => {
    expect(bidOrderBookHref(bid({ id: 'v1' }, { auction_event_id: null }))).toBeNull();
    expect(bidOrderBookHref(bid({ id: 'v1' }, { vehicle_id: null }))).toBeNull();
  });
});
