/**
 * useHeroDeals — React Query hook for the hero_deals() RPC.
 *
 * Fetches deal data from the server: top deals, deals by make, and
 * price vs estimate distribution. Caches for 2 minutes.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DealItem {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  sale_price: number | null;
  nuke_estimate: number;
  deal_score: number;
  discount_pct: number;
  listing_url: string | null;
  source: string | null;
  thumbnail: string | null;
}

export interface DealByMake {
  make: string;
  deal_count: number;
  avg_deal_score: number;
}

export interface PriceVsEstimate {
  underpriced: number;
  fair: number;
  overpriced: number;
}

export interface HeroDealsData {
  top_deals: DealItem[] | null;
  deal_by_make: DealByMake[] | null;
  price_vs_estimate: PriceVsEstimate | null;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchHeroDeals(limit: number = 30): Promise<HeroDealsData> {
  const { data, error } = await supabase.rpc('hero_deals', { p_limit: limit });

  if (error) {
    throw new Error(`hero_deals RPC error: ${error.message}`);
  }

  return data as HeroDealsData;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHeroDeals(enabled: boolean = true) {
  return useQuery<HeroDealsData>({
    queryKey: ['hero_deals'],
    queryFn: () => fetchHeroDeals(30),
    enabled,
    staleTime: 2 * 60_000,       // 2 minutes
    gcTime: 5 * 60_000,          // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
