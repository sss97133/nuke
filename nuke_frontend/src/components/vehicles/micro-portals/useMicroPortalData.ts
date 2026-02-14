import { useState, useEffect, useRef } from 'react';

/**
 * Three portal data states:
 * - empty: no data at all → show invitation
 * - sparse: 1-2 data points → static display with context
 * - rich: 3+ data points → full visualization
 */
export type PortalDataState = 'empty' | 'sparse' | 'rich';

export interface MicroPortalDataResult<T> {
  data: T | null;
  state: PortalDataState;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

interface CacheEntry<T> {
  data: T;
  state: PortalDataState;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const DEFAULT_CACHE_TTL = 60_000; // 60s

/**
 * Generic async data fetcher for MicroPortals.
 *
 * @param cacheKey - Unique key for caching (e.g. "year-stats-2025")
 * @param fetcher - Async function that returns the data
 * @param classifier - Determines empty/sparse/rich from the data
 * @param enabled - Only fetch when true (e.g. when portal is open)
 * @param cacheTtl - Cache TTL in ms (default 60s)
 */
export function useMicroPortalData<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  classifier: (data: T) => PortalDataState,
  enabled: boolean = true,
  cacheTtl: number = DEFAULT_CACHE_TTL,
): MicroPortalDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<PortalDataState>('empty');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const doFetch = () => {
    if (!enabled) return;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTtl) {
      setData(cached.data);
      setState(cached.state);
      setIsLoading(false);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (fetchIdRef.current !== fetchId) return; // stale
        const s = classifier(result);
        cache.set(cacheKey, { data: result, state: s, timestamp: Date.now() });
        setData(result);
        setState(s);
      })
      .catch((err) => {
        if (fetchIdRef.current !== fetchId) return;
        setError(err?.message || 'Failed to load');
      })
      .finally(() => {
        if (fetchIdRef.current !== fetchId) return;
        setIsLoading(false);
      });
  };

  useEffect(() => {
    doFetch();
  }, [cacheKey, enabled]);

  return { data, state, isLoading, error, refetch: doFetch };
}

/** Invalidate a specific cache key */
export function invalidatePortalCache(key: string) {
  cache.delete(key);
}

/** Clear all portal cache */
export function clearPortalCache() {
  cache.clear();
}
