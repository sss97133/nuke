import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

// classified_ask_board (migration 20261013233000): classified asks first seen in a window, one row per vehicle, with
// place, distance from an optional point, the owner's taste score and a price tier. The population travels with it.
export const ASK_TIERS = ['under_5k', '5k_15k', '15k_40k', '40k_100k', '100k_plus'] as const;
export type AskTier = typeof ASK_TIERS[number];
export const TIER_NAMES: Record<AskTier, string> = {
  under_5k: 'Under $5K', '5k_15k': '$5K–15K', '15k_40k': '$15K–40K', '40k_100k': '$40K–100K', '100k_plus': '$100K and up',
};
export const ASK_WINDOWS = [24, 72, 168] as const;
export const ASK_SORTS = ['newest', 'nearest', 'band', 'price'] as const;
export type AskSort = typeof ASK_SORTS[number];
const PAGE_SIZE = 60;

export type AskRow = {
  event_id: string; vehicle_id: string; source: string; url: string | null;
  asking_price: number | null; tier: AskTier | null; first_seen_at: string; posted_at: string | null;
  year: number | null; make: string | null; model: string | null; drivetrain: string | null; body_style: string | null;
  mileage: number | null; image: string | null;
  city: string | null; region: string | null; lat: number | null; lng: number | null; distance_mi: number | null;
  taste: number | null; in_band: boolean | null;
};
export type AskPopulation = {
  asks: number; priced: number; with_point: number; in_band: number;
  by_source: Record<string, number>; by_tier: Partial<Record<AskTier | 'unpriced', number>>;
};
export type AskBoard = {
  as_of: string; since: string; window_hours: number; band_min_taste: number;
  population: AskPopulation; matching: number; rows: AskRow[];
};
export type AskBoardQuery = {
  hours: number; tier: AskTier | null; band: boolean; sort: AskSort;
  point: { lat: number; lng: number } | null; radius: number | null;
};

export async function readAskBoard(q: AskBoardQuery, offset = 0, signal?: AbortSignal): Promise<AskBoard> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const { data, error } = await supabase.rpc('classified_ask_board', {
    p_hours: q.hours,
    p_lat: q.point?.lat ?? null,
    p_lng: q.point?.lng ?? null,
    p_radius_mi: q.point ? q.radius : null,
    p_min_taste: q.band ? 60 : null,
    p_tier: q.tier,
    p_sort: q.sort === 'nearest' && !q.point ? 'newest' : q.sort,
    p_limit: PAGE_SIZE,
    p_offset: offset,
  }).abortSignal(requestSignal);
  if (error) throw error;
  return data as AskBoard;
}

export function useAskBoard(q: AskBoardQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['classified-ask-board', q],
    queryFn: ({ pageParam, signal }) => readAskBoard(q, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const read = pages.reduce((n, page) => n + page.rows.length, 0);
      return last.rows.length === PAGE_SIZE && read < last.matching ? read : undefined;
    },
    enabled,
    staleTime: 60_000,
  });
}
