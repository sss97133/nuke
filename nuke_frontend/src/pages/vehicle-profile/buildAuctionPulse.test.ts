import { afterEach, describe, expect, it, vi } from 'vitest';
import { auctionSourceUrlVariants, buildAuctionPulseForVehicle, auctionReaderRevision, buildAuctionPulseFromExternalListings, buildAuctionPulseFromReadResult, isAuctionPresentation } from './buildAuctionPulse';

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

 it('preserves the CC episode currency, native clock and current quote despite stale high_bid', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T01:10:00Z'));
  const row = { ...listing, source_platform: 'collecting_cars', event_type: 'auction',
    source_url: 'https://collectingcars.com/for-sale/1980-porsche-928-2',
    current_price: 15000, high_bid: 999999, currency_code: 'AUD', bid_count: 31,
    ended_at: '2026-11-12T06:05:00Z', metadata: { currency: 'USD', source_observed_at: '2026-11-09T01:06:03.523Z' } };
  expect(buildAuctionPulseFromExternalListings([row], 'cc-vehicle')).toMatchObject({
    current_bid: 15000, currency_code: 'AUD', bid_count: 31, end_date: row.ended_at,
    source_observed_at: row.metadata.source_observed_at,
  });
});


it('qualifies only explicit PurpleWave auction item episodes', () => {
  const row = { ...listing, source_platform: 'purplewave', event_type: 'auction',
    source_url: 'https://www.purplewave.com/auction/261111A/item/FN3842' };
  expect(isAuctionPresentation(row)).toBe(true);
  for (const source_url of ['https://purplewave.com/', 'https://purplewave.com/auction/261111A',
    'https://purplewave.example/auction/261111A/item/FN3842',
    'https://user@purplewave.com/auction/261111A/item/FN3842',
    'https://purplewave.com:444/auction/261111A/item/FN3842']) {
    expect(isAuctionPresentation({ ...row, source_url })).toBe(false);
  }
  expect(isAuctionPresentation({ ...row, event_type: 'listing' })).toBe(false);
  expect(isAuctionPresentation({ ...row, event_type: undefined })).toBe(false);
});


describe('historical sale versus current canonical episode', () => {
  const oldUrl = 'https://bringatrailer.com/listing/1994-mazda-rx-7-us-can-22';
  const liveUrl = 'https://bringatrailer.com/listing/1994-mazda-rx-7-r2-2';
  const vehicle = { id: 'rx7', sale_status: 'sold', sale_price: 40750, listing_url: oldUrl };
  const old = { ...listing, event_type: 'auction', source_url: oldUrl, event_status: 'sold', current_price: 40750, final_price: 40750, sold_at: '2024-05-20T00:00:00Z' };
  const live = { ...listing, event_type: 'auction', source_url: liveUrl, current_price: 57500, currency_code: 'USD', bid_count: 12, ended_at: '2026-11-10T23:05:00Z' };
  const setup = () => vi.setSystemTime(new Date('2026-11-09T04:10:00Z'));
  it('selects the distinct current episode without changing the historical sale', () => {
    setup(); expect(buildAuctionPulseForVehicle([live, old], vehicle)).toMatchObject({ listing_url: liveUrl, current_bid: 57500, bid_count: 12, currency_code: 'USD', listing_status: 'active' });
    expect(old.final_price).toBe(40750); expect(vehicle.sale_price).toBe(40750);
  });
  it.each([
    { ended_at: '2026-11-08T00:00:00Z' }, { ended_at: null }, { ended_at: 'invalid' }, { ended_at: '2037-01-01T00:00:00Z' },
    { source_url: oldUrl + '/' }, { source_url: 'invalid' }, { source_url: liveUrl + '?other=lot' },
    { event_type: 'listing' }, { source_platform: 'craigslist' }, { duplicate_of_event_id: 'retained-canonical' },
    { sold_at: '2026-11-08T00:00:00Z' },
  ])('does not revive stale, unqualified or same-sale active evidence: %j', patch => {
    setup(); expect(buildAuctionPulseForVehicle([{ ...live, ...patch }, old], vehicle)?.listing_status).toBe('sold');
  });
  it.each(['sold', 'ended', 'expired', 'unsold'])('keeps a same-lot %s outcome over an active duplicate including a slash variant', status => {
    setup(); expect(buildAuctionPulseForVehicle([live, { ...old, source_url: liveUrl + '/', event_status: status }], vehicle)?.listing_status).not.toBe('active');
  });
  it('permits a current BaT episode after another venue historical sale', () => {
    setup(); expect(buildAuctionPulseForVehicle([live, old], { ...vehicle, listing_url: 'https://carsandbids.com/auctions/old-sale' })?.listing_url).toBe(liveUrl);
  });
});

describe('exact source URL slash variants', () => {
  it.each(['https://bringatrailer.com/listing/current', 'https://bringatrailer.com/listing/current/'])('matches only the two path spellings of %s', value => {
    expect(auctionSourceUrlVariants(value)).toEqual(['https://bringatrailer.com/listing/current', 'https://bringatrailer.com/listing/current/']);
  });
  it.each(['https://bringatrailer.com/listing/current?episode=other', 'https://bringatrailer.com/listing/current#other', 'https://bringatrailer.com/listing/current//'])('does not strip source-significant URL text: %s', value => expect(auctionSourceUrlVariants(value)).toEqual([value]));
  it.each(['invalid', '', 'javascript:alert(1)', 'https://user:pass@bringatrailer.com/listing/current'])('refuses invalid credentials/protocol: %s', value => expect(auctionSourceUrlVariants(value)).toEqual([]));
});
