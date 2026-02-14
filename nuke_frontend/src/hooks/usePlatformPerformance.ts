import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useMicroPortalData, type PortalDataState } from '../components/vehicles/micro-portals/useMicroPortalData';

export interface PlatformStats {
  platform: string;
  bid_count: number | null;
  view_count: number | null;
  watcher_count: number | null;
  platform_sell_through_pct: number | null;
  platform_avg_price: number | null;
}

function classifyPlatform(data: PlatformStats): PortalDataState {
  if (!data.platform) return 'empty';
  const hasMetrics = (data.bid_count ?? 0) > 0 || (data.view_count ?? 0) > 0 || (data.watcher_count ?? 0) > 0;
  if (!hasMetrics && !data.platform_sell_through_pct) return 'sparse';
  return 'rich';
}

export function usePlatformPerformance(
  vehicleId: string | undefined,
  platform: string | undefined,
  enabled: boolean,
) {
  const fetcher = useCallback(async (): Promise<PlatformStats> => {
    if (!vehicleId || !platform) {
      return { platform: platform || '', bid_count: null, view_count: null, watcher_count: null, platform_sell_through_pct: null, platform_avg_price: null };
    }

    // Get this vehicle's external listing stats
    const { data: listing } = await supabase
      .from('external_listings')
      .select('bid_count, view_count, watcher_count')
      .eq('vehicle_id', vehicleId)
      .ilike('platform', `%${platform}%`)
      .limit(1)
      .maybeSingle();

    // Get platform-level stats from market_trends
    const { data: trend } = await supabase
      .from('market_trends')
      .select('demand_high_pct, avg_sale_price, vehicle_count')
      .ilike('platform', `%${platform}%`)
      .is('model', null) // platform-level, not model-specific
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      platform,
      bid_count: listing?.bid_count ?? null,
      view_count: listing?.view_count ?? null,
      watcher_count: listing?.watcher_count ?? null,
      platform_sell_through_pct: trend?.demand_high_pct != null ? Math.round(trend.demand_high_pct) : null,
      platform_avg_price: trend?.avg_sale_price ?? null,
    };
  }, [vehicleId, platform]);

  return useMicroPortalData<PlatformStats>(
    `platform-stats-${vehicleId}-${platform}`,
    fetcher,
    classifyPlatform,
    enabled && !!vehicleId && !!platform,
  );
}
