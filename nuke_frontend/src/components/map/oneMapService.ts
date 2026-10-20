// oneMapService.ts: the one map's reads (plan step 7), one function per map-vehicles mode over map_facts.
// Every number shown on the map comes from here, and every one of them means exactly one map_layers row.
import { supabase } from '../../lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/env';
import type { MapFeatureCollection } from './types';

export type Level = 'state' | 'county' | 'zcta';

export interface MapLayerDef {
  layer: string; sort_order: number; entity: string; source_table: string; rule: string; clock: string;
  geography: string; value_basis: string | null; value_column: string | null; points_allowed: boolean; fold: string | null;
}
export interface AreaCount { key: string; entities: number; priced: number; value: number; avg: number | null }
export interface AreasResponse {
  level: Level; layer: string; from: string; to: string; source: string[]; keys: number | null;
  areas: AreaCount[]; unkeyed: { entities: number }; undated: { entities: number };
  totals: { entities: number; value: number; areas: number }; by_source: { source: string; entities: number }[];
  as_of: string | null; generated_at: string;
}
export interface AreaLayerRow {
  layer: string; entity: string; value_basis: string | null; points_allowed: boolean;
  entities: number; priced: number; value: number | null; avg: number | null; as_of: string | null; latest_day: string | null;
}
export interface AreaResponse { level: Level; key: string; from: string; to: string; layers: AreaLayerRow[]; generated_at: string }

async function read<T>(params: Record<string, string | number | undefined | null>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/map-vehicles?${qs.toString()}`, {
    signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { apikey: SUPABASE_ANON_KEY }) },
  });
  if (!res.ok) throw new Error(`map-vehicles ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// A reader without these modes answers with another shape; that is an error here, never a crash or a wrong number.
const NOT_YET = 'map-vehicles does not serve this mode yet (map_facts reader not deployed)';

export const readLayers = (signal?: AbortSignal) => read<{ layers: MapLayerDef[] }>({ mode: 'layers' }, signal).then((r) => {
  if (!Array.isArray(r?.layers) || !r.layers.every((l) => typeof l?.layer === 'string')) throw new Error(NOT_YET);
  return r.layers;
});

export const readAreas = (q: { level: Level; layer: string; from: string; to: string; source?: string; keys?: string[] }, signal?: AbortSignal) =>
  read<AreasResponse>({ mode: 'areas', level: q.level, layer: q.layer, from: q.from, to: q.to, source: q.source, keys: q.keys?.join(',') }, signal).then((r) => {
    if (!Array.isArray(r?.areas) || !r.unkeyed || !r.totals || !Array.isArray(r.by_source)) throw new Error(NOT_YET);
    return r;
  });

export const readArea = (q: { level: Level; key: string; from: string; to: string }, signal?: AbortSignal) =>
  read<AreaResponse>({ mode: 'area', ...q }, signal).then((r) => {
    if (!Array.isArray(r?.layers)) throw new Error(NOT_YET);
    return r;
  });

export const readPoints = (q: { bbox: string; zoom: number; from: string; to: string; source?: string }, signal?: AbortSignal) =>
  read<MapFeatureCollection>({ mode: 'points', bbox: q.bbox, zoom: q.zoom, time_start: `${q.from}T00:00:00Z`, time_end: `${q.to}T23:59:59Z`, source: q.source, limit: 3000 }, signal);

/** UTC day strings for "the last n days through today". */
export function window(days: number, now = new Date()): { from: string; to: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { from: day(new Date(now.getTime() - days * 86_400_000)), to: day(now) };
}

/** The tiles the boundaries come from: one static tileset in the public map-data bucket (scripts/map/build-tiles.mjs). */
export const BOUNDARY_TILES = `${SUPABASE_URL}/storage/v1/object/public/map-data/tiles/v1/{z}/{x}/{y}.pbf`;
