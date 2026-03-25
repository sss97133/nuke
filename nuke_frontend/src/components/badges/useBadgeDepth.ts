/**
 * useBadgeDepth — Lazy-loads cluster depth + preview items + dimension stats for a BadgePortal.
 *
 * Fetches count, top 6 preview vehicles, and dimension-specific stats matching a badge's filter.
 * Only fires on hover (after 200ms debounce) so idle badges cost zero queries.
 *
 * Dimension-specific stats:
 *   make   → top models, year range
 *   source → top makes, fill rate
 *   price  → price bracket distribution (not fetched here — synthetic)
 *   model  → year range, top body styles
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';

export type BadgeDimension =
  | 'year'
  | 'make'
  | 'model'
  | 'source'
  | 'deal_score'
  | 'status'
  | 'body_style'
  | 'drivetrain'
  | 'transmission';

export interface BadgePreviewItem {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
}

/** Dimension-specific aggregate stats returned alongside previews */
export interface BadgeDimensionStats {
  avg_price: number | null;
  min_year: number | null;
  max_year: number | null;
  /** Top sub-values (models for make, makes for source, body styles for model) */
  top_facets: { label: string; count: number }[];
  /** For source dimension: data fill rates */
  fill_rates?: { field: string; pct: number }[];
  /** For price dimension: bracket distribution */
  price_brackets?: { label: string; count: number; pct: number }[];
}

export interface BadgeDepthData {
  count: number;
  preview: BadgePreviewItem[];
  stats: BadgeDimensionStats | null;
}

const COLUMN_MAP: Record<BadgeDimension, string> = {
  year: 'year',
  make: 'make',
  model: 'model',
  source: 'platform_source',
  deal_score: 'deal_score_label',
  status: 'status',
  body_style: 'canonical_body_style',
  drivetrain: 'drivetrain',
  transmission: 'transmission',
};

/** Facet column to aggregate for each dimension */
const FACET_COLUMN: Partial<Record<BadgeDimension, string>> = {
  make: 'model',
  source: 'make',
  model: 'canonical_body_style',
  body_style: 'make',
  year: 'make',
};

// Cache to avoid re-fetching the same badge across renders
const depthCache = new Map<string, BadgeDepthData>();

/**
 * Fetch top N facet values for a sub-dimension within the filtered set.
 * Returns [{label, count}] sorted by count desc.
 */
