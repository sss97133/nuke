import { describe, expect, it } from 'vitest';
import { activityWindow, qualifyZipActivity } from './zipActivity';
import type { AreaLayers, AreasOut } from './oneMapService';

const recentWindow = { from: '2026-10-17', to: '2026-11-15' };
const yearWindow = { from: '2025-11-16', to: '2026-11-15' };
const layer = (name: string, entities: number, priced: number, asOf = '2026-11-15 14:29:00+00') =>
  ({ layer: name, entities, priced, value: null, avg: null, as_of: asOf, latest_day: '2026-11-13' });
const area = (window: typeof recentWindow, layers: AreaLayers['layers']): AreaLayers =>
  ({ level: 'zcta', key: '89005', ...window, layers });
const sources: AreasOut = { level: 'zcta', layer: 'listing', ...yearWindow,
  areas: [{ key: '89005', entities: 47, priced: 6, value: 0, avg: null }],
  unkeyed: { entities: 0 }, undated: { entities: 0 }, totals: { entities: 47, value: 0, areas: 1 },
  by_source: [{ source: 'bat', entities: 40 }, { source: 'carsandbids', entities: 7 }], as_of: '2026-11-15 14:29:00+00' };

describe('ZIP area activity qualification', () => {
  it('uses inclusive UTC day windows', () => {
    const now = new Date('2026-11-15T01:00:00-04:00');
    expect(activityWindow(30, now)).toEqual(recentWindow);
    expect(activityWindow(365, now)).toEqual(yearWindow);
  });

  it('shows only matching dated aggregates with a reconciling source breakdown', () => {
    const result = qualifyZipActivity('89005', yearWindow,
      area(yearWindow, [layer('listing', 47, 6), layer('sale', 13, 13)]), sources);
    expect(result.listings?.priced).toBe(6);
    expect(result.sales?.entities).toBe(13);
    expect(result.sources?.map(row => row.entities)).toEqual([40, 7]);
  });

  it('withholds a wrong area, incomplete timestamp or source population mismatch', () => {
    const year = area(yearWindow, [layer('listing', 47, 6), layer('sale', 13, 13)]);
    expect(qualifyZipActivity('89005', yearWindow, { ...year, key: '89006' }, sources).listings).toBeNull();
    expect(qualifyZipActivity('89005', yearWindow, { ...year, layers: [layer('listing', 47, 6, ''), layer('sale', 13, 13)] }, sources).listings).toBeNull();
    expect(qualifyZipActivity('89005', yearWindow, year,
      { ...sources, by_source: [{ source: 'bat', entities: 46 }] }).sources).toBeNull();
    expect(qualifyZipActivity('89005', yearWindow, year,
      { ...sources, from: '2026-01-01' }).sources).toBeNull();
  });
});
