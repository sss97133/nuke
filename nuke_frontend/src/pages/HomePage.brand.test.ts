import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import {
  applyDrillStackToSearchParams,
  brandDollarMomentum,
  brandLines,
  brandMomentum,
  buildRepresentativeImageCandidates,
  drillStackFromSearchParams,
  lineChars,
  selectFamilyRepresentativeVehicleIds,
} from './HomePage';
import { optimizeImageUrl } from '../lib/imageOptimizer';

// Porsche's row in mv_brand_market as measured 2026-10-15 (sold, dollars, band, sell-through, year), with 12-month counts.
const porsche = {
  name: 'Porsche', count: 27510, value: 2649600000, usd: 2649600000, sold_any: 27510, offered: 33607,
  p10: 16753, p90: 190596, year_p50: 2001, dated: 25000, sold_12m: 4200, sold_prior_12m: 3500,
  usd_12m: 450_000_000, usd_prior_12m: 360_000_000,
};

describe('a brand tile', () => {
  it('says the market, how often what is offered sells, and the last 12 months against the 12 before', () => {
    expect(brandLines(porsche)).toEqual(['$2.6B · 27,510 sold', '82% of offered sold', '12 mo: sales ▲20%, $ ▲25%']);
  });
  it('shows no median, no price band and no model year', () => {
    const said = brandLines(porsche).join(' ');
    expect(said).not.toMatch(/med|\$17K|’01/);
  });
  it('leaves out a line the data cannot support instead of guessing', () => {
    const thin = { ...porsche, offered: 12, sold_prior_12m: 4 };
    expect(brandLines(thin)).toEqual(['$2.6B · 27,510 sold']);
    expect(brandLines({ ...porsche, usd_prior_12m: null })).toEqual(['$2.6B · 27,510 sold', '82% of offered sold', '12 mo: sales ▲20%']);
  });
});

