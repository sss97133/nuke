import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { readCachedSession } from '../utils/cachedSession';
import { usePageTitle } from '../hooks/usePageTitle';
import { useStatsPanelData } from '../hooks/useStatsPanelData';
import { useFeedFilterOptions } from '../hooks/useFeedFilterOptions';
import { useDbStats } from '../hooks/useDbStats';
import { useFeedSources } from '../hooks/useFeedSources';
import { useFilteredDbStats } from '../hooks/useFilteredDbStats';
import { parseMoneyNumber } from '../lib/auctionUtils';
import { preloadImageBatch } from '../lib/imageOptimizer';
import ActiveAuctionsPanel from '../components/dashboard/ActiveAuctionsPanel';
import FBMarketplacePanel from '../components/dashboard/FBMarketplacePanel';
import RecentlyAddedPanel from '../components/dashboard/RecentlyAddedPanel';
import { deriveDealScoreLabel } from '../constants/dealScore';
import { FeedStatsBar, FeedGrid, StatsPanelOverlay } from '../components/feed';
import FeedTableView from '../components/feed/FeedTableView';
import ScrollToTopButton from '../components/feed/ScrollToTopButton';
import FeedFilterPanel from '../components/feed/FeedFilterPanel';
import { filterAndSortVehicles } from '../lib/feedFilterSort';
import { computeVehicleStats } from '../lib/feedStatsCalculator';
import { isPoorQualityImage, dedupeVehicles, getDedupeKey } from '../lib/feedDataProcessing';
import type { HypeVehicle, TimePeriod, SalesTimePeriod, ViewMode, SortBy, SortDirection, FilterState } from '../types/feedTypes';
import { SALES_PERIODS } from '../types/feedTypes';
import { normalizeSupabaseStorageUrl, cleanDisplayMake, cleanDisplayModel } from '../lib/feedImageUtils';
import { DEFAULT_FILTERS, getRememberFilters, loadSavedFilters, saveFiltersToStorage, clearPersistedFiltersAndSort, STORAGE_KEY, REMEMBER_FILTERS_KEY, LOCATION_FAVORITES_KEY } from '../lib/filterPersistence';
import { parseQuery } from '../lib/search/queryParser';
import { applyNonAutoFilters } from '../lib/nonAutoExclusion';

