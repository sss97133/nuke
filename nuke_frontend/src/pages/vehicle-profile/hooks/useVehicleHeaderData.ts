import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Vehicle, AuctionPulse } from '../types';
import { parseMoneyNumber, normalizePartyHandle, isValidUsername, formatRemaining } from '../vehicleHeaderUtils';

/** Recent keyed seller lots, one per source URL; unresolved outcomes stay outside sell-through. */
export function summarizeSellerLots(rows: any[], make?: string | null, model?: string | null) {
  const seen = new Set<string>();
  const lots = rows.filter(row => {
    const key = String(row.source_url || '').replace(/[#?].*$/, '').replace(/\/$/, '');
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 50);
  const resolved = lots.filter(row => ['sold', 'reserve_not_met', 'unsold', 'no_sale'].includes(row.outcome));
  const vehicles = new Set(lots.map(row => row.vehicle_id));
  return {
    n: lots.length, capped: rows.length > 50,
    sold: resolved.filter(row => row.outcome === 'sold').length, resolved: resolved.length,
    unresolved: lots.length - resolved.length,
    sameModel: make && model ? lots.filter(row => row.vehicle?.make === make && row.vehicle?.model === model).length : null,
    repeatLots: lots.length - vehicles.size,
    firstClose: lots[lots.length - 1]?.auction_end_date, lastClose: lots[0]?.auction_end_date,
    rows: lots.slice(0, 3),
  };
}

// ---- Popover data hook ----
export function usePopoverData(
  activePopover: 'year' | 'make' | 'model' | 'seller' | 'auction' | null,
  vehicle: Vehicle | null,
  auctionPulse: AuctionPulse | null
) {
  const [popoverData, setPopoverData] = useState<any>(null);
  const [popoverLoading, setPopoverLoading] = useState(false);

  useEffect(() => {
    if (!activePopover || !vehicle) return;
    let cancelled = false;
    setPopoverLoading(true);
    setPopoverData(null);

    const fetchPopoverData = async () => {
      try {
        if (activePopover === 'year' && vehicle.year) {
          const { data } = await supabase.rpc('get_year_market_stats', { p_year: vehicle.year }).maybeSingle();
          if (!cancelled) setPopoverData(data || { year: vehicle.year });
        } else if (activePopover === 'make' && vehicle.make) {
          const { data } = await supabase.rpc('get_make_market_stats', { p_make: vehicle.make }).maybeSingle();
          if (!cancelled) setPopoverData(data || { make: vehicle.make });
        } else if (activePopover === 'model' && vehicle.make) {
          const model = (vehicle as any)?.normalized_model || vehicle?.model;
          const { data } = await supabase.rpc('get_model_market_stats', { p_make: vehicle.make, p_model: model || '' }).maybeSingle();
          if (!cancelled) setPopoverData(data || { make: vehicle.make, model });
        } else if (activePopover === 'seller') {
          const sellerHandle = normalizePartyHandle(
            (auctionPulse as any)?.seller_username ||
            (auctionPulse as any)?.metadata?.seller_username ||
            (auctionPulse as any)?.metadata?.seller ||
            (vehicle as any)?.bat_seller ||
            (vehicle as any)?.origin_metadata?.bat_seller ||
            (vehicle as any)?.origin_metadata?.seller ||
            null
          );
          if (sellerHandle) {
            const rawPlatform = String(auctionPulse?.platform || '').toLowerCase();
            const platform = ['bat', 'bringatrailer', 'bring_a_trailer'].includes(rawPlatform) ? 'bat' : rawPlatform;
            const { data: identities, error: identityError } = await supabase
              .from('external_identities')
              .select('id, platform, handle, profile_url')
              .eq('platform', platform)
              .ilike('handle', sellerHandle.replace(/[\\%_]/g, '\\$&'))
              .limit(2);
            if (identityError) throw identityError;
            // A handle collision needs identity resolution, not an arbitrary LIMIT 1 choice.
            const identity = identities?.length === 1 ? identities[0] : null;
            if (!identity) {
              if (!cancelled) setPopoverData({ handle: sellerHandle, sellerUnavailable: true });
              return;
            }
            const { data: lots, error: lotsError } = await supabase
              .from('auction_events')
              .select('id, vehicle_id, source_url, outcome, auction_end_date, scraped_at, vehicle:vehicles!auction_events_vehicle_id_fkey!inner(make, model)')
              .eq('seller_external_identity_id', identity.id)
              .neq('vehicle_id', vehicle.id)
              .eq('vehicle.is_public', true).is('vehicle.deleted_at', null).is('vehicle.merged_into_vehicle_id', null)
              .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicle' })
              .lt('auction_end_date', new Date().toISOString())
              .order('auction_end_date', { ascending: false })
              .limit(51);
            if (lotsError) throw lotsError;
            if (!cancelled) setPopoverData({ handle: sellerHandle, identity,
              sellerEvidence: summarizeSellerLots(lots || [], vehicle.make, vehicle.model),
            });
          } else {
            if (!cancelled) setPopoverData({ handle: null });
          }
        } else if (activePopover === 'auction') {
          const v = vehicle as any;
          if (!cancelled) setPopoverData({
            platform: v?.profile_origin || v?.discovery_source || (auctionPulse as any)?.platform,
            listingUrl: (auctionPulse as any)?.listing_url || v?.bat_auction_url || v?.discovery_url || v?.listing_url,
            bidCount: (auctionPulse as any)?.bid_count || v?.bid_count,
            viewCount: (auctionPulse as any)?.view_count,
            watcherCount: (auctionPulse as any)?.watcher_count,
            commentCount: (auctionPulse as any)?.comment_count,
            listingStatus: (auctionPulse as any)?.listing_status || v?.auction_outcome,
            currentBid: (auctionPulse as any)?.current_bid,
            finalPrice: (auctionPulse as any)?.final_price,
          });
        }
      } catch (err) {
        console.warn('Popover data fetch failed:', err);
        if (!cancelled) setPopoverData({ unavailable: true });
      } finally {
        if (!cancelled) setPopoverLoading(false);
      }
    };

    fetchPopoverData();
    return () => { cancelled = true; };
  }, [activePopover, vehicle, auctionPulse]);

  return { popoverData, popoverLoading };
}
