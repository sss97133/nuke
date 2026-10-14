import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { ledgerViewsClock, mapLegend, mapPopulationClause } from './HomePage';

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
  it('names the full public population only from a confirmed-sale receipt', () => {
    expect(mapPopulationClause({ measure: 'confirmed_sale_v1', public_records: 633581, mapped_sales: 241919 })).toBe(' of 633,581 public records');
    expect(mapPopulationClause({ measure: 'something_else', public_records: 633581 })).toBe('');
    expect(mapPopulationClause({ measure: 'confirmed_sale_v1' })).toBe('');
    expect(mapPopulationClause(null)).toBe('');
  });
});
