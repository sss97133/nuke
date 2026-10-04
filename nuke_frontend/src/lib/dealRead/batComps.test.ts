import { describe, it, expect } from 'vitest';
import { parseBaTHTML } from '../../../../supabase/functions/_shared/batParser';
import saleParserFixtures from '../../../../scripts/discovery/bat-sale-parser-fixtures.json';
import {
  batSlug, yearFromSlug, classifyEngine, textFeatures, buildCompSet, quantile, median,
  summarize, shareBelow, windowComps, MIN_READABLE_DESCRIPTION,
  comparePriceToSourceSales, type DatedSourceSale, type SaleComparisonOptions,
  selectSourceSalePopulation, type SourceSaleCapture, type SalePopulationOptions, type SaleRelevanceClaim,
  type VehicleCompRow, type BatListingRow,
} from './batComps';

const NOW = new Date('2026-09-27T12:00:00Z');

describe('valuation raw-source grammar parity with the existing BaT parser', () => {
  for (const fixture of saleParserFixtures) it(fixture.name, () => {
    const parsed = parseBaTHTML(fixture.html);
    expect({ currency: parsed.sale_currency, price: parsed.sale_price, date: parsed.sale_date, status: parsed.sale_status }).toEqual(fixture.canonical);
  });
});

function sourceSale(n: number, over: Partial<DatedSourceSale> = {}): DatedSourceSale {
  const sourceUrl = `https://bringatrailer.com/listing/synthetic-cohort-${n}/`;
  return { vehicleId: `synthetic-${n}`, sourceUrl, amount: n * 1000, outcome: 'sold',
    eventAt: '2025-06-15', knownAt: '2025-06-16T12:00:00Z', currency: 'USD',
    priceBasis: 'published_bid_excluding_fees', unitSource: sourceUrl, conditionEvidence: 'unknown', ...over };
}
const saleOptions = (over: Partial<SaleComparisonOptions> = {}): SaleComparisonOptions => ({
  cohort: { key: 'synthetic-cohort', label: 'Synthetic same-year model', basis: 'recorded_model_context', complete: true },
  subject: { amount: 5000, currency: 'USD', priceBasis: 'published_bid_excluding_fees' },
  eventFrom: '2024-01-01T00:00:00Z', eventBefore: '2026-01-01T00:00:00Z',
  evidenceAsOf: '2026-01-02T00:00:00Z', computedAt: '2026-01-03T00:00:00Z',
  knowledgeMode: 'retrospective', ...over,
});

