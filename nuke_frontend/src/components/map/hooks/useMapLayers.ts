import { useMemo } from 'react';
import type { MapFeatureCollection, MapMode, BizPin, ColPin } from '../types';
import { createEventPointLayer } from '../layers/eventPointLayer';
import { createClusterLayer } from '../layers/clusterLayer';
import { createBusinessLayer, createCollectionLayer } from '../layers/businessLayer';
import { createHeatmapLayer } from '../layers/heatmapLayer';

interface UseMapLayersParams {
  data: MapFeatureCollection | null;
  zoom: number;
  mode: MapMode;
  showBusinesses: boolean;
  showCollections: boolean;
  businesses: BizPin[];
  collections: ColPin[];
  onEventClick: (info: any) => void;
  onClusterClick: (info: any) => void;
  onBusinessClick: (info: any) => void;
  onCollectionClick: (info: any) => void;
}

export function useMapLayers(params: UseMapLayersParams) {
  return useMemo(() => {
    const layers: any[] = [];

    if (!params.data) return layers;

    const features = params.data.features;
    const isClustered = params.data.meta.clustered;

    if (params.mode === 'thermal') {
      layers.push(createHeatmapLayer(features));
    } else {
      if (isClustered) {
        layers.push(...createClusterLayer(features, params.onClusterClick));
      } else {
        layers.push(...createEventPointLayer(features, params.zoom, params.onEventClick));
      }
    }

    if (params.showBusinesses && params.businesses.length > 0) {
      layers.push(...createBusinessLayer(params.businesses, params.zoom, params.onBusinessClick));
    }
    if (params.showCollections && params.collections.length > 0) {
      layers.push(...createCollectionLayer(params.collections, params.zoom, params.onCollectionClick));
    }

    return layers;
  }, [
    params.data, params.zoom, params.mode,
    params.showBusinesses, params.showCollections,
    params.businesses, params.collections,
    params.onEventClick, params.onClusterClick,
    params.onBusinessClick, params.onCollectionClick,
  ]);
}
