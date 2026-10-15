import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { brandDollarMomentum, brandLines, brandMomentum } from './HomePage';

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
