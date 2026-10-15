import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { track } from '../lib/track';
import { ingestVehicle } from '../services/aiDataIngestion';
import type { SearchResult, SearchResultType } from '../types/search';
import { parseQuery } from '../lib/search/queryParser';

/* ─── A VIN: 17 characters, no I, O or Q ─── */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

/* ─── URL detection ─── */
const URL_RE = /^https?:\/\//i;
const WWW_RE = /^www\./i;
const BARE_DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#].*)?$/i;
function looksLikeUrl(q: string): boolean {
  const t = q.trim();
  return URL_RE.test(t) || WWW_RE.test(t) || (BARE_DOMAIN_RE.test(t) && !/\s/.test(t));
}

const PLATFORM_PATTERNS: Array<{ pattern: RegExp; label: string; short: string }> = [
  { pattern: /bringatrailer\.com/i, label: 'Bring a Trailer', short: 'BAT' },
  { pattern: /carsandbids\.com/i, label: 'Cars & Bids', short: 'C&B' },
  { pattern: /mecum\.com/i, label: 'Mecum Auctions', short: 'MECUM' },
  { pattern: /barrett-jackson\.com/i, label: 'Barrett-Jackson', short: 'BJ' },
  { pattern: /rmsothebys\.com/i, label: "RM Sotheby's", short: 'RM' },
  { pattern: /bonhams\.com/i, label: 'Bonhams', short: 'BONHAMS' },
  { pattern: /pcarmarket\.com/i, label: 'PCarMarket', short: 'PCAR' },
  { pattern: /hagerty\.com/i, label: 'Hagerty', short: 'HAGERTY' },
  { pattern: /hemmings\.com/i, label: 'Hemmings', short: 'HEMMINGS' },
  { pattern: /collectingcars\.com/i, label: 'Collecting Cars', short: 'CC' },
  { pattern: /ebay\.com/i, label: 'eBay', short: 'EBAY' },
  { pattern: /facebook\.com\/marketplace/i, label: 'Facebook Marketplace', short: 'FBMP' },
  { pattern: /craigslist\.org/i, label: 'Craigslist', short: 'CL' },
  { pattern: /classiccars\.com/i, label: 'ClassicCars.com', short: 'CC' },
  { pattern: /autotrader\.com/i, label: 'AutoTrader', short: 'AT' },
];

function detectPlatform(url: string): { label: string; short: string } | null {
  for (const p of PLATFORM_PATTERNS) {
    if (p.pattern.test(url)) return { label: p.label, short: p.short };
  }
  return null;
}

export interface UrlExtraction {
  status: 'detecting' | 'extracting' | 'success' | 'error';
  url: string;
  platform: { label: string; short: string } | null;
  vehicleId?: string;
  vehicleName?: string;
  isNew?: boolean;
  error?: string;
}

export interface SearchMeta {
  total_count: number | null;
  returned_count: number;
  offset: number;
  limit: number;
  has_more: boolean;
  pagination_limited: boolean;
  next_offset: number | null;
  vehicle_source: 'ranked' | 'direct' | 'ilike' | 'year' | null;
}

const loadedSummary = (count: number, query: string, limited = false) =>
  `Loaded ${count.toLocaleString()} results for "${query}".${limited ? ' Refine your search to see more results.' : ''}`;

export interface VehicleFilters {
  make: string;
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  mileageMax: string;
  transmission: string;
  listingStatus: string;
  showFilters: boolean;
}

export interface BrowseStats {
  total: number;
  with_images: number;
  with_price: number;
  avg_price: number;
  by_source: { source: string; count: number }[];
  by_era: { era: string; count: number }[];
  by_model: { model: string; count: number; avg_price: number }[];
  /** When the counts were folded (mv_market_position), and over which vehicles; absent on the live aggregate. */
  as_of?: string | null;
  population?: string | null;
}

const DEFAULT_FILTERS: VehicleFilters = {
  make: '', priceMin: '', priceMax: '', yearMin: '', yearMax: '',
  mileageMax: '', transmission: '', listingStatus: '', showFilters: false,
};

