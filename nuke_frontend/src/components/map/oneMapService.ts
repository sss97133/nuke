// oneMapService.ts: the one map's reads. The map is a finder: the cars, sales and shops near a place, each one
// openable; areas and their counts are context. Every count is a map_facts row read through map-vehicles; every
// item is a public row the anonymous reader may see.
import { supabase } from '../../lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/env';
import type { MapFeatureCollection, MapEventPoint } from './types';

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
export interface Car {
  vehicle_id: string; lng: number; lat: number; year: number | null; make: string | null; model: string | null;
  price: number | null; source: string | null; source_url: string | null; thumbnail: string | null;
  observed_at: string; status: string | null; location: string | null;
}
export interface Shop { id: string; name: string; slug: string | null; lat: number; lng: number; kind: string | null }

const NOT_YET = 'map-vehicles does not serve this mode yet';

async function fn<T>(params: Record<string, string | number | undefined | null>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/map-vehicles?${qs.toString()}`, {
    signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : { apikey: SUPABASE_ANON_KEY }) },
  });
  if (!res.ok) throw new Error(`map-vehicles ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function rest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { signal, headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) throw new Error(`rest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export const readLayers = (signal?: AbortSignal) => fn<{ layers: MapLayerDef[] }>({ mode: 'layers' }, signal).then((r) => {
  if (!Array.isArray(r?.layers)) throw new Error(NOT_YET);
  return r.layers;
});

export const readAreas = (q: { level: Level; layer: string; from: string; to: string; source?: string; keys?: string[] }, signal?: AbortSignal) =>
  fn<AreasResponse>({ mode: 'areas', level: q.level, layer: q.layer, from: q.from, to: q.to, source: q.source, keys: q.keys?.join(',') }, signal).then((r) => {
    if (!Array.isArray(r?.areas) || !r.unkeyed || !r.totals) throw new Error(NOT_YET);
    return r;
  });

/** The cars in a box: each vehicle once, at its newest observation, newest first. */
export async function readCars(q: { bbox: [number, number, number, number]; from: string; to: string; source?: string; make?: string; limit?: number }, signal?: AbortSignal): Promise<Car[]> {
  const fc = await fn<MapFeatureCollection>({
    mode: 'points', bbox: q.bbox.join(','), zoom: 12, min_confidence: 0, time_start: `${q.from}T00:00:00Z`, time_end: `${q.to}T23:59:59Z`,
    source: q.source, make: q.make, limit: q.limit ?? 2000,
  }, signal);
  const byVehicle = new Map<string, Car>();
  for (const f of fc.features ?? []) {
    const p = f.properties as MapEventPoint & { cluster?: boolean };
    if (p.cluster || !p.vehicle_id) continue;
    const car: Car = {
      vehicle_id: p.vehicle_id, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], year: p.year ?? null, make: p.make ?? null,
      model: p.model ?? null, price: p.price ?? p.asking_price ?? null, source: p.source ?? null, source_url: p.source_url ?? null,
      thumbnail: p.thumbnail ?? null, observed_at: p.observed_at, status: p.vehicle_status ?? null, location: p.location ?? null,
    };
    const prev = byVehicle.get(car.vehicle_id);
    if (!prev || prev.observed_at < car.observed_at) byVehicle.set(car.vehicle_id, car);
  }
  return [...byVehicle.values()].sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1));
}

/** The public shops in a box (organizations with a point). */
export async function readShops(q: { bbox: [number, number, number, number]; limit?: number }, signal?: AbortSignal): Promise<Shop[]> {
  const [w, s, e, n] = q.bbox;
  const rows = await rest<{ id: string; name: string; slug: string | null; latitude: number; longitude: number; business_type: string | null }[]>(
    `organizations?select=id,name,slug,latitude,longitude,business_type&is_public=eq.true&status=eq.active&latitude=gte.${s}&latitude=lte.${n}&longitude=gte.${w}&longitude=lte.${e}&order=name&limit=${q.limit ?? 500}`, signal);
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, lat: r.latitude, lng: r.longitude, kind: r.business_type }));
}

/** Where a search string points: a ZIP (through its county's shapes), else a city. */
export async function findPlace(text: string, signal?: AbortSignal): Promise<{ label: string; bounds?: [number, number, number, number]; center?: [number, number] } | null> {
  const t = text.trim();
  if (/^\d{5}$/.test(t)) {
    const z = await rest<{ zcta: string; county_fips: string }[]>(`us_zctas?select=zcta,county_fips&zcta=eq.${t}`, signal);
    if (!z.length) return null;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/map-data/geo/v1/county/${z[0].county_fips}.geojson`, { signal });
    if (!res.ok) return null;
    const fc = await res.json() as { features: { id: string; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
    const f = fc.features.find((x) => x.id === t);
    if (!f) return null;
    const rings = f.geometry.type === 'Polygon' ? (f.geometry.coordinates as number[][][]) : (f.geometry.coordinates as number[][][][]).flat();
    let w = 180, s = 90, e = -180, n = -90;
    for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    return { label: `ZIP ${t}`, bounds: [w, s, e, n] };
  }
  const m = t.match(/^([^,]+?)(?:,\s*([a-z]{2}))?$/i);
  if (!m) return null;
  const city = encodeURIComponent(m[1].trim()), state = m[2]?.toUpperCase();
  const rows = await rest<{ city: string; state: string; latitude: number; longitude: number; sample_size: number }[]>(
    `city_geocode_lookup?select=city,state,latitude,longitude,sample_size&city=ilike.${city}${state ? `&state=eq.${state}` : ''}&order=sample_size.desc&limit=1`, signal);
  if (!rows.length) return null;
  return { label: `${rows[0].city}, ${rows[0].state}`, center: [rows[0].longitude, rows[0].latitude] };
}

/** UTC day strings for "the last n days through today". */
export function window(days: number, now = new Date()): { from: string; to: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { from: day(new Date(now.getTime() - days * 86_400_000)), to: day(now) };
}

/** The tiles the boundaries come from: one static tileset in the public map-data bucket (scripts/map/build-tiles.mjs). */
export const BOUNDARY_TILES = `${SUPABASE_URL}/storage/v1/object/public/map-data/tiles/v1/{z}/{x}/{y}.pbf`;
