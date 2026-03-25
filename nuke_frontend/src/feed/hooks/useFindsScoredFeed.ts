/**
 * useFindsScoredFeed -- Fetches top scored finds from hero_finds() RPC.
 *
 * The hero_finds(lim) RPC returns rows from mv_finds materialized view,
 * each with a composite find_score and signal_breakdown JSON.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FindSignalBreakdown {
  deal_score: number;
  heat_score: number;
  rare: boolean;
  model_count: number;
  condition: string | null;
  red_flags: number;
  mods: number;
  cross_platform: number;
  old_discovery: boolean;
}

export interface ScoredFindItem {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  display_price: number | null;
  primary_image_url: string | null;
  listing_url: string | null;
  discovery_source: string | null;
  is_for_sale: boolean;
  find_score: number;
  deal_score: number | null;
  heat_score: number | null;
  model_total: number | null;
  red_flag_count: number;
  mod_count: number;
  cross_platform_count: number;
  condition_grade: string | null;
  signal_breakdown: FindSignalBreakdown;
}

// ---------------------------------------------------------------------------
// Signal explanation builder
// ---------------------------------------------------------------------------

export function buildFindExplanation(item: ScoredFindItem): string {
  const parts: string[] = [];
  const sb = item.signal_breakdown;

  if (sb.deal_score > 70) {
    parts.push(`${sb.deal_score}% deal score`);
  } else if (sb.deal_score > 50) {
    parts.push(`${sb.deal_score}% deal`);
  }

  if (sb.heat_score > 60) {
    parts.push('high heat');
  } else if (sb.heat_score > 30) {
    parts.push('warm heat');
  }

  if (sb.rare && sb.model_count != null) {
    parts.push(`rare model (${sb.model_count} in DB)`);
  }

  if (sb.condition === 'excellent' || sb.condition === 'concours') {
    parts.push(sb.condition + ' condition');
  }

  if (sb.red_flags > 0) {
    parts.push(`${sb.red_flags} red flag${sb.red_flags > 1 ? 's' : ''}`);
  }

  if (sb.cross_platform > 1) {
    parts.push(`${sb.cross_platform} platforms`);
  }

  if (sb.old_discovery) {
    parts.push('recent discovery');
  }

  if (sb.mods > 3) {
    parts.push(`${sb.mods} mods`);
  }

  return parts.join(' + ');
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchScoredFinds(limit: number): Promise<ScoredFindItem[]> {
  const { data, error } = await supabase.rpc('hero_finds', { lim: limit });
  if (error) throw new Error(`hero_finds RPC error: ${error.message}`);
  return (data ?? []) as ScoredFindItem[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFindsScoredFeed(enabled: boolean = true, limit: number = 20) {
  return useQuery<ScoredFindItem[]>({
    queryKey: ['finds_scored_feed', limit],
    queryFn: () => fetchScoredFinds(limit),
    enabled,
    staleTime: 2 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