describe('dated source sale percentile contract', () => {
  const ten = () => Array.from({ length: 10 }, (_, i) => sourceSale(i + 1));

  it('uses every eligible lot, gives ties half weight and leaves condition-adjusted value unmeasured', () => {
    const result = comparePriceToSourceSales(ten(), saleOptions());
    expect(result.percentile).toBe(45);
    expect(result.distribution).toMatchObject({ p10: 1900,p50: 5500,p90: 9100 });
    expect(result.counts).toMatchObject({ eligibleSales: 10, below: 4, equal: 1, above: 5, conditionUnknown: 10 });
    expect(result.conditionAdjustedAssessment).toBe('unmeasured');
    expect(result.priceAdjustment).toBe('nominal_original_currency_no_fees_fx_or_inflation');
  });

  it('deduplicates source URL aliases deterministically and excludes the subject across vehicle aliases', () => {
    const rows = [...ten(), sourceSale(1, { vehicleId: 'alias', sourceUrl: 'http://www.bringatrailer.com/listing/SYNTHETIC-COHORT-1?ref=alias#bid' })];
    const options = saleOptions({ subject: { ...saleOptions().subject, sourceUrl: 'https://bringatrailer.com/listing/synthetic-cohort-10' }, minimumSales: 2 });
    const first = comparePriceToSourceSales(rows, options);
    expect(first.counts.eligibleSales).toBe(9);
    expect(first.excluded).toContainEqual(expect.objectContaining({ reason: 'subject' }));
    expect(comparePriceToSourceSales([...rows].reverse(), options)).toEqual(first);
  });

  it('withholds a conflicted source lot rather than choosing a duplicate price by row order', () => {
    const result = comparePriceToSourceSales([...ten(), sourceSale(1, { amount: 8000 })], saleOptions());
    expect(result.counts.eligibleSales).toBe(9);
    expect(result.excluded).toContainEqual(expect.objectContaining({ reason: 'duplicate_conflict' }));
    expect(result.percentile).toBeNull();
  });

  it('excludes bids, unknown outcomes, junk amounts and invalid source dates', () => {
    const rows = [sourceSale(1, { outcome: 'not_sold' }), sourceSale(2, { outcome: 'unknown' }),
      sourceSale(3, { amount: Infinity }), sourceSale(4, { eventAt: '2025-02-30' }),
      sourceSale(5, { eventAt: '2025-02-30T12:00:00Z' }), sourceSale(6, { eventAt: '2025-06-15T12:00:00' })];
    const result = comparePriceToSourceSales(rows, saleOptions());
    expect(result.counts.eligibleSales).toBe(0);
    expect(result.excluded.map(e => e.reason)).toEqual(['not_sold','not_sold','price_unknown','event_unknown','event_unknown','event_unknown']);
    expect(result.distribution).toBeNull();
  });

  it('does not assume a BaT currency or combine buyer totals with published bids', () => {
    const rows = [sourceSale(1, { currency: null }), sourceSale(2, { currency: 'EUR' }),
      sourceSale(3, { priceBasis: 'buyer_total' }), sourceSale(4, { unitSource: null })];
    const result = comparePriceToSourceSales(rows, saleOptions());
    expect(result.counts.eligibleSales).toBe(0);
    expect(result.excluded.map(e => e.reason)).toEqual(['unknown_units','different_units','different_units','unknown_units']);
    expect(comparePriceToSourceSales(ten().map(r => ({ ...r, currency: 'EUR' })), saleOptions({ subject: { ...saleOptions().subject, currency: 'EUR' } })).percentile).toBe(45);
  });

  it('requires per-lot unit attribution, without borrowing an early clock from an unknown-unit alias', () => {
    const row = sourceSale(1, { knownAt: '2026-01-02T00:00:00Z' });
    const earlyUnknown = sourceSale(1, { currency: null, knownAt: '2025-06-16T00:00:00Z' });
    const result = comparePriceToSourceSales([row, earlyUnknown], saleOptions({ evidenceAsOf: '2026-01-01T00:00:00Z' }));
    expect(result.excluded[0].reason).toBe('learned_later');
    expect(comparePriceToSourceSales([sourceSale(1, { unitSource: 'https://bringatrailer.com/listing/another-lot/' })], saleOptions()).excluded[0].reason).toBe('unknown_units');
  });

  it('keeps source-event cutoff separate from knowledge cutoff and refuses future knowledge', () => {
    const row = sourceSale(1, { knownAt: '2026-01-02T00:00:00Z' });
    expect(comparePriceToSourceSales([row], saleOptions()).counts.eligibleSales).toBe(1);
    const historical = saleOptions({ knowledgeMode: 'known_at', evidenceAsOf: '2026-01-01T00:00:00Z' });
    expect(comparePriceToSourceSales([row], historical).excluded[0].reason).toBe('learned_later');
    expect(comparePriceToSourceSales(ten(), saleOptions({ knowledgeMode: 'known_at' })).reasons).toContain('knowledge_after_comparison');
    expect(comparePriceToSourceSales(ten(), saleOptions({ evidenceAsOf: '2026-01-04T00:00:00Z' })).reasons).toContain('invalid_cutoffs');
    const laterAlias = sourceSale(1, { amount: 9000, knownAt: '2026-01-02T12:00:00Z' });
    expect(comparePriceToSourceSales([...ten(), laterAlias], historical).percentile).toBe(45);
  });

  it('excludes unknown and impossible source knowledge clocks even in a retrospective receipt', () => {
    expect(comparePriceToSourceSales([sourceSale(1, { knownAt: null })], saleOptions()).excluded[0].reason).toBe('knowledge_unknown');
    expect(comparePriceToSourceSales([sourceSale(1, { knownAt: '2025-06-14T23:59:59Z' })], saleOptions()).excluded[0].reason).toBe('knowledge_conflicting');
  });

  it('requires a date-grain sale to fit wholly before the comparison, without inventing intraday order', () => {
    const options = saleOptions({ eventBefore: '2025-06-15T18:00:00Z', evidenceAsOf: '2025-06-17T00:00:00Z' });
    expect(comparePriceToSourceSales([sourceSale(1)], options).excluded[0].reason).toBe('outside_event_window');
    expect(comparePriceToSourceSales([sourceSale(1, { eventAt: '2025-06-15T17:00:00Z' })], options).counts.eligibleSales).toBe(1);
  });

  it('refuses incomplete cohorts, small denominators and unknown candidate units', () => {
    expect(comparePriceToSourceSales(ten(), saleOptions({ cohort: { ...saleOptions().cohort, complete: false } })).percentile).toBeNull();
    const small = comparePriceToSourceSales(ten().slice(0, 9), saleOptions());
    expect(small.reasons).toContain('insufficient_sales'); expect(small.distribution).toBeNull();
    expect(comparePriceToSourceSales(ten(), saleOptions({ subject: { ...saleOptions().subject, amount: null } })).reasons).toContain('subject_price_or_units_unknown');
  });

  it('creates a new evidence receipt without mutating the prior calculation or historic condition', () => {
    const rows = ten(), original = structuredClone(rows), options = saleOptions();
    const prior = comparePriceToSourceSales(rows, options), frozen = structuredClone(prior);
    const next = comparePriceToSourceSales([...rows, sourceSale(11)], { ...options, evidenceAsOf: '2026-01-03T00:00:00Z' });
    expect(rows).toEqual(original); expect(prior).toEqual(frozen);
    expect(next.counts.eligibleSales).toBe(11); expect(prior.counts.eligibleSales).toBe(10);
    expect(next.conditionAdjustedAssessment).toBe('unmeasured');
  });
});

