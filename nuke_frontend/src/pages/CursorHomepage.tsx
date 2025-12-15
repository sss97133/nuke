import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, SUPABASE_URL } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { UserInteractionService } from '../services/userInteractionService';
import VehicleSearch from '../components/VehicleSearch';

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
  zipCode: string;
  radiusMiles: number;
  showPrices: boolean;
  showDetailOverlay: boolean;
  showPending: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  yearMin: null,
  yearMax: null,
  makes: [],
  priceMin: null,
  priceMax: null,
  // Hide “F-tier” no-image profiles by default (still discoverable via search / toggles).
  hasImages: true,
  forSale: false,
  // Homepage should focus on active listings; sold inventory can be toggled back on.
  hideSold: true,
  zipCode: '',
  radiusMiles: 50,
  showPrices: true,
  showDetailOverlay: true,
  showPending: false
};

const CursorHomepage: React.FC = () => {
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('AT');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(true);
  const [timePeriodCollapsed, setTimePeriodCollapsed] = useState(false);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState<string>('');
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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
  const navigate = useNavigate();


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

        // Minimize filter bar after scrolling down 200px (if filters are shown)
        // Only auto-minimize, don't auto-expand (let user control expansion)
        if (showFilters && currentScrollY > 200 && !filterBarMinimized) {
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
  }, [showFilters]);

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
    // Load accurate stats from database
    loadAccurateStats();
    // Refresh stats every 30 seconds
    const statsInterval = setInterval(loadAccurateStats, 30000);
    
    // Load feed for all users (authenticated and unauthenticated)
    // Public vehicles (is_public=true) are visible to everyone
    loadHypeFeed();
    
    return () => clearInterval(statsInterval);
  }, [timePeriod, filters.showPending]);

  // Also reload when session changes (user logs in/out)
  useEffect(() => {
    if (session !== null) {
      loadHypeFeed();
    }
  }, [session]);


  // Apply filters and sorting whenever vehicles or settings change
  useEffect(() => {
    applyFiltersAndSort();
  }, [feedVehicles, filters, sortBy, sortDirection, debouncedSearchText]);

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

  const loadHypeFeed = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get vehicles for feed (keep payload small; avoid heavy origin_metadata + bulk image joins here).
      let query = supabase
        .from('vehicles')
        .select(`
          id, year, make, model, title, vin, created_at, updated_at,
          sale_price, current_value, purchase_price, asking_price,
          sale_date, sale_status,
          is_for_sale, mileage, status, is_public, primary_image_url, image_url, origin_organization_id
        `)
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(200);

      if (!filters.showPending) {
        query = query.neq('status', 'pending');
      }

      // Server-side time filtering (avoid fetching 200 then filtering in JS).
      const timeFilter = getTimePeriodFilter();
      if (timeFilter) {
        query = query.gte('updated_at', timeFilter);
      }

      const { data: vehicles, error } = await query;

      if (error) {
        console.error('❌ Error loading vehicles:', error);
        setError(`Failed to load vehicles: ${error.message}`);
        setFeedVehicles([]);
        return;
      }

      if (!vehicles || vehicles.length === 0) {
        setFeedVehicles([]);
        return;
      }

      // Process vehicles with lightweight image data (vehicles table fields only).
      // This is the biggest feed perf win: avoid pulling 1000+ vehicle_images rows during homepage load.
      const processed = (vehicles || []).map((v: any) => {
        const salePrice = v.sale_price ? Number(v.sale_price) : 0;
        const askingPrice = v.asking_price ? Number(v.asking_price) : 0;
        const currentValue = v.current_value ? Number(v.current_value) : 0;

        const displayPrice = salePrice > 0 ? salePrice : askingPrice > 0 ? askingPrice : currentValue;
        const age_hours = (Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60);

        const primaryImageUrl =
          normalizeSupabaseStorageUrl(v.primary_image_url) ||
          normalizeSupabaseStorageUrl(v.image_url) ||
          null;

        const allImages = primaryImageUrl
          ? [{ id: `row-${v.id}-0`, url: primaryImageUrl, is_primary: true }]
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
          image_count: allImages?.length || (primaryImageUrl ? 1 : 0),
          view_count: 0,
          event_count: 0,
          activity_7d: 0,
          hype_score: hypeScore,
          hype_reason: hypeReason,
          primary_image_url: primaryImageUrl,
          image_url: primaryImageUrl,
          all_images: allImages || (primaryImageUrl ? [{ id: `fallback-${v.id}-0`, url: primaryImageUrl, is_primary: true }] : []),
          tier: 'C',
          tier_label: 'Tier C'
        };
      });

      const sorted = processed.sort((a, b) => (b.hype_score || 0) - (a.hype_score || 0));
      setFeedVehicles(sorted);

    } catch (error: any) {
      console.error('❌ Unexpected error loading feed:', error);
      setError(`Unexpected error: ${error?.message || 'Unknown error'}`);
      setFeedVehicles([]);
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
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
        const isSold = salePrice > 0 || Boolean(saleDate) || saleStatus === 'sold';
        return !isSold;
      });
    }
    
    // Location filter (ZIP code + radius)
    // Note: This requires vehicles to have zip_code or GPS coordinates stored
    if (filters.zipCode && filters.zipCode.length === 5) {
      // For now, filter by exact ZIP match
      // TODO: Implement haversine distance calculation with GPS coordinates
      result = result.filter(v => {
        const vehicleZip = (v as any).zip_code || (v as any).location_zip;
        return vehicleZip === filters.zipCode;
      });
    }
    
    // Apply sorting with direction
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
        // Sort by created_at first (newest vehicles), then updated_at as fallback
        result.sort((a, b) => {
          const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
          const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
          return dir * (bTime - aTime); // Descending: newest first
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
        // TODO: Add trading volume data from share_holdings table
        result.sort((a, b) => 0); // Placeholder until we have volume data
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
        // Hype score (default)
        result.sort((a, b) => dir * ((b.hype_score || 0) - (a.hype_score || 0)));
    }
    
    setFilteredVehicles(result);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  };

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

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Stats Bar */}
      {stats.totalBuilds > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate('/market/segments')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/market/segments');
          }}
          title="Open Market Segments"
          style={{
          background: 'var(--white)',
          borderBottom: '2px solid var(--border)',
          padding: '12px var(--space-4)',
          display: 'flex',
          gap: '32px',
          justifyContent: 'center',
          fontSize: '9pt',
          color: 'var(--text-muted)',
          cursor: 'pointer'
        }}>
          <span><strong>{stats.totalBuilds.toLocaleString()}</strong> active builds</span>
          <span><strong>{formatCurrency(stats.totalValue)}</strong> in play</span>
          {stats.activeToday > 0 && <span><strong>{stats.activeToday.toLocaleString()}</strong> updated today</span>}
        </div>
      )}

      {/* Feed Section */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: 'var(--space-4)'
      }}>
        {/* Unified Header with global search */}
        <div style={{
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-4)'
        }}>
          {/* Search Bar */}
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <VehicleSearch />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-3)',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <h2 style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0 }}>
              <span style={{
                transition: 'opacity 0.3s ease',
                display: 'inline-block',
                minWidth: '80px'
              }}>
                <StaticVerbText />
              </span>
              {' '}
              <span style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                {filteredVehicles.length} vehicles
              </span>
            </h2>
            
            {/* Metrics Row */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '16px',
              flexWrap: 'wrap',
              fontSize: '8pt',
              color: 'var(--text-muted)',
              marginLeft: 'auto'
            }}>
              {(() => {
                const totalValue = filteredVehicles.reduce((sum, v) => sum + (v.display_price || 0), 0);
                const avgValue = filteredVehicles.length > 0 ? totalValue / filteredVehicles.length : 0;
                const forSaleCount = filteredVehicles.filter(v => v.is_for_sale).length;
                const totalImages = filteredVehicles.reduce((sum, v) => sum + (v.image_count || 0), 0);
                const totalEvents = filteredVehicles.reduce((sum, v) => sum + (v.event_count || 0), 0);
                const totalViews = filteredVehicles.reduce((sum, v) => sum + (v.view_count || 0), 0);
                
                return (
                  <>
                    {totalValue > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{formatCurrency(totalValue)}</strong> total value
                      </span>
                    )}
                    {avgValue > 0 && filteredVehicles.length > 1 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{formatCurrency(avgValue)}</strong> avg
                      </span>
                    )}
                    {forSaleCount > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{forSaleCount}</strong> for sale
                      </span>
                    )}
                    {totalImages > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{totalImages.toLocaleString()}</strong> images
                      </span>
                    )}
                    {totalEvents > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{totalEvents.toLocaleString()}</strong> events
                      </span>
                    )}
                    {totalViews > 0 && (
                      <span>
                        <strong style={{ color: 'var(--text)' }}>{totalViews.toLocaleString()}</strong> views
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
            
          {/* Controls Row */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border)',
            paddingTop: 'var(--space-2)'
          }}>
            {/* Time Period Selector - Collapsible */}
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {[
                { id: 'ALL', label: 'All Time' },
                { id: 'AT', label: 'Active' },
                { id: '1Y', label: 'Yr' },
                { id: 'Q', label: 'Qtr' },
                { id: 'W', label: 'Wk' },
                { id: 'D', label: 'Day' },
                { id: 'RT', label: 'Live' }
              ].map(period => {
                const isSelected = timePeriod === period.id;
                const shouldShow = !timePeriodCollapsed || isSelected;
                
                return (
                  <button
                    key={period.id}
                    onClick={() => {
                      if (isSelected) {
                        setTimePeriodCollapsed(!timePeriodCollapsed);
                      } else {
                        handleTimePeriodChange(period.id as TimePeriod);
                        setTimePeriodCollapsed(false);
                      }
                    }}
                    style={{
                      background: isSelected ? 'var(--grey-600)' : 'var(--white)',
                      color: isSelected ? 'var(--white)' : 'var(--text)',
                      border: '1px solid var(--border)',
                      padding: '3px 6px',
                      fontSize: '7pt',
                      cursor: 'pointer',
                      fontWeight: isSelected ? 'bold' : 'normal',
                      transition: 'all 0.12s',
                      display: shouldShow ? 'inline-block' : 'none'
                    }}
                  >
                    {period.label}
                  </button>
                );
              })}
            </div>

            {/* View Mode Switcher */}
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {(['gallery', 'grid', 'technical'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    background: viewMode === mode ? 'var(--grey-600)' : 'var(--white)',
                    color: viewMode === mode ? 'var(--white)' : 'var(--text)',
                    border: '1px solid var(--border)',
                    padding: '4px 8px',
                    fontSize: '8pt',
                    cursor: 'pointer',
                    fontWeight: viewMode === mode ? 'bold' : 'normal',
                    transition: 'all 0.12s'
                  }}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            {/* Global Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '1 1 260px', minWidth: 220 }}>
              <input
                ref={searchInputRef}
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search year, make, model, VIN (press /)"
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  fontSize: '8pt',
                  background: 'var(--white)'
                }}
              />
              {searchText.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  style={{
                    border: '1px solid var(--border)',
                    background: 'var(--white)',
                    padding: '4px 8px',
                    fontSize: '8pt',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Filters Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                background: showFilters ? 'var(--grey-600)' : 'var(--white)',
                color: showFilters ? 'var(--white)' : 'var(--text)',
                border: '1px solid var(--border)',
                padding: '4px 8px',
                fontSize: '8pt',
                cursor: 'pointer',
                fontWeight: showFilters ? 'bold' : 'normal',
                transition: 'background 0.12s, color 0.12s'
              }}
            >
              Filters {activeFilterCount > 0 && '●'}
            </button>
          </div>
        </div>

        {/* Filter Panel - Sticky with minimize */}
        {showFilters && (
          <div style={{ 
            position: 'sticky',
            top: 0,
            background: filterBarMinimized ? 'var(--surface-glass)' : 'var(--surface)',
            backdropFilter: filterBarMinimized ? 'blur(10px)' : 'none',
            border: '1px solid var(--border)',
            padding: filterBarMinimized ? '8px 12px' : '12px',
            marginBottom: '12px',
            zIndex: 100,
            boxShadow: filterBarMinimized ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
            transition: 'padding 0.2s ease, background 0.2s ease',
            opacity: 1
          }}>
            {/* Collapsible header bar */}
            <div 
              onClick={() => setFilterBarMinimized(!filterBarMinimized)}
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                cursor: 'pointer',
                fontSize: '8pt',
                fontWeight: 'bold',
                marginBottom: filterBarMinimized ? 0 : '8px',
                paddingBottom: filterBarMinimized ? 0 : '4px',
                borderBottom: filterBarMinimized ? 'none' : '1px solid var(--border)'
              }}
            >
              <span>Filters {filterBarMinimized && `Active (${activeFilterCount})`}</span>
              <span style={{ fontSize: '10pt' }}>{filterBarMinimized ? '▲' : '▼'}</span>
            </div>
            
            {/* Full filter controls */}
            <div style={{ 
              display: filterBarMinimized ? 'none' : 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '12px', 
              fontSize: '8pt' 
            }}>
              {/* Year Range */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Year Range</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.yearMin || ''}
                    onChange={(e) => setFilters({...filters, yearMin: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.yearMax || ''}
                    onChange={(e) => setFilters({...filters, yearMax: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                </div>
              </div>

              {/* Price Range */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Price Range</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.priceMin || ''}
                    onChange={(e) => setFilters({...filters, priceMin: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '80px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.priceMax || ''}
                    onChange={(e) => setFilters({...filters, priceMax: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '80px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                </div>
              </div>

              {/* Location Filter */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Location</label>
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
                      fontSize: '8pt'
                    }}
                  />
                  <span>within</span>
                  <select
                    value={filters.radiusMiles}
                    onChange={(e) => setFilters({...filters, radiusMiles: parseInt(e.target.value)})}
                    style={{
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
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
                    fontSize: '8pt'
                  }}
                />
              </div>

              {/* Status & Display Toggles */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Status</label>
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
                <div style={{ marginTop: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: '2px' }}>
                    <input
                      type="checkbox"
                      checked={filters.showPrices}
                      onChange={(e) => setFilters({ ...filters, showPrices: e.target.checked })}
                    />
                    <span>Show Prices</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={filters.showDetailOverlay}
                      onChange={(e) => setFilters({ ...filters, showDetailOverlay: e.target.checked })}
                    />
                    <span>Show Detail Card</span>
                  </label>
                </div>
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
                    marginBottom: '4px'
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
                    fontWeight: 'bold'
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
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
                  showPriceOverlay={filters.showPrices}
                  showDetailOverlay={filters.showDetailOverlay}
                />
            ))}
          </div>
        )}

        {/* Grid View - Instagram-style with zero spacing */}
        {viewMode === 'grid' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '0'
        }}>
            {filteredVehicles.map((vehicle) => (
              <VehicleCardDense
                key={vehicle.id}
                vehicle={vehicle}
                viewMode="grid"
                showPriceOverlay={filters.showPrices}
                showDetailOverlay={filters.showDetailOverlay}
              />
          ))}
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
