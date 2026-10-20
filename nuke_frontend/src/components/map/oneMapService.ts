// oneMapService.ts: the web map's reads, the same reads the iOS map makes (MarketMapView.swift, the one map the
// owner is pleased with): location observations of public vehicles per county, folded per ZIP in the client;
// boundaries from the static tiles in storage. Anon key only: the reads are public and must start at once.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/env';

export interface LocationRow {
  id: string; observed_at: string | null; source_type: string | null; source_platform: string | null; source_url: string | null;
  postal_code: string | null; county_fips: string | null; city: string | null; precision: string | null; confidence: number | null;
  vehicles: { id: string; year: number | null; make: string | null; model: string | null; trim: string | null; primary_image_url: string | null;
    city: string | null; state: string | null; status: string | null; deleted_at: string | null };
}
const SELECT = 'id,observed_at,source_type,source_platform,source_url,postal_code,county_fips,city,precision,confidence,vehicles!inner(id,year,make,model,trim,primary_image_url,city,state,status,deleted_at)';
const NOT_ELIGIBLE = new Set(['deleted', 'merged', 'rejected', 'duplicate']);
const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

export const zip5 = (raw: string | null | undefined): string | null => {
  const m = (raw ?? '').trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? m[1] : null;
};
export const eligible = (r: LocationRow) => r.vehicles.deleted_at == null && !NOT_ELIGIBLE.has((r.vehicles.status ?? '').toLowerCase());

/** Every location observation of one county, paged by id as the iOS reader does; a page is never a dataset limit. */
export async function readCounty(fips: string, signal?: AbortSignal, onPage?: (rows: LocationRow[]) => void): Promise<LocationRow[]> {
  const all: LocationRow[] = [];
  let after: string | null = null;
  for (;;) {
    const qs = `select=${SELECT}&county_fips=eq.${fips}&confidence=gte.0.5${after ? `&id=gt.${after}` : ''}&order=id.asc&limit=1000`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicle_location_observations?${qs}`, { signal, headers });
    if (!res.ok) throw new Error(`location read ${res.status}`);
    const page = (await res.json()) as LocationRow[];
    all.push(...page); onPage?.(page);
    if (page.length < 1000) return all;
    after = page[page.length - 1].id;
  }
}

export interface ZipGroup { zip: string; vehicles: Map<string, LocationRow[]> }

/** The iOS fold: rows → ZIP → vehicles (each once) → its observations, newest first; filters by make and window. */
export function foldByZip(rows: LocationRow[], opts: { make?: string; from?: Date | null }): { groups: Map<string, ZipGroup>; vehicles: number; noZip: number } {
  const groups = new Map<string, ZipGroup>(); const all = new Set<string>(); let noZip = 0;
  for (const r of rows) {
    if (!eligible(r)) continue;
    if (opts.make && (r.vehicles.make ?? '').trim().toLowerCase() !== opts.make.toLowerCase()) continue;
    if (opts.from && (!r.observed_at || new Date(r.observed_at) < opts.from)) continue;
    all.add(r.vehicles.id);
    const z = zip5(r.postal_code);
    if (!z) { noZip++; continue; }
    const g = groups.get(z) ?? { zip: z, vehicles: new Map() };
    const list = g.vehicles.get(r.vehicles.id) ?? [];
    list.push(r); g.vehicles.set(r.vehicles.id, list); groups.set(z, g);
  }
  for (const g of groups.values()) for (const list of g.vehicles.values()) list.sort((a, b) => ((a.observed_at ?? '') < (b.observed_at ?? '') ? 1 : -1));
  return { groups, vehicles: all.size, noZip };
}

/** The iOS palette: fixed bands so a colour means the same thing in every region. */
export const BANDS = ['1–4', '5–19', '20–99', '100+'];
export const band = (n: number) => (n < 5 ? 0 : n < 20 ? 1 : n < 100 ? 2 : 3);
export const BAND_RGBA = ['rgba(97,184,214,0.22)', 'rgba(51,148,196,0.32)', 'rgba(26,102,168,0.42)', 'rgba(20,64,133,0.54)'];

export const makeLabel = (r: LocationRow) => [r.vehicles.year, r.vehicles.make, r.vehicles.model].filter(Boolean).join(' ') || 'Vehicle';
export const platformName = (s: string | null) => ({ bat: 'Bring a Trailer', 'barrett-jackson': 'Barrett-Jackson', craigslist: 'Craigslist', facebook_marketplace: 'Facebook Marketplace', mecum: 'Mecum', carsandbids: 'Cars & Bids', 'cars-and-bids': 'Cars & Bids', ebay_motors: 'eBay Motors' } as Record<string, string>)[s ?? ''] ?? (s ?? 'Source unrecorded');

/** Where a ZIP is: its county, then the county's shapes in storage. */
export async function zipBounds(zip: string, signal?: AbortSignal): Promise<[number, number, number, number] | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/us_zctas?select=county_fips&zcta=eq.${zip}`, { signal, headers });
  if (!res.ok) return null;
  const z = (await res.json()) as { county_fips: string }[];
  if (!z.length) return null;
  const g = await fetch(`${SUPABASE_URL}/storage/v1/object/public/map-data/geo/v1/county/${z[0].county_fips}.geojson`, { signal });
  if (!g.ok) return null;
  const fc = (await g.json()) as { features: { id: string; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
  const f = fc.features.find((x) => x.id === zip);
  if (!f) return null;
  const rings = f.geometry.type === 'Polygon' ? (f.geometry.coordinates as number[][][]) : (f.geometry.coordinates as number[][][][]).flat();
  let w = 180, s = 90, e = -180, n = -90;
  for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

export const BOUNDARY_TILES = `${SUPABASE_URL}/storage/v1/object/public/map-data/tiles/v1/{z}/{x}/{y}.pbf`;
