import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase, SUPABASE_URL } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { UserInteractionService } from '../services/userInteractionService';
import { usePageTitle } from '../hooks/usePageTitle';
import { getCanonicalBodyStyle } from '../services/bodyStyleTaxonomy';
import { getBodyStyleDisplay } from '../services/bodyStyleTaxonomy';
import { parseMoneyNumber } from '../lib/auctionUtils';
import { preloadImageBatch, optimizeImageUrl } from '../lib/imageOptimizer';
import ActiveAuctionsPanel from '../components/dashboard/ActiveAuctionsPanel';
import FBMarketplacePanel from '../components/dashboard/FBMarketplacePanel';
// import { ValueTrendsPanel } from '../components/charts'; // Temporarily disabled - import bug

interface HypeVehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  series?: string | null;
  trim?: string | null;
  engine?: string | null;
  transmission?: string | null;
  transmission_model?: string | null;
  drivetrain?: string | null;
  body_style?: string | null;
  canonical_body_style?: string | null;
  canonical_vehicle_type?: string | null;
  fuel_type?: string | null;
  current_value?: number;
  purchase_price?: number;
  sale_price?: number;
  sale_status?: string;
  sale_date?: string;
  asking_price?: number;
  display_price?: number; // Computed smart price
  roi_pct?: number;
  image_count?: number;
  event_count?: number;
  activity_7d?: number;
  view_count?: number;
  primary_image_url?: string;
  hype_score?: number;
  hype_reason?: string;
  created_at?: string;
  updated_at?: string;
  image_url?: string;
  mileage?: number;
  vin?: string;
  is_for_sale?: boolean;
  bid_count?: number;
  auction_outcome?: string;
  all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
  origin_metadata?: any;
  discovery_url?: string | null;
  discovery_source?: string | null;
  profile_origin?: string | null;
  origin_organization_id?: string | null;
  listing_start_date?: string;
}

type TimePeriod = 'ALL' | 'AT' | '1Y' | 'Q' | 'W' | 'D' | 'RT';
type SalesTimePeriod = 'today' | '7d' | '30d' | '90d' | '1y' | '3y' | '5y' | '10y' | 'all';
type ViewMode = 'gallery' | 'grid' | 'technical';

const SALES_PERIODS: { value: SalesTimePeriod; label: string; days: number | null }[] = [
  { value: 'today', label: 'today', days: 1 },
  { value: '7d', label: '7d', days: 7 },
  { value: '30d', label: '30d', days: 30 },
  { value: '90d', label: '90d', days: 90 },
  { value: '1y', label: '1y', days: 365 },
  { value: '3y', label: '3y', days: 365 * 3 },
  { value: '5y', label: '5y', days: 365 * 5 },
  { value: '10y', label: '10y', days: 365 * 10 },
  { value: 'all', label: 'all', days: null },
];
type SortBy = 'year' | 'make' | 'model' | 'mileage' | 'newest' | 'oldest' | 'popular' | 'price_high' | 'price_low' | 'volume' | 'images' | 'events' | 'views';
type SortDirection = 'asc' | 'desc';

const getDisplayPriceValue = (vehicle: HypeVehicle | null | undefined): number | null => {
  if (!vehicle) return null;
  return parseMoneyNumber((vehicle as any).display_price);
};

const DEBUG_CURSOR_HOMEPAGE = import.meta.env.DEV;

/**
 * Image URL normalization for feed cards.
 *
 * We have a mix of legacy/public URLs, occasionally-stored signed URLs, and sometimes raw storage paths.
 * The homepage must never prefer expiring signed URLs (they break image loading in production).
 */
const parseVariants = (variants: any): Record<string, string> | null => {
  if (!variants) return null;
  if (typeof variants === 'object') return variants as Record<string, string>;
  if (typeof variants === 'string') {
    try {
      const parsed = JSON.parse(variants);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
    } catch {
      // ignore parse failures
    }
  }
  return null;
};

const normalizeSupabaseStorageUrl = (raw: any): string | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Convert signed URLs to stable public URLs (strip token and swap path segment).
  // Signed:  .../storage/v1/object/sign/<bucket>/<path>?token=...
  // Public:  .../storage/v1/object/public/<bucket>/<path>
  if (s.includes('/storage/v1/object/sign/')) {
    const base = s.split('?')[0];
    const publicUrl = base.replace('/storage/v1/object/sign/', '/storage/v1/object/public/');
    // Some code paths store path-only URLs (starting with /storage/...). Prefix with Supabase host.
    if (SUPABASE_URL && publicUrl.startsWith('/storage/')) return `${SUPABASE_URL}${publicUrl}`;
    return publicUrl;
  }

  // If a path-only Supabase storage URL is stored, prefix with Supabase host so it loads cross-origin.
  if (SUPABASE_URL && s.startsWith('/storage/')) return `${SUPABASE_URL}${s}`;

  return s;
};

