import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { MapFeature, MapEventPoint } from '../types';
import { getConfidenceTier } from '../types';
import { EVENT_COLORS, CONFIDENCE_OPACITY, LABEL_ZOOM_MIN } from '../constants';

// Filter to non-cluster features
function getEventPoints(features: MapFeature[]): (MapFeature & { properties: MapEventPoint })[] {
  return features.filter(f => !('cluster' in f.properties)) as any;
}

export function createEventPointLayer(
  features: MapFeature[],
  zoom: number,
  onClick: (info: any) => void,
) {
  const points = getEventPoints(features);

  const layers = [
    new ScatterplotLayer({
      id: 'event-points',
      data: points,
      getPosition: (d: any) => d.geometry.coordinates,
      getRadius: () => zoom >= 12 ? 60 : zoom >= 8 ? 200 : 400,
      radiusUnits: 'meters' as const,
      radiusMinPixels: 3,
      radiusMaxPixels: 12,
      getFillColor: (d: any) => {
        const p = d.properties as MapEventPoint;
        const color = EVENT_COLORS[p.event_type] || EVENT_COLORS.default;
        const tier = getConfidenceTier(p.confidence);
        const alpha = CONFIDENCE_OPACITY[tier];
        return [...color, alpha] as [number, number, number, number];
      },
      getLineColor: [255, 255, 255, 60],
      getLineWidth: 1,
      lineWidthUnits: 'pixels' as const,
      stroked: zoom >= 10,
      pickable: true,
      onClick,
      updateTriggers: {
        getFillColor: [zoom],
        getRadius: [zoom],
      },
    }),
  ];

  // Text labels at high zoom
  if (zoom >= LABEL_ZOOM_MIN) {
    layers.push(
      new TextLayer({
        id: 'event-labels',
        data: points.slice(0, 200), // Limit labels for performance
        getPosition: (d: any) => d.geometry.coordinates,
        getText: (d: any) => {
          const p = d.properties as MapEventPoint;
          return [p.year, p.make, p.model].filter(Boolean).join(' ');
        },
        getSize: 10,
        getColor: [255, 255, 255, 200],
        getAngle: 0,
        getTextAnchor: 'start' as const,
        getAlignmentBaseline: 'center' as const,
        getPixelOffset: [8, 0],
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: 700,
        billboard: false,
      }) as any,
    );
  }

  return layers;
}
