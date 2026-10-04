import { describe, it, expect } from 'vitest';
import { parseBaTHTML } from '../../../../supabase/functions/_shared/batParser';
import saleParserFixtures from '../../../../scripts/discovery/bat-sale-parser-fixtures.json';
import {
  batSlug, yearFromSlug, classifyEngine, textFeatures, buildCompSet, quantile, median,
  summarize, shareBelow, windowComps, MIN_READABLE_DESCRIPTION,
  comparePriceToSourceSales, type DatedSourceSale, type SaleComparisonOptions,
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
