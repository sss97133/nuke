import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { MapFeature } from '../types';

export function createHeatmapLayer(features: MapFeature[]) {
  // Use all features (both clusters and points) for heatmap
  return new HeatmapLayer({
    id: 'heatmap',
    data: features,
    getPosition: (d: any) => d.geometry.coordinates,
    getWeight: (d: any) => ('cluster' in d.properties && d.properties.cluster) ? d.properties.count : 1,
    radiusPixels: 40,
    intensity: 1.5,
    threshold: 0.05,
    colorRange: [
      [0, 0, 0, 0],
      [245, 158, 11, 40],
      [245, 158, 11, 100],
      [245, 130, 11, 160],
      [245, 100, 11, 200],
      [255, 60, 10, 240],
    ],
  });
}
