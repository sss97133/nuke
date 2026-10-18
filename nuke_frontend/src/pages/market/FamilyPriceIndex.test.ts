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
    // never fitted, below the floor: too few to tell, with the live counts
    const thin = parseFamilyIndex({ change: null, counts: { n_last12: 12, n_prior12: 9, n_total: 60 }, series: [], period_kind: null });
    expect(thin).toMatchObject({ verdict: 'too few to tell', nLast: 12, nPrior: 9, series: [] });
    expect(evidenceOf(thin!)).toBe('21 sales in the two years · needs 30 a year');
    // above the floor but not fitted yet: no index, so the chart keeps its median until the fit lands
    expect(parseFamilyIndex({ change: null, floor: { sales_each_year: 30, sales_total: 150 }, counts: { n_last12: 58, n_prior12: 34, n_total: 150 }, series: [] })).toBeNull();
    expect(parseFamilyIndex({ change: null, floor: { sales_each_year: 30, sales_total: 150 }, counts: { n_last12: 58, n_prior12: 12, n_total: 150 }, series: [] })?.verdict).toBe('too few to tell');
    // chips come as change.chips; a stale fit says when it was measured
    const chips = parseFamilyIndex({ fitted_at: '2026-10-12T11:31:00Z', stale: true, period_kind: null, series: [],
      change: { verdict: 'flat', change_12m: 0.008, lo: -0.012, hi: 0.028, n_last12: 1418, n_prior12: 1290,
        chips: [{ kind: 'generation', key: 'c8', label: 'C8 2020+', change: -0.094, lo: -0.148, hi: -0.037, n_last12: 136, n_prior12: 91, verdict: 'down' }] } });
    expect(chips?.segments.map((x) => [x.label, x.change, x.verdict])).toEqual([['C8 2020+', -0.094, 'down']]);
    expect(evidenceOf(chips!)).toContain('measured Oct 12');
    expect(parseFamilyIndex(null)).toBeNull();
    expect(parseFamilyIndex([1])).toBeNull();
  });
});