const CursorHomepage: React.FC = () => {
  usePageTitle('Nuke');
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [serverFilteredCount, setServerFilteredCount] = useState<number | null>(null); // Exact count from DB when filters active
  // Initialize from cache so the personalized feed fires on first render
  // instead of waiting for an async getSession() round-trip.
  const [session, setSession] = useState<any>(() => readCachedSession() ?? null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('ALL'); // Default to ALL - no time filtering
  const [salesPeriod, setSalesPeriod] = useState<SalesTimePeriod>('today'); // For "sold" stats display
  const [viewMode, setViewMode] = useState<ViewMode>('grid'); // Always grid mode
  // When "remember filters" is off (default), every visit starts with no filters and default sort
  const [rememberFilters, setRememberFilters] = useState<boolean>(getRememberFilters);
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    if (!getRememberFilters()) return 'newest';
    try {
      const saved = localStorage.getItem('nuke_homepage_sortBy');
      return (saved as SortBy) || 'newest';
    } catch {
      return 'newest';
    }
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    if (!getRememberFilters()) return 'desc';
    try {
      const saved = localStorage.getItem('nuke_homepage_sortDirection');
      return (saved as SortDirection) || 'desc';
    } catch {
      return 'desc';
    }
  });
  const [showFilters, setShowFilters] = useState<boolean>(true); // Filter bar visible, individual sections start collapsed
  const [filters, setFilters] = useState<FilterState>(() => {
    if (!getRememberFilters()) return DEFAULT_FILTERS;
    const saved = loadSavedFilters();
    return saved ?? DEFAULT_FILTERS;
  });
  const [searchText, setSearchText] = useState<string>(() => {
    if (!getRememberFilters()) return '';
    try {
      return localStorage.getItem('nuke_homepage_searchText') || '';
    } catch {
      return '';
    }
  });
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>('');
  const DEFAULT_FILTERED_RENDER_LIMIT = 400;
  const FILTERED_RENDER_STEP = 400;
  const [filteredRenderLimit, setFilteredRenderLimit] = useState<number>(DEFAULT_FILTERED_RENDER_LIMIT);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [infoDense, setInfoDense] = useState<boolean>(false);

  // Some environments may not have `vehicles.listing_kind` yet (migration not applied).
  // We optimistically use it, but fall back automatically if PostgREST reports it missing.
  // HOTFIX: Default to false until migration 20260120_vehicle_listing_kind.sql is applied to production
  const listingKindSupportedRef = useRef<boolean>(false);
  const isMissingListingKindColumn = useCallback((err: any) => {
    const code = String((err as any)?.code || '').toUpperCase();
    const message = String(err?.message || '').toLowerCase();
    if (!message.includes('listing_kind')) return false;
    // Postgres: "column vehicles.listing_kind does not exist" (42703)
    if (code === '42703') return true;
    // PostgREST schema cache: "Could not find the 'listing_kind' column of 'vehicles' in the schema cache" (PGRST204)
    if (code === 'PGRST204') return true;
    return message.includes('does not exist') || message.includes('schema cache');
  }, []);
  const runVehiclesQueryWithListingKindFallback = useCallback(async (builder: (includeListingKind: boolean) => any) => {
    const first = await builder(listingKindSupportedRef.current);
    if (first?.error && isMissingListingKindColumn(first.error)) {
      listingKindSupportedRef.current = false;
      return await builder(false);
    }
    return first;
  }, [isMissingListingKindColumn]);
  
  // Location favorites state
  const [locationFavorites, setLocationFavorites] = useState<Array<{ zipCode: string; radiusMiles: number; label?: string }>>(() => {
    try {
      const saved = localStorage.getItem(LOCATION_FAVORITES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [currentZip, setCurrentZip] = useState(filters.zipCode || '');
  const [currentRadius, setCurrentRadius] = useState(filters.radiusMiles || 50);
  // Cache zip -> { lat, lng } for distance filtering (populated when location filter is active)
  const [locationZipCoords, setLocationZipCoords] = useState<Record<string, { lat: number; lng: number }>>({});
  const [cardsPerRow, setCardsPerRow] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('nuke_homepage_cardsPerRow');
      const n = Number(saved);
      if (Number.isFinite(n) && n >= 1 && n <= 16) return Math.round(n);
      return 6;
    } catch {
      return 6;
    }
  });
  const [thumbFitMode, setThumbFitMode] = useState<'square' | 'original'>(() => {
    try {
      const saved = localStorage.getItem('nuke_homepage_thumbFitMode');
      return saved === 'original' ? 'original' : 'square';
    } catch {
      return 'square';
    }
  });

  type ValueMetricMode = 'best_known' | 'mark' | 'ask' | 'realized' | 'cost';
  const [valueMetricMode, setValueMetricMode] = useState<ValueMetricMode>(() => {
    try {
      const saved = localStorage.getItem('nuke_homepage_valueMetricMode');
      const v = String(saved || '').trim() as ValueMetricMode;
      if (v === 'mark' || v === 'ask' || v === 'realized' || v === 'cost' || v === 'best_known') return v;
      return 'best_known';
    } catch {
      return 'best_known';
    }
  });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState<number>(0);
  const thermalPricing = false;
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [filterBarMinimized, setFilterBarMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  type StatsPanelKind = 'vehicles' | 'value' | 'for_sale' | 'sold_today' | 'auctions';
  const [statsPanel, setStatsPanel] = useState<StatsPanelKind | null>(null);
  const { statsPanelLoading, statsPanelError, statsPanelRows, statsPanelMeta } = useStatsPanelData({
    statsPanel,
    runVehiclesQueryWithListingKindFallback,
  });
  const [showActiveAuctionsPanel, setShowActiveAuctionsPanel] = useState(false);
  const [showFBMarketplacePanel, setShowFBMarketplacePanel] = useState(false);
  const [showRecentlyAddedPanel, setShowRecentlyAddedPanel] = useState(false);
  const [orgWebsitesById, setOrgWebsitesById] = useState<Record<string, { website: string; business_name: string; business_type: string | null; logo_url: string | null; city: string | null; state: string | null }>>({});
  const navigate = useNavigate();
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef<number>(0);
  const suppressAutoMinimizeUntilRef = useRef<number>(0);

  const infiniteObserverRef = useRef<IntersectionObserver | null>(null);

  // Collapsible filter sections
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    sourceFilters: true, // Source filters collapsed by default
    sourcePogs: true, // Source pogs library collapsed by default
    makeFilters: true, // Make filters collapsed by default
    modelFilters: true, // Model filters collapsed by default
    typeFilters: true, // Body type filters collapsed by default
    yearFilters: true, // Year filters collapsed by default
    priceFilters: true, // Price filters collapsed by default
    statusFilters: true, // Status filters collapsed by default
    locationFilters: true, // Location filters collapsed by default
    advancedFilters: true, // Advanced filters collapsed by default
  });

  // Search inputs for filtering
  const [sourceSearchText, setSourceSearchText] = useState('');
  const [makeSearchText, setMakeSearchText] = useState('');
  const [showMakeSuggestions, setShowMakeSuggestions] = useState(false);
  const [makeSuggestionIndex, setMakeSuggestionIndex] = useState(-1); // For arrow key navigation
  const makeInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  // Filter options (makes, models, body styles) loaded via hook
  const { availableMakes, availableModels, availableBodyStyles } = useFeedFilterOptions({
    selectedMakes: filters.makes,
    runVehiclesQueryWithListingKindFallback,
  });

  // Model filter state (shown after make is selected)
  const [modelSearchText, setModelSearchText] = useState('');
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);
  const [modelSuggestionIndex, setModelSuggestionIndex] = useState(-1);

  const hasActiveFilters = useMemo(() => {
    const result = 
      (filters.yearMin || filters.yearMax) ||
      (filters.priceMin || filters.priceMax) ||
      ((filters.makes?.length || 0) > 0) ||
      ((filters.models?.length || 0) > 0) ||
      ((filters.bodyStyles?.length || 0) > 0) ||
      filters.is4x4 ||
      ((filters.locations && filters.locations.length > 0) || (filters.zipCode && filters.radiusMiles > 0)) ||
      filters.addedTodayOnly ||
      filters.forSale ||
      filters.hideSold ||
      filters.showSoldOnly ||
      filters.showPending ||
      filters.privateParty ||
      filters.dealer ||
      filters.hideDealerListings ||
      filters.hideCraigslist ||
      filters.hideDealerSites ||
      filters.hideKsl ||
      filters.hideBat ||
      filters.hideClassic ||
      ((filters.hiddenSources?.length || 0) > 0);
    
    return result;
  }, [filters]);

  // Populate zip coords cache for distance-based location filtering
  useEffect(() => {
    const zipsToFetch: string[] = [];
    if (filters.locations?.length) {
      filters.locations.forEach(loc => {
        if (loc.zipCode?.length === 5 && /^\d+$/.test(loc.zipCode)) zipsToFetch.push(loc.zipCode);
      });
    }
    if (filters.zipCode?.length === 5 && /^\d+$/.test(filters.zipCode) && !zipsToFetch.includes(filters.zipCode)) {
      zipsToFetch.push(filters.zipCode);
    }
    if (zipsToFetch.length === 0) {
      setLocationZipCoords({});
      return;
    }
    let cancelled = false;
    const fetchCoords = async () => {
      const next: Record<string, { lat: number; lng: number }> = {};
      for (const zip of zipsToFetch) {
        if (cancelled) return;
        const { data } = await supabase
          .from('vehicles')
          .select('gps_latitude, gps_longitude')
          .eq('zip_code', zip)
          .not('gps_latitude', 'is', null)
          .not('gps_longitude', 'is', null)
          .limit(1)
          .maybeSingle();
        if (data?.gps_latitude != null && data?.gps_longitude != null) {
          next[zip] = { lat: Number(data.gps_latitude), lng: Number(data.gps_longitude) };
        }
      }
      if (!cancelled) setLocationZipCoords(prev => ({ ...prev, ...next }));
    };
    void fetchCoords();
    return () => { cancelled = true; };
  }, [filters.locations, filters.zipCode]);

  const vehiclesToRender = useMemo(() => {
    // When searching / filtering, cap how many cards we paint at once to avoid UI stutter.
    // Users can opt-in to render more via "Show more".
    if (hasActiveFilters || debouncedSearchText) {
      return filteredVehicles.slice(0, Math.max(0, filteredRenderLimit));
    }
    return filteredVehicles;
  }, [filteredVehicles, hasActiveFilters, debouncedSearchText, filteredRenderLimit]);

  const isRenderTruncated =
    (hasActiveFilters || debouncedSearchText) && vehiclesToRender.length < filteredVehicles.length;

  // Preload images for smoother scrolling - prefetch next batch of images
  useEffect(() => {
    if (vehiclesToRender.length === 0) return;

    // Get image URLs from vehicles about to render
    // Preload current viewport + next 3 rows worth (at 16 columns = 48 images ahead)
    const imagesToPreload = vehiclesToRender
      .slice(0, Math.min(vehiclesToRender.length, cardsPerRow * 6)) // First 6 rows
      .map((v: any) => v.primary_image_url || v.image_url)
      .filter(Boolean);

    // Batch preload with optimized URLs (small size for grid)
    if (imagesToPreload.length > 0) {
      preloadImageBatch(imagesToPreload, 'small', 20);
    }
  }, [vehiclesToRender, cardsPerRow]);

  // Also preload when scrolling - prefetch images further down
  useEffect(() => {
    let lastScrollY = window.scrollY;
    let rafId: number | null = null;

    const handleScrollPreload = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const currentScrollY = window.scrollY;
        const scrollingDown = currentScrollY > lastScrollY;
        lastScrollY = currentScrollY;

        if (scrollingDown && vehiclesToRender.length > 0) {
          // Estimate which row we're viewing based on scroll position
          // Assume each card row is ~150px tall (varies with content)
          const estimatedRowHeight = 150;
          const viewportBottom = currentScrollY + window.innerHeight;
          const estimatedCurrentRow = Math.floor(viewportBottom / estimatedRowHeight);
          const startIdx = Math.max(0, estimatedCurrentRow * cardsPerRow);
          const endIdx = Math.min(vehiclesToRender.length, startIdx + cardsPerRow * 5); // 5 rows ahead

          const imagesToPreload = vehiclesToRender
            .slice(startIdx, endIdx)
            .map((v: any) => v.primary_image_url || v.image_url)
            .filter(Boolean);

          if (imagesToPreload.length > 0) {
            preloadImageBatch(imagesToPreload, 'small', 15);
          }
        }
      });
    };

    window.addEventListener('scroll', handleScrollPreload, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScrollPreload);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [vehiclesToRender, cardsPerRow]);

  useEffect(() => {
    loadSession();
    
    // Scroll listener for sticky filter bar and scroll-to-top button
    let rafId: number | null = null;
    lastScrollYRef.current = window.scrollY;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const currentScrollY = window.scrollY;
        const deltaY = currentScrollY - lastScrollYRef.current;
        lastScrollYRef.current = currentScrollY;
        const now = Date.now();

        // Show scroll-to-top button after scrolling down 500px (only update on change)
        const shouldShowScrollTop = currentScrollY > 500;
        setShowScrollTop((prev) => (prev === shouldShowScrollTop ? prev : shouldShowScrollTop));

        // Auto-minimize ONLY after the filter panel has been scrolled past.
        // This prevents the panel from collapsing while the user is still scrolling through the filters.
        // Do NOT auto-expand (let the user control expansion).
        let filterPanelStillVisible = false;
        try {
          const panel = filterPanelRef.current;
          if (panel) {
            const rect = panel.getBoundingClientRect();
            const headerHeightRaw = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
            const headerHeight = Number.parseFloat(headerHeightRaw) || 40;
            filterPanelStillVisible = rect.bottom > headerHeight + 8;
          }
        } catch {
          // ignore
        }

        // NOTE: Auto-minimize disabled - stats bar should ALWAYS be visible
        // Only individual filter sections collapse, not the entire bar
        // const suppressAutoMinimize = now < suppressAutoMinimizeUntilRef.current;
        // if (!suppressAutoMinimize && deltaY > 0 && showFilters && currentScrollY > 12 && !filterBarMinimized && !filterPanelStillVisible) {
        //   setFilterBarMinimized(true);
        //   setShowFilters(false);
        // }
      });
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [showFilters, filterBarMinimized]);

  // Filter options (makes, body styles) loaded by useFeedFilterOptions hook above

  // On visit: when "remember filters" is off, clear any persisted filters/sort so next load stays clean
  useEffect(() => {
    if (!rememberFilters) clearPersistedFiltersAndSort();
  }, [rememberFilters]);

  // Save filters to localStorage only when user has opted in to "keep filters when I leave"
  useEffect(() => {
    if (rememberFilters) saveFiltersToStorage(filters);
  }, [rememberFilters, filters]);

  // Save other filter-related state
  useEffect(() => {
    if (!rememberFilters) return;
    try {
      localStorage.setItem('nuke_homepage_searchText', searchText);
    } catch {
      // ignore
    }
  }, [rememberFilters, searchText]);

  useEffect(() => {
    if (!rememberFilters) return;
    try {
      localStorage.setItem('nuke_homepage_sortBy', sortBy);
    } catch {
      // ignore
    }
  }, [rememberFilters, sortBy]);

  useEffect(() => {
    if (!rememberFilters) return;
    try {
      localStorage.setItem('nuke_homepage_sortDirection', sortDirection);
    } catch {
      // ignore
    }
  }, [rememberFilters, sortDirection]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_cardsPerRow', String(cardsPerRow));
    } catch {
      // ignore
    }
  }, [cardsPerRow]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_thumbFitMode', thumbFitMode);
    } catch {
      // ignore
    }
  }, [thumbFitMode]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_valueMetricMode', valueMetricMode);
    } catch {
      // ignore
    }
  }, [valueMetricMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = gridRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setGridWidth((prev) => {
        const next = Math.max(0, Math.floor(rect.width));
        return prev === next ? prev : next;
      });
    };

    update();
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => update()) : null;
    if (ro) ro.observe(el);

    return () => {
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
    };
  }, [viewMode, filteredVehicles.length]);

  const gridCardSizePx = useMemo(() => {
    const cols = Math.max(1, Math.min(16, Math.floor(cardsPerRow || 1)));
    const gap = 8;
    const w = Number(gridWidth) || 0;
    if (!w) return undefined;
    const px = (w - gap * (cols - 1)) / cols;
    return Math.max(60, Math.floor(px));
  }, [gridWidth, cardsPerRow]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_showFilters', String(showFilters));
    } catch (err) {
      // ignore
    }
  }, [showFilters]);

  // Debounce search and parse intelligent patterns using the shared queryParser.
  // Supports: year ranges, compound queries ("1980 ford pickup"), make aliases
  // ("chevy truck"), body styles ("sedan"), prices ("under $50k"), and more.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = searchText.trim();
      if (!trimmed) {
        setDebouncedSearchText('');
        return;
      }

      const parsed = parseQuery(trimmed);
      const hasStructured = parsed.yearMin || parsed.make || parsed.bodyStyle || parsed.priceMin || parsed.priceMax;

      if (hasStructured) {
        // Map body style to uppercase filter format; "truck" is alias for "PICKUP"
        const rawBody = parsed.bodyStyle?.toLowerCase();
        const mappedBody = rawBody ? (rawBody === 'truck' ? 'PICKUP' : rawBody.toUpperCase()) : null;

        setFilters(prev => ({
          ...prev,
          ...(parsed.yearMin ? { yearMin: parsed.yearMin, yearMax: parsed.yearMax ?? parsed.yearMin } : {}),
          ...(parsed.make && !prev.makes.includes(parsed.make.toUpperCase())
            ? { makes: [...prev.makes, parsed.make.toUpperCase()] } : {}),
          ...(mappedBody && !prev.bodyStyles.includes(mappedBody)
            ? { bodyStyles: [...prev.bodyStyles, mappedBody] } : {}),
          ...(parsed.priceMin ? { priceMin: parsed.priceMin } : {}),
          ...(parsed.priceMax ? { priceMax: parsed.priceMax } : {}),
        }));
        // Remaining freeText (model or unrecognized tokens) goes to text search
        setDebouncedSearchText(parsed.model || parsed.freeText || '');
        return;
      }

      setDebouncedSearchText(trimmed);
    }, 150);
    return () => window.clearTimeout(t);
  }, [searchText]);

  // When filters/search change, reset the render window so we don't try to paint thousands of cards at once.
  useEffect(() => {
    setFilteredRenderLimit(DEFAULT_FILTERED_RENDER_LIMIT);
  }, [debouncedSearchText, filters]);

  // Keyboard shortcut: "/" focuses search when not typing in an input already.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() || '';
      const isTypingContext = tag === 'input' || tag === 'textarea' || (target as any)?.isContentEditable;
      if (isTypingContext) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  // Load feed when session is known. Session initializes from localStorage cache
  // synchronously, so this fires on first render rather than after an async
  // getSession() round-trip. Also re-fires on login/logout.
  // Note: session is never `undefined` now — it starts as the cached value or null.
  const prevSessionIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const nextId = session?.user?.id ?? null;
    if (prevSessionIdRef.current === nextId) return; // skip if same user
    prevSessionIdRef.current = nextId;
    setPage(0);
    setHasMore(true);
    loadHypeFeed(0, false);
  }, [session]);

  // Refetch feed when ANY server-pushable filter changes (year, make, price, source, status, forSale, etc.)
  // This is the KEY fix: filters must go to the database, not just filter 200 client-side records.
  const serverFilterKey = [
    // Source filters
    filters.hideBat,
    filters.hideCraigslist,
    filters.hideDealerListings,
    filters.hideDealerSites,
    filters.hideKsl,
    filters.hideClassic,
    (filters.hiddenSources || []).join(','),
    // Year filters
    filters.yearMin ?? '',
    filters.yearMax ?? '',
    // Make filters
    (filters.makes || []).join(','),
    // Model filters
    (filters.models || []).join(','),
    // Price filters
    filters.priceMin ?? '',
    filters.priceMax ?? '',
    // Status filters
    filters.forSale,
    filters.hideSold,
    filters.showSoldOnly,
    filters.showPending,
    // Sort (affects DB query order)
    sortBy,
    sortDirection,
  ].join('\n');
  const prevServerFilterKeyRef = useRef<string>(serverFilterKey);
  const didMountRef = useRef(false);
  // Debounce filter reloads to avoid hammering DB on rapid changes (e.g., typing year)
  const filterReloadTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      prevServerFilterKeyRef.current = serverFilterKey;
      return;
    }
    if (prevServerFilterKeyRef.current === serverFilterKey) return;
    prevServerFilterKeyRef.current = serverFilterKey;
    
    // Debounce: wait 300ms before reloading (handles rapid typing in year/price inputs)
    if (filterReloadTimerRef.current) clearTimeout(filterReloadTimerRef.current);
    filterReloadTimerRef.current = setTimeout(() => {
      setPage(0);
      setHasMore(true);
      loadHypeFeed(0, false);
    }, 300);
    
    return () => {
      if (filterReloadTimerRef.current) clearTimeout(filterReloadTimerRef.current);
    };
  }, [serverFilterKey]);

  // Source management: active sources, inclusion logic, classification, pogs, favicons
  const {
    activeSources, sourceCounts, domainToFilterKey, includedSources,
    getSourceFilterKey, sourcePogs, faviconUrl, domainGradient,
  } = useFeedSources({ filters, isMissingListingKindColumn, listingKindSupportedRef });

  const applyFiltersAndSort = useCallback(() => {
    const result = filterAndSortVehicles({
      vehicles: feedVehicles,
      filters,
      searchText: debouncedSearchText,
      sortBy,
      sortDirection,
      includedSources,
      getSourceFilterKey,
      salesPeriod,
      locationZipCoords,
    });
    setFilteredVehicles(result);
  }, [feedVehicles, filters, sortBy, sortDirection, debouncedSearchText, includedSources, getSourceFilterKey, salesPeriod, locationZipCoords]);

  // Apply filters and sorting whenever vehicles or settings change
  useEffect(() => {
    applyFiltersAndSort();
  }, [applyFiltersAndSort]);

  const activeFilterCount = useMemo(() => {
    // Count only "filtering" fields; exclude purely visual toggles.
    let n = 0;
    if (debouncedSearchText) n++;
    if (filters.yearMin !== DEFAULT_FILTERS.yearMin) n++;
    if (filters.yearMax !== DEFAULT_FILTERS.yearMax) n++;
    if ((filters.makes?.length || 0) > 0) n++;
    if ((filters.models?.length || 0) > 0) n++;
    if ((filters.bodyStyles?.length || 0) > 0) n++;
    if (filters.is4x4 !== DEFAULT_FILTERS.is4x4) n++;
    if (filters.priceMin !== DEFAULT_FILTERS.priceMin) n++;
    if (filters.priceMax !== DEFAULT_FILTERS.priceMax) n++;
    if (filters.hasImages !== DEFAULT_FILTERS.hasImages) n++;
    if (filters.addedTodayOnly !== DEFAULT_FILTERS.addedTodayOnly) n++;
    if (filters.forSale !== DEFAULT_FILTERS.forSale) n++;
    if (filters.hideSold !== DEFAULT_FILTERS.hideSold) n++;
    if (filters.showSoldOnly) n++;
    if (filters.privateParty !== DEFAULT_FILTERS.privateParty) n++;
    if (filters.dealer !== DEFAULT_FILTERS.dealer) n++;
    if (filters.hideDealerListings !== DEFAULT_FILTERS.hideDealerListings) n++;
    if (filters.hideCraigslist !== DEFAULT_FILTERS.hideCraigslist) n++;
    if (filters.hideDealerSites !== DEFAULT_FILTERS.hideDealerSites) n++;
    if (filters.hideKsl !== DEFAULT_FILTERS.hideKsl) n++;
    if (filters.hideBat !== DEFAULT_FILTERS.hideBat) n++;
    if (filters.hideClassic !== DEFAULT_FILTERS.hideClassic) n++;
    if ((filters.locations && filters.locations.length > 0) || filters.zipCode !== DEFAULT_FILTERS.zipCode) n++;
    if (filters.zipCode && filters.radiusMiles !== DEFAULT_FILTERS.radiusMiles) n++;
    if (filters.showPending !== DEFAULT_FILTERS.showPending) n++;
    return n;
  }, [filters, debouncedSearchText]);

  // Filtered stats from database (debounced query when filters active)
  const { filteredStatsFromDb } = useFilteredDbStats({
    hasActiveFilters, debouncedSearchText, filters, includedSources,
    getSourceFilterKey, listingKindSupportedRef, isMissingListingKindColumn, salesPeriod,
  });

  // Calculate filtered vehicle statistics (fallback for display, but we prefer DB stats)
  const filteredStats = useMemo(() => {
    // If we have DB stats AND they've loaded (totalVehicles > 0 or totalValue > 0), use those (more accurate)
    // Also use DB stats if filteredVehicles is empty (no local data to compute from)
    if ((hasActiveFilters || debouncedSearchText) &&
        (filteredStatsFromDb.totalVehicles > 0 || filteredStatsFromDb.totalValue > 0 || filteredVehicles.length === 0)) {
      return filteredStatsFromDb;
    }

    // Otherwise compute from filteredVehicles (used while DB stats are loading, or as fallback)
    const overrideTotal = (hasActiveFilters && serverFilteredCount !== null) ? serverFilteredCount : undefined;
    return computeVehicleStats(filteredVehicles, overrideTotal, true);
  }, [filteredVehicles, hasActiveFilters, debouncedSearchText, filteredStatsFromDb, serverFilteredCount]);

  // Database-wide stats (cached table → RPCs → client fallback) with periodic refresh + realtime
  const { dbStats } = useDbStats({ runVehiclesQueryWithListingKindFallback });

  // Update filteredStats to show DB stats when no filters, filtered stats when filters active
  const displayStats = useMemo(() => {
    // Priority 1: If no filters and dbStats has loaded (has data), always use dbStats
    // This ensures we show correct stats even if hasActiveFilters check has issues
    if (!hasActiveFilters && !debouncedSearchText && dbStats.totalVehicles > 0) {
      return dbStats;
    }
    
    // Priority 2: If filters are active, use filteredStats
    if (hasActiveFilters || debouncedSearchText) {
      return filteredStats;
    }
    
    // Priority 3: No filters but dbStats hasn't loaded yet - still use dbStats (will update when loaded)
    return dbStats;
  }, [hasActiveFilters, debouncedSearchText, dbStats, filteredStats]);

  // Compute sales stats for the selected time period
  const salesByPeriod = useMemo(() => {
    const period = SALES_PERIODS.find(p => p.value === salesPeriod);
    if (!period) return { count: 0, volume: 0, label: 'today' };

    // For "today" with no filters, use database stats (accurate, covers all vehicles)
    if (salesPeriod === 'today' && !hasActiveFilters && !debouncedSearchText) {
      return {
        count: displayStats.salesCountToday || 0,
        volume: displayStats.salesVolume || 0,
        label: 'today'
      };
    }

    // For other periods or when filters active, compute from vehicles
    const vehicles = hasActiveFilters || debouncedSearchText ? filteredVehicles : feedVehicles;
    const now = new Date();
    let cutoffDate: Date | null = null;

    if (period.days !== null) {
      cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() - period.days);
      cutoffDate.setHours(0, 0, 0, 0);
    }

    let count = 0;
    let volume = 0;

    vehicles.forEach((v: any) => {
      const salePrice = Number(v.sale_price || 0) || 0;
      if (salePrice < 500) return; // Skip low-value sales (likely errors)

      const saleDateStr = v.sale_date;
      if (!saleDateStr) return;

      const saleDate = new Date(saleDateStr);
      if (isNaN(saleDate.getTime())) return;

      // Check if sale is within the period
      if (cutoffDate === null || saleDate >= cutoffDate) {
        count++;
        volume += salePrice;
      }
    });

    // If no sales found for this period and no filters, fall back to "today" DB stats
    // This handles the case where vehicles haven't fully loaded yet
    if (count === 0 && !hasActiveFilters && !debouncedSearchText && displayStats.salesCountToday > 0) {
      return {
        count: displayStats.salesCountToday,
        volume: displayStats.salesVolume || 0,
        label: 'today*' // Asterisk indicates fallback
      };
    }

    return { count, volume, label: period.label };
  }, [salesPeriod, hasActiveFilters, debouncedSearchText, filteredVehicles, feedVehicles, displayStats.salesCountToday, displayStats.salesVolume]);

  // Cycle to next sales period
  const cycleSalesPeriod = useCallback(() => {
    const currentIndex = SALES_PERIODS.findIndex(p => p.value === salesPeriod);
    const nextIndex = (currentIndex + 1) % SALES_PERIODS.length;
    setSalesPeriod(SALES_PERIODS[nextIndex].value);
  }, [salesPeriod]);

  const headerValueMetric = useMemo(() => {
    switch (valueMetricMode) {
      case 'mark':
        return { value: displayStats.valueMarkTotal || 0, label: 'mark' };
      case 'ask':
        return { value: displayStats.valueAskTotal || 0, label: 'ask' };
      case 'realized':
        return { value: displayStats.valueRealizedTotal || 0, label: 'realized' };
      case 'cost':
        return { value: displayStats.valueCostTotal || 0, label: 'cost' };
      case 'best_known':
      default:
        return { value: displayStats.totalValue || 0, label: 'val' };
    }
  }, [valueMetricMode, displayStats]);

  const loadSession = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    setSession(currentSession ?? null);
  };

  const getTimePeriodFilter = () => {
    const now = new Date();
    switch (timePeriod) {
      case 'ALL':
        return null; // No time filter - show everything
      case 'D':
        return new Date(now.setDate(now.getDate() - 1)).toISOString();
      case 'W':
        return new Date(now.setDate(now.getDate() - 7)).toISOString();
      case 'Q':
        return new Date(now.setMonth(now.getMonth() - 3)).toISOString();
      case '1Y':
        return new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
      case 'RT':
        return new Date(now.setHours(now.getHours() - 1)).toISOString();
      case 'AT':
      default:
        return null; // Active = no strict time filter
    }
  };

  const PAGE_SIZE = 200;

  const loadHypeFeed = async (pageNum: number, append: boolean) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const offset = pageNum * PAGE_SIZE;

      // When source filter is active, use a BLOCKLIST approach: exclude only the
      // hidden sources rather than building a massive OR allowlist of every included
      // source.  This keeps the PostgREST URL short and avoids 414 errors when there
      // are 200+ active sources.
      //
      // We still do a secondary client-side pass via `applyFiltersAndSort` so the two
      // layers are complementary: server narrows the result set, client enforces exact
      // per-vehicle classification.
      const hasSourceSelectionsForFeed =
        filters.hideDealerListings ||
        filters.hideCraigslist ||
        filters.hideDealerSites ||
        filters.hideKsl ||
        filters.hideBat ||
        filters.hideClassic ||
        (filters.hiddenSources && filters.hiddenSources.length > 0);

      const includedKeysForFeed = hasSourceSelectionsForFeed
        ? (Object.entries(includedSources).filter(([, v]) => v === true) as [string, boolean][]).map(([k]) => k)
        : [];

      // Source filtering is handled ENTIRELY client-side by `applyFiltersAndSort`.
      // Server-side source filters (OR / NOT ILIKE) are too expensive at 700K+ rows
      // because they invalidate the partial index and force full-table scans.
      // The trade-off is that pagination may show fewer visible results per page
      // when many sources are hidden, but the query is fast and the client
      // accurately filters.

      const allSourcesExcluded =
        hasSourceSelectionsForFeed && includedKeysForFeed.length === 0;

      // Short-circuit: if every source is excluded ("none" button), skip the query.
      if (allSourcesExcluded) {
        if (!append) setFeedVehicles([]);
        setHasMore(false);
        return;
      }

      // Get vehicles for feed (keep payload small; avoid heavy origin_metadata + bulk image joins here).
      // NOTE: Do NOT select `listing_start_date` here. It is not a real column in the DB and will cause
      // PostgREST 400 errors if included in the `select()` list.
      // Simple query: most recent vehicles first, no filters.
      // Try to include canonical taxonomy columns if present; fallback gracefully if migration not applied yet.
      // V2 includes canonical taxonomy columns; V1 omits them (fallback if migration not applied)
      const baseFields = `id, year, make, model, normalized_model, series, trim,
          engine_size, transmission, transmission_model, drivetrain, body_style, fuel_type`;
      const sharedFields = `title, vin, created_at, updated_at,
          sale_price, current_value, purchase_price, asking_price,
          sale_date, sale_status,
          auction_outcome, high_bid, winning_bid, bid_count,
          auction_end_date,
          is_for_sale, mileage, status, is_public, primary_image_url, image_url, origin_organization_id,
          discovery_url, discovery_source, profile_origin,
          listing_url, bat_auction_url, platform_source,
          nuke_estimate, nuke_estimate_confidence, deal_score, heat_score,
          zip_code, gps_latitude, gps_longitude`;
      const selectV1 = `${baseFields}, ${sharedFields}`;
      const selectV2 = `${baseFields}, canonical_vehicle_type, canonical_body_style, ${sharedFields}`;

      const getMissingColumn = (err: any): string | null => {
        const message = String(err?.message || '');
        // Postgres: "column vehicles.canonical_vehicle_type does not exist" (42703)
        const match =
          message.match(/column\s+[\w.]+\.(\w+)\s+does\s+not\s+exist/i) ||
          message.match(/column\s+(\w+)\s+does\s+not\s+exist/i);
        if (match?.[1]) return match[1];
        // PostgREST schema cache: "Could not find the 'col' column of 'table' in the schema cache" (PGRST204)
        const schemaMatch = message.match(/could not find the '(\w+)' column/i);
        if (schemaMatch?.[1]) return schemaMatch[1];
        return null;
      };

      const runVehicleQuery = async (selectFields: string) => {
        try {
          // Skip exact count – the full-table window function is too expensive
          // on 700K+ rows (causes statement timeouts).  We get the total count
          // from the cached portfolio_stats_cache table instead.
          let q = supabase
            .from('vehicles')
            .select(selectFields)
            .eq('is_public', true);
          
          // Status filter: show pending only if explicitly requested
          if (filters.showPending) {
            // No status filter - show everything including pending
          } else {
            q = q.neq('status', 'pending');
          }
          q = q.neq('status', 'deleted');

          // Only show vehicles with images — UNLESS sorting by newest (so new extractions are visible)
          if (sortBy !== 'newest') {
            q = q.not('primary_image_url', 'is', null);
          }

          // Only show vehicles with valid year/make/model
          q = q.not('year', 'is', null);
          q = q.not('make', 'is', null);

          if (listingKindSupportedRef.current) {
            q = q.eq('listing_kind', 'vehicle');
          }

          // === NON-AUTO EXCLUSION (server-side) ===
          q = applyNonAutoFilters(q);

          // === DEALER EXCLUSION (hide dealers unless searching) ===
          if (!debouncedSearchText && !filters.dealer) {
            q = q.is('origin_organization_id', null);
          }

          // Source filtering handled client-side in applyFiltersAndSort

          // === SERVER-SIDE FILTERS (the critical fix) ===
          // Year filters
          if (filters.yearMin) {
            q = q.gte('year', filters.yearMin);
          }
          if (filters.yearMax) {
            q = q.lte('year', filters.yearMax);
          }
          // Make filter (case-insensitive)
          if (filters.makes && filters.makes.length > 0) {
            if (filters.makes.length === 1) {
              q = q.ilike('make', `%${filters.makes[0]}%`);
            } else {
              // Multiple makes: use OR
              const makeClauses = filters.makes.map(m => `make.ilike.%${m}%`).join(',');
              q = q.or(makeClauses);
            }
          }
          // Model filter
          if (filters.models && filters.models.length > 0) {
            if (filters.models.length === 1) {
              q = q.ilike('model', `%${filters.models[0]}%`);
            } else {
              const modelClauses = filters.models.map(m => `model.ilike.%${m}%`).join(',');
              q = q.or(modelClauses);
            }
          }
          // Price filters (use sale_price as primary)
          if (filters.priceMin) {
            q = q.gte('sale_price', filters.priceMin);
          }
          if (filters.priceMax) {
            q = q.lte('sale_price', filters.priceMax);
          }
          // For sale filter
          if (filters.forSale) {
            q = q.eq('is_for_sale', true);
          }
          // Hide sold
          if (filters.hideSold) {
            q = q.or('sale_price.is.null,sale_date.is.null');
          }
          // Show sold only
          if (filters.showSoldOnly) {
            q = q.not('sale_price', 'is', null).gte('sale_price', 500);
          }
          
          // === SORTING ===
          let orderColumn = 'created_at';
          let orderAscending = false;
          switch (sortBy) {
            case 'year':
              orderColumn = 'year';
              orderAscending = sortDirection === 'asc';
              break;
            case 'make':
              orderColumn = 'make';
              orderAscending = sortDirection === 'asc';
              break;
            case 'model':
              orderColumn = 'model';
              orderAscending = sortDirection === 'asc';
              break;
            case 'mileage':
              orderColumn = 'mileage';
              orderAscending = sortDirection === 'asc';
              break;
            case 'newest':
              orderColumn = 'created_at';
              orderAscending = false;
              break;
            case 'oldest':
              orderColumn = 'created_at';
              orderAscending = true;
              break;
            case 'price_high':
              orderColumn = 'sale_price';
              orderAscending = false;
              break;
            case 'price_low':
              orderColumn = 'sale_price';
              orderAscending = true;
              break;
            case 'deal_score':
              orderColumn = 'deal_score';
              orderAscending = false;
              q = q.not('deal_score', 'is', null)
                   .gt('deal_score', 0)
                   .gt('asking_price', 1000);
              break;
            case 'heat_score':
              orderColumn = 'heat_score';
              orderAscending = false;
              q = q.not('heat_score', 'is', null);
              break;
            default:
              orderColumn = 'created_at';
              orderAscending = false;
          }
          
          return await q
            .order(orderColumn, { ascending: orderAscending })
            .range(offset, offset + PAGE_SIZE - 1);
        } catch (e) {
          return { data: null, error: e };
        }
      };

      let vehicles: any[] | null = null;
      let error: any = null;
      let totalFilteredCount: number | null = null;
      const applyResult = (result: { data: any[] | null; error: any; count?: number | null }) => {
        vehicles = result.data as any[] | null;
        error = result.error;
        if (typeof result.count === 'number') {
          totalFilteredCount = result.count;
        }
      };

      let result = await runVehicleQuery(selectV2);
      applyResult(result);

      // Handle missing listing_kind column (migration not applied yet)
      if (error && isMissingListingKindColumn(error)) {
        listingKindSupportedRef.current = false;
        result = await runVehicleQuery(selectV2);
        applyResult(result);
      }

      if (error) {
        // selectV2 failed (missing column, PGRST204 schema cache stale, or other) → fall back to selectV1
        // getMissingColumn handles both Postgres 42703 and PostgREST PGRST204 formats
        const _missingColumn = getMissingColumn(error); // for logging only
        if (_missingColumn) {
          console.warn('CursorHomepage: column missing, falling back to selectV1:', _missingColumn);
        }
        result = await runVehicleQuery(selectV1);
        applyResult(result);
      }

      if (error) {
        // Error loading vehicles - set error state for UI
        console.error('CursorHomepage.loadHypeFeed error:', error.message, (error as any).code);
        setError('Unable to load vehicles. Please try refreshing the page.');
        setFeedVehicles([]);
        return;
      }

      if (!vehicles || vehicles.length === 0) {
        if (!append) {
          setFeedVehicles([]);
        }
        setHasMore(false);
        return;
      }

      // Batch-load live auction bids (fixes: BaT cards showing EST/--- instead of current bid).
      // Best-effort only: if RLS blocks vehicle_events for anon, we keep the old behavior.
      // Group by vehicle_id to support multiple events per vehicle (VehicleCardDense uses vehicle_events[0]).
      // IMPORTANT: Filter for active/live events to ensure badges show correctly on homepage.
      const vehicleEventsByVehicleId = new Map<string, any[]>();
      const auctionByVehicleId = new Map<string, any>(); // Keep for backward compatibility (display price logic)
      try {
        const ids = Array.from(new Set((vehicles || []).map((v: any) => String(v?.id || '')).filter(Boolean)));
        if (ids.length > 0) {
          const { data: events, error: listErr } = await supabase
            .from('vehicle_events')
            .select('vehicle_id, source_platform, event_status, current_price, final_price, started_at, ended_at, bid_count, updated_at, source_url')
            .in('vehicle_id', ids)
            // Fetch ALL events with future end dates (not just 'active'/'live' status)
            // Some scrapers use different status values ('pending', 'scheduled', etc.) for live auctions
            .gt('ended_at', new Date().toISOString())
            .order('updated_at', { ascending: false })
            .limit(2000);
          if (!listErr && Array.isArray(events)) {
            // Group all events by vehicle_id and filter for truly active ones (future ended_at)
            for (const row of events as any[]) {
              const vid = String(row?.vehicle_id || '');
              if (!vid) continue;

              // Double-check ended_at is actually in the future (belt and suspenders)
              const endDate = row.ended_at ? new Date(row.ended_at).getTime() : 0;
              if (!Number.isFinite(endDate) || endDate <= Date.now()) continue;

              // Normalize vehicle_events columns to legacy shape for VehicleCardDense compatibility
              const normalized = {
                ...row,
                platform: row.source_platform,
                listing_status: row.event_status,
                current_bid: row.current_price,
                start_date: row.started_at,
                end_date: row.ended_at,
                listing_url: row.source_url,
              };

              // Add to grouped array (for VehicleCardDense)
              if (!vehicleEventsByVehicleId.has(vid)) {
                vehicleEventsByVehicleId.set(vid, []);
              }
              vehicleEventsByVehicleId.get(vid)!.push(normalized);

              // Keep first event for backward compatibility (display price logic)
              if (!auctionByVehicleId.has(vid)) {
                auctionByVehicleId.set(vid, normalized);
              }
            }

            // Sort each vehicle's events array by updated_at (most recent first)
            for (const [vid, eventsArray] of vehicleEventsByVehicleId.entries()) {
              eventsArray.sort((a: any, b: any) => {
                return (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
              });
            }
          }
        }
      } catch {
        // ignore
      }

      // Batch-load thumbnail/medium image variants for optimal grid performance
      const thumbnailByVehicleId = new Map<string, string | null>();
      const mediumByVehicleId = new Map<string, string | null>();
      const vehicleImageQualityMap = new Map<string, { hasGoodImages: boolean; hasAnyImages: boolean }>();
      try {
        const vehicleIds = Array.from(new Set((vehicles || []).map((v: any) => String(v?.id || '')).filter(Boolean)));
        if (vehicleIds.length > 0) {
          // Process in chunks to avoid URL size limits
          const chunkSize = 75;
          for (let i = 0; i < vehicleIds.length; i += chunkSize) {
            const chunk = vehicleIds.slice(i, i + chunkSize);
            const { data: imgs, error: imgErr } = await supabase
              .from('vehicle_images')
              .select('vehicle_id, thumbnail_url, medium_url, image_url, variants, file_size')
              .in('vehicle_id', chunk)
              .eq('is_primary', true)
              .limit(chunk.length);
            
            if (imgErr) {
              // Non-fatal: continue without thumbnails
              // Failed to fetch thumbnail chunk - silent
              continue;
            }
            
            const imageRecords = Array.isArray(imgs) ? imgs : [];
            
            // Group by vehicle_id and track image quality
            const seenVehicleIds = new Set<string>();
            for (const img of imageRecords) {
              const vid = String(img?.vehicle_id || '');
              if (!vid) continue;
              
              // Initialize quality tracking for this vehicle
              if (!vehicleImageQualityMap.has(vid)) {
                vehicleImageQualityMap.set(vid, { hasGoodImages: false, hasAnyImages: false });
              }
              
              const quality = vehicleImageQualityMap.get(vid)!;
              quality.hasAnyImages = true;
              
              // Check if this is a good quality image
              const imageUrl = img?.image_url || img?.medium_url || img?.thumbnail_url || null;
              const fileSize = img?.file_size ? Number(img.file_size) : null;
              
              if (!isPoorQualityImage(imageUrl, fileSize)) {
                quality.hasGoodImages = true;
              }
              
              // Only process first image per vehicle for thumbnail/medium maps
              if (!seenVehicleIds.has(vid)) {
                seenVehicleIds.add(vid);
                
                const variants = (img?.variants && typeof img.variants === 'object') ? img.variants : {};
                
                // Prioritize thumbnail, then medium, then full image
                const thumbnail = variants?.thumbnail || img?.thumbnail_url || null;
                const medium = variants?.medium || img?.medium_url || null;
                
                // Normalize URLs (convert signed to public if needed)
                const normalizedThumbnail = thumbnail ? normalizeSupabaseStorageUrl(thumbnail) : null;
                const normalizedMedium = medium ? normalizeSupabaseStorageUrl(medium) : null;
                
                // Only use images that aren't poor quality
                if (normalizedThumbnail && !isPoorQualityImage(normalizedThumbnail, fileSize)) {
                  thumbnailByVehicleId.set(vid, normalizedThumbnail);
                }
                if (normalizedMedium && !isPoorQualityImage(normalizedMedium, fileSize)) {
                  mediumByVehicleId.set(vid, normalizedMedium);
                }
              }
            }
          }
        }
      } catch (err) {
        // Error loading image variants - silent
        // Non-fatal: continue with fallback images
      }

      // Process ALL vehicles – the card component handles missing images with a
      // placeholder.  We no longer pre-filter by image quality because bulk imports
      // can produce large batches of imageless vehicles that push everything else
      // out of the first page.
      const processed = (vehicles || []).map((v: any) => {
        const salePrice = parseMoneyNumber(v.sale_price);
        const askingPrice = parseMoneyNumber(v.asking_price);
        const currentValue = parseMoneyNumber(v.current_value);
        const purchasePrice = parseMoneyNumber(v.purchase_price);
        const winningBid = parseMoneyNumber(v.winning_bid);
        const highBid = parseMoneyNumber(v.high_bid);
        const listing = auctionByVehicleId.get(String(v?.id || '')) || null;
        const listingStatus = String((listing as any)?.listing_status || '').toLowerCase();
        const saleStatus = String(v.sale_status || '').toLowerCase();
        const isLive = listingStatus === 'active' || listingStatus === 'live';
        const listingLiveBid = parseMoneyNumber((listing as any)?.current_bid);
        const finalPrice = parseMoneyNumber((listing as any)?.final_price);

        // Priority order for display price:
        // 1. Sale price (actual sold price)
        // 2. Winning bid (auction result)
        // 3. High bid (RNM auctions)
        // 4. Live bid from vehicle_events
        // 5. Final price from listing
        // 6. Asking price (only if actually for sale)
        // 7. DO NOT fall back to current_value - only show if explicitly set as asking
        const displayPrice =
          (salePrice && salePrice > 0) ? salePrice :
          (winningBid && winningBid > 0) ? winningBid :
          (highBid && highBid > 0) ? highBid :
          (isLive && Number.isFinite(listingLiveBid) && listingLiveBid > 0) ? listingLiveBid :
          (Number.isFinite(finalPrice) && finalPrice > 0) ? finalPrice :
          ((askingPrice && askingPrice > 0) && (v.is_for_sale === true || saleStatus === 'for_sale' || saleStatus === 'available')) ? askingPrice :
          null; // Don't show a price if we don't have actual pricing data
        const age_hours = (Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60);

        const vehicleId = String(v?.id || '');
        
        // Prioritize thumbnail/medium variants for grid performance
        const thumbnailUrl = thumbnailByVehicleId.get(vehicleId) || null;
        const mediumUrl = mediumByVehicleId.get(vehicleId) || null;
        
        // Fallback chain: medium -> thumbnail -> primary_image_url -> image_url
        // Prefer medium (600px) for sharper images; thumbnail (150px) only as fallback
        const normalizedPrimary = v.primary_image_url ? normalizeSupabaseStorageUrl(v.primary_image_url) : null;
        const normalizedImageUrl = v.image_url ? normalizeSupabaseStorageUrl(v.image_url) : null;

        // Check each candidate and only use good quality images
        const optimalImageUrl =
          (mediumUrl && !isPoorQualityImage(mediumUrl)) ? mediumUrl :
          (thumbnailUrl && !isPoorQualityImage(thumbnailUrl)) ? thumbnailUrl :
          (normalizedPrimary && !isPoorQualityImage(normalizedPrimary)) ? normalizedPrimary :
          (normalizedImageUrl && !isPoorQualityImage(normalizedImageUrl)) ? normalizedImageUrl :
          null;

        // Store both thumbnail and full-size for different use cases
        const allImages = optimalImageUrl
          ? [{ 
              id: `row-${v.id}-0`, 
              url: optimalImageUrl, 
              is_primary: true,
              thumbnail_url: thumbnailUrl,
              medium_url: mediumUrl,
              full_url: normalizeSupabaseStorageUrl(v.primary_image_url) || normalizeSupabaseStorageUrl(v.image_url) || optimalImageUrl
            }]
          : [];

        // Keep display fields simple; feed should stay fast.
        const displayMake = cleanDisplayMake(v.make) || v.make || null;
        const displayModel = cleanDisplayModel(v.model) || v.model || null;

        let hypeScore = 0;
        let hypeReason = '';

        if (age_hours < 24) {
          hypeScore += 50;
          hypeReason = 'NEW';
        }

        // Attach vehicle_events array for VehicleCardDense auction badge detection
        const externalListings = vehicleEventsByVehicleId.get(vehicleId) || [];
        
        // Derive deal/heat labels client-side from numeric scores
        const dealScore = v.deal_score != null ? Number(v.deal_score) : null;
        const heatScore = v.heat_score != null ? Number(v.heat_score) : null;
        const dealLabel = dealScore != null ? deriveDealScoreLabel(dealScore) : null;
        const heatLabel = heatScore != null
          ? (heatScore >= 80 ? 'volcanic' : heatScore >= 60 ? 'fire' : heatScore >= 40 ? 'hot' : heatScore >= 20 ? 'warm' : 'cold')
          : null;

        return {
          ...v,
          make: displayMake || v.make,
          model: displayModel || v.model,
          display_price: displayPrice,
          image_count: allImages?.length || (optimalImageUrl ? 1 : 0),
          hype_score: hypeScore,
          hype_reason: hypeReason,
          primary_image_url: optimalImageUrl,
          image_url: optimalImageUrl,
          // Store image variants for VehicleCardDense to use
          image_variants: {
            thumbnail: thumbnailUrl || undefined,
            medium: mediumUrl || undefined,
            large: normalizedPrimary || mediumUrl || optimalImageUrl || undefined,
          },
          all_images: allImages || (optimalImageUrl ? [{ id: `fallback-${v.id}-0`, url: optimalImageUrl, is_primary: true }] : []),
          // Attach vehicle_events for auction badge detection (VehicleCardDense checks vehicle_events[0] ?? external_listings[0])
          // Normalized to legacy shape for backward compatibility
          vehicle_events: externalListings.length > 0 ? externalListings : undefined,
          external_listings: externalListings.length > 0 ? externalListings : undefined, // backward compat alias
          deal_score_label: dealLabel,
          heat_score_label: heatLabel,
        };
      });

      // Filter out vehicles whose ONLY image is a known-bad placeholder/logo.
      // Vehicles with NO image at all are kept — the card component renders a placeholder.
      const sorted = processed.filter((v: any) => {
        const imageUrl = v.primary_image_url || v.image_url;
        if (!imageUrl) return true; // No image → still show (card handles placeholder)
        return !isPoorQualityImage(imageUrl); // Has image but it's junk → remove
      });

      const dedupedSorted = dedupeVehicles(sorted);

      // Boost live auctions to the top of the feed (only on initial load, page 0, default sort)
      // This ensures active/buyable vehicles appear first without breaking user-chosen sort order
      if (!append && pageNum === 0 && sortBy === 'newest') {
        dedupedSorted.sort((a: any, b: any) => {
          const aHasLiveAuction = vehicleEventsByVehicleId.has(String(a?.id || ''));
          const bHasLiveAuction = vehicleEventsByVehicleId.has(String(b?.id || ''));
          // Live auctions first, then by existing order (created_at DESC from DB)
          if (aHasLiveAuction && !bHasLiveAuction) return -1;
          if (!aHasLiveAuction && bHasLiveAuction) return 1;
          return 0; // Preserve DB order within each group
        });
      }
      
      setHasMore((vehicles || []).length >= PAGE_SIZE);
      setPage(pageNum);

      // Store the exact filtered count from the database (only on first page load, not appends)
      if (!append && totalFilteredCount !== null) {
        setServerFilteredCount(totalFilteredCount);
      }

      if (append) {
        // Append to bottom - preserve existing order, add new vehicles at end
        // This prevents jumping as new vehicles load
        setFeedVehicles((prev) => {
          const existingIds = new Set(prev.map((v: any) => String(v?.id || '')));
          const existingKeys = new Set(prev.map((v: any) => getDedupeKey(v)).filter(Boolean) as string[]);
          const newVehicles = dedupedSorted.filter((v: any) => {
            const id = String(v?.id || '');
            if (id && existingIds.has(id)) return false;
            const key = getDedupeKey(v);
            if (key && existingKeys.has(key)) return false;
            return true;
          });
          // Maintain insertion order - existing vehicles stay in place, new ones append
          return [...prev, ...newVehicles];
        });
      } else {
        // Initial load - set fresh
        setFeedVehicles(dedupedSorted);
      }

      // Batch-load organization websites for favicon stamps (no per-card calls).
      try {
        const orgIds = Array.from(
          new Set(
            (processed || [])
              .map((x: any) => x?.origin_organization_id)
              .filter((id: any) => typeof id === 'string' && id.length > 0)
          )
        );
        if (orgIds.length > 0) {
          const { data: orgs, error: orgErr } = await supabase
            .from('businesses')
            .select('id, website, business_name, business_type, logo_url, city, state')
            .in('id', orgIds);
          if (!orgErr && Array.isArray(orgs)) {
            const next: Record<string, { website: string; business_name: string; business_type: string | null; logo_url: string | null; city: string | null; state: string | null }> = {};
            for (const o of orgs as any[]) {
              if (o?.id && typeof o?.website === 'string' && o.website.trim()) {
                next[o.id] = {
                  website: o.website.trim(),
                  business_name: o.business_name || o.website.trim(),
                  business_type: o.business_type || null,
                  logo_url: o.logo_url || null,
                  city: o.city || null,
                  state: o.state || null,
                };
              }
            }
            setOrgWebsitesById(next);
          }
        }
      } catch {
        // ignore - favicon stamps can fall back to discovery_url / source mapping
      }

    } catch (error: any) {
      // Unexpected error loading feed
      setError('Something went wrong. Please try refreshing the page.');
      setFeedVehicles([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (loading || loadingMore) return;
    if (!hasMore) return;
    const nextPage = page + 1;
    await loadHypeFeed(nextPage, true);
  }, [hasMore, loading, loadingMore, page]);

  const infiniteSentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (infiniteObserverRef.current) infiniteObserverRef.current.disconnect();
    if (!node) return;

    infiniteObserverRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          void loadMore();
        }
      },
      {
        // Prefetch before the user hits the exact bottom.
        root: null,
        rootMargin: '600px',
        threshold: 0.01,
      }
    );

    infiniteObserverRef.current.observe(node);
  }, [hasMore, loadMore]);

  // Format currency values for display (exact numbers with commas)
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };


  const toggleCollapsedSection = (section: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Get active filter badges for sticky bar display
  const getActiveFilterBadges = useMemo(() => {
    const badges: Array<{ label: string; onRemove?: () => void }> = [];
    
    // Year range
    if (filters.yearMin || filters.yearMax) {
      const yearLabel = filters.yearMin && filters.yearMax
        ? `${filters.yearMin}-${filters.yearMax}`
        : filters.yearMin
        ? `${filters.yearMin}+`
        : `-${filters.yearMax}`;
      badges.push({
        label: `Year: ${yearLabel}`,
        onRemove: () => setFilters({ ...filters, yearMin: null, yearMax: null })
      });
    }
    
    // Price range
    if (filters.priceMin || filters.priceMax) {
      const min = filters.priceMin;
      const max = filters.priceMax;
      const priceLabel = (min != null && max != null)
        ? `$${min.toLocaleString()}-$${max.toLocaleString()}`
        : (min != null)
        ? `$${min.toLocaleString()}+`
        : (max != null)
        ? `-$${max.toLocaleString()}`
        : '';
      badges.push({
        label: `Price: ${priceLabel}`,
        onRemove: () => setFilters({ ...filters, priceMin: null, priceMax: null })
      });
    }
    
    // Makes
    if (filters.makes.length > 0) {
      badges.push({
        label: `Make: ${filters.makes.join(', ')}`,
        onRemove: () => setFilters({ ...filters, makes: [] })
      });
    }

    // Models
    if (filters.models && filters.models.length > 0) {
      badges.push({
        label: `Model: ${filters.models.join(', ')}`,
        onRemove: () => setFilters({ ...filters, models: [] })
      });
    }

    // Body styles / vehicle type
    if (filters.bodyStyles.length > 0) {
      badges.push({
        label: `Type: ${filters.bodyStyles.join(', ')}`,
        onRemove: () => setFilters({ ...filters, bodyStyles: [] })
      });
    }
    
    // 4x4 filter
    if (filters.is4x4) {
      badges.push({
        label: '4x4/4WD/AWD',
        onRemove: () => setFilters({ ...filters, is4x4: false })
      });
    }
    
    // Location
    if (filters.locations && filters.locations.length > 0) {
      filters.locations.forEach((loc, idx) => {
        badges.push({
          label: `Location: ${loc.zipCode} (${loc.radiusMiles}mi)`,
          onRemove: () => {
            const updated = filters.locations?.filter((_, i) => i !== idx) || [];
            setFilters({ ...filters, locations: updated });
          }
        });
      });
    } else if (filters.zipCode && filters.radiusMiles > 0) {
      badges.push({
        label: `Location: ${filters.zipCode} (${filters.radiusMiles}mi)`,
        onRemove: () => setFilters({ ...filters, zipCode: '', radiusMiles: 0 })
      });
    }
    
    // Status filters
    if (filters.forSale) {
      badges.push({
        label: 'For Sale',
        onRemove: () => setFilters({ ...filters, forSale: false })
      });
    }
    if (filters.hideSold) {
      badges.push({
        label: 'Hide Sold',
        onRemove: () => setFilters({ ...filters, hideSold: false })
      });
    }
    if (filters.showSoldOnly) {
      const periodLabel = SALES_PERIODS.find(p => p.value === salesPeriod)?.label || 'today';
      badges.push({
        label: `Sold (${periodLabel})`,
        onRemove: () => {
          setFilters({ ...filters, showSoldOnly: false });
          setSalesPeriod('today');
        }
      });
    }
    if (filters.showPending) {
      badges.push({
        label: 'Show Pending',
        onRemove: () => setFilters({ ...filters, showPending: false })
      });
    }
    if (filters.privateParty) {
      badges.push({
        label: 'Private Party',
        onRemove: () => setFilters({ ...filters, privateParty: false })
      });
    }
    if (filters.dealer) {
      badges.push({
        label: 'Dealer',
        onRemove: () => setFilters({ ...filters, dealer: false })
      });
    }
    
    // Source filters
    const sourceFilters: string[] = [];
    if (filters.hideCraigslist) sourceFilters.push('Hide CL');
    if (filters.hideBat) sourceFilters.push('Hide BaT');
    if (filters.hideKsl) sourceFilters.push('Hide KSL');
    if (filters.hideClassic) sourceFilters.push('Hide Classic');
    if (filters.hideDealerSites) sourceFilters.push('Hide Dealers');
    if (filters.hideDealerListings) sourceFilters.push('Hide Dealer Listings');
    if (sourceFilters.length > 0) {
      badges.push({
        label: sourceFilters.join(', '),
        onRemove: () => setFilters({
          ...filters,
          hideCraigslist: false,
          hideBat: false,
          hideKsl: false,
          hideClassic: false,
          hideDealerSites: false,
          hideDealerListings: false
        })
      });
    }
    
    return badges;
  }, [filters]);

  // Source pogs are "include chips": if it's in your set, you see those vehicles.
  // We keep legacy `hide*` flags for now, but treat them as derived from "included chips".
  // For new dynamic sources, we use a hiddenSources set in filters.
  const setSourceIncluded = useCallback((kind: string, included: boolean) => {

    setFilters((prev) => {
      // This legacy flag conflicts with per-source toggles (it hides CL + dealer sites + KSL).
      // For the new "pogs" interaction model, we treat sources as independent, so we clear it
      // whenever the user explicitly picks/changes a source.
      const base = { ...prev, hideDealerListings: false };

      // Handle legacy sources
      switch (kind) {
        case 'craigslist':
          return { ...base, hideCraigslist: !included };
        case 'dealer_site':
          return { ...base, hideDealerSites: !included };
        case 'ksl':
          return { ...base, hideKsl: !included };
        case 'bat':
          return { ...base, hideBat: !included };
        case 'classic':
          return { ...base, hideClassic: !included };
        default:
          // For new dynamic sources, use hiddenSources set
          const hiddenSources = new Set(prev.hiddenSources || []);
          if (!included) {
            hiddenSources.add(kind);
          } else {
            hiddenSources.delete(kind);
          }
          return { ...base, hiddenSources: Array.from(hiddenSources) };
      }
    });
  }, []); // setFilters functional form doesn't need external dependencies

  const openFiltersFromMiniBar = useCallback(() => {
    suppressAutoMinimizeUntilRef.current = Date.now() + 1200;
    lastScrollYRef.current = window.scrollY;
    setFilterBarMinimized(false);
    setShowFilters(true);
    window.requestAnimationFrame(() => {
      filterPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const toggleAddedTodayOnly = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      addedTodayOnly: !prev.addedTodayOnly,
    }));
    setSortBy('newest');
    setSortDirection('desc');
  }, []);

  // Toggle sold-only filter and cycle through time periods
  const toggleShowSoldOnly = useCallback(() => {
    setFilters((prev) => {
      if (!prev.showSoldOnly) {
        // Turning ON sold filter - also turn off conflicting filters
        return {
          ...prev,
          showSoldOnly: true,
          hideSold: false, // Can't hide sold when showing only sold
          forSale: false, // Sold items aren't for sale
        };
      } else {
        // Already showing sold - cycle to next time period OR turn off if at end
        const currentIndex = SALES_PERIODS.findIndex(p => p.value === salesPeriod);
        const nextIndex = currentIndex + 1;
        if (nextIndex < SALES_PERIODS.length) {
          // Cycle to next period
          setSalesPeriod(SALES_PERIODS[nextIndex].value);
          return prev; // Keep filter on
        } else {
          // At end of periods - turn off filter and reset to 'today'
          setSalesPeriod('today');
          return { ...prev, showSoldOnly: false };
        }
      }
    });
    setSortBy('newest'); // Sort by most recent sale
    setSortDirection('desc');
  }, [salesPeriod]);

  // Toggle for-sale filter (sort is left unchanged; user controls order via sort dropdown)
  const toggleForSale = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      forSale: !prev.forSale,
      showSoldOnly: false, // Can't show sold when filtering for sale
      hideSold: !prev.forSale ? true : prev.hideSold, // Hide sold when showing for sale
    }));
  }, []);

  const openStatsPanel = useCallback((kind: StatsPanelKind) => {
    setStatsPanel(kind);
  }, []);

  const closeStatsPanel = useCallback(() => {
    setStatsPanel(null);
  }, []);

  // Show grid immediately - no loading state blocking
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingTop: '16px' }}>
      {statsPanel && (
        <StatsPanelOverlay
          statsPanel={statsPanel}
          statsPanelLoading={statsPanelLoading}
          statsPanelError={statsPanelError}
          statsPanelMeta={statsPanelMeta}
          statsPanelRows={statsPanelRows}
          displayStats={displayStats}
          valueMetricMode={valueMetricMode}
          setValueMetricMode={setValueMetricMode}
          closeStatsPanel={closeStatsPanel}
          toggleAddedTodayOnly={toggleAddedTodayOnly}
          toggleShowSoldOnly={toggleShowSoldOnly}
          formatCurrency={formatCurrency}
        />
      )}
      {/* Feed Section - No stats, no filters, just vehicles */}
      <div style={{
        maxWidth: '1600px',
        margin: '0 auto',
        padding: '0 16px'
      }}>

        {/* Sticky Minimized Filter Bar */}
        {filterBarMinimized && (
          <FeedStatsBar
            displayStats={displayStats}
            salesByPeriod={salesByPeriod}
            hasActiveFilters={hasActiveFilters}
            debouncedSearchText={debouncedSearchText}
            filters={filters}
            activeFilterCount={activeFilterCount}
            getActiveFilterBadges={getActiveFilterBadges}
            sourcePogs={sourcePogs}
            sortBy={sortBy}
            setSortBy={setSortBy}
            setSortDirection={setSortDirection}
            statsPanel={statsPanel}
            cardsPerRow={cardsPerRow}
            setCardsPerRow={setCardsPerRow}
            thumbFitMode={thumbFitMode}
            setThumbFitMode={setThumbFitMode}
            openFiltersFromMiniBar={openFiltersFromMiniBar}
            setShowRecentlyAddedPanel={setShowRecentlyAddedPanel}
            toggleForSale={toggleForSale}
            setShowActiveAuctionsPanel={setShowActiveAuctionsPanel}
            setShowFBMarketplacePanel={setShowFBMarketplacePanel}
            openStatsPanel={openStatsPanel}
            setFilters={setFilters}
            setSearchText={setSearchText}
            setSourceIncluded={setSourceIncluded}
            formatCurrency={formatCurrency}
            faviconUrl={faviconUrl}
            domainGradient={domainGradient}
            DEFAULT_FILTERS={DEFAULT_FILTERS}
          />
        )}

        {/* Stats bar is ALWAYS visible - removed minimal "Show Filters" fallback */}

        {/* Filter Panel */}
        {showFilters && (
          <FeedFilterPanel
            filterPanelRef={filterPanelRef}
            filters={filters}
            setFilters={setFilters}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={activeFilterCount}
            searchText={searchText}
            setSearchText={setSearchText}
            debouncedSearchText={debouncedSearchText}
            displayStats={displayStats}
            salesByPeriod={salesByPeriod}
            sourcePogs={sourcePogs}
            sourceCounts={sourceCounts}
            activeSources={activeSources}
            sourceSearchText={sourceSearchText}
            setSourceSearchText={setSourceSearchText}
            includedSources={includedSources}
            setSourceIncluded={setSourceIncluded}
            makeSearchText={makeSearchText}
            setMakeSearchText={setMakeSearchText}
            showMakeSuggestions={showMakeSuggestions}
            setShowMakeSuggestions={setShowMakeSuggestions}
            makeSuggestionIndex={makeSuggestionIndex}
            setMakeSuggestionIndex={setMakeSuggestionIndex}
            availableMakes={availableMakes}
            makeInputRef={makeInputRef}
            modelSearchText={modelSearchText}
            setModelSearchText={setModelSearchText}
            showModelSuggestions={showModelSuggestions}
            setShowModelSuggestions={setShowModelSuggestions}
            modelSuggestionIndex={modelSuggestionIndex}
            setModelSuggestionIndex={setModelSuggestionIndex}
            availableModels={availableModels}
            availableBodyStyles={availableBodyStyles}
            modelInputRef={modelInputRef}
            collapsedSections={collapsedSections}
            toggleCollapsedSection={toggleCollapsedSection}
            setShowFilters={setShowFilters}
            setFilterBarMinimized={setFilterBarMinimized}
            cardsPerRow={cardsPerRow}
            setCardsPerRow={setCardsPerRow}
            rememberFilters={rememberFilters}
            setRememberFilters={setRememberFilters}
            currentZip={currentZip}
            setCurrentZip={setCurrentZip}
            currentRadius={currentRadius}
            setCurrentRadius={setCurrentRadius}
            locationFavorites={locationFavorites}
            setLocationFavorites={setLocationFavorites}
            toggleForSale={toggleForSale}
            openStatsPanel={openStatsPanel}
            formatCurrency={formatCurrency}
            faviconUrl={faviconUrl}
            domainGradient={domainGradient}
            domainToFilterKey={domainToFilterKey}
            setShowRecentlyAddedPanel={setShowRecentlyAddedPanel}
            setShowActiveAuctionsPanel={setShowActiveAuctionsPanel}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            statsPanel={statsPanel}
          />
        )}
        {/* Show skeleton grid while loading */}
        {loading && filteredVehicles.length === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', padding: '8px 0' }}>
            <style>{`@keyframes cursor-sk-pulse { 0%,100%{opacity:.6} 50%{opacity:.3} }`}</style>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden', background: 'var(--surface)' }}>
                <div style={{ width: '100%', paddingBottom: '75%', background: 'var(--border)', animation: 'cursor-sk-pulse 1.5s ease-in-out infinite' }} />
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ height: 12, background: 'var(--border)', borderRadius: 2, marginBottom: 6, width: '65%', animation: 'cursor-sk-pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ height: 9, background: 'var(--border)', borderRadius: 2, width: '40%', animation: 'cursor-sk-pulse 1.5s ease-in-out infinite' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Technical View with Sortable Columns */}
        {viewMode === 'technical' && (
          <FeedTableView
            vehicles={filteredVehicles}
            sortBy={sortBy}
            sortDirection={sortDirection}
            setSortBy={setSortBy}
            setSortDirection={setSortDirection}
          />
        )}

        {/* Feed Grid — Gallery + Grid views with hover intelligence */}
        <FeedGrid
          vehiclesToRender={vehiclesToRender}
          filteredVehicles={filteredVehicles}
          feedVehicles={feedVehicles}
          viewMode={viewMode}
          cardsPerRow={cardsPerRow}
          gridCardSizePx={gridCardSizePx}
          thumbFitMode={thumbFitMode}
          thermalPricing={thermalPricing}
          infoDense={infoDense}
          session={session}
          orgWebsitesById={orgWebsitesById}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          error={error}
          isRenderTruncated={isRenderTruncated}
          filteredRenderLimit={filteredRenderLimit}
          setFilteredRenderLimit={setFilteredRenderLimit}
          FILTERED_RENDER_STEP={FILTERED_RENDER_STEP}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
          gridRef={gridRef}
          infiniteSentinelRef={infiniteSentinelRef}
        />
      </div>
      
      <ScrollToTopButton visible={showScrollTop} />

      {/* Active Auctions Panel - Enhanced with countdown timers, bid counts, and market analytics */}
      {showActiveAuctionsPanel && (
        <ActiveAuctionsPanel
          onClose={() => setShowActiveAuctionsPanel(false)}
          onNavigateToVehicle={(vehicleId) => {
            navigate(`/vehicle/${vehicleId}`);
          }}
        />
      )}

      {/* FB Marketplace Panel - Live feed of classic cars from Facebook */}
      {showFBMarketplacePanel && (
        <FBMarketplacePanel
          onClose={() => setShowFBMarketplacePanel(false)}
        />
      )}

      {/* Recently Added Panel - Analytics for newly imported vehicles */}
      {showRecentlyAddedPanel && (
        <RecentlyAddedPanel
          onClose={() => setShowRecentlyAddedPanel(false)}
          vehicles={feedVehicles}
          orgInfoById={orgWebsitesById}
          onNavigateToVehicle={(id) => navigate(`/vehicle/${id}`)}
          onFilterMainView={() => { toggleAddedTodayOnly(); setShowRecentlyAddedPanel(false); }}
        />
      )}

    </div>
  );
};

export default CursorHomepage;
