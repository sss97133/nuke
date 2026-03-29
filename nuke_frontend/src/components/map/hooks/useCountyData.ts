import { useState, useEffect } from 'react';
import { fetchCountyData } from '../mapService';
import { loadCountyBoundaries, prepareCountyData, type CountyLayerData } from '../layers/countyLayer';
import type { CountyMapData } from '../types';

export function useCountyData(enabled: boolean, timeStart?: string, timeEnd?: string) {
  const [layerData, setLayerData] = useState<CountyLayerData | null>(null);
  const [stats, setStats] = useState<CountyMapData['stats'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([loadCountyBoundaries(), fetchCountyData(timeStart, timeEnd)])
      .then(([geojson, data]) => {
        if (cancelled) return;
        const prepared = prepareCountyData(geojson, data.counties);
        setLayerData(prepared);
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

  return { layerData, stats, loading, error };
}
