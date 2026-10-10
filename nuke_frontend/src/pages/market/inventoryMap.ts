import { listingKey, type InventoryTaxonomy, type LiveAuction } from './useMarketPulse';

export const MAP_GROUPS = [
  { id: 'make', label: 'Brand' }, { id: 'model', label: 'Model' },
  { id: 'type', label: 'Vehicle type' }, { id: 'body', label: 'Body style' },
  { id: 'era', label: 'Era (decade)' }, { id: 'year', label: 'Year' },
] as const;
export type MapDimension = typeof MAP_GROUPS[number]['id'];
export type MapSubdivision = 'none' | 'make' | 'model' | 'year' | 'lot';
export interface InventoryMapLens {
  group: MapDimension;
  inside: MapSubdivision;
  focus: string | null;
  child: string | null;
}
export const recordedModel = (a: LiveAuction) => a.model?.trim() || 'Model unrecorded';
export const lotTitle = (a: LiveAuction) => a.title || [a.year, a.make, a.model].filter(Boolean).join(' ');

export function mapLens(params: URLSearchParams, make: string | null): InventoryMapLens {
  const group = MAP_GROUPS.find(g => g.id === params.get('mapBy'))?.id ?? (make ? 'model' : 'make');
  const inside = (['none', 'make', 'model', 'year', 'lot'] as const).find(s => s === params.get('mapInside')) ?? 'none';
  return { group, inside, focus: params.get('mapFocus'), child: inside === 'none' ? null : params.get('mapChild') };
}

export function taxonomyByListing(rows: InventoryTaxonomy[] = []): Map<string, InventoryTaxonomy> {
  return new Map(rows.flatMap(row => {
    const key = listingKey({ id: row.id, listingUrl: row.listing_url });
    return key ? [[key, row] as const] : [];
  }));
}

export function mapValue(a: LiveAuction, dimension: MapDimension | 'lot', taxonomy: Map<string, InventoryTaxonomy>): string {
  if (dimension === 'lot') return listingKey(a) ?? a.id;
  if (dimension === 'make') return a.make;
  // Include the make in model keys so identically named models from different brands never collapse.
  if (dimension === 'model') return JSON.stringify([a.make, recordedModel(a)]);
  if (dimension === 'year' || dimension === 'era') {
    if (a.year == null || !Number.isInteger(a.year) || a.year < 1886 || a.year > new Date().getFullYear() + 2) return 'Year unrecorded';
    return dimension === 'year' ? String(a.year) : `${Math.floor(a.year / 10) * 10}–${Math.floor(a.year / 10) * 10 + 9}`;
  }
  const row = taxonomy.get(listingKey(a) ?? '');
  return (dimension === 'type' ? row?.canonical_vehicle_type : row?.canonical_body_style)?.trim() || 'Unrecorded';
}

export interface InventoryMapGroup { key: string; name: string; lots: LiveAuction[] }
export function inventoryGroups(auctions: LiveAuction[], dimension: MapDimension | 'lot', taxonomy: Map<string, InventoryTaxonomy>): InventoryMapGroup[] {
  const groups = new Map<string, InventoryMapGroup>();
  const singleMake = new Set(auctions.map(a => a.make)).size === 1;
  // Stable order depends on identity, never bid, close extensions, API response order or board sorting.
  for (const a of [...auctions].sort((a, b) => (listingKey(a) ?? a.id).localeCompare(listingKey(b) ?? b.id))) {
    const key = mapValue(a, dimension, taxonomy);
    const name = dimension === 'lot' ? lotTitle(a)
      : dimension === 'model' ? `${singleMake ? '' : `${a.make} · `}${recordedModel(a)}` : key;
    const group = groups.get(key) ?? { key, name, lots: [] };
    group.lots.push(a); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function matchesMapLens(a: LiveAuction, lens: InventoryMapLens, taxonomy: Map<string, InventoryTaxonomy>): boolean {
  return (lens.focus == null || mapValue(a, lens.group, taxonomy) === lens.focus)
    && (lens.child == null || lens.inside === 'none' || mapValue(a, lens.inside, taxonomy) === lens.child);
}
