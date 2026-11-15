import type { AreaLayers, AreasOut } from './oneMapService';

export type ActivityWindow = { from: string; to: string };

/** UTC day bounds, inclusive, matching map_facts' day grain. */
export function activityWindow(days: 30 | 365, now = new Date()): ActivityWindow {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export type ActivityCount = { entities: number; priced: number; asOf: string; latestDay: string | null };

function count(read: AreaLayers, zip: string, window: ActivityWindow, layer: 'listing' | 'sale'): ActivityCount | null {
  if (read.level !== 'zcta' || read.key !== zip || read.from !== window.from || read.to !== window.to) return null;
  const row = read.layers.find(value => value.layer === layer);
  if (!row || !Number.isSafeInteger(row.entities) || row.entities < 0 || !Number.isSafeInteger(row.priced)
    || row.priced < 0 || row.priced > row.entities || typeof row.as_of !== 'string'
    || !Number.isFinite(Date.parse(row.as_of))) return null;
  return { entities: row.entities, priced: row.priced, asOf: row.as_of, latestDay: row.latest_day };
}

/** The source breakdown must reconcile to the *same* ZIP/window/layer aggregate. */
export function qualifiedSourceBreakdown(read: AreasOut, zip: string, window: ActivityWindow, expected: ActivityCount) {
  if (read.level !== 'zcta' || read.layer !== 'listing' || read.from !== window.from || read.to !== window.to
    || read.areas.length !== 1 || read.areas[0].key !== zip || read.areas[0].entities !== expected.entities
    || read.as_of !== expected.asOf) return null;
  const sources = read.by_source;
  if (!sources.every(row => typeof row.source === 'string' && Number.isSafeInteger(row.entities) && row.entities >= 0)
    || sources.reduce((sum, row) => sum + row.entities, 0) !== expected.entities) return null;
  return sources;
}

export function qualifyZipActivity(zip: string, window: ActivityWindow, area: AreaLayers, sourceRead: AreasOut | null) {
  const listings = count(area, zip, window, 'listing');
  const sales = count(area, zip, window, 'sale');
  return {
    listings,
    sales,
    sources: listings && sourceRead ? qualifiedSourceBreakdown(sourceRead, zip, window, listings) : null,
  };
}
