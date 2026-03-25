/**
 * useFindsScoredFeed -- Fetches top scored finds from hero_finds() RPC.
 *
 * hero_finds() returns jsonb with {multi_signal, multi_platform, rare_finds}.
 * We map multi_signal items to the ScoredFindItem shape for backward compat.
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
// Fetcher -- calls parameterless hero_finds() RPC
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
async function doFetchFinds(): Promise<ScoredFindItem[]> {
  // hero_finds(lim DEFAULT 20) is a RETURNS TABLE RPC.
  // Supabase JS returns a flat array of rows, each with signal_breakdown jsonb.
  const rpcResult = await supabase.rpc('hero_finds');
  if (rpcResult.error) throw new Error(`hero_finds RPC error: ${rpcResult.error.message}`);
  const payload = rpcResult.data as any;
  if (!payload) return [];

  // RETURNS TABLE RPCs come back as an array of row objects
  if (Array.isArray(payload)) {
    return payload as ScoredFindItem[];
  }

  // hero_finds() returns jsonb object {multi_signal, multi_platform, rare_finds}
  // Map multi_signal items to ScoredFindItem shape
  if (payload.multi_signal && Array.isArray(payload.multi_signal)) {
    return payload.multi_signal.map((row: any): ScoredFindItem => ({
      vehicle_id: String(row.id ?? ''),
      year: row.year, make: row.make, model: row.model,
      display_price: row.price, primary_image_url: row.thumbnail,
      listing_url: null, discovery_source: null, is_for_sale: true,
      find_score: Math.round((row.deal_score ?? 0) + (row.heat_score ?? 0) * 2),
      deal_score: row.deal_score, heat_score: row.heat_score,
      model_total: null, red_flag_count: (row.recent_comments ?? 0) > 10 ? 1 : 0,
      mod_count: 0, cross_platform_count: 0, condition_grade: null,
      signal_breakdown: {
        deal_score: row.deal_score ?? 0, heat_score: row.heat_score ?? 0,
        rare: false, model_count: 0, condition: null, red_flags: 0,
        mods: 0, cross_platform: 0, old_discovery: false,
      },
    }));
  }

  return [];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFindsScoredFeed(enabled: boolean = true, _limit: number = 20) {
  return useQuery<ScoredFindItem[]>({
    queryKey: ['finds_scored_feed'],
    queryFn: doFetchFinds,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
