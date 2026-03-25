/**
 * useHeroDeals -- React Query hook for hero_deals() RPC.
 *
 * Returns: top 30 deals (highest deal_score, is_for_sale=true),
 * deal distribution by make, price-vs-estimate stats.
 * Cached for 5 minutes.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Types (match hero_deals() jsonb output)
// ---------------------------------------------------------------------------

export interface DealItem {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  deal_score: number;
  price: number | null;
  nuke_estimate: number | null;
  thumbnail: string | null;
}

export interface DealByMake {
  make: string;
  count: number;
  best_score: number;
}

export interface PriceVsEstimateItem {
  id: string;
  price: number;
  estimate: number;
  discount_pct: number;
}

export interface HeroDealsData {
  total_deals: number;
  top_deals: DealItem[];
  deal_by_make: DealByMake[];
  price_vs_estimate: PriceVsEstimateItem[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchHeroDeals(): Promise<HeroDealsData> {
  const { data, error } = await supabase.rpc('hero_deals');
  if (error) throw new Error(`hero_deals RPC error: ${error.message}`);
  const d = data as any;
  return {
    total_deals: d.total_deals ?? 0,
    top_deals: d.top_deals ?? [],
    deal_by_make: d.deal_by_make ?? [],
    price_vs_estimate: d.price_vs_estimate ?? [],
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHeroDeals(enabled: boolean = true) {
  return useQuery<HeroDealsData>({
    queryKey: ['hero_deals'],
    queryFn: fetchHeroDeals,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
