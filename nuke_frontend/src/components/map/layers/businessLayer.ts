import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { BizPin, ColPin } from '../types';
import { BIZ_COLOR, COLLECTION_COLOR, LABEL_ZOOM_MIN } from '../constants';

export function createBusinessLayer(
  businesses: BizPin[],
  zoom: number,
  onClick: (info: any) => void,
) {
  const layers: any[] = [
    new ScatterplotLayer({
      id: 'businesses',
      data: businesses,
      getPosition: (d: BizPin) => [d.lng, d.lat],
      getRadius: zoom >= 10 ? 80 : 300,
      radiusUnits: 'meters' as const,
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      getFillColor: [...BIZ_COLOR, 200] as [number, number, number, number],
      getLineColor: [255, 255, 255, 80],
      getLineWidth: 1,
      lineWidthUnits: 'pixels' as const,
      stroked: true,
      pickable: true,
      onClick,
    }),
  ];

  if (zoom >= LABEL_ZOOM_MIN) {
    layers.push(
      new TextLayer({
        id: 'biz-labels',
        data: businesses.slice(0, 100),
        getPosition: (d: BizPin) => [d.lng, d.lat],
        getText: (d: BizPin) => d.name,
        getSize: 9,
        getColor: [...BIZ_COLOR, 200] as [number, number, number, number],
        getTextAnchor: 'start' as const,
        getAlignmentBaseline: 'center' as const,
        getPixelOffset: [8, 0],
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: 700,
        billboard: false,
      }),
    );
  }

  return layers;
}

export function createCollectionLayer(
  collections: ColPin[],
  zoom: number,
  onClick: (info: any) => void,
) {
  const layers: any[] = [
    new ScatterplotLayer({
      id: 'collections',
      data: collections,
      getPosition: (d: ColPin) => [d.lng, d.lat],
      getRadius: zoom >= 10 ? 100 : 400,
      radiusUnits: 'meters' as const,
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      getFillColor: [...COLLECTION_COLOR, 200] as [number, number, number, number],
      getLineColor: [255, 255, 255, 80],
      getLineWidth: 1,
      lineWidthUnits: 'pixels' as const,
      stroked: true,
      pickable: true,
      onClick,
    }),
  ];

  if (zoom >= LABEL_ZOOM_MIN) {
    layers.push(
      new TextLayer({
        id: 'collection-labels',
        data: collections.slice(0, 100),
        getPosition: (d: ColPin) => [d.lng, d.lat],
        getText: (d: ColPin) => d.name,
        getSize: 9,
        getColor: [...COLLECTION_COLOR, 200] as [number, number, number, number],
        getTextAnchor: 'start' as const,
        getAlignmentBaseline: 'center' as const,
        getPixelOffset: [8, 0],
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontWeight: 700,
        billboard: false,
      }),
    );
  }

  return layers;
}
