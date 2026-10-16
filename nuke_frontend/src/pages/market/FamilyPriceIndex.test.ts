import { describe, expect, it } from 'vitest';
import { answerOf, evidenceOf, parseFamilyIndex } from './FamilyPriceIndex';

describe('same car, same miles', () => {
  it('says the move, flat within its band, or too few to tell', () => {
    expect(answerOf({ verdict: 'up', change: 0.388, lo: 0.295, hi: 0.488 })).toBe('▲39% in 12 months');
    expect(answerOf({ verdict: 'down', change: -0.094, lo: -0.15, hi: -0.04 })).toBe('▼9% in 12 months');
    expect(answerOf({ verdict: 'flat', change: 0.008, lo: -0.012, hi: 0.028 })).toBe('Flat: within ±3% in 12 months');
    expect(answerOf({ verdict: 'too few to tell', change: 0.08, lo: -0.05, hi: 0.23 })).toBe('Too few sales to tell');
  });
  it('reads the reader, refuses anything without a verdict, and keeps the series in time order', () => {
    const ix = parseFamilyIndex({ period_kind: 'month', change: { verdict: 'flat', change_12m: 0.01, lo: -0.01, hi: 0.03, n_prior12: 1290, n_last12: 1418 },
      series: [{ period_start: '2026-09-01', index_usd: 47000, lo_usd: 46000, hi_usd: 48000, n: 111, raw_median_usd: 52000 },
        { period_start: '2026-08-01', index_usd: 46500, lo_usd: 45500, hi_usd: 47500, n: 90, raw_median_usd: null }] });
    expect(ix?.series.map((p) => p.usd)).toEqual([46500, 47000]);
    expect(ix?.periodKind).toBe('month');
    expect(evidenceOf(ix!)).toBe('±2 points (95%) · 2,708 sales in the two years');
    expect(parseFamilyIndex({ change: { change_12m: 0.1 } })).toBeNull();
    expect(parseFamilyIndex(null)).toBeNull();
    expect(parseFamilyIndex([1])).toBeNull();
  });
});
