import { SUPABASE_URL } from '../../lib/env';

type Position = [number, number];
type Polygon = { type: 'Polygon'; coordinates: Position[][] };
type MultiPolygon = { type: 'MultiPolygon'; coordinates: Position[][][] };
export type ZipAreaFeature = {
  type: 'Feature';
  id?: string | number;
  properties: { GEOID?: string; [key: string]: unknown };
  geometry: Polygon | MultiPolygon;
};

export type ZipMapReading = {
  key: string;
  status: string;
  value: unknown;
};

type ZipMapValue = {
    zcta?: string | null;
    label?: string | null;
    bounds?: { geojson?: string | null; county_fips?: string | null } | null;
};

export function zipAreaRequest(reading: ZipMapReading): { zip: string; path: string; countyFips: string; label: string } | null {
  const value = reading.value && typeof reading.value === 'object' ? reading.value as ZipMapValue : null;
  const zip = value?.zcta;
  const countyFips = value?.bounds?.county_fips;
  const path = value?.bounds?.geojson;
  if (reading.key !== 'location.map' || reading.status !== 'reading'
      || !zip || !/^\d{5}$/.test(zip) || !countyFips || !/^\d{5}$/.test(countyFips)
      || path !== `map-data/geo/v1/county/${countyFips}.geojson`) return null;
  return { zip, path, countyFips, label: value?.label || `ZIP ${zip}` };
}

export function selectZipArea(data: unknown, zip: string): ZipAreaFeature | null {
  if (!/^\d{5}$/.test(zip) || !data || typeof data !== 'object' || !('features' in data)
      || !Array.isArray(data.features)) return null;
  for (const raw of data.features) {
    if (!raw || typeof raw !== 'object' || raw.type !== 'Feature') continue;
    if (String(raw.id ?? raw.properties?.GEOID ?? '') !== zip) continue;
    if (raw.geometry?.type !== 'Polygon' && raw.geometry?.type !== 'MultiPolygon') return null;
    const feature = raw as ZipAreaFeature;
    return zipAreaBounds(feature) ? feature : null;
  }
  return null;
}

export function zipAreaBounds(feature: ZipAreaFeature): [number, number, number, number] | null {
  const geometry = feature?.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  const polygons: unknown[] = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  if (!polygons.length) return null;
  let west = 180, south = 90, east = -180, north = -90, count = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      for (const point of ring) {
        if (!Array.isArray(point) || point.length !== 2) return null;
        const [lon, lat] = point;
        if (typeof lon !== 'number' || typeof lat !== 'number'
          || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
        west = Math.min(west, lon); east = Math.max(east, lon);
        south = Math.min(south, lat); north = Math.max(north, lat); count += 1;
      }
    }
  }
  return count >= 3 && west < east && south < north ? [west, south, east, north] : null;
}

export async function loadZipArea(path: string, zip: string, signal?: AbortSignal): Promise<{ feature: ZipAreaFeature; bounds: [number, number, number, number] }> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${path}`, { signal });
  if (!response.ok) throw new Error('ZIP area geometry is unavailable');
  const feature = selectZipArea(await response.json(), zip);
  const bounds = feature && zipAreaBounds(feature);
  if (!feature || !bounds) throw new Error(`ZIP ${zip} has no mapped area`);
  return { feature, bounds };
}
