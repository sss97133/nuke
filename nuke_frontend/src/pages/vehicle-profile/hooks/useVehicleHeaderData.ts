import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { VehicleValuationService } from '../../../services/vehicleValuationService';
import { VehicleDeduplicationService } from '../../../services/vehicleDeduplicationService';
import { resolveCurrencyCode } from '../../../utils/currency';
import { formatCurrencyAmount } from '../../../utils/currency';
import { formatCurrency as formatUsdCurrency } from '../../../services/priceSignalService';
import vinDecoderService from '../../../services/vinDecoder';
import { useVINProofs } from '../../../hooks/useVINProofs';
import { useIsMobile } from '../../../hooks/useIsMobile';
import type { Vehicle, VehicleHeaderProps } from '../types';
import { parseMoneyNumber, normalizePartyHandle, isValidUsername, formatRemaining } from '../vehicleHeaderUtils';

// ---- Popover data hook ----
export function usePopoverData(
  activePopover: 'year' | 'make' | 'model' | 'seller' | 'auction' | null,
  vehicle: Vehicle | null,
  auctionPulse: VehicleHeaderProps['auctionPulse']
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
            const { data: identity } = await supabase
              .from('external_identities')
              .select('id, platform, handle, proof_url, claimed_by, first_seen_at, last_seen_at')
              .ilike('handle', sellerHandle)
              .limit(1)
              .maybeSingle();
            const { count: auctionCount } = await supabase
              .from('auction_events')
              .select('id', { count: 'exact', head: true })
              .or(`seller_username.ilike.%${sellerHandle}%`);
            if (!cancelled) setPopoverData({
              handle: sellerHandle,
              identity,
              auctionCount: auctionCount || 0,
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
        if (!cancelled) setPopoverData({});
      } finally {
        if (!cancelled) setPopoverLoading(false);
      }
    };

    fetchPopoverData();
    return () => { cancelled = true; };
  }, [activePopover, vehicle, auctionPulse]);

  return { popoverData, popoverLoading };
}