function relevanceClaim(key: string, over: Partial<SaleRelevanceClaim> = {}): SaleRelevanceClaim {
  return { dimension: 'model', value: 'synthetic-model', sourcePlatform: 'bringatrailer', sourceEpisodeKey: key,
    knownAt: '2025-06-16T12:00:00Z', basis: 'synthetic episode-specific source fact',
    evidenceRefs: [{ table: 'listing_page_snapshots', id: `synthetic-snapshot-${key}` }], ...over };
}

function saleCapture(n: number, over: Partial<SourceSaleCapture> = {}): SourceSaleCapture {
  const key = `synthetic-cohort-${n}`;
  return { ...sourceSale(n), capture: { table: 'vehicle_observations', id: `synthetic-observation-${n}` },
    sourcePlatform: 'bringatrailer', sourceEpisodeKey: key, eventGrain: 'day', eventTimeBasis: 'explicit source sale day',
    knownAtEvidence: 'synthetic admitted observation ingestion', qualification: { status: 'qualified',
      basis: 'synthetic independently verified source-sale receipt', evidenceRefs: [{ table: 'listing_page_snapshots', id: `synthetic-snapshot-${n}` }] },
    relevance: [relevanceClaim(key)], ...over };
}

function populationOptions(over: Partial<SalePopulationOptions> = {}): SalePopulationOptions {
  return { population: { key: 'synthetic-supplied-population', label: 'Synthetic supplied sale-event pool',
      basis: 'complete synthetic input for this declared scope', complete: true },
    subject: { sourcePlatform: 'bringatrailer', sourceEpisodeKey: 'synthetic-subject', vehicleId: 'synthetic-subject-vehicle',
      currency: 'USD', priceBasis: 'published_bid_excluding_fees', relevance: [relevanceClaim('synthetic-subject')] },
    policy: { key: 'synthetic-model-match', basis: 'explicit synthetic model identity match', requiredDimensions: ['model'] },
    eventFrom: '2024-01-01T00:00:00Z', eventBefore: '2026-01-01T00:00:00Z',
    evidenceAsOf: '2026-01-02T00:00:00Z', computedAt: '2026-01-03T00:00:00Z', knowledgeMode: 'retrospective',
    minimumMatchedSales: 2, ...over };
}

