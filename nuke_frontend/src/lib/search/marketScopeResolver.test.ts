import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRows = vi.hoisted(() => ({ data: [] as any[], error: null as any }));
vi.mock('../supabase', () => ({
  supabase: {
    from: () => {
      const builder: any = {
        select: () => builder,
        neq: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: () => builder,
        eq: () => builder,
        ilike: () => builder,
        then: (resolve: any) => Promise.resolve(mockRows).then(resolve),
      };
      return builder;
    },
  },
}));

import { buildMarketScopeUrl, isOnMarketTab, resolveMarketScopeQuery } from './marketScopeResolver';
import { getDefinedFamilyEras } from '../market/familyEras';
import { matchesSaleSubModel } from '../../pages/market/FamilySalesChart';

describe('marketScopeResolver', () => {
  beforeEach(() => {
    mockRows.data = [
      {
        brand: 'Ford',
        family_key: '8a8271f8-d299-4b55-837a-35ca919f8937',
        family: 'Mustang',
        model_key: 'mustang',
        model: 'Mustang',
        sold: 3826,
        usd: 158100000,
      },
      {
        brand: 'Ford',
        family_key: '8a8271f8-d299-4b55-837a-35ca919f8937',
        family: 'Mustang',
        model_key: 'mustang mach 1',
        model: 'Mustang Mach 1',
        sold: 412,
        usd: 26500000,
      },
      {
        brand: 'Chevrolet',
        family_key: 'c10-family-uuid',
        family: 'C10',
        model_key: 'c10',
        model: 'C10',
        sold: 2777,
        usd: 95100000,
      },
      {
        brand: 'Chevrolet',
        family_key: '3f3e7278-f47c-412f-b6fc-0ab5d8485924',
        family: 'Corvette',
        model_key: 'corvette',
        model: 'Corvette',
        sold: 16751,
        usd: 1300400000,
      },
      {
        brand: 'Porsche',
        family_key: '911-family-uuid',
        family: '911',
        model_key: '911',
        model: '911',
        sold: 22000,
        usd: 2500000000,
      },
      {
        brand: 'Mercedes-Benz',
        family_key: 'sl-family-uuid',
        family: 'SL',
        model_key: '230sl',
        model: '230SL',
        sold: 163,
        usd: 9170000,
      },
    ];
    mockRows.error = null;
  });

  it('identifies when the user is on the Market tab', () => {
    expect(isOnMarketTab('/', '')).toBe(true);
    expect(isOnMarketTab('/', '?tab=market')).toBe(true);
    expect(isOnMarketTab('/', '?tab=market&make=Ford')).toBe(true);
    expect(isOnMarketTab('/', '?tab=feed')).toBe(false);
    expect(isOnMarketTab('/search', '?q=mustang')).toBe(false);
  });

  it('resolves "mustang" and "ford mustang" to the Ford Mustang family scope', async () => {
    const scope = await resolveMarketScopeQuery('mustang');
    expect(scope).toEqual({
      make: 'Ford',
      family: '8a8271f8-d299-4b55-837a-35ca919f8937',
      family_name: 'Mustang',
    });
    expect(buildMarketScopeUrl(scope!)).toBe(
      '/?tab=market&make=Ford&family=8a8271f8-d299-4b55-837a-35ca919f8937&family_name=Mustang',
    );
  });

  it('resolves a specific sub-model like "ford mustang mach 1" to family + model', async () => {
    const scope = await resolveMarketScopeQuery('ford mustang mach 1');
    expect(scope).toEqual({
      make: 'Ford',
      family: '8a8271f8-d299-4b55-837a-35ca919f8937',
      family_name: 'Mustang',
      model: 'Mustang Mach 1',
    });
  });

  it('resolves a year + family like "1967 mustang" to family + model + year', async () => {
    const scope = await resolveMarketScopeQuery('1967 mustang');
    expect(scope).toEqual({
      make: 'Ford',
      family: '8a8271f8-d299-4b55-837a-35ca919f8937',
      family_name: 'Mustang',
      model: 'Mustang',
      year: 1967,
    });
  });

  it('resolves cultural shorthands like "73-87 gm trucks", "squarebody", and "fox body" with their era range', async () => {
    const gmScope = await resolveMarketScopeQuery('73-87 gm trucks');
    expect(gmScope).toEqual({
      make: 'Chevrolet',
      family: 'c10-family-uuid',
      family_name: 'C10',
      era: '1973-1987',
    });
    expect(buildMarketScopeUrl(gmScope!)).toBe(
      '/?tab=market&make=Chevrolet&family=c10-family-uuid&family_name=C10&era=1973-1987',
    );
    const sqScope = await resolveMarketScopeQuery('squarebody');
    expect(sqScope).toEqual({
      make: 'Chevrolet',
      family: 'c10-family-uuid',
      family_name: 'C10',
      era: '1973-1987',
    });
    const foxScope = await resolveMarketScopeQuery('fox body');
    expect(foxScope).toEqual({
      make: 'Ford',
      family: '8a8271f8-d299-4b55-837a-35ca919f8937',
      family_name: 'Mustang',
      era: '1979-1993',
    });
    const pagodaScope = await resolveMarketScopeQuery('pagoda');
    expect(pagodaScope).toEqual({
      make: 'Mercedes-Benz',
      family: 'sl-family-uuid',
      family_name: 'SL',
      era: '1963-1971',
    });
    const p993Scope = await resolveMarketScopeQuery('993');
    expect(p993Scope).toEqual({
      make: 'Porsche',
      family: '911-family-uuid',
      family_name: '911',
      era: '1995-1998',
    });
    const c2Scope = await resolveMarketScopeQuery('split window');
    expect(c2Scope).toEqual({
      make: 'Chevrolet',
      family: '3f3e7278-f47c-412f-b6fc-0ab5d8485924',
      family_name: 'Corvette',
      era: '1963-1967',
    });
  });

  it('returns null for natural-language price or mileage filter queries so they fall through to /search', async () => {
    expect(await resolveMarketScopeQuery('manual wagons under $30k')).toBeNull();
    expect(await resolveMarketScopeQuery('porsche 911 with under 20000 miles')).toBeNull();
  });

  it('matches sub-model sales for FamilySalesChart sub-model filtering', () => {
    expect(matchesSaleSubModel('Mustang Mach 1', 'Mustang Mach 1')).toBe(true);
    expect(matchesSaleSubModel('Shelby GT350 Fastback', 'Shelby GT350')).toBe(true);
    expect(matchesSaleSubModel('Mustang GT', 'Shelby GT350')).toBe(false);
    expect(matchesSaleSubModel('Mustang', null)).toBe(true);
  });

  it('resolves specialist British, JDM, and classic shorthands and defined eras', async () => {
    mockRows.data = [
      { brand: 'Caterham', family_key: 'f-cat7', family: 'Seven', model_key: 'super seven', model: 'Super Seven', sold: 41, usd: 1850000 },
      { brand: 'TVR', family_key: 'f-tvr', family: 'Griffith', model_key: '2500m', model: '2500M', sold: 25, usd: 750000 },
      { brand: 'Austin-Healey', family_key: 'f-ah3000', family: '3000', model_key: '3000 mk iii bj8', model: '3000 Mk III BJ8', sold: 493, usd: 25840000 },
      { brand: 'Mazda', family_key: 'f-rx7', family: 'RX-7', model_key: 'rx-7', model: 'RX-7', sold: 686, usd: 17740000 },
      { brand: 'Suzuki', family_key: 'f-gsxr', family: 'GSX-R', model_key: 'gsx1300r hayabusa', model: 'GSX1300R Hayabusa', sold: 12, usd: 138000 },
    ];
    expect(await resolveMarketScopeQuery('super seven')).toEqual({
      make: 'Caterham',
      family: 'f-cat7',
      family_name: 'Seven',
    });
    expect(await resolveMarketScopeQuery('big healey')).toEqual({
      make: 'Austin-Healey',
      family: 'f-ah3000',
      family_name: '3000',
    });
    expect(await resolveMarketScopeQuery('fd3s')).toEqual({
      make: 'Mazda',
      family: 'f-rx7',
      family_name: 'RX-7',
    });
    expect(await resolveMarketScopeQuery('hayabusa')).toEqual({
      make: 'Suzuki',
      family: 'f-gsxr',
      family_name: 'GSX-R',
    });
    expect(getDefinedFamilyEras('Mazda', 'RX-7').map((e) => e.shortLabel)).toEqual(['SA/FB', 'FC3S', 'FD3S']);
    expect(getDefinedFamilyEras('Austin-Healey', '3000').map((e) => e.shortLabel)).toEqual(['100-6', 'Mk I/II', 'BJ8']);
    expect(getDefinedFamilyEras('TVR', 'Griffith').map((e) => e.shortLabel)).toEqual(["'58–'79", 'Wedge', 'Wheeler Era']);
  });
});
