/**
 * useHeroFinds -- React Query hook for hero_finds() RPC.
 *
 * Returns three categories of interesting vehicles:
 * - multi_signal: deal_score > 70 AND heat_score > 0
 * - multi_platform: vehicles appearing on multiple platforms
 * - rare_finds: recently discovered rare models (low count + high price)
 *
 * Cached for 5 minutes.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Types (match hero_finds() jsonb output)
// ---------------------------------------------------------------------------

export interface MultiSignalItem {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  deal_score: number | null;
  heat_score: number | null;
  price: number | null;
  thumbnail: string | null;
  recent_comments: number;
}

export interface MultiPlatformItem {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  platform_count: number;
  platforms: string[];
  price: number | null;
  thumbnail: string | null;
}

export interface RareFindItem {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  thumbnail: string | null;
  deal_score: number | null;
  model_count: number;
}

export interface HeroFindsData {
  multi_signal: MultiSignalItem[];
  multi_platform: MultiPlatformItem[];
  rare_finds: RareFindItem[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchHeroFinds(): Promise<HeroFindsData> {
  const { data, error } = await supabase.rpc('hero_finds');
  if (error) throw new Error(`hero_finds RPC error: ${error.message}`);
  const d = data as any;
  return {
    multi_signal: d.multi_signal ?? [],
    multi_platform: d.multi_platform ?? [],
    rare_finds: d.rare_finds ?? [],
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHeroFinds(enabled: boolean = true) {
  return useQuery<HeroFindsData>({
    queryKey: ['hero_finds'],
    queryFn: fetchHeroFinds,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