describe('a narrow brand tile', () => {
  // Maserati's size of market (2026-10-15 live: $156.3M, 1,1xx sold) on Porsche's 12-month counts.
  const maserati = { ...porsche, name: 'Maserati', count: 1108, value: 156_300_000, usd: 156_300_000, sold_any: 1108, offered: 1368 };
  it('shows the longest form of each line that fits its width', () => {
    expect(brandLines(maserati, 17)).toEqual(['$156M · 1.1K sold', '81% sold', '12 mo ▲20%']);
    expect(brandLines(maserati, 10)).toEqual(['$156M', '81% sold']);
    expect(brandLines(maserati, 4)).toEqual([]);
  });
  it('never returns a line wider than the tile, at any width', () => {
    for (const node of [porsche, maserati, { ...maserati, usd: 40_400, count: 3, offered: 25, sold_any: 3 }]) {
      for (let width = 0; width <= 40; width++) {
        for (const line of brandLines(node, width)) expect(lineChars(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe('a brand’s 12-month move', () => {
  it('compares the last 12 months with the 12 before', () => {
    expect(brandMomentum(porsche)).toBeCloseTo(0.2, 5);
    expect(brandMomentum({ ...porsche, sold_12m: 2800 })).toBeCloseTo(-0.2, 5);
  });
  it('in dollars under the same rule', () => {
    expect(brandDollarMomentum(porsche)).toBeCloseTo(0.25, 5);
    expect(brandDollarMomentum({ ...porsche, sold_prior_12m: 9 })).toBeNull();
    expect(brandDollarMomentum({ ...porsche, dated: 13000 })).toBeNull();
  });
  it('is unknown with under 10 sales a year earlier or a sale date on under half the sales', () => {
    expect(brandMomentum({ ...porsche, sold_prior_12m: 9 })).toBeNull();
    expect(brandMomentum({ ...porsche, dated: 13000 })).toBeNull();
    expect(brandMomentum({ ...porsche, sold_12m: null })).toBeNull();
  });
});

describe('a partially unavailable brand market', () => {
  it.each(['failed', 'partial', 'invalid'])('keeps all tiles and the legend on counts and median price when supplemental data is %s', async mode => {
    vi.resetModules();
    const base = [{ name: 'A', count: 10, value: 10, median_price: 20_000 }, { name: 'B', count: 20, value: 20, median_price: 30_000 }];
    rpc.mockImplementation(async name => name === 'treemap_by_brand' ? { data: base, error: null }
      : mode === 'failed' ? { data: null, error: { message: 'unavailable' } }
      : { data: [{ name: 'A', usd: 200_000 }, ...(mode === 'invalid' ? [{ name: 'B', usd: 0 }] : [])], error: null });
    const { readTreemapBrands, mapLegend } = await import('./HomePage');
    const rows = await readTreemapBrands();
    expect(rows).toEqual(base);
    const legend = mapLegend('brands', !!rows?.length && rows.every(n => n.usd != null && n.usd > 0));
    expect(legend).toContain('box size = vehicles with a confirmed sale');
    expect(legend).toContain('color = their median sale price');
    expect(legend).not.toContain('last 12 months');
  });
  it('uses dollar area and momentum only with a dollar total for every tile', async () => {
    vi.resetModules();
    rpc.mockImplementation(async name => ({ data: name === 'treemap_by_brand'
      ? [{ name: 'A', count: 10, value: 10 }] : [{ name: 'A', usd: 200_000, sold_12m: 8 }], error: null }));
    const { readTreemapBrands, mapLegend } = await import('./HomePage');
    const rows = await readTreemapBrands();
    expect(rows?.[0].usd).toBe(200_000);
    expect(mapLegend('brands', true)).toContain('box size = dollars from confirmed sales');
  });
});

describe('URL scope contract for the market treemap', () => {
  it('round-trips make -> family -> model -> year in URL search params and restores canonical names', () => {
    const stack = [
      { label: 'ALL MAKES' },
      { label: 'Ford', make: 'Ford' },
      { label: 'Mustang', make: 'Ford', family: '8a8271f8-d299-4b55-837a-35ca919f8937', names: 1243 },
      { label: 'Mustang GT', make: 'Ford', family: '8a8271f8-d299-4b55-837a-35ca919f8937', model: 'Mustang GT' },
      { label: '1967', make: 'Ford', family: '8a8271f8-d299-4b55-837a-35ca919f8937', model: 'Mustang GT', year: 1967 },
    ];
    const params = applyDrillStackToSearchParams(new URLSearchParams('tab=market'), stack);
    expect(params.get('make')).toBe('Ford');
    expect(params.get('family')).toBe('8a8271f8-d299-4b55-837a-35ca919f8937');
    expect(params.get('family_name')).toBe('Mustang');
    expect(params.get('model')).toBe('Mustang GT');
    expect(params.get('year')).toBe('1967');

    // Deep-linked with uppercase make from MarketPulse resolves back to canonical brand and family names
    const fromDeepLink = drillStackFromSearchParams(
      new URLSearchParams('make=FORD&family=8a8271f8-d299-4b55-837a-35ca919f8937'),
      [{ name: 'Ford', count: 29489, value: 1479400000 }],
      [{ name: 'Mustang', count: 11050, value: 595300000, familyKey: '8a8271f8-d299-4b55-837a-35ca919f8937', models: 1243 }],
    );
    expect(fromDeepLink).toEqual([
      { label: 'ALL MAKES' },
      { label: 'Ford', make: 'Ford' },
      { label: 'Mustang', make: 'Ford', family: '8a8271f8-d299-4b55-837a-35ca919f8937', names: 1243 },
    ]);

    // Family-level direct year drill (Make -> Family -> Year without picking a fragmented model string)
    const familyYearStack = [
      { label: 'ALL MAKES' },
      { label: 'Ford', make: 'Ford' },
      { label: 'Mustang', make: 'Ford', family: '8a8271f8-d299-4b55-837a-35ca919f8937', names: 1243 },
      { label: '1969', make: 'Ford', family: '8a8271f8-d299-4b55-837a-35ca919f8937', year: 1969 },
    ];
    const familyYearParams = applyDrillStackToSearchParams(new URLSearchParams('tab=market&era=1964-1973'), familyYearStack);
    expect(familyYearParams.get('make')).toBe('Ford');
    expect(familyYearParams.get('family')).toBe('8a8271f8-d299-4b55-837a-35ca919f8937');
    expect(familyYearParams.get('family_name')).toBe('Mustang');
    expect(familyYearParams.get('model')).toBeNull();
    expect(familyYearParams.get('year')).toBe('1969');
    expect(familyYearParams.get('era')).toBe('1964-1973');
    expect(drillStackFromSearchParams(
      familyYearParams,
      [{ name: 'Ford', count: 29489, value: 1479400000 }],
      [{ name: 'Mustang', count: 11050, value: 595300000, familyKey: '8a8271f8-d299-4b55-837a-35ca919f8937', models: 1243 }],
    )).toEqual(familyYearStack);

    // Going back to ALL MAKES clears scope params while keeping tab
    const cleared = applyDrillStackToSearchParams(params, [{ label: 'ALL MAKES' }]);
    expect(cleared.get('tab')).toBe('market');
    expect(cleared.get('make')).toBeNull();
    expect(cleared.get('family')).toBeNull();
    expect(cleared.get('family_name')).toBeNull();
    expect(cleared.get('model')).toBeNull();
    expect(cleared.get('year')).toBeNull();
  });
});

describe('representative images for model and year tiles', () => {
  it('never assigns brand-wide outliers (e.g. GT40 or Bronco) to Mustang year tiles', () => {
    const brandTopRows = [
      { id: 'gt40-67', model: 'GT40 Mk 1', year: 1967, primary_image_url: 'https://cdn.example.com/1967-gt40.jpg' },
      { id: 'gt40-69', model: 'GT40', year: 1969, primary_image_url: 'https://cdn.example.com/1969-gt40.jpg' },
      { id: 'bronco-68', model: 'Bronco', year: 1968, primary_image_url: 'https://cdn.example.com/1968-bronco.jpg' },
      { id: 'bullitt-68', model: 'Mustang GT "Bullitt"', year: 1968, primary_image_url: 'https://cdn.example.com/1968-bullitt.jpg' },
      { id: 'mustang-67', model: 'Mustang', year: 1967, primary_image_url: 'https://cdn.example.com/1967-mustang.jpg' },
      { id: 'mustang-68-a', model: 'Mustang', year: 1968, primary_image_url: 'https://cdn.example.com/1968-mustang-1.jpg' },
      { id: 'mustang-68-b', model: 'Mustang', year: 1968, primary_image_url: 'https://cdn.example.com/1968-mustang-2.jpg' },
    ];

    const mustangMap = buildRepresentativeImageCandidates(brandTopRows, 'Mustang');
    expect(mustangMap.get('1967')).toEqual(['https://cdn.example.com/1967-mustang.jpg']);
    expect(mustangMap.get('1969')).toBeUndefined();
    // Exact sub-model ("Mustang") candidates come before prefix variants ("Mustang GT \"Bullitt\"")
    expect(mustangMap.get('1968')).toEqual([
      'https://cdn.example.com/1968-mustang-1.jpg',
      'https://cdn.example.com/1968-mustang-2.jpg',
      'https://cdn.example.com/1968-bullitt.jpg',
    ]);
  });

  it('picks top candidate vehicle IDs per visible year tile from family sales, prioritizing exact sub-model matches', () => {
    const yearTiles = [
      { name: '1967', count: 317, value: 317 },
      { name: '1968', count: 294, value: 294 },
      { name: '1970', count: 162, value: 162 },
    ];
    const familySales = [
      { vehicle_id: 'v-68-bullitt', sale_date: '2026-01-10', usd: 3_740_000, source: 'Mecum', year: 1968, model: 'Mustang GT "Bullitt"' },
      { vehicle_id: 'v-68-exact-1', sale_date: '2026-02-01', usd: 215_000, source: 'Bring a Trailer', year: 1968, model: 'Mustang' },
      { vehicle_id: 'v-68-exact-2', sale_date: '2026-02-02', usd: 185_000, source: 'Mecum', year: 1968, model: 'Mustang' },
      { vehicle_id: 'v-67-exact-1', sale_date: '2026-03-01', usd: 240_000, source: 'Bring a Trailer', year: 1967, model: 'Mustang' },
      { vehicle_id: 'v-70-exact-1', sale_date: '2026-03-05', usd: 145_000, source: 'Bring a Trailer', year: 1970, model: 'Mustang' },
      { vehicle_id: 'v-70-boss', sale_date: '2026-03-06', usd: 310_000, source: 'Mecum', year: 1970, model: 'Shelby GT500' },
    ];

    const ids = selectFamilyRepresentativeVehicleIds(yearTiles, familySales, 'Mustang', 2);
    expect(ids).toEqual([
      'v-67-exact-1',
      'v-68-exact-1',
      'v-68-exact-2',
      'v-70-exact-1',
    ]);
  });

  it('normalizes malformed Mecum Cloudinary double-v version URLs so 1966 Mustang photos resolve', () => {
    const brokenMecumUrl = 'https://images.mecum.com/image/upload/vv1763048796/auctions/FL26/1159821/580030.jpg?';
    expect(optimizeImageUrl(brokenMecumUrl, 'small')).toBe(
      'https://images.mecum.com/image/upload/v1763048796/auctions/FL26/1159821/580030.jpg',
    );
    expect(optimizeImageUrl(brokenMecumUrl, 'full')).toBe(
      'https://images.mecum.com/image/upload/v1763048796/auctions/FL26/1159821/580030.jpg',
    );
  });
});
