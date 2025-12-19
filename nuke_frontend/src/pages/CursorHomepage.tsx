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
  priceMin: number | null;
  priceMax: number | null;
  hasImages: boolean;
  forSale: boolean;
  hideSold: boolean;
  // Source / dealer-ish filters
  hideDealerListings: boolean;
  hideCraigslist: boolean;
  hideDealerSites: boolean;
  hideKsl: boolean;
  hideBat: boolean;
  hideClassic: boolean;
  zipCode: string;
  radiusMiles: number;
  showPending: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  yearMin: null,
  yearMax: null,
  makes: [],
  priceMin: null,
  priceMax: null,
  hasImages: false,
  forSale: false,
  // NO preselected filters - let users choose what they want to see
  hideSold: false,
  hideDealerListings: false,
  hideCraigslist: false,
  hideDealerSites: false,
  hideKsl: false,
  hideBat: false,
  hideClassic: false,
  zipCode: '',
  radiusMiles: 0, // No default radius - user must explicitly set location
  showPending: false
};

const STORAGE_KEY = 'nuke_homepage_filters_v1';

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
  // Generic dealer site scrape
  if (origin === 'url_scraper') {
    return 'dealer_site';
  }
  // User-ish
  if (!origin || origin === 'user_upload' || origin === 'manual' || origin === 'user_import') {
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
  const [showFilters, setShowFilters] = useState<boolean>(false); // Always hidden by default - NO preselected filters
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
  const [cardMinWidth, setCardMinWidth] = useState<number>(180); // Smaller default cards
  const [thermalPricing, setThermalPricing] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('nuke_homepage_thermalPricing');
      return saved === 'true';
    } catch {
      return false;
    }
  });
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

  const infiniteObserverRef = useRef<IntersectionObserver | null>(null);

  // Collapsible filter sections
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    yearQuickFilters: false,
    sourceFilters: true, // Source filters collapsed by default
    priceFilters: false,
    statusFilters: false,
    locationFilters: false,
  });


  useEffect(() => {
    loadSession();
    
    // Scroll listener for sticky filter bar and scroll-to-top button
    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const currentScrollY = window.scrollY;

        // Show scroll-to-top button after scrolling down 500px (only update on change)
        const shouldShowScrollTop = currentScrollY > 500;
        setShowScrollTop((prev) => (prev === shouldShowScrollTop ? prev : shouldShowScrollTop));

        // Auto-minimize filter bar after scrolling down 200px (if filters are shown and active)
        // Only auto-minimize when there are active filters, don't auto-expand (let user control expansion)
        if (showFilters && hasActiveFilters && currentScrollY > 200 && !filterBarMinimized) {
          setFilterBarMinimized(true);
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
  }, [showFilters, hasActiveFilters, filterBarMinimized]);

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
      localStorage.setItem('nuke_homepage_showFilters', String(showFilters));
    } catch (err) {
      console.warn('Failed to save showFilters:', err);
    }
  }, [showFilters]);

  useEffect(() => {
    try {
      localStorage.setItem('nuke_homepage_thermalPricing', String(thermalPricing));
    } catch (err) {
      console.warn('Failed to save thermalPricing:', err);
    }
  }, [thermalPricing]);

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

    // Source / dealer-ish filtering
    if (
      filters.hideDealerListings ||
      filters.hideCraigslist ||
      filters.hideDealerSites ||
      filters.hideKsl ||
      filters.hideBat ||
      filters.hideClassic
    ) {
      result = result.filter((v: any) => {
        const src = classifySource(v);

        if (filters.hideDealerListings) {
          if (src === 'craigslist' || src === 'dealer_site' || src === 'ksl') return false;
        }

        if (filters.hideCraigslist && src === 'craigslist') return false;
        if (filters.hideDealerSites && src === 'dealer_site') return false;
        if (filters.hideKsl && src === 'ksl') return false;
        if (filters.hideBat && src === 'bat') return false;
        if (filters.hideClassic && src === 'classic') return false;

        return true;
      });
    }
    
    if (filters.zipCode && filters.zipCode.length === 5) {
      result = result.filter(v => {
        const vehicleZip = (v as any).zip_code || (v as any).location_zip;
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
    if (filters.priceMin !== DEFAULT_FILTERS.priceMin) n++;
    if (filters.priceMax !== DEFAULT_FILTERS.priceMax) n++;
    if (filters.hasImages !== DEFAULT_FILTERS.hasImages) n++;
    if (filters.forSale !== DEFAULT_FILTERS.forSale) n++;
    if (filters.hideSold !== DEFAULT_FILTERS.hideSold) n++;
    if (filters.hideDealerListings !== DEFAULT_FILTERS.hideDealerListings) n++;
    if (filters.hideCraigslist !== DEFAULT_FILTERS.hideCraigslist) n++;
    if (filters.hideDealerSites !== DEFAULT_FILTERS.hideDealerSites) n++;
    if (filters.hideKsl !== DEFAULT_FILTERS.hideKsl) n++;
    if (filters.hideBat !== DEFAULT_FILTERS.hideBat) n++;
    if (filters.hideClassic !== DEFAULT_FILTERS.hideClassic) n++;
    if (filters.zipCode !== DEFAULT_FILTERS.zipCode) n++;
    if (filters.zipCode && filters.radiusMiles !== DEFAULT_FILTERS.radiusMiles) n++;
    if (filters.showPending !== DEFAULT_FILTERS.showPending) n++;
    return n;
  }, [filters, debouncedSearchText]);

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
          auction_outcome, high_bid, winning_bid, bid_count, current_bid,
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
      const auctionByVehicleId = new Map<string, any>();
      try {
        const ids = Array.from(new Set((vehicles || []).map((v: any) => String(v?.id || '')).filter(Boolean)));
        if (ids.length > 0) {
          const { data: listings, error: listErr } = await supabase
            .from('external_listings')
            .select('vehicle_id, platform, listing_status, current_bid, final_price, updated_at')
            .in('vehicle_id', ids)
            .order('updated_at', { ascending: false })
            .limit(2000);
          if (!listErr && Array.isArray(listings)) {
            for (const row of listings as any[]) {
              const vid = String(row?.vehicle_id || '');
              if (!vid) continue;
              if (auctionByVehicleId.has(vid)) continue;
              auctionByVehicleId.set(vid, row);
            }
          }
        }
      } catch {
        // ignore
      }

      // Batch-load thumbnail/medium image variants for optimal grid performance
      const thumbnailByVehicleId = new Map<string, string | null>();
      const mediumByVehicleId = new Map<string, string | null>();
      try {
        const vehicleIds = Array.from(new Set((vehicles || []).map((v: any) => String(v?.id || '')).filter(Boolean)));
        if (vehicleIds.length > 0) {
          // Process in chunks to avoid URL size limits
          const chunkSize = 75;
          for (let i = 0; i < vehicleIds.length; i += chunkSize) {
            const chunk = vehicleIds.slice(i, i + chunkSize);
            const { data: imgs, error: imgErr } = await supabase
              .from('vehicle_images')
              .select('vehicle_id, thumbnail_url, medium_url, image_url, variants')
              .in('vehicle_id', chunk)
              .order('is_primary', { ascending: false })
              .order('created_at', { ascending: true });
            
            if (imgErr) {
              // Non-fatal: continue without thumbnails
              console.warn('Failed to fetch thumbnail chunk:', imgErr);
              continue;
            }
            
            const imageRecords = Array.isArray(imgs) ? imgs : [];
            
            // Group by vehicle_id and take first (primary or oldest)
            const seenVehicleIds = new Set<string>();
            for (const img of imageRecords) {
              const vid = String(img?.vehicle_id || '');
              if (!vid || seenVehicleIds.has(vid)) continue;
              seenVehicleIds.add(vid);
              
              const variants = (img?.variants && typeof img.variants === 'object') ? img.variants : {};
              
              // Prioritize thumbnail, then medium, then full image
              const thumbnail = variants?.thumbnail || img?.thumbnail_url || null;
              const medium = variants?.medium || img?.medium_url || null;
              
              // Normalize URLs (convert signed to public if needed)
              const normalizedThumbnail = thumbnail ? normalizeSupabaseStorageUrl(thumbnail) : null;
              const normalizedMedium = medium ? normalizeSupabaseStorageUrl(medium) : null;
              
              if (normalizedThumbnail) {
                thumbnailByVehicleId.set(vid, normalizedThumbnail);
              }
              if (normalizedMedium) {
                mediumByVehicleId.set(vid, normalizedMedium);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error loading image variants:', err);
        // Non-fatal: continue with fallback images
      }

      // Process vehicles with optimized image data (use thumbnails for grid performance)
      const processed = (vehicles || []).map((v: any) => {
        const salePrice = v.sale_price ? Number(v.sale_price) : null;
        const askingPrice = v.asking_price ? Number(v.asking_price) : null;
        const currentValue = v.current_value ? Number(v.current_value) : null;
        const purchasePrice = v.purchase_price ? Number(v.purchase_price) : null;
        const winningBid = v.winning_bid ? Number(v.winning_bid) : null;
        const highBid = v.high_bid ? Number(v.high_bid) : null;
        const currentBid = v.current_bid ? Number(v.current_bid) : null;
        
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
        // 5. Current bid from vehicle
        // 6. Final price from listing
        // 7. Asking price (user intent)
        // 8. DO NOT fall back to current_value - only show if explicitly set as asking
        const displayPrice =
          (salePrice && salePrice > 0) ? salePrice :
          (winningBid && winningBid > 0) ? winningBid :
          (highBid && highBid > 0) ? highBid :
          (isLive && Number.isFinite(listingLiveBid) && listingLiveBid > 0) ? listingLiveBid :
          (currentBid && currentBid > 0) ? currentBid :
          (Number.isFinite(finalPrice) && finalPrice > 0) ? finalPrice :
          (askingPrice && askingPrice > 0) ? askingPrice :
          null; // Don't show a price if we don't have actual pricing data
        const age_hours = (Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60);

        const vehicleId = String(v?.id || '');
        
        // Prioritize thumbnail/medium variants for grid performance
        const thumbnailUrl = thumbnailByVehicleId.get(vehicleId) || null;
        const mediumUrl = mediumByVehicleId.get(vehicleId) || null;
        
        // Fallback chain: thumbnail -> medium -> primary_image_url -> image_url
        const optimalImageUrl = thumbnailUrl || mediumUrl || 
          normalizeSupabaseStorageUrl(v.primary_image_url) ||
          normalizeSupabaseStorageUrl(v.image_url) ||
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
          tier: 'C',
          tier_label: 'Tier C'
        };
      });

      // Keep original order (most recent first) - no hype score sorting
      const sorted = processed;
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


  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
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
      const priceLabel = filters.priceMin && filters.priceMax
        ? `$${filters.priceMin.toLocaleString()}-$${filters.priceMax.toLocaleString()}`
        : filters.priceMin
        ? `$${filters.priceMin.toLocaleString()}+`
        : `-$${filters.priceMax.toLocaleString()}`;
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
    
    // Location
    if (filters.zipCode && filters.radiusMiles > 0) {
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
  
  const hasActiveFilters = getActiveFilterBadges.length > 0;

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

  // Show grid immediately - no loading state blocking
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingTop: '16px' }}>
      {/* Feed Section - No stats, no filters, just vehicles */}
      <div style={{
        maxWidth: '1600px',
        margin: '0 auto',
        padding: '0 16px'
      }}>
        {/* Sticky Filter Bar - Shows when filters are active and minimized */}
        {hasActiveFilters && filterBarMinimized && (
          <div style={{
            position: 'sticky',
            top: 0,
            background: 'var(--surface)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--border)',
            padding: '8px 12px',
            marginBottom: '12px',
            zIndex: 100,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--text)', marginRight: '4px' }}>
              {filteredVehicles.length} vehicles
            </div>
            {getActiveFilterBadges.map((badge, idx) => (
              <div
                key={idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 6px',
                  background: 'var(--grey-200)',
                  border: '1px solid var(--border)',
                  borderRadius: '2px',
                  fontSize: '7pt',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
              >
                <span>{badge.label}</span>
                {badge.onRemove && (
                  <button
                    onClick={badge.onRemove}
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
            ))}
            <button
              onClick={() => {
                setFilterBarMinimized(false);
                setShowFilters(true);
              }}
              style={{
                marginLeft: 'auto',
                padding: '2px 6px',
                fontSize: '7pt',
                border: '1px solid var(--border)',
                background: 'var(--grey-200)',
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

        {/* Show Filters Button - only when filters are hidden and no active filters */}
        {!showFilters && !hasActiveFilters && (
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

        {/* Filter Panel - Collapsible with integrated header */}
        {showFilters && (
          <div style={{
            background: 'var(--white)',
            border: '1px solid var(--border)',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '8pt'
          }}>
            {/* Header with vehicle count and controls */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--border)'
            }}>
              <div style={{ fontSize: '9pt', fontWeight: 700, color: 'var(--text)' }}>
                {filteredVehicles.length} vehicles
              </div>
              
              {/* Thermal Pricing Toggle */}
              <button
                onClick={() => setThermalPricing(!thermalPricing)}
                style={{
                  padding: '4px 8px',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  background: thermalPricing ? 'var(--grey-600)' : 'var(--white)',
                  color: thermalPricing ? 'var(--white)' : 'var(--text)',
                  cursor: 'pointer',
                  borderRadius: '2px',
                  transition: 'all 0.12s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontFamily: '"MS Sans Serif", sans-serif'
                }}
                title="Thermal Pricing: Red = Good Deal, Purple = Bad Price"
              >
                <span>🔥</span>
                <span>Thermal</span>
              </button>
              
              {/* Hide Filters Button */}
              <button
                onClick={() => {
                  setShowFilters(false);
                  if (hasActiveFilters) {
                    setFilterBarMinimized(true);
                  }
                }}
                style={{
                  padding: '4px 8px',
                  fontSize: '8pt',
                  border: '1px solid var(--border)',
                  background: 'var(--grey-600)',
                  color: 'var(--white)',
                  cursor: 'pointer',
                  borderRadius: '2px',
                  fontFamily: '"MS Sans Serif", sans-serif',
                  marginLeft: 'auto'
                }}
              >
                Hide Filters
              </button>
            </div>
            
            {/* Year Quick Filters - Collapsible */}
            <div style={{ marginBottom: '12px' }}>
              <div 
                onClick={() => toggleCollapsedSection('yearQuickFilters')}
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  marginBottom: '8px',
                  paddingBottom: '4px',
                  borderBottom: '1px solid var(--border)'
                }}
              >
                <span>Year Quick Filters</span>
                <span>{collapsedSections.yearQuickFilters ? '▼' : '▲'}</span>
              </div>
              {!collapsedSections.yearQuickFilters && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
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
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isActive) {
                            setFilters({ ...filters, yearMin: null, yearMax: null });
                          } else {
                            setFilters({ ...filters, yearMin: range.min, yearMax: range.max });
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '8pt',
                          border: '1px solid var(--border)',
                          background: isActive ? 'var(--grey-600)' : 'var(--white)',
                          color: isActive ? 'var(--white)' : 'var(--text)',
                          cursor: 'pointer',
                          borderRadius: '2px',
                          fontFamily: '"MS Sans Serif", sans-serif'
                        }}
                      >
                        {range.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Full filter controls */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '12px'
            }}>
              {/* Year Range - Manual Input */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Year Range (Manual)</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Min"
                    value={filters.yearMin || ''}
                    onChange={(e) => setFilters({...filters, yearMin: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt',
                      fontFamily: '"MS Sans Serif", sans-serif'
                    }}
                  />
                  <span>–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Max"
                    value={filters.yearMax || ''}
                    onChange={(e) => setFilters({...filters, yearMax: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt',
                      fontFamily: '"MS Sans Serif", sans-serif'
                    }}
                  />
                </div>
              </div>

              {/* Price Range - Collapsible */}
              <div>
                <div 
                  onClick={() => toggleCollapsedSection('priceFilters')}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    marginBottom: '4px'
                  }}
                >
                  <label style={{ margin: 0, cursor: 'pointer' }}>Price Range</label>
                  <span style={{ fontSize: '8pt' }}>{collapsedSections.priceFilters ? '▼' : '▲'}</span>
                </div>
                {!collapsedSections.priceFilters && (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Min"
                      value={filters.priceMin || ''}
                      onChange={(e) => setFilters({...filters, priceMin: e.target.value ? parseInt(e.target.value) : null})}
                      style={{
                        width: '80px',
                        padding: '4px 6px',
                        border: '1px solid var(--border)',
                        fontSize: '8pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    />
                    <span>–</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Max"
                      value={filters.priceMax || ''}
                      onChange={(e) => setFilters({...filters, priceMax: e.target.value ? parseInt(e.target.value) : null})}
                      style={{
                        width: '80px',
                        padding: '4px 6px',
                        border: '1px solid var(--border)',
                        fontSize: '8pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Location Filter - Collapsible */}
              <div>
                <div 
                  onClick={() => toggleCollapsedSection('locationFilters')}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    marginBottom: '4px'
                  }}
                >
                  <label style={{ margin: 0, cursor: 'pointer' }}>Location</label>
                  <span style={{ fontSize: '8pt' }}>{collapsedSections.locationFilters ? '▼' : '▲'}</span>
                </div>
                {!collapsedSections.locationFilters && (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}>
                    <input
                      type="text"
                      placeholder="ZIP code"
                      value={filters.zipCode}
                      onChange={(e) => setFilters({...filters, zipCode: e.target.value})}
                      maxLength={5}
                      style={{
                        width: '70px',
                        padding: '4px 6px',
                        border: '1px solid var(--border)',
                        fontSize: '8pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    />
                    <span>within</span>
                    <select
                      value={filters.radiusMiles}
                      onChange={(e) => setFilters({...filters, radiusMiles: parseInt(e.target.value)})}
                      style={{
                        padding: '4px 6px',
                        border: '1px solid var(--border)',
                        fontSize: '8pt',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                    >
                      <option value="10">10 mi</option>
                      <option value="25">25 mi</option>
                      <option value="50">50 mi</option>
                      <option value="100">100 mi</option>
                      <option value="250">250 mi</option>
                      <option value="500">500 mi</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Make Filter */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Make</label>
                <input
                  type="text"
                  placeholder="Ford, Chevy, etc"
                  value={filters.makes.join(', ')}
                  onChange={(e) => {
                    const makes = e.target.value.split(',').map(m => m.trim()).filter(m => m.length > 0);
                    setFilters({...filters, makes});
                  }}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    border: '1px solid var(--border)',
                    fontSize: '8pt',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                />
              </div>

              {/* Status & Display Toggles - Collapsible */}
              <div>
                <div 
                  onClick={() => toggleCollapsedSection('statusFilters')}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    marginBottom: '4px'
                  }}
                >
                  <label style={{ margin: 0, cursor: 'pointer' }}>Status</label>
                  <span style={{ fontSize: '8pt' }}>{collapsedSections.statusFilters ? '▼' : '▲'}</span>
                </div>
                {!collapsedSections.statusFilters && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '4px' }}>
                      <input
                        type="checkbox"
                        checked={filters.forSale}
                        onChange={(e) => setFilters({...filters, forSale: e.target.checked})}
                      />
                      <span>For Sale Only</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '4px' }}>
                      <input
                        type="checkbox"
                        checked={filters.hideSold}
                        onChange={(e) => setFilters({ ...filters, hideSold: e.target.checked })}
                      />
                      <span>Hide Sold</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '4px' }}>
                      <input
                        type="checkbox"
                        checked={filters.showPending}
                        onChange={(e) => {
                          setFilters({...filters, showPending: e.target.checked});
                        }}
                      />
                      <span>Show Pending Vehicles</span>
                    </label>
                  </>
                )}
              </div>

              {/* Source Filters - Collapsible Section */}
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)', gridColumn: '1 / -1' }}>
                <div 
                  onClick={() => toggleCollapsedSection('sourceFilters')}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    marginBottom: '8px',
                    paddingBottom: '4px'
                  }}
                >
                  <span>Source Filters</span>
                  <span>{collapsedSections.sourceFilters ? '▼' : '▲'}</span>
                </div>
                {!collapsedSections.sourceFilters && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={filters.hideDealerListings}
                        onChange={(e) => setFilters({ ...filters, hideDealerListings: e.target.checked })}
                      />
                      <span>Hide dealer listings (CL + dealer sites + KSL)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={filters.hideCraigslist}
                        onChange={(e) => setFilters({ ...filters, hideCraigslist: e.target.checked })}
                      />
                      <span>Hide Craigslist (CL)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={filters.hideDealerSites}
                        onChange={(e) => setFilters({ ...filters, hideDealerSites: e.target.checked })}
                      />
                      <span>Hide dealer websites</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={filters.hideKsl}
                        onChange={(e) => setFilters({ ...filters, hideKsl: e.target.checked })}
                      />
                      <span>Hide KSL</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={filters.hideBat}
                        onChange={(e) => setFilters({ ...filters, hideBat: e.target.checked })}
                      />
                      <span>Hide BaT</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={filters.hideClassic}
                        onChange={(e) => setFilters({ ...filters, hideClassic: e.target.checked })}
                      />
                      <span>Hide Classic.com</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Info-dense toggle */}
              <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={infoDense}
                    onChange={(e) => setInfoDense(e.target.checked)}
                  />
                  <span>Info-dense</span>
                </label>
              </div>

              {/* Sort By */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    border: '1px solid var(--border)',
                    fontSize: '8pt',
                    marginBottom: '4px',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="year">Year</option>
                  <option value="make">Make</option>
                  <option value="model">Model</option>
                  <option value="mileage">Mileage</option>
                  <option value="price_high">Price (High to Low)</option>
                  <option value="price_low">Price (Low to High)</option>
                  <option value="popular">Most Popular</option>
                  <option value="images">Most Images</option>
                  <option value="events">Most Events</option>
                  <option value="views">Most Views</option>
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={sortDirection === 'desc'}
                    onChange={(e) => setSortDirection(e.target.checked ? 'desc' : 'asc')}
                  />
                  <span>Descending</span>
                </label>
              </div>

              {/* Clear Filters */}
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  onClick={() => {
                    setFilters(DEFAULT_FILTERS);
                    setSearchText('');
                  }}
                  style={{
                    padding: '4px 12px',
                    background: 'var(--white)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    fontWeight: 'bold',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                >
                  Reset
                </button>
              </div>
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
                              objectFit: 'cover',
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
                  thermalPricing={thermalPricing}
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
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
            gap: '8px'
        }}>
            {filteredVehicles.map((vehicle) => (
              <VehicleCardDense
                key={vehicle.id}
                vehicle={vehicle}
                viewMode="grid"
                cardSizePx={cardMinWidth}
                infoDense={false}
                viewerUserId={session?.user?.id}
                thermalPricing={thermalPricing}
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
