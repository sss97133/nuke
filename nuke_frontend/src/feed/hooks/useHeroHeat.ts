/**
 * useHeroHeat -- React Query hook for hero_heat() RPC.
 *
 * Returns: top 30 by heat_score, comment velocity (7d), make heat treemap.
 * Cached for 5 minutes.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Types (match hero_heat() jsonb output)
// ---------------------------------------------------------------------------

export interface HotVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  heat_score: number;
  thumbnail: string | null;
  price: number | null;
}

export interface CommentVelocityItem {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  comment_count_7d: number;
  thumbnail: string | null;
}

export interface MakeHeatItem {
  make: string;
  total_heat: number;
  count: number;
}

export interface HeroHeatData {
  top_hot: HotVehicle[];
  comment_velocity: CommentVelocityItem[];
  make_heat: MakeHeatItem[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchHeroHeat(): Promise<HeroHeatData> {
  const { data, error } = await supabase.rpc('hero_heat');
  if (error) throw new Error(`hero_heat RPC error: ${error.message}`);
  const d = data as any;
  return {
    top_hot: d.top_hot ?? [],
    comment_velocity: d.comment_velocity ?? [],
    make_heat: d.make_heat ?? [],
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHeroHeat(enabled: boolean = true) {
  return useQuery<HeroHeatData>({
    queryKey: ['hero_heat'],
    queryFn: fetchHeroHeat,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
