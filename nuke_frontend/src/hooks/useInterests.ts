/**
 * useInterests — Interest memory system backed by localStorage.
 *
 * Tracks which makes and models the user clicks/browses, building
 * a lightweight preference profile. No auth required, no backend.
 *
 * Storage key: `nuke:interests`
 * Structure: { makes: { "PORSCHE": 5 }, models: { "911": 4 }, priceRange: [lo, hi], lastVisit: timestamp }
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { usePersistedState } from './usePersistedState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InterestData {
  makes: Record<string, number>;
  models: Record<string, number>;
  priceRange: [number, number] | null;
  lastVisit: number;
}

export interface InterestEntry {
  name: string;
  count: number;
}

const STORAGE_KEY = 'nuke:interests';

const EMPTY_INTERESTS: InterestData = {
  makes: {},
  models: {},
  priceRange: null,
  lastVisit: Date.now(),
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInterests() {
  const [data, setData] = usePersistedState<InterestData>(STORAGE_KEY, EMPTY_INTERESTS);
  const prevVisitRef = useRef(data.lastVisit);

  // Capture the previous lastVisit before we update it
  useEffect(() => {
    prevVisitRef.current = data.lastVisit;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Record an interest — increment the counter for a make or model
  const recordInterest = useCallback(
    (type: 'make' | 'model', value: string) => {
      if (!value) return;
      const key = value.toUpperCase();
      setData((prev) => {
        const bucket = type === 'make' ? 'makes' : 'models';
        return {
          ...prev,
          [bucket]: {
            ...prev[bucket],
            [key]: (prev[bucket][key] || 0) + 1,
          },
          lastVisit: Date.now(),
        };
      });
    },
    [setData],
  );

  // Record a price range the user browsed
  const recordPriceRange = useCallback(
    (min: number, max: number) => {
      setData((prev) => {
        const existing = prev.priceRange;
        if (!existing) {
          return { ...prev, priceRange: [min, max], lastVisit: Date.now() };
        }
        // Expand the range
        return {
          ...prev,
          priceRange: [Math.min(existing[0], min), Math.max(existing[1], max)],
          lastVisit: Date.now(),
        };
      });
    },
    [setData],
  );

  // Update lastVisit timestamp (called on mount to mark "return visit" boundary)
  const touchLastVisit = useCallback(() => {
    setData((prev) => ({ ...prev, lastVisit: Date.now() }));
  }, [setData]);

  // Top makes sorted by count descending
  const topMakes = useMemo((): InterestEntry[] => {
    return Object.entries(data.makes)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [data.makes]);

  // Top models sorted by count descending
  const topModels = useMemo((): InterestEntry[] => {
    return Object.entries(data.models)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [data.models]);

  // Whether user has any recorded interests
  const hasInterests = useMemo(
    () => Object.keys(data.makes).length > 0 || Object.keys(data.models).length > 0,
    [data.makes, data.models],
  );

  // The previous lastVisit (before this session updated it)
  const previousVisit = prevVisitRef.current;

  // Clear all interests
  const clearInterests = useCallback(() => {
    setData(EMPTY_INTERESTS);
  }, [setData]);

  return {
    data,
    recordInterest,
    recordPriceRange,
    touchLastVisit,
    topMakes,
    topModels,
    hasInterests,
    previousVisit,
    clearInterests,
  };
}
