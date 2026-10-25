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
  type ImageFit,
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
  /** Image fit mode */
  imageFit: ImageFit;
  /** Whether any non-default filters are active */
  hasActiveFilters: boolean;

  /** Replace filters, optionally applying a preset sort in the same URL update. */
  setFilters: (filters: FilterState, sortBy?: SortBy) => void;
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
  /** Set image fit mode */
  setImageFit: (fit: ImageFit) => void;
  /** Reset all filters/sort to defaults */
  resetAll: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Feed state shares the home URL with its tab. Keep the caller's view when
 * replacing filters, including a reset back to default filter values. */
function paramsInCurrentView(state: FeedUrlState, current: URLSearchParams, defaultCardsPerRow: number): URLSearchParams {
  const next = serializeToUrl(state);
  const tab = current.get('tab');
  if (tab) next.set('tab', tab);
  // A chosen desktop-default 3 must remain explicit when a phone defaults to 2.
  // Keep previous explicit choices shareable across viewport changes as well.
  if (state.cardsPerRow !== defaultCardsPerRow || current.has('cols')) next.set('cols', String(state.cardsPerRow));
  return next;
}

export function useFeedSearchParams(defaultCardsPerRow = 3): FeedSearchParamsResult {
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
          cardsPerRow: defaultCardsPerRow,
          imageFit: 'auto',
        };

        const newParams = paramsInCurrentView(state, searchParams, defaultCardsPerRow);
        if (newParams.toString()) {
          setSearchParams(newParams, { replace: true });
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Derive current state from URL ---
  const currentState = useMemo(
    () => deserializeFromUrl(searchParams, defaultCardsPerRow),
    [searchParams, defaultCardsPerRow],
  );

  const { filters, sortBy, sortDirection, searchText, viewMode, cardsPerRow, imageFit } = currentState;

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
      (filters.includedSources?.length ?? 0) > 0 ||
      filters.zipCode !== '' ||
      filters.showPending !== d.showPending ||
      searchText !== '' ||
      (sortBy !== 'newest' && sortBy !== 'popular') ||
      sortDirection !== 'desc'
    );
  }, [filters, searchText, sortBy, sortDirection]);

  // --- Push state to URL ---
  const pushState = useCallback(
    (newState: FeedUrlState) => {
      if (urlStatesEqual(currentState, newState)) return;
      setSearchParams(paramsInCurrentView(newState, searchParams, defaultCardsPerRow), { replace: true });
    },
    [currentState, searchParams, setSearchParams, defaultCardsPerRow],
  );

  // A pending search owns only its text. Read the latest committed selections
  // when it fires, instead of restoring the full URL snapshot from keystroke time.
  const latestMutationRef = useRef({ currentState, pushState });
  useEffect(() => {
    latestMutationRef.current = { currentState, pushState };
  }, [currentState, pushState]);

  // --- Mutation helpers ---

  const setFilters = useCallback(
    (newFilters: FilterState, sortBy?: SortBy) => {
      pushState({ ...currentState, filters: newFilters,
        ...(sortBy ? { sortBy, sortDirection: sortBy === 'make' || sortBy === 'model' ? 'asc' : 'desc' } : {}),
      });
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

  const setSearchText = useCallback((text: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const latest = latestMutationRef.current;
      latest.pushState({ ...latest.currentState, searchText: text });
    }, 150);
  }, []);

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

  const setImageFit = useCallback(
    (fit: ImageFit) => {
      pushState({ ...currentState, imageFit: fit });
      // Persist to shared localStorage so other views (auctions tab, etc.) stay in sync
      try { localStorage.setItem('nuke_imageFit', fit); } catch {}
    },
    [currentState, pushState],
  );

  const resetAll = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
    pushState({
      filters: DEFAULT_FILTERS,
      sortBy: 'newest',
      sortDirection: 'desc',
      searchText: '',
      viewMode: 'grid',
      cardsPerRow: defaultCardsPerRow,
      imageFit: 'auto',
    });
  }, [pushState, defaultCardsPerRow]);

  // --- Cleanup debounce on unmount ---
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    };
  }, []);

  return {
    filters,
    sortBy,
    sortDirection,
    searchText,
    viewMode,
    cardsPerRow,
    imageFit,
    hasActiveFilters,
    setFilters,
    updateFilters,
    setSortBy,
    setSortDirection,
    setSearchText,
    setViewMode,
    setCardsPerRow,
    setImageFit,
    resetAll,
  };
}