type SearchFilter = 'all' | SearchResultType;

const TYPE_MAP: Record<string, string> = {
  vin_match: 'vehicle',
  tag: 'reference',
  external_identity: 'user',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CohortTarget {
  year: number;
  make: string;
  model: string;
  label: string;
  path: string;
}

/**
 * Parse a query into a year-make-model cohort target ("1966 Ford Mustang").
 * Requires a leading 4-digit year (1885–current+1), a make token, and at
 * least one model token. Returns null when the query isn't a clean YMM —
 * we never guess a cohort from a partial query.
 */
function parseCohort(q: string): CohortTarget | null {
  const t = q.trim();
  const m = t.match(/^(1[89]\d{2}|20\d{2})\s+([A-Za-z][A-Za-z-]*)\s+(.+?)\s*$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (year < 1885 || year > new Date().getFullYear() + 1) return null;
  const make = m[2];
  const model = m[3].trim();
  if (!model) return null;
  const slug = (s: string) => encodeURIComponent(s.toLowerCase());
  return {
    year,
    make,
    model,
    label: `${year} ${make} ${model}`,
    path: `/cohort/${slug(make)}/${slug(model)}/${year}`,
  };
}

function mapRawResult(r: any): SearchResult {
  return {
    id: r.id,
    type: (TYPE_MAP[r.type] ?? r.type) as SearchResultType,
    title: r.title || '',
    description: r.description || r.subtitle || '',
    image_url: r.image_url,
    relevance_score: r.relevance_score ?? 0,
    metadata: r.metadata ?? {},
    created_at: r.metadata?.updated_at || r.metadata?.created_at || '',
  };
}

export function useSearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';

  // Seed filters from URL params (intent router puts these in the URL)
  const urlMake = searchParams.get('make') || '';
  const urlYearMin = searchParams.get('yearMin') || '';
  const urlYearMax = searchParams.get('yearMax') || '';
  const urlPriceMin = searchParams.get('priceMin') || '';
  const urlPriceMax = searchParams.get('priceMax') || '';
  const urlColor = searchParams.get('color') || '';
  const parsedQuery = useMemo(() => parseQuery(query), [query]);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchSummary, setSearchSummary] = useState('');
  const [loading, setLoading] = useState(() => Boolean(query));
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<SearchFilter>('all');
  const lastQueryRef = useRef('');
  const loadMoreRequestRef = useRef<string | null>(null);

  // Initialize filters from URL params
  const [filters, setFilters] = useState<VehicleFilters>(() => ({
    ...DEFAULT_FILTERS,
    make: urlMake,
    yearMin: urlYearMin,
    yearMax: urlYearMax,
    priceMin: urlPriceMin || (parsedQuery.priceMin == null ? '' : String(parsedQuery.priceMin)),
    priceMax: urlPriceMax || (parsedQuery.priceMax == null ? '' : String(parsedQuery.priceMax)),
  }));

  // Direct /search links and subsequent queries must use the existing parser,
  // just as the intent router does. A prior query's budget must not linger.
  useEffect(() => {
    setFilters(previous => ({ ...previous,
      priceMin: urlPriceMin || (parsedQuery.priceMin == null ? '' : String(parsedQuery.priceMin)),
      priceMax: urlPriceMax || (parsedQuery.priceMax == null ? '' : String(parsedQuery.priceMax)),
    }));
  }, [urlPriceMin, urlPriceMax, parsedQuery.priceMin, parsedQuery.priceMax]);

  // Browse stats for context (fetched alongside results)
  const [browseStats, setBrowseStats] = useState<BrowseStats | null>(null);

  // URL extraction state
  const [urlExtraction, setUrlExtraction] = useState<UrlExtraction | null>(null);
  const urlExtractionRef = useRef<string | null>(null);

  // Detect make from query or URL params for browse_stats
  const detectedMake = useMemo(() => {
    if (urlMake) return urlMake;
    // Simple detection: if first word of query matches a known pattern
    const q = query.trim();
    if (!q) return '';
    const firstWord = q.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 3 && /^[a-zA-Z-]+$/.test(firstWord)) {
      return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    }
    return '';
  }, [query, urlMake]);

  // Execute search when query changes
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      lastQueryRef.current = '';
      setResults([]);
      setSearchSummary('');
      setSearchMeta(null);
      setLoadMoreError(null);
      setBrowseStats(null);
      setLoading(false);
      setUrlExtraction(null);
      urlExtractionRef.current = null;
      return;
    }

    if (q === lastQueryRef.current) return;
    lastQueryRef.current = q;
    loadMoreRequestRef.current = null;
    setLoadingMore(false);
    setLoadMoreError(null);
    setSearchMeta(null);

    // UUID detection — redirect to vehicle page
    if (UUID_RE.test(q)) {
      supabase
        .from('vehicles')
        .select('id')
        .eq('id', q)
        .maybeSingle()
        .then(({ data }) => {
          if (data) navigate(`/vehicle/${data.id}`, { replace: true });
        });
      return;
    }

    // URL detection — skip search, go straight to ingestion
    if (looksLikeUrl(q)) {
      const url = URL_RE.test(q) ? q : `https://${q}`;

      // Prevent duplicate extraction for same URL
      if (urlExtractionRef.current === url) return;
      urlExtractionRef.current = url;

      const platform = detectPlatform(url);
      setResults([]);
      setSearchSummary('');
      setSearchMeta(null);
      setBrowseStats(null);
      setLoading(false);
      setUrlExtraction({ status: 'extracting', url, platform });

      // Fire extraction immediately — no fake delays
      (async () => {
        try {
          const result = await ingestVehicle({ url, enrich: true });

          if (result.status === 'error' || result.status === 'rejected') {
            const errorMsg = result.status === 'rejected'
              ? `Quality too low (${result.issues?.join(', ') || 'insufficient data'})`
              : (result.error || 'Extraction failed');
            setUrlExtraction(prev => prev ? { ...prev, status: 'error', error: errorMsg } : null);
            return;
          }

          // Got a vehicle — go straight to profile, no lingering
          if (result.vehicle_id) {
            track('url_ingest', { url, ok: true });
            navigate(`/vehicle/${result.vehicle_id}`, { replace: true });
            return;
          }

          // No vehicle_id returned — show error
          setUrlExtraction(prev => prev ? {
            ...prev,
            status: 'error',
            error: 'No vehicle data found at this URL',
          } : null);
        } catch (err: any) {
          setUrlExtraction(prev => prev ? { ...prev, status: 'error', error: err.message || 'Extraction failed' } : null);
        }
      })();

      return;
    }

    // A VIN: one indexed read through vehicle_by_vin_public (public rows only, the columns a card shows).
    // universal-search filters vehicles with ilike on vin, which no index serves under the row policies:
    // the page's own suggested VIN answered "Search failed." after 60 s (2026-10-13).
    if (VIN_RE.test(q)) {
      const vin = q.toUpperCase();
      setUrlExtraction(null);
      urlExtractionRef.current = null;
      setLoading(true);
      setResultFilter('all');
      setBrowseStats(null);
      setSearchMeta(null);
      Promise.resolve(supabase.rpc('vehicle_by_vin_public', { p_vin: vin })).then(({ data, error }: { data: unknown; error: unknown }) => {
        if (lastQueryRef.current !== q) return;
        if (error || !Array.isArray(data)) {
          setSearchSummary('Search failed.');
          setResults([]);
          setLoading(false);
          return;
        }
        const mapped: SearchResult[] = (data as any[]).map((v) => mapRawResult({
          id: v.id,
          type: 'vin_match',
          title: [v.year, v.make, v.model].filter(Boolean).join(' '),
          subtitle: v.vin,
          image_url: v.image_url || undefined,
          relevance_score: 1,
          metadata: {
            year: v.year, make: v.make, model: v.model, vin: v.vin, image_url: v.image_url,
            sale_price: v.sale_price, asking_price: v.asking_price, is_for_sale: v.is_for_sale, sale_status: v.sale_status,
          },
        }));
        setResults(mapped);
        setSearchSummary(mapped.length
          ? `${mapped.length} public vehicle${mapped.length === 1 ? '' : 's'} in the ledger with VIN ${vin}.`
          : `No public vehicle with VIN ${vin} in the ledger.`);
        track('search_results', { q, loaded_count: mapped.length, total: mapped.length });
        setLoading(false);
      }, () => {
        if (lastQueryRef.current !== q) return;
        setSearchSummary('Search failed.');
        setResults([]);
        setLoading(false);
      });
      return;
    }

    // Not a URL or a VIN — clear extraction state and do normal search
    setUrlExtraction(null);
    urlExtractionRef.current = null;
    setLoading(true);
    setResultFilter('all');

    // Fire search + browse_stats in parallel — but NEVER gate results on stats.
    // browse_stats was measured live at 15s + statement-timeout 500
    // (2026-06-10); awaiting it in Promise.all held the entire results page
    // hostage on every make query. Stats now fill in whenever they arrive.
    const searchPromise = supabase.functions.invoke('universal-search', {
      body: { query: q, limit: 100, ...(parsedQuery.priceMin != null || parsedQuery.priceMax != null ? { includeAI: false } : {}) },
    });

    setBrowseStats(null);
    if (detectedMake) {
      supabase.rpc('browse_stats', { p_make: detectedMake })
        .then(({ data }: { data: unknown }) => {
          if (data) setBrowseStats(data as BrowseStats);
        }, () => { /* stats are decoration — never surface their failures */ });
    }

    searchPromise.then((searchRes) => {
      if (lastQueryRef.current !== q) return;
      const { data, error } = searchRes;

      if (error || !data || data.success === false || !Array.isArray(data.results)) {
        setSearchSummary('Search failed.');
        setResults([]);
        setLoading(false);
        return;
      }

      const mapped: SearchResult[] = data.results.map(mapRawResult);
      // Prioritize results with images — users see photos, not placeholders
      mapped.sort((a, b) => (b.image_url ? 1 : 0) - (a.image_url ? 1 : 0));
      setResults(mapped);

      setSearchSummary(loadedSummary(mapped.length, q, data.meta?.pagination_limited === true));
      setSearchMeta(data.meta || null);
      // Funnel: the first-query moment. Zero-result queries are the gap list.
      track('search_results', { q, loaded_count: mapped.length, total: data.meta?.total_count ?? null });

      setLoading(false);
    }).catch(() => {
      if (lastQueryRef.current !== q) return;
      setSearchSummary('Search failed.');
      setResults([]); setSearchMeta(null); setLoading(false);
    });
  }, [query, navigate, detectedMake, parsedQuery.priceMin, parsedQuery.priceMax]);

  // Load more results
  const handleLoadMore = useCallback(async () => {
    if (!searchMeta || !searchMeta.has_more || loadingMore || loadMoreRequestRef.current) return;
    const q = query.trim(), nextOffset = searchMeta.next_offset;
    if (searchMeta.pagination_limited) {
      setSearchSummary(loadedSummary(results.length, q, true));
      return;
    }
    if (!Number.isSafeInteger(nextOffset) || nextOffset == null || nextOffset <= searchMeta.offset || !searchMeta.vehicle_source) {
      setLoadMoreError('More results could not be loaded. Try again.');
      setSearchSummary(`${loadedSummary(results.length, q)} More results could not be loaded. Try again.`);
      return;
    }
    const requestKey = `${q}/${nextOffset}`;
    loadMoreRequestRef.current = requestKey;
    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const { data, error } = await supabase.functions.invoke('universal-search', {
        body: { query: q, limit: 100, offset: nextOffset, vehicle_source: searchMeta.vehicle_source,
          ...(parsedQuery.priceMin != null || parsedQuery.priceMax != null ? { includeAI: false } : {}) },
      });

      if (lastQueryRef.current !== q) return;
      if (error || data?.success === false || !Array.isArray(data?.results) || !data.meta || data.meta.offset !== nextOffset ||
        data.meta.vehicle_source !== searchMeta.vehicle_source || typeof data.meta.has_more !== 'boolean' ||
        (data.meta.pagination_limited === true
          ? !data.meta.has_more || data.meta.next_offset !== null
          : data.meta.has_more ? !Number.isSafeInteger(data.meta.next_offset) || data.meta.next_offset <= nextOffset : data.meta.next_offset !== null)) {
        throw new Error('Search page failed');
      }
      const newResults = (data.results as any[]).map(mapRawResult);
      const existingIds = new Set(results.map(r => r.id));
      const unique = newResults.filter(r => !existingIds.has(r.id));
      setResults(prev => [...prev, ...unique]);
      setSearchMeta(data.meta);
      setSearchSummary(loadedSummary(results.length + unique.length, q, data.meta.pagination_limited === true));
    } catch {
      if (lastQueryRef.current === q) {
        setLoadMoreError('More results could not be loaded. Try again.');
        setSearchSummary(`${loadedSummary(results.length, q)} More results could not be loaded. Try again.`);
      }
    } finally {
      if (loadMoreRequestRef.current === requestKey) { loadMoreRequestRef.current = null; setLoadingMore(false); }
    }
  }, [searchMeta, loadingMore, query, results, parsedQuery.priceMin, parsedQuery.priceMax]);

  // Apply vehicle filters to results
  const displayResults = useMemo(() => {
    const anyActive =
      filters.make || filters.priceMin || filters.priceMax ||
      filters.yearMin || filters.yearMax || filters.mileageMax ||
      filters.transmission || filters.listingStatus;

    if (!anyActive) return results;

    return results.filter(r => {
      if (r.type !== 'vehicle') return true;
      const m = r.metadata as any;

      if (filters.make && !String(m.make || '').toLowerCase().includes(filters.make.trim().toLowerCase())) return false;
      // Match the card's recorded price precedence. Unknown or invalid amounts
      // cannot pass a budget by falling through a missing sale_price.
      const rawPrice = m.sale_price || m.current_value || m.asking_price;
      const price = rawPrice == null || String(rawPrice).trim() === '' ? NaN : Number(rawPrice);
      if (filters.priceMin) { const v = Number(filters.priceMin); if (Number.isFinite(v) && (!Number.isFinite(price) || price <= 0 || price < v)) return false; }
      if (filters.priceMax) { const v = Number(filters.priceMax); if (Number.isFinite(v) && (!Number.isFinite(price) || price <= 0 || price > v)) return false; }
      if (filters.yearMin) { const v = parseInt(filters.yearMin, 10); if (!isNaN(v) && (m.year == null || m.year < v)) return false; }
      if (filters.yearMax) { const v = parseInt(filters.yearMax, 10); if (!isNaN(v) && m.year != null && m.year > v) return false; }
      if (filters.mileageMax) { const v = parseInt(filters.mileageMax, 10); if (!isNaN(v) && m.mileage != null && m.mileage > v) return false; }
      if (filters.transmission) {
        const t = String(m.transmission || '').toLowerCase();
        if (filters.transmission === 'automatic' && !t.includes('auto')) return false;
        if (filters.transmission === 'manual' && !(t.includes('manual') || t.includes('stick') || /[3-6]-speed/.test(t))) return false;
      }
      if (filters.listingStatus === 'for_sale' && !m.is_for_sale) return false;
      if (filters.listingStatus === 'sold' && m.is_for_sale !== false) return false;

      return true;
    });
  }, [results, filters]);

  const vehicleCount = results.filter(r => r.type === 'vehicle').length;
  const displayVehicleCount = displayResults.filter(r => r.type === 'vehicle').length;

  // Cohort terminal target — only when the query is a clean year-make-model.
  const cohortTarget = useMemo(() => parseCohort(query), [query]);

  return {
    query,
    cohortTarget,
    results,
    displayResults,
    loading,
    searchSummary,
    filters,
    setFilters,
    vehicleCount,
    displayVehicleCount,
    resultFilter,
    setResultFilter,
    searchMeta,
    handleLoadMore,
    loadingMore,
    loadMoreError,
    browseStats,
    detectedMake,
    urlExtraction,
  };
}
