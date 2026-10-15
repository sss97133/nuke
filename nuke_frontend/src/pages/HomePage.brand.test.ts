import { describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { brandLines, brandMomentum } from './HomePage';

// Porsche's row in mv_brand_market as measured 2026-10-15 (sold, dollars, band, sell-through, year), with 12-month counts.
const porsche = {
  name: 'Porsche', count: 27510, value: 2649600000, usd: 2649600000, sold_any: 27510, offered: 33607,
  p10: 16753, p90: 190596, year_p50: 2001, dated: 25000, sold_12m: 4200, sold_prior_12m: 3500,
};

describe('a brand tile', () => {
  it('leads with the market, then the band, then how often cars sell, then the year that trades and the move', () => {
    expect(brandLines(porsche)).toEqual(['$2.6B · 27,510 sold', '$17K–$191K', '82% sell', '’01 · ▲20% 12 mo']);
  });
  it('shows no median anywhere', () => {
    expect(brandLines(porsche).join(' ')).not.toMatch(/med/);
  });
  it('leaves out a line the data cannot support instead of guessing', () => {
    const thin = { ...porsche, p10: null, p90: null, offered: 12, sold_prior_12m: 4, year_p50: null };
    expect(brandLines(thin)).toEqual(['$2.6B · 27,510 sold']);
  });
});

describe('a brand’s 12-month move', () => {
  it('compares the last 12 months with the 12 before', () => {
    expect(brandMomentum(porsche)).toBeCloseTo(0.2, 5);
    expect(brandMomentum({ ...porsche, sold_12m: 2800 })).toBeCloseTo(-0.2, 5);
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
    expect(legend).toContain('area = vehicles with a confirmed sale');
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
    expect(mapLegend('brands', true)).toContain('area = dollars from confirmed sales');
  });
});
