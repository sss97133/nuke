import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchMapData, type MapQueryParams } from '../mapService';
import type { MapFeatureCollection, MapViewState } from '../types';
import { DEFAULT_MIN_CONFIDENCE, VIEWPORT_DEBOUNCE_MS, MAX_FEATURES } from '../constants';

interface UseMapDataParams {
  viewState: MapViewState;
  minConfidence: number;
  timeStart?: string;
  timeEnd?: string;
  source?: string;
  eventType?: string;
  make?: string;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
}

// Calculate bbox from view state (approximation from center + zoom)
function viewToBbox(vs: MapViewState): [number, number, number, number] {
  const span = 360 / Math.pow(2, vs.zoom);
  const latSpan = span * 0.5;
  return [
    vs.longitude - span,   // west
    vs.latitude - latSpan, // south
    vs.longitude + span,   // east
    vs.latitude + latSpan, // north
  ];
}

export function useMapData(params: UseMapDataParams) {
  const [data, setData] = useState<MapFeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const fetch = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // Abort previous in-flight request
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const bbox = viewToBbox(params.viewState);
      const queryParams: MapQueryParams = {
        bbox,
        zoom: Math.round(params.viewState.zoom),
        min_confidence: params.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
        time_start: params.timeStart,
        time_end: params.timeEnd,
        source: params.source,
        event_type: params.eventType,
        make: params.make,
        year_min: params.yearMin,
        year_max: params.yearMax,
        price_min: params.priceMin,
        price_max: params.priceMax,
        limit: MAX_FEATURES,
      };

      setLoading(true);
      setError(null);
      try {
        const result = await fetchMapData(queryParams);
        if (!ctrl.signal.aborted) {
          setData(result);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setLoading(false);
        }
      }
    }, VIEWPORT_DEBOUNCE_MS);
  }, [
    params.viewState.longitude, params.viewState.latitude, params.viewState.zoom,
    params.minConfidence, params.timeStart, params.timeEnd,
    params.source, params.eventType, params.make,
    params.yearMin, params.yearMax, params.priceMin, params.priceMax,
  ]);

  useEffect(() => {
    fetch();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
