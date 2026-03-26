/**
 * useViewHistory — Tracks every vehicle a user views.
 *
 * Both a UX feature (recently viewed) and a data trove (user behavior signals).
 * Stores in localStorage: `nuke:viewHistory` — array of last 500 views.
 *
 * Deduplication: if same vehicle viewed within 5 min, update duration instead
 * of adding a new entry.
 *
 * TODO: When auth exists, POST view events to a `vehicle_views` table.
 * This becomes the recommendation engine's training data.
 * For now, localStorage only.
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { usePersistedState } from './usePersistedState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViewSource = 'feed' | 'search' | 'popup' | 'profile' | 'browse';

export interface ViewEntry {
  vehicleId: string;
  timestamp: number;
  source: ViewSource;
  duration_ms: number;
  /** Price at the time of viewing (for price-drop detection on return visits) */
  priceAtView?: number | null;
}

export interface ViewHistoryData {
  views: ViewEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'nuke:viewHistory';
const MAX_ENTRIES = 500;
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const EMPTY_HISTORY: ViewHistoryData = { views: [] };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useViewHistory() {
  const [data, setData] = usePersistedState<ViewHistoryData>(STORAGE_KEY, EMPTY_HISTORY);

  // Track active view sessions for duration measurement
  const activeViewsRef = useRef<Map<string, number>>(new Map());

  /**
   * Record a vehicle view. If same vehicle was viewed within 5 minutes,
   * updates duration instead of adding a new entry.
   *
   * @param priceAtView — optional display_price at view time (for price-drop detection)
   */
  const recordView = useCallback(
    (vehicleId: string, source: ViewSource, priceAtView?: number | null) => {
      if (!vehicleId) return;

      const now = Date.now();

      // Start tracking duration for this view
      activeViewsRef.current.set(vehicleId, now);

      setData((prev) => {
        const views = [...prev.views];
        const lastIdx = views.findIndex((v) => v.vehicleId === vehicleId);

        // Dedup: if same vehicle viewed within 5 min, update duration
        if (lastIdx !== -1) {
          const last = views[lastIdx];
          const elapsed = now - last.timestamp;
          if (elapsed < DEDUP_WINDOW_MS) {
            views[lastIdx] = {
              ...last,
              duration_ms: last.duration_ms + elapsed,
              source, // update source to latest
              // Only overwrite price if we have a newer one
              priceAtView: priceAtView ?? last.priceAtView,
            };
            return { views };
          }
        }

        // New entry — prepend and cap at MAX_ENTRIES
        const entry: ViewEntry = {
          vehicleId,
          timestamp: now,
          source,
          duration_ms: 0,
          priceAtView: priceAtView ?? null,
        };

        const updated = [entry, ...views].slice(0, MAX_ENTRIES);
        return { views: updated };
      });
    },
    [setData],
  );

  /**
   * End a view session — records final duration for the vehicle.
   * Call when popup closes, user navigates away, etc.
   */
  const endView = useCallback(
    (vehicleId: string) => {
      const startTime = activeViewsRef.current.get(vehicleId);
      if (!startTime) return;

      const duration = Date.now() - startTime;
      activeViewsRef.current.delete(vehicleId);

      setData((prev) => {
        const views = [...prev.views];
        const idx = views.findIndex((v) => v.vehicleId === vehicleId);
        if (idx !== -1) {
          views[idx] = {
            ...views[idx],
            duration_ms: views[idx].duration_ms + duration,
          };
        }
        return { views };
      });
    },
    [setData],
  );

  /** Get all view history entries (most recent first). */
  const getHistory = useCallback(() => data.views, [data.views]);

  /** Get the last N recently viewed vehicles (unique by vehicleId). */
  const getRecentlyViewed = useCallback(
    (limit = 20): ViewEntry[] => {
      const seen = new Set<string>();
      const result: ViewEntry[] = [];
      for (const entry of data.views) {
        if (!seen.has(entry.vehicleId)) {
          seen.add(entry.vehicleId);
          result.push(entry);
          if (result.length >= limit) break;
        }
      }
      return result;
    },
    [data.views],
  );

  /** Get the most frequently viewed vehicles. */
  const getMostViewed = useCallback(
    (limit = 10): { vehicleId: string; count: number; totalDuration: number }[] => {
      const counts = new Map<string, { count: number; totalDuration: number }>();
      for (const entry of data.views) {
        const existing = counts.get(entry.vehicleId) || { count: 0, totalDuration: 0 };
        counts.set(entry.vehicleId, {
          count: existing.count + 1,
          totalDuration: existing.totalDuration + entry.duration_ms,
        });
      }
      return Array.from(counts.entries())
        .map(([vehicleId, stats]) => ({ vehicleId, ...stats }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    },
    [data.views],
  );

  /** Get the total view count for a specific vehicle. */
  const getViewCount = useCallback(
    (vehicleId: string): number => {
      return data.views.filter((v) => v.vehicleId === vehicleId).length;
    },
    [data.views],
  );

  /** Check if a vehicle has been viewed. */
  const hasViewed = useCallback(
    (vehicleId: string): boolean => {
      return data.views.some((v) => v.vehicleId === vehicleId);
    },
    [data.views],
  );

  /** Set of all viewed vehicle IDs (for fast lookups). */
  const viewedIds = useMemo(() => {
    const set = new Set<string>();
    for (const entry of data.views) {
      set.add(entry.vehicleId);
    }
    return set;
  }, [data.views]);

  /** Get stats about today's viewing behavior. */
  const todayStats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const todayViews = data.views.filter((v) => v.timestamp >= todayMs);
    const uniqueVehicles = new Set(todayViews.map((v) => v.vehicleId));

    // Count makes from vehicleIds (we don't have make data here,
    // but consumers can cross-reference with vehicle data)
    return {
      viewCount: todayViews.length,
      uniqueCount: uniqueVehicles.size,
      vehicleIds: Array.from(uniqueVehicles),
    };
  }, [data.views]);

  /** Get all viewed vehicles that had a recorded price (for price-drop detection). */
  const getViewedWithPrices = useCallback(
    (): { vehicleId: string; priceAtView: number; timestamp: number }[] => {
      const seen = new Set<string>();
      const result: { vehicleId: string; priceAtView: number; timestamp: number }[] = [];
      for (const entry of data.views) {
        if (!seen.has(entry.vehicleId) && entry.priceAtView && entry.priceAtView > 0) {
          seen.add(entry.vehicleId);
          result.push({
            vehicleId: entry.vehicleId,
            priceAtView: entry.priceAtView,
            timestamp: entry.timestamp,
          });
        }
      }
      return result;
    },
    [data.views],
  );

  /** Clear all view history. */
  const clearHistory = useCallback(() => {
    setData(EMPTY_HISTORY);
  }, [setData]);

  // Cleanup active views on unmount
  useEffect(() => {
    return () => {
      activeViewsRef.current.clear();
    };
  }, []);

  return {
    recordView,
    endView,
    getHistory,
    getRecentlyViewed,
    getMostViewed,
    getViewCount,
    hasViewed,
    getViewedWithPrices,
    viewedIds,
    todayStats,
    clearHistory,
    /** Total number of views ever recorded. */
    totalViews: data.views.length,
  };
}
