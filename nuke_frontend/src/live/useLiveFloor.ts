/**
 * useLiveFloor — the read engine for the Live floor.
 *
 * Parametrized standing query over the existing browse RPC (search_vehicles_browse)
 * + a realtime subscription to vehicle_listings so genuinely-new inventory pushes
 * a "N new" signal (motion is a derivative of real data landing — never a fake
 * ticker). Reuses the proven realtime channel pattern from useAuctionSubscription.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getOfferCounts } from './offers';

export interface LiveParams {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  sortBy?: string;
  sortDir?: string;
}

export interface LiveRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  status: string | null;
  source: string | null;
  sold_price: number | null;
  primary_image_url: string | null;
  body_style: string | null;
  offer_count?: number;
  /** Live-auction overlay from vehicle_listings (the realtime mirror). */
  live_bid_cents?: number | null;
  live_end_time?: string | null;
}

export function useLiveFloor(initial: LiveParams = {}) {
  const [params, setParams] = useState<LiveParams>({ sortBy: 'newest', sortDir: 'desc', ...initial });
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const run = useCallback(async (p: LiveParams) => {
    setLoading(true);
    try {
      const rpcParams: Record<string, unknown> = {
        p_page: 1,
        p_page_size: 60,
        p_has_image: true,
        p_sort_by: p.sortBy || 'newest',
        p_sort_dir: p.sortDir || 'desc',
      };
      if (p.make) rpcParams.p_make = p.make;
      if (p.model) rpcParams.p_model = p.model;
      if (p.yearMin) rpcParams.p_year_min = p.yearMin;
      if (p.yearMax) rpcParams.p_year_max = p.yearMax;
      if (p.priceMin) rpcParams.p_price_min = p.priceMin;
      if (p.priceMax) rpcParams.p_price_max = p.priceMax;

      const { data, error } = await supabase.rpc('search_vehicles_browse', rpcParams);
      if (error) throw error;
      const list = (data || []) as LiveRow[];

      // Overlay the demand-legitimacy signal + the live-auction state
      // (vehicle_listings is the realtime mirror sync-live-auctions maintains).
      const ids = list.map((r) => r.id);
      const [counts, liveRes] = await Promise.all([
        getOfferCounts(ids),
        supabase
          .from('vehicle_listings')
          .select('vehicle_id, current_high_bid_cents, auction_end_time')
          .in('vehicle_id', ids)
          .eq('status', 'active'),
      ]);
      const liveByVehicle = new Map(
        (liveRes.data || []).map((l: { vehicle_id: string; current_high_bid_cents: number | null; auction_end_time: string | null }) => [
          l.vehicle_id,
          l,
        ]),
      );
      setRows(
        list.map((r) => ({
          ...r,
          offer_count: counts[r.id] || 0,
          live_bid_cents: liveByVehicle.get(r.id)?.current_high_bid_cents ?? null,
          live_end_time: liveByVehicle.get(r.id)?.auction_end_time ?? null,
        })),
      );
      setNewCount(0);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-run whenever params change.
  useEffect(() => {
    run(params);
  }, [params, run]);

  // Realtime: count genuinely-new listings so the floor can invite a refresh.
  useEffect(() => {
    const channel = supabase
      .channel('live-floor')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vehicle_listings' },
        () => setNewCount((n) => n + 1),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const refresh = useCallback(() => run(paramsRef.current), [run]);

  return { params, setParams, rows, loading, newCount, refresh };
}