const isUsableImageSrc = (url: string | null): url is string => {
  if (!url) return false;
  return (
    url.startsWith('https://') ||
    url.startsWith('http://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('/')
  );
};

const getPublicUrlFromStoragePath = (storagePath: any): string | null => {
  if (!storagePath) return null;
  const path = String(storagePath).replace(/^\/+/, '').trim();
  if (!path) return null;

  // Heuristic: canonical bucket uses `vehicles/...` prefixed paths.
  const preferBucket = path.startsWith('vehicles/') ? 'vehicle-data' : 'vehicle-images';
  const altBucket = preferBucket === 'vehicle-data' ? 'vehicle-images' : 'vehicle-data';

  try {
    const { data: preferred } = supabase.storage.from(preferBucket).getPublicUrl(path);
    if (preferred?.publicUrl) return preferred.publicUrl;
  } catch {
    // ignore
  }
  try {
    const { data: alt } = supabase.storage.from(altBucket).getPublicUrl(path);
    return alt?.publicUrl || null;
  } catch {
    return null;
  }
};

const resolveVehicleImageUrl = (img: any): string | null => {
  if (!img) return null;

  const variants = parseVariants(img.variants);
  const candidates = [
    variants?.large,
    variants?.medium,
    variants?.full,
    variants?.thumbnail,
    img.large_url,
    img.medium_url,
    img.image_url,
    img.thumbnail_url,
    getPublicUrlFromStoragePath(img.storage_path),
  ];

  for (const c of candidates) {
    const normalized = normalizeSupabaseStorageUrl(c);
    if (isUsableImageSrc(normalized)) return normalized;
  }

  return null;
};

const getOriginImages = (vehicle: any): string[] => {
  // Different ingestion paths have used different keys over time.
  // Prefer `images` but also support `image_urls` (used by import/backfill pipelines).
  const raw = vehicle?.origin_metadata?.images || vehicle?.origin_metadata?.image_urls;
  const list = Array.isArray(raw) ? raw : [];

  // Some scrapers store a single thumbnail URL rather than an array.
  const thumb =
    (typeof vehicle?.origin_metadata?.thumbnail_url === 'string' && vehicle.origin_metadata.thumbnail_url) ||
    (typeof vehicle?.origin_metadata?.thumbnail === 'string' && vehicle.origin_metadata.thumbnail) ||
    null;

  const candidates = [
    ...(thumb ? [thumb] : []),
    ...list,
  ];

  return candidates
    .filter((url: any) => typeof url === 'string')
    .map((url: string) => url.trim())
    .filter((url: string) => url.startsWith('http'))
    // Keep the filters minimal: we want *something* to render on the homepage.
    .filter((url: string) => !url.includes('youtube.com'))
    .filter((url: string) => !url.toLowerCase().endsWith('.svg'));
};

const cleanDisplayMake = (raw: any): string | null => {
  if (!raw) return null;
  const s = String(raw).replace(/[/_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s === '*' || s.length > 40) return null;
  // Basic title-case unless it's already all-caps.
  if (s.toUpperCase() === s && s.length <= 6) return s;
  return s
    .split(' ')
    .map((p) => (p.length <= 2 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join(' ');
};

const cleanDisplayModel = (raw: any): string | null => {
  if (!raw) return null;
  let s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // Strip common listing junk: " - $12,999 (City)" / "(Dealer Name)" / finance blips.
  s = s.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?.*$/i, '').trim();
  s = s.replace(/\s*\([^)]*\)\s*$/i, '').trim();
  s = s.replace(/\s*\(\s*Est\.\s*payment.*$/i, '').trim();
  // Remove trailing "- craigslist" from <title> tags, if it leaked into model.
  s = s.replace(/\s*-\s*craigslist\b.*$/i, '').trim();
  if (!s || s.length > 120) return null;
  return s;
};

// Simple static verb - no animation to avoid performance issues
const StaticVerbText = React.memo(function StaticVerbText() {
  return <>Building</>;
});

interface FilterState {
  yearMin: number | null;
  yearMax: number | null;
  makes: string[];
  models: string[]; // Models filter (after make is selected)
  bodyStyles: string[]; // Car types: Coupe, Sedan, Pickup, SUV, etc.
  is4x4: boolean; // 4WD/4x4/AWD filter
  priceMin: number | null;
  priceMax: number | null;
  hasImages: boolean;
  addedTodayOnly: boolean; // Only vehicles created today
  forSale: boolean;
  hideSold: boolean;
  showSoldOnly: boolean; // Filter to show ONLY sold vehicles (for sold stats view)
  privateParty: boolean; // Filter for private party listings
  dealer: boolean; // Filter for dealer listings
  // Source / dealer-ish filters
  hideDealerListings: boolean;
  hideCraigslist: boolean;
  hideDealerSites: boolean;
  hideKsl: boolean;
  hideBat: boolean;
  hideClassic: boolean;
  hiddenSources?: string[]; // For dynamic sources not in legacy filters
  zipCode: string; // Legacy single location - keep for compatibility
  radiusMiles: number;
  locations: Array<{ zipCode: string; radiusMiles: number; label?: string }>; // Multiple locations
  showPending: boolean;
}

type RalphHomepagePreset = {
  label: string;
  filters: Partial<FilterState>;
  rationale?: string;
};

const DEFAULT_FILTERS: FilterState = {
  yearMin: null,
  yearMax: null,
  makes: [],
  models: [],
  bodyStyles: [],
  is4x4: false,
  priceMin: null,
  priceMax: null,
  hasImages: false,
  addedTodayOnly: false,
  forSale: false,
  hideSold: false,
  showSoldOnly: false,
  privateParty: false,
  dealer: false,
  hideDealerListings: false,
  hideCraigslist: false,
  hideDealerSites: false,
  hideKsl: false,
  hideBat: false,
  hideClassic: false,
  hiddenSources: [],
  zipCode: '',
  radiusMiles: 50, // Default to 50 miles as requested
  locations: [],
  showPending: false
};

const STORAGE_KEY = 'nuke_homepage_filters_v1';
const LOCATION_FAVORITES_KEY = 'nuke_homepage_location_favorites';

// Load filters from localStorage
const loadSavedFilters = (): FilterState | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    // Validate structure and merge with defaults for safety
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return null;
  }
};

// Save filters to localStorage
const saveFilters = (filters: FilterState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (err) {
    console.warn('Failed to save filters to localStorage:', err);
  }
};

type SourceKind = 'craigslist' | 'dealer_site' | 'ksl' | 'bat' | 'classic' | 'user' | 'unknown';

const SOURCE_META: Record<string, { title: string; domain: string }> = {
  craigslist: { title: 'Craigslist', domain: 'craigslist.org' },
  ksl: { title: 'KSL', domain: 'ksl.com' },
  bat: { title: 'Bring a Trailer', domain: 'bringatrailer.com' },
  classic: { title: 'Classic.com', domain: 'classic.com' },
  dealer_site: { title: 'Dealer Sites', domain: 'autotrader.com' },
};

const normalizeHost = (url: string | null | undefined): string => {
  try {
    if (!url) return '';
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    // Sometimes stored URLs are missing protocol; fall back to a cheap parse.
    const s = String(url || '').trim().toLowerCase();
    const m = s.match(/^(?:https?:\/\/)?([^/]+)/i);
    return (m?.[1] || '').replace(/^www\./, '').toLowerCase();
  }
};

const normalizeAlias = (value: string | null | undefined): string => {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
};

const stripTld = (host: string): string => {
  const parts = String(host || '').split('.');
  if (parts.length <= 1) return host;
  return parts.slice(0, -1).join('.');
};

const classifySource = (v: any): SourceKind => {
  const origin = String(v?.profile_origin || '').trim().toLowerCase();
  const discoverySource = String(v?.discovery_source || '').trim().toLowerCase();
  const discoveryUrl = String(v?.discovery_url || '').trim().toLowerCase();
  const host = normalizeHost(v?.discovery_url || null);

  // Craigslist
  if (origin === 'craigslist_scrape' || host.includes('craigslist.org') || discoveryUrl.includes('craigslist.org') || discoverySource.includes('craigslist')) {
    return 'craigslist';
  }
  // KSL
  if (origin === 'ksl_import' || host === 'ksl.com' || host.endsWith('.ksl.com') || discoveryUrl.includes('ksl.com') || discoverySource.includes('ksl')) {
    return 'ksl';
  }
  // BaT (auction)
  if (origin === 'bat_import' || host.includes('bringatrailer.com') || discoveryUrl.includes('bringatrailer.com/listing') || discoverySource.includes('bat')) {
    return 'bat';
  }
  // Classic.com
  if (origin === 'classic_com_indexing' || host === 'classic.com' || host.endsWith('.classic.com') || discoveryUrl.includes('classic.com') || discoverySource.includes('classic')) {
    return 'classic';
  }
  // Mecum
  if (discoveryUrl.includes('mecum.com') || discoverySource.includes('mecum')) {
    return 'dealer_site'; // Treat as dealer for filtering purposes
  }
  // Generic dealer site scrape or organization imports
  if (origin === 'url_scraper' || origin === 'organization_import' || origin.includes('dealer')) {
    return 'dealer_site';
  }
  // Other imports (dropbox, agent, pcarmarket, classiccars)
  if (origin.includes('import')) {
    return 'dealer_site'; // Treat imports as dealer sites
  }
  // User-ish
  if (!origin || origin === 'user_upload' || origin === 'user_uploaded' || origin === 'manual' || origin === 'manual_entry' || origin === 'user_import') {
    return 'user';
  }
  return 'unknown';
};

const CursorHomepage: React.FC = () => {
  usePageTitle('n-zero');
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('ALL'); // Default to ALL - no time filtering
  const [salesPeriod, setSalesPeriod] = useState<SalesTimePeriod>('today'); // For "sold" stats display
  const [viewMode, setViewMode] = useState<ViewMode>('grid'); // Always grid mode
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    try {
      const saved = localStorage.getItem('nuke_homepage_sortBy');
      return (saved as SortBy) || 'newest';
    } catch {
      return 'newest';
    }
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    try {
      const saved = localStorage.getItem('nuke_homepage_sortDirection');
      return (saved as SortDirection) || 'desc';
    } catch {
      return 'desc';
    }
  });
  const [showFilters, setShowFilters] = useState<boolean>(true); // Filter bar visible, individual sections start collapsed
  const [generativeFilters, setGenerativeFilters] = useState<string[]>([]); // Track active generative filters
  // Start with completely clean filters - no saved state, no defaults
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState<string>(() => {
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
  const listingKindSupportedRef = useRef<boolean>(true);
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
  // ARCHIVED: Thermal pricing - disabled until we're more capable of handling it
  // const [thermalPricing, setThermalPricing] = useState<boolean>(() => {
  //   try {
  //     const saved = localStorage.getItem('nuke_homepage_thermalPricing');
  //     return saved === 'true';
  //   } catch {
  //     return false;
  //   }
  // });
  const thermalPricing = false; // Always disabled
  const [stats, setStats] = useState({
    totalBuilds: 0,
    totalValue: 0,
    activeToday: 0
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [filterBarMinimized, setFilterBarMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [ralphPresets, setRalphPresets] = useState<RalphHomepagePreset[]>([]);
  const [ralphLoading, setRalphLoading] = useState(false);
  const [ralphError, setRalphError] = useState<string | null>(null);
  type StatsPanelKind = 'vehicles' | 'value' | 'for_sale' | 'sold_today' | 'auctions';
  const [statsPanel, setStatsPanel] = useState<StatsPanelKind | null>(null);
  const [statsPanelLoading, setStatsPanelLoading] = useState(false);
  const [statsPanelError, setStatsPanelError] = useState<string | null>(null);
  const [statsPanelRows, setStatsPanelRows] = useState<any[]>([]);
  const [statsPanelMeta, setStatsPanelMeta] = useState<any>(null);
  const [showActiveAuctionsPanel, setShowActiveAuctionsPanel] = useState(false);
  const [showFBMarketplacePanel, setShowFBMarketplacePanel] = useState(false);
  const [orgWebsitesById, setOrgWebsitesById] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef<number>(0);
  const suppressAutoMinimizeUntilRef = useRef<number>(0);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const infiniteObserverRef = useRef<IntersectionObserver | null>(null);

  // Collapsible filter sections
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    sourceFilters: true, // Source filters collapsed by default
    sourcePogs: true, // Source pogs library collapsed by default
    makeFilters: true, // Make filters collapsed by default
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

  // Available makes from database for autocomplete
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [availableBodyStyles, setAvailableBodyStyles] = useState<string[]>([]);

  // Model filter state (shown after make is selected)
  const [modelSearchText, setModelSearchText] = useState('');
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);
  const [modelSuggestionIndex, setModelSuggestionIndex] = useState(-1);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const homepageDebugEnabled =
    DEBUG_CURSOR_HOMEPAGE &&
    typeof window !== 'undefined' &&
    (() => {
      try {
        return window.localStorage.getItem('nuke_debug_homepage') === '1';
      } catch {
        return false;
      }
    })();

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
    
    // #region agent log
    if (homepageDebugEnabled) {
      console.log('[DEBUG] hasActiveFilters computed', {
        result,
        filterFlags: {
          hideBat: filters.hideBat,
          hideCraigslist: filters.hideCraigslist,
          hideKsl: filters.hideKsl,
          hideDealerSites: filters.hideDealerSites,
          hideClassic: filters.hideClassic,
          hideDealerListings: filters.hideDealerListings,
          hiddenSources: filters.hiddenSources
        }
      });
      // Debug telemetry disabled in production
    }
    // #endregion
    
    return result;
  }, [filters]);

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

  // Load available makes and body styles for autocomplete
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const normalizeMake = (raw: unknown): string | null => {
          let s = String(raw ?? '').trim();
          if (!s) return null;

          // Reject extreme lengths (garbage blobs / truncated scrape junk)
          if (s.length < 2 || s.length > 30) return null;

          // If digits exist, the make field is often polluted with model/trim (e.g., "GMC K10", "AM General M35A2").
          // Salvage the leading alphabetic portion up to (but not including) the first token containing digits.
          if (/\d/.test(s)) {
            const parts = s.split(/\s+/).filter(Boolean);
            const keep: string[] = [];
            for (const p of parts) {
              if (/\d/.test(p)) break;
              keep.push(p);
            }
            const candidate = keep.join(' ').trim();
            if (!candidate) return null; // Pure numeric / model-only junk
            s = candidate;
          }

          // Reject emoji / special unicode ranges commonly seen in corrupted fields
          if (/[\u{1F300}-\u{1F9FF}]/u.test(s)) return null;

          // Reject common scraped phrase patterns that indicate this isn't a make
          if (/\b(for|with|powered|swap|engine|manual|auto|awd|4x4|parts|project)\b/i.test(s)) return null;

          // Only allow simple make tokens: letters, spaces, hyphen, apostrophe, period
          // Examples: "Aston Martin", "Mercedes-Benz", "Rolls-Royce", "AM General"
          if (!/^[A-Za-z][A-Za-z .'-]*$/.test(s)) return null;

          const cleaned = s.replace(/\s+/g, ' ').trim();
          const words = cleaned.split(' ').filter(Boolean);
          if (words.length > 3) return null;

          return cleaned;
        };

        // Prefer canonical makes if the nomenclature system is present.
        // This prevents UI from being polluted by scraper-corrupted `vehicles.make` values.
        const canonicalMakes: string[] = [];
        try {
          const { data: canonicalData, error: canonicalError } = await supabase
            .from('canonical_makes')
            .select('display_name, canonical_name, is_active')
            .eq('is_active', true)
            .limit(5000);

          if (!canonicalError && canonicalData) {
            for (const row of canonicalData as any[]) {
              const display = String(row?.display_name || '').trim();
              const canon = String(row?.canonical_name || '').trim();
              const name = display || canon;
              if (name) canonicalMakes.push(name);
            }
          }
        } catch {
          // ignore: canonical tables may not exist in some environments
        }

        // Also load distinct makes from vehicles as a fallback / augmentation.
        // We only keep "clean-looking" makes that appear more than once to reduce junk.
        const { data: makeData } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
          let q = supabase
            .from('vehicles')
            .select('make')
            .eq('is_public', true);
          if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
          return q
            .not('make', 'is', null)
            .limit(5000);
        });

        const makeCounts = new Map<string, number>();
        for (const row of (makeData || []) as any[]) {
          const cleaned = normalizeMake(row?.make);
          if (!cleaned) continue;
          makeCounts.set(cleaned, (makeCounts.get(cleaned) || 0) + 1);
        }

        const frequentVehicleMakes = Array.from(makeCounts.entries())
          .filter(([, count]) => count >= 2)
          .map(([make]) => make);

        // Merge canonical + frequent vehicle makes, case-insensitive.
        const merged = [...canonicalMakes, ...frequentVehicleMakes];
        const seenLower = new Set<string>();
        const uniqueMakes: string[] = [];
        for (const m of merged) {
          const cleaned = String(m || '').trim();
          if (!cleaned) continue;
          const key = cleaned.toLowerCase();
          if (seenLower.has(key)) continue;
          seenLower.add(key);
          uniqueMakes.push(cleaned);
        }
        uniqueMakes.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setAvailableMakes(uniqueMakes);

        // Prefer canonical body styles if the taxonomy tables are present.
        // This keeps filter UI stable even when `vehicles.body_style` is polluted.
        const canonicalBodyStyles: string[] = [];
        try {
          const { data: canonBody, error: canonBodyErr } = await supabase
            .from('canonical_body_styles')
            .select('display_name, canonical_name, is_active')
            .eq('is_active', true)
            .limit(5000);
          if (!canonBodyErr && Array.isArray(canonBody)) {
            for (const row of canonBody as any[]) {
              const display = String(row?.display_name || '').trim();
              const canon = String(row?.canonical_name || '').trim();
              const name = display || canon;
              if (name) canonicalBodyStyles.push(name);
            }
          }
        } catch {
          // ignore: canonical tables may not exist in some environments
        }

        // Fallback: load raw body_style values from vehicles and normalize to display buckets.
        const { data: bodyData } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
          let q = supabase
            .from('vehicles')
            .select('body_style')
            .eq('is_public', true);
          if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
          return q
            .not('body_style', 'is', null)
            .limit(5000);
        });

        const counts = new Map<string, number>();
        for (const row of (bodyData || []) as any[]) {
          const raw = row?.body_style;
          const display = getBodyStyleDisplay(raw) || String(raw || '').trim();
          if (!display) continue;
          counts.set(display, (counts.get(display) || 0) + 1);
        }
        const frequentVehicleBodyStyles = Array.from(counts.entries())
          .filter(([, ct]) => ct >= 2)
          .map(([name]) => name);

        // Merge canonical + frequent, case-insensitive.
        const mergedBody = [...canonicalBodyStyles, ...frequentVehicleBodyStyles];
        const seenBody = new Set<string>();
        const uniqueBody: string[] = [];
        for (const s of mergedBody) {
          const cleaned = String(s || '').trim();
          if (!cleaned) continue;
          const key = cleaned.toLowerCase();
          if (seenBody.has(key)) continue;
          seenBody.add(key);
          uniqueBody.push(cleaned);
        }
        uniqueBody.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setAvailableBodyStyles(uniqueBody);
      } catch (err) {
        console.error('Error loading filter options:', err);
      }
    };

    loadFilterOptions();
  }, []);

  // Save filters to localStorage whenever they change
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  // Load available models when makes are selected
  useEffect(() => {
    const loadModelsForMakes = async () => {
      if (!filters.makes || filters.makes.length === 0) {
        setAvailableModels([]);
        return;
      }
      try {
        // Query models for selected makes
        const { data: modelData } = await supabase
          .from('vehicles')
          .select('model')
          .eq('is_public', true)
          .in('make', filters.makes)
          .not('model', 'is', null)
          .limit(500);

        if (modelData && Array.isArray(modelData)) {
          const modelCounts = new Map<string, number>();
          for (const row of modelData as any[]) {
            const model = String(row?.model || '').trim();
            if (model && model.length > 0 && model.length < 100) {
              modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
            }
          }
          // Sort by frequency, then alphabetically
          const sortedModels = Array.from(modelCounts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([model]) => model);
          setAvailableModels(sortedModels);
        }
      } catch (err) {
        console.error('Error loading models for makes:', err);
      }
    };
    loadModelsForMakes();
  }, [filters.makes]);

  // Save other filter-related state
  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_searchText', searchText);
    } catch (err) {
      console.warn('Failed to save search text:', err);
    }
  }, [searchText]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_sortBy', sortBy);
    } catch (err) {
      console.warn('Failed to save sortBy:', err);
    }
  }, [sortBy]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_sortDirection', sortDirection);
    } catch (err) {
      console.warn('Failed to save sortDirection:', err);
    }
  }, [sortDirection]);

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
      console.warn('Failed to save showFilters:', err);
    }
  }, [showFilters]);

  // ARCHIVED: Thermal pricing localStorage
  // useEffect(() => {
  //   try {
  //     localStorage.setItem('nuke_homepage_thermalPricing', String(thermalPricing));
  //   } catch (err) {
  //     console.warn('Failed to save thermalPricing:', err);
  //   }
  // }, [thermalPricing]);

  // Debounce search to avoid clanky re-filtering on every keystroke.
  // Also parse intelligent patterns like year ranges (1970-1975), single years (1970), etc.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = searchText.trim();

      // Check for year range pattern: "1970-1975" or "1970-1970"
      const yearRangeMatch = trimmed.match(/^(\d{4})\s*[-–—to]\s*(\d{4})$/i);
      if (yearRangeMatch) {
        const yearMin = parseInt(yearRangeMatch[1], 10);
        const yearMax = parseInt(yearRangeMatch[2], 10);
        if (yearMin >= 1900 && yearMin <= 2030 && yearMax >= 1900 && yearMax <= 2030) {
          // Apply as year filter instead of text search
          setFilters(prev => ({ ...prev, yearMin, yearMax }));
          setDebouncedSearchText(''); // Clear text search since we're using year filter
          return;
        }
      }

      // Check for single year pattern: "1970"
      const singleYearMatch = trimmed.match(/^(\d{4})$/);
      if (singleYearMatch) {
        const year = parseInt(singleYearMatch[1], 10);
        if (year >= 1900 && year <= 2030) {
          // Apply as year filter (single year = both min and max)
          setFilters(prev => ({ ...prev, yearMin: year, yearMax: year }));
          setDebouncedSearchText(''); // Clear text search since we're using year filter
          return;
        }
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
  useEffect(() => {
    // Load feed immediately - most recent vehicles, no filters
    setPage(0);
    setHasMore(true);
    loadHypeFeed(0, false);
  }, []); // Load once on mount - no filters, no dependencies

  // Also reload when session changes (user logs in/out)
  useEffect(() => {
    if (session !== null) {
      setPage(0);
      setHasMore(true);
      loadHypeFeed(0, false);
    }
  }, [session]);

  // Refetch feed when source filter changes so first page reflects selected sources (server-side filter)
  const sourceFilterKey = [
    filters.hideBat,
    filters.hideCraigslist,
    filters.hideDealerListings,
    filters.hideDealerSites,
    filters.hideKsl,
    filters.hideClassic,
    (filters.hiddenSources || []).join(','),
  ].join('\n');
  const prevSourceFilterKeyRef = useRef<string>(sourceFilterKey);
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      prevSourceFilterKeyRef.current = sourceFilterKey;
      return;
    }
    if (prevSourceFilterKeyRef.current === sourceFilterKey) return;
    prevSourceFilterKeyRef.current = sourceFilterKey;
    setPage(0);
    setHasMore(true);
    loadHypeFeed(0, false);
  }, [sourceFilterKey]);

  // Load active sources from database
  const [activeSources, setActiveSources] = useState<Array<{
    id: string;
    domain: string;
    source_name: string;
    url: string;
  }>>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});

  // Map domain to filter key for backward compatibility
  const domainToFilterKey = useCallback((domain: string): string => {
    const host = normalizeHost(domain);
    if (!host) return '';
    if (host === 'craigslist.org' || host.endsWith('.craigslist.org')) return 'craigslist';
    if (host === 'ksl.com' || host.endsWith('.ksl.com')) return 'ksl';
    if (host === 'autotrader.com' || host.endsWith('.autotrader.com')) return 'dealer_site';
    if (host === 'bringatrailer.com' || host.endsWith('.bringatrailer.com')) return 'bat';
    if (host === 'classic.com' || host.endsWith('.classic.com')) return 'classic';
    // For new sources, use normalized host as key
    return host.replace(/[^a-z0-9]/g, '_');
  }, []);

  const includedSources = useMemo(() => {
    // Ensure filters is available before accessing its properties
    if (!filters) {
      return {};
    }
    
    const base: Record<string, boolean> = {};
    const hiddenSourcesSet = new Set(filters.hiddenSources || []);
    
    // Initialize all known source types (not just activeSources)
    // This ensures we handle all possible source classifications
    const hasSourceSelections =
      filters.hideDealerListings ||
      filters.hideCraigslist ||
      filters.hideDealerSites ||
      filters.hideKsl ||
      filters.hideBat ||
      filters.hideClassic ||
      (filters.hiddenSources && filters.hiddenSources.length > 0);

    const knownSourceTypes = ['craigslist', 'ksl', 'dealer_site', 'bat', 'classic', 'user', 'unknown'];
    
    knownSourceTypes.forEach(key => {
      if (key === 'craigslist') {
        base[key] = !filters.hideDealerListings && !filters.hideCraigslist;
      } else if (key === 'ksl') {
        base[key] = !filters.hideDealerListings && !filters.hideKsl;
      } else if (key === 'dealer_site') {
        base[key] = !filters.hideDealerListings && !filters.hideDealerSites;
      } else if (key === 'bat') {
        base[key] = !filters.hideBat;
      } else if (key === 'classic') {
        base[key] = !filters.hideClassic;
      } else {
        // user, unknown: when any source filter is active, exclude by default so "only BaT" doesn't show user/unknown
        base[key] = !hiddenSourcesSet.has(key) && !hasSourceSelections;
      }
    });
    
    // Also handle active sources that might not be in knownSourceTypes
    activeSources.forEach(source => {
      const key = domainToFilterKey(source.domain);
      if (!base.hasOwnProperty(key)) {
        // New sources: check if they're in hiddenSources set
        base[key] = !hiddenSourcesSet.has(key);
      }
    });
    
    // Explicitly exclude any sources in hiddenSources that aren't already handled by hide* flags
    filters.hiddenSources?.forEach(key => {
      // Only set to false if it's not a known source type with a hide* flag
      // Known sources are handled above, so if it's not in base yet, it's a new source
      if (!base.hasOwnProperty(key)) {
        base[key] = false; // Explicitly exclude new sources
      } else if (!['craigslist', 'ksl', 'dealer_site', 'bat', 'classic'].includes(key)) {
        // For new sources that are in activeSources, override to exclude if in hiddenSources
        base[key] = false;
      }
      // Don't override known sources (craigslist, ksl, dealer_site, bat, classic) 
      // as they're controlled by hide* flags
    });

    // #region agent log
    if (homepageDebugEnabled) {
      console.log('[DEBUG] includedSources computed', { 
        includedSources: base, 
        activeSourcesCount: activeSources.length, 
        activeSources: activeSources.map(s=>({domain:s.domain,key:domainToFilterKey(s.domain)})), 
        filters: {
          hideBat: filters.hideBat, 
          hideCraigslist: filters.hideCraigslist, 
          hiddenSources: filters.hiddenSources
        }
      });
      // Debug telemetry disabled in production
    }
    // #endregion

    return base;
  }, [
    activeSources,
    filters,
    domainToFilterKey
  ]);

  const sourceAliasMap = useMemo(() => {
    const map = new Map<string, string>();
    activeSources.forEach((source) => {
      const host = normalizeHost(source.domain);
      if (!host) return;
      const key = domainToFilterKey(host);
      if (!key) return;
      const aliases = new Set<string>();
      aliases.add(host);
      aliases.add(normalizeAlias(host));
      aliases.add(normalizeAlias(stripTld(host)));
      aliases.add(normalizeAlias(source.source_name || ''));
      aliases.add(normalizeAlias(key));
      aliases.forEach((alias) => {
        if (alias) map.set(alias, key);
      });
    });
    return map;
  }, [activeSources, domainToFilterKey]);

  const getSourceFilterKey = useCallback((v: any): string => {
    const discoveryHost = normalizeHost(v?.discovery_url || '');
    if (discoveryHost) {
      const key = domainToFilterKey(discoveryHost);
      if (key) return key;
    }
    const discoverySource = String(v?.discovery_source || '').trim().toLowerCase();
    if (discoverySource) {
      const normalized = normalizeAlias(discoverySource);
      const mapped = sourceAliasMap.get(discoverySource) || sourceAliasMap.get(normalized);
      if (mapped) return mapped;
      const key = domainToFilterKey(discoverySource);
      if (key) return key;
    }
    return classifySource(v);
  }, [domainToFilterKey, sourceAliasMap]);

  const buildSourceCounts = useCallback((vehicles: any[]) => {
    const counts: Record<string, number> = {};
    (vehicles || []).forEach((v: any) => {
      const host = normalizeHost(v?.discovery_url || '');
      const keyFromHost = host ? domainToFilterKey(host) : '';
      if (keyFromHost) {
        counts[keyFromHost] = (counts[keyFromHost] || 0) + 1;
      }
      const fallback = classifySource(v);
      if (fallback && (!keyFromHost || fallback === 'dealer_site') && fallback !== keyFromHost) {
        counts[fallback] = (counts[fallback] || 0) + 1;
      }
    });

    const domainCounts: Record<string, number> = {};
    const seenKeys = new Set<string>();
    activeSources.forEach((source) => {
      const key = domainToFilterKey(source.domain);
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      domainCounts[key] = counts[key] || 0;
    });
    return domainCounts;
  }, [activeSources, domainToFilterKey]);

  // Apply filters and sorting function - defined before useEffect
  const applyFiltersAndSort = useCallback(() => {
    let result = [...feedVehicles];
    
    // Global search (year/make/model/title/vin). Space-separated terms must all match.
    if (debouncedSearchText) {
      const terms = debouncedSearchText
        .toLowerCase()
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);

      result = result.filter((v: any) => {
        const hay = [
          v.year,
          v.make,
          v.model,
          v.title,
          v.vin,
        ].filter(Boolean).join(' ').toLowerCase();

        return terms.every((t) => hay.includes(t));
      });
    }

    // Apply filters
    if (filters.addedTodayOnly) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const startMs = start.getTime();
      const endMs = end.getTime();

      result = result.filter((v: any) => {
        const t = new Date(v.created_at || 0).getTime();
        return Number.isFinite(t) && t >= startMs && t < endMs;
      });
    }

    if (filters.yearMin) {
      result = result.filter(v => (v.year || 0) >= filters.yearMin!);
    }
    if (filters.yearMax) {
      result = result.filter(v => (v.year || 0) <= filters.yearMax!);
    }
    if (filters.makes.length > 0) {
      result = result.filter(v => filters.makes.some(m =>
        v.make?.toLowerCase().includes(m.toLowerCase())
      ));
    }
    // Model filter (requires make to be selected)
    if (filters.models && filters.models.length > 0) {
      // Use fuzzy matching: strip dashes/slashes/spaces for comparison
      const normalize = (s: string) => s.toLowerCase().replace(/[-\/\s]/g, '');
      result = result.filter(v => filters.models!.some(m => {
        const modelLower = (v.model || '').toLowerCase();
        const modelNorm = normalize(modelLower);
        const filterLower = m.toLowerCase();
        const filterNorm = normalize(m);
        // Direct match, contains match, or normalized match
        return modelLower.includes(filterLower) || modelNorm.includes(filterNorm);
      }));
    }
    // Body style filter (car type)
    if (filters.bodyStyles.length > 0) {
      const selectedCanon = filters.bodyStyles
        .map((bs) => getCanonicalBodyStyle(bs))
        .filter(Boolean) as any[];
      result = result.filter(v => {
        const canon = getCanonicalBodyStyle((v as any).canonical_body_style || (v as any).body_style);
        return canon ? selectedCanon.includes(canon) : false;
      });
    } else {
      // Default: keep motorcycles out of the main vehicle feed unless explicitly selected.
      result = result.filter((v: any) => {
        const canon = getCanonicalBodyStyle((v as any).canonical_body_style || (v as any).body_style);
        return canon !== 'MOTORCYCLE';
      });
    }
    // 4x4/4WD/AWD filter
    if (filters.is4x4) {
      result = result.filter(v => {
        const drivetrain = ((v as any).drivetrain || '').toLowerCase();
        return drivetrain.includes('4wd') || drivetrain.includes('4x4') || drivetrain.includes('awd');
      });
    }
    if (filters.priceMin) {
      result = result.filter(v => (getDisplayPriceValue(v) ?? 0) >= filters.priceMin!);
    }
    if (filters.priceMax) {
      result = result.filter(v => (getDisplayPriceValue(v) ?? 0) <= filters.priceMax!);
    }
    if (filters.hasImages) {
      result = result.filter(v => (v.image_count || 0) > 0);
    }
    if (filters.forSale) {
      result = result.filter(v => v.is_for_sale);
    }
    if (filters.hideSold) {
      result = result.filter(v => {
        const salePrice = Number((v as any).sale_price || 0) || 0;
        const saleDate = (v as any).sale_date;
        const saleStatus = String((v as any).sale_status || '').toLowerCase();
        const outcome = String((v as any).auction_outcome || '').toLowerCase();
        const isAuctionResult =
          ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(outcome) ||
          ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(saleStatus);
        const isSold = salePrice > 0 || Boolean(saleDate) || saleStatus === 'sold' || isAuctionResult;
        return !isSold;
      });
    }

    // Show ONLY sold vehicles (for sold stats view)
    if (filters.showSoldOnly) {
      const period = SALES_PERIODS.find(p => p.value === salesPeriod);
      const cutoffDate = period && period.days !== null
        ? new Date(Date.now() - period.days * 24 * 60 * 60 * 1000)
        : null;

      result = result.filter(v => {
        const salePrice = Number((v as any).sale_price || 0) || 0;
        if (salePrice < 500) return false; // Must have real sale price

        const saleDateStr = (v as any).sale_date;
        if (!saleDateStr) return false;

        // Check if within time period
        if (cutoffDate) {
          const saleDate = new Date(saleDateStr);
          if (isNaN(saleDate.getTime()) || saleDate < cutoffDate) return false;
        }

        return true;
      });

      // Sort by sale date (newest first) when showing sold
      result.sort((a, b) => {
        const aDate = new Date((a as any).sale_date || 0).getTime();
        const bDate = new Date((b as any).sale_date || 0).getTime();
        return bDate - aDate;
      });
    }

    // Private party filter - vehicles without organization_id or from private party sources
    if (filters.privateParty) {
      result = result.filter(v => {
        const orgId = (v as any).origin_organization_id;
        const source = classifySource(v);
        // Private party: no org ID, or from Craigslist (typically private)
        return !orgId || source === 'craigslist';
      });
    }
    
    // Dealer filter - vehicles with organization_id or from dealer sources
    if (filters.dealer) {
      result = result.filter(v => {
        const orgId = (v as any).origin_organization_id;
        const source = classifySource(v);
        // Dealer: has org ID, or from dealer sites, or BaT (often dealers)
        return !!orgId || source === 'dealer_site' || source === 'bat';
      });
    }

    // Source / dealer-ish filtering - use inclusion-based logic
    // Check if any sources are explicitly excluded (indicating user has made selections)
    const hasSourceSelections = 
      filters.hideDealerListings ||
      filters.hideCraigslist ||
      filters.hideDealerSites ||
      filters.hideKsl ||
      filters.hideBat ||
      filters.hideClassic ||
      (filters.hiddenSources && filters.hiddenSources.length > 0);

    if (hasSourceSelections) {
      // #region agent log
      const beforeCount = result.length;
      const sourceBreakdown: Record<string, number> = {};
      result.forEach((v: any) => {
        const src = getSourceFilterKey(v);
        sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
      });
      // #endregion

      // Use inclusion-based filtering: only show vehicles from included sources
      result = result.filter((v: any) => {
        const src = getSourceFilterKey(v);
        // Check if this source is included based on includedSources
        // If hasSourceSelections is true, only include sources that are explicitly set to true
        // If a source isn't in includedSources, exclude it (don't default to included)
        const isIncluded = includedSources[src] === true;
        
        // #region agent log
        if (src === 'bat') {
          console.log('[DEBUG] BaT vehicle filter check', { 
            src, 
            isIncluded, 
            includedSourcesValue: includedSources[src], 
            includedSourcesKeys: Object.keys(includedSources), 
            hideBat: filters.hideBat,
            vehicleId: v.id,
            discoveryUrl: v.discovery_url,
            profileOrigin: v.profile_origin
          });
        }
        // #endregion
        
        return isIncluded;
      });

      // #region agent log
      const afterCount = result.length;
      const afterSourceBreakdown: Record<string, number> = {};
      result.forEach((v: any) => {
        const src = getSourceFilterKey(v);
        afterSourceBreakdown[src] = (afterSourceBreakdown[src] || 0) + 1;
      });
      // #endregion
    } else {
      // #region agent log
      // #endregion
    }
    
    // Location filtering - support multiple locations
    if ((filters.locations && filters.locations.length > 0) || (filters.zipCode && filters.zipCode.length === 5)) {
      result = result.filter(v => {
        const vehicleZip = (v as any).zip_code || (v as any).location_zip;
        if (!vehicleZip) return false;
        
        // Check against multiple locations
        if (filters.locations && filters.locations.length > 0) {
          return filters.locations.some(loc => vehicleZip === loc.zipCode);
        }
        
        // Fallback to single zipCode
        return vehicleZip === filters.zipCode;
      });
    }
    
    const compareDisplayPrice = (a: HypeVehicle, b: HypeVehicle) => {
      const aPrice = getDisplayPriceValue(a);
      const bPrice = getDisplayPriceValue(b);
      if (aPrice === null && bPrice === null) return 0;
      if (aPrice === null) return 1;
      if (bPrice === null) return -1;
      return sortDirection === 'desc' ? bPrice - aPrice : aPrice - bPrice;
    };

    // Apply sorting with direction - default to newest (created_at DESC)
    const dir = sortDirection === 'desc' ? 1 : -1;
    switch (sortBy) {
      case 'year':
        result.sort((a, b) => dir * ((b.year || 0) - (a.year || 0)));
        break;
      case 'make':
        result.sort((a, b) => dir * (a.make || '').localeCompare(b.make || ''));
        break;
      case 'model':
        result.sort((a, b) => dir * (a.model || '').localeCompare(b.model || ''));
        break;
      case 'mileage':
        result.sort((a, b) => dir * ((b.mileage || 0) - (a.mileage || 0)));
        break;
      case 'newest':
        result.sort((a, b) => {
          const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
          const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
          return dir * (bTime - aTime);
        });
        break;
      case 'oldest':
        result.sort((a, b) => 
          dir * (new Date(a.updated_at || a.created_at || 0).getTime() - 
          new Date(b.updated_at || b.created_at || 0).getTime())
        );
        break;
      case 'price_high':
      case 'price_low':
        result.sort(compareDisplayPrice);
        break;
      case 'volume':
        result.sort((a, b) => 0);
        break;
      case 'images':
        result.sort((a, b) => dir * ((b.image_count || 0) - (a.image_count || 0)));
        break;
      case 'events':
        result.sort((a, b) => dir * ((b.event_count || 0) - (a.event_count || 0)));
        break;
      case 'views':
        result.sort((a, b) => dir * ((b.view_count || 0) - (a.view_count || 0)));
        break;
      default:
        // Default: newest first (created_at DESC)
        result.sort((a, b) => {
          const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
          const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
          return bTime - aTime;
        });
    }
    
    setFilteredVehicles(result);
  }, [feedVehicles, filters, sortBy, sortDirection, debouncedSearchText, includedSources, getSourceFilterKey, activeSources, domainToFilterKey, getDisplayPriceValue, salesPeriod]);

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

  // State for filtered stats from database
  const [filteredStatsFromDb, setFilteredStatsFromDb] = useState({
    totalVehicles: 0,
    totalValue: 0,
    salesVolume: 0,
    salesCountToday: 0,
    forSaleCount: 0,
    activeAuctions: 0,
    totalBids: 0,
    avgValue: 0,
    vehiclesAddedToday: 0,
    valueMarkTotal: 0,
    valueAskTotal: 0,
    valueRealizedTotal: 0,
    valueCostTotal: 0,
    valueImportedToday: 0,
    valueImported24h: 0,
    valueImported7d: 0,
  });
  const [filteredStatsLoading, setFilteredStatsLoading] = useState(false);

  // Load filtered stats directly from database when filters are active
  const loadFilteredStats = useCallback(async () => {
    if (!hasActiveFilters && !debouncedSearchText) {
      // No filters - use dbStats instead
      return;
    }

    try {
      setFilteredStatsLoading(true);
      
      // Build query with filters applied
      const buildFilteredStatsQuery = (includeListingKind: boolean) => {
        let query = supabase
          .from('vehicles')
          // Keep this payload lean: this query runs as you type/search and shouldn't pull display-only fields.
          .select(
            'sale_price, sale_status, asking_price, current_value, purchase_price, msrp, winning_bid, high_bid, is_for_sale, bid_count, auction_outcome, sale_date, created_at, year, make, model, title, vin, discovery_url, discovery_source, profile_origin, image_count',
            { count: 'exact' }
          )
          .eq('is_public', true)
          .neq('status', 'pending');
        if (includeListingKind) query = query.eq('listing_kind', 'vehicle');

        // CRITICAL: Override default 1000 row limit for filtered stats calculation
        query = query.limit(15000);

        // "Added today" filter (created_at within local day)
        if (filters.addedTodayOnly) {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setDate(end.getDate() + 1);
          query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
        }

        // Year filters
        if (filters.yearMin) {
          query = query.gte('year', filters.yearMin);
        }
        if (filters.yearMax) {
          query = query.lte('year', filters.yearMax);
        }

        // Make filters
        if (filters.makes.length > 0) {
          // Use OR for multiple makes - Supabase .or() syntax
          const makeFilters = filters.makes.map(make => `make.ilike.%${make}%`).join(',');
          query = query.or(makeFilters);
        }

        // Model filters (only applied if makes are selected)
        if (filters.models && filters.models.length > 0) {
          const modelFilters = filters.models.map(model => `model.ilike.%${model}%`).join(',');
          query = query.or(modelFilters);
        }

        // For sale filter
        if (filters.forSale) {
          query = query.eq('is_for_sale', true);
        }

        // Hide sold filter - vehicles that are NOT sold
        if (filters.hideSold) {
          query = query.or('sale_status.neq.sold,sale_status.is.null');
        }

        // Show ONLY sold vehicles (for sold stats view)
        if (filters.showSoldOnly) {
          // Filter to vehicles with sale_price > 0 AND sale_date within selected period
          query = query.gt('sale_price', 500); // Must have a real sale price

          // Apply time period filter based on salesPeriod
          const period = SALES_PERIODS.find(p => p.value === salesPeriod);
          if (period && period.days !== null) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - period.days);
            query = query.gte('sale_date', cutoffDate.toISOString().split('T')[0]);
          }
        }

        return query;
      };

      // Execute query (with listing_kind fallback if needed)
      let query = buildFilteredStatsQuery(listingKindSupportedRef.current);
      let { data: vehicles, count, error } = await query;
      if (error && isMissingListingKindColumn(error)) {
        listingKindSupportedRef.current = false;
        ({ data: vehicles, count, error } = await buildFilteredStatsQuery(false));
      }

      if (error) {
        console.error('Error loading filtered stats:', error);
        return;
      }

      // Apply client-side filters that are harder to do in SQL
      let filtered = vehicles || [];
      let hasClientSideFilters = false;  // Track if we're reducing results beyond SQL

      // Source filters (client-side to match classifySource logic exactly)
      const hasSourceSelections =
        filters.hideDealerListings ||
        filters.hideCraigslist ||
        filters.hideDealerSites ||
        filters.hideKsl ||
        filters.hideBat ||
        filters.hideClassic ||
        (filters.hiddenSources && filters.hiddenSources.length > 0);
      if (hasSourceSelections) {
        hasClientSideFilters = true;
        filtered = filtered.filter((v: any) => {
          const src = getSourceFilterKey(v);
          return includedSources[src] === true;
        });
      }

      // Price filters (client-side because we need to check multiple price fields)
      if (filters.priceMin || filters.priceMax) {
        hasClientSideFilters = true;
        filtered = filtered.filter((v: any) => {
          // Calculate display price (same logic as in applyFiltersAndSort)
          let vehiclePrice = 0;
          if (v.sale_price && typeof v.sale_price === 'number' && Number.isFinite(v.sale_price) && v.sale_price > 0) {
            vehiclePrice = v.sale_price;
          } else if (v.asking_price) {
            vehiclePrice = typeof v.asking_price === 'number' && Number.isFinite(v.asking_price) ? v.asking_price : 0;
            if (typeof v.asking_price === 'string') {
              const parsed = parseFloat(v.asking_price);
              vehiclePrice = Number.isFinite(parsed) ? parsed : 0;
            }
          } else if (v.current_value) {
            vehiclePrice = typeof v.current_value === 'number' && Number.isFinite(v.current_value) ? v.current_value : 0;
          } else if (v.purchase_price) {
            vehiclePrice = typeof v.purchase_price === 'number' && Number.isFinite(v.purchase_price) ? v.purchase_price : 0;
          }

          if (filters.priceMin && vehiclePrice < filters.priceMin) return false;
          if (filters.priceMax && vehiclePrice > filters.priceMax) return false;
          return true;
        });
      }

      // Has images filter
      if (filters.hasImages) {
        hasClientSideFilters = true;
        filtered = filtered.filter((v: any) => (v.image_count || 0) > 0);
      }

      // Search text filter (client-side)
      if (debouncedSearchText) {
        hasClientSideFilters = true;
        const terms = debouncedSearchText.toLowerCase().trim().split(/\s+/).filter(Boolean);
        filtered = filtered.filter((v: any) => {
          const hay = [
            v.year,
            v.make,
            v.model,
            v.title,
            v.vin,
          ].filter(Boolean).join(' ').toLowerCase();
          return terms.every((t) => hay.includes(t));
        });
      }

      // Determine the accurate total count:
      // - If no client-side filters: use the accurate `count` from Supabase
      // - If client-side filters active: estimate using ratio (filtered/fetched * count)
      let accurateTotalVehicles: number;
      const fetchedCount = (vehicles || []).length;
      if (!hasClientSideFilters) {
        // No client-side reduction - use accurate DB count
        accurateTotalVehicles = count || filtered.length;
      } else if (fetchedCount > 0 && count && count > 0) {
        // Client-side filters active - estimate true count using ratio
        // If we fetched 15000 and client-side filtered to 10000, and DB count was 20000,
        // the estimate is (10000/15000) * 20000 = 13333
        const ratio = filtered.length / fetchedCount;
        accurateTotalVehicles = Math.round(ratio * count);
      } else {
        accurateTotalVehicles = filtered.length;
      }

      // Calculate stats from filtered vehicles
      let totalValue = 0;
      let vehiclesWithValue = 0;
      let forSaleCount = 0;
      let activeAuctions = 0;
      let totalBids = 0;
      let salesCountToday = 0;
      let valueMarkTotal = 0;
      let valueAskTotal = 0;
      let valueRealizedTotal = 0;
      let valueCostTotal = 0;
      let valueImportedToday = 0;
      let valueImported24h = 0;
      let valueImported7d = 0;

      const nowMs = Date.now();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const startMs = start.getTime();
      const endMs = end.getTime();
      const todayISO = start.toISOString().split('T')[0];
      const last24hMs = nowMs - 24 * 60 * 60 * 1000;
      const last7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;

      filtered.forEach((v: any) => {
        // Count for sale: is_for_sale=true OR (asking_price > 0 AND not sold)
        const hasAskingPrice = Number(v.asking_price || 0) > 0;
        const isSold = v.sale_status === 'sold' || v.auction_outcome === 'sold';
        if (v.is_for_sale === true || (hasAskingPrice && !isSold)) {
          forSaleCount++;
        }

        // Count active auctions: sale_status='auction_live' (currently live auctions)
        if (v.sale_status === 'auction_live') {
          activeAuctions++;
        }

        // Sum total bids
        if (v.bid_count && Number.isFinite(Number(v.bid_count))) {
          totalBids += Number(v.bid_count);
        }

        const currentValue = Number(v.current_value || 0) || 0;
        if (Number.isFinite(currentValue) && currentValue > 0) valueMarkTotal += currentValue;

        const purchase = Number(v.purchase_price || 0) || 0;
        if (Number.isFinite(purchase) && purchase > 0) valueCostTotal += purchase;

        const asking = Number(v.asking_price || 0) || 0;
        if (v.is_for_sale === true && Number.isFinite(asking) && asking > 0) valueAskTotal += asking;

        const salePrice = Number(v.sale_price || 0) || 0;
        if (Number.isFinite(salePrice) && salePrice > 0) valueRealizedTotal += salePrice;

        // Sold today count (sale_date is a date-ish string in many cases)
        if (salePrice > 0 && v?.sale_date && String(v.sale_date) >= todayISO) {
          salesCountToday += 1;
        }

        // Calculate value
        const winning = Number(v.winning_bid || 0) || 0;
        const high = Number(v.high_bid || 0) || 0;
        const msrp = Number(v.msrp || 0) || 0;
        const vehiclePrice =
          (salePrice > 0 ? salePrice : 0) ||
          (Number.isFinite(winning) && winning > 0 ? winning : 0) ||
          (Number.isFinite(high) && high > 0 ? high : 0) ||
          (Number.isFinite(asking) && asking > 0 ? asking : 0) ||
          (Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 0) ||
          (Number.isFinite(purchase) && purchase > 0 ? purchase : 0) ||
          (Number.isFinite(msrp) && msrp > 0 ? msrp : 0) ||
          0;

        if (vehiclePrice > 0) {
          totalValue += vehiclePrice;
          vehiclesWithValue++;

          const createdMs = new Date(v?.created_at || 0).getTime();
          if (Number.isFinite(createdMs)) {
            if (createdMs >= startMs && createdMs < endMs) valueImportedToday += vehiclePrice;
            if (createdMs >= last24hMs) valueImported24h += vehiclePrice;
            if (createdMs >= last7dMs) valueImported7d += vehiclePrice;
          }
        }
      });

      const avgValue = vehiclesWithValue > 0 ? totalValue / vehiclesWithValue : 0;

      const vehiclesAddedToday = filtered.filter((v: any) => {
        const t = new Date(v?.created_at || 0).getTime();
        return Number.isFinite(t) && t >= startMs && t < endMs;
      }).length;

      // Sales volume (sold today by sale_date)
      const salesVolume = filtered
        .filter((v: any) => Boolean(v?.sale_price) && Boolean(v?.sale_date) && String(v.sale_date) >= todayISO)
        .reduce((sum, v: any) => {
          const price = Number(v.sale_price || 0) || 0;
          return sum + (Number.isFinite(price) ? price : 0);
        }, 0);

      setFilteredStatsFromDb({
        totalVehicles: accurateTotalVehicles,
        totalValue,
        salesVolume,
        salesCountToday,
        forSaleCount,
        activeAuctions,
        totalBids,
        avgValue,
        vehiclesAddedToday,
        valueMarkTotal,
        valueAskTotal,
        valueRealizedTotal,
        valueCostTotal,
        valueImportedToday,
        valueImported24h,
        valueImported7d,
      });
    } catch (error) {
      console.error('Error loading filtered stats:', error);
    } finally {
      setFilteredStatsLoading(false);
    }
  }, [hasActiveFilters, debouncedSearchText, filters, includedSources, getSourceFilterKey]);

  // Load filtered stats when filters change
  useEffect(() => {
    if (hasActiveFilters || debouncedSearchText) {
      // Debounce to avoid too many queries
      const timer = setTimeout(() => {
        loadFilteredStats();
      }, 500);
      return () => clearTimeout(timer);
    } else {
      // Clear filtered stats when no filters
      setFilteredStatsFromDb({
        totalVehicles: 0,
        totalValue: 0,
        salesVolume: 0,
        salesCountToday: 0,
        forSaleCount: 0,
        activeAuctions: 0,
        totalBids: 0,
        avgValue: 0,
        vehiclesAddedToday: 0,
        valueMarkTotal: 0,
        valueAskTotal: 0,
        valueRealizedTotal: 0,
        valueCostTotal: 0,
        valueImportedToday: 0,
        valueImported24h: 0,
        valueImported7d: 0,
      });
    }
  }, [hasActiveFilters, debouncedSearchText, filters, loadFilteredStats]);

  // Calculate filtered vehicle statistics (fallback for display, but we prefer DB stats)
  const filteredStats = useMemo(() => {
    // If we have DB stats AND they've loaded (totalVehicles > 0 or totalValue > 0), use those (more accurate)
    // Also use DB stats if filteredVehicles is empty (no local data to compute from)
    if ((hasActiveFilters || debouncedSearchText) &&
        (filteredStatsFromDb.totalVehicles > 0 || filteredStatsFromDb.totalValue > 0 || filteredVehicles.length === 0)) {
      return filteredStatsFromDb;
    }

    // Otherwise compute from filteredVehicles (used while DB stats are loading, or as fallback)
    const totalVehicles = filteredVehicles.length;
    let totalValue = 0;
    let vehiclesWithValue = 0;
    let forSaleCount = 0;
    let activeAuctions = 0;
    let totalBids = 0;
    let salesCountToday = 0;
    let valueMarkTotal = 0;
    let valueAskTotal = 0;
    let valueRealizedTotal = 0;
    let valueCostTotal = 0;
    let valueImportedToday = 0;
    let valueImported24h = 0;
    let valueImported7d = 0;

    const nowMs = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const todayStartMs = todayStart.getTime();
    const tomorrowStartMs = tomorrowStart.getTime();
    const last24hMs = nowMs - 24 * 60 * 60 * 1000;
    const last7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const todayISO = todayStart.toISOString().split('T')[0]; // YYYY-MM-DD
    
    filteredVehicles.forEach((v) => {
      // Count for sale: is_for_sale=true OR (asking_price > 0 AND not sold)
      const hasAskingPrice = Number((v as any).asking_price || 0) > 0;
      const isSold = (v as any).sale_status === 'sold' || (v as any).auction_outcome === 'sold';
      if (v.is_for_sale === true || (hasAskingPrice && !isSold)) {
        forSaleCount++;
      }

      // Count active auctions: sale_status='auction_live' (currently live auctions)
      if ((v as any).sale_status === 'auction_live') {
        activeAuctions++;
      }

      // Sum total bids
      if (v.bid_count && Number.isFinite(Number(v.bid_count))) {
        totalBids += Number(v.bid_count);
      }

      const currentValue = Number(v.current_value || 0) || 0;
      if (Number.isFinite(currentValue) && currentValue > 0) valueMarkTotal += currentValue;

      const purchase = Number(v.purchase_price || 0) || 0;
      if (Number.isFinite(purchase) && purchase > 0) valueCostTotal += purchase;

      const asking = Number(v.asking_price || 0) || 0;
      if (v.is_for_sale === true && Number.isFinite(asking) && asking > 0) valueAskTotal += asking;

      const salePrice = Number(v.sale_price || 0) || 0;
      if (Number.isFinite(salePrice) && salePrice > 0) valueRealizedTotal += salePrice;

      // Sold today count (sale_date is a date-ish string in many cases)
      if (salePrice > 0 && (v as any)?.sale_date && String((v as any).sale_date) >= todayISO) {
        salesCountToday += 1;
      }
      
      // Calculate value - use the best/actual price per vehicle
      // Priority: sale_price > winning_bid > high_bid > asking_price > current_value > purchase_price > msrp > display_price
      const winning = Number((v as any).winning_bid || 0) || 0;
      const high = Number((v as any).high_bid || 0) || 0;
      const msrp = Number((v as any).msrp || 0) || 0;
      const display = Number((v as any).display_price || 0) || 0;
      const vehiclePrice =
        (salePrice > 0 ? salePrice : 0) ||
        (Number.isFinite(winning) && winning > 0 ? winning : 0) ||
        (Number.isFinite(high) && high > 0 ? high : 0) ||
        (Number.isFinite(asking) && asking > 0 ? asking : 0) ||
        (Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 0) ||
        (Number.isFinite(purchase) && purchase > 0 ? purchase : 0) ||
        (Number.isFinite(msrp) && msrp > 0 ? msrp : 0) ||
        (Number.isFinite(display) && display > 0 ? display : 0) ||
        0;
      
      if (vehiclePrice > 0) {
        totalValue += vehiclePrice;
        vehiclesWithValue++;

        const createdMs = new Date((v as any)?.created_at || 0).getTime();
        if (Number.isFinite(createdMs)) {
          if (createdMs >= todayStartMs && createdMs < tomorrowStartMs) valueImportedToday += vehiclePrice;
          if (createdMs >= last24hMs) valueImported24h += vehiclePrice;
          if (createdMs >= last7dMs) valueImported7d += vehiclePrice;
        }
      }
    });
    
    const avgValue = vehiclesWithValue > 0 ? totalValue / vehiclesWithValue : 0;
    
    // Sales volume: align semantics with dbStats (sold today), but scoped to the filtered set.
    const salesVolume = filteredVehicles
      .filter((v: any) => Boolean(v?.sale_price) && Boolean(v?.sale_date) && String(v.sale_date) >= todayISO)
      .reduce((sum, v: any) => {
        const price = Number(v.sale_price || 0) || 0;
        return sum + (Number.isFinite(price) ? price : 0);
      }, 0);
    const vehiclesAddedToday = filteredVehicles.filter((v: any) => {
      const t = new Date((v as any)?.created_at || 0).getTime();
      return Number.isFinite(t) && t >= todayStartMs && t < tomorrowStartMs;
    }).length;

    return {
      totalVehicles,
      totalValue,
      salesVolume,
      salesCountToday,
      forSaleCount,
      activeAuctions,
      totalBids,
      avgValue,
      vehiclesAddedToday,
      valueMarkTotal,
      valueAskTotal,
      valueRealizedTotal,
      valueCostTotal,
      valueImportedToday,
      valueImported24h,
      valueImported7d,
      // Market interest not computed locally - only available from global cache
      marketInterestValue: 0,
      rnmVehicleCount: 0,
    };
  }, [filteredVehicles, hasActiveFilters, debouncedSearchText, filteredStatsFromDb]);

  // Add state for database-wide stats (around line 370, after existing stats state)
  const [dbStats, setDbStats] = useState({
    totalVehicles: 0,
    totalValue: 0,
    salesVolume: 0,
    salesCountToday: 0,
    forSaleCount: 0,
    activeAuctions: 0,
    totalBids: 0,
    avgValue: 0,
    vehiclesAddedToday: 0,
    valueMarkTotal: 0,
    valueAskTotal: 0,
    valueRealizedTotal: 0,
    valueCostTotal: 0,
    valueImportedToday: 0,
    valueImported24h: 0,
    valueImported7d: 0,
    // Market interest from reserve-not-met auctions
    marketInterestValue: 0,
    rnmVehicleCount: 0,
  });
  const [dbStatsLoading, setDbStatsLoading] = useState(true);
  const hasLoggedCachedStatsRef = useRef(false);

  // Load database-wide stats - try cached table first (instant), then RPCs as fallback
  const loadDatabaseStats = async () => {
    try {
      setDbStatsLoading(true);

      // FIRST: Try cached stats table (instant read, ~200ms)
      const { data: cachedStats, error: cacheError } = await supabase
        .from('portfolio_stats_cache')
        .select('*')
        .eq('id', 'global')
        .single();

      if (!cacheError && cachedStats) {
        // Only log on first cache hit so the 30s refresh doesn't spam "instantly" after 30 sec
        if (!hasLoggedCachedStatsRef.current) {
          hasLoggedCachedStatsRef.current = true;
          console.log('Cached stats loaded:', {
            totalVehicles: cachedStats.total_vehicles,
            totalValue: cachedStats.total_value,
            source: 'portfolio_stats_cache table'
          });
        }

        setDbStats(prev => ({
          ...prev,
          totalVehicles: Number(cachedStats.total_vehicles) || prev.totalVehicles,
          totalValue: Number(cachedStats.total_value) || prev.totalValue,
          salesCountToday: Number(cachedStats.sales_count_today) || prev.salesCountToday,
          salesVolume: Number(cachedStats.sales_volume_today) || prev.salesVolume,
          forSaleCount: Number(cachedStats.for_sale_count) || prev.forSaleCount,
          activeAuctions: Number(cachedStats.active_auctions) || prev.activeAuctions,
          vehiclesAddedToday: Number(cachedStats.vehicles_added_today) || prev.vehiclesAddedToday,
          valueRealizedTotal: Number(cachedStats.value_realized_total) || prev.valueRealizedTotal,
          avgValue: cachedStats.total_vehicles > 0
            ? Number(cachedStats.total_value) / Number(cachedStats.total_vehicles)
            : prev.avgValue,
          // Market interest from reserve-not-met auctions
          marketInterestValue: Number(cachedStats.market_interest_value) || prev.marketInterestValue,
          rnmVehicleCount: Number(cachedStats.rnm_vehicle_count) || prev.rnmVehicleCount,
        }));
        setDbStatsLoading(false);
        return; // Done - cache is authoritative
      }

      // FALLBACK: Try fast stats RPC (simple counts)
      const { data: fastStats, error: fastError } = await supabase.rpc('get_portfolio_stats_fast');

      if (!fastError && fastStats) {
        console.log('Fast stats loaded:', {
          totalVehicles: Number(fastStats.total_vehicles) || 0,
          forSaleCount: Number(fastStats.for_sale_count) || 0,
          source: 'get_portfolio_stats_fast RPC'
        });

        setDbStats(prev => ({
          ...prev,
          totalVehicles: Number(fastStats.total_vehicles) || prev.totalVehicles,
          salesCountToday: Number(fastStats.sales_count_today) || prev.salesCountToday,
          forSaleCount: Number(fastStats.for_sale_count) || prev.forSaleCount,
          activeAuctions: Number(fastStats.active_auctions) || prev.activeAuctions,
          vehiclesAddedToday: Number(fastStats.vehicles_added_today) || prev.vehiclesAddedToday,
        }));
        setDbStatsLoading(false);

        // Try to get value in background
        supabase.rpc('calculate_portfolio_value_server').then(({ data: fullStats, error: fullError }) => {
          if (!fullError && fullStats) {
            setDbStats(prev => ({
              ...prev,
              totalValue: Number(fullStats.total_value) || prev.totalValue,
              salesVolume: Number(fullStats.sales_volume_today) || prev.salesVolume,
              avgValue: Number(fullStats.avg_value) || prev.avgValue,
              valueRealizedTotal: Number(fullStats.value_realized_total) || prev.valueRealizedTotal,
            }));
            console.log('Full stats loaded in background');
          }
        }).catch(() => {});

        return;
      }

      // Fallback: Try the full RPC directly
      const { data: serverStats, error: rpcError } = await supabase.rpc('calculate_portfolio_value_server');

      if (!rpcError && serverStats) {
        const stats = {
          totalVehicles: Number(serverStats.total_vehicles) || 0,
          totalValue: Number(serverStats.total_value) || 0,
          salesVolume: Number(serverStats.sales_volume_today) || 0,
          salesCountToday: Number(serverStats.sales_count_today) || 0,
          forSaleCount: Number(serverStats.for_sale_count) || 0,
          activeAuctions: Number(serverStats.active_auctions) || 0,
          totalBids: 0,
          avgValue: Number(serverStats.avg_value) || 0,
          vehiclesAddedToday: Number(serverStats.vehicles_added_today) || 0,
          valueMarkTotal: Number(serverStats.value_mark_total) || 0,
          valueAskTotal: Number(serverStats.value_ask_total) || 0,
          valueRealizedTotal: Number(serverStats.value_realized_total) || 0,
          valueCostTotal: Number(serverStats.value_cost_total) || 0,
          valueImportedToday: Number(serverStats.value_imported_today) || 0,
          valueImported24h: Number(serverStats.value_imported_24h) || 0,
          valueImported7d: Number(serverStats.value_imported_7d) || 0,
        };

        console.log('Server-side stats loaded:', {
          totalVehicles: stats.totalVehicles,
          totalValue: stats.totalValue,
          source: 'calculate_portfolio_value_server RPC'
        });

        setDbStats(stats);
        setDbStatsLoading(false);
        return;
      }

      // Fallback to client-side calculation if both RPCs fail
      console.warn('RPC failed, falling back to client-side stats:', fastError || rpcError);

      // Get total vehicle count
      const { count: totalCount, error: countError } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
        let q = supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .eq('is_public', true)
          .neq('status', 'pending');
        if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
        return q;
      });

      if (countError) {
        console.error('Error loading vehicle count:', countError);
      }

      // IMPORTANT: Add explicit limit to avoid Supabase default 1000 row limit!
      const { data: allVehicles, error: vehiclesError } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
        let q = supabase
          .from('vehicles')
          .select('sale_price, sale_status, asking_price, current_value, purchase_price, msrp, winning_bid, high_bid, is_for_sale, bid_count, auction_outcome, created_at, sale_date')
          .eq('is_public', true)
          .neq('status', 'pending')
          .limit(15000); // CRITICAL: Override default 1000 row limit
        if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
        return q;
      });

      if (vehiclesError) {
        console.error('Error loading vehicles for stats:', vehiclesError);
        return;
      }

      // Helper to safely parse numeric values
      const safeNum = (val: any): number => {
        if (val == null) return 0;
        const n = typeof val === 'number' ? val : parseFloat(String(val));
        return Number.isFinite(n) ? n : 0;
      };

      const nowMs = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const todayStartMs = todayStart.getTime();
      const tomorrowStartMs = tomorrowStart.getTime();
      const last24hMs = nowMs - 24 * 60 * 60 * 1000;
      const last7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;
      const todayISO = todayStart.toISOString().split('T')[0];

      let totalValue = 0;
      let vehiclesWithValue = 0;
      let forSaleCount = 0;
      let activeAuctions = 0;
      let totalBids = 0;
      let valueMarkTotal = 0;
      let valueAskTotal = 0;
      let valueRealizedTotal = 0;
      let valueCostTotal = 0;
      let valueImportedToday = 0;
      let valueImported24h = 0;
      let valueImported7d = 0;
      
      (allVehicles || []).forEach((v) => {
        // Count for sale: is_for_sale=true OR (asking_price > 0 AND not sold)
        const hasAskingPrice = safeNum((v as any).asking_price) > 0;
        const isSold = v.sale_status === 'sold' || (v as any).auction_outcome === 'sold';
        if (v.is_for_sale === true || (hasAskingPrice && !isSold)) {
          forSaleCount++;
        }

        // Count active auctions: sale_status='auction_live' (currently live auctions)
        // NOT bid_count > 0 which includes historical auctions
        if (v.sale_status === 'auction_live') {
          activeAuctions++;
        }

        // Sum total bids
        if (v.bid_count && Number.isFinite(Number(v.bid_count))) {
          totalBids += Number(v.bid_count);
        }

        const currentValue = safeNum((v as any).current_value);
        if (currentValue > 0) valueMarkTotal += currentValue;

        const purchase = safeNum((v as any).purchase_price);
        if (purchase > 0) valueCostTotal += purchase;

        const asking = safeNum((v as any).asking_price);
        if (v.is_for_sale === true && asking > 0) valueAskTotal += asking;

        const salePrice = safeNum((v as any).sale_price);
        if (salePrice > 0) valueRealizedTotal += salePrice;

        // Calculate value - use the best/actual price per vehicle
        const winning = safeNum((v as any).winning_bid);
        const high = safeNum((v as any).high_bid);
        const msrp = safeNum((v as any).msrp);
        const vehiclePrice =
          (salePrice > 0 ? salePrice : 0) ||
          (winning > 0 ? winning : 0) ||
          (high > 0 ? high : 0) ||
          (asking > 0 ? asking : 0) ||
          (currentValue > 0 ? currentValue : 0) ||
          (purchase > 0 ? purchase : 0) ||
          (msrp > 0 ? msrp : 0) ||
          0;

        if (vehiclePrice > 0) {
          totalValue += vehiclePrice;
          vehiclesWithValue++;

          const createdMs = new Date((v as any)?.created_at || 0).getTime();
          if (Number.isFinite(createdMs)) {
            if (createdMs >= todayStartMs && createdMs < tomorrowStartMs) valueImportedToday += vehiclePrice;
            if (createdMs >= last24hMs) valueImported24h += vehiclePrice;
            if (createdMs >= last7dMs) valueImported7d += vehiclePrice;
          }
        }
      });
      
      const avgValue = vehiclesWithValue > 0 ? totalValue / vehiclesWithValue : 0;
      
      const { count: createdTodayCount, error: createdTodayErr } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
        let q = supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .eq('is_public', true)
          .neq('status', 'pending');
        if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
        return q
          .gte('created_at', todayStart.toISOString())
          .lt('created_at', tomorrowStart.toISOString());
      });
      if (createdTodayErr) {
        console.warn('Error loading vehicles added today:', createdTodayErr);
      }

      const { data: recentSales } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
        let q = supabase
          .from('vehicles')
          .select('sale_price, sale_date')
          .eq('is_public', true)
          .neq('status', 'pending');
        if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
        return q
          .not('sale_price', 'is', null)
          .gte('sale_date', todayISO);
      });
      
      const salesVolume = (recentSales || []).reduce((sum, v) => {
        const price = v.sale_price || 0;
        return sum + (typeof price === 'number' && Number.isFinite(price) ? price : 0);
      }, 0);
      const salesCountToday = Array.isArray(recentSales) ? recentSales.length : 0;

      // Prefer external_listings for a true "live auctions" count (end_date in the future).
      // If RLS blocks the table, fall back to the heuristic computed from vehicles rows.
      let activeAuctionsLive = activeAuctions;
      try {
        const { data: liveListings, error: liveErr } = await supabase
          .from('external_listings')
          .select('vehicle_id, end_date, listing_status')
          .gt('end_date', new Date().toISOString())
          .order('updated_at', { ascending: false })
          .limit(5000);
        if (!liveErr && Array.isArray(liveListings) && liveListings.length > 0) {
          activeAuctionsLive = new Set(liveListings.map((r: any) => String(r?.vehicle_id || ''))).size;
        }
      } catch {
        // ignore; keep heuristic
      }
      
      // Use totalCount if available, otherwise fallback to processed vehicles count
      // This ensures we show SOMETHING even if the count query fails
      const vehicleCountFallback = (allVehicles || []).length;
      const stats = {
        totalVehicles: totalCount || vehicleCountFallback || 0,
        totalValue,
        salesVolume,
        salesCountToday,
        forSaleCount,
        activeAuctions: activeAuctionsLive,
        totalBids,
        avgValue,
        vehiclesAddedToday: createdTodayCount || 0,
        valueMarkTotal,
        valueAskTotal,
        valueRealizedTotal,
        valueCostTotal,
        valueImportedToday,
        valueImported24h,
        valueImported7d,
      };
      
      console.log('Database stats loaded:', {
        totalVehicles: stats.totalVehicles,
        totalValue: stats.totalValue,
        vehiclesWithValue,
        vehiclesProcessed: (allVehicles || []).length,
        totalCountFromQuery: totalCount
      });
      
      // #region agent log
      // #endregion
      
      setDbStats(stats);
    } catch (error) {
      console.error('Error loading database stats:', error);
      // #region agent log
      // #endregion
    } finally {
      setDbStatsLoading(false);
    }
  };

  // Load DB stats on mount and refresh periodically
  useEffect(() => {
    loadDatabaseStats();
    
    // Refresh stats every 30 seconds to keep data current
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadDatabaseStats();
      }
    }, 30000); // 30 seconds
    
    // Also refresh when page becomes visible (user returns to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadDatabaseStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Subscribe to real-time vehicle changes for instant updates
    const channel = supabase
      .channel('homepage-stats-updates')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'vehicles'
        },
        () => {
          // Debounce rapid changes - refresh after 2 seconds of no changes
          if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
          }
          refreshTimerRef.current = setTimeout(() => {
            loadDatabaseStats();
          }, 2000);
        }
      )
      .subscribe();
    
    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(channel);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Update filteredStats to show DB stats when no filters, filtered stats when filters active
  const displayStats = useMemo(() => {
    // #region agent log
    if (homepageDebugEnabled) {
      console.log('[DEBUG] displayStats computed', {
        hasActiveFilters,
        debouncedSearchText,
        dbStatsTotalVehicles: dbStats.totalVehicles,
        dbStatsTotalValue: dbStats.totalValue,
        filteredStatsTotalVehicles: filteredStats.totalVehicles,
        filteredStatsTotalValue: filteredStats.totalValue,
        willUseDbStats: !hasActiveFilters && !debouncedSearchText,
        dbStatsHasData: dbStats.totalVehicles > 0
      });
    }
    // #endregion
    
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
    setSession(currentSession);
    setLoading(false); // Always set loading to false after session check
    
    // Load user preference
    if (currentSession?.user) {
      try {
        const { data: prefs, error: prefsError } = await supabase
          .from('user_preferences')
          .select('preferred_view_mode, preferred_device, enable_gestures, enable_haptic_feedback, preferred_vendors, hidden_tags, favorite_makes, interaction_style')
          .eq('user_id', currentSession.user.id)
          .maybeSingle();
        
        // Handle table not existing or query errors gracefully
        if (prefsError) {
          // PGRST301 = table doesn't exist, PGRST116 = relation not found, 400 = bad request (might be missing column or RLS issue)
          if (prefsError.code === 'PGRST116' || prefsError.code === 'PGRST301' || prefsError.code === 'PGRST202' || prefsError.code === '42P01' || prefsError.code === '42703') {
            // Table/column doesn't exist or RLS blocking - silently ignore
            return;
          }
          // For other errors, log as warning but don't break the app
          console.warn('Error loading user preferences:', prefsError);
          return;
        }
        
        // Note: user_preferences doesn't have a 'settings' column
        // If we need preferred_time_period, we'd need to add it as a column
        // For now, just use defaults
      } catch (err) {
        // Table might not exist or other error - silently ignore
        // Don't log to avoid console noise
      }
    }
  };

  // Load accurate stats from database (not filtered feed)
  const loadAccurateStats = async () => {
    try {
      // Cache to avoid hammering a sometimes-slow RPC on every homepage visit.
      // If the RPC times out, we keep the UI responsive and fall back to cached stats.
      const CACHE_KEY = 'nuke_feed_stats_cache_v1';
      const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

      try {
        const cachedRaw = localStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached?.ts && (Date.now() - cached.ts) < CACHE_TTL_MS && cached?.stats) {
            setStats(cached.stats);
            setStatsLoading(false);
            // Continue in background to refresh cache (best-effort).
          }
        }
      } catch {
        // ignore cache parse errors
      }

      const timeoutMs = 4000;
      const rpcPromise = supabase.rpc('get_vehicle_feed_stats');
      const timeoutPromise = new Promise<{ data: any; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), timeoutMs)
      );

      const { data: statsData, error: statsError } = await Promise.race([rpcPromise, timeoutPromise]);

      if (!statsError && statsData) {
        const next = {
          totalBuilds: statsData.active_builds || 0,
          totalValue: statsData.total_value || 0,
          activeToday: statsData.updated_today || 0
        };
        setStats(next);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), stats: next }));
        } catch {
          // ignore
        }
      } else {
        // Don't spam console with repeated timeouts; cache should cover most sessions.
        if (statsError?.message !== 'timeout') {
          console.warn('Failed to load accurate stats:', statsError);
        }
      }
    } catch (err) {
      console.warn('Error loading accurate stats:', err);
    } finally {
      setStatsLoading(false);
    }
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
      setDebugInfo(null);

      const offset = pageNum * PAGE_SIZE;

      // When source filter is active, only fetch vehicles from included sources (so filter works and pagination is correct)
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
      let sourceOrFilter: string | null = null;
      if (includedKeysForFeed.length > 0) {
        const clauses: string[] = [];
        const keyToPatterns: Record<string, string[]> = {
          bat: ['discovery_url.ilike.%bringatrailer.com%', 'profile_origin.eq.bat_import'],
          craigslist: ['discovery_url.ilike.%craigslist.org%'],
          ksl: ['discovery_url.ilike.%ksl.com%'],
          classic: ['discovery_url.ilike.%classic.com%'],
        };
        for (const key of includedKeysForFeed) {
          if (keyToPatterns[key]) {
            clauses.push(...keyToPatterns[key]);
          } else {
            const domain = activeSources.find((s: { domain: string }) => domainToFilterKey(s.domain) === key)?.domain;
            if (domain) clauses.push(`discovery_url.ilike.%${domain}%`);
          }
        }
        if (clauses.length > 0) sourceOrFilter = clauses.join(',');
      }

      // Get vehicles for feed (keep payload small; avoid heavy origin_metadata + bulk image joins here).
      // NOTE: Do NOT select `listing_start_date` here. It is not a real column in the DB and will cause
      // PostgREST 400 errors if included in the `select()` list.
      // Simple query: most recent vehicles first, no filters.
      // Try to include canonical taxonomy columns if present; fallback gracefully if migration not applied yet.
      const selectV1 = `
          id, year, make, model, normalized_model, series, trim,
          engine, transmission, transmission_model, drivetrain, body_style, fuel_type,
          title, vin, created_at, updated_at,
          sale_price, current_value, purchase_price, asking_price,
          sale_date, sale_status,
          auction_outcome, high_bid, winning_bid, bid_count,
          auction_end_date,
          is_for_sale, mileage, status, is_public, primary_image_url, image_url, origin_organization_id,
          discovery_url, discovery_source, profile_origin
        `;
      const selectV1EngineSize = `
          id, year, make, model, normalized_model, series, trim,
          engine:engine_size, transmission, transmission_model, drivetrain, body_style, fuel_type,
          title, vin, created_at, updated_at,
          sale_price, current_value, purchase_price, asking_price,
          sale_date, sale_status,
          auction_outcome, high_bid, winning_bid, bid_count,
          auction_end_date,
          is_for_sale, mileage, status, is_public, primary_image_url, image_url, origin_organization_id,
          discovery_url, discovery_source, profile_origin
        `;
      const selectV2 = `
          id, year, make, model, normalized_model, series, trim,
          engine, transmission, transmission_model, drivetrain, body_style, fuel_type,
          canonical_vehicle_type, canonical_body_style,
          title, vin, created_at, updated_at,
          sale_price, current_value, purchase_price, asking_price,
          sale_date, sale_status,
          auction_outcome, high_bid, winning_bid, bid_count,
          auction_end_date,
          is_for_sale, mileage, status, is_public, primary_image_url, image_url, origin_organization_id,
          discovery_url, discovery_source, profile_origin
        `;
      const selectV2EngineSize = `
          id, year, make, model, normalized_model, series, trim,
          engine:engine_size, transmission, transmission_model, drivetrain, body_style, fuel_type,
          canonical_vehicle_type, canonical_body_style,
          title, vin, created_at, updated_at,
          sale_price, current_value, purchase_price, asking_price,
          sale_date, sale_status,
          auction_outcome, high_bid, winning_bid, bid_count,
          auction_end_date,
          is_for_sale, mileage, status, is_public, primary_image_url, image_url, origin_organization_id,
          discovery_url, discovery_source, profile_origin
        `;

      const getMissingColumn = (err: any): string | null => {
        const message = String(err?.message || '');
        const match =
          message.match(/column\s+[\w.]+\.(\w+)\s+does\s+not\s+exist/i) ||
          message.match(/column\s+(\w+)\s+does\s+not\s+exist/i);
        return match?.[1] || null;
      };

      const runVehicleQuery = async (selectFields: string) => {
        try {
          let q = supabase
            .from('vehicles')
            .select(selectFields)
            .eq('is_public', true)
            .neq('status', 'pending');
          if (listingKindSupportedRef.current) {
            q = q.eq('listing_kind', 'vehicle');
          }
          if (sourceOrFilter) {
            q = q.or(sourceOrFilter);
          }
          return await q
            .order('created_at', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
        } catch (e) {
          return { data: null, error: e };
        }
      };

      let vehicles: any[] | null = null;
      let error: any = null;
      const applyResult = (result: { data: any[] | null; error: any }) => {
        vehicles = result.data as any[] | null;
        error = result.error;
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
        const missingColumn = getMissingColumn(error);
        if (missingColumn?.startsWith('canonical_')) {
          result = await runVehicleQuery(selectV1);
          applyResult(result);
          if (error && getMissingColumn(error) === 'engine') {
            result = await runVehicleQuery(selectV1EngineSize);
            applyResult(result);
          }
        } else if (missingColumn === 'engine') {
          result = await runVehicleQuery(selectV2EngineSize);
          applyResult(result);
          if (error && getMissingColumn(error)?.startsWith('canonical_')) {
            result = await runVehicleQuery(selectV1EngineSize);
            applyResult(result);
          }
        }
      }

      if (error) {
        // Supabase/PostgREST errors often include a useful `details` / `hint` payload.
        // Log a structured object so production console isn't just "Object".
        console.error('❌ Error loading vehicles:', {
          message: error.message,
          code: (error as any).code,
          details: (error as any).details,
          hint: (error as any).hint,
        });
        setDebugInfo({
          when: 'CursorHomepage.loadHypeFeed',
          message: error.message,
          code: (error as any).code,
          details: (error as any).details,
          hint: (error as any).hint,
          // Snapshot of the intended query shape (helps debug schema drift)
          filters: { is_public: true, showPending: filters.showPending, timePeriod },
        });
        setError(`Failed to load vehicles: ${error.message}`);
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

      // Batch-load live auction bids (fixes: BaT cards showing EST/— instead of current bid).
      // Best-effort only: if RLS blocks external_listings for anon, we keep the old behavior.
      // Group by vehicle_id to support multiple listings per vehicle (VehicleCardDense uses external_listings[0]).
      // IMPORTANT: Filter for active/live listings to ensure badges show correctly on homepage.
      const externalListingsByVehicleId = new Map<string, any[]>();
      const auctionByVehicleId = new Map<string, any>(); // Keep for backward compatibility (display price logic)
      try {
        const ids = Array.from(new Set((vehicles || []).map((v: any) => String(v?.id || '')).filter(Boolean)));
        if (ids.length > 0) {
          const { data: listings, error: listErr } = await supabase
            .from('external_listings')
            .select('vehicle_id, platform, listing_status, current_bid, final_price, start_date, end_date, bid_count, updated_at, listing_url')
            .in('vehicle_id', ids)
            // Fetch ALL listings with future end dates (not just 'active'/'live' status)
            // Some scrapers use different status values ('pending', 'scheduled', etc.) for live auctions
            .gt('end_date', new Date().toISOString())
            .order('updated_at', { ascending: false })
            .limit(2000);
          if (!listErr && Array.isArray(listings)) {
            // Group all listings by vehicle_id and filter for truly active ones (future end_date)
            for (const row of listings as any[]) {
              const vid = String(row?.vehicle_id || '');
              if (!vid) continue;
              
              // Double-check end_date is actually in the future (belt and suspenders)
              const endDate = row.end_date ? new Date(row.end_date).getTime() : 0;
              if (!Number.isFinite(endDate) || endDate <= Date.now()) continue;
              
              // Add to grouped array (for VehicleCardDense)
              if (!externalListingsByVehicleId.has(vid)) {
                externalListingsByVehicleId.set(vid, []);
              }
              externalListingsByVehicleId.get(vid)!.push(row);
              
              // Keep first listing for backward compatibility (display price logic)
              if (!auctionByVehicleId.has(vid)) {
                auctionByVehicleId.set(vid, row);
              }
            }
            
            // Sort each vehicle's listings array by updated_at (most recent first)
            for (const [vid, listingsArray] of externalListingsByVehicleId.entries()) {
              listingsArray.sort((a, b) => {
                return (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
              });
            }
          }
        }
      } catch {
        // ignore
      }

      // Helper function to check if an image URL indicates poor quality or wrong image
      const isPoorQualityImage = (url: string | null, fileSize: number | null = null): boolean => {
        if (!url) return true;
        const urlLower = String(url).toLowerCase();
        
        // Check for dealer logos and placeholder images
        if (
          urlLower.includes('/dealer/') ||
          urlLower.includes('/logo') ||
          urlLower.includes('logo-') ||
          urlLower.includes('.svg') ||
          urlLower.includes('placeholder') ||
          urlLower.includes('no-image') ||
          urlLower.includes('default') ||
          urlLower.includes('missing')
        ) {
          return true;
        }
        
        // Check for very small file sizes (< 10KB typically indicates low quality or placeholder)
        if (fileSize !== null && fileSize < 10000) {
          return true;
        }
        
        // Check for known bad URL patterns (dealer logos from classic.com, etc.)
        // These are always logos, not actual car photos
        if (
          urlLower.includes('images.classic.com/uploads/dealer/') ||
          urlLower.includes('images.classic.com/uploads/dealer') ||
          (urlLower.includes('cdn.dealeraccelerate.com') && urlLower.includes('logo'))
        ) {
          return true;
        }
        
        // Check for PNG files with small dimensions in query params (like ?h=150&w=150)
        // These are typically dealer logos or thumbnails, not full car photos
        if (urlLower.includes('.png') && (urlLower.includes('?h=150') || urlLower.includes('&h=150') || urlLower.includes('?w=150') || urlLower.includes('&w=150'))) {
          // But allow if it's from a known good source (like BaT or our own storage)
          if (!urlLower.includes('images.classic.com') && !urlLower.includes('/dealer/')) {
            // Might be a legitimate thumbnail, so don't filter it out
            return false;
          }
          // If it's from classic.com or has /dealer/, it's definitely a logo
          return true;
        }
        
        return false;
      };

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
              .order('is_primary', { ascending: false })
              .order('created_at', { ascending: true });
            
            if (imgErr) {
              // Non-fatal: continue without thumbnails
              console.warn('Failed to fetch thumbnail chunk:', imgErr);
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
        console.warn('Error loading image variants:', err);
        // Non-fatal: continue with fallback images
      }

      // Filter out vehicles without images or with only poor quality images
      const vehiclesWithGoodImages = (vehicles || []).filter((v: any) => {
        const vehicleId = String(v?.id || '');
        
        // Check if vehicle has good quality images from vehicle_images table
        const quality = vehicleImageQualityMap.get(vehicleId);
        const hasGoodImagesFromTable = quality?.hasGoodImages || false;
        const hasThumbnail = thumbnailByVehicleId.has(vehicleId);
        const hasMedium = mediumByVehicleId.has(vehicleId);
        
        // Check if vehicle has primary_image_url or image_url set (and they're good quality)
        const primaryImageUrl = v.primary_image_url ? String(v.primary_image_url).trim() : null;
        const imageUrl = v.image_url ? String(v.image_url).trim() : null;
        const hasGoodPrimaryImage = primaryImageUrl && primaryImageUrl.length > 0 && !isPoorQualityImage(primaryImageUrl);
        const hasGoodImageUrl = imageUrl && imageUrl.length > 0 && !isPoorQualityImage(imageUrl);
        
        // Check if vehicle has images in origin_metadata (for scraped listings)
        // Filter out poor quality origin images
        const originImages = getOriginImages(v);
        const goodOriginImages = originImages.filter(img => !isPoorQualityImage(img));
        const hasGoodOriginImages = goodOriginImages.length > 0;
        
        // Vehicle must have at least one GOOD quality image from any source
        return hasGoodImagesFromTable || hasThumbnail || hasMedium || hasGoodPrimaryImage || hasGoodImageUrl || hasGoodOriginImages;
      });

      // Process vehicles with optimized image data (use thumbnails for grid performance)
      const processed = vehiclesWithGoodImages.map((v: any) => {
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
        // 4. Live bid from external_listings
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
        
        // Fallback chain: thumbnail -> medium -> primary_image_url -> image_url
        // BUT: Only use images that pass quality checks
        const normalizedPrimary = v.primary_image_url ? normalizeSupabaseStorageUrl(v.primary_image_url) : null;
        const normalizedImageUrl = v.image_url ? normalizeSupabaseStorageUrl(v.image_url) : null;
        
        // Check each candidate and only use good quality images
        const optimalImageUrl = 
          (thumbnailUrl && !isPoorQualityImage(thumbnailUrl)) ? thumbnailUrl :
          (mediumUrl && !isPoorQualityImage(mediumUrl)) ? mediumUrl :
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

        // Attach external_listings array for VehicleCardDense auction badge detection
        const externalListings = externalListingsByVehicleId.get(vehicleId) || [];
        
        return {
          ...v,
          make: displayMake || v.make,
          model: displayModel || v.model,
          display_price: displayPrice,
          image_count: allImages?.length || (optimalImageUrl ? 1 : 0),
          view_count: 0,
          event_count: 0,
          activity_7d: 0,
          hype_score: hypeScore,
          hype_reason: hypeReason,
          primary_image_url: optimalImageUrl,
          image_url: optimalImageUrl,
          // Store image variants for VehicleCardDense to use
          image_variants: {
            thumbnail: thumbnailUrl || undefined,
            medium: mediumUrl || undefined,
            large: mediumUrl || optimalImageUrl || undefined,
          },
          all_images: allImages || (optimalImageUrl ? [{ id: `fallback-${v.id}-0`, url: optimalImageUrl, is_primary: true }] : []),
          // Attach external_listings for auction badge detection (VehicleCardDense expects external_listings[0])
          external_listings: externalListings.length > 0 ? externalListings : undefined,
          tier: 'C',
          tier_label: 'Tier C'
        };
      });

      // Final filter: Remove vehicles that ended up with no good quality images after processing
      // This catches cases where a vehicle passed initial checks but all its images were poor quality
      const sorted = processed.filter((v: any) => {
        // Check the processed image URL (which should be optimalImageUrl)
        const imageUrl = v.primary_image_url || v.image_url;
        if (!imageUrl) return false; // No image at all
        return !isPoorQualityImage(imageUrl); // Must be good quality
      });

      // Dedupe by canonical listing URL to reduce "same car, multiple rows" spam in the feed.
      // Keep the first-seen ordering (newest-first) but swap-in the "best" record for that listing.
      const normalizeListingKey = (raw: unknown): string | null => {
        const s = String(raw ?? '').trim();
        if (!s) return null;
        if (!/^https?:\/\//i.test(s)) return null;
        try {
          const u = new URL(s);
          u.hash = '';
          u.search = '';
          return u.toString().toLowerCase();
        } catch {
          // Fall back to a naive strip (still useful for most listing URLs)
          return s.split('#')[0].split('?')[0].toLowerCase();
        }
      };

      const getDedupeKey = (row: any): string | null => {
        if (!row) return null;
        const direct = normalizeListingKey(row.discovery_url);
        if (direct) return direct;
        const fromListing = normalizeListingKey(row?.external_listings?.[0]?.listing_url);
        if (fromListing) return fromListing;
        return null;
      };

      const scoreForDedupe = (row: any): number => {
        if (!row) return 0;
        let score = 0;
        if (row.vin) score += 10;
        if (row.make) score += 2;
        if (row.model) score += 2;
        if (row.title) score += 1;
        if (row.sale_price || row.winning_bid || row.high_bid || row.asking_price || row.display_price) score += 3;
        if (Array.isArray(row.external_listings) && row.external_listings.length > 0) score += 2;
        if (row.primary_image_url || row.image_url) score += 1;
        try {
          const ts = row.updated_at ? new Date(row.updated_at).getTime() : 0;
          if (Number.isFinite(ts) && ts > 0) score += Math.min(1, ts / 1e13);
        } catch {
          // ignore
        }
        return score;
      };

      const dedupeVehicles = (items: any[]) => {
        const byKey = new Map<string, { idx: number; best: any; score: number }>();
        const order: string[] = [];
        const passthrough: any[] = [];

        for (let i = 0; i < (items || []).length; i++) {
          const it = items[i];
          const key = getDedupeKey(it);
          if (!key) {
            passthrough.push(it);
            continue;
          }
          const s = scoreForDedupe(it);
          const existing = byKey.get(key);
          if (!existing) {
            byKey.set(key, { idx: i, best: it, score: s });
            order.push(key);
          } else if (s > existing.score) {
            byKey.set(key, { ...existing, best: it, score: s });
          }
        }

        // Merge: preserve listing order, then append non-dedupable items (rare; usually user uploads).
        const deduped = order.map((k) => byKey.get(k)!.best);
        return [...deduped, ...passthrough];
      };

      const dedupedSorted = dedupeVehicles(sorted);
      
      setHasMore((vehicles || []).length >= PAGE_SIZE);
      setPage(pageNum);

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
            .select('id, website')
            .in('id', orgIds);
          if (!orgErr && Array.isArray(orgs)) {
            const next: Record<string, string> = {};
            for (const o of orgs as any[]) {
              if (o?.id && typeof o?.website === 'string' && o.website.trim()) {
                next[o.id] = o.website.trim();
              }
            }
            setOrgWebsitesById(next);
          }
        }
      } catch {
        // ignore - favicon stamps can fall back to discovery_url / source mapping
      }

    } catch (error: any) {
      console.error('❌ Unexpected error loading feed:', error);
      setError(`Unexpected error: ${error?.message || 'Unknown error'}`);
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
    if (loading || loadingMore) return;
    if (infiniteObserverRef.current) infiniteObserverRef.current.disconnect();

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

    if (node) infiniteObserverRef.current.observe(node);
  }, [hasMore, loadMore, loading, loadingMore]);

  // Format currency values for display (exact numbers with commas)
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const applyRalphPreset = useCallback((preset: RalphHomepagePreset) => {
    const next = { ...DEFAULT_FILTERS, ...(preset?.filters || {}) } as FilterState;
    setFilters(next);
    setSearchText('');
    setGenerativeFilters([]);
    setShowFilters(true);
    setFilterBarMinimized(false);
  }, []);

  const loadRalphPresets = useCallback(async () => {
    if (ralphLoading) return;
    setRalphLoading(true);
    setRalphError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('ralph-wiggum-rlm-homepage', {
        body: {
          action: 'generate_presets',
          max_vehicles: 260,
          max_presets: 10,
        }
      });

      if (invokeError) throw invokeError;

      const presets = data?.output?.presets;
      if (!Array.isArray(presets)) {
        throw new Error('Ralph returned an unexpected payload');
      }
      setRalphPresets(presets as RalphHomepagePreset[]);
    } catch (e: any) {
      setRalphError(e?.message || 'Failed to load Ralph presets');
    } finally {
      setRalphLoading(false);
    }
  }, [ralphLoading]);

  // Generative filters - create 10 random filters
  const generateRandomFilters = () => {
    const allVehicles = feedVehicles;
    if (allVehicles.length === 0) {
      alert('Load vehicles first');
      return;
    }

    // Collect available data for randomization
    const makes = Array.from(new Set(allVehicles.map(v => v.make).filter(Boolean))) as string[];
    const colors = ['red', 'blue', 'black', 'white', 'green', 'yellow', 'orange', 'silver', 'gray', 'brown'];
    const conditions = ['excellent', 'good', 'fair', 'creampuff', 'mint', 'pristine', 'survivor'];
    const areas = ['California', 'Texas', 'Florida', 'New York', 'Arizona', 'Nevada', 'Oregon'];
    const priceRanges = [
      { min: 5000, max: 15000, label: '$5k-$15k' },
      { min: 15000, max: 30000, label: '$15k-$30k' },
      { min: 30000, max: 50000, label: '$30k-$50k' },
      { min: 50000, max: 100000, label: '$50k-$100k' },
    ];

    const randomFilters: string[] = [];
    const newFilters: FilterState = { ...DEFAULT_FILTERS };

    // Generate 10 random filters (pick 2-3 to apply)
    const filterTypes: Array<() => void> = [
      // Make filter
      () => {
        if (makes.length > 0) {
          const make = makes[Math.floor(Math.random() * makes.length)];
          randomFilters.push(`Only ${make}`);
          newFilters.makes = [make];
        }
      },
      // Price range
      () => {
        const range = priceRanges[Math.floor(Math.random() * priceRanges.length)];
        randomFilters.push(`Only ${range.label}`);
        newFilters.priceMin = range.min;
        newFilters.priceMax = range.max;
      },
      // Year range
      () => {
        const yearMin = 1960 + Math.floor(Math.random() * 40);
        const yearMax = Math.min(yearMin + Math.floor(Math.random() * 15) + 5, new Date().getFullYear());
        randomFilters.push(`Only ${yearMin}-${yearMax}`);
        newFilters.yearMin = yearMin;
        newFilters.yearMax = yearMax;
      },
      // Color + make combo
      () => {
        if (makes.length > 0) {
          const color = colors[Math.floor(Math.random() * colors.length)];
          const make = makes[Math.floor(Math.random() * makes.length)];
          randomFilters.push(`Only ${color} ${make}`);
          newFilters.makes = [make];
        }
      },
      // Condition/quality
      () => {
        const condition = conditions[Math.floor(Math.random() * conditions.length)];
        randomFilters.push(`Only ${condition} condition`);
        newFilters.hasImages = true; // Assume creampuffs have images
      },
      // Location-based (would need location data)
      () => {
        const area = areas[Math.floor(Math.random() * areas.length)];
        randomFilters.push(`Only ${area}`);
        // Note: Would need location data in vehicles table
      },
      // Price floor
      () => {
        const minPrice = [5000, 10000, 20000, 30000, 50000][Math.floor(Math.random() * 5)];
        randomFilters.push(`Only $${(minPrice / 1000)}k+`);
        newFilters.priceMin = minPrice;
      },
      // For sale only
      () => {
        randomFilters.push(`Only for sale`);
        newFilters.forSale = true;
      },
      // Has images
      () => {
        randomFilters.push(`Only with images`);
        newFilters.hasImages = true;
      },
      // Specific decade
      () => {
        const decades = [
          { label: '60s', min: 1960, max: 1969 },
          { label: '70s', min: 1970, max: 1979 },
          { label: '80s', min: 1980, max: 1989 },
          { label: '90s', min: 1990, max: 1999 },
          { label: '2000s', min: 2000, max: 2009 },
        ];
        const decade = decades[Math.floor(Math.random() * decades.length)];
        randomFilters.push(`Only ${decade.label}`);
        newFilters.yearMin = decade.min;
        newFilters.yearMax = decade.max;
      },
    ];

    // Pick 2-3 random filters to apply
    const numFilters = 2 + Math.floor(Math.random() * 2); // 2 or 3 filters
    const selected = new Set<number>();
    while (selected.size < numFilters && selected.size < filterTypes.length) {
      selected.add(Math.floor(Math.random() * filterTypes.length));
    }

    selected.forEach(idx => filterTypes[idx]());

    setGenerativeFilters(randomFilters);
    setFilters(newFilters);
    setShowFilters(true); // Show filters when generative filters are applied
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

  const handleTimePeriodChange = async (period: TimePeriod) => {
    setTimePeriod(period);
    
    if (session?.user) {
      try {
        await UserInteractionService.logInteraction(
          session.user.id,
          'view',
          'vehicle',
          'time-period-filter',
          {
            source_page: '/homepage'
          } as any
        );

        // Note: user_preferences table doesn't have a 'settings' column
        // It has individual columns. For now, we'll skip this update
        // TODO: Add preferred_time_period column to user_preferences table if needed
        // Silently skip - table structure doesn't support this yet
      } catch (error: any) {
        // For other errors, log as warning but don't break the app
        console.warn('Error saving user preferences:', error);
      }
    }
  };

  // Source pogs are "include chips": if it's in your set, you see those vehicles.
  // We keep legacy `hide*` flags for now, but treat them as derived from "included chips".
  // For new dynamic sources, we use a hiddenSources set in filters.
  const setSourceIncluded = useCallback((kind: string, included: boolean) => {
    // #region agent log
    // #endregion

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
  }, [filters]);

  // Load active sources from database
  useEffect(() => {
    async function loadActiveSources() {
      try {
        const { data, error } = await supabase
          .from('scrape_sources')
          .select('id, name, url, is_active')
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (error) {
          console.error('Error loading sources:', error);
          // Fallback to hardcoded sources if DB fails
          setActiveSources([
            { id: '1', domain: 'craigslist.org', source_name: 'Craigslist', url: 'https://craigslist.org' },
            { id: '2', domain: 'ksl.com', source_name: 'KSL', url: 'https://ksl.com' },
            { id: '3', domain: 'autotrader.com', source_name: 'Dealer Sites', url: 'https://autotrader.com' },
            { id: '4', domain: 'bringatrailer.com', source_name: 'Bring a Trailer', url: 'https://bringatrailer.com' },
            { id: '5', domain: 'classic.com', source_name: 'Classic.com', url: 'https://classic.com' }
          ]);
        } else {
          // Transform data to extract domain from URL
          const transformedData = (data || []).map(source => {
            // Extract domain from URL
            let domain = source.url;
            try {
              const urlObj = new URL(source.url);
              domain = urlObj.hostname.replace(/^www\./, '');
            } catch {
              // If URL parsing fails, try regex
              domain = source.url
                .replace(/^https?:\/\/(www\.)?/, '')
                .replace(/\/.*$/, '');
            }
            
            return {
              id: source.id,
              domain: domain,
              source_name: source.name,
              url: source.url
            };
          });
          
          setActiveSources(transformedData);
        }
      } catch (err) {
        console.error('Error loading sources:', err);
      } finally {
        setSourcesLoading(false);
      }
    }

    loadActiveSources();
  }, []);

  // Load vehicle counts per source
  useEffect(() => {
    async function loadSourceCounts() {
      try {
        // Get all public vehicles with source info
        const { data: vehicles, error } = await supabase
          .from('vehicles')
          .select('discovery_url, discovery_source, profile_origin')
          .eq('is_public', true)
          .neq('status', 'pending');

        if (error) {
          if (isMissingListingKindColumn(error)) {
            listingKindSupportedRef.current = false;
            const retry = await supabase
              .from('vehicles')
              .select('discovery_url, discovery_source, profile_origin')
              .eq('is_public', true)
              .neq('status', 'pending');
            if (retry.error) {
              console.error('Error loading source counts:', retry.error);
              return;
            }
            // eslint-disable-next-line @typescript-eslint/no-shadow
            const vehicles = retry.data as any[];
            setSourceCounts(buildSourceCounts(vehicles || []));
            return;
          }
          console.error('Error loading source counts:', error);
          return;
        }

        setSourceCounts(buildSourceCounts(vehicles || []));
      } catch (err) {
        console.error('Error loading source counts:', err);
      }
    }

    if (activeSources.length > 0) {
      loadSourceCounts();
    }
  }, [activeSources, buildSourceCounts, domainToFilterKey]);

  const faviconUrl = useCallback((domain: string) => {
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
  }, []);

  const sourcePogs = useMemo(() => {
    // Deduplicate sources by their filter key - keep the first one for each key
    const deduplicatedMap = new Map<string, {
      key: string;
      domain: string;
      title: string;
      included: boolean;
      id: string;
      url: string;
      count: number;
    }>();

    activeSources.forEach((source) => {
      const key = domainToFilterKey(source.domain);
      if (!key || deduplicatedMap.has(key)) return;
      const meta = SOURCE_META[key];
      deduplicatedMap.set(key, {
        key,
        domain: meta?.domain || source.domain,
        title: meta?.title || source.source_name || source.domain,
        included: includedSources[key] !== false, // Default to true if not explicitly set
        id: meta ? key : source.id,
        url: meta ? `https://${meta.domain}` : source.url,
        count: sourceCounts[key] || 0
      });
    });

    const deduplicated = Array.from(deduplicatedMap.values()).sort((a, b) => {
      if (a.included !== b.included) return a.included ? -1 : 1;
      if (a.count !== b.count) return b.count - a.count;
      const titleCompare = a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
      if (titleCompare !== 0) return titleCompare;
      return a.domain.localeCompare(b.domain, undefined, { sensitivity: 'base', numeric: true });
    });

    // #region agent log
    const batSources = deduplicated.filter(s => s.key === 'bat' || s.domain.toLowerCase().includes('bringatrailer') || s.domain.toLowerCase().includes('bat'));
    // #endregion

    return {
      all: deduplicated,
      selected: deduplicated.filter((x) => x.included),
      hiddenCount: deduplicated.filter((x) => !x.included).length
    };
  }, [activeSources, includedSources, domainToFilterKey, sourceCounts]);

  const domainHue = useCallback((domain: string) => {
    // Deterministic pseudo-“dominant color” per domain without needing canvas/CORS.
    // Hash -> hue. Stable across sessions.
    const s = String(domain || '').toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h % 360;
  }, []);

  const domainGradient = useCallback((domain: string) => {
    const h1 = domainHue(domain);
    const h2 = (h1 + 42) % 360;
    return `linear-gradient(135deg, hsla(${h1}, 92%, 60%, 0.38), hsla(${h2}, 92%, 56%, 0.16))`;
  }, [domainHue]);

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

  // Toggle for-sale filter
  const toggleForSale = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      forSale: !prev.forSale,
      showSoldOnly: false, // Can't show sold when filtering for sale
      hideSold: !prev.forSale ? true : prev.hideSold, // Hide sold when showing for sale
    }));
    setSortBy('price_high'); // Sort by price when showing for sale
    setSortDirection('desc');
  }, []);

  const openStatsPanel = useCallback((kind: StatsPanelKind) => {
    setStatsPanel(kind);
  }, []);

  const closeStatsPanel = useCallback(() => {
    setStatsPanel(null);
  }, []);

  // Load lightweight preview data for stats panels (best-effort, never blocks the feed).
  useEffect(() => {
    if (!statsPanel) return;
    let cancelled = false;

    setStatsPanelLoading(true);
    setStatsPanelError(null);
    setStatsPanelRows([]);
    setStatsPanelMeta(null);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const todayISO = todayStart.toISOString().split('T')[0];
    const nowIso = new Date().toISOString();

    const selectMini = 'id, year, make, model, created_at, sale_date, sale_price, asking_price, current_value, purchase_price, primary_image_url, image_url, discovery_url';

    const run = async () => {
      try {
        if (statsPanel === 'vehicles') {
          const [pendingRes, publicAllRes, allVisibleRes, nonVehicleRes, newestRes] = await Promise.all([
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select('*', { count: 'exact', head: true })
                .eq('is_public', true)
                .eq('status', 'pending');
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select('*', { count: 'exact', head: true })
                .eq('is_public', true);
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select('*', { count: 'exact', head: true });
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              if (!includeListingKind) return { data: null, error: null, count: 0 } as any;
              return supabase
                .from('vehicles')
                .select('*', { count: 'exact', head: true })
                .eq('is_public', true)
                .neq('status', 'pending')
                .eq('listing_kind', 'non_vehicle_item');
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select(selectMini)
                .eq('is_public', true)
                .neq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(24);
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
          ]);

          if (cancelled) return;
          setStatsPanelMeta({
            pendingPublicCount: pendingRes?.count || 0,
            publicTotalIncludingPending: publicAllRes?.count || 0,
            totalVisibleAllRecords: allVisibleRes?.count || 0,
            publicNonVehicleItems: nonVehicleRes?.count || 0,
          });
          setStatsPanelRows(Array.isArray(newestRes?.data) ? newestRes.data : []);
          return;
        }

        if (statsPanel === 'value') {
          const { data } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
            let q = supabase
              .from('vehicles')
              .select(selectMini)
              .eq('is_public', true)
              .neq('status', 'pending')
              .order('created_at', { ascending: false })
              .limit(24);
            if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
            return q;
          });
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(data) ? (data as any[]) : []);
          return;
        }

        if (statsPanel === 'for_sale') {
          const { data } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
            let q = supabase
              .from('vehicles')
              .select(selectMini)
              .eq('is_public', true)
              .neq('status', 'pending')
              .eq('is_for_sale', true)
              .order('updated_at', { ascending: false })
              .limit(24);
            if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
            return q;
          });
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(data) ? (data as any[]) : []);
          return;
        }

        if (statsPanel === 'sold_today') {
          const { data } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
            let q = supabase
              .from('vehicles')
              .select(selectMini)
              .eq('is_public', true)
              .neq('status', 'pending')
              .not('sale_price', 'is', null)
              .gte('sale_date', todayISO)
              .order('sale_date', { ascending: false })
              .limit(24);
            if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
            return q;
          });
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(data) ? (data as any[]) : []);
          return;
        }

        if (statsPanel === 'auctions') {
          // Prefer external_listings for "live" auctions (end_date in future). If RLS blocks it, fall back.
          try {
            const { data: listings, error: listErr } = await supabase
              .from('external_listings')
              .select('vehicle_id, platform, listing_status, current_bid, end_date, updated_at, listing_url')
              .gt('end_date', nowIso)
              .order('updated_at', { ascending: false })
              .limit(2000);

            if (!listErr && Array.isArray(listings) && listings.length > 0) {
              const byVehicle = new Map<string, any>();
              for (const row of listings as any[]) {
                const vid = String(row?.vehicle_id || '');
                if (!vid) continue;
                if (!byVehicle.has(vid)) byVehicle.set(vid, row);
              }
              const ids = Array.from(byVehicle.keys()).slice(0, 50);
              const { data: vrows } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
                let q = supabase
                  .from('vehicles')
                  .select(selectMini)
                  .eq('is_public', true)
                  .neq('status', 'pending')
                  .in('id', ids);
                if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
                return q;
              });

              const rows = (Array.isArray(vrows) ? vrows : []).map((v: any) => ({
                ...v,
                _listing: byVehicle.get(String(v?.id || '')) || null,
              }));

              if (cancelled) return;
              setStatsPanelRows(rows);
              setStatsPanelMeta({ listing_source: 'external_listings' });
              return;
            }
          } catch {
            // ignore and fall through
          }

          const { data } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
            let q = supabase
              .from('vehicles')
              .select(selectMini)
              .eq('is_public', true)
              .neq('status', 'pending')
              .or('auction_outcome.eq.active,auction_outcome.eq.live')
              .order('updated_at', { ascending: false })
              .limit(24);
            if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
            return q;
          });
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(data) ? (data as any[]) : []);
          setStatsPanelMeta({ listing_source: 'vehicles.auction_outcome' });
          return;
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatsPanelError(String(e?.message || e || 'Failed to load stats panel'));
      } finally {
        if (cancelled) return;
        setStatsPanelLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [statsPanel, runVehiclesQueryWithListingKindFallback]);

  // Show grid immediately - no loading state blocking
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingTop: '16px' }}>
      {statsPanel && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 20000,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: 'var(--space-4)',
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            closeStatsPanel();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            style={{
              width: 'min(980px, calc(100vw - 24px))',
              maxHeight: 'min(82vh, 860px)',
              overflow: 'auto',
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              borderRadius: 'var(--radius)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderBottom: '2px solid var(--border)' }}>
              <div style={{ fontSize: '9pt', fontWeight: 900 }}>
                {statsPanel === 'vehicles'
                  ? 'Vehicles'
                  : statsPanel === 'value'
                  ? 'Value'
                  : statsPanel === 'for_sale'
                  ? 'For sale'
                  : statsPanel === 'sold_today'
                  ? 'Sold today'
                  : 'Auctions'}
              </div>
              <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                {statsPanel === 'vehicles' && (
                  <button
                    type="button"
                    className="button-win95"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleAddedTodayOnly();
                    }}
                    style={{ padding: '4px 8px', fontSize: '8pt' }}
                    title="Toggle filter: vehicles created today"
                  >
                    +today
                  </button>
                )}
                <button
                  type="button"
                  className="button-win95"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeStatsPanel();
                  }}
                  style={{ padding: '4px 8px', fontSize: '8pt' }}
                >
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 'var(--space-4)' }}>
              {statsPanelLoading ? (
                <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>Loading…</div>
              ) : statsPanelError ? (
                <div style={{ fontSize: 'var(--fs-9)', color: 'var(--error)' }}>{statsPanelError}</div>
              ) : (
                <>
                  {statsPanel === 'value' && (
                    <>
                      {/* Current value snapshot */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginBottom: '16px' }}>
                        <div style={{ border: '2px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>BEST-KNOWN VALUE</div>
                          <div style={{ fontSize: '12pt', fontWeight: 900 }}>{formatCurrency(displayStats.totalValue)}</div>
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                            Uses priority: sale &gt; bids &gt; ask &gt; mark &gt; cost.
                          </div>
                          <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>HEADER:</div>
                            {([
                              { mode: 'best_known', label: 'val' },
                              { mode: 'mark', label: 'mark' },
                              { mode: 'ask', label: 'ask' },
                              { mode: 'realized', label: 'realized' },
                              { mode: 'cost', label: 'cost' },
                            ] as Array<{ mode: ValueMetricMode; label: string }>).map((m) => (
                              <button
                                key={m.mode}
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setValueMetricMode(m.mode);
                                }}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '7pt',
                                  border: '1px solid var(--border)',
                                  background: valueMetricMode === m.mode ? 'var(--grey-600)' : 'transparent',
                                  color: valueMetricMode === m.mode ? 'var(--white)' : 'var(--text)',
                                  cursor: 'pointer',
                                  borderRadius: 6,
                                  fontFamily: 'monospace',
                                  fontWeight: 900,
                                }}
                                title="Choose which value concept the header shows"
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{ border: '2px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>BREAKDOWN</div>
                          <div style={{ fontSize: '8pt', lineHeight: 1.35 }}>
                            <div><b>{formatCurrency(displayStats.valueMarkTotal)}</b> mark (current_value)</div>
                            <div><b>{formatCurrency(displayStats.valueAskTotal)}</b> ask (for sale)</div>
                            <div><b>{formatCurrency(displayStats.valueRealizedTotal)}</b> realized (sale_price)</div>
                            <div><b>{formatCurrency(displayStats.valueCostTotal)}</b> cost (purchase_price)</div>
                          </div>
                        </div>
                        <div style={{ border: '2px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>VALUE ADDED (IMPORTS)</div>
                          <div style={{ fontSize: '8pt', lineHeight: 1.35 }}>
                            <div><b>{formatCurrency(displayStats.valueImportedToday)}</b> today</div>
                            <div><b>{formatCurrency(displayStats.valueImported24h)}</b> last 24h</div>
                            <div><b>{formatCurrency(displayStats.valueImported7d)}</b> last 7d</div>
                          </div>
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '6px' }}>
                            Note: "Sold date" can be old, but "import date" is created_at.
                          </div>
                        </div>
                      </div>

                      {/* Value trends charts - temporarily disabled
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                        <div style={{ fontSize: '8pt', fontWeight: 900, marginBottom: '12px' }}>VALUE TRENDS</div>
                        <ValueTrendsPanel
                          chartWidth={260}
                          chartHeight={70}
                        />
                      </div>
                      */}
                    </>
                  )}

                  {statsPanel === 'vehicles' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      <div><b>{displayStats.totalVehicles.toLocaleString()}</b> visible vehicles</div>
                      <div><b>{displayStats.vehiclesAddedToday.toLocaleString()}</b> added today</div>
                      {statsPanelMeta?.pendingPublicCount ? <div><b>{Number(statsPanelMeta.pendingPublicCount).toLocaleString()}</b> pending</div> : null}
                      {statsPanelMeta?.publicTotalIncludingPending ? <div><b>{Number(statsPanelMeta.publicTotalIncludingPending).toLocaleString()}</b> public total (incl pending)</div> : null}
                      {statsPanelMeta?.totalVisibleAllRecords ? <div><b>{Number(statsPanelMeta.totalVisibleAllRecords).toLocaleString()}</b> total records (visible to you)</div> : null}
                      {statsPanelMeta?.publicNonVehicleItems ? <div><b>{Number(statsPanelMeta.publicNonVehicleItems).toLocaleString()}</b> non-vehicle items hidden</div> : null}
                    </div>
                  )}

                  {(statsPanel === 'for_sale' || statsPanel === 'sold_today' || statsPanel === 'auctions' || statsPanel === 'vehicles' || statsPanel === 'value') && (
                    <>
                      <div style={{ fontSize: '8pt', fontWeight: 900, marginTop: statsPanel === 'value' ? '12px' : 0 }}>
                        {statsPanel === 'vehicles'
                          ? 'Newest profiles'
                          : statsPanel === 'value'
                          ? 'Newest imports (click to open)'
                          : statsPanel === 'for_sale'
                          ? 'For sale (preview)'
                          : statsPanel === 'sold_today'
                          ? 'Sold today (preview)'
                          : 'Active auctions (preview)'}
                      </div>

                      <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', padding: '10px 0' }}>
                        {(statsPanelRows || []).map((v: any) => {
                          const title = `${v?.year ?? ''} ${v?.make ?? ''} ${v?.model ?? ''}`.trim() || 'Vehicle';
                          const rawImg = String(v?.primary_image_url || v?.image_url || '').trim();
                          // Optimize image for 140px display - use thumbnail size (150px)
                          const img = rawImg ? (optimizeImageUrl(rawImg, 'thumbnail') || rawImg) : '/n-zero.png';

                          const salePrice = typeof v?.sale_price === 'number' ? v.sale_price : Number(v?.sale_price || 0) || 0;
                          const ask = typeof v?.asking_price === 'number' ? v.asking_price : Number(v?.asking_price || 0) || 0;
                          const mark = typeof v?.current_value === 'number' ? v.current_value : Number(v?.current_value || 0) || 0;
                          const subtitle =
                            statsPanel === 'sold_today'
                              ? (salePrice > 0 ? `SOLD ${formatCurrency(salePrice)}` : 'SOLD')
                              : statsPanel === 'for_sale'
                              ? (ask > 0 ? `ASK ${formatCurrency(ask)}` : (mark > 0 ? `MARK ${formatCurrency(mark)}` : 'For sale'))
                              : statsPanel === 'auctions'
                              ? (() => {
                                  const bid = Number((v as any)?._listing?.current_bid || 0) || 0;
                                  const plat = String((v as any)?._listing?.platform || '').toUpperCase();
                                  return bid > 0 ? `${plat ? plat + ' ' : ''}BID ${formatCurrency(bid)}` : (plat ? `${plat} LIVE` : 'Auction');
                                })()
                              : (mark > 0 ? `MARK ${formatCurrency(mark)}` : (ask > 0 ? `ASK ${formatCurrency(ask)}` : (salePrice > 0 ? `SOLD ${formatCurrency(salePrice)}` : '—')));

                          const createdAt = v?.created_at ? String(v.created_at) : '';
                          const saleDate = v?.sale_date ? String(v.sale_date) : '';
                          const metaLine =
                            statsPanel === 'value'
                              ? `imported ${createdAt ? new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}${saleDate ? ` · sold ${new Date(saleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
                              : '';

                          return (
                            <Link
                              key={String(v?.id || Math.random())}
                              to={`/vehicle/${v.id}`}
                              style={{
                                flex: '0 0 auto',
                                width: 140,
                                textDecoration: 'none',
                                color: 'inherit',
                                border: '1px solid var(--border)',
                                background: 'var(--surface)',
                                borderRadius: 6,
                                overflow: 'hidden',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                closeStatsPanel();
                              }}
                            >
                              <div style={{ width: '100%', paddingBottom: '100%', background: 'var(--grey-200)', position: 'relative' }}>
                                <img
                                  src={img}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </div>
                              <div style={{ padding: '6px' }}>
                                <div style={{ fontSize: '8pt', fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={title}>
                                  {title}
                                </div>
                                <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
                                {metaLine ? <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 2 }}>{metaLine}</div> : null}
                              </div>
                            </Link>
                          );
                        })}
                        {(!statsPanelRows || statsPanelRows.length === 0) && (
                          <div style={{ fontSize: '9pt', color: 'var(--text-muted)', padding: '10px 0' }}>
                            No rows found for this panel.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Feed Section - No stats, no filters, just vehicles */}
      <div style={{
        maxWidth: '1600px',
        margin: '0 auto',
        padding: '0 16px'
      }}>
        {/* Sticky Minimized Filter Bar - docks under the sticky header/search bar */}
        {filterBarMinimized && (
          <div
            onClick={openFiltersFromMiniBar}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFiltersFromMiniBar();
              }
            }}
            title="Click to open filters"
            role="button"
            tabIndex={0}
            aria-label="Open filters"
            style={{
            position: 'sticky',
            top: 'var(--header-height, 40px)',
            background: 'var(--surface-glass)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--border)',
            padding: '6px 10px',
            marginBottom: '10px',
            zIndex: 900,
            boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
            display: 'flex',
            flexWrap: 'nowrap',
            gap: '10px',
            alignItems: 'center',
            overflow: 'hidden',
            cursor: 'pointer'
          }}>
            <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'baseline', gap: '6px', flex: '0 0 auto', fontSize: '7pt' }}>
              <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                {displayStats.totalVehicles.toLocaleString()} veh
              </div>
              {displayStats.vehiclesAddedToday > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAddedTodayOnly();
                    }}
                    title={
                      filters.addedTodayOnly
                        ? 'Showing vehicles added today (click to clear)'
                        : 'Show vehicles added today'
                    }
                    style={{
                      padding: '1px 6px',
                      borderRadius: '999px',
                      border: filters.addedTodayOnly
                        ? '1px solid rgba(16,185,129,0.55)'
                        : '1px solid rgba(16,185,129,0.25)',
                      background: filters.addedTodayOnly ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.10)',
                      color: '#10b981',
                      fontSize: '7pt',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: '"MS Sans Serif", sans-serif',
                      flex: '0 0 auto',
                      lineHeight: 1.3,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(16,185,129,0.22)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = filters.addedTodayOnly ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.10)';
                    }}
                  >
                    +{displayStats.vehiclesAddedToday} today
                  </button>
                </>
              )}
              <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>|</span>
              {/* Value display with market interest breakdown */}
              <div
                style={{
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '4px',
                  position: 'relative',
                }}
                title={displayStats.marketInterestValue > 0
                  ? `Realized: ${formatCurrency(displayStats.totalValue)}\nMarket Interest: ${formatCurrency(displayStats.marketInterestValue)} (${displayStats.rnmVehicleCount} reserve-not-met auctions)\n\nMarket interest = highest bids on auctions where reserve wasn't met. Shows real buyer demand even though sale didn't complete.`
                  : `Total portfolio value: ${formatCurrency(displayStats.totalValue)}`
                }
              >
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {formatCurrency(displayStats.totalValue)}
                </span>
                {displayStats.marketInterestValue > 0 && (
                  <span
                    style={{
                      color: '#f59e0b',
                      fontSize: '6.5pt',
                      fontWeight: 500,
                      cursor: 'help',
                    }}
                  >
                    +{formatCurrency(displayStats.marketInterestValue)} interest
                  </span>
                )}
              </div>
              {displayStats.forSaleCount > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleForSale();
                    }}
                    title={filters.forSale
                      ? `Showing ${displayStats.forSaleCount} for sale. Click to show all.`
                      : `${displayStats.forSaleCount} for sale. Click to filter.`
                    }
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: '"MS Sans Serif", sans-serif',
                      fontSize: '7pt',
                      color: filters.forSale ? '#059669' : 'var(--text-muted)',
                      fontWeight: filters.forSale ? 700 : 400,
                    }}
                  >
                    {displayStats.forSaleCount.toLocaleString()} for sale
                  </button>
                </>
              )}
              {displayStats.activeAuctions > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowActiveAuctionsPanel(true);
                    }}
                    title="Live auctions with countdown timers, bid counts, and market analytics"
                    style={{
                      border: 'none',
                      background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                      padding: '1px 6px',
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: '"MS Sans Serif", sans-serif',
                      fontSize: '7pt',
                      color: 'white',
                      borderRadius: '999px',
                      fontWeight: 700,
                    }}
                  >
                    LIVE {displayStats.activeAuctions}
                  </button>
                </>
              )}
              {/* FB Marketplace button - always show */}
              <>
                <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>|</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFBMarketplacePanel(true);
                  }}
                  title="Facebook Marketplace classic cars - live monitor feed"
                  style={{
                    border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    padding: '1px 6px',
                    margin: 0,
                    cursor: 'pointer',
                    fontFamily: '"MS Sans Serif", sans-serif',
                    fontSize: '7pt',
                    color: 'white',
                    borderRadius: '999px',
                    fontWeight: 700,
                  }}
                >
                  FB CARS
                </button>
              </>
              {salesByPeriod.count > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleShowSoldOnly();
                    }}
                    title={filters.showSoldOnly
                      ? `Viewing ${salesByPeriod.count} sold (${salesByPeriod.label}). Click to change period.`
                      : `${salesByPeriod.count} sold ${salesByPeriod.label}. Click to filter.`
                    }
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: '"MS Sans Serif", sans-serif',
                      fontSize: '7pt',
                      color: filters.showSoldOnly ? '#7c3aed' : 'var(--text-muted)',
                      fontWeight: filters.showSoldOnly ? 700 : 400,
                    }}
                  >
                    {salesByPeriod.count.toLocaleString()} sold {salesByPeriod.label}
                  </button>
                </>
              )}
              {(hasActiveFilters || debouncedSearchText) && displayStats.avgValue > 0 && displayStats.totalVehicles > 1 && (
                <>
                  <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>|</span>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {formatCurrency(displayStats.avgValue)} avg
                  </div>
                </>
              )}
            </div>

            {/* Scrollable strip: selected filters + market pogs */}
            <div
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                overflowX: 'auto',
                overflowY: 'hidden',
                paddingBottom: '2px'
              }}
            >
              {/* Selected filter chips */}
              {activeFilterCount === 0 ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '1px 8px',
                    background: 'var(--grey-200)',
                    border: '1px solid var(--border)',
                    borderRadius: '999px',
                    fontSize: '7pt',
                    color: 'var(--text-muted)',
                    fontFamily: '"MS Sans Serif", sans-serif',
                    flex: '0 0 auto'
                  }}
                >
                  No filters
                </div>
              ) : (
                getActiveFilterBadges.map((badge, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '1px 8px',
                      background: 'var(--grey-200)',
                      border: '1px solid var(--border)',
                      borderRadius: '999px',
                      fontSize: '7pt',
                      fontFamily: '"MS Sans Serif", sans-serif',
                      flex: '0 0 auto'
                    }}
                  >
                    <span>{badge.label}</span>
                    {badge.onRemove && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          badge.onRemove?.();
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: '0',
                          margin: 0,
                          cursor: 'pointer',
                          fontSize: '8pt',
                          lineHeight: 1,
                          color: 'var(--text-muted)',
                          fontWeight: 'bold'
                        }}
                        title="Remove filter"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))
              )}

              {/* Only show source pogs in mini bar if some sources are filtered out */}
              {sourcePogs.hiddenCount > 0 && (
                <>
                  <div style={{ width: '1px', height: '14px', background: 'var(--border)', flex: '0 0 auto' }} aria-hidden="true" />
                  <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flex: '0 0 auto' }}>
                    {sourcePogs.selected.map((p, idx) => (
                      <button
                        key={p.id ? `source-${p.id}` : `source-${p.domain}-${idx}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Clicking a selected pog removes it (excludes that source).
                          setSourceIncluded(p.key, false);
                        }}
                        aria-label={`${p.title} (selected)`}
                        title={`${p.title}: Selected (click to remove)`}
                        style={{
                          width: '18px',
                          height: '18px',
                          padding: 0,
                          borderRadius: '999px',
                          border: '1px solid rgba(255,255,255,0.14)',
                          background: `${domainGradient(p.domain)}, var(--surface-glass)`,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 0 0 2px var(--accent-dim)',
                          opacity: 1,
                          flex: '0 0 auto',
                          backdropFilter: 'blur(10px) saturate(1.35)'
                        }}
                      >
                        <img
                          src={faviconUrl(p.domain)}
                          alt=""
                          width={14}
                          height={14}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '3px',
                            filter: 'none',
                          }}
                        />
                      </button>
                    ))}

                    <div
                      style={{
                        flex: '0 0 auto',
                        width: '18px',
                        height: '18px',
                        borderRadius: '999px',
                        border: '1px solid var(--border)',
                        background: 'var(--grey-200)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '7pt',
                        color: 'var(--text-muted)',
                        fontFamily: '"MS Sans Serif", sans-serif',
                        userSelect: 'none'
                      }}
                      title="Open filters to add more sources"
                    >
                      +{sourcePogs.hiddenCount}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                title={`${cardsPerRow} per row`}
              >
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: '"MS Sans Serif", sans-serif' }}>
                  {cardsPerRow}/row
                </div>
                <input
                  type="range"
                  min="1"
                  max="16"
                  step="1"
                  value={cardsPerRow}
                  onChange={(e) => setCardsPerRow(parseInt(e.target.value, 10))}
                  className="nuke-range nuke-range-accent"
                  style={{ width: '110px' }}
                />
                <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setThumbFitMode('square');
                    }}
                    style={{
                      padding: '1px 6px',
                      fontSize: '7pt',
                      border: '1px solid var(--border)',
                      background: thumbFitMode === 'square' ? 'var(--grey-600)' : 'var(--grey-200)',
                      color: thumbFitMode === 'square' ? 'var(--white)' : 'var(--text)',
                      cursor: 'pointer',
                      borderRadius: '999px',
                      fontFamily: '"MS Sans Serif", sans-serif',
                    }}
                    title="Square thumbnails"
                  >
                    1:1
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setThumbFitMode('original');
                    }}
                    style={{
                      padding: '1px 6px',
                      fontSize: '7pt',
                      border: '1px solid var(--border)',
                      background: thumbFitMode === 'original' ? 'var(--grey-600)' : 'var(--grey-200)',
                      color: thumbFitMode === 'original' ? 'var(--white)' : 'var(--text)',
                      cursor: 'pointer',
                      borderRadius: '999px',
                      fontFamily: '"MS Sans Serif", sans-serif',
                    }}
                    title="Original aspect (letterbox)"
                  >
                    ORIG
                  </button>
                </div>
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFilters(DEFAULT_FILTERS);
                    setSearchText('');
                  }}
                  style={{
                    padding: '2px 8px',
                    fontSize: '7pt',
                    border: '1px solid var(--border)',
                    background: 'var(--grey-200)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    fontFamily: '"MS Sans Serif", sans-serif',
                    fontWeight: 700
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

        {/* Stats bar is ALWAYS visible - removed minimal "Show Filters" fallback */}

        {/* Filter Panel - Redesigned clean version */}
        {showFilters && (
          <div ref={filterPanelRef} style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            marginBottom: '16px',
            fontSize: '8pt',
            scrollMarginTop: 'var(--header-height, 40px)'
          }}>
            {/* Compact stats bar */}
            <div style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              padding: '5px 8px',
              background: 'var(--grey-100)',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'monospace',
              fontSize: '7pt',
              flexWrap: 'wrap'
            }}>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openStatsPanel('vehicles');
                }}
                title="Total visible public vehicles in the feed (excludes pending + non-vehicle items). Click for breakdown."
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  margin: 0,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '7pt',
                  color: 'var(--text)'
                }}
              >
                <b>{displayStats.totalVehicles.toLocaleString()}</b> veh
              </button>
              {displayStats.vehiclesAddedToday > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleAddedTodayOnly();
                    }}
                    title={
                      filters.addedTodayOnly
                        ? 'Showing vehicles added today (click to clear)'
                        : 'Show vehicles added today'
                    }
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      color: '#10b981',
                      fontWeight: 900,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '7pt',
                    }}
                  >
                    +{displayStats.vehiclesAddedToday} today
                  </button>
                </>
              )}
              <span style={{ opacity: 0.3 }}>|</span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openStatsPanel('value');
                }}
                title={displayStats.marketInterestValue > 0
                  ? `Realized: ${formatCurrency(displayStats.totalValue)}\nMarket Interest: ${formatCurrency(displayStats.marketInterestValue)} (${displayStats.rnmVehicleCount} reserve-not-met)\n\nMarket interest = highest bids on auctions where reserve wasn't met.`
                  : 'Portfolio value (best-known per vehicle). Click for breakdown.'
                }
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  margin: 0,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '7pt',
                  color: 'var(--text)',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '3px',
                }}
              >
                <b>{formatCurrency(displayStats.totalValue)}</b>
                {displayStats.marketInterestValue > 0 && (
                  <span style={{ color: '#f59e0b', fontSize: '6pt', fontWeight: 500 }}>
                    +{formatCurrency(displayStats.marketInterestValue)}
                  </span>
                )}
              </button>
              {displayStats.forSaleCount > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleForSale();
                    }}
                    title={filters.forSale
                      ? `Showing ${displayStats.forSaleCount} for sale. Click to show all.`
                      : `${displayStats.forSaleCount} for sale. Click to filter.`
                    }
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '7pt',
                      color: filters.forSale ? '#059669' : 'var(--text)',
                      fontWeight: filters.forSale ? 700 : 400,
                    }}
                  >
                    <b>{displayStats.forSaleCount.toLocaleString()}</b> for sale
                  </button>
                </>
              )}
              {salesByPeriod.count > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleShowSoldOnly();
                    }}
                    title={filters.showSoldOnly
                      ? `Viewing ${salesByPeriod.count} sold (${salesByPeriod.label}). Click to change period.`
                      : `${salesByPeriod.count} sold ${salesByPeriod.label}. Click to filter.`
                    }
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '7pt',
                      color: filters.showSoldOnly ? '#7c3aed' : 'var(--text)',
                      fontWeight: filters.showSoldOnly ? 700 : 400,
                    }}
                  >
                    <b>{salesByPeriod.count.toLocaleString()}</b> sold {salesByPeriod.label}
                  </button>
                </>
              )}
              {displayStats.activeAuctions > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowActiveAuctionsPanel(true);
                    }}
                    title="Live auctions with countdown timers, bid counts, and market analytics. Click to open."
                    style={{
                      border: 'none',
                      background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                      padding: '2px 8px',
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '7pt',
                      color: 'white',
                      borderRadius: '4px',
                      fontWeight: 700,
                      animation: 'pulse 2s infinite',
                    }}
                  >
                    LIVE {displayStats.activeAuctions}
                  </button>
                </>
              )}
              {(hasActiveFilters || debouncedSearchText) && displayStats.avgValue > 0 && displayStats.totalVehicles > 1 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openStatsPanel('value');
                    }}
                    title="Average value is only meaningful when you’ve filtered the set. Click for breakdown."
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '7pt',
                      color: 'var(--text-muted)'
                    }}
                  >
                    <b>{formatCurrency(displayStats.avgValue)}</b> avg
                  </button>
                </>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  title={`${cardsPerRow} per row`}
                >
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {cardsPerRow}/row
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="16"
                    step="1"
                    value={cardsPerRow}
                    onChange={(e) => setCardsPerRow(parseInt(e.target.value, 10))}
                    className="nuke-range nuke-range-accent"
                    style={{ width: '80px' }}
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  setShowFilters(false);
                  setFilterBarMinimized(true);
                }}
                style={{
                  padding: '2px 6px',
                  fontSize: '7pt',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                hide
              </button>
            </div>

            {/* Unified filter buttons row */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              padding: '6px',
              borderBottom: '1px solid var(--border)'
            }}>
              {/* Year filter button */}
              <button
                onClick={() => toggleCollapsedSection('yearFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.yearFilters ? 'var(--grey-600)' : (filters.yearMin || filters.yearMax) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.yearFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.yearFilters || filters.yearMin || filters.yearMax) ? 700 : 400,
                  border: !collapsedSections.yearFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.yearMin && filters.yearMax ? `${filters.yearMin}-${filters.yearMax}` : 'year'}
              </button>
              
              {/* Make filter button */}
              <button
                onClick={() => toggleCollapsedSection('makeFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.makeFilters ? 'var(--grey-600)' : filters.makes.length > 0 ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.makeFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.makeFilters || filters.makes.length > 0) ? 700 : 400,
                  border: !collapsedSections.makeFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.makes.length > 0 ? `make: ${filters.makes.join(', ')}` : 'make'}
              </button>
              
              {/* Price button - combines sort and filter */}
              <button
                onClick={() => toggleCollapsedSection('priceFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.priceFilters ? 'var(--grey-600)' : ((filters.priceMin || filters.priceMax) || (sortBy === 'price_high' || sortBy === 'price_low')) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.priceFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.priceFilters || (filters.priceMin || filters.priceMax) || (sortBy === 'price_high' || sortBy === 'price_low')) ? 700 : 400,
                  border: !collapsedSections.priceFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {(() => {
                  if (filters.priceMin || filters.priceMax) {
                    return `$${filters.priceMin ? (filters.priceMin/1000).toFixed(0) + 'k' : '?'}-${filters.priceMax ? (filters.priceMax/1000).toFixed(0) + 'k' : '?'}`;
                  }
                  if (sortBy === 'price_high') return 'price (high)';
                  if (sortBy === 'price_low') return 'price (low)';
                  return 'price';
                })()}
              </button>
              
              {/* Location filter button */}
              <button
                onClick={() => toggleCollapsedSection('locationFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.locationFilters ? 'var(--grey-600)' : ((filters.locations && filters.locations.length > 0) || filters.zipCode) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.locationFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.locationFilters || (filters.locations && filters.locations.length > 0) || filters.zipCode) ? 700 : 400,
                  border: !collapsedSections.locationFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.locations && filters.locations.length > 0 
                  ? `📍${filters.locations.length} loc${filters.locations.length > 1 ? 's' : ''}`
                  : filters.zipCode 
                    ? `📍${filters.zipCode}` 
                    : 'location'}
              </button>
              
              {/* Type filter button (body style) */}
              <button
                onClick={() => toggleCollapsedSection('typeFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.typeFilters ? 'var(--grey-600)' : (filters.bodyStyles.length > 0 || filters.is4x4) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.typeFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.typeFilters || filters.bodyStyles.length > 0 || filters.is4x4) ? 700 : 400,
                  border: !collapsedSections.typeFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {filters.bodyStyles.length > 0 || filters.is4x4 
                  ? `type: ${[...filters.bodyStyles, filters.is4x4 ? '4x4' : ''].filter(Boolean).join(', ')}`
                  : 'type'}
              </button>
              
              {/* Sources button */}
              <button
                onClick={() => toggleCollapsedSection('sourcePogs')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.sourcePogs ? 'var(--grey-600)' : sourcePogs.selected.length < sourcePogs.all.length ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.sourcePogs ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.sourcePogs || sourcePogs.selected.length < sourcePogs.all.length) ? 700 : 400,
                  border: !collapsedSections.sourcePogs ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                sources: {sourcePogs.selected.length}/{sourcePogs.all.length}
              </button>
              
              {/* Status filters button */}
              <button
                onClick={() => toggleCollapsedSection('statusFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.statusFilters ? 'var(--grey-600)' : (filters.forSale || filters.hideSold || filters.showPending || filters.privateParty || filters.dealer) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.statusFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.statusFilters || filters.forSale || filters.hideSold || filters.showPending || filters.privateParty || filters.dealer) ? 700 : 400,
                  border: !collapsedSections.statusFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                status
              </button>
              
              {/* Reset button */}
              {activeFilterCount > 0 && (
                <button
                  onClick={() => {
                    setFilters(DEFAULT_FILTERS);
                    setSearchText('');
                  }}
                  style={{
                    marginLeft: 'auto',
                    padding: '3px 7px',
                    fontSize: '7pt',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                >
                  reset
                </button>
              )}
            </div>
            
            {/* Expanded filter controls - shown when sections are open */}
            <div style={{ padding: '6px' }}>
              {/* Year filters - expanded */}
              {!collapsedSections.yearFilters && (
                <div 
                  style={{
                    marginBottom: '8px',
                    padding: '6px',
                    background: 'var(--grey-50)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'row',
                    gap: '8px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    minWidth: 0
                  }}
                >
                  {/* Year range input */}
                  <div style={{
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                    flexShrink: 0
                  }}>
                    <input
                      type="number"
                      placeholder="Min year"
                      value={filters.yearMin || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value) : null;
                        setFilters({...filters, yearMin: val});
                      }}
                      style={{
                        width: '80px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '7pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    />
                    <span style={{ fontSize: '7pt' }}>to</span>
                    <input
                      type="number"
                      placeholder="Max year"
                      value={filters.yearMax || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value) : null;
                        setFilters({...filters, yearMax: val});
                      }}
                      style={{
                        width: '80px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '7pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    />
                    {(filters.yearMin || filters.yearMax) && (
                      <button
                        onClick={() => setFilters({...filters, yearMin: null, yearMax: null})}
                        className="button-win95"
                        style={{ padding: '3px 7px', fontSize: '7pt' }}
                      >
                        clear
                      </button>
                    )}
                  </div>
                  
                  {/* Quick year buttons - only visible if container is wide enough */}
                  <div 
                    className="year-quick-buttons"
                    style={{ 
                      display: 'flex', 
                      flexWrap: 'wrap', 
                      gap: '4px',
                      overflow: 'hidden',
                      minWidth: 0,
                      flex: '1 1 auto'
                    }}
                  >
                    {[
                      { label: '64-91', min: 1964, max: 1991 },
                      { label: '73-87', min: 1973, max: 1987 },
                      { label: '67-72', min: 1967, max: 1972 },
                      { label: '87-00', min: 1987, max: 2000 },
                      { label: '60s', min: 1960, max: 1969 },
                      { label: '70s', min: 1970, max: 1979 },
                      { label: '80s', min: 1980, max: 1989 },
                      { label: '90s', min: 1990, max: 1999 },
                    ].map(range => {
                      const isActive = filters.yearMin === range.min && filters.yearMax === range.max;
                      return (
                        <button
                          key={range.label}
                          onClick={() => {
                            if (isActive) {
                              setFilters({ ...filters, yearMin: null, yearMax: null });
                            } else {
                              setFilters({ ...filters, yearMin: range.min, yearMax: range.max });
                            }
                          }}
                          className="button-win95"
                          style={{
                            padding: '3px 7px',
                            fontSize: '7pt',
                            background: isActive ? 'var(--grey-600)' : 'var(--white)',
                            color: isActive ? 'var(--white)' : 'var(--text)',
                            fontWeight: isActive ? 700 : 400,
                            border: isActive ? '1px solid var(--grey-600)' : '1px solid var(--border)',
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }}
                          title={`Year: ${range.min}-${range.max}`}
                        >
                          {range.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Sources list - expanded */}
              {!collapsedSections.sourcePogs && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  fontSize: '7pt'
                }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                    <button
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          hideDealerListings: false,
                          hideCraigslist: false,
                          hideDealerSites: false,
                          hideKsl: false,
                          hideBat: false,
                          hideClassic: false,
                          hiddenSources: []
                        }));
                      }}
                      className="button-win95"
                      style={{ padding: '2px 6px', fontSize: '7pt' }}
                    >
                      all
                    </button>
                    <button
                      onClick={() => {
                        setFilters((prev) => ({
                          ...prev,
                          hideDealerListings: true,
                          hideCraigslist: true,
                          hideDealerSites: true,
                          hideKsl: true,
                          hideBat: true,
                          hideClassic: true,
                          hiddenSources: sourcePogs.all.map(p => p.key)
                        }));
                      }}
                      className="button-win95"
                      style={{ padding: '2px 6px', fontSize: '7pt' }}
                    >
                      none
                    </button>
                    <input
                      type="text"
                      placeholder="search sources..."
                      value={sourceSearchText}
                      onChange={(e) => {
                        const text = e.target.value;
                        setSourceSearchText(text);
                        
                        // #region agent log
                        // #endregion
                        
                        // Auto-apply filters when searching for specific sources
                        const searchLower = text.toLowerCase().trim();
                        if (searchLower.includes('bring') || searchLower.includes('bat')) {
                          // Filter to only BaT sources
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'bat')
                            .map(p => p.key);
                          
                          // #region agent log
                          console.log('[DEBUG] Setting BaT filter', { allOtherKeys, sourcePogsKeys: sourcePogs.all.map(p=>p.key), text });
                          // #endregion
                          
                          setFilters((prev) => {
                            const newFilters = {
                              ...prev,
                              hideDealerListings: true,
                              hideCraigslist: true,
                              hideDealerSites: true,
                              hideKsl: true,
                              hideBat: false, // Keep BaT visible
                              hideClassic: true,
                              hiddenSources: allOtherKeys
                            };
                            console.log('[DEBUG] Setting filters', { prev, newFilters });
                            return newFilters;
                          });
                        } else if (searchLower.includes('craigslist') || searchLower.includes('cl')) {
                          // Filter to only Craigslist
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'craigslist')
                            .map(p => p.key);
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: true,
                            hideCraigslist: false,
                            hideDealerSites: true,
                            hideKsl: true,
                            hideBat: true,
                            hideClassic: true,
                            hiddenSources: allOtherKeys
                          }));
                        } else if (searchLower.includes('ksl')) {
                          // Filter to only KSL
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'ksl')
                            .map(p => p.key);
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: true,
                            hideCraigslist: true,
                            hideDealerSites: true,
                            hideKsl: false,
                            hideBat: true,
                            hideClassic: true,
                            hiddenSources: allOtherKeys
                          }));
                        } else if (searchLower.includes('classic')) {
                          // Filter to only Classic.com
                          const allOtherKeys = sourcePogs.all
                            .filter(p => p.key !== 'classic')
                            .map(p => p.key);
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: true,
                            hideCraigslist: true,
                            hideDealerSites: true,
                            hideKsl: true,
                            hideBat: true,
                            hideClassic: false,
                            hiddenSources: allOtherKeys
                          }));
                        } else if (!text.trim()) {
                          // Clear search - show all sources
                          setFilters((prev) => ({
                            ...prev,
                            hideDealerListings: false,
                            hideCraigslist: false,
                            hideDealerSites: false,
                            hideKsl: false,
                            hideBat: false,
                            hideClassic: false,
                            hiddenSources: []
                          }));
                        } else if (searchLower.length >= 3) {
                          // Dynamic source search - filter to sources matching the search text
                          const matchingSourceKeys = sourcePogs.all
                            .filter(p =>
                              p.title.toLowerCase().includes(searchLower) ||
                              p.domain.toLowerCase().includes(searchLower) ||
                              p.key.toLowerCase().includes(searchLower)
                            )
                            .map(p => p.key);

                          if (matchingSourceKeys.length > 0) {
                            // Hide all sources that DON'T match
                            const nonMatchingKeys = sourcePogs.all
                              .filter(p => !matchingSourceKeys.includes(p.key))
                              .map(p => p.key);

                            setFilters((prev) => ({
                              ...prev,
                              hideDealerListings: !matchingSourceKeys.some(k => k.includes('dealer')),
                              hideCraigslist: !matchingSourceKeys.includes('craigslist'),
                              hideDealerSites: !matchingSourceKeys.some(k => k.includes('dealer')),
                              hideKsl: !matchingSourceKeys.includes('ksl'),
                              hideBat: !matchingSourceKeys.includes('bat'),
                              hideClassic: !matchingSourceKeys.includes('classic'),
                              hiddenSources: nonMatchingKeys
                            }));
                          }
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '2px 6px',
                        fontSize: '7pt',
                        border: '1px solid var(--border)',
                        fontFamily: '"MS Sans Serif", sans-serif',
                        minWidth: '80px'
                      }}
                    />
                    {sourceSearchText && (
                      <button
                        onClick={() => setSourceSearchText('')}
                        className="button-win95"
                        style={{ padding: '2px 6px', fontSize: '7pt' }}
                      >
                        x
                      </button>
                    )}
                  </div>
                  <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '2px',
                    maxHeight: '200px',
                    overflowY: 'auto'
                  }}>
                    {sourcePogs.all
                      .filter((p) => {
                        const matches = !sourceSearchText || 
                          p.title.toLowerCase().includes(sourceSearchText.toLowerCase()) ||
                          p.domain.toLowerCase().includes(sourceSearchText.toLowerCase()) ||
                          p.key.toLowerCase().includes(sourceSearchText.toLowerCase());
                        
                        // #region agent log
                        // #endregion
                        
                        return matches;
                      })
                      .map((p, idx) => (
                      <label
                        key={p.id ? `source-${p.id}` : `source-${p.domain}-${idx}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '2px 4px',
                          cursor: 'pointer',
                          background: p.included ? 'var(--white)' : 'transparent',
                          borderRadius: '1px'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={p.included}
                          onChange={() => setSourceIncluded(p.key, !p.included)}
                          style={{ margin: 0 }}
                        />
                        <img
                          src={faviconUrl(p.domain)}
                          alt=""
                          width={12}
                          height={12}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          style={{
                            width: '12px',
                            height: '12px',
                            opacity: p.included ? 1 : 0.4
                          }}
                        />
                        <span style={{ flex: 1, opacity: p.included ? 1 : 0.6 }}>
                          {p.title}
                        </span>
                        <span style={{ opacity: 0.5, fontFamily: 'monospace' }}>
                          {p.count.toLocaleString()}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Make filter - inline badge input */}
              {!collapsedSections.makeFilters && (() => {
                // Compute filtered suggestions for keyboard nav
                const makeSuggestions = availableMakes
                  .filter(m =>
                    m.toLowerCase().startsWith(makeSearchText.toLowerCase()) &&
                    !filters.makes.includes(m)
                  )
                  .slice(0, 8);

                return (
                  <div style={{
                    marginBottom: '8px',
                    position: 'relative'
                  }}>
                    {/* Inline badge input container */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 6px',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderRadius: '2px',
                        minHeight: '24px',
                        cursor: 'text'
                      }}
                      onClick={() => makeInputRef.current?.focus()}
                    >
                      {/* Selected make badges inline */}
                      {filters.makes.map((make) => (
                        <span
                          key={make}
                          style={{
                            padding: '1px 5px',
                            background: 'var(--grey-600)',
                            color: 'var(--white)',
                            fontSize: '7pt',
                            borderRadius: '2px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {make}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilters({...filters, makes: filters.makes.filter(m => m !== make)});
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--white)',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '7pt',
                              lineHeight: 1,
                              opacity: 0.8
                            }}
                          >
                            x
                          </button>
                        </span>
                      ))}
                      {/* Text input */}
                      <input
                        ref={makeInputRef}
                        type="text"
                        value={makeSearchText}
                        onChange={(e) => {
                          setMakeSearchText(e.target.value);
                          setShowMakeSuggestions(true);
                          setMakeSuggestionIndex(-1);
                        }}
                        onFocus={() => setShowMakeSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowMakeSuggestions(false), 150)}
                        onKeyDown={(e) => {
                          // Arrow down - move selection down
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            if (makeSuggestions.length > 0) {
                              setMakeSuggestionIndex(prev =>
                                prev < makeSuggestions.length - 1 ? prev + 1 : 0
                              );
                            }
                          }
                          // Arrow up - move selection up
                          else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            if (makeSuggestions.length > 0) {
                              setMakeSuggestionIndex(prev =>
                                prev > 0 ? prev - 1 : makeSuggestions.length - 1
                              );
                            }
                          }
                          // Enter - select highlighted or top match, or go to model
                          else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (makeSearchText.trim()) {
                              // Select highlighted suggestion or top match
                              const makeToAdd = makeSuggestionIndex >= 0 && makeSuggestions[makeSuggestionIndex]
                                ? makeSuggestions[makeSuggestionIndex]
                                : makeSuggestions[0] || makeSearchText.trim();

                              if (!filters.makes.includes(makeToAdd)) {
                                setFilters({...filters, makes: [...filters.makes, makeToAdd]});
                              }
                              setMakeSearchText('');
                              setShowMakeSuggestions(false);
                              setMakeSuggestionIndex(-1);
                            } else if (filters.makes.length > 0) {
                              // Empty input + makes selected = focus model input
                              setTimeout(() => modelInputRef.current?.focus(), 50);
                            }
                          }
                          // Backspace when empty - remove last badge
                          else if (e.key === 'Backspace' && !makeSearchText && filters.makes.length > 0) {
                            setFilters({...filters, makes: filters.makes.slice(0, -1)});
                          }
                          // Escape - close dropdown
                          else if (e.key === 'Escape') {
                            setShowMakeSuggestions(false);
                            setMakeSuggestionIndex(-1);
                          }
                        }}
                        style={{
                          flex: 1,
                          minWidth: '60px',
                          border: 'none',
                          outline: 'none',
                          padding: '2px 0',
                          fontSize: '7pt',
                          fontFamily: '"MS Sans Serif", sans-serif',
                          background: 'transparent'
                        }}
                      />
                    </div>

                    {/* Autocomplete dropdown */}
                    {showMakeSuggestions && makeSearchText.length > 0 && makeSuggestions.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: '150px',
                        overflowY: 'auto',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        zIndex: 100,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}>
                        {makeSuggestions.map((make, idx) => (
                          <div
                            key={make}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setFilters({...filters, makes: [...filters.makes, make]});
                              setMakeSearchText('');
                              setShowMakeSuggestions(false);
                              setMakeSuggestionIndex(-1);
                            }}
                            onMouseEnter={() => setMakeSuggestionIndex(idx)}
                            style={{
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontSize: '7pt',
                              background: idx === makeSuggestionIndex ? 'var(--grey-200)' : 'var(--white)',
                              borderBottom: '1px solid var(--grey-100)'
                            }}
                          >
                            {make}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Model filter - inline badge input (shows when makes are selected) */}
              {filters.makes.length > 0 && availableModels.length > 0 && (() => {
                // Fuzzy matching helper
                const normalize = (s: string) => s.toLowerCase().replace(/[-\/\s]/g, '');
                const searchLower = modelSearchText.toLowerCase().trim();
                const searchNorm = normalize(searchLower);

                // Compute filtered suggestions with fuzzy matching
                const modelSuggestions = availableModels
                  .filter(m => {
                    if (filters.models?.includes(m)) return false;
                    if (!searchLower) return false;
                    const modelNorm = normalize(m);
                    const modelLower = m.toLowerCase();
                    // Normalized match (c10 = c-10)
                    if (modelNorm.includes(searchNorm)) return true;
                    // Contains match
                    if (modelLower.includes(searchLower)) return true;
                    // Category matching
                    const truckTerms = ['truck', 'pickup', 'c10', 'c20', 'c30', 'k10', 'k20', 'k5'];
                    if (truckTerms.some(t => searchLower.includes(t))) {
                      if (truckTerms.some(t => modelLower.includes(t))) return true;
                    }
                    return false;
                  })
                  .slice(0, 8);

                return (
                  <div style={{
                    marginBottom: '8px',
                    position: 'relative'
                  }}>
                    {/* Inline badge input container */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 6px',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderRadius: '2px',
                        minHeight: '24px',
                        cursor: 'text'
                      }}
                      onClick={() => modelInputRef.current?.focus()}
                    >
                      {/* Selected model badges inline */}
                      {(filters.models || []).map((model) => (
                        <span
                          key={model}
                          style={{
                            padding: '1px 5px',
                            background: 'var(--grey-600)',
                            color: 'var(--white)',
                            fontSize: '7pt',
                            borderRadius: '2px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {model}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilters({...filters, models: filters.models.filter(m => m !== model)});
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--white)',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '7pt',
                              lineHeight: 1,
                              opacity: 0.8
                            }}
                          >
                            x
                          </button>
                        </span>
                      ))}
                      {/* Text input */}
                      <input
                        ref={modelInputRef}
                        type="text"
                        value={modelSearchText}
                        onChange={(e) => {
                          setModelSearchText(e.target.value);
                          setShowModelSuggestions(true);
                          setModelSuggestionIndex(-1);
                        }}
                        onFocus={() => setShowModelSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowModelSuggestions(false), 150)}
                        onKeyDown={(e) => {
                          // Arrow down
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            if (modelSuggestions.length > 0) {
                              setModelSuggestionIndex(prev =>
                                prev < modelSuggestions.length - 1 ? prev + 1 : 0
                              );
                            }
                          }
                          // Arrow up
                          else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            if (modelSuggestions.length > 0) {
                              setModelSuggestionIndex(prev =>
                                prev > 0 ? prev - 1 : modelSuggestions.length - 1
                              );
                            }
                          }
                          // Enter - select highlighted or top match
                          else if (e.key === 'Enter') {
                            e.preventDefault();
                            if (modelSearchText.trim()) {
                              const modelToAdd = modelSuggestionIndex >= 0 && modelSuggestions[modelSuggestionIndex]
                                ? modelSuggestions[modelSuggestionIndex]
                                : modelSuggestions[0] || modelSearchText.trim();

                              if (!filters.models?.includes(modelToAdd)) {
                                setFilters({...filters, models: [...(filters.models || []), modelToAdd]});
                              }
                              setModelSearchText('');
                              setShowModelSuggestions(false);
                              setModelSuggestionIndex(-1);
                            }
                          }
                          // Backspace when empty - remove last badge
                          else if (e.key === 'Backspace' && !modelSearchText && filters.models?.length > 0) {
                            setFilters({...filters, models: filters.models.slice(0, -1)});
                          }
                          // Escape
                          else if (e.key === 'Escape') {
                            setShowModelSuggestions(false);
                            setModelSuggestionIndex(-1);
                          }
                        }}
                        style={{
                          flex: 1,
                          minWidth: '60px',
                          border: 'none',
                          outline: 'none',
                          padding: '2px 0',
                          fontSize: '7pt',
                          fontFamily: '"MS Sans Serif", sans-serif',
                          background: 'transparent'
                        }}
                      />
                    </div>

                    {/* Autocomplete dropdown */}
                    {showModelSuggestions && modelSearchText.length > 0 && modelSuggestions.length > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: '150px',
                        overflowY: 'auto',
                        background: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        zIndex: 100,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}>
                        {modelSuggestions.map((model, idx) => (
                          <div
                            key={model}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setFilters({...filters, models: [...(filters.models || []), model]});
                              setModelSearchText('');
                              setShowModelSuggestions(false);
                              setModelSuggestionIndex(-1);
                            }}
                            onMouseEnter={() => setModelSuggestionIndex(idx)}
                            style={{
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontSize: '7pt',
                              background: idx === modelSuggestionIndex ? 'var(--grey-200)' : 'var(--white)',
                              borderBottom: '1px solid var(--grey-100)'
                            }}
                          >
                            {model}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Type filter - expanded (body style) */}
              {!collapsedSections.typeFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  fontSize: '7pt'
                }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                    {[
                      { label: 'Car', values: ['Coupe', 'Sedan', 'Convertible', 'Hatchback', 'Wagon'] },
                      { label: 'Truck', values: ['Pickup', 'Truck'] },
                      { label: 'SUV', values: ['SUV'] },
                      { label: 'Van', values: ['Van', 'Minivan'] },
                      { label: 'Motorcycle', values: ['Motorcycle'] },
                      { label: 'RV', values: ['RV'] },
                      { label: 'Trailer', values: ['Trailer'] },
                      { label: 'Boat', values: ['Boat'] },
                      { label: 'Powersports', values: ['ATV', 'UTV', 'Snowmobile'] },
                    ].map(({ label, values }) => {
                      const isSelected = values.some(v => filters.bodyStyles.includes(v));
                      return (
                        <button
                          key={label}
                          onClick={() => {
                            if (isSelected) {
                              setFilters({...filters, bodyStyles: filters.bodyStyles.filter(bs => !values.includes(bs))});
                            } else {
                              setFilters({...filters, bodyStyles: [...filters.bodyStyles, ...values]});
                            }
                          }}
                          className="button-win95"
                          style={{
                            padding: '3px 10px',
                            fontSize: '7pt',
                            background: isSelected ? 'var(--grey-600)' : 'var(--white)',
                            color: isSelected ? 'var(--white)' : 'var(--text)',
                            fontWeight: isSelected ? 700 : 400
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setFilters({...filters, is4x4: !filters.is4x4})}
                      className="button-win95"
                      style={{
                        padding: '3px 10px',
                        fontSize: '7pt',
                        background: filters.is4x4 ? 'var(--grey-600)' : 'var(--white)',
                        color: filters.is4x4 ? 'var(--white)' : 'var(--text)',
                        fontWeight: filters.is4x4 ? 700 : 400
                      }}
                    >
                      4x4/4WD
                    </button>
                    {(filters.bodyStyles.length > 0 || filters.is4x4) && (
                      <button
                        onClick={() => setFilters({...filters, bodyStyles: [], is4x4: false})}
                        className="button-win95"
                        style={{ padding: '3px 6px', fontSize: '7pt' }}
                      >
                        clear
                      </button>
                    )}
                  </div>
                  {/* Specific body styles */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {(
                      (availableBodyStyles && availableBodyStyles.length > 0)
                        ? availableBodyStyles.slice(0, 30)
                        : ['Coupe', 'Sedan', 'Convertible', 'Wagon', 'Hatchback', 'Fastback', 'Roadster', 'Pickup', 'SUV', 'Van', 'Minivan', 'Motorcycle', 'RV', 'Trailer', 'Boat', 'ATV', 'UTV', 'Snowmobile']
                    ).map((style) => (
                      <button
                        key={style}
                        onClick={() => {
                          if (filters.bodyStyles.includes(style)) {
                            setFilters({...filters, bodyStyles: filters.bodyStyles.filter(bs => bs !== style)});
                          } else {
                            setFilters({...filters, bodyStyles: [...filters.bodyStyles, style]});
                          }
                        }}
                        className="button-win95"
                        style={{
                          padding: '2px 6px',
                          fontSize: '6pt',
                          background: filters.bodyStyles.includes(style) ? 'var(--grey-500)' : 'var(--grey-100)',
                          color: filters.bodyStyles.includes(style) ? 'var(--white)' : 'var(--text-muted)'
                        }}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Price inputs - expanded */}
              {!collapsedSections.priceFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  flexWrap: 'wrap'
                }}>
                  {/* Sort direction toggle */}
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>sort:</span>
                    <button
                      onClick={() => {
                        if (sortBy === 'price_high') {
                          setSortBy('price_low');
                          setSortDirection('asc');
                        } else if (sortBy === 'price_low') {
                          setSortBy(null);
                          setSortDirection('asc');
                        } else {
                          setSortBy('price_high');
                          setSortDirection('desc');
                        }
                      }}
                      className="button-win95"
                      style={{
                        padding: '3px 7px',
                        fontSize: '7pt',
                        background: (sortBy === 'price_high' || sortBy === 'price_low') ? 'var(--grey-600)' : 'var(--white)',
                        color: (sortBy === 'price_high' || sortBy === 'price_low') ? 'var(--white)' : 'var(--text)',
                        fontWeight: (sortBy === 'price_high' || sortBy === 'price_low') ? 700 : 400,
                        border: (sortBy === 'price_high' || sortBy === 'price_low') ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                      }}
                    >
                      {sortBy === 'price_high' ? 'highest first' : sortBy === 'price_low' ? 'lowest first' : 'none'}
                    </button>
                  </div>

                  {/* Price range inputs */}
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>range:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="min"
                      value={filters.priceMin || ''}
                      onChange={(e) => setFilters({...filters, priceMin: e.target.value ? parseInt(e.target.value) : null})}
                      style={{
                        width: '70px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '7pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    />
                    <span style={{ fontSize: '7pt' }}>–</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="max"
                      value={filters.priceMax || ''}
                      onChange={(e) => setFilters({...filters, priceMax: e.target.value ? parseInt(e.target.value) : null})}
                      style={{
                        width: '70px',
                        padding: '3px 5px',
                        border: '1px solid var(--border)',
                        fontSize: '7pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    />
                    {(filters.priceMin || filters.priceMax) && (
                      <button
                        onClick={() => setFilters({...filters, priceMin: null, priceMax: null})}
                        className="button-win95"
                        style={{ padding: '3px 7px', fontSize: '7pt' }}
                      >
                        clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Location inputs - expanded */}
              {!collapsedSections.locationFilters && (() => {
                const saveLocationFavorites = (favs: Array<{ zipCode: string; radiusMiles: number; label?: string }>) => {
                  try {
                    localStorage.setItem(LOCATION_FAVORITES_KEY, JSON.stringify(favs));
                    setLocationFavorites(favs);
                  } catch (err) {
                    console.warn('Failed to save location favorites:', err);
                  }
                };
                
                const addLocation = () => {
                  if (currentZip.length === 5 && /^\d+$/.test(currentZip)) {
                    const newLocation = { zipCode: currentZip, radiusMiles: currentRadius };
                    const updated = [...(filters.locations || []), newLocation];
                    setFilters({...filters, locations: updated, zipCode: currentZip, radiusMiles: currentRadius});
                  }
                };
                
                const addToFavorites = () => {
                  if (currentZip.length === 5 && /^\d+$/.test(currentZip)) {
                    // Check if already exists
                    const exists = locationFavorites.some(f => f.zipCode === currentZip && f.radiusMiles === currentRadius);
                    if (!exists) {
                      const label = prompt('Enter a name for this location (optional):');
                      const newFavorite = { 
                        zipCode: currentZip, 
                        radiusMiles: currentRadius,
                        label: label && label.trim() ? label.trim() : undefined
                      };
                      const updated = [...locationFavorites, newFavorite];
                      saveLocationFavorites(updated);
                    } else {
                      alert('This location is already in your favorites');
                    }
                  }
                };
                
                const removeLocation = (index: number) => {
                  const updated = filters.locations?.filter((_, i) => i !== index) || [];
                  setFilters({...filters, locations: updated});
                };
                
                const useFavorite = (fav: { zipCode: string; radiusMiles: number }) => {
                  setCurrentZip(fav.zipCode);
                  setCurrentRadius(fav.radiusMiles);
                  // Check if already in active locations
                  const isActive = filters.locations?.some(loc => loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles);
                  if (!isActive) {
                    const newLocation = { zipCode: fav.zipCode, radiusMiles: fav.radiusMiles };
                    const updated = [...(filters.locations || []), newLocation];
                    setFilters({...filters, locations: updated, zipCode: fav.zipCode, radiusMiles: fav.radiusMiles});
                  }
                };
                
                const toggleFavorite = (fav: { zipCode: string; radiusMiles: number }) => {
                  // Check if already in active locations
                  const isActive = filters.locations?.some(loc => loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles);
                  if (isActive) {
                    // Remove from active locations
                    const updated = filters.locations?.filter(loc => !(loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles)) || [];
                    setFilters({...filters, locations: updated});
                  } else {
                    // Add to active locations
                    const newLocation = { zipCode: fav.zipCode, radiusMiles: fav.radiusMiles };
                    const updated = [...(filters.locations || []), newLocation];
                    setFilters({...filters, locations: updated});
                  }
                };
                
                const removeFavorite = (fav: { zipCode: string; radiusMiles: number }, index: number) => {
                  const updated = locationFavorites.filter((_, i) => i !== index);
                  saveLocationFavorites(updated);
                  // Also remove from active locations if it's there
                  const activeUpdated = filters.locations?.filter(loc => !(loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles)) || [];
                  if (activeUpdated.length !== filters.locations?.length) {
                    setFilters({...filters, locations: activeUpdated});
                  }
                };
                
                return (
                  <div style={{
                    marginBottom: '8px',
                    padding: '6px',
                    background: 'var(--grey-50)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    {/* Current location input */}
                    <div style={{
                      display: 'flex',
                      gap: '4px',
                      alignItems: 'center',
                      flexWrap: 'wrap'
                    }}>
                      <input
                        type="text"
                        placeholder="ZIP"
                        value={currentZip}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                          setCurrentZip(val);
                        }}
                        maxLength={5}
                        style={{
                          width: '60px',
                          padding: '3px 5px',
                          border: '1px solid var(--border)',
                          fontSize: '7pt',
                          fontFamily: '"MS Sans Serif", sans-serif'
                        }}
                      />
                      <span style={{ fontSize: '7pt' }}>within</span>
                      <select
                        value={currentRadius}
                        onChange={(e) => setCurrentRadius(Number(e.target.value))}
                        style={{
                          padding: '3px 5px',
                          border: '1px solid var(--border)',
                          fontSize: '7pt',
                          fontFamily: '"MS Sans Serif", sans-serif',
                          width: '80px',
                          background: 'var(--white)',
                          cursor: 'pointer'
                        }}
                      >
                        {[10, 25, 50, 100, 250, 500].map(radius => (
                          <option key={radius} value={radius}>
                            {radius}mi
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={addLocation}
                        className="button-win95"
                        style={{
                          padding: '3px 7px',
                          fontSize: '7pt'
                        }}
                        disabled={currentZip.length !== 5}
                      >
                        add
                      </button>
                      <button
                        onClick={addToFavorites}
                        className="button-win95"
                        style={{
                          padding: '3px 7px',
                          fontSize: '7pt'
                        }}
                        disabled={currentZip.length !== 5}
                        title="Save to favorites"
                      >
                        save
                      </button>
                    </div>
                    
                    {/* Active locations */}
                    {filters.locations && filters.locations.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: '7pt' }}>active:</span>
                        {filters.locations.map((loc, idx) => (
                          <button
                            key={idx}
                            onClick={() => removeLocation(idx)}
                            className="button-win95"
                            style={{
                              padding: '2px 5px',
                              fontSize: '7pt',
                              background: 'var(--grey-300)',
                              border: '1px solid var(--border)'
                            }}
                            title="Remove location"
                          >
                            {loc.zipCode} ({loc.radiusMiles}mi) ×
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {/* Favorites */}
                    {locationFavorites.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '7pt', fontWeight: 700 }}>favorites:</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                          {locationFavorites.map((fav, idx) => {
                            const isActive = filters.locations?.some(loc => loc.zipCode === fav.zipCode && loc.radiusMiles === fav.radiusMiles);
                            return (
                              <div key={idx} style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                                <button
                                  onClick={() => toggleFavorite(fav)}
                                  className="button-win95"
                                  style={{
                                    padding: '2px 5px',
                                    fontSize: '7pt',
                                    background: isActive ? 'var(--grey-600)' : 'var(--white)',
                                    color: isActive ? 'var(--white)' : 'var(--text)',
                                    fontWeight: isActive ? 700 : 400,
                                    border: isActive ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                                  }}
                                  title={isActive ? "Remove from active locations" : "Add to active locations"}
                                >
                                  {fav.label || fav.zipCode} ({fav.radiusMiles}mi)
                                </button>
                                <button
                                  onClick={() => removeFavorite(fav, idx)}
                                  className="button-win95"
                                  style={{
                                    padding: '2px 4px',
                                    fontSize: '6pt',
                                    background: 'var(--grey-100)',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text-muted)'
                                  }}
                                  title="Remove from favorites"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Status checkboxes - expanded */}
              {!collapsedSections.statusFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '4px'
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '7pt' }}>
                    <input
                      type="checkbox"
                      checked={filters.forSale}
                      onChange={(e) => setFilters({...filters, forSale: e.target.checked})}
                    />
                    <span>for sale only</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '7pt' }}>
                    <input
                      type="checkbox"
                      checked={filters.hideSold}
                      onChange={(e) => setFilters({ ...filters, hideSold: e.target.checked })}
                    />
                    <span>hide sold</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '7pt' }}>
                    <input
                      type="checkbox"
                      checked={filters.showPending}
                      onChange={(e) => setFilters({...filters, showPending: e.target.checked})}
                    />
                    <span>show pending</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '7pt' }}>
                    <input
                      type="checkbox"
                      checked={filters.privateParty}
                      onChange={(e) => setFilters({...filters, privateParty: e.target.checked})}
                    />
                    <span>private party</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '7pt' }}>
                    <input
                      type="checkbox"
                      checked={filters.dealer}
                      onChange={(e) => setFilters({...filters, dealer: e.target.checked})}
                    />
                    <span>dealer</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Show loading indicator inline if still loading */}
        {loading && filteredVehicles.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', fontSize: '9pt', color: 'var(--text-muted)' }}>
            Loading vehicles...
          </div>
        )}

        {/* Technical View with Sortable Columns */}
        {viewMode === 'technical' && (
          <div style={{ 
            background: 'var(--white)',
            border: '1px solid var(--border)',
            overflowX: 'auto',
            overflowY: 'visible',
            position: 'relative'
          }}>
            <table style={{ 
              width: '100%', 
              fontSize: '8pt', 
              borderCollapse: 'collapse'
            }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--grey-50)' }}>
                <tr style={{ background: 'var(--grey-50)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--border)',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--grey-50)',
                    zIndex: 11
                  }}>
                    Image
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'center',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'year') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('year');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Year {sortBy === 'year' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'make') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('make');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Make {sortBy === 'make' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'model') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('model');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Model {sortBy === 'model' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'mileage') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('mileage');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Mileage {sortBy === 'mileage' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'price_high' || sortBy === 'price_low') {
                      const nextDirection = sortDirection === 'desc' ? 'asc' : 'desc';
                      setSortDirection(nextDirection);
                      setSortBy(nextDirection === 'desc' ? 'price_high' : 'price_low');
                    } else {
                      setSortBy('price_high');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Price {(sortBy === 'price_high' || sortBy === 'price_low') && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'volume') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('volume');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Volume {sortBy === 'volume' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'images') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('images');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Images {sortBy === 'images' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'events') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('events');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Events {sortBy === 'events' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'views') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('views');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Views {sortBy === 'views' && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => {
                    if (sortBy === 'newest' || sortBy === 'oldest') {
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('newest');
                      setSortDirection('desc');
                    }
                  }}
                  >
                    Updated {(sortBy === 'newest' || sortBy === 'oldest') && (sortDirection === 'desc' ? '▼' : '▲')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map(vehicle => {
                  return (
                    <tr 
                      key={vehicle.id}
                      onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                      style={{ 
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-50)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Image - Sticky left column */}
                      <td style={{ 
                        padding: '4px',
                        borderRight: '1px solid var(--border)',
                        position: 'sticky',
                        left: 0,
                        background: 'var(--white)',
                        zIndex: 1
                      }}>
                        {vehicle.primary_image_url ? (
                          <img 
                            src={vehicle.primary_image_url}
                            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                            loading="lazy"
                            style={{
                              width: 'min(100px, 15vw)',
                              height: 'min(60px, 9vw)',
                              objectFit: 'contain',
                              border: '1px solid var(--border)',
                              display: 'block'
                            }}
                          />
                        ) : (
                          <div style={{
                            width: 'min(100px, 15vw)',
                            height: 'min(60px, 9vw)',
                            background: 'var(--grey-200)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <img src="/n-zero.png" alt="N-Zero" style={{ width: '60%', opacity: 0.3, objectFit: 'contain' }} />
                          </div>
                        )}
                      </td>

                      {/* Year */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.year || '—'}
                      </td>

                      {/* Make */}
                      <td style={{ 
                        padding: '8px',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.make || '—'}
                      </td>

                      {/* Model */}
                      <td style={{ 
                        padding: '8px',
                        borderRight: '1px solid var(--border)'
                      }}>
                        {vehicle.model || '—'}
                        {vehicle.hype_reason && (
                          <div style={{ 
                            fontSize: '7pt', 
                            color: 'var(--accent)', 
                            fontWeight: 'bold',
                            marginTop: '2px'
                          }}>
                            {vehicle.hype_reason}
                          </div>
                        )}
                      </td>

                      {/* Mileage */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.mileage 
                          ? `${vehicle.mileage.toLocaleString()}` 
                          : '—'
                        }
                      </td>

                      {/* Price */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.display_price 
                          ? `$${vehicle.display_price.toLocaleString()}` 
                          : '—'
                        }
                      </td>

                      {/* Volume (Trading Volume - placeholder) */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                        color: 'var(--text-muted)'
                      }}>
                        —
                      </td>

                      {/* Images Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.image_count || 0}
                      </td>

                      {/* Events Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.event_count || 0}
                      </td>

                      {/* Views Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.view_count || 0}
                      </td>

                      {/* Updated */}
                      <td style={{ 
                        padding: '8px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.updated_at 
                          ? new Date(vehicle.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Gallery View */}
        {viewMode === 'gallery' && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
            gap: '4px'
          }}>
            {vehiclesToRender.map((vehicle) => (
                <VehicleCardDense
                  key={vehicle.id}
                  vehicle={vehicle}
                  viewMode="gallery"
                  infoDense={infoDense}
                  viewerUserId={session?.user?.id}
                  showFollowButton={!!session?.user?.id}
                  thermalPricing={false} // ARCHIVED: Always disabled
                  sourceStampUrl={
                    ((vehicle as any)?.origin_organization_id ? orgWebsitesById[String((vehicle as any).origin_organization_id)] : undefined) ||
                    (vehicle as any)?.discovery_url
                  }
                />
            ))}
          </div>
        )}

        {/* Grid View - Small cards side-by-side, lazy loaded */}
        {viewMode === 'grid' && (
          <div ref={gridRef} style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(1, Math.min(16, cardsPerRow))}, minmax(0, 1fr))`,
            gap: '8px'
        }}>
            {vehiclesToRender.map((vehicle) => (
              <VehicleCardDense
                key={vehicle.id}
                vehicle={vehicle}
                viewMode="grid"
                cardSizePx={gridCardSizePx}
                infoDense={false}
                showFollowButton={!!session?.user?.id}
                  showDetailOverlay={true}
                viewerUserId={session?.user?.id}
                thermalPricing={thermalPricing}
                thumbnailFit={thumbFitMode === 'original' ? 'contain' : 'cover'}
                sourceStampUrl={
                  ((vehicle as any)?.origin_organization_id ? orgWebsitesById[String((vehicle as any).origin_organization_id)] : undefined) ||
                  (vehicle as any)?.discovery_url
                }
              />
            ))}
        </div>
        )}

        {isRenderTruncated && (viewMode === 'grid' || viewMode === 'gallery') && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
            <button
              type="button"
              className="button-win95"
              onClick={() => setFilteredRenderLimit((prev) => prev + FILTERED_RENDER_STEP)}
            >
              Show more ({Math.max(0, filteredVehicles.length - vehiclesToRender.length)} more)
            </button>
        </div>
        )}

        {/* Infinite scroll sentinel */}
        {!error && filteredVehicles.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
            <div ref={infiniteSentinelRef} style={{ width: '1px', height: '1px' }} />
            {loadingMore && <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Loading…</div>}
            {!hasMore && !loadingMore && (
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>End of results</div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div style={{
            background: '#fee',
            border: '2px solid #f00',
            padding: 'var(--space-8)',
            margin: 'var(--space-4)',
            textAlign: 'left'
          }}>
            <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px', color: '#c00' }}>
              Error Loading Content
            </div>
            <div style={{ fontSize: '9pt', color: '#800', marginBottom: '8px' }}>
              {error}
            </div>
            {debugInfo && (
              <details style={{ fontSize: '8pt', color: '#666', marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', marginBottom: '4px' }}>Debug Info</summary>
                <pre style={{ 
                  background: 'var(--surface)', 
                  padding: '8px', 
                  border: '1px solid var(--border)',
                  overflow: 'auto',
                  fontSize: '7pt'
                }}>
                  {JSON.stringify(debugInfo, null, 2)}
                </pre>
              </details>
            )}
            <div style={{ fontSize: '8pt', color: '#666', marginTop: '8px' }}>
              Check browser console for more details. Verify environment variables are set in Vercel.
            </div>
          </div>
        )}

        {filteredVehicles.length === 0 && !loading && !error && (
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-8)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
              No vehicles found
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              {feedVehicles.length === 0 
                ? 'Be the first to add a build and start the hype train!'
                : 'Try adjusting your filters to see more results.'
              }
            </div>
            {feedVehicles.length === 0 && (
              <button
                onClick={() => navigate('/add-vehicle')}
                style={{
                  background: 'var(--grey-600)',
                  color: 'var(--white)',
                  border: '2px solid var(--border)',
                  padding: '8px 16px',
                  fontSize: '9pt',
                  cursor: 'pointer',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                Add Your First Vehicle
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Scroll to Top Button - Appears after scrolling down */}
      {showScrollTop && (
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(10px)',
            border: '2px solid rgba(255, 255, 255, 0.3)',
            color: 'white',
            fontSize: '20px',
            fontWeight: 'bold',
            cursor: 'pointer',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.9)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          ↑
        </button>
      )}

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

    </div>
  );
};

export default CursorHomepage;
