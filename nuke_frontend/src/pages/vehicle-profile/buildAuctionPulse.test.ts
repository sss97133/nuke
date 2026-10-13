import { afterEach, describe, expect, it, vi } from 'vitest';
import { auctionReaderRevision, buildAuctionPulseFromExternalListings, buildAuctionPulseFromReadResult, isAuctionPresentation } from './buildAuctionPulse';

const listing = {
  id: 'event-1', source_platform: 'bat', source_url: 'https://bringatrailer.com/listing/synthetic-soft-close',
  event_status: 'active', ended_at: '2026-10-04T17:36:00Z', current_price: 118888,
  bid_count: 10, final_price: null, sold_at: null, updated_at: '2026-10-04T16:45:00Z',
};
afterEach(() => vi.useRealTimers());

describe('classified and auction price meaning', () => {
  it.each(['craigslist', 'facebook_marketplace', 'ksl'])('does not turn %s active asking amounts into bids, even with a legacy auction type', platform => {
    const row = { ...listing, source_platform: platform, event_type: 'auction', current_price: 12500, bid_count: 0 };
    expect(buildAuctionPulseFromExternalListings([row], 'synthetic-vehicle')).toBeNull();
    expect(row.current_price).toBe(12500);
  });
  it('refuses an explicit nonauction event on an auction venue and preserves the genuine BaT row in a mixed history', () => {
    expect(buildAuctionPulseFromExternalListings([{ ...listing, event_type: 'listing' }], 'synthetic-vehicle')).toBeNull();
    const pulse = buildAuctionPulseFromExternalListings([{ ...listing, source_platform: 'craigslist', current_price: 99999 }, listing], 'synthetic-vehicle');
    expect(pulse).toMatchObject({ platform: 'bat', current_bid: listing.current_price });
  });
  it('requires an actual auction presentation path on mixed venues', () => {
    expect(isAuctionPresentation({ platform: 'hagerty', listing_url: 'https://www.hagerty.com/marketplace/auction/fixture/fixture-id' })).toBe(true);
    expect(isAuctionPresentation({ platform: 'hagerty', event_type: 'auction', listing_url: 'https://www.hagerty.com/marketplace/classified/fixture/fixture-id' })).toBe(false);
    expect(isAuctionPresentation({ platform: 'hemmings', listing_url: 'https://www.hemmings.com/auction/fixture' })).toBe(true);
    expect(isAuctionPresentation({ platform: 'hemmings', listing_url: 'https://www.hemmings.com/classifieds/fixture' })).toBe(false);
    expect(isAuctionPresentation({ platform: 'ebay_motors', event_type: 'auction', listing_url: 'https://www.ebay.com/itm/700000000000' })).toBe(false);
  });
  it('refreshes the existing reader when source/type qualification changes', () => {
    expect(auctionReaderRevision({ ...listing, event_type: 'listing' })).not.toBe(auctionReaderRevision({ ...listing, event_type: 'auction' }));
  });
  it('clears an active auction after a successful nonauction refresh, while a read failure preserves prior knowledge', () => {
    let pulse = buildAuctionPulseFromReadResult({ data: [{ ...listing, event_type: 'auction' }], error: null }, 'synthetic-vehicle');
    const prior = pulse;
    expect(prior).toMatchObject({ platform: 'bat', listing_status: 'active', current_bid: listing.current_price });
    const failure = new Error('read unavailable');
    expect(() => { pulse = buildAuctionPulseFromReadResult({ data: null, error: failure }, 'synthetic-vehicle'); }).toThrow(failure);
    expect(pulse).toBe(prior);
    pulse = buildAuctionPulseFromReadResult({ data: [{ ...listing, event_type: 'listing' }], error: null }, 'synthetic-vehicle');
    expect(pulse).toBeNull();
    expect(buildAuctionPulseFromReadResult({ data: [], error: null }, 'synthetic-vehicle')).toBeNull();
  });
});

describe('canonical auction telemetry across a soft close', () => {
  it('refreshes evidence readers for native bids, comments, extensions and results, without heartbeat refetches', () => {
    const initial = { ...listing, metadata: { live_stream: { last_comment_id: 10 } } };
    const revision = auctionReaderRevision(initial);
    expect(auctionReaderRevision({ ...initial, updated_at: '2026-10-04T17:36:01Z',
      metadata: { live_stream: { last_comment_id: 10, sessions: { collector: { at: 'now' } }, last_admitted_at: 'now' } } })).toBe(revision);
    for (const change of [ { current_price: 122000 }, { ended_at: '2026-10-04T17:39:00Z' },
      { metadata: { live_stream: { last_comment_id: 11 } } },
      { event_status: 'sold', final_price: 123000, sold_at: '2026-10-04T17:39:28Z' } ]) {
      expect(auctionReaderRevision({ ...initial, ...change })).not.toBe(revision);
    }
  });
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
  it('uses native event clocks from a streamed database payload without waiting for a refresh', () => {
    const pulse = buildAuctionPulseFromExternalListings([{ ...listing, current_price: 122000,
      ended_at: '2026-10-04T17:40:00Z', updated_at: '2026-10-04T17:38:01Z',
      metadata: { live_stream: { last_bid_at: '2026-10-04T17:38:00Z', last_comment_at: '2026-10-04T17:38:00Z' } } }], 'vehicle-1');
    expect(pulse).toMatchObject({ current_bid: 122000, end_date: '2026-10-04T17:40:00Z',
      last_bid_at: '2026-10-04T17:38:00Z', last_comment_at: '2026-10-04T17:38:00Z' });
  });
});
