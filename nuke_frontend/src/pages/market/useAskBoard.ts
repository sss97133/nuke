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
// position: lowest against its own family first (classified_ask_board 20261015150000).
export const ASK_SORTS = ['newest', 'nearest', 'band', 'price', 'position'] as const;
export type AskSort = typeof ASK_SORTS[number];
const PAGE_SIZE = 60;

export type AskRow = {
  event_id: string; vehicle_id: string; source: string; url: string | null;
  asking_price: number | null; tier: AskTier | null; first_seen_at: string; posted_at: string | null;
  listed_at?: string | null; // least(posted_at, first_seen_at): when the listing went up (20261015070000)
  year: number | null; make: string | null; model: string | null; drivetrain: string | null; body_style: string | null;
  mileage: number | null; image: string | null;
  // What the listing itself says (20261015080000): its stated miles, a disclosed odometer state, its title status.
  listing_mileage?: number | null; odometer?: 'broken' | 'rolled_over' | null; title_status?: string | null; observation_id?: string | null;
  condition?: string | null; // the seller's declared condition, as stated (20261017050000): a claim, not an inspection
  city: string | null; region: string | null; lat: number | null; lng: number | null; distance_mi: number | null;
  taste: number | null; in_band: boolean | null;
  // What the listing is and where its ask sits (20261017050000): its model family and, for its model year, the
  // family's recorded sales and other classified asks (mv_family_year_prices). merit: the active exit model's chance
  // that a listing like this is gone within the model's horizon; null until a model is active.
  position?: AskPosition | null;
  read_miles?: number | null; // the odometer reading the miles position used: the listing's stated miles, else the vehicle's
  merit?: { exit7: number; model_version: string } | null;
};
// One price population around a model year: n prices in year_from..year_to; at_or_below = how many are <= this ask.
// thin = fewer than 10: no percentiles and no at_or_below.
export type AskPricePopulation = {
  n: number; year_from: number; year_to: number; thin: boolean;
  p25: number | null; p50: number | null; p75: number | null; at_or_below: number | null;
  by_source: Record<string, number>; as_of: string;
  // The odometer (20261015160000): n readings among the same rows, their median, and how many read at or below this
  // listing's miles (null under 10 readings, or when the seller disclosed a broken or rolled-over odometer).
  miles?: { n: number; p50: number | null; at_or_below: number | null };
  // Each source's count and median in the window (20261015215000; median from 5 prices): the venue being compared.
  venues?: Record<string, { n: number; p50: number | null }>;
};
export type AskPosition = {
  family: string; family_id: string;
  // share of the family's prices at or below this ask: other asks when there are 10 (basis 'asked'), else recorded
  // sales ('sold'); null when neither places it. p_sort 'position' orders by it, lowest first.
  share: number | null; basis: 'asked' | 'sold' | null;
  // offered = every recorded outcome (sold or not); conflicts = sales refused because their own page is another car.
  sold: (AskPricePopulation & { offered: number | null; conflicts: number | null; first_on: string | null; last_on: string | null }) | null;
  asked: AskPricePopulation | null; // other classified asks in the 365 days before the fold's refresh, this one excluded
};
export type AskPopulation = {
  asks: number; priced: number; with_point: number; in_band: number;
  keyed?: number; positioned_sold?: number; positioned_asked?: number; with_merit?: number; // 20261017050000
  by_source: Record<string, number>; by_tier: Partial<Record<AskTier | 'unpriced', number>>;
};
export type AskBoard = {
  as_of: string; since: string; window_hours: number; band_min_taste: number;
  newest_at?: string | null; // the newest listed_at the caller can see in the window (20261015070000)
  newest_seen_at?: string | null; // the newest first sighting: capture time (20261017050000)
  merit_model?: { version: string; horizon_days: number; base_rate: number } | null; // the active exit model
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
