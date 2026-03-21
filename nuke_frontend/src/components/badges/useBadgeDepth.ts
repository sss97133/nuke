/**
 * useBadgeDepth — Lazy-loads cluster depth + preview items for a BadgePortal.
 *
 * Fetches count and top 6 preview vehicles matching a badge's filter.
 * Only fires on hover (after 200ms debounce) so idle badges cost zero queries.
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

export interface BadgeDepthData {
  count: number;
  preview: BadgePreviewItem[];
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

// Cache to avoid re-fetching the same badge across renders
const depthCache = new Map<string, BadgeDepthData>();

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

      // Parallel: count + preview
      const [countResult, previewResult] = await Promise.all([
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
      ]);

      const result: BadgeDepthData = {
        count: typeof countResult.count === 'number' ? countResult.count : 0,
        preview: (previewResult.data as BadgePreviewItem[]) || [],
      };

      depthCache.set(cacheKey, result);
      setData(result);
    } catch {
      setData({ count: 0, preview: [] });
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