describe('sale-event population and explicit relevance selection v2', () => {
  it('uses all 150 supplied events and reports unknown condition without an eighteen or hundred row trim', () => {
    const result = selectSourceSalePopulation(Array.from({ length: 150 }, (_, i) => saleCapture(i + 1)), populationOptions());
    expect(result.counts).toEqual({ inputCaptures: 150, candidateEpisodes: 150, qualifiedEpisodes: 150, conflictedEpisodes: 0, matchedEpisodes: 150 });
    expect(result.broadMarket[0].distribution?.n).toBe(150);
    expect(result.matchedDistribution).toMatchObject({ n: 150, p50: 75500 });
    expect(result.comparisons.every(c => c.dimensions.find(d => d.dimension === 'condition')?.state === 'unknown')).toBe(true);
    expect(result.conditionAdjustedAssessment).toBe('unmeasured');
    expect(result).not.toHaveProperty('fairValue'); expect(result).not.toHaveProperty('percentile');
  });

  it('preserves two sales of one vehicle, collapses repeated capture of one sale, and excludes only the subject episode', () => {
    const first = saleCapture(1, { vehicleId: 'synthetic-persistent-vehicle', amount: 10000, eventAt: '2024-06-15' });
    const second = saleCapture(2, { vehicleId: first.vehicleId, amount: 15000, eventAt: '2025-06-15' });
    const repeated = { ...first, capture: { table: 'listing_page_snapshots', id: 'synthetic-repeated-snapshot' }, knownAt: '2025-07-01T12:00:00Z' };
    const result = selectSourceSalePopulation([second, repeated, first], populationOptions({ subject: {
      ...populationOptions().subject, vehicleId: first.vehicleId, sourceEpisodeKey: second.sourceEpisodeKey,
      relevance: [relevanceClaim(second.sourceEpisodeKey!)] } }));
    expect(result.counts).toMatchObject({ inputCaptures: 3, candidateEpisodes: 2, qualifiedEpisodes: 2, matchedEpisodes: 1 });
    expect(result.matched[0].sourceEpisodeKey).toBe(first.sourceEpisodeKey);
    expect(result.matched[0].captures).toHaveLength(2);
    expect(result.comparisons.find(c => c.event.sourceEpisodeKey === second.sourceEpisodeKey)?.reasons).toContain('subject_episode');
    expect(result.repeatSales[0]).toMatchObject({ vehicleId: first.vehicleId, nominalAmountChange: 5000, nominalPercentChange: 50 });
    expect(result.repeatSaleInterpretation).toBe('observed_episode_price_change_not_market_index_return');
    expect(result.matchedDistribution).toBeNull(); expect(result.reasons).toContain('insufficient_matched_sales');
  });

  it('deduplicates actual BaT aliases with independent capture and qualification snapshot refs', () => {
    const first = saleCapture(1);
    const aliasUrl = 'http://www.bringatrailer.com/listing/SYNTHETIC-COHORT-1?utm_source=synthetic#result';
    const alias = saleCapture(1, { sourceUrl: aliasUrl, unitSource: aliasUrl,
      capture: { table: 'bat_listings', id: 'synthetic-alias-presentation' }, knownAt: '2025-06-18T12:00:00Z',
      qualification: { ...first.qualification, evidenceRefs: [{ table: 'listing_page_snapshots', id: 'synthetic-second-snapshot' }] } });
    const result = selectSourceSalePopulation([alias, first], populationOptions());
    expect(result.qualified).toHaveLength(1); expect(result.qualified[0].captures).toHaveLength(2);
    expect(result.qualified[0].knownAt).toBe(new Date(first.knownAt!).toISOString());
    expect(result.qualified[0].captures.flatMap(c => c.qualification.evidenceRefs).map(r => r.id).sort()).toEqual(['synthetic-second-snapshot', 'synthetic-snapshot-1']);
  });

  it.each([
    ['amount', { amount: 2000 }], ['outcome', { outcome: 'not_sold' as const }],
    ['event', { eventAt: '2025-06-14' }], ['currency', { currency: 'EUR' }],
    ['priceBasis', { priceBasis: 'buyer_total' as const }], ['vehicle_identity', { vehicleId: 'synthetic-other-vehicle' }],
  ])('refuses an episode with conflicting %s instead of averaging or choosing a capture', (field, changed) => {
    const first = saleCapture(1), other = saleCapture(1, { ...changed, capture: { table: 'bat_listings', id: 'synthetic-conflicting' } });
    const result = selectSourceSalePopulation([first, other], populationOptions());
    expect(result.qualified).toHaveLength(0); expect(result.conflicts[0].dimensions).toContain(field);
    expect(result.conflicts[0].captures).toHaveLength(2); expect(result.candidates[0].captures).toHaveLength(2);
  });

  it('does not let later evidence introduce a conflict into an earlier knowledge receipt', () => {
    const first = saleCapture(1), later = saleCapture(1, { amount: 2000, knownAt: '2026-01-02T12:00:00Z',
      capture: { table: 'listing_page_snapshots', id: 'synthetic-late' } });
    const prior = selectSourceSalePopulation([first, later], populationOptions()), frozen = structuredClone(prior);
    expect(prior.qualified).toHaveLength(1); expect(prior.candidates[0].excluded).toContainEqual({ capture: later.capture, reason: 'learned_later' });
    const next = selectSourceSalePopulation([later, first], populationOptions({ evidenceAsOf: '2026-01-03T00:00:00Z' }));
    expect(next.conflicts).toHaveLength(1); expect(prior).toEqual(frozen);
  });

  it('retains native sold-price candidates and refused archived captures without promoting them', () => {
    const native = saleCapture(1, { capture: { table: 'vehicle_events', id: 'synthetic-native' },
      qualification: { status: 'candidate', basis: null, evidenceRefs: [] }, currency: null, priceBasis: null, knownAt: null, knownAtEvidence: null });
    const archived = saleCapture(2, { qualification: { status: 'refused', basis: 'synthetic unadmitted archive', evidenceRefs: [] } });
    const result = selectSourceSalePopulation([native, archived], populationOptions());
    expect(result.counts.qualifiedEpisodes).toBe(0); expect(result.candidates).toHaveLength(2);
    expect(result.candidates.flatMap(c => c.excluded).map(e => e.reason)).toEqual(['candidate_unqualified', 'qualification_refused']);
    expect(result.candidates[0].captures[0]).toEqual(native);
  });

  it('requires qualification lineage, real event/knowledge provenance and same-source supported units', () => {
    const rows = [saleCapture(1, { qualification: { status: 'qualified', basis: null, evidenceRefs: [] } }),
      saleCapture(2, { eventTimeBasis: null }), saleCapture(3, { knownAtEvidence: null }),
      saleCapture(4, { knownAt: '2025-06-14T23:59:59Z' }), saleCapture(5, { unitSource: 'https://bringatrailer.com/listing/unrelated/' }),
      saleCapture(6, { knownAt: '2025-06-16' }), saleCapture(7, { eventGrain: 'instant' })];
    const result = selectSourceSalePopulation(rows, populationOptions());
    expect(result.qualified).toHaveLength(0);
    expect(result.candidates.flatMap(c => c.excluded).map(e => e.reason)).toEqual([
      'qualification_evidence_unknown', 'event_unknown', 'knowledge_unknown', 'knowledge_conflicting', 'unknown_units', 'knowledge_unknown', 'event_grain_conflict',
    ]);
  });

  it('keeps broad market strata separate from relevant comparisons and never mixes currency or fees', () => {
    const unrelated = saleCapture(4, { relevance: [relevanceClaim('synthetic-cohort-4', { value: 'synthetic-other-model' })] });
    const rows = [saleCapture(1), saleCapture(2, { currency: 'EUR' }), saleCapture(3, { priceBasis: 'buyer_total' }), unrelated];
    const result = selectSourceSalePopulation(rows, populationOptions());
    expect(result.broadMarket).toHaveLength(3);
    expect(result.broadMarket.find(s => s.currency === 'USD' && s.priceBasis === 'published_bid_excluding_fees')?.events).toHaveLength(2);
    expect(result.matched.map(r => r.sourceEpisodeKey)).toEqual(['synthetic-cohort-1']);
    expect(result.comparisons.filter(c => c.reasons.includes('different_units'))).toHaveLength(2);
    expect(result.comparisons.find(c => c.event.sourceEpisodeKey === unrelated.sourceEpisodeKey)?.reasons).toContain('model:mismatch');
    expect(result.matchedDistribution).toBeNull();
  });

  it('reports episode-bound relevance lineage, unavailable future facts and unknown condition instead of making them match', () => {
    const wrongEpisode = relevanceClaim('synthetic-other-episode');
    const late = relevanceClaim('synthetic-cohort-2', { knownAt: '2026-01-02T12:00:00Z' });
    const rows = [saleCapture(1, { relevance: [wrongEpisode] }), saleCapture(2, { relevance: [late] }), saleCapture(3)];
    const result = selectSourceSalePopulation(rows, populationOptions());
    expect(result.qualified).toHaveLength(3); expect(result.matched).toHaveLength(1);
    const dimensions = result.comparisons.map(c => c.dimensions.find(d => d.dimension === 'model')!);
    expect(dimensions[0].candidate.unavailable[0]).toEqual({ claim: wrongEpisode, reason: 'episode_unbound' });
    expect(dimensions[1].candidate.unavailable[0]).toEqual({ claim: late, reason: 'learned_later' });
    expect(dimensions[2].candidate.available[0].evidenceRefs).toHaveLength(1);
    const requiresCondition = selectSourceSalePopulation(rows, populationOptions({ policy: {
      ...populationOptions().policy, requiredDimensions: ['model', 'condition'] } }));
    expect(requiresCondition.matched).toHaveLength(0);
    expect(requiresCondition.comparisons.every(c => c.reasons.includes('condition:unknown'))).toBe(true);
  });

  it('refuses conflicted relevance while retaining the independently qualified sale in the baseline', () => {
    const row = saleCapture(1, { relevance: [relevanceClaim('synthetic-cohort-1'), relevanceClaim('synthetic-cohort-1', { value: 'synthetic-conflicting-model' })] });
    const result = selectSourceSalePopulation([row], populationOptions());
    expect(result.qualified).toHaveLength(1); expect(result.conflicts).toHaveLength(0);
    expect(result.comparisons[0].reasons).toContain('model:conflict');
    expect(result.comparisons[0].dimensions.find(d => d.dimension === 'model')?.candidate.available).toHaveLength(2);
  });

  it('does not silently prefer an exact year, or select unrelated sales when matching policy is absent', () => {
    const row = saleCapture(1, { relevance: [relevanceClaim('synthetic-cohort-1'), relevanceClaim('synthetic-cohort-1', { dimension: 'model_year', value: '1978' })] });
    const options = populationOptions({ subject: { ...populationOptions().subject,
      relevance: [relevanceClaim('synthetic-subject'), relevanceClaim('synthetic-subject', { dimension: 'model_year', value: '1976' })] } });
    const result = selectSourceSalePopulation([row], options);
    expect(result.matched).toHaveLength(1);
    expect(result.comparisons[0].dimensions.find(d => d.dimension === 'model_year')).toMatchObject({ required: false, state: 'mismatch' });
    const unspecified = selectSourceSalePopulation([row], { ...options, policy: { ...options.policy, requiredDimensions: [] } });
    expect(unspecified.matched).toHaveLength(0); expect(unspecified.reasons).toContain('matching_policy_unknown');
  });

  it('refuses full-population distributions for explicitly incomplete inputs while retaining all admitted rows', () => {
    const result = selectSourceSalePopulation([saleCapture(1), saleCapture(2)], populationOptions({ population: {
      ...populationOptions().population, complete: false } }));
    expect(result.matched).toHaveLength(2); expect(result.reasons).toContain('population_incomplete');
    expect(result.matchedDistribution).toBeNull(); expect(result.broadMarket[0].distribution).toBeNull();
  });

  it('requires day-grain events to fit wholly before the cutoff and preserves timestamp grain', () => {
    const options = populationOptions({ eventBefore: '2025-06-15T18:00:00Z' });
    const day = selectSourceSalePopulation([saleCapture(1)], options);
    expect(day.candidates[0].excluded[0].reason).toBe('outside_event_window');
    const instant = selectSourceSalePopulation([saleCapture(1, { eventAt: '2025-06-15T17:00:00Z', eventGrain: 'instant' })], options);
    expect(instant.qualified[0]).toMatchObject({ eventAt: '2025-06-15T17:00:00.000Z', eventGrain: 'instant' });
    const knownAt = selectSourceSalePopulation([saleCapture(1)], { ...options, knowledgeMode: 'known_at' });
    expect(knownAt.reasons).toContain('invalid_cutoffs');
  });

  it('does not report a repeat-sale return when units differ or event-day intervals overlap', () => {
    const sameDay = [saleCapture(1, { vehicleId: 'synthetic-repeat' }), saleCapture(2, { vehicleId: 'synthetic-repeat' })];
    const overlapping = selectSourceSalePopulation(sameDay, populationOptions());
    expect(overlapping.repeatSales[0]).toMatchObject({ reasons: ['event_order_unknown'], nominalAmountChange: null, nominalPercentChange: null });
    const crossUnit = selectSourceSalePopulation([sameDay[0], { ...sameDay[1], eventAt: '2025-07-01', knownAt: '2025-07-02T00:00:00Z', currency: 'EUR' }], populationOptions());
    expect(crossUnit.repeatSales[0]).toMatchObject({ reasons: ['different_units'], nominalAmountChange: null });
  });

  it('retains query-identified non-BaT source episodes and refuses a source-binding conflict', () => {
    const urls = ['https://synthetic.example/auction?lot=1', 'https://synthetic.example/auction?lot=2'];
    const rows = urls.map((url, i) => saleCapture(i + 1, { sourcePlatform: 'synthetic_source', sourceUrl: url, unitSource: url }));
    expect(selectSourceSalePopulation(rows, populationOptions()).qualified).toHaveLength(2);
    const collision = selectSourceSalePopulation([rows[0], { ...rows[1], sourceEpisodeKey: rows[0].sourceEpisodeKey, vehicleId: rows[0].vehicleId, amount: rows[0].amount }], populationOptions());
    expect(collision.conflicts[0].dimensions).toContain('source_url'); expect(collision.qualified).toHaveLength(0);
  });

  it('orders ties and capture refs deterministically without mutating input or previous receipts', () => {
    const rows = [saleCapture(3), saleCapture(1), saleCapture(2), saleCapture(1, { capture: { table: 'bat_listings', id: 'synthetic-alias' } })];
    const original = structuredClone(rows), options = populationOptions(), first = selectSourceSalePopulation(rows, options);
    expect(selectSourceSalePopulation([...rows].reverse(), options)).toEqual(first);
    expect(rows).toEqual(original); expect(first.qualified.map(e => e.sourceEpisodeKey)).toEqual(['synthetic-cohort-1', 'synthetic-cohort-2', 'synthetic-cohort-3']);
  });
});