async function fetchFacets(
  filterCol: string,
  filterValue: string | number,
  facetCol: string,
  limit = 5,
): Promise<{ label: string; count: number }[]> {
  // Use a raw query via RPC or fall back to a simple group-by approximation
  // Since supabase-js doesn't support GROUP BY, we fetch the facet column values
  // and count client-side from a larger sample
  const { data } = await supabase
    .from('vehicles')
    .select(facetCol)
    .eq('is_public', true)
    .eq(filterCol, filterValue)
    .not(facetCol, 'is', null)
    .limit(500);

  if (!data || data.length === 0) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    const val = String((row as Record<string, unknown>)[facetCol] ?? '').trim();
    if (val) counts.set(val, (counts.get(val) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

/**
 * Fetch average price and year range for a filtered set.
 */
async function fetchAggregates(
  filterCol: string,
  filterValue: string | number,
): Promise<{ avg_price: number | null; min_year: number | null; max_year: number | null }> {
  // Fetch a sample of prices and years to compute aggregates client-side
  const { data } = await supabase
    .from('vehicles')
    .select('sale_price, year')
    .eq('is_public', true)
    .eq(filterCol, filterValue)
    .not('sale_price', 'is', null)
    .gt('sale_price', 0)
    .limit(500);

  if (!data || data.length === 0) {
    return { avg_price: null, min_year: null, max_year: null };
  }

  const prices = data
    .map((r) => (r as { sale_price: number }).sale_price)
    .filter((p) => p > 0);
  const years = data
    .map((r) => (r as { year: number | null }).year)
    .filter((y): y is number => y != null && y > 1800);

  const avg_price = prices.length > 0
    ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    : null;
  const min_year = years.length > 0 ? Math.min(...years) : null;
  const max_year = years.length > 0 ? Math.max(...years) : null;

  return { avg_price, min_year, max_year };
}

/**
 * For source dimension: compute fill rates (% of vehicles with key fields populated).
 */
async function fetchFillRates(
  filterCol: string,
  filterValue: string | number,
): Promise<{ field: string; pct: number }[]> {
  const fields = ['sale_price', 'mileage', 'vin', 'primary_image_url', 'canonical_body_style'];
  const { data, count } = await supabase
    .from('vehicles')
    .select('sale_price, mileage, vin, primary_image_url, canonical_body_style', { count: 'exact' })
    .eq('is_public', true)
    .eq(filterCol, filterValue)
    .limit(500);

  const total = data?.length || 0;
  if (total === 0) return [];

  const rates: { field: string; pct: number }[] = [];
  const fieldLabels: Record<string, string> = {
    sale_price: 'PRICE',
    mileage: 'MILEAGE',
    vin: 'VIN',
    primary_image_url: 'PHOTO',
    canonical_body_style: 'BODY',
  };

  for (const field of fields) {
    const filled = data!.filter((r) => {
      const val = (r as Record<string, unknown>)[field];
      return val != null && val !== '' && val !== 0;
    }).length;
    rates.push({ field: fieldLabels[field] || field, pct: Math.round((filled / total) * 100) });
  }

  return rates.sort((a, b) => b.pct - a.pct);
}

export function useBadgeDepth(dimension: BadgeDimension, value: string | number | null) {
  const [data, setData] = useState<BadgeDepthData | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const cacheKey = `${dimension}:${value}`;

  const load = useCallback(async () => {
    if (!value || fetchedRef.current || loading) return;

    // Check cache first
    const cached = depthCache.get(cacheKey);
    if (cached) {
      setData(cached);
      fetchedRef.current = true;
      return;
    }

    fetchedRef.current = true;
    setLoading(true);

    try {
      const col = COLUMN_MAP[dimension];
      if (!col) return;

      // Core queries: count + preview (always)
      const corePromises = [
        supabase
          .from('vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('is_public', true)
          .eq(col, value),
        supabase
          .from('vehicles')
          .select('id, year, make, model, primary_image_url, sale_price')
          .eq('is_public', true)
          .eq(col, value)
          .not('primary_image_url', 'is', null)
          .order('feed_rank_score', { ascending: false, nullsFirst: false })
          .limit(6),
      ] as const;

      // Dimension-specific stat queries
      const facetCol = FACET_COLUMN[dimension];
      const statPromises: Promise<unknown>[] = [
        fetchAggregates(col, value),
      ];
      if (facetCol) {
        statPromises.push(fetchFacets(col, value, facetCol));
      }
      if (dimension === 'source') {
        statPromises.push(fetchFillRates(col, value));
      }

      const [countResult, previewResult, ...statResults] = await Promise.all([
        ...corePromises,
        ...statPromises,
      ]);

      const aggregates = statResults[0] as { avg_price: number | null; min_year: number | null; max_year: number | null };
      const facets = facetCol ? (statResults[1] as { label: string; count: number }[]) : [];
      const fillRates = dimension === 'source'
        ? (statResults[facetCol ? 2 : 1] as { field: string; pct: number }[])
        : undefined;

      const stats: BadgeDimensionStats = {
        avg_price: aggregates.avg_price,
        min_year: aggregates.min_year,
        max_year: aggregates.max_year,
        top_facets: facets,
        fill_rates: fillRates,
      };

      const result: BadgeDepthData = {
        count: typeof countResult.count === 'number' ? countResult.count : 0,
        preview: (previewResult.data as BadgePreviewItem[]) || [],
        stats,
      };

      depthCache.set(cacheKey, result);
      setData(result);
    } catch {
      setData({ count: 0, preview: [], stats: null });
    } finally {
      setLoading(false);
    }
  }, [dimension, value, cacheKey, loading]);

  // Reset if value changes
  const prevValueRef = useRef(value);
  if (prevValueRef.current !== value) {
    prevValueRef.current = value;
    fetchedRef.current = false;
    setData(null);
  }

  return { data, loading, load };
}
