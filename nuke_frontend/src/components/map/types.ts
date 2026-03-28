// Event-centric map types

export interface MapEventPoint {
  observation_id: string;
  vehicle_id: string;
  lng: number;
  lat: number;
  event_type: string;      // listing | sighting | auction | sale
  source: string | null;
  confidence: number;
  precision: string | null; // gps | address | city | region
  observed_at: string;
  location: string | null;
  event_label: string;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  thumbnail: string | null;
  vehicle_status: string | null;
}

export interface MapCluster {
  lng: number;
  lat: number;
  count: number;
  sources: string[];
  event_types: string[];
  avg_confidence: number;
}

export interface MapFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: MapEventPoint | (MapCluster & { cluster: true });
}

export interface MapFeatureCollection {
  type: 'FeatureCollection';
  features: MapFeature[];
  meta: {
    total_matched: number;
    returned: number;
    zoom: number;
    clustered: boolean;
    min_confidence: number;
    bbox: [number, number, number, number];
  };
}

export interface HistogramBucket {
  month: string; // YYYY-MM
  count: number;
}

export interface HistogramResponse {
  buckets: HistogramBucket[];
  meta: { min_confidence: number; bbox: number[] };
}

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export type MapMode = 'points' | 'thermal' | 'county';

export interface CountyDatum {
  fips: string;
  count: number;
  value: number;
  avg: number;
}

export interface CountyMapData {
  level: 'county';
  stats: { totalCount: number; totalValue: number; countyCount: number };
  counties: CountyDatum[];
}
export type ConfidenceTier = 'verified' | 'city' | 'approx';

export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.85) return 'verified';
  if (confidence >= 0.70) return 'city';
  return 'approx';
}

export function getConfidenceLabel(tier: ConfidenceTier): string {
  switch (tier) {
    case 'verified': return 'VERIFIED';
    case 'city':     return 'CITY';
    case 'approx':   return 'APPROX';
  }
}

export interface SidebarState {
  type: 'event-pin' | 'vehicle-detail' | 'org-detail' | 'zip';
  data: Record<string, unknown>;
}

export interface BizPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string | null;
}

export interface ColPin {
  id: string;
  name: string;
  slug: string;
  ig: string | null;
  country: string;
  city: string;
  lat: number;
  lng: number;
  totalInventory: number;
}