function vehicle(over: Partial<VehicleCompRow> & { id: string; listing_url: string }): VehicleCompRow {
  return {
    year: yearFromSlug(batSlug(over.listing_url) ?? '') ?? 1974, make: 'Porsche', model: '914', trim: null,
    sale_price: null, sale_status: 'available', auction_outcome: null, sale_date: null,
    bat_auction_url: null, discovery_url: null, bat_sold_price: null, high_bid: null,
    mileage: 60000, transmission: '5-Speed Manual', engine_size: '2.0-Liter Flat-Four', engine_type: null,
    bat_listing_title: `${yearFromSlug(batSlug(over.listing_url) ?? '') ?? 1974} Porsche 914`, title: null,
    primary_image_url: null,
    ...over,
  };
}

function listing(over: Partial<BatListingRow> & { id: string; bat_listing_url: string }): BatListingRow {
  return {
    vehicle_id: null, bat_listing_title: null, listing_status: 'sold', sale_price: null,
    sale_date: null, auction_end_date: null, ...over,
  };
}

describe('batSlug / yearFromSlug', () => {
  it('reads the lot slug off any BaT URL form', () => {
    expect(batSlug('https://bringatrailer.com/listing/1974-Porsche-914-157/')).toBe('1974-porsche-914-157');
    expect(batSlug('https://www.bringatrailer.com/listing/1974-porsche-914-157?x=1')).toBe('1974-porsche-914-157');
    expect(batSlug('https://www.facebook.com/marketplace/item/3213551119035357/')).toBeNull();
    expect(batSlug(null)).toBeNull();
  });
  it('reads the model year from the slug', () => {
    expect(yearFromSlug('1976-porsche-914-2-0-2')).toBe(1976);
    expect(yearFromSlug('manuals-56')).toBeNull();
  });
});

