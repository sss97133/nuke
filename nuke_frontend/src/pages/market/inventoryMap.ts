import { listingKey, type InventoryTaxonomy, type LiveAuction } from './useMarketPulse';
import { squarify } from '../../lib/squarify';
import { vehicleIdentity } from './useMarketRowDetails';

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
export const lotTitle = vehicleIdentity;

export function mapLens(params: URLSearchParams, make: string | null): InventoryMapLens {
  const group = MAP_GROUPS.find(g => g.id === params.get('mapBy'))?.id ?? (make ? 'model' : 'make');
  // A brand box shows its models unless the viewer chooses otherwise: the drill is visible before it is taken.
  const inside = (['none', 'make', 'model', 'year', 'lot'] as const).find(s => s === params.get('mapInside')) ?? (group === 'make' ? 'model' : 'none');
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
    if (a.year == null || !Number.isInteger(a.year) || a.year <= 0 || a.year > 9999) return 'Year unrecorded';
    return dimension === 'year' ? String(a.year) : `${Math.floor(a.year / 10) * 10}–${Math.floor(a.year / 10) * 10 + 9}`;
  }
  const row = taxonomy.get(listingKey(a) ?? '');
  return (dimension === 'type' ? row?.canonical_vehicle_type : row?.canonical_body_style)?.trim() || 'Unrecorded';
}

export interface InventoryMapGroup { key: string; name: string; lots: LiveAuction[] }
export interface ReadableMapGroup extends InventoryMapGroup { remainder?: InventoryMapGroup[] }

/** Keep the area of every lot, but combine boxes too small to identify into a named list entry. */
export function readableInventoryLayout(groups: InventoryMapGroup[], width: number, height: number) {
  if (width <= 0 || height <= 0 || !groups.length) return [];
  const sorted = [...groups].sort((a, b) => b.lots.length - a.lots.length || a.key.localeCompare(b.key));
  const total = sorted.reduce((n, g) => n + g.lots.length, 0);
  // Keep the largest legible prefix. Reserve the combined entry at the edge so it
  // cannot displace the largest named brand or trigger repeated layout collapse.
  const max = Math.min(sorted.length, Math.floor(width * height / (88 * 60)));
  for (let shown = max; shown >= 0; shown--) {
    const remainder = sorted.slice(shown);
    const remainderLots = remainder.flatMap(g => g.lots);
    const share = remainderLots.length / total;
    const landscape = width >= height;
    const mainWidth = landscape ? width * (1 - share) : width;
    const mainHeight = landscape ? height : height * (1 - share);
    const rects = squarify<ReadableMapGroup>(sorted.slice(0, shown).map(node => ({ node, area: node.lots.length })), 0, 0, mainWidth, mainHeight);
    if (rects.some(r => r.w < 88 || r.h < 60)) continue;
    if (remainder.length) {
      const restWidth = landscape ? width - mainWidth : width;
      const restHeight = landscape ? height : height - mainHeight;
      if (shown > 0 && (restWidth < 88 || restHeight < 60)) continue;
      rects.push({ node: { key: '__map_remainder__', name: `${remainder.length} more groups`, lots: remainderLots, remainder },
        x: landscape ? mainWidth : 0, y: landscape ? 0 : mainHeight, w: restWidth, h: restHeight });
    }
    return rects;
  }
  return [];
}
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
