/**
 * useFeedSearchParams.ts
 *
 * The keystone hook for the new feed system. Synchronizes feed state
 * (filters, sort, search, view config) with URL search params.
 *
 * URL is the source of truth. All state derives from useSearchParams().
 * Mutations push to the URL (replace: true to avoid history spam).
 *
 * On first load with a clean URL, optionally hydrates from localStorage
 * (if the user has "remember filters" enabled from the legacy system).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FilterState, SortBy, SortDirection, ViewMode } from '../../types/feedTypes';
import { DEFAULT_FILTERS, getRememberFilters, loadSavedFilters } from '../../lib/filterPersistence';
import {
  deserializeFromUrl,
  serializeToUrl,
  urlHasFeedParams,
  urlStatesEqual,
  type FeedUrlState,
} from '../utils/feedUrlCodec';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface FeedSearchParamsResult {
  /** Current filter state (derived from URL) */
  filters: FilterState;
  /** Current sort field */
  sortBy: SortBy;
  /** Current sort direction */
  sortDirection: SortDirection;
  /** Current search text */
  searchText: string;
  /** Current view mode */
  viewMode: ViewMode;
  /** Cards per row */
  cardsPerRow: number;
  /** Whether any non-default filters are active */
  hasActiveFilters: boolean;

  /** Replace the full filter state */
  setFilters: (filters: FilterState) => void;
  /** Merge partial filter changes */
  updateFilters: (partial: Partial<FilterState>) => void;
  /** Set sort field (resets to desc for most fields) */
  setSortBy: (sortBy: SortBy) => void;
  /** Set sort direction */
  setSortDirection: (dir: SortDirection) => void;
  /** Set search text (debounced internally) */
  setSearchText: (text: string) => void;
  /** Set view mode */
  setViewMode: (mode: ViewMode) => void;
  /** Set cards per row */
  setCardsPerRow: (cols: number) => void;
  /** Reset all filters/sort to defaults */
  resetAll: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFeedSearchParams(): FeedSearchParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const hydratedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Hydrate from localStorage on first load if URL is clean ---
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    if (!urlHasFeedParams(searchParams) && getRememberFilters()) {
      const saved = loadSavedFilters();
      if (saved) {
        const legacySortBy = (localStorage.getItem('nuke_homepage_sortBy') as SortBy) || 'newest';
        const legacySortDir = (localStorage.getItem('nuke_homepage_sortDirection') as SortDirection) || 'desc';
        const legacySearch = localStorage.getItem('nuke_homepage_searchText') || '';

        const state: FeedUrlState = {
          filters: saved,
          sortBy: legacySortBy,
          sortDirection: legacySortDir,
          searchText: legacySearch,
          viewMode: 'grid',
          cardsPerRow: 6,
        };

        const newParams = serializeToUrl(state);
        if (newParams.toString()) {
          setSearchParams(newParams, { replace: true });
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Derive current state from URL ---
  const currentState = useMemo(
    () => deserializeFromUrl(searchParams),
    [searchParams],
  );

  const { filters, sortBy, sortDirection, searchText, viewMode, cardsPerRow } = currentState;

  // --- Check if any non-default filters are active ---
  const hasActiveFilters = useMemo(() => {
    const d = DEFAULT_FILTERS;
    return (
      filters.yearMin !== d.yearMin ||
      filters.yearMax !== d.yearMax ||
      filters.makes.length > 0 ||
      filters.models.length > 0 ||
      filters.bodyStyles.length > 0 ||
      filters.is4x4 !== d.is4x4 ||
      filters.priceMin !== d.priceMin ||
      filters.priceMax !== d.priceMax ||
      filters.hasImages !== d.hasImages ||
      filters.addedTodayOnly !== d.addedTodayOnly ||
      filters.forSale !== d.forSale ||
      filters.hideSold !== d.hideSold ||
      filters.showSoldOnly !== d.showSoldOnly ||
      filters.privateParty !== d.privateParty ||
      filters.dealer !== d.dealer ||
      filters.hideCraigslist !== d.hideCraigslist ||
      filters.hideKsl !== d.hideKsl ||
      filters.hideBat !== d.hideBat ||
      filters.hideClassic !== d.hideClassic ||
      filters.hideDealerListings !== d.hideDealerListings ||
      filters.hideDealerSites !== d.hideDealerSites ||
      (filters.hiddenSources?.length ?? 0) > 0 ||
      filters.zipCode !== '' ||
      filters.showPending !== d.showPending ||
      searchText !== '' ||
      (sortBy !== 'popular' && sortBy !== 'newest') ||
      sortDirection !== 'desc'
    );
  }, [filters, searchText, sortBy, sortDirection]);

  // --- Push state to URL ---
  const pushState = useCallback(
    (newState: FeedUrlState, debounceMs?: number) => {
      const update = () => {
        if (urlStatesEqual(currentState, newState)) return;
        setSearchParams(serializeToUrl(newState), { replace: true });
      };

      if (debounceMs && debounceMs > 0) {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(update, debounceMs);
      } else {
        update();
      }
    },
    [currentState, setSearchParams],
  );

  // --- Mutation helpers ---

  const setFilters = useCallback(
    (newFilters: FilterState) => {
      pushState({ ...currentState, filters: newFilters });
    },
    [currentState, pushState],
  );

  const updateFilters = useCallback(
    (partial: Partial<FilterState>) => {
      pushState({ ...currentState, filters: { ...currentState.filters, ...partial } });
    },
    [currentState, pushState],
  );

  const setSortBy = useCallback(
    (newSort: SortBy) => {
      // Reset direction to desc for most sort fields (ascending for alphabetical)
      const alphaFields: Set<SortBy> = new Set(['make', 'model']);
      const newDir: SortDirection = alphaFields.has(newSort) ? 'asc' : 'desc';
      pushState({ ...currentState, sortBy: newSort, sortDirection: newDir });
    },
    [currentState, pushState],
  );

  const setSortDirection = useCallback(
    (dir: SortDirection) => {
      pushState({ ...currentState, sortDirection: dir });
    },
    [currentState, pushState],
  );

  const setSearchText = useCallback(
    (text: string) => {
      // Debounce text input to avoid URL thrashing
      pushState({ ...currentState, searchText: text }, 150);
    },
    [currentState, pushState],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      pushState({ ...currentState, viewMode: mode });
    },
    [currentState, pushState],
  );

  const setCardsPerRow = useCallback(
    (cols: number) => {
      const clamped = Math.max(1, Math.min(16, cols));
      pushState({ ...currentState, cardsPerRow: clamped });
    },
    [currentState, pushState],
  );

  const resetAll = useCallback(() => {
    pushState({
      filters: DEFAULT_FILTERS,
      sortBy: 'popular',
      sortDirection: 'desc',
      searchText: '',
      viewMode: 'grid',
      cardsPerRow: 6,
    });
  }, [pushState]);

  // --- Cleanup debounce on unmount ---
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return {
    filters,
    sortBy,
    sortDirection,
    searchText,
    viewMode,
    cardsPerRow,
    hasActiveFilters,
    setFilters,
    updateFilters,
    setSortBy,
    setSortDirection,
    setSearchText,
    setViewMode,
    setCardsPerRow,
    resetAll,
  };
}
