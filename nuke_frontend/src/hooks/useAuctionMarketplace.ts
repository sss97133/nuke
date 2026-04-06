import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolveCurrencyCode } from '../utils/currency';

const AUCTION_PLATFORMS = [
  'bat', 'cars_and_bids', 'collecting_cars', 'broad_arrow',
  'rmsothebys', 'gooding', 'sbx', 'barrettjackson', 'mecum',
] as const;

interface LiveAuction {
  id: string;
  vehicle_id: string;
  platform: string;
  source_url: string | null;
  end_time: string | null;
  current_price_cents: number | null;
  currency_code: string | null;
  bid_count: number;
  comment_count: number | null;
  no_reserve: boolean;
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    mileage: number | null;
    primary_image_url: string | null;
  };
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export function useAuctionMarketplace() {
  return useQuery({
    queryKey: ['auction-marketplace'],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const results: LiveAuction[] = [];
      const recentResults: LiveAuction[] = [];

      // 1. External auctions from vehicle_events
      const { data: events } = await supabase
        .from('vehicle_events')
        .select(`
          id, vehicle_id, source_platform, source_url, ended_at, end_date,
          current_price, current_bid, bid_count, event_status, listing_status,
          reserve_status, no_reserve, metadata, created_at, updated_at,
          currency, currency_code, price_currency,
          vehicle:vehicles (
            id, year, make, model, trim, mileage, primary_image_url,
            bat_comments
          )
        `)
        .in('source_platform', [...AUCTION_PLATFORMS])
        .or(`event_status.eq.active,ended_at.gt.${nowIso}`);

      if (events) {
        const nowMs = Date.now();
        for (const ev of events as any[]) {
          const platform = ev.source_platform;
          const v = ev.vehicle;
          if (!v?.id || !v?.year || !v?.make) continue;

          const rawEnd = ev.ended_at ?? ev.end_date;
          const endDate = rawEnd ? new Date(rawEnd) : null;
          const endMs = endDate && Number.isFinite(endDate.getTime()) ? endDate.getTime() : null;

          if (endMs !== null && (endMs - nowMs) > SIXTY_DAYS_MS) continue;

          const status = String(ev.event_status ?? ev.listing_status ?? '').toLowerCase();
          const isActive = status === 'active' || status === 'live';

          if (endMs !== null && endMs < nowMs && !isActive) continue;
          if (endMs === null && !isActive) continue;

          const inactiveStatuses = new Set(['sold', 'ended', 'cancelled', 'no_sale', 'reserve_not_met', 'withdrawn', 'expired', 'closed', 'archived']);
          if (inactiveStatuses.has(status)) continue;

          const rawPrice = ev.current_price ?? ev.current_bid;
          const priceCents = rawPrice ? Math.round(Number(rawPrice) * 100) : null;
          const currCode = resolveCurrencyCode(
            ev.currency, ev.currency_code, ev.price_currency,
            ev.metadata?.currency, ev.metadata?.currency_code,
            ev.metadata?.priceCurrency,
          );

          const noReserve = ev.no_reserve === true ||
            ev.reserve_status === 'no_reserve' ||
            ev.metadata?.reserve === 'no_reserve' ||
            ev.metadata?.noReserve === true;

          results.push({
            id: ev.id,
            vehicle_id: v.id,
            platform,
            source_url: ev.source_url ?? null,
            end_time: endDate?.toISOString() ?? null,
            current_price_cents: priceCents,
            currency_code: currCode,
            bid_count: Number(ev.bid_count || ev.metadata?.bidCount || 0),
            comment_count: v.bat_comments ?? ev.metadata?.commentCount ?? null,
            no_reserve: noReserve,
            vehicle: {
              id: v.id,
              year: v.year,
              make: v.make,
              model: v.model,
              trim: v.trim ?? null,
              mileage: v.mileage ?? null,
              primary_image_url: v.primary_image_url ?? null,
            },
          });
        }
      }

      // 2. Recently ended auctions (last 48h)
      const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();
      const { data: recentEvents } = await supabase
        .from('vehicle_events')
        .select(`
          id, vehicle_id, source_platform, source_url, ended_at, end_date,
          current_price, current_bid, bid_count, event_status, listing_status,
          reserve_status, no_reserve, metadata, created_at, updated_at,
          currency, currency_code, price_currency,
          vehicle:vehicles (
            id, year, make, model, trim, mileage, primary_image_url,
            bat_comments
          )
        `)
        .in('source_platform', [...AUCTION_PLATFORMS])
        .lt('ended_at', nowIso)
        .gte('ended_at', twoHoursAgo)
        .order('ended_at', { ascending: false })
        .limit(20);

      if (recentEvents) {
        for (const ev of recentEvents as any[]) {
          const v = ev.vehicle;
          if (!v?.id || !v?.year || !v?.make) continue;

          const rawPrice = ev.current_price ?? ev.current_bid;
          const priceCents = rawPrice ? Math.round(Number(rawPrice) * 100) : null;
          const currCode = resolveCurrencyCode(
            ev.currency, ev.currency_code, ev.price_currency,
            ev.metadata?.currency, ev.metadata?.currency_code,
            ev.metadata?.priceCurrency,
          );

          recentResults.push({
            id: ev.id,
            vehicle_id: v.id,
            platform: ev.source_platform,
            source_url: ev.source_url ?? null,
            end_time: ev.ended_at ?? null,
            current_price_cents: priceCents,
            currency_code: currCode,
            bid_count: Number(ev.bid_count || ev.metadata?.bidCount || 0),
            comment_count: v.bat_comments ?? ev.metadata?.commentCount ?? null,
            no_reserve: ev.no_reserve === true ||
              ev.reserve_status === 'no_reserve' ||
              ev.metadata?.reserve === 'no_reserve' ||
              ev.metadata?.noReserve === true,
            vehicle: {
              id: v.id,
              year: v.year,
              make: v.make,
              model: v.model,
              trim: v.trim ?? null,
              mileage: v.mileage ?? null,
              primary_image_url: v.primary_image_url ?? null,
            },
          });
        }
      }

      return { auctions: results, recentAuctions: recentResults };
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

export type { LiveAuction };