// ---- Owner popover data hook ----
export function useOwnerPopoverData(
  showOwnerPopover: boolean,
  ownerUsername: string | null | undefined
) {
  const [ownerPopoverLoading, setOwnerPopoverLoading] = useState(false);
  const [ownerPopoverError, setOwnerPopoverError] = useState<string | null>(null);
  const [ownerPopoverData, setOwnerPopoverData] = useState<{
    identityId: string | null;
    claimedByUserId: string | null;
    profileUrl: string | null;
    auctionsWon: number;
    auctionsSold: number;
    commentCount: number;
    lastCommentAt: string | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  } | null>(null);

  useEffect(() => {
    if (!showOwnerPopover) return;
    const raw = String(ownerUsername || '').trim();
    const handle = raw.replace(/^@/, '').trim();
    if (!handle) return;

    let cancelled = false;
    setOwnerPopoverLoading(true);
    setOwnerPopoverError(null);

    (async () => {
      try {
        const proofUrl = `https://bringatrailer.com/member/${handle}/`;
        const { data: identity, error: idErr } = await supabase
          .from('external_identities')
          .select('id, claimed_by_user_id, profile_url, first_seen_at, last_seen_at')
          .eq('platform', 'bat')
          .eq('handle', handle)
          .maybeSingle();

        if (idErr) {
          console.warn('Owner popover identity lookup failed:', idErr);
        }

        const identityId = identity?.id ? String(identity.id) : null;
        const claimedByUserId = identity?.claimed_by_user_id ? String(identity.claimed_by_user_id) : null;
        const profileUrl = String((identity as any)?.profile_url || proofUrl).trim() || proofUrl;
        const firstSeenAt = (identity as any)?.first_seen_at ? String((identity as any).first_seen_at) : null;
        const lastSeenAt = (identity as any)?.last_seen_at ? String((identity as any).last_seen_at) : null;

        const winsQ = supabase
          .from('auction_events')
          .select('id', { count: 'exact', head: true })
          .eq('source', 'bat')
          .ilike('winning_bidder', handle);

        const soldQ = supabase
          .from('auction_events')
          .select('id', { count: 'exact', head: true })
          .eq('source', 'bat')
          .ilike('seller_name', handle);

        const commentsBase = supabase
          .from('auction_comments')
          .select('id', { count: 'exact', head: true })
          .eq('platform', 'bat')
          .is('bid_amount', null);

        const lastCommentBase = supabase
          .from('auction_comments')
          .select('posted_at')
          .eq('platform', 'bat')
          .is('bid_amount', null)
          .order('posted_at', { ascending: false })
          .limit(1);

        const commentsQ = identityId
          ? commentsBase.eq('external_identity_id', identityId)
          : commentsBase.ilike('author_username', handle);

        const lastCommentQ = identityId
          ? lastCommentBase.eq('external_identity_id', identityId)
          : lastCommentBase.ilike('author_username', handle);

        const [winsRes, soldRes, commentsRes, lastCommentRes] = await Promise.all([
          winsQ,
          soldQ,
          commentsQ,
          lastCommentQ,
        ]);

        const lastCommentRow = Array.isArray((lastCommentRes as any)?.data) ? (lastCommentRes as any).data[0] : null;
        const lastCommentAt = lastCommentRow?.posted_at ? String(lastCommentRow.posted_at) : null;

        if (cancelled) return;
        setOwnerPopoverData({
          identityId,
          claimedByUserId,
          profileUrl,
          auctionsWon: (winsRes as any)?.count || 0,
          auctionsSold: (soldRes as any)?.count || 0,
          commentCount: (commentsRes as any)?.count || 0,
          lastCommentAt,
          firstSeenAt,
          lastSeenAt,
        });
      } catch (e: any) {
        if (cancelled) return;
        setOwnerPopoverData(null);
        setOwnerPopoverError(e?.message || 'Failed to load partner signals');
      } finally {
        if (!cancelled) setOwnerPopoverLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showOwnerPopover, ownerUsername]);

  return { ownerPopoverData, ownerPopoverLoading, ownerPopoverError };
}

// ---- Owner guess derivation ----
export function useOwnerGuess(vehicle: Vehicle | null, auctionPulse: VehicleHeaderProps['auctionPulse']) {
  return useMemo(() => {
    const v = vehicle as any;
    if (!v) return null;

    const rawOutcome = String(v?.auction_outcome || '').toLowerCase();
    const saleStatus = String(v?.sale_status || '').toLowerCase();
    const pulseStatus = auctionPulse?.listing_url ? String((auctionPulse as any)?.listing_status || '').toLowerCase() : '';

    const pulseFinal = parseMoneyNumber((auctionPulse as any)?.final_price);
    const pulseSoldAt = (auctionPulse as any)?.sold_at ?? null;
    const telemetryUnsold = pulseStatus === 'reserve_not_met' || pulseStatus === 'no_sale';
    const telemetrySold = pulseStatus === 'sold' && (pulseFinal !== null || !!pulseSoldAt);
    const vehicleUnsold = rawOutcome === 'reserve_not_met' || rawOutcome === 'no_sale';
    const vehicleSold = saleStatus === 'sold' || rawOutcome === 'sold';

    const hasSoldSignal = telemetrySold || (!telemetryUnsold && vehicleSold);

    const normalizeHandle = (raw: string | null | undefined): string | null => {
      const h = String(raw || '').trim();
      if (!h) return null;
      const handle = h
        .replace(/^@/, '')
        .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
        .replace(/\/+$/, '')
        .trim();
      return handle || null;
    };

    const seller =
      normalizeHandle(
        (auctionPulse as any)?.seller_username ||
          (auctionPulse as any)?.metadata?.seller_username ||
          (auctionPulse as any)?.metadata?.seller ||
          v?.bat_seller ||
          v?.origin_metadata?.bat_seller ||
          v?.origin_metadata?.seller ||
          null
      ) || null;

    const buyer =
      normalizeHandle(
        (auctionPulse as any)?.winner_name ||
          (auctionPulse as any)?.metadata?.buyer_username ||
          (auctionPulse as any)?.metadata?.buyer ||
          (auctionPulse as any)?.winning_bidder_name ||
          (auctionPulse as any)?.winner_display_name ||
          v?.bat_buyer ||
          v?.origin_metadata?.bat_buyer ||
          v?.origin_metadata?.buyer ||
          null
      ) || null;

    if (hasSoldSignal) {
      if (buyer && isValidUsername(buyer)) {
        const fromSeller = seller && isValidUsername(seller) ? seller : null;
        return { username: buyer, from: fromSeller, role: 'buyer' as const };
      }
      return null;
    }

    if (seller && isValidUsername(seller)) {
      return { username: seller, from: null, role: 'seller' as const };
    }
    return null;
  }, [vehicle, auctionPulse]);
}

// ---- Price signal and valuation hook ----
export function usePriceData(
  vehicleId: string | undefined,
  initialPriceSignal: any,
  initialValuation: any
) {
  const [rpcSignal, setRpcSignal] = useState<any | null>(initialPriceSignal || null);
  const [valuation, setValuation] = useState<any | null>(initialValuation || null);

  useEffect(() => {
    if (initialPriceSignal) {
      setRpcSignal(initialPriceSignal);
      return;
    }
    (async () => {
      try {
        if (!vehicleId) { setRpcSignal(null); return; }
        const { data, error } = await supabase.rpc('vehicle_price_signal', { vehicle_ids: [vehicleId] });
        if (!error && Array.isArray(data) && data.length > 0) {
          setRpcSignal(data[0]);
        } else {
          setRpcSignal(null);
        }
      } catch {
        setRpcSignal(null);
      }
    })();
  }, [vehicleId, initialPriceSignal]);

  useEffect(() => {
    if (initialValuation) {
      setValuation(initialValuation);
      return;
    }
    (async () => {
      try {
        if (!vehicleId) { setValuation(null); return; }
        const v = await VehicleValuationService.getValuation(vehicleId);
        setValuation(v);
      } catch {
        setValuation(null);
      }
    })();
  }, [vehicleId, initialValuation]);

  return { rpcSignal, valuation };
}

// ---- Price sources hook ----
export function usePriceSources(vehicleId: string | undefined) {
  const [priceSources, setPriceSources] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const checkPriceSources = async () => {
      if (!vehicleId) return;
      const sources: Record<string, boolean> = {};
      const priceFields = ['sale_price', 'asking_price', 'current_value', 'purchase_price', 'msrp'];
      for (const field of priceFields) {
        const { data } = await supabase
          .from('vehicle_field_sources')
          .select('id, is_verified')
          .eq('vehicle_id', vehicleId)
          .eq('field_name', field)
          .eq('is_verified', true)
          .limit(1);
        sources[field] = (data && data.length > 0) || false;
      }
      setPriceSources(sources);
    };
    checkPriceSources();
  }, [vehicleId]);

  return priceSources;
}

// ---- Future auction listing hook ----
export function useFutureAuctionListing(vehicleId: string | undefined) {
  const [futureAuctionListing, setFutureAuctionListing] = useState<any | null>(null);

  useEffect(() => {
    const checkFutureAuction = async () => {
      if (!vehicleId) {
        setFutureAuctionListing(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('external_listings')
          .select('id, platform, listing_url, listing_status, start_date, end_date, metadata')
          .eq('vehicle_id', vehicleId)
          .order('start_date', { ascending: true, nullsFirst: false })
          .limit(10);

        if (error) {
          console.error('Error checking future auctions:', error);
          setFutureAuctionListing(null);
          return;
        }

        const futureListing = (data || []).find((listing: any) => {
          const nowMs = Date.now();
          if (listing.start_date) {
            const startDate = new Date(listing.start_date).getTime();
            if (Number.isFinite(startDate) && startDate > nowMs) return true;
          }
          if (listing.end_date) {
            const endDate = new Date(listing.end_date).getTime();
            if (Number.isFinite(endDate) && endDate > nowMs) return true;
          }
          if (listing.metadata?.sale_date) {
            const saleDate = new Date(listing.metadata.sale_date).getTime();
            if (Number.isFinite(saleDate) && saleDate > nowMs) return true;
          }
          return false;
        });

        setFutureAuctionListing(futureListing || null);
      } catch (error) {
        console.error('Error checking future auctions:', error);
        setFutureAuctionListing(null);
      }
    };
    checkFutureAuction();
  }, [vehicleId]);

  return futureAuctionListing;
}

// ---- Pending details hook ----
export function usePendingDetails(vehicle: Vehicle | null) {
  const [similarVehicles, setSimilarVehicles] = useState<any[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [imageCount, setImageCount] = useState(0);

  useEffect(() => {
    if (!vehicle || (vehicle as any).status !== 'pending') {
      setSimilarVehicles([]);
      setImageCount(0);
      return;
    }

    (async () => {
      const { count } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);
      setImageCount(count || 0);

      if (vehicle.year && vehicle.make && vehicle.model) {
        setLoadingSimilar(true);
        try {
          const matches = await VehicleDeduplicationService.findDuplicates({
            vin: vehicle.vin || undefined,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
          });

          const enriched = await Promise.all(
            matches
              .filter(m => m.existingVehicle.id !== vehicle.id)
              .map(async (match) => {
                const { count } = await supabase
                  .from('vehicle_images')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', match.existingVehicle.id);

                return {
                  id: match.existingVehicle.id,
                  year: match.existingVehicle.year,
                  make: match.existingVehicle.make,
                  model: match.existingVehicle.model,
                  vin: match.existingVehicle.vin,
                  image_count: count || 0,
                  confidence: match.confidence,
                  matchType: match.matchType,
                };
              })
          );

          setSimilarVehicles(enriched);
        } catch (error) {
          console.error('Error loading similar vehicles:', error);
        } finally {
          setLoadingSimilar(false);
        }
      }
    })();
  }, [vehicle?.id, (vehicle as any)?.status, vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.vin]);

  return { similarVehicles, loadingSimilar, imageCount };
}

// ---- Sale settings hook ----
export function useSaleSettings(vehicleId: string | undefined) {
  const [displayMode, setDisplayMode] = useState<'auto'|'estimate'|'auction'|'asking'|'sale'|'purchase'|'msrp'>('auto');
  const [responsibleMode, setResponsibleMode] = useState<'auto'|'owner'|'consigner'|'uploader'|'listed_by'|'custom'>('auto');
  const [responsibleCustom, setResponsibleCustom] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        if (!vehicleId) return;
        const { data, error } = await supabase
          .from('vehicle_sale_settings')
          .select('display_price_mode, display_responsible_mode, display_responsible_custom')
          .eq('vehicle_id', vehicleId)
          .maybeSingle();
        if (!error && data) {
          if (typeof (data as any).display_price_mode === 'string') {
            setDisplayMode(((data as any).display_price_mode as any) || 'auto');
          }
          if (typeof (data as any).display_responsible_mode === 'string') {
            setResponsibleMode(((data as any).display_responsible_mode as any) || 'auto');
          }
          if (typeof (data as any).display_responsible_custom === 'string') {
            setResponsibleCustom((data as any).display_responsible_custom || '');
          }
        }
      } catch {
        // ignore if table/column missing
      }
    })();
  }, [vehicleId]);

  return { displayMode, setDisplayMode, responsibleMode, setResponsibleMode, responsibleCustom, setResponsibleCustom };
}

