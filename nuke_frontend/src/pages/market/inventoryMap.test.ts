import { describe, expect, it } from 'vitest';
import { increasedBids, type LiveAuction } from './useMarketPulse';
import { inventoryGroups, mapLens, mapValue, matchesMapLens, taxonomyByListing, MAP_GROUPS } from './inventoryMap';

const lot = (id: string, make = 'FORD', year: number | null = 1995): LiveAuction => ({ id, make, year, model: 'Shared model',
  currentBid: 100, endsAt: 0, updatedAt: 0, listedAt: 0, listingUrl: `https://bringatrailer.com/listing/${id}/`,
  imageUrl: null, noReserve: false, title: null, band: null });

describe('inventory map grain and grouping', () => {
  const lots = [lot('a'), lot('b', 'TOYOTA'), lot('c', 'FORD', null)];
  it('keeps every lot once for every dimension, including unrecorded values', () => {
    for (const dimension of [...MAP_GROUPS.map(g => g.id), 'lot' as const]) {
      const groups = inventoryGroups(lots, dimension, new Map());
      expect(groups.flatMap(g => g.lots.map(a => a.id)).sort()).toEqual(['a', 'b', 'c']);
    }
    expect(inventoryGroups(lots, 'model', new Map())).toHaveLength(2);
    expect(mapValue(lots[2], 'era', new Map())).toBe('Year unrecorded');
    expect(mapValue(lot('boundary', 'FORD', 2000), 'era', new Map())).toBe('2000–2009');
    expect(mapValue(lot('invalid', 'FORD', NaN), 'year', new Map())).toBe('Year unrecorded');
  });
  it('binds taxonomy to the same listing, preserves unknowns, and intersects parent and child', () => {
    const taxonomy = taxonomyByListing([{ id: 'a', listing_url: 'https://bringatrailer.com/listing/previous/', canonical_vehicle_type: 'TRUCK', canonical_body_style: 'PICKUP' }]);
    expect(mapValue(lots[0], 'type', taxonomy)).toBe('Unrecorded');
    const lens = mapLens(new URLSearchParams('mapBy=make&mapInside=year&mapFocus=FORD&mapChild=1995'), null);
    expect(lots.filter(a => matchesMapLens(a, lens, taxonomy)).map(a => a.id)).toEqual(['a']);
    expect(mapLens(new URLSearchParams('mapBy=invalid&mapInside=invalid'), null).group).toBe('make');
  });
  it('has stable group and lot order when bid, end time, and response order change', () => {
    const ids = (items: LiveAuction[]) => inventoryGroups(items, 'make', new Map()).map(g => [g.key, g.lots.map(a => a.id)]);
    expect(ids([...lots].reverse().map(a => ({ ...a, currentBid: 999, endsAt: 999 })))).toEqual(ids(lots));
  });
});

describe('observed snapshot increases', () => {
  it('does not flash initial population, duplicate reads, corrections, missing values, or relistings', () => {
    const before = [lot('a')];
    expect(increasedBids([], before).size).toBe(0);
    expect(increasedBids(before, before).size).toBe(0);
    for (const currentBid of [null, NaN, 90]) expect(increasedBids(before, [{ ...before[0], currentBid }]).size).toBe(0);
    expect(increasedBids(before, [{ ...before[0], currentBid: 200, listingUrl: 'https://bringatrailer.com/listing/relisted/' }]).size).toBe(0);
    expect(increasedBids([{ ...before[0], currentBid: null }], before).size).toBe(0);
    expect(increasedBids([{ ...before[0], listingUrl: null }], [{ ...before[0], listingUrl: null, currentBid: 200 }]).size).toBe(0);
  });
  it('recognizes a rise from zero within one listing, including its trailing-slash alias', () => {
    const before = [{ ...lot('a'), currentBid: 0 }];
    const after = [{ ...lot('a'), listingUrl: 'https://bringatrailer.com/listing/a' }];
    expect([...increasedBids(before, after)]).toEqual(['a']);
  });
});
