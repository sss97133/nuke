import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { ledgerViewsClock, mapCaption, mapLegend } from './HomePage';

describe('the ledger map legend clock', () => {
  it('names the refresh time when the ledger recorded one', () => {
    expect(ledgerViewsClock('2026-10-14T09:10:41.123+00:00')).toBe(' · as of 2026-10-14 09:10 UTC');
  });
  it('keeps the old wording without a recorded refresh', () => {
    expect(ledgerViewsClock(null)).toBe(' · as of the last refresh of the ledger’s views');
    expect(ledgerViewsClock('not a time')).toBe(' · as of the last refresh of the ledger’s views');
  });
});

describe('the ledger map legend measure', () => {
  it('says the area counts confirmed sales and the color is their median, nothing else', () => {
    for (const level of ['brands', 'models', 'years'] as const) {
      const legend = mapLegend(level);
      expect(legend).toContain('area = vehicles with a confirmed sale');
      expect(legend).toContain('color = their median sale price (gray: under 5 sales)');
      expect(legend).toContain('asks, bids and unknown outcomes are not counted');
      expect(legend).not.toMatch(/recorded|asking price/);
    }
    expect(mapLegend('vehicles')).toBe('area = confirmed sale price · click to open the record');
  });
  it('puts the population and the date beside the count, from the refresh receipt', () => {
    const refresh = { refreshedAt: '2026-10-14T09:10:41+00:00', populations: { measure: 'confirmed_sale_v1', public_records: 633581, mapped_sales: 241919 } };
    expect(mapCaption('brands', 241000, refresh)).toBe('241,919 vehicles with a confirmed sale of 633,581 public records · as of 2026-10-14 09:10 UTC');
    expect(mapCaption('models', 27878, refresh)).toBe('27,878 vehicles with a confirmed sale · as of 2026-10-14 09:10 UTC');
    expect(mapCaption('vehicles', 37, refresh)).toBe('37 confirmed sales · as of 2026-10-14 09:10 UTC');
    expect(mapCaption('vehicles', 200, refresh)).toBe('largest 200 confirmed sales · as of 2026-10-14 09:10 UTC');
  });
  it('names no population without a confirmed-sale receipt', () => {
    const old = { refreshedAt: '2026-10-14T05:04:00+00:00', populations: null };
    expect(mapCaption('brands', 386375, old)).toBe('386,375 vehicles with a confirmed sale · as of 2026-10-14 05:04 UTC');
    const other = { refreshedAt: null, populations: { measure: 'something_else', public_records: 1, mapped_sales: 1 } };
    expect(mapCaption('brands', 5, other)).toBe('5 vehicles with a confirmed sale · as of the last refresh of the ledger\u2019s views');
  });
});
