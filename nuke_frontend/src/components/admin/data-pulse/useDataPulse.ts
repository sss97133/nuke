/**
 * useDataPulse — Hook to fetch data_pulse() RPC with 60s auto-refresh
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';

export interface CensusRow {
  canonical_platform: string;
  platform_display_name: string;
  total_vehicles: number;
  sold_count: number;
  reserve_not_met_count: number;
  live_count: number;
  ended_count: number;
  has_price: number;
  avg_sold_price: number | null;
  median_sold_price: number | null;
  has_vin: number;
  has_description: number;
}

export interface TimeSeriesRow {
  canonical_platform: string;
  day: string;
  cnt: number;
}

export interface VelocityRow {
  this_week: number;
  last_week: number;
}

export interface DataPulseResult {
  census: CensusRow[];
  time_series: TimeSeriesRow[];
  last_ingested: Record<string, string>;
  velocity: Record<string, VelocityRow>;
  totals: {
    total_vehicles: number;
    sold_with_price: number;
    with_vin: number;
    with_description: number;
    platforms_count: number;
    added_7d: number;
    missing_vin: number;
    missing_desc: number;
    missing_price: number;
  };
}

export function useDataPulse(refreshInterval = 60_000) {
  const [data, setData] = useState<DataPulseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetch = useCallback(async () => {
    try {
      const { data: result, error: err } = await supabase.rpc('data_pulse');
      if (err) throw new Error(err.message);
      setData(result as DataPulseResult);
      setError(null);
      setLastFetch(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, refreshInterval);
    return () => clearInterval(interval);
  }, [fetch, refreshInterval]);

  return { data, error, loading, lastFetch, refetch: fetch };
}
