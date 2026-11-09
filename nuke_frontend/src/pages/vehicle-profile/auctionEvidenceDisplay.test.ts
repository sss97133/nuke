import { expect, it, vi } from 'vitest';
import { currentBidEvidenceAmount, recordedAudienceCount } from './auctionEvidenceDisplay';
const url = 'https://collectingcars.com/for-sale/1980-porsche-928-2';
const fact = { price_amount: 15000, source_url: url };
const pulse = { current_bid: 15000, listing_url: `${url}/`, currency_code: 'aud' };
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
