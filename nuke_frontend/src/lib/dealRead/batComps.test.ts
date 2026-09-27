import { describe, it, expect } from 'vitest';
import {
  batSlug, yearFromSlug, classifyEngine, textFeatures, buildCompSet, quantile, median,
  summarize, shareBelow, windowComps, MIN_READABLE_DESCRIPTION,
  type VehicleCompRow, type BatListingRow,
} from './batComps';

const NOW = new Date('2026-09-27T12:00:00Z');

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
