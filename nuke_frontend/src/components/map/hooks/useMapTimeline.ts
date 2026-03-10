import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchHistogram } from '../mapService';
import type { HistogramBucket, MapViewState } from '../types';
import { VIEWPORT_DEBOUNCE_MS } from '../constants';

function viewToBbox(vs: MapViewState): [number, number, number, number] {
  const span = 360 / Math.pow(2, vs.zoom);
  const latSpan = span * 0.5;
  return [vs.longitude - span, vs.latitude - latSpan, vs.longitude + span, vs.latitude + latSpan];
}

export function useMapTimeline(viewState: MapViewState, minConfidence: number) {
  const [buckets, setBuckets] = useState<HistogramBucket[]>([]);
  const [timeStart, setTimeStart] = useState<string | undefined>(undefined);
  const [timeEnd, setTimeEnd] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch histogram when viewport changes
  const fetchBuckets = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const bbox = viewToBbox(viewState);
        const result = await fetchHistogram(bbox, minConfidence, timeStart, timeEnd);
        setBuckets(result.buckets);
      } catch {
        // silent fail for histogram
      } finally {
        setLoading(false);
      }
    }, VIEWPORT_DEBOUNCE_MS * 2); // Slower than main data
  }, [viewState.longitude, viewState.latitude, viewState.zoom, minConfidence, timeStart, timeEnd]);

  useEffect(() => {
    fetchBuckets();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [fetchBuckets]);

  // Scrub to a month — sets time_end to end of that month
  const scrubTo = useCallback((monthStr: string | undefined) => {
    if (!monthStr) {
      setTimeEnd(undefined);
      return;
    }
    // monthStr is "YYYY-MM"
    const [y, m] = monthStr.split('-').map(Number);
    const endOfMonth = new Date(y, m, 0, 23, 59, 59); // Last day of month
    setTimeEnd(endOfMonth.toISOString());
  }, []);

  // Window mode — set both start and end
  const setWindow = useCallback((start: string | undefined, end: string | undefined) => {
    setTimeStart(start);
    setTimeEnd(end);
  }, []);

  const clearTimeline = useCallback(() => {
    setTimeStart(undefined);
    setTimeEnd(undefined);
  }, []);

  return {
    buckets,
    timeStart,
    timeEnd,
    loading,
    scrubTo,
    setWindow,
    clearTimeline,
  };
}
