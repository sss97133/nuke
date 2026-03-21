import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { SearchResult, SearchResultType } from '../types/search';

export interface SearchMeta {
  total_count: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

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
}

const DEFAULT_FILTERS: VehicleFilters = {
  make: '', priceMin: '', priceMax: '', yearMin: '', yearMax: '',
  mileageMax: '', transmission: '', listingStatus: '', showFilters: true,
};

type SearchFilter = 'all' | SearchResultType;

const TYPE_MAP: Record<string, string> = {
  vin_match: 'vehicle',
  tag: 'reference',
  external_identity: 'user',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchSummary, setSearchSummary] = useState('');
  const [loading, setLoading] = useState(() => Boolean(query));
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resultFilter, setResultFilter] = useState<SearchFilter>('all');
  const lastQueryRef = useRef('');

  // Initialize filters from URL params
  const [filters, setFilters] = useState<VehicleFilters>(() => ({
    ...DEFAULT_FILTERS,
    make: urlMake,
    yearMin: urlYearMin,
    yearMax: urlYearMax,
    priceMin: urlPriceMin,
    priceMax: urlPriceMax,
  }));

  // Browse stats for context (fetched alongside results)
  const [browseStats, setBrowseStats] = useState<BrowseStats | null>(null);

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
      setResults([]);
      setSearchSummary('');
      setSearchMeta(null);
      setBrowseStats(null);
      setLoading(false);
      return;
    }

    if (q === lastQueryRef.current) return;
    lastQueryRef.current = q;

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

    setLoading(true);
    setResultFilter('all');

    // Fire search + browse_stats in parallel
    const searchPromise = supabase.functions.invoke('universal-search', {
      body: { query: q, limit: 100 },
    });

    // Fetch browse stats if we detected a make
    const statsPromise = detectedMake
      ? supabase.rpc('browse_stats', { p_make: detectedMake }).then(({ data }) => data)
      : Promise.resolve(null);

    Promise.all([searchPromise, statsPromise]).then(([searchRes, stats]) => {
      const { data, error } = searchRes;

      if (error || !data) {
        setSearchSummary('Search failed.');
        setResults([]);
        setLoading(false);
        return;
      }

      const mapped = (data.results || []).map(mapRawResult);
      setResults(mapped);

      const total = data.meta?.total_count ?? mapped.length;
      setSearchSummary(`Found ${total.toLocaleString()} results for "${q}".`);
      setSearchMeta(data.meta || null);

      if (stats) setBrowseStats(stats as BrowseStats);
      else setBrowseStats(null);

      setLoading(false);
    });
  }, [query, navigate, detectedMake]);

  // Load more results
  const handleLoadMore = useCallback(async () => {
    if (!searchMeta || !searchMeta.has_more || loadingMore) return;
    setLoadingMore(true);

    try {
      const { data, error } = await supabase.functions.invoke('universal-search', {
        body: { query: query.trim(), limit: 100, offset: searchMeta.offset + searchMeta.limit },
      });

      if (!error && data?.results) {
        const newResults = (data.results as any[]).map(mapRawResult);
        const existingIds = new Set(results.map(r => r.id));
        const unique = newResults.filter(r => !existingIds.has(r.id));
        setResults(prev => [...prev, ...unique]);
        if (data.meta) setSearchMeta(data.meta);
        const total = data.meta?.total_count ?? searchMeta.total_count;
        setSearchSummary(`Found ${total.toLocaleString()} results for "${query.trim()}".`);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [searchMeta, loadingMore, query, results]);

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
      if (filters.priceMin) { const v = parseInt(filters.priceMin, 10); if (!isNaN(v) && (m.sale_price == null || m.sale_price < v)) return false; }
      if (filters.priceMax) { const v = parseInt(filters.priceMax, 10); if (!isNaN(v) && m.sale_price != null && m.sale_price > v) return false; }
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

  return {
    query,
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
    browseStats,
    detectedMake,
  };
}