describe('classifyEngine', () => {
  it('matches the archive regexes', () => {
    expect(classifyEngine('2.0-Liter Flat-Four', '1976 Porsche 914 2.0')).toBe('four_2_0');
    expect(classifyEngine('Replacement 2.0-Liter Flat-Four', '2.0L-Powered 1970 Porsche 914')).toBe('four_2_0');
    expect(classifyEngine('1.7-Liter Flat-Four', '1971 Porsche 914')).toBe('four_1_7_1_8');
    expect(classifyEngine('1.8L Air-Cooled Flat-Four', '1975 Porsche 914')).toBe('four_1_7_1_8');
    expect(classifyEngine('2.3-Liter Flat-Four', '2.3L-Powered 1972 Porsche 914')).toBe('four_other');
    expect(classifyEngine('2,056cc Flat-Four', '1971 Porsche 914 Race Car')).toBe('four_other');
    expect(classifyEngine('Flat-Four Rebuilt to Displace 2,055cc', '2.1L-Powered 1973 Porsche 914')).toBe('four_other');
    expect(classifyEngine('Fuel-Injected 2.0L Flat-Four', '1973 Porsche 914')).toBe('four_2_0');
    expect(classifyEngine('1,995cc Flat-Four', '1973 Porsche 914')).toBe('four_2_0');
    expect(classifyEngine('3.6L Flat-Six Conversion', '1973 Porsche 914')).toBe('six');
    expect(classifyEngine('2.2-Liter Flat-Six', '1970 Porsche 914-6')).toBe('six');
    expect(classifyEngine(null, '1970 Porsche 914-6')).toBe('six');
    expect(classifyEngine('2.5-Liter Subaru EJ25 Flat-Four', '1976 Porsche 914')).toBe('swap');
    expect(classifyEngine('Turbocharged 2.0-Liter Subaru EJ20 Flat-Four', '1976 Porsche 914')).toBe('swap');
    expect(classifyEngine('', '1974 Porsche 914')).toBe('unknown');
  });
});

