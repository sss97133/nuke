import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
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
