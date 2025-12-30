import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, SUPABASE_URL } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { UserInteractionService } from '../services/userInteractionService';
import { usePageTitle } from '../hooks/usePageTitle';

interface HypeVehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
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
type ViewMode = 'gallery' | 'grid' | 'technical';
type SortBy = 'year' | 'make' | 'model' | 'mileage' | 'newest' | 'oldest' | 'popular' | 'price_high' | 'price_low' | 'volume' | 'images' | 'events' | 'views';
type SortDirection = 'asc' | 'desc';

const DEBUG_CURSOR_HOMEPAGE = false;

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
  bodyStyles: string[]; // Car types: Coupe, Sedan, Pickup, SUV, etc.
  is4x4: boolean; // 4WD/4x4/AWD filter
  priceMin: number | null;
  priceMax: number | null;
  hasImages: boolean;
  forSale: boolean;
  hideSold: boolean;
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

const DEFAULT_FILTERS: FilterState = {
  yearMin: null,
  yearMax: null,
  makes: [],
  bodyStyles: [],
  is4x4: false,
  priceMin: null,
  priceMax: null,
  hasImages: false,
  forSale: false,
  hideSold: false,
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
  const [showFilters, setShowFilters] = useState<boolean>(true); // Visible by default
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [infoDense, setInfoDense] = useState<boolean>(false);
  
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
    priceFilters: false,
    statusFilters: false,
    locationFilters: false,
    advancedFilters: true, // Advanced filters collapsed by default
  });

  // Search inputs for filtering
  const [sourceSearchText, setSourceSearchText] = useState('');
  const [makeSearchText, setMakeSearchText] = useState('');
  const [showMakeSuggestions, setShowMakeSuggestions] = useState(false);

  // Available makes from database for autocomplete
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [availableBodyStyles, setAvailableBodyStyles] = useState<string[]>([]);

  const hasActiveFilters = useMemo(() => {
    if (filters.yearMin || filters.yearMax) return true;
    if (filters.priceMin || filters.priceMax) return true;
    if ((filters.makes?.length || 0) > 0) return true;
    if ((filters.bodyStyles?.length || 0) > 0) return true;
    if (filters.is4x4) return true;
    if ((filters.locations && filters.locations.length > 0) || (filters.zipCode && filters.radiusMiles > 0)) return true;
    if (filters.forSale) return true;
    if (filters.hideSold) return true;
    if (filters.showPending) return true;
    if (filters.privateParty) return true;
    if (filters.dealer) return true;
    if (filters.hideDealerListings) return true;
    if (filters.hideCraigslist) return true;
    if (filters.hideDealerSites) return true;
    if (filters.hideKsl) return true;
    if (filters.hideBat) return true;
    if (filters.hideClassic) return true;
    return false;
  }, [filters]);


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

        const suppressAutoMinimize = now < suppressAutoMinimizeUntilRef.current;
        if (!suppressAutoMinimize && deltaY > 0 && showFilters && currentScrollY > 12 && !filterBarMinimized && !filterPanelStillVisible) {
          setFilterBarMinimized(true);
          setShowFilters(false);
        }
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
          const s = String(raw ?? '').trim();
          if (!s) return null;

          // Reject extreme lengths (garbage blobs / truncated scrape junk)
          if (s.length < 2 || s.length > 30) return null;

          // Reject anything with digits (kills "2017", "320i", etc.)
          if (/\d/.test(s)) return null;

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
        const { data: makeData } = await supabase
          .from('vehicles')
          .select('make')
          .eq('is_public', true)
          .not('make', 'is', null)
          .limit(5000);

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

        // Load distinct body styles
        const { data: bodyData } = await supabase
          .from('vehicles')
          .select('body_style')
          .eq('is_public', true)
          .not('body_style', 'is', null)
          .limit(5000);
        
        if (bodyData) {
          const uniqueStyles = [...new Set(bodyData.map(v => v.body_style).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
          setAvailableBodyStyles(uniqueStyles);
        }
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
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearchText(searchText.trim()), 150);
    return () => window.clearTimeout(t);
  }, [searchText]);

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
    // Body style filter (car type)
    if (filters.bodyStyles.length > 0) {
      result = result.filter(v => {
        const bodyStyle = ((v as any).body_style || '').toLowerCase();
        return filters.bodyStyles.some(bs => bodyStyle.includes(bs.toLowerCase()));
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
      result = result.filter(v => (v.display_price || 0) >= filters.priceMin!);
    }
    if (filters.priceMax) {
      result = result.filter(v => (v.display_price || 0) <= filters.priceMax!);
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

    // Source / dealer-ish filtering
    if (
      filters.hideDealerListings ||
      filters.hideCraigslist ||
      filters.hideDealerSites ||
      filters.hideKsl ||
      filters.hideBat ||
      filters.hideClassic ||
      (filters.hiddenSources && filters.hiddenSources.length > 0)
    ) {
      result = result.filter((v: any) => {
        const src = classifySource(v);
        const hiddenSourcesSet = new Set(filters.hiddenSources || []);

        if (filters.hideDealerListings) {
          if (src === 'craigslist' || src === 'dealer_site' || src === 'ksl') return false;
        }

        if (filters.hideCraigslist && src === 'craigslist') return false;
        if (filters.hideDealerSites && src === 'dealer_site') return false;
        if (filters.hideKsl && src === 'ksl') return false;
        if (filters.hideBat && src === 'bat') return false;
        if (filters.hideClassic && src === 'classic') return false;
        
        // Check dynamic sources
        if (hiddenSourcesSet.has(src)) return false;

        // If ALL main sources are hidden, also hide unknown sources
        const allMainSourcesHidden = filters.hideCraigslist && filters.hideDealerSites && 
          filters.hideKsl && filters.hideBat && filters.hideClassic;
        if (allMainSourcesHidden && (src === 'unknown' || src === 'user')) return false;

        return true;
      });
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
        result.sort((a, b) => dir * ((b.display_price || 0) - (a.display_price || 0)));
        break;
      case 'price_low':
        result.sort((a, b) => dir * ((a.display_price || 0) - (b.display_price || 0)));
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
  }, [feedVehicles, filters, sortBy, sortDirection, debouncedSearchText]);

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
    if (filters.forSale !== DEFAULT_FILTERS.forSale) n++;
    if (filters.hideSold !== DEFAULT_FILTERS.hideSold) n++;
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
    forSaleCount: 0,
    activeAuctions: 0,
    totalBids: 0,
    avgValue: 0
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
      let query = supabase
        .from('vehicles')
        .select('sale_price, sale_status, asking_price, current_value, purchase_price, msrp, winning_bid, high_bid, current_bid, is_for_sale, bid_count, auction_outcome, sale_date, discovery_url, discovery_source, profile_origin, year, make, model, title, vin, image_count', { count: 'exact' })
        .eq('is_public', true)
        .neq('status', 'pending');

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

      // For sale filter
      if (filters.forSale) {
        query = query.eq('is_for_sale', true);
      }

      // Hide sold filter - vehicles that are NOT sold
      if (filters.hideSold) {
        query = query.or('sale_status.neq.sold,sale_status.is.null');
      }

      // Source filters - we'll filter by discovery_source and discovery_url patterns
      // Note: classifySource uses discovery_url patterns, so we'll do source filtering client-side
      // to match the exact same logic

      // Execute query
      const { data: vehicles, count, error } = await query;

      if (error) {
        console.error('Error loading filtered stats:', error);
        return;
      }

      // Apply client-side filters that are harder to do in SQL
      let filtered = vehicles || [];
      
      // Source filters (client-side to match classifySource logic exactly)
      if (
        filters.hideDealerListings ||
        filters.hideCraigslist ||
        filters.hideDealerSites ||
        filters.hideKsl ||
        filters.hideBat ||
        filters.hideClassic ||
        (filters.hiddenSources && filters.hiddenSources.length > 0)
      ) {
        filtered = filtered.filter((v: any) => {
          const src = classifySource(v);
          const hiddenSourcesSet = new Set(filters.hiddenSources || []);

          if (filters.hideDealerListings) {
            if (src === 'craigslist' || src === 'dealer_site' || src === 'ksl') return false;
          }

          if (filters.hideCraigslist && src === 'craigslist') return false;
          if (filters.hideDealerSites && src === 'dealer_site') return false;
          if (filters.hideKsl && src === 'ksl') return false;
          if (filters.hideBat && src === 'bat') return false;
          if (filters.hideClassic && src === 'classic') return false;
          
          // Check dynamic sources
          if (hiddenSourcesSet.has(src)) return false;

          return true;
        });
      }
      
      // Price filters (client-side because we need to check multiple price fields)
      if (filters.priceMin || filters.priceMax) {
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
        filtered = filtered.filter((v: any) => (v.image_count || 0) > 0);
      }

      // Search text filter (client-side)
      if (debouncedSearchText) {
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

      // Calculate stats from filtered vehicles
      let totalValue = 0;
      let vehiclesWithValue = 0;
      let forSaleCount = 0;
      let activeAuctions = 0;
      let totalBids = 0;

      filtered.forEach((v: any) => {
        // Count for sale
        if (v.is_for_sale === true) {
          forSaleCount++;
        }

        // Count active auctions
        const hasBids = (v.bid_count && Number(v.bid_count) > 0) || false;
        const auctionOutcome = v.auction_outcome;
        const isActiveAuction = auctionOutcome === 'active' || auctionOutcome === 'live';
        if (hasBids || isActiveAuction) {
          activeAuctions++;
        }

        // Sum total bids
        if (v.bid_count && Number.isFinite(Number(v.bid_count))) {
          totalBids += Number(v.bid_count);
        }

        // Calculate value
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

        if (vehiclePrice > 0) {
          totalValue += vehiclePrice;
          vehiclesWithValue++;
        }
      });

      const avgValue = vehiclesWithValue > 0 ? totalValue / vehiclesWithValue : 0;

      // Sales volume (24hrs)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString().split('T')[0];
      const salesVolume = filtered
        .filter((v: any) => Boolean(v?.sale_price) && Boolean(v?.sale_date) && String(v.sale_date) >= todayISO)
        .reduce((sum, v: any) => {
          const price = Number(v.sale_price || 0) || 0;
          return sum + (Number.isFinite(price) ? price : 0);
        }, 0);

      setFilteredStatsFromDb({
        totalVehicles: filtered.length,
        totalValue,
        salesVolume,
        forSaleCount,
        activeAuctions,
        totalBids,
        avgValue
      });
    } catch (error) {
      console.error('Error loading filtered stats:', error);
    } finally {
      setFilteredStatsLoading(false);
    }
  }, [hasActiveFilters, debouncedSearchText, filters]);

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
        forSaleCount: 0,
        activeAuctions: 0,
        totalBids: 0,
        avgValue: 0
      });
    }
  }, [hasActiveFilters, debouncedSearchText, filters, loadFilteredStats]);

  // Calculate filtered vehicle statistics (fallback for display, but we prefer DB stats)
  const filteredStats = useMemo(() => {
    // If we have DB stats, use those (more accurate)
    if (hasActiveFilters || debouncedSearchText) {
      return filteredStatsFromDb;
    }
    
    // Otherwise compute from filteredVehicles (for backwards compatibility)
    const totalVehicles = filteredVehicles.length;
    let totalValue = 0;
    let vehiclesWithValue = 0;
    let forSaleCount = 0;
    let activeAuctions = 0;
    let totalBids = 0;
    
    filteredVehicles.forEach((v) => {
      // Count for sale
      if (v.is_for_sale === true) {
        forSaleCount++;
      }
      
      // Count active auctions
      const hasBids = (v.bid_count && Number(v.bid_count) > 0) || false;
      const auctionOutcome = (v as any).auction_outcome;
      const isActiveAuction = auctionOutcome === 'active' || auctionOutcome === 'live';
      if (hasBids || isActiveAuction) {
        activeAuctions++;
      }
      
      // Sum total bids
      if (v.bid_count && Number.isFinite(Number(v.bid_count))) {
        totalBids += Number(v.bid_count);
      }
      
      // Calculate value - use the best/actual price per vehicle
      // Priority: sale_price (if sold) > asking_price > current_value > purchase_price > display_price
      let vehiclePrice = 0;
      
      // Priority: sale_price first (if exists, use it - sold vehicles should have sale_price)
      if (v.sale_price && typeof v.sale_price === 'number' && Number.isFinite(v.sale_price) && v.sale_price > 0) {
        vehiclePrice = v.sale_price;
      }
      // Otherwise use asking_price (only if no sale_price)
      else if (v.asking_price) {
        vehiclePrice = typeof v.asking_price === 'number' && Number.isFinite(v.asking_price) ? v.asking_price : 0;
        if (typeof v.asking_price === 'string') {
          const parsed = parseFloat(v.asking_price);
          vehiclePrice = Number.isFinite(parsed) ? parsed : 0;
        }
      }
      // Fall back to current_value
      else if (v.current_value) {
        vehiclePrice = typeof v.current_value === 'number' && Number.isFinite(v.current_value) ? v.current_value : 0;
      }
      // Then purchase_price
      else if (v.purchase_price) {
        vehiclePrice = typeof v.purchase_price === 'number' && Number.isFinite(v.purchase_price) ? v.purchase_price : 0;
      }
      // Last resort: display_price (computed)
      else if (v.display_price) {
        vehiclePrice = typeof v.display_price === 'number' && Number.isFinite(v.display_price) ? v.display_price : 0;
      }
      
      if (vehiclePrice > 0) {
        totalValue += vehiclePrice;
        vehiclesWithValue++;
      }
    });
    
    const avgValue = vehiclesWithValue > 0 ? totalValue / vehiclesWithValue : 0;
    
    // Sales volume (24hrs): align semantics with dbStats (sold today), but scoped to the filtered set.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const salesVolume = filteredVehicles
      .filter((v: any) => Boolean(v?.sale_price) && Boolean(v?.sale_date) && String(v.sale_date) >= todayISO)
      .reduce((sum, v: any) => {
        const price = Number(v.sale_price || 0) || 0;
        return sum + (Number.isFinite(price) ? price : 0);
      }, 0);
    
    return { 
      totalVehicles, 
      totalValue, 
      salesVolume,
      forSaleCount,
      activeAuctions,
      totalBids,
      avgValue
    };
  }, [filteredVehicles, hasActiveFilters, debouncedSearchText, filteredStatsFromDb]);

  // Add state for database-wide stats (around line 370, after existing stats state)
  const [dbStats, setDbStats] = useState({
    totalVehicles: 0,
    totalValue: 0,
    salesVolume: 0,
    forSaleCount: 0,
    activeAuctions: 0,
    totalBids: 0,
    avgValue: 0
  });
  const [dbStatsLoading, setDbStatsLoading] = useState(true);

  // Add function to load database-wide stats (around line 726, before loadSession)
  const loadDatabaseStats = async () => {
    try {
      setDbStatsLoading(true);
      
      // Get total vehicle count (public vehicles only, matching the displayed count)
      const { count: totalCount, error: countError } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('is_public', true);
      
      if (countError) {
        console.error('Error loading vehicle count:', countError);
      }
      
      // Get comprehensive vehicle data for stats (public vehicles only)
      const { data: allVehicles, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('sale_price, sale_status, asking_price, current_value, purchase_price, msrp, winning_bid, high_bid, is_for_sale, bid_count, auction_outcome')
        .eq('is_public', true);
      
      if (vehiclesError) {
        console.error('Error loading vehicles for stats:', vehiclesError);
        return;
      }
      
      // Helper to safely parse numeric values (handles both number and string from DB)
      const safeNum = (val: any): number => {
        if (val == null) return 0;
        const n = typeof val === 'number' ? val : parseFloat(String(val));
        return Number.isFinite(n) ? n : 0;
      };
      
      let totalValue = 0;
      let vehiclesWithValue = 0;
      let forSaleCount = 0;
      let activeAuctions = 0;
      let totalBids = 0;
      
      (allVehicles || []).forEach((v) => {
        // Count for sale
        if (v.is_for_sale === true) {
          forSaleCount++;
        }
        
        // Count active auctions (has bids or auction outcome is active)
        const hasBids = (v.bid_count && Number(v.bid_count) > 0) || false;
        const isActiveAuction = v.auction_outcome === 'active' || v.auction_outcome === 'live';
        if (hasBids || isActiveAuction) {
          activeAuctions++;
        }
        
        // Sum total bids
        if (v.bid_count && Number.isFinite(Number(v.bid_count))) {
          totalBids += Number(v.bid_count);
        }
        
        // Calculate value - use the best/actual price per vehicle
        let vehiclePrice = 0;
        
        // If sold, use sale_price
        if (v.sale_price && (v.sale_status === 'sold' || safeNum(v.sale_price) > 0)) {
          vehiclePrice = safeNum(v.sale_price);
        }
        // Otherwise use asking_price
        else if (v.asking_price) {
          vehiclePrice = safeNum(v.asking_price);
        }
        // Fall back to current_value
        else if (v.current_value) {
          vehiclePrice = safeNum(v.current_value);
        }
        // Last resort: purchase_price
        else if (v.purchase_price) {
          vehiclePrice = safeNum(v.purchase_price);
        }
        
        if (vehiclePrice > 0) {
          totalValue += vehiclePrice;
          vehiclesWithValue++;
        }
      });
      
      const avgValue = vehiclesWithValue > 0 ? totalValue / vehiclesWithValue : 0;
      
      // Get sales volume in last 24 hours (vehicles sold today)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      const { data: recentSales } = await supabase
        .from('vehicles')
        .select('sale_price, sale_date')
        .eq('is_public', true)
        .not('sale_price', 'is', null)
        .gte('sale_date', todayISO);
      
      const salesVolume = (recentSales || []).reduce((sum, v) => {
        const price = v.sale_price || 0;
        return sum + (typeof price === 'number' && Number.isFinite(price) ? price : 0);
      }, 0);
      
      const stats = {
        totalVehicles: totalCount || 0,
        totalValue,
        salesVolume,
        forSaleCount,
        activeAuctions,
        totalBids,
        avgValue
      };
      
      console.log('Database stats loaded:', {
        totalVehicles: stats.totalVehicles,
        totalValue: stats.totalValue,
        vehiclesWithValue,
        vehiclesProcessed: (allVehicles || []).length
      });
      
      setDbStats(stats);
    } catch (error) {
      console.error('Error loading database stats:', error);
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
    if (!hasActiveFilters && !debouncedSearchText) {
      // Show database-wide stats when no filters
      return dbStats;
    } else {
      // Show filtered stats when filters are active
      return filteredStats;
    }
  }, [hasActiveFilters, debouncedSearchText, dbStats, filteredStats]);

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

      // Get vehicles for feed (keep payload small; avoid heavy origin_metadata + bulk image joins here).
      // NOTE: Do NOT select `listing_start_date` here. It is not a real column in the DB and will cause
      // PostgREST 400 errors if included in the `select()` list.
      // Simple query: most recent vehicles first, no filters
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, normalized_model, series, trim, transmission, transmission_model, title, vin, created_at, updated_at,
          sale_price, current_value, purchase_price, asking_price,
          sale_date, sale_status,
          auction_outcome, high_bid, winning_bid, bid_count,
          auction_end_date,
          is_for_sale, mileage, status, is_public, primary_image_url, image_url, origin_organization_id,
          discovery_url, discovery_source, profile_origin
        `)
        .eq('is_public', true)
        .neq('status', 'pending')
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

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
        const salePrice = v.sale_price ? Number(v.sale_price) : null;
        const askingPrice = v.asking_price ? Number(v.asking_price) : null;
        const currentValue = v.current_value ? Number(v.current_value) : null;
        const purchasePrice = v.purchase_price ? Number(v.purchase_price) : null;
        const winningBid = v.winning_bid ? Number(v.winning_bid) : null;
        const highBid = v.high_bid ? Number(v.high_bid) : null;
        const listing = auctionByVehicleId.get(String(v?.id || '')) || null;
        const listingStatus = String((listing as any)?.listing_status || '').toLowerCase();
        const isLive = listingStatus === 'active' || listingStatus === 'live';
        const listingLiveBid = typeof (listing as any)?.current_bid === 'number' ? (listing as any).current_bid : Number((listing as any)?.current_bid || 0);
        const finalPrice = typeof (listing as any)?.final_price === 'number' ? (listing as any).final_price : Number((listing as any)?.final_price || 0);

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
          ((askingPrice && askingPrice > 0) && (v.is_for_sale === true || String(v.sale_status || '').toLowerCase() === 'for_sale')) ? askingPrice :
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
      
      setHasMore((vehicles || []).length >= PAGE_SIZE);
      setPage(pageNum);

      if (append) {
        // Append to bottom - preserve existing order, add new vehicles at end
        // This prevents jumping as new vehicles load
        setFeedVehicles((prev) => {
          const existingIds = new Set(prev.map((v: any) => String(v?.id || '')));
          const newVehicles = sorted.filter((v: any) => !existingIds.has(String(v?.id || '')));
          // Maintain insertion order - existing vehicles stay in place, new ones append
          return [...prev, ...newVehicles];
        });
      } else {
        // Initial load - set fresh
        setFeedVehicles(sorted);
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
  }, []);

  // Load active sources from database
  const [activeSources, setActiveSources] = useState<Array<{
    id: string;
    domain: string;
    source_name: string;
    url: string;
  }>>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});

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

  // Map domain to filter key for backward compatibility
  const domainToFilterKey = useCallback((domain: string): string => {
    const domainLower = domain.toLowerCase();
    if (domainLower.includes('craigslist')) return 'craigslist';
    if (domainLower.includes('ksl')) return 'ksl';
    if (domainLower.includes('autotrader') || domainLower.includes('dealer')) return 'dealer_site';
    if (domainLower.includes('bringatrailer') || domainLower.includes('bat')) return 'bat';
    if (domainLower.includes('classic')) return 'classic';
    // For new sources, use domain as key
    return domainLower.replace(/[^a-z0-9]/g, '_');
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
          console.error('Error loading source counts:', error);
          return;
        }

        // Count vehicles per source key using classifySource
        const counts: Record<string, number> = {};
        (vehicles || []).forEach((v: any) => {
          const sourceKey = classifySource(v);
          counts[sourceKey] = (counts[sourceKey] || 0) + 1;
        });

        // Map source keys to domain keys for display
        const domainCounts: Record<string, number> = {};
        activeSources.forEach(source => {
          const domainKey = domainToFilterKey(source.domain);
          // For known sources, classifySource returns the same key as domainToFilterKey
          // For new sources, match by domain from discovery_url
          if (counts[domainKey] !== undefined) {
            domainCounts[domainKey] = counts[domainKey];
          } else {
            // For new sources, try to match by domain from discovery_url
            const domainLower = source.domain.toLowerCase();
            const matchingCount = (vehicles || []).filter((v: any) => {
              const url = (v.discovery_url || '').toLowerCase();
              return url.includes(domainLower);
            }).length;
            domainCounts[domainKey] = matchingCount;
          }
        });

        setSourceCounts(domainCounts);
      } catch (err) {
        console.error('Error loading source counts:', err);
      }
    }

    if (activeSources.length > 0) {
      loadSourceCounts();
    }
  }, [activeSources, domainToFilterKey]);

  const includedSources = useMemo(() => {
    const base: Record<string, boolean> = {};
    const hiddenSourcesSet = new Set(filters.hiddenSources || []);
    
    // Initialize all active sources as included by default
    activeSources.forEach(source => {
      const key = domainToFilterKey(source.domain);
      // Check if there's a specific filter for this source
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
        // New sources: check if they're in hiddenSources set
        base[key] = !hiddenSourcesSet.has(key);
      }
    });

    return base;
  }, [
    activeSources,
    filters.hideDealerListings,
    filters.hideCraigslist,
    filters.hideDealerSites,
    filters.hideKsl,
    filters.hideBat,
    filters.hideClassic,
    filters.hiddenSources,
    domainToFilterKey
  ]);

  const faviconUrl = useCallback((domain: string) => {
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
  }, []);

  const sourcePogs = useMemo(() => {
    const all = activeSources.map(source => {
      const key = domainToFilterKey(source.domain);
      return {
        key: key as any,
        domain: source.domain,
        title: source.source_name || source.domain,
        included: includedSources[key] !== false, // Default to true if not explicitly set
        id: source.id,
        url: source.url,
        count: sourceCounts[key] || 0
      };
    });

    return {
      all,
      selected: all.filter((x) => x.included),
      hiddenCount: all.filter((x) => !x.included).length
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

  // Show grid immediately - no loading state blocking
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingTop: '16px' }}>
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
            title="Click to open filters"
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
            <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'baseline', gap: '10px', flex: '0 0 auto' }}>
              <div style={{ fontSize: '8pt', fontWeight: 900, color: 'var(--text)' }}>
                {displayStats.totalVehicles.toLocaleString()} vehicles
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                {formatCurrency(displayStats.totalValue)} total value
              </div>
              {displayStats.forSaleCount > 0 && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {displayStats.forSaleCount.toLocaleString()} for sale
                </div>
              )}
              {displayStats.activeAuctions > 0 && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {displayStats.activeAuctions} active auctions
                </div>
              )}
              {displayStats.salesVolume > 0 && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {formatCurrency(displayStats.salesVolume)} sales (24hrs)
                </div>
              )}
              {displayStats.avgValue > 0 && displayStats.totalVehicles > 1 && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {formatCurrency(displayStats.avgValue)} avg
                </div>
              )}
            </div>

            {/* Scrollable strip: selected filters + market pogs */}
            <div
              onClick={(e) => e.stopPropagation()}
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

        {/* Show Filters Button - only when filters are hidden and no active filters */}
        {!showFilters && !filterBarMinimized && !hasActiveFilters && (
          <div style={{
            marginBottom: '16px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
              {filteredVehicles.length} vehicles
            </div>
            <button
              onClick={() => setShowFilters(true)}
              style={{
                padding: '4px 8px',
                fontSize: '8pt',
                border: '1px solid var(--border)',
                background: 'var(--white)',
                color: 'var(--text)',
                cursor: 'pointer',
                borderRadius: '2px',
                fontFamily: '"MS Sans Serif", sans-serif'
              }}
            >
              Show Filters
            </button>
          </div>
        )}

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
              <span><b>{displayStats.totalVehicles.toLocaleString()}</b> veh</span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span><b>{formatCurrency(displayStats.totalValue)}</b> val</span>
              {displayStats.forSaleCount > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span><b>{displayStats.forSaleCount.toLocaleString()}</b> sale</span>
                </>
              )}
              {displayStats.salesVolume > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span><b>{formatCurrency(displayStats.salesVolume)}</b> 24h</span>
                </>
              )}
              {displayStats.activeAuctions > 0 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span><b>{displayStats.activeAuctions}</b> auct</span>
                </>
              )}
              {displayStats.avgValue > 0 && displayStats.totalVehicles > 1 && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span><b>{formatCurrency(displayStats.avgValue)}</b> avg</span>
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
              
              {/* Price sort button */}
              <button
                onClick={() => {
                  if (sortBy === 'price_high') {
                    // Currently high -> switch to low
                    setSortBy('price_low');
                    setSortDirection('asc');
                  } else if (sortBy === 'price_low') {
                    // Currently low -> switch to high
                    setSortBy('price_high');
                    setSortDirection('desc');
                  } else {
                    // Not sorted by price -> start with high
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
                price
              </button>
              
              {/* Price filter button */}
              <button
                onClick={() => toggleCollapsedSection('priceFilters')}
                className="button-win95"
                style={{
                  padding: '3px 7px',
                  fontSize: '7pt',
                  background: !collapsedSections.priceFilters ? 'var(--grey-600)' : (filters.priceMin || filters.priceMax) ? 'var(--grey-300)' : 'var(--white)',
                  color: !collapsedSections.priceFilters ? 'var(--white)' : 'var(--text)',
                  fontWeight: (!collapsedSections.priceFilters || filters.priceMin || filters.priceMax) ? 700 : 400,
                  border: !collapsedSections.priceFilters ? '1px solid var(--grey-600)' : '1px solid var(--border)'
                }}
              >
                {(filters.priceMin || filters.priceMax) 
                  ? `$${filters.priceMin ? (filters.priceMin/1000).toFixed(0) + 'k' : '?'}-${filters.priceMax ? (filters.priceMax/1000).toFixed(0) + 'k' : '?'}`
                  : 'price range'}
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
            
            {/* Price sort direction indicator */}
            {(sortBy === 'price_high' || sortBy === 'price_low') && (
              <div style={{
                marginBottom: '8px',
                padding: '6px',
                background: 'var(--grey-50)',
                border: '1px solid var(--border)',
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                fontSize: '7pt'
              }}>
                {sortBy === 'price_high' ? 'highest first' : 'lowest first'} in price
              </div>
            )}

            {/* Expanded filter controls - shown when sections are open */}
            <div style={{ padding: '6px' }}>
              {/* Year filters - expanded */}
              {!collapsedSections.yearFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  {/* Year range input */}
                  <div style={{
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center',
                    flexWrap: 'wrap'
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
                  
                  {/* Quick year buttons */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
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
                            border: isActive ? '1px solid var(--grey-600)' : '1px solid var(--border)'
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
                      onChange={(e) => setSourceSearchText(e.target.value)}
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
                      .filter((p) => 
                        !sourceSearchText || 
                        p.title.toLowerCase().includes(sourceSearchText.toLowerCase()) ||
                        p.domain.toLowerCase().includes(sourceSearchText.toLowerCase()) ||
                        p.key.toLowerCase().includes(sourceSearchText.toLowerCase())
                      )
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

              {/* Make filter - expanded */}
              {!collapsedSections.makeFilters && (
                <div style={{
                  marginBottom: '8px',
                  padding: '6px',
                  background: 'var(--grey-50)',
                  border: '1px solid var(--border)',
                  fontSize: '7pt'
                }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', position: 'relative' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        type="text"
                        placeholder="search makes (Chevrolet, Ford...)"
                        value={makeSearchText}
                        onChange={(e) => {
                          setMakeSearchText(e.target.value);
                          setShowMakeSuggestions(true);
                        }}
                        onFocus={() => setShowMakeSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowMakeSuggestions(false), 150)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && makeSearchText.trim()) {
                            const newMake = makeSearchText.trim();
                            // Find exact match or use typed value
                            const exactMatch = availableMakes.find(m => m.toLowerCase() === newMake.toLowerCase());
                            const makeToAdd = exactMatch || newMake;
                            if (!filters.makes.includes(makeToAdd)) {
                              setFilters({...filters, makes: [...filters.makes, makeToAdd]});
                            }
                            setMakeSearchText('');
                            setShowMakeSuggestions(false);
                          } else if (e.key === 'Escape') {
                            setShowMakeSuggestions(false);
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '3px 6px',
                          fontSize: '7pt',
                          border: '1px solid var(--border)',
                          fontFamily: '"MS Sans Serif", sans-serif'
                        }}
                      />
                      {/* Autocomplete dropdown */}
                      {showMakeSuggestions && makeSearchText.length > 0 && (
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
                          {availableMakes
                            .filter(m => 
                              m.toLowerCase().startsWith(makeSearchText.toLowerCase()) &&
                              !filters.makes.includes(m)
                            )
                            .slice(0, 10)
                            .map((make) => (
                              <div
                                key={make}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setFilters({...filters, makes: [...filters.makes, make]});
                                  setMakeSearchText('');
                                  setShowMakeSuggestions(false);
                                }}
                                style={{
                                  padding: '4px 8px',
                                  cursor: 'pointer',
                                  fontSize: '7pt',
                                  borderBottom: '1px solid var(--grey-100)'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--grey-100)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--white)')}
                              >
                                {make}
                              </div>
                            ))}
                          {availableMakes.filter(m => 
                            m.toLowerCase().startsWith(makeSearchText.toLowerCase()) &&
                            !filters.makes.includes(m)
                          ).length === 0 && (
                            <div style={{ padding: '4px 8px', fontSize: '7pt', color: 'var(--text-muted)' }}>
                              No matches - press Enter to add "{makeSearchText}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        if (makeSearchText.trim()) {
                          const newMake = makeSearchText.trim();
                          const exactMatch = availableMakes.find(m => m.toLowerCase() === newMake.toLowerCase());
                          const makeToAdd = exactMatch || newMake;
                          if (!filters.makes.includes(makeToAdd)) {
                            setFilters({...filters, makes: [...filters.makes, makeToAdd]});
                          }
                          setMakeSearchText('');
                          setShowMakeSuggestions(false);
                        }
                      }}
                      className="button-win95"
                      style={{ padding: '2px 8px', fontSize: '7pt' }}
                    >
                      add
                    </button>
                    {filters.makes.length > 0 && (
                      <button
                        onClick={() => setFilters({...filters, makes: []})}
                        className="button-win95"
                        style={{ padding: '2px 6px', fontSize: '7pt' }}
                      >
                        clear
                      </button>
                    )}
                  </div>
                  {filters.makes.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {filters.makes.map((make) => (
                        <span
                          key={make}
                          style={{
                            padding: '2px 6px',
                            background: 'var(--grey-600)',
                            color: 'var(--white)',
                            fontSize: '7pt',
                            borderRadius: '2px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {make}
                          <button
                            onClick={() => setFilters({...filters, makes: filters.makes.filter(m => m !== make)})}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--white)',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '8pt',
                              lineHeight: 1
                            }}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Quick make chips - show top makes from DB */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: filters.makes.length > 0 ? '6px' : 0 }}>
                    {(availableMakes.length > 0 
                      ? availableMakes.slice(0, 20) 
                      : ['Chevrolet', 'Ford', 'Dodge', 'GMC', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac', 'Toyota', 'Porsche', 'Mercedes-Benz', 'BMW']
                    ).map((make) => (
                      <button
                        key={make}
                        onClick={() => {
                          if (filters.makes.includes(make)) {
                            setFilters({...filters, makes: filters.makes.filter(m => m !== make)});
                          } else {
                            setFilters({...filters, makes: [...filters.makes, make]});
                          }
                        }}
                        className="button-win95"
                        style={{
                          padding: '2px 6px',
                          fontSize: '7pt',
                          background: filters.makes.includes(make) ? 'var(--grey-600)' : 'var(--white)',
                          color: filters.makes.includes(make) ? 'var(--white)' : 'var(--text)'
                        }}
                      >
                        {make}
                      </button>
                    ))}
                    {availableMakes.length > 20 && (
                      <span style={{ fontSize: '6pt', color: 'var(--text-muted)', alignSelf: 'center' }}>
                        +{availableMakes.length - 20} more (type to search)
                      </span>
                    )}
                  </div>
                </div>
              )}

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
                    {['Coupe', 'Sedan', 'Convertible', 'Wagon', 'Pickup', 'SUV', 'Roadster', 'Fastback'].map((style) => (
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
                  gap: '4px',
                  alignItems: 'center'
                }}>
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
                      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
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
            {filteredVehicles.map((vehicle) => (
                <VehicleCardDense
                  key={vehicle.id}
                  vehicle={vehicle}
                  viewMode="gallery"
                  infoDense={infoDense}
                  viewerUserId={session?.user?.id}
                  thermalPricing={false} // ARCHIVED: Always disabled
                  sourceStampUrl={
                    (vehicle as any)?.discovery_url ||
                    ((vehicle as any)?.origin_organization_id ? orgWebsitesById[String((vehicle as any).origin_organization_id)] : undefined)
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
            {filteredVehicles.map((vehicle) => (
              <VehicleCardDense
                key={vehicle.id}
                vehicle={vehicle}
                viewMode="grid"
                cardSizePx={gridCardSizePx}
                infoDense={false}
                viewerUserId={session?.user?.id}
                thermalPricing={thermalPricing}
                thumbnailFit={thumbFitMode === 'original' ? 'contain' : 'cover'}
                sourceStampUrl={
                  (vehicle as any)?.discovery_url ||
                  ((vehicle as any)?.origin_organization_id ? orgWebsitesById[String((vehicle as any).origin_organization_id)] : undefined)
                }
              />
          ))}
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

    </div>
  );
};

export default CursorHomepage;