// ---- Trend data hook ----
export function useTrendData(vehicle: Vehicle | null) {
  const [trendPct, setTrendPct] = useState<number | null>(null);
  const [trendPriceType, setTrendPriceType] = useState<string | null>(null);
  const [trendBaselineValue, setTrendBaselineValue] = useState<number | null>(null);
  const [trendBaselineAsOf, setTrendBaselineAsOf] = useState<string | null>(null);
  const [trendBaselineSource, setTrendBaselineSource] = useState<string | null>(null);
  const [trendOutlierCount, setTrendOutlierCount] = useState<number | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<'live' | '1w' | '30d' | '6m' | '1y' | '5y'>('30d');

  const toggleTrendPeriod = (e: React.MouseEvent) => {
    e.stopPropagation();
    const periods: ('live' | '1w' | '30d' | '6m' | '1y' | '5y')[] = ['live', '1w', '30d', '6m', '1y', '5y'];
    const currentIndex = periods.indexOf(trendPeriod);
    const nextIndex = (currentIndex + 1) % periods.length;
    setTrendPeriod(periods[nextIndex]);
  };

  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) {
          setTrendPct(null);
          setTrendPriceType(null);
          setTrendBaselineValue(null);
          setTrendBaselineAsOf(null);
          setTrendBaselineSource(null);
          setTrendOutlierCount(null);
          return;
        }

        if ((vehicle as any)?.origin_metadata?.price_corrected === true ||
            (vehicle as any)?.origin_metadata?.price_was_corrected === true) {
          setTrendPct(null);
          setTrendPriceType(null);
          setTrendBaselineValue(null);
          setTrendBaselineAsOf(null);
          setTrendBaselineSource(null);
          setTrendOutlierCount(null);
          return;
        }

        if (trendPeriod === 'live') {
          try {
            const { data: builds } = await supabase
              .from('vehicle_builds')
              .select('id')
              .eq('vehicle_id', vehicle.id);

            let recentInvestment = 0;
            if (builds && builds.length > 0) {
              const buildIds = builds.map(b => b.id);
              const since = Date.now() - 24 * 60 * 60 * 1000;
              const { data: recentItems } = await supabase
                .from('build_line_items')
                .select('total_price')
                .in('build_id', buildIds)
                .gte('created_at', new Date(since).toISOString());

              recentInvestment = recentItems?.reduce((sum, item) => sum + (item.total_price || 0), 0) || 0;
            }

            if (recentInvestment > 0) {
              const currentValue = (vehicle as any).current_value || (vehicle as any).purchase_price || 10000;
              const pct = (recentInvestment / currentValue) * 100;
              setTrendPct(pct);
              setTrendPriceType('current');
              setTrendBaselineValue(null);
              setTrendBaselineAsOf(null);
              setTrendBaselineSource('auto');
              setTrendOutlierCount(null);
              return;
            }
          } catch {
            // fall through to baseline trend
          }
        }

        const v: any = vehicle as any;
        const rawOutcome = String(v?.auction_outcome || '').toLowerCase();
        const saleStatus = String(v?.sale_status || '').toLowerCase();
        const isSold = saleStatus === 'sold' || rawOutcome === 'sold';

        let priceType: 'sale' | 'asking' | 'current' | 'purchase' | 'msrp' = 'current';
        if (isSold && typeof v?.sale_price === 'number' && Number.isFinite(v.sale_price) && v.sale_price > 0) {
          priceType = 'sale';
        } else if (!isSold && typeof v?.asking_price === 'number' && Number.isFinite(v.asking_price) && v.asking_price > 0) {
          priceType = 'asking';
        } else if (typeof v?.current_value === 'number' && Number.isFinite(v.current_value) && v.current_value > 0) {
          priceType = 'current';
        } else if (typeof v?.purchase_price === 'number' && Number.isFinite(v.purchase_price) && v.purchase_price > 0) {
          priceType = 'purchase';
        } else if (typeof v?.msrp === 'number' && Number.isFinite(v.msrp) && v.msrp > 0) {
          priceType = 'msrp';
        }

        setTrendPriceType(priceType);

        const periodForRpc = trendPeriod === 'live' ? '1w' : trendPeriod;
        const { data, error } = await supabase.rpc('get_vehicle_price_trend', {
          p_vehicle_id: vehicle.id,
          p_price_type: priceType,
          p_period: periodForRpc,
        });

        if (error) {
          setTrendPct(null);
          setTrendBaselineValue(null);
          setTrendBaselineAsOf(null);
          setTrendBaselineSource(null);
          setTrendOutlierCount(null);
          return;
        }

        const row: any = Array.isArray(data) ? data[0] : data;
        if (!row) {
          setTrendPct(null);
          setTrendBaselineValue(null);
          setTrendBaselineAsOf(null);
          setTrendBaselineSource(null);
          setTrendOutlierCount(null);
          return;
        }

        const pctRaw = row?.delta_pct;
        const pct = typeof pctRaw === 'number' ? pctRaw : (pctRaw != null ? parseFloat(String(pctRaw)) : null);
        setTrendPct(Number.isFinite(pct as any) ? (pct as number) : null);

        const baseRaw = row?.baseline_value;
        const base = typeof baseRaw === 'number' ? baseRaw : (baseRaw != null ? parseFloat(String(baseRaw)) : null);
        setTrendBaselineValue(Number.isFinite(base as any) ? (base as number) : null);
        setTrendBaselineAsOf(row?.baseline_as_of ? String(row.baseline_as_of) : null);
        setTrendBaselineSource(row?.baseline_source ? String(row.baseline_source) : null);

        const outRaw = row?.outlier_count;
        const out = typeof outRaw === 'number' ? outRaw : (outRaw != null ? parseInt(String(outRaw), 10) : null);
        setTrendOutlierCount(Number.isFinite(out as any) ? (out as number) : null);
      } catch {
        setTrendPct(null);
        setTrendPriceType(null);
        setTrendBaselineValue(null);
        setTrendBaselineAsOf(null);
        setTrendBaselineSource(null);
        setTrendOutlierCount(null);
      }
    })();
  }, [vehicle?.id, trendPeriod]);

  return {
    trendPct, trendPriceType, trendBaselineValue, trendBaselineAsOf,
    trendBaselineSource, trendOutlierCount, trendPeriod, toggleTrendPeriod,
  };
}

