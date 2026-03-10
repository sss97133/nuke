import type { MapViewState } from './types';

export const MAP_FONT = 'Arial, Helvetica, sans-serif';

export const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
export const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

export const INITIAL_VIEW: MapViewState = {
  longitude: -98,
  latitude: 39,
  zoom: 4.5,
  pitch: 0,
  bearing: 0,
};

// Zoom thresholds
export const CLUSTER_ZOOM_MAX = 8;   // Server clusters at or below this zoom
export const LABEL_ZOOM_MIN = 12;    // Show text labels above this zoom

// Confidence defaults
export const DEFAULT_MIN_CONFIDENCE = 0.70;
export const APPROX_MIN_CONFIDENCE = 0.50;

// Colors per event type
export const EVENT_COLORS: Record<string, [number, number, number]> = {
  listing:  [245, 158, 11],   // amber
  sighting: [217, 70, 239],   // purple
  auction:  [59, 130, 246],   // blue
  sale:     [34, 197, 94],    // green
  default:  [200, 200, 200],  // grey
};

// Confidence tier opacity
export const CONFIDENCE_OPACITY: Record<string, number> = {
  verified: 255,   // >= 0.85
  city:     200,   // 0.70-0.84
  approx:   128,   // 0.50-0.69
};

// Business/collection layer colors
export const BIZ_COLOR: [number, number, number] = [20, 184, 166];
export const COLLECTION_COLOR: [number, number, number] = [236, 72, 153];

// Debounce for viewport-driven fetches
export const VIEWPORT_DEBOUNCE_MS = 300;

export const MAX_FEATURES = 5000;
