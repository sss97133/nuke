/**
 * Custom hook: loads database-wide stats from cached table, RPCs, or client fallback.
 * Handles periodic refresh, visibility-change reload, and realtime subscription.
 * Extracted from CursorHomepage to reduce file size.
 */
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { computeVehicleStats, EMPTY_STATS, type VehicleStats } from '../lib/feedStatsCalculator';

interface UseDbStatsParams {
  runVehiclesQueryWithListingKindFallback: (builder: (includeListingKind: boolean) => any) => Promise<any>;
}

export function useDbStats({ runVehiclesQueryWithListingKindFallback }: UseDbStatsParams) {
  const [dbStats, setDbStats] = useState<VehicleStats>(EMPTY_STATS);
  const [dbStatsLoading, setDbStatsLoading] = useState(true);
  const hasLoggedCachedStatsRef = useRef(false);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const loadDatabaseStats = async () => {
      try {
        setDbStatsLoading(true);

        // FIRST: Try cached stats table (instant read, ~200ms)
        const { data: cachedStats, error: cacheError } = await supabase
          .from('portfolio_stats_cache')
          .select('*')
          .eq('id', 'global')
          .single();

        if (!cacheError && cachedStats) {
          if (!hasLoggedCachedStatsRef.current) {
            hasLoggedCachedStatsRef.current = true;
          }

          setDbStats(prev => ({
            ...prev,
            totalVehicles: Number(cachedStats.total_vehicles) || prev.totalVehicles,
            totalValue: Number(cachedStats.total_value) || prev.totalValue,
            salesCountToday: Number(cachedStats.sales_count_today) || prev.salesCountToday,
            salesVolume: Number(cachedStats.sales_volume_today) || prev.salesVolume,
            forSaleCount: Number(cachedStats.for_sale_count) || prev.forSaleCount,
            activeAuctions: Number(cachedStats.active_auctions) || prev.activeAuctions,
            vehiclesAddedToday: Number(cachedStats.vehicles_added_today) || prev.vehiclesAddedToday,
            valueRealizedTotal: Number(cachedStats.value_realized_total) || prev.valueRealizedTotal,
            avgValue: cachedStats.total_vehicles > 0
              ? Number(cachedStats.total_value) / Number(cachedStats.total_vehicles)
              : prev.avgValue,
            marketInterestValue: Number(cachedStats.market_interest_value) || prev.marketInterestValue,
            rnmVehicleCount: Number(cachedStats.rnm_vehicle_count) || prev.rnmVehicleCount,
          }));
          setDbStatsLoading(false);
          return;
        }

        // FALLBACK: Try fast stats RPC (simple counts)
        const { data: fastStats, error: fastError } = await supabase.rpc('get_portfolio_stats_fast');

        if (!fastError && fastStats) {
          setDbStats(prev => ({
            ...prev,
            totalVehicles: Number(fastStats.total_vehicles) || prev.totalVehicles,
            salesCountToday: Number(fastStats.sales_count_today) || prev.salesCountToday,
            forSaleCount: Number(fastStats.for_sale_count) || prev.forSaleCount,
            activeAuctions: Number(fastStats.active_auctions) || prev.activeAuctions,
            vehiclesAddedToday: Number(fastStats.vehicles_added_today) || prev.vehiclesAddedToday,
          }));
          setDbStatsLoading(false);

          // Try to get value in background
          supabase.rpc('calculate_portfolio_value_server').then(({ data: fullStats, error: fullError }) => {
            if (!fullError && fullStats) {
              setDbStats(prev => ({
                ...prev,
                totalValue: Number(fullStats.total_value) || prev.totalValue,
                salesVolume: Number(fullStats.sales_volume_today) || prev.salesVolume,
                avgValue: Number(fullStats.avg_value) || prev.avgValue,
                valueRealizedTotal: Number(fullStats.value_realized_total) || prev.valueRealizedTotal,
              }));
            }
          }).catch(() => {});

          return;
        }

        // Fallback: Try the full RPC directly
        const { data: serverStats, error: rpcError } = await supabase.rpc('calculate_portfolio_value_server');

        if (!rpcError && serverStats) {
          const stats: VehicleStats = {
            totalVehicles: Number(serverStats.total_vehicles) || 0,
            totalValue: Number(serverStats.total_value) || 0,
            salesVolume: Number(serverStats.sales_volume_today) || 0,
            salesCountToday: Number(serverStats.sales_count_today) || 0,
            forSaleCount: Number(serverStats.for_sale_count) || 0,
            activeAuctions: Number(serverStats.active_auctions) || 0,
            totalBids: 0,
            avgValue: Number(serverStats.avg_value) || 0,
            vehiclesAddedToday: Number(serverStats.vehicles_added_today) || 0,
            valueMarkTotal: Number(serverStats.value_mark_total) || 0,
            valueAskTotal: Number(serverStats.value_ask_total) || 0,
            valueRealizedTotal: Number(serverStats.value_realized_total) || 0,
            valueCostTotal: Number(serverStats.value_cost_total) || 0,
            valueImportedToday: Number(serverStats.value_imported_today) || 0,
            valueImported24h: Number(serverStats.value_imported_24h) || 0,
            valueImported7d: Number(serverStats.value_imported_7d) || 0,
          };

          setDbStats(stats);
          setDbStatsLoading(false);
          return;
        }

        // Fallback to client-side calculation if both RPCs fail
        const { count: totalCount, error: countError } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
          let q = supabase
            .from('vehicles')
            .select('*', { count: 'estimated', head: true })
            .eq('is_public', true)
            .neq('status', 'pending');
          if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
          return q;
        });

        if (countError) {
          // Error loading vehicle count - silent
        }

        const { data: allVehicles, error: vehiclesError } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
          let q = supabase
            .from('vehicles')
            .select('sale_price, sale_status, asking_price, current_value, purchase_price, msrp, winning_bid, high_bid, is_for_sale, bid_count, auction_outcome, created_at, sale_date')
            .eq('is_public', true)
            .neq('status', 'pending')
            .limit(15000);
          if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
          return q;
        });

        if (vehiclesError) {
          return;
        }

        const baseStats = computeVehicleStats(allVehicles || [], totalCount || (allVehicles || []).length);

        // Prefer external_listings for a true "live auctions" count (end_date in the future).
        let activeAuctionsLive = baseStats.activeAuctions;
        try {
          const { data: liveListings, error: liveErr } = await supabase
            .from('external_listings')
            .select('vehicle_id, end_date, listing_status')
            .gt('end_date', new Date().toISOString())
            .order('updated_at', { ascending: false })
            .limit(5000);
          if (!liveErr && Array.isArray(liveListings) && liveListings.length > 0) {
            activeAuctionsLive = new Set(liveListings.map((r: any) => String(r?.vehicle_id || ''))).size;
          }
        } catch {
          // ignore; keep heuristic
        }

        setDbStats({ ...baseStats, activeAuctions: activeAuctionsLive });
      } catch (error) {
        // Error loading database stats - silent
      } finally {
        setDbStatsLoading(false);
      }
    };

    loadDatabaseStats();

    // Refresh stats every 30 seconds to keep data current
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadDatabaseStats();
      }
    }, 30000);

    // Also refresh when page becomes visible (user returns to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadDatabaseStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Subscribe to real-time vehicle changes for instant updates
    const channel = supabase
      .channel('homepage-stats-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vehicles'
        },
        () => {
          // Debounce rapid changes - refresh after 2 seconds of no changes
          if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
          }
          refreshTimerRef.current = setTimeout(() => {
            loadDatabaseStats();
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(channel);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [runVehiclesQueryWithListingKindFallback]);

  return { dbStats, dbStatsLoading };
}