// ---- Owner profile hook ----
export function useOwnerProfile(
  showOwnerCard: boolean,
  vehicle: Vehicle | null,
  sessionUserId: string | undefined
) {
  const [ownerProfile, setOwnerProfile] = useState<any | null>(null);
  const [ownerStats, setOwnerStats] = useState<{ contributions: number; vehicles: number } | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);

  useEffect(() => {
    if (!showOwnerCard) return;
    (async () => {
      try {
        const ownerId = (vehicle as any)?.uploaded_by || (vehicle as any)?.user_id;
        if (!ownerId) return;
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url')
          .eq('id', ownerId)
          .maybeSingle();
        setOwnerProfile(profile || null);
        const { count: contribCount } = await supabase
          .from('user_contributions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', ownerId);
        const { count: vehicleCount } = await supabase
          .from('vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', ownerId);
        setOwnerStats({ contributions: contribCount || 0, vehicles: vehicleCount || 0 });
        if (sessionUserId) {
          const { data: follow } = await supabase
            .from('user_follows')
            .select('id')
            .eq('follower_id', sessionUserId)
            .eq('following_id', ownerId)
            .maybeSingle();
          setIsFollowing(!!follow);
        }
      } catch (err) {
        console.warn('Owner card load failed:', err);
      }
    })();
  }, [showOwnerCard, vehicle, sessionUserId]);

  return { ownerProfile, ownerStats, isFollowing, setIsFollowing };
}

