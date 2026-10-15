import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
import { familyCoverage, familyNamesShown, mapCaptionShort, ledgerViewsClock, ledgerViewsStamp, mapCaption, mapLegend } from './HomePage';

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
    expect(legend).toContain('of offered sold = share of cars offered at auction that sold');
    expect(legend).toContain('BaT 12 mo = sales and dollars on Bring a Trailer in the last 12 months against the 12 before, the venue held in full both years');
    expect(legend).toContain('gray: BaT holds under half the sales, or too few a year earlier');
    expect(legend).not.toMatch(/low–|’yy/);
    expect(legend).not.toMatch(/median/);
  });
  it('reads a family and a model name the way it reads a brand, and says what other models holds', () => {
    expect(mapLegend('models')).toBe(mapLegend('brands'));
    expect(mapLegend('families')).toContain('area = dollars from confirmed sales');
    expect(mapLegend('families')).toContain('other models = names not yet keyed to a family, and families with under 3 sales');
    expect(mapLegend('brands')).not.toContain('other models');
  });
  it('says the area counts confirmed sales and the color is their median where the tiles carry no market measures', () => {
    for (const legend of [mapLegend('years'), mapLegend('families', false), mapLegend('brands', false)]) {
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

describe('how much of a brand the family level names', () => {
  it('gives the share of sales in named families and their number, with the clause before the clock', () => {
    const nodes = [
      { name: '911', count: 600, value: 1, familyKey: 'f1' }, { name: 'Boxster', count: 300, value: 1, familyKey: 'f2' },
      { name: 'Other models', count: 100, value: 1, familyKey: 'other' },
    ];
    expect(familyCoverage(nodes)).toBe(' · 90% in 2 model families');
    expect(familyCoverage([{ name: '911', count: 5, value: 1, familyKey: 'f1' }])).toBe(' · 100% in 1 model family');
    expect(familyCoverage([{ name: 'Other models', count: 5, value: 1, familyKey: 'other' }])).toBe(' · 0% in 0 model families');
    expect(familyCoverage([{ name: '911 Carrera', count: 5, value: 1 }])).toBe('');
    expect(familyCoverage(null)).toBe('');
    const refresh = { refreshedAt: '2026-10-14T09:10:00Z', populations: null };
    expect(mapCaption('families', 1000, refresh, Date.parse('2026-10-15T01:10:00Z'), familyCoverage(nodes)))
      .toBe('1,000 vehicles with a confirmed sale · 90% in 2 model families · updated 16 h ago');
  });
});

describe('what a family level shows', () => {
  it('says when it shows the largest names of a family', () => {
    expect(familyNamesShown(200, 1355)).toBe(' · largest 200 of 1,355 names');
    expect(familyNamesShown(49, 49)).toBe('');
    expect(familyNamesShown(0, 10)).toBe('');
    expect(familyNamesShown(200, undefined)).toBe('');
  });
});

describe('the caption on a phone', () => {
  it('keeps the count and drops the sentence', () => {
    const refresh = { refreshedAt: '2026-10-14T09:10:00Z', populations: { measure: 'confirmed_sale_v1', mapped_sales: 241959, public_records: 633678 } };
    expect(mapCaptionShort('brands', 5, refresh)).toBe('241,959 sold');
    expect(mapCaptionShort('families', 27510, refresh)).toBe('27,510 sold');
    expect(mapCaptionShort('vehicles', 200, refresh)).toBe('200 shown');
  });
});
