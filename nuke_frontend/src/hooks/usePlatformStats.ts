import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Shared platform stats hook — queries portfolio_stats_cache once,
 * caches client-side for 60s. Use this everywhere instead of hardcoded numbers.
 *
 * Created per CEO directive: "replace with a function when we want to show data"
 * See: https://github.com/sss97133/nuke/issues/186
 */

export interface PlatformStats {
  totalVehicles: number | null;
  totalValue: number | null;
  forSaleCount: number | null;
  salesCountToday: number | null;
  salesVolumeToday: number | null;
  vehiclesAddedToday: number | null;
  activeAuctions: number | null;
  updatedAt: string | null;
}

// Module-level cache so multiple components share one fetch
let cached: PlatformStats | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

const EMPTY: PlatformStats = {
  totalVehicles: null,
  totalValue: null,
  forSaleCount: null,
  salesCountToday: null,
  salesVolumeToday: null,
  vehiclesAddedToday: null,
  activeAuctions: null,
  updatedAt: null,
};

export function usePlatformStats(): PlatformStats {
  const [stats, setStats] = useState<PlatformStats>(cached ?? EMPTY);

  useEffect(() => {
    if (cached && Date.now() - cacheTime < CACHE_TTL) {
      setStats(cached);
      return;
    }

    supabase
      .from('portfolio_stats_cache')
      .select(
        'total_vehicles, total_value, for_sale_count, sales_count_today, ' +
        'sales_volume_today, vehicles_added_today, active_auctions, updated_at'
      )
      .eq('id', 'global')
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const result: PlatformStats = {
          totalVehicles: Number(data.total_vehicles) || null,
          totalValue: Number(data.total_value) || null,
          forSaleCount: Number(data.for_sale_count) || null,
          salesCountToday: Number(data.sales_count_today) || null,
          salesVolumeToday: Number(data.sales_volume_today) || null,
          vehiclesAddedToday: Number(data.vehicles_added_today) || null,
          activeAuctions: Number(data.active_auctions) || null,
          updatedAt: data.updated_at,
        };
        cached = result;
        cacheTime = Date.now();
        setStats(result);
      });
  }, []);

  return stats;
}

/** Format a number for display: 1234567 → "1.2M", 12345 → "12K", 999 → "999" */
export function formatStat(n: number | null | undefined): string {
  if (n == null) return '\u2014'; // em-dash
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

/** Format a currency value: 43882272113 → "$43.9B", 1500000 → "$1.5M" */
export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '\u2014';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}`;
  return `$${n.toLocaleString()}`;
}
