import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { MapFeature } from '../types';
import { EVENT_COLORS } from '../constants';

interface ClusterProps {
  cluster: true;
  count: number;
  sources: string[];
  event_types: string[];
  avg_confidence: number;
}

function getClusters(features: MapFeature[]) {
  return features.filter(f => 'cluster' in f.properties && f.properties.cluster) as
    (MapFeature & { properties: ClusterProps })[];
}

function clusterRadius(count: number): number {
  return Math.max(15, Math.min(60, Math.sqrt(count) * 3));
}

function clusterColor(eventTypes: string[]): [number, number, number] {
  if (eventTypes.length === 1 && EVENT_COLORS[eventTypes[0]]) {
    return EVENT_COLORS[eventTypes[0]];
  }
  // Mixed events → amber default
  return EVENT_COLORS.listing;
}

export function createClusterLayer(
  features: MapFeature[],
  onClick: (info: any) => void,
) {
  const clusters = getClusters(features);

  return [
    new ScatterplotLayer({
      id: 'clusters',
      data: clusters,
      getPosition: (d: any) => d.geometry.coordinates,
      getRadius: (d: any) => clusterRadius(d.properties.count),
      radiusUnits: 'pixels' as const,
      getFillColor: (d: any) => [...clusterColor(d.properties.event_types), 180] as [number, number, number, number],
      getLineColor: [255, 255, 255, 100],
      getLineWidth: 1,
      lineWidthUnits: 'pixels' as const,
      stroked: true,
      pickable: true,
      onClick,
    }),
    new TextLayer({
      id: 'cluster-counts',
      data: clusters,
      getPosition: (d: any) => d.geometry.coordinates,
      getText: (d: any) => {
        const c = d.properties.count;
        return c >= 1000 ? `${(c / 1000).toFixed(1)}k` : String(c);
      },
      getSize: 11,
      getColor: [255, 255, 255, 240],
      fontFamily: 'Courier New, monospace',
      fontWeight: 700,
      getTextAnchor: 'middle' as const,
      getAlignmentBaseline: 'center' as const,
      billboard: false,
    }),
  ];
}
