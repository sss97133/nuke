import { expect, it, vi } from 'vitest';
import { currentBidEvidenceAmount, recordedAudienceCount, readNativeListingHistory } from './auctionEvidenceDisplay';
const url = 'https://collectingcars.com/for-sale/1980-porsche-928-2';
const fact = { price_amount: 15000, source_url: url };
const pulse = { current_bid: 15000, listing_url: `${url}/`, currency_code: 'aud' };
const report = { observation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', source_url: url, source_listing_id: '1',
 source: 'collecting-cars', qualification: 'publisher_reported_unverified', reported_outcome: 'sold', reported_amount: 67500, reported_amount_kind: 'sale_price',
 currency: 'GBP', reported_event_at: '2019-06-06T15:02:00Z', source_captured_at: '2026-01-01T00:00:00Z',
 ingested_at: '2026-01-01T00:00:02Z', mileage: 283785, mileage_unit: 'mi', bid_count: 38 };
const history = (entry = report) => [{ vehicle_id: 'v', schema_version: 'vehicle_data_model_v1', native_listing_history: {
 reader: 'cc_native_profile_history_v1', capture_limit: 50, has_more_captures: false, entries: [entry],
} }];
it('accepts only the exact sanitized native history contract', () => {
 expect(readNativeListingHistory(history(), 'v').entries[0]).toEqual(report);
 expect(() => readNativeListingHistory(history(), 'another')).toThrow();
});
it.each(['cc_native_profile_history_v1', 'cc_native_profile_history_v2'])('preserves sold history during reader rollout: %s', reader => {
 const response = history();
 response[0].native_listing_history.reader = reader;
 expect(readNativeListingHistory(response, 'v').entries[0]).toEqual(report);
});
it('refuses unknown reader versions', () => {
 const response = history();
 response[0].native_listing_history.reader = 'cc_native_profile_history_v3';
 expect(() => readNativeListingHistory(response, 'v')).toThrow();
});
it('accepts ended classified history only with an unknown outcome and no price role', () => {
 const ended = { ...report, reported_outcome: 'unknown', reported_listing_stage: 'ended', sale_format: 'classified', reported_amount: null, reported_amount_kind: null };
 expect(readNativeListingHistory(history(ended as any), 'v').entries[0]).toEqual(ended);
 for (const patch of [{ reported_outcome: 'unsold' }, { reported_amount: 10995 }, { reported_amount_kind: 'high_bid' },
  { reported_event_at: null }, { sale_format: 'unknown' }, { reported_listing_stage: undefined }]) {
  expect(() => readNativeListingHistory(history({ ...ended, ...patch } as any), 'v')).toThrow();
 }
});
it.each([
 { source_url: 'https://private.invalid/secret' }, { source: 'other' }, { qualification: 'verified_sale' },
 { reported_amount: '67500' }, { reported_outcome: 'unsold', reported_amount: 67500 },
 { reported_event_at: '2999-01-01T00:00:00Z' }, { source_captured_at: 'invalid' },
 { reported_event_at: '2026-02-01T00:00:00Z' }, { currency: 'Private Seller' }, { currency: 'ZZZ' },
 { mileage_unit: 'inferred miles' }, { bid_count: -1 },
])('refuses contradictory or malformed public claim %j', patch => {
 expect(() => readNativeListingHistory(history({ ...report, ...patch } as typeof report), 'v')).toThrow();
});
it('denominates the same source episode and amount in its recorded currency', () => {
  expect(currentBidEvidenceAmount(fact, pulse)).toBe('A$15,000');
});
it.each([
  { ...pulse, listing_url: `${url}-other` },
  { ...pulse, listing_url: `${url}?lot=other` },
  { ...pulse, current_bid: 16000 },
  { ...pulse, currency_code: 'ZZZ' },
  { ...pulse, currency_code: null }, null,
])('does not borrow currency from unrelated or unknown evidence', candidate => {
  expect(currentBidEvidenceAmount(fact, candidate)).toBe('15,000 (currency unrecorded)');
});
it('does not turn legacy default zero into measured audience', () => {
  expect(recordedAudienceCount(0, undefined)).toBeNull();
  expect(recordedAudienceCount(null, undefined)).toBeNull();
  expect(recordedAudienceCount(0, 0)).toBe(0);
  expect(recordedAudienceCount(7, undefined)).toBe(7);
});
it('keeps explicitly recorded supported currency when the optional Intl listing API is absent', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'supportedValuesOf');
  try {
    Object.defineProperty(Intl, 'supportedValuesOf', { configurable: true, value: undefined });
    vi.resetModules();
    const fallback = await import('./auctionEvidenceDisplay');
    expect(fallback.currentBidEvidenceAmount(fact, pulse)).toBe('A$15,000');
    expect(fallback.currentBidEvidenceAmount(fact, { ...pulse, currency_code: 'ZZZ' })).toContain('currency unrecorded');
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'supportedValuesOf', descriptor);
  }
});
