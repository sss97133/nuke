import { supabase } from '../../lib/supabase';
import type { MapFeatureCollection, HistogramResponse } from './types';

const BASE_URL = import.meta.env.VITE_SUPABASE_URL;

async function mapFetch<T>(params: Record<string, string | number | undefined>): Promise<T> {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const qs = new URLSearchParams(filtered as Record<string, string>).toString();
  const url = `${BASE_URL}/functions/v1/map-vehicles?${qs}`;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`map-vehicles ${res.status}: ${body}`);
  }

  return res.json();
}

export interface MapQueryParams {
  bbox: [number, number, number, number]; // [west, south, east, north]
  zoom: number;
  min_confidence?: number;
  time_start?: string;
  time_end?: string;
  source?: string;
  event_type?: string;
  make?: string;
  year_min?: number;
  year_max?: number;
  price_min?: number;
  price_max?: number;
  limit?: number;
}

export async function fetchMapData(params: MapQueryParams): Promise<MapFeatureCollection> {
  return mapFetch<MapFeatureCollection>({
    bbox: params.bbox.join(','),
    zoom: params.zoom,
    min_confidence: params.min_confidence,
    time_start: params.time_start,
    time_end: params.time_end,
    source: params.source,
    event_type: params.event_type,
    make: params.make,
    year_min: params.year_min,
    year_max: params.year_max,
    price_min: params.price_min,
    price_max: params.price_max,
    limit: params.limit,
  });
}

export async function fetchHistogram(
  bbox: [number, number, number, number],
  minConfidence?: number,
  timeStart?: string,
  timeEnd?: string,
): Promise<HistogramResponse> {
  return mapFetch<HistogramResponse>({
    mode: 'histogram',
    bbox: bbox.join(','),
    min_confidence: minConfidence,
    time_start: timeStart,
    time_end: timeEnd,
  });
}

export async function fetchCountyData(
  timeStart?: string,
  timeEnd?: string,
): Promise<import('./types').CountyMapData> {
  // NOTE: The backend RPC (get_vehicle_map_data) uses a materialized view and does NOT
  // support time_start/time_end filtering in county mode yet. Params are passed through
  // but will be ignored until a temporal county query path is added to the edge function.
  return mapFetch<import('./types').CountyMapData>({
    mode: 'county',
    time_start: timeStart,
    time_end: timeEnd,
  });
}

export async function fetchStateData(
  timeStart?: string,
  timeEnd?: string,
): Promise<import('./types').StateMapData> {
  // NOTE: Same materialized view limitation as fetchCountyData above.
  return mapFetch<import('./types').StateMapData>({
    mode: 'state',
    time_start: timeStart,
    time_end: timeEnd,
  });
}

export async function fetchMakeHeatmap(make: string): Promise<import('./types').MakeHeatmapData> {
  const { data, error } = await supabase.rpc('get_make_heatmap', { p_make: make });
  if (error) throw new Error(`get_make_heatmap: ${error.message}`);
  return data as import('./types').MakeHeatmapData;
}

// Utility kept from old mapUtils — used by MapVehicleDetail
export function thumbUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.includes('/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=280&height=160&quality=80&resize=cover';
  }
  return url;
}