describe('textFeatures', () => {
  const long = (s: string) => s + ' '.repeat(Math.max(0, MIN_READABLE_DESCRIPTION - s.length)) + 'end.';
  it('reads claims only from a complete write-up', () => {
    const f = textFeatures(long('This 1974 Porsche 914 shows rust in the hell hole and is a project with a clean California title.'));
    expect(f.readable).toBe(true);
    expect(f.rustMention).toBe(true);
    expect(f.project).toBe(true);
    expect(f.cleanTitle).toBe(true);
    expect(f.ac).toBe(false);
  });
  it('refuses a truncated write-up', () => {
    const f = textFeatures('This 1974 Porsche 914 has rust.');
    expect(f.readable).toBe(false);
    expect(f.rustMention).toBe(false);
  });
  it('reads project / race car off the title even when the write-up is cut', () => {
    expect(textFeatures('short', '1973 Porsche 914 2.0 5-Speed Project').project).toBe(true);
    expect(textFeatures('short', '1971 Porsche 914 Race Car').project).toBe(true);
    expect(textFeatures('short', '1974 Porsche 914 2.0').project).toBe(false);
  });
});

describe('buildCompSet — the sold rule', () => {
  const opts = { modelToken: '914', yearStart: 1969, yearEnd: 1976, now: NOW };

  it('counts a lot sold in both tables with agreeing prices, on the vehicles date', () => {
    const v = vehicle({ id: 'v1', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-1/', sale_status: 'sold', sale_price: 24000, sale_date: '2026-05-01' });
    const b = listing({ id: 'b1', bat_listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-1/', sale_price: 24000, sale_date: '2026-05-01' });
    const set = buildCompSet([v], [b], opts);
    expect(set.comps).toHaveLength(1);
    expect(set.comps[0]).toMatchObject({ slug: '1974-porsche-914-1', price: 24000, date: '2026-05-01', basis: 'both', engine: 'four_2_0' });
    expect(set.excluded).toHaveLength(0);
  });

  it('sets a lot aside when the two tables disagree on price', () => {
    const v = vehicle({ id: 'v1', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-200/', sale_status: 'sold', sale_price: 15500, sale_date: '2026-07-30' });
    const b = listing({ id: 'b1', bat_listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-200/', sale_price: 16000, sale_date: '2026-07-30' });
    const set = buildCompSet([v], [b], opts);
    expect(set.comps).toHaveLength(0);
    expect(set.excluded[0].reason).toBe('price_conflict');
  });

  it('never treats a price alone as a sale — it is unresolved and feeds the gate', () => {
    const v = vehicle({ id: 'v1', listing_url: 'https://bringatrailer.com/listing/1976-porsche-914-96/', sale_status: 'available', sale_price: 19750 });
    const set = buildCompSet([v], [], opts);
    expect(set.comps).toHaveLength(0);
    expect(set.excluded[0].reason).toBe('unresolved');
    expect(set.gates.unresolvedCount).toBe(1);
    expect(set.gates.unresolvedShare).toBe(1);
    expect(set.gates.pass).toBe(false);
  });

  it('records an unsold outcome as not_sold, not unresolved', () => {
    const v = vehicle({ id: 'v1', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-206/', sale_status: 'not_sold', sale_price: 8747 });
    const set = buildCompSet([v], [], opts);
    expect(set.excluded[0].reason).toBe('not_sold');
    expect(set.gates.unresolvedCount).toBe(0);
  });

  it('takes bat_listings alone as a sale record when vehicles has no outcome', () => {
    const v = vehicle({ id: 'v1', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-198/', sale_status: 'available', sale_price: 91000 });
    const b = listing({ id: 'b1', bat_listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-198/', sale_price: 91000, sale_date: '2026-07-28' });
    const set = buildCompSet([v], [b], opts);
    expect(set.comps[0]).toMatchObject({ price: 91000, basis: 'bat_listings', date: '2026-07-28' });
  });

  it('excludes junk prices, undated sales, sixes, swaps and unknown engines with a reason each', () => {
    const rows = [
      vehicle({ id: 'a', listing_url: 'https://bringatrailer.com/listing/1973-porsche-914-166/', sale_status: 'sold', sale_price: 170, sale_date: '2024-01-01' }),
      vehicle({ id: 'b', listing_url: 'https://bringatrailer.com/listing/1973-porsche-914-167/', sale_status: 'sold', sale_price: 65000 }),
      vehicle({ id: 'c', listing_url: 'https://bringatrailer.com/listing/1970-porsche-914-6-3/', sale_status: 'sold', sale_price: 70000, sale_date: '2024-01-01', engine_size: '2.0-Liter Flat-Six', bat_listing_title: '1970 Porsche 914-6' }),
      vehicle({ id: 'd', listing_url: 'https://bringatrailer.com/listing/1976-porsche-914-106-2/', sale_status: 'sold', sale_price: 21164, sale_date: '2026-09-23', engine_size: '2.5-Liter Subaru EJ25 Flat-Four' }),
      vehicle({ id: 'e', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-161/', sale_status: 'sold', sale_price: 47000, sale_date: '2026-08-03', engine_size: null, engine_type: null }),
      vehicle({ id: 'f', listing_url: 'https://bringatrailer.com/listing/1970-porsche-911t-targa-18/', sale_status: 'sold', sale_price: 88000, sale_date: '2020-12-01', bat_listing_title: '1970 Porsche 911T Targa' }),
      vehicle({ id: 'g', listing_url: 'https://bringatrailer.com/listing/2005-porsche-cayenne-1/', year: 2005, sale_status: 'sold', sale_price: 8000, sale_date: '2020-12-01', bat_listing_title: '2005 Porsche Cayenne' }),
    ];
    const set = buildCompSet(rows, [], opts);
    expect(set.comps).toHaveLength(0);
    const reasons = Object.fromEntries(set.excluded.map(e => [e.vehicleId, e.reason]));
    expect(reasons).toEqual({
      a: 'junk_price', b: 'undated', c: 'six_cylinder', d: 'engine_swap', e: 'engine_unknown',
      f: 'title_not_model', g: 'outside_years',
    });
    // the 911 and the Cayenne are not lots of this cohort at all
    expect(set.gates.lotCount).toBe(5);
  });

  it('sets aside a record that says sold and reserve not met at once', () => {
    const v = vehicle({ id: 'v1', listing_url: 'https://bringatrailer.com/listing/1971-porsche-914-27/', sale_status: 'sold', auction_outcome: 'reserve_not_met', sale_price: 41000, sale_date: '2022-07-12', high_bid: 29750 });
    const b = listing({ id: 'b1', bat_listing_url: 'https://bringatrailer.com/listing/1971-porsche-914-27/', sale_price: 41000, sale_date: '2022-07-12' });
    const set = buildCompSet([v], [b], opts);
    expect(set.comps).toHaveLength(0);
    expect(set.excluded[0].reason).toBe('status_conflict');
  });

  it('sets aside a lot whose two vehicle rows disagree, keeps one whose rows agree', () => {
    const a1 = vehicle({ id: 'a1', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-111/', sale_status: 'sold', sale_price: 36900, sale_date: '2023-12-15' });
    const a2 = vehicle({ id: 'a2', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-111/', sale_status: 'sold', sale_price: 29750, sale_date: '2026-02-27' });
    const b1 = vehicle({ id: 'b1', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-150/', sale_status: 'sold', sale_price: 16500, sale_date: '2025-01-31' });
    const b2 = vehicle({ id: 'b2', listing_url: 'https://bringatrailer.com/listing/1974-porsche-914-150/', sale_status: 'sold', sale_price: 16500, sale_date: '2025-01-31' });
    const set = buildCompSet([a1, a2, b1, b2], [], opts);
    expect(set.comps.map(c => c.slug)).toEqual(['1974-porsche-914-150']);
    expect(set.excluded[0]).toMatchObject({ slug: '1974-porsche-914-111', reason: 'price_conflict' });
  });

  it('passes the gate when the corpus is reconciled and fresh', () => {
    const rows: VehicleCompRow[] = [];
    for (let i = 0; i < 12; i++) {
      const month = String(i + 1).padStart(2, '0');
      const date = i < 9 ? `2026-${month}-15` : `2025-${month}-15`;
      rows.push(vehicle({ id: `v${i}`, listing_url: `https://bringatrailer.com/listing/1974-porsche-914-${i}/`, sale_status: 'sold', sale_price: 20000 + i * 500, sale_date: date }));
    }
    const set = buildCompSet(rows, [], opts);
    expect(set.comps).toHaveLength(12);
    expect(set.gates.last12moSales).toBe(12);
    expect(set.gates.pass).toBe(true);
    expect(set.comps[0].date).toBe('2026-09-15'); // newest first
    expect(windowComps(set.comps, 12, NOW)).toHaveLength(12);
  });
});

describe('summaries', () => {
  it('quantile_disc and DuckDB median semantics', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.9)).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([23828, 24000])).toBe(23914);
    expect(summarize([]).n).toBe(0);
    expect(summarize([5, 1, 3]).p50).toBe(3);
    expect(shareBelow([10, 20, 30], 25)).toBeCloseTo(2 / 3);
    expect(shareBelow([], 25)).toBeNull();
  });
});
