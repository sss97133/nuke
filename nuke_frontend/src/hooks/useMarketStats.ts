import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useMicroPortalData, type PortalDataState } from '../components/vehicles/micro-portals/useMicroPortalData';

/**
 * useMarketStats — wraps the 3 Y/M/M RPCs with 60s cache.
 */

export interface YearMarketStats {
  total_listings: number;
  avg_price: number;
  median_price: number;
  sell_through_pct: number;
  top_makes: { make: string; count: number }[];
}

export interface MakeMarketStats {
  total_listings: number;
  avg_price: number;
  median_price: number;
  sell_through_pct: number;
  top_models: { model: string; count: number; avg_price: number }[];
  sentiment_score: number | null;
  demand_high_pct: number | null;
}

export interface ModelMarketStats {
  total_listings: number;
  avg_price: number;
  median_price: number;
  p25_price: number | null;
  p75_price: number | null;
  avg_days_on_market: number;
  trend_direction: 'up' | 'down' | 'stable';
  heat_score_avg: number | null;
  total_produced: number | null;
  rarity_level: string | null;
  collector_demand_score: number | null;
}

function classifyByCount(count: number): PortalDataState {
  if (count === 0) return 'empty';
  if (count <= 2) return 'sparse';
  return 'rich';
}

export function useYearMarketStats(year: number | undefined, enabled: boolean) {
  const fetcher = useCallback(async (): Promise<YearMarketStats> => {
    if (!year) throw new Error('No year');
    const { data, error } = await supabase.rpc('get_year_market_stats', { p_year: year });
    if (error) throw error;
    return data as YearMarketStats;
  }, [year]);

  return useMicroPortalData<YearMarketStats>(
    `year-stats-${year}`,
    fetcher,
    (d) => classifyByCount(d?.total_listings ?? 0),
    enabled && !!year,
  );
}

export function useMakeMarketStats(make: string | undefined, enabled: boolean) {
  const fetcher = useCallback(async (): Promise<MakeMarketStats> => {
    if (!make) throw new Error('No make');
    const { data, error } = await supabase.rpc('get_make_market_stats', { p_make: make });
    if (error) throw error;
    return data as MakeMarketStats;
  }, [make]);

  return useMicroPortalData<MakeMarketStats>(
    `make-stats-${make}`,
    fetcher,
    (d) => classifyByCount(d?.total_listings ?? 0),
    enabled && !!make,
  );
}

export function useModelMarketStats(make: string | undefined, model: string | undefined, enabled: boolean) {
  const fetcher = useCallback(async (): Promise<ModelMarketStats> => {
    if (!make || !model) throw new Error('No make/model');
    const { data, error } = await supabase.rpc('get_model_market_stats', { p_make: make, p_model: model });
    if (error) throw error;
    return data as ModelMarketStats;
  }, [make, model]);

  return useMicroPortalData<ModelMarketStats>(
    `model-stats-${make}-${model}`,
    fetcher,
    (d) => classifyByCount(d?.total_listings ?? 0),
    enabled && !!make && !!model,
  );
}
