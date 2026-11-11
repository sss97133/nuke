import { expect, it } from 'vitest';
import { comparePriceToSourceSales, type DatedSourceSale } from './batComps';
import { saleReceiptSubject } from './saleReceiptSubject';
const vehicleId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const url = (slug: string) => `https://bringatrailer.com/listing/${slug}/`;
const prior: DatedSourceSale = { vehicleId, sourceUrl: url('prior'), unitSource: url('prior'), amount: 42000,
  outcome: 'sold', eventAt: '2024-01-05', knownAt: '2024-01-06T00:00:00Z', currency: 'USD', priceBasis: 'published_bid_excluding_fees', conditionEvidence: 'unknown' };
const current = { ...prior, sourceUrl: url('current'), unitSource: url('current'), amount: 50000 };
const receipt = { sale_population_basis: 'source_qualified_episodes_of_current_public_members',
  subject: { vehicle_id: vehicleId, source_url: url('current'), source_key: 'bringatrailer.com/listing/current', exclusion_basis: 'exact_source_episode' } };
function eligible(r: typeof receipt) {
  return comparePriceToSourceSales([prior, current], { cohort: { key: 'test', label: 'Test', basis: 'test', complete: true },
    subject: { amount: null, currency: 'USD', priceBasis: 'published_bid_excluding_fees', ...saleReceiptSubject(vehicleId, r) },
    eventFrom: '2023-01-01T00:00:00Z', eventBefore: '2026-01-01T00:00:00Z', evidenceAsOf: '2026-01-01T00:00:00Z',
    computedAt: '2026-01-01T00:00:00Z', knowledgeMode: 'retrospective' }).eligible;
}
it('excludes the current source episode and retains the same physical car’s earlier sale', () => {
  expect(eligible(receipt).map(s => s.sourceUrl)).toEqual([url('prior')]);
});
it('keeps prior sale evidence when the current episode is unestablished, without permitting a price percentile', () => {
  expect(eligible({ ...receipt, subject: { ...receipt.subject, exclusion_basis: 'unestablished' } })).toHaveLength(2);
});
it('refuses a source alias or parent mismatch as an exact episode exclusion', () => {
  for (const subject of [{ ...receipt.subject, source_url: 'https://bringatrailer.com.evil.test/listing/current/' },
    { ...receipt.subject, vehicle_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }]) {
    expect(saleReceiptSubject(vehicleId, { ...receipt, subject })).toEqual({ vehicleId, exclusionBasis: 'unestablished' });
  }
});
