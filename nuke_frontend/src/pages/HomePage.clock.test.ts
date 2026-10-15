import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { ledgerViewsClock, ledgerViewsStamp, mapCaption, mapLegend } from './HomePage';

describe('the ledger map legend clock', () => {
  it('says how long ago the views were refreshed, and keeps the exact time for the title', () => {
    const now = Date.parse('2026-10-15T02:10:00Z');
    expect(ledgerViewsClock('2026-10-14T09:10:41.123+00:00', now)).toBe(' · updated 16 h ago');
    expect(ledgerViewsClock('2026-10-15T02:05:00Z', now)).toBe(' · updated 5 min ago');
    expect(ledgerViewsClock('2026-10-12T02:00:00Z', now)).toBe(' · updated 3 d ago');
    expect(ledgerViewsStamp('2026-10-14T09:10:41.123+00:00')).toBe('Views refreshed 2026-10-14 09:10 UTC');
    expect(ledgerViewsStamp(null)).toBeUndefined();
  });
  it('keeps the old wording without a recorded refresh', () => {
    expect(ledgerViewsClock(null)).toBe(' · as of the last refresh of the ledger’s views');
    expect(ledgerViewsClock('not a time')).toBe(' · as of the last refresh of the ledger’s views');
  });
});

describe('the ledger map legend measure', () => {
  it('says what a brand tile measures: dollars, the band, sell-through, the year that trades, the 12-month move', () => {
    const legend = mapLegend('brands');
    expect(legend).toContain('area = dollars from confirmed sales');
    expect(legend).toContain('$low–$high = the cheapest tenth to the top tenth of sales');
    expect(legend).toContain('sell = share of cars offered that sold');
    expect(legend).toContain('color = sales in the last 12 months against the 12 before (gray: too few dated sales)');
    expect(legend).not.toMatch(/median/);
  });
  it('says the area counts confirmed sales and the color is their median below the brand level', () => {
    for (const level of ['models', 'years'] as const) {
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
    const now = Date.parse('2026-10-15T02:10:00Z');
    expect(mapCaption('brands', 241000, refresh, now)).toBe('241,919 vehicles with a confirmed sale of 633,581 public records · updated 16 h ago');
    expect(mapCaption('models', 27878, refresh, now)).toBe('27,878 vehicles with a confirmed sale · updated 16 h ago');
    expect(mapCaption('vehicles', 37, refresh, now)).toBe('37 confirmed sales · updated 16 h ago');
    expect(mapCaption('vehicles', 200, refresh, now)).toBe('largest 200 confirmed sales · updated 16 h ago');
  });
  it('names no population without a confirmed-sale receipt', () => {
    const old = { refreshedAt: '2026-10-14T05:04:00+00:00', populations: null };
    expect(mapCaption('brands', 386375, old, Date.parse('2026-10-15T02:10:00Z'))).toBe('386,375 vehicles with a confirmed sale · updated 21 h ago');
    const other = { refreshedAt: null, populations: { measure: 'something_else', public_records: 1, mapped_sales: 1 } };
    expect(mapCaption('brands', 5, other)).toBe('5 vehicles with a confirmed sale · as of the last refresh of the ledger\u2019s views');
  });
});
