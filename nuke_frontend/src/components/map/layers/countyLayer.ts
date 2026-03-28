import { GeoJsonLayer } from '@deck.gl/layers';
import type { CountyDatum } from '../types';

// US county TopoJSON from Census Bureau via us-atlas (pre-simplified, ~800KB)
const TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';

let _geoCache: GeoJSON.FeatureCollection | null = null;

export async function loadCountyBoundaries(): Promise<GeoJSON.FeatureCollection> {
  if (_geoCache) return _geoCache;

  const topoRes = await fetch(TOPO_URL);
  const topo = await topoRes.json();

  // Convert TopoJSON → GeoJSON using topojson-client
  const { feature } = await import('topojson-client');
  const geo = feature(topo, topo.objects.counties) as unknown as GeoJSON.FeatureCollection;

  _geoCache = geo;
  return geo;
}

// Quantile color ramp: transparent → amber → deep red
const COLOR_RAMP: [number, number, number, number][] = [
  [30, 30, 30, 40],        // 0 — near invisible
  [120, 80, 10, 120],      // 1
  [180, 120, 10, 160],     // 2
  [220, 150, 10, 190],     // 3
  [245, 158, 11, 210],     // 4 — amber
  [250, 120, 10, 225],     // 5
  [255, 80, 10, 240],      // 6
  [255, 40, 10, 250],      // 7 — hot
];

function quantileBreaks(values: number[], n: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let i = 1; i < n; i++) {
    const idx = Math.floor((i / n) * sorted.length);
    breaks.push(sorted[idx]);
  }
  return breaks;
}

function colorForValue(val: number, breaks: number[]): [number, number, number, number] {
  for (let i = 0; i < breaks.length; i++) {
    if (val <= breaks[i]) return COLOR_RAMP[i];
  }
  return COLOR_RAMP[COLOR_RAMP.length - 1];
}

export interface CountyLayerData {
  geojson: GeoJSON.FeatureCollection;
  lookup: Map<string, CountyDatum>;
  breaks: number[];
}

export function prepareCountyData(
  geojson: GeoJSON.FeatureCollection,
  counties: CountyDatum[],
): CountyLayerData {
  const lookup = new Map<string, CountyDatum>();
  const counts: number[] = [];

  for (const c of counties) {
    lookup.set(c.fips, c);
    counts.push(c.count);
  }

  const breaks = quantileBreaks(counts, COLOR_RAMP.length);
  return { geojson, lookup, breaks };
}

export function createCountyLayer(
  layerData: CountyLayerData,
  onHover?: (info: any) => void,
  onClick?: (info: any) => void,
) {
  const { geojson, lookup, breaks } = layerData;

  return new GeoJsonLayer({
    id: 'county-choropleth',
    data: geojson,
    filled: true,
    stroked: true,
    pickable: true,
    getFillColor: (f: any) => {
      const fips = f.id || f.properties?.GEOID || String(f.properties?.id);
      const datum = lookup.get(fips);
      if (!datum) return [20, 20, 20, 15] as [number, number, number, number];
      return colorForValue(datum.count, breaks);
    },
    getLineColor: [60, 60, 60, 80] as [number, number, number, number],
    getLineWidth: 0.5,
    lineWidthMinPixels: 0.3,
    onHover,
    onClick,
    updateTriggers: {
      getFillColor: [lookup, breaks],
    },
  });
}
