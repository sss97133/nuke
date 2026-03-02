import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

export interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isFocused: boolean;
  setIsFocused: (focused: boolean) => void;
  autocompleteResults: AutocompleteResult[];
  autocompleteLoading: boolean;
  browseResults: BrowseResult[];
  browseLoading: boolean;
  browseStats: BrowseStatsData | null;
  totalCount: number;
  executeBrowse: (params: BrowseParams) => Promise<void>;
  executeAutocomplete: (prefix: string) => Promise<void>;
  executeSmart: (query: string) => Promise<SmartResult[]>;
  clear: () => void;
}

export interface AutocompleteResult {
  category: string;
  label: string;
  value: string;
  count: number;
}

export interface BrowseResult {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  status: string | null;
  source: string | null;
  sold_price: number | null;
  primary_image_url: string | null;
  era: string | null;
  body_style: string | null;
  total_count: number;
}

export interface BrowseStatsData {
  total: number;
  with_images: number;
  with_price: number;
  avg_price: number | null;
  by_source: Array<{ source: string; count: number }>;
  by_era: Array<{ era: string; count: number }>;
  by_model: Array<{ model: string; count: number }>;
}

export interface BrowseParams {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  status?: string;
  source?: string;
  era?: string;
  bodyStyle?: string;
  hasImage?: boolean;
  hasPrice?: boolean;
  color?: string;
  sortBy?: string;
  sortDir?: string;
  page?: number;
  pageSize?: number;
}

export interface SmartResult {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  status: string | null;
  source: string | null;
  sold_price: number | null;
  primary_image_url: string | null;
  relevance: number;
}

export function useSearch(): SearchState {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState<AutocompleteResult[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [browseResults, setBrowseResults] = useState<BrowseResult[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseStats, setBrowseStats] = useState<BrowseStatsData | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const debounceRef = useRef<number | null>(null);

  // Auto-debounce autocomplete on query change
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setAutocompleteResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      executeAutocomplete(query.trim());
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const executeAutocomplete = useCallback(async (prefix: string) => {
    setAutocompleteLoading(true);
    try {
      const { data, error } = await supabase.rpc('search_autocomplete', {
        p_prefix: prefix,
        p_limit: 10,
      });
      if (error) throw error;
      setAutocompleteResults((data || []).map((r: any) => ({
        category: r.category,
        label: r.label,
        value: r.value,
        count: Number(r.count) || 0,
      })));
    } catch (err) {
      console.warn('Autocomplete error:', err);
      setAutocompleteResults([]);
    } finally {
      setAutocompleteLoading(false);
    }
  }, []);

  const executeBrowse = useCallback(async (params: BrowseParams) => {
    setBrowseLoading(true);
    try {
      const rpcParams: Record<string, any> = {};
      if (params.make) rpcParams.p_make = params.make;
      if (params.model) rpcParams.p_model = params.model;
      if (params.yearMin) rpcParams.p_year_min = params.yearMin;
      if (params.yearMax) rpcParams.p_year_max = params.yearMax;
      if (params.priceMin) rpcParams.p_price_min = params.priceMin;
      if (params.priceMax) rpcParams.p_price_max = params.priceMax;
      if (params.status) rpcParams.p_status = params.status;
      if (params.source) rpcParams.p_source = params.source;
      if (params.era) rpcParams.p_era = params.era;
      if (params.bodyStyle) rpcParams.p_body_style = params.bodyStyle;
      if (params.hasImage !== undefined) rpcParams.p_has_image = params.hasImage;
      if (params.hasPrice !== undefined) rpcParams.p_has_price = params.hasPrice;
      if (params.color) rpcParams.p_color = params.color;
      if (params.sortBy) rpcParams.p_sort_by = params.sortBy;
      if (params.sortDir) rpcParams.p_sort_dir = params.sortDir;
      rpcParams.p_page = params.page || 1;
      rpcParams.p_page_size = params.pageSize || 50;

      // Fire browse + stats in parallel
      const [browseRes, statsRes] = await Promise.all([
        supabase.rpc('search_vehicles_browse', rpcParams),
        params.make ? supabase.rpc('browse_stats', { p_make: params.make }) : Promise.resolve({ data: null, error: null }),
      ]);

      if (browseRes.error) throw browseRes.error;
      const rows = browseRes.data || [];
      setBrowseResults(rows);
      setTotalCount(rows.length > 0 ? Number(rows[0].total_count) : 0);

      if (statsRes.data) {
        setBrowseStats(statsRes.data as BrowseStatsData);
      }
    } catch (err) {
      console.warn('Browse error:', err);
      setBrowseResults([]);
      setTotalCount(0);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const executeSmart = useCallback(async (q: string): Promise<SmartResult[]> => {
    try {
      const { data, error } = await supabase.rpc('search_vehicles_smart', {
        p_query: q,
        p_limit: 50,
        p_offset: 0,
      });
      if (error) throw error;
      return (data || []) as SmartResult[];
    } catch (err) {
      console.warn('Smart search error:', err);
      return [];
    }
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setAutocompleteResults([]);
    setBrowseResults([]);
    setBrowseStats(null);
    setTotalCount(0);
    setIsOpen(false);
    setIsFocused(false);
  }, []);

  return {
    query, setQuery,
    isOpen, setIsOpen,
    isFocused, setIsFocused,
    autocompleteResults, autocompleteLoading,
    browseResults, browseLoading, browseStats, totalCount,
    executeBrowse, executeAutocomplete, executeSmart,
    clear,
  };
}
