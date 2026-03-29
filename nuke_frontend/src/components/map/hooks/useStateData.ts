import { useState, useEffect } from 'react';
import { fetchStateData } from '../mapService';
import type { StateMapData, StateDatum } from '../types';
import { STATE_FIPS } from '../shared';
import { feature } from 'topojson-client';

const TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

let _stateGeoCache: GeoJSON.FeatureCollection | null = null;

async function loadStateBoundaries(): Promise<GeoJSON.FeatureCollection> {
  if (_stateGeoCache) return _stateGeoCache;
  const res = await fetch(TOPO_URL);
  const topo = await res.json();
  const geo = feature(topo, topo.objects.states) as unknown as GeoJSON.FeatureCollection;
  _stateGeoCache = geo;
  return geo;
}

// Re-export for consumers that expect this name
const STATE_FIPS_TO_ABBR = STATE_FIPS;

export interface StateLayerData {
  geojson: GeoJSON.FeatureCollection;
  lookup: Map<string, StateDatum>;
  nameLookup: Map<string, string>; // FIPS → state name from TopoJSON
}

export function useStateData(enabled: boolean, timeStart?: string, timeEnd?: string) {
  const [layerData, setLayerData] = useState<StateLayerData | null>(null);
  const [stats, setStats] = useState<StateMapData['stats'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([loadStateBoundaries(), fetchStateData(timeStart, timeEnd)])
      .then(([geojson, data]) => {
        if (cancelled) return;

        // Build lookup: state abbreviation → datum
        const lookup = new Map<string, StateDatum>();
        for (const s of data.states) {
          lookup.set(s.code, s);
        }

        // Build name lookup from GeoJSON features
        const nameLookup = new Map<string, string>();
        for (const f of geojson.features) {
          const fips = String(f.id || '');
          const name = (f.properties as any)?.name || '';
          if (fips && name) nameLookup.set(fips, name);
        }

        setLayerData({ geojson, lookup, nameLookup });
        setStats(data.stats);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, timeStart, timeEnd]);

  return { layerData, stats, loading, error, STATE_FIPS_TO_ABBR };
}