// ---- Transfer status hook ----
export function useTransferStatus(vehicleId: string | undefined) {
  const [transferStatus, setTransferStatus] = useState<{
    transfer_id: string;
    status: string;
    progress: { completed: number; total: number; pct: number };
    current_milestone: { type: string; label: string; status: string; deadline_at: string | null } | null;
    days_since_activity: number | null;
    buyer: { handle: string; platform: string; claimed: boolean } | null;
  } | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    supabase.functions.invoke('transfer-status-api', { body: { vehicle_id: vehicleId } })
      .then(({ data }) => {
        if (!cancelled && data?.transfer_id) setTransferStatus(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vehicleId]);

  return transferStatus;
}

// ---- Auction timer hook ----
export function useAuctionTimer(auctionEndDateForTimer: string | null) {
  const [auctionNow, setAuctionNow] = useState<number>(() => Date.now());
  const lastUpdateRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!auctionEndDateForTimer) return;
    const tick = () => {
      const now = Date.now();
      setAuctionNow(now);
      lastUpdateRef.current = now;
    };
    tick();
    const id = window.setInterval(() => {
      const isVisible = document.visibilityState === 'visible';
      const now = Date.now();
      if (isVisible) {
        tick();
      } else {
        if (now - lastUpdateRef.current >= 10000) {
          tick();
        }
      }
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [auctionEndDateForTimer]);

  return auctionNow;
}

// ---- Location display hook ----
export function useLocationDisplay(vehicle: Vehicle | null) {
  return useMemo(() => {
    const v = vehicle as any;
    if (!v) return null;
    const city = v?.city;
    const state = v?.state;
    const zip = v?.zip_code;
    const country = v?.country;
    const batLoc = v?.bat_location;
    const listingLoc = v?.listing_location || v?.listing_location_raw;

    const extractState = (loc: string) => {
      const m = loc.match(/,\s*([A-Z]{2})\b/);
      return m ? m[1] : null;
    };

    const resolvedState = state && state !== ':' && state.length <= 3 ? state : (
      batLoc ? extractState(batLoc) : listingLoc ? extractState(listingLoc) : null
    );

    if (zip && city && resolvedState) {
      return {
        short: `${zip} ${resolvedState}`,
        full: `${zip} ${city}, ${resolvedState}`,
        compact: zip,
        minimal: resolvedState,
      };
    }
    if (zip && resolvedState) {
      return { short: `${zip} ${resolvedState}`, full: `${zip} ${resolvedState}`, compact: zip, minimal: resolvedState };
    }
    if (zip) {
      return { short: zip, full: zip, compact: zip, minimal: zip };
    }
    if (city && resolvedState) {
      return { short: `${city}, ${resolvedState}`, full: `${city}, ${resolvedState}`, compact: resolvedState, minimal: resolvedState };
    }
    if (resolvedState) {
      return { short: resolvedState, full: resolvedState, compact: resolvedState, minimal: resolvedState };
    }
    if (batLoc && batLoc !== 'United States') {
      return { short: batLoc, full: batLoc, compact: batLoc.slice(0, 5), minimal: batLoc.slice(0, 2).toUpperCase() };
    }
    if (listingLoc) {
      return { short: listingLoc, full: listingLoc, compact: listingLoc.slice(0, 5), minimal: listingLoc.slice(0, 2).toUpperCase() };
    }
    if (country && country !== 'USA' && country !== 'US') {
      return { short: country.slice(0, 3).toUpperCase(), full: country, compact: country.slice(0, 3).toUpperCase(), minimal: country.slice(0, 2).toUpperCase() };
    }
    return null;
  }, [(vehicle as any)?.city, (vehicle as any)?.state, (vehicle as any)?.country, (vehicle as any)?.bat_location, (vehicle as any)?.listing_location, (vehicle as any)?.zip_code]);
}

// ---- Currency formatting hook ----
export function useAuctionCurrency(vehicle: Vehicle | null, auctionPulse: VehicleHeaderProps['auctionPulse']) {
  const auctionCurrency = useMemo(() => {
    const v: any = vehicle as any;
    if (!v) return null;
    const externalListing = v?.external_listings?.[0];
    const pulseMeta = (auctionPulse as any)?.metadata;
    return resolveCurrencyCode(
      pulseMeta?.currency,
      pulseMeta?.currency_code,
      pulseMeta?.currencyCode,
      pulseMeta?.price_currency,
      pulseMeta?.priceCurrency,
      externalListing?.currency,
      externalListing?.currency_code,
      externalListing?.price_currency,
      externalListing?.metadata?.currency,
      externalListing?.metadata?.currency_code,
      externalListing?.metadata?.currencyCode,
      externalListing?.metadata?.price_currency,
      externalListing?.metadata?.priceCurrency,
      v?.origin_metadata?.currency,
      v?.origin_metadata?.currency_code,
      v?.origin_metadata?.price_currency,
      v?.origin_metadata?.priceCurrency,
      v?.origin_metadata?.priceCurrencyCode,
    );
  }, [vehicle, auctionPulse]);

  const formatCurrency = (value?: number | null) => {
    if (auctionCurrency) {
      return formatCurrencyAmount(value, {
        currency: auctionCurrency,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
        fallback: '\u2014',
      });
    }
    return formatUsdCurrency(value);
  };

  return { auctionCurrency, formatCurrency };
}

// ---- VIN validation hook ----
export function useVinValidation(vehicle: Vehicle | null) {
  const { summary: vinProofSummary } = useVINProofs(vehicle?.id);
  const vinIsEvidenceBacked = !!vinProofSummary?.hasConclusiveProof;
  const vinLooksValid = useMemo(() => {
    const raw = (vehicle as any)?.vin;
    if (!raw || typeof raw !== 'string') return false;
    const v = raw.trim();
    if (!v) return false;
    const validation = vinDecoderService.validateVIN(v);
    if (!validation.valid) return false;
    if (!/\d/.test(validation.normalized)) return false;
    return true;
  }, [(vehicle as any)?.vin]);

  return { vinProofSummary, vinIsEvidenceBacked, vinLooksValid };
}

// Re-export isMobile for convenience
export { useIsMobile };
