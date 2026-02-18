/**
 * Custom hook: loads preview data for stats panel overlays.
 * Extracted from CursorHomepage to reduce file size.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { StatsPanelKind } from '../components/feed/FeedFilterPanel';

interface UseStatsPanelDataParams {
  statsPanel: StatsPanelKind | null;
  runVehiclesQueryWithListingKindFallback: (builder: (includeListingKind: boolean) => any) => Promise<any>;
}

export function useStatsPanelData({ statsPanel, runVehiclesQueryWithListingKindFallback }: UseStatsPanelDataParams) {
  const [statsPanelLoading, setStatsPanelLoading] = useState(false);
  const [statsPanelError, setStatsPanelError] = useState<string | null>(null);
  const [statsPanelRows, setStatsPanelRows] = useState<any[]>([]);
  const [statsPanelMeta, setStatsPanelMeta] = useState<any>(null);

  useEffect(() => {
    if (!statsPanel) return;
    let cancelled = false;

    setStatsPanelLoading(true);
    setStatsPanelError(null);
    setStatsPanelRows([]);
    setStatsPanelMeta(null);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString().split('T')[0];
    const nowIso = new Date().toISOString();

    const selectMini = 'id, year, make, model, created_at, sale_date, sale_price, asking_price, current_value, purchase_price, primary_image_url, image_url, discovery_url';

    const run = async () => {
      try {
        if (statsPanel === 'vehicles') {
          const [pendingRes, publicAllRes, allVisibleRes, nonVehicleRes, newestRes] = await Promise.all([
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select('*', { count: 'estimated', head: true })
                .eq('is_public', true)
                .eq('status', 'pending');
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select('*', { count: 'estimated', head: true })
                .eq('is_public', true);
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select('*', { count: 'estimated', head: true });
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              if (!includeListingKind) return { data: null, error: null, count: 0 } as any;
              return supabase
                .from('vehicles')
                .select('*', { count: 'estimated', head: true })
                .eq('is_public', true)
                .neq('status', 'pending')
                .eq('listing_kind', 'non_vehicle_item');
            }),
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select(selectMini)
                .eq('is_public', true)
                .neq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(24);
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
          ]);

          if (cancelled) return;
          setStatsPanelMeta({
            pendingPublicCount: pendingRes?.count || 0,
            publicTotalIncludingPending: publicAllRes?.count || 0,
            totalVisibleAllRecords: allVisibleRes?.count || 0,
            publicNonVehicleItems: nonVehicleRes?.count || 0,
          });
          setStatsPanelRows(Array.isArray(newestRes?.data) ? newestRes.data : []);
          return;
        }

        if (statsPanel === 'value') {
          const { data } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
            let q = supabase
              .from('vehicles')
              .select(selectMini)
              .eq('is_public', true)
              .neq('status', 'pending')
              .order('created_at', { ascending: false })
              .limit(24);
            if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
            return q;
          });
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(data) ? (data as any[]) : []);
          return;
        }

        if (statsPanel === 'for_sale') {
          const { data } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
            let q = supabase
              .from('vehicles')
              .select(selectMini)
              .eq('is_public', true)
              .neq('status', 'pending')
              .eq('is_for_sale', true)
              .order('updated_at', { ascending: false })
              .limit(24);
            if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
            return q;
          });
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(data) ? (data as any[]) : []);
          return;
        }

        if (statsPanel === 'sold_today') {
          const [vehiclesRes, analyticsRes] = await Promise.all([
            runVehiclesQueryWithListingKindFallback((includeListingKind) => {
              let q = supabase
                .from('vehicles')
                .select(selectMini)
                .eq('is_public', true)
                .neq('status', 'pending')
                .not('sale_price', 'is', null)
                .gte('sale_date', todayISO)
                .order('sale_date', { ascending: false })
                .limit(50);
              if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
              return q;
            }),
            supabase.rpc('get_sold_today_analytics', {
              p_date: todayISO,
              p_days_back: 30,
              p_whales_limit: 10,
            }).then((r) => r.data as any),
          ]);
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(vehiclesRes?.data) ? (vehiclesRes.data as any[]) : []);
          setStatsPanelMeta(analyticsRes || null);
          return;
        }

        if (statsPanel === 'auctions') {
          try {
            const { data: listings, error: listErr } = await supabase
              .from('external_listings')
              .select('vehicle_id, platform, listing_status, current_bid, end_date, updated_at, listing_url')
              .gt('end_date', nowIso)
              .order('updated_at', { ascending: false })
              .limit(2000);

            if (!listErr && Array.isArray(listings) && listings.length > 0) {
              const byVehicle = new Map<string, any>();
              for (const row of listings as any[]) {
                const vid = String(row?.vehicle_id || '');
                if (!vid) continue;
                if (!byVehicle.has(vid)) byVehicle.set(vid, row);
              }
              const ids = Array.from(byVehicle.keys()).slice(0, 50);
              const { data: vrows } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
                let q = supabase
                  .from('vehicles')
                  .select(selectMini)
                  .eq('is_public', true)
                  .neq('status', 'pending')
                  .in('id', ids);
                if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
                return q;
              });

              const rows = (Array.isArray(vrows) ? vrows : []).map((v: any) => ({
                ...v,
                _listing: byVehicle.get(String(v?.id || '')) || null,
              }));

              if (cancelled) return;
              setStatsPanelRows(rows);
              setStatsPanelMeta({ listing_source: 'external_listings' });
              return;
            }
          } catch {
            // ignore and fall through
          }

          const { data } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
            let q = supabase
              .from('vehicles')
              .select(selectMini)
              .eq('is_public', true)
              .neq('status', 'pending')
              .or('auction_outcome.eq.active,auction_outcome.eq.live')
              .order('updated_at', { ascending: false })
              .limit(24);
            if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
            return q;
          });
          if (cancelled) return;
          setStatsPanelRows(Array.isArray(data) ? (data as any[]) : []);
          setStatsPanelMeta({ listing_source: 'vehicles.auction_outcome' });
          return;
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatsPanelError(String(e?.message || e || 'Failed to load stats panel'));
      } finally {
        if (!cancelled) {
          setStatsPanelLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [statsPanel, runVehiclesQueryWithListingKindFallback]);

  return { statsPanelLoading, statsPanelError, statsPanelRows, statsPanelMeta };
}
