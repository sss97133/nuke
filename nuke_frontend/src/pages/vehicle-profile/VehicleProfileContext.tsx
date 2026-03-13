/**
 * VehicleProfileContext — Single source of truth for vehicle profile data.
 *
 * Replaces the 36 useState hooks and 26-prop drilling pattern in VehicleProfile.tsx.
 * All data fetching happens here. Components call useVehicleProfile() to read data.
 *
 * Pattern modeled after AuthContext.tsx.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { readCachedSession } from '../../utils/cachedSession';
import { useVehiclePermissions } from '../../hooks/useVehiclePermissions';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { AdminNotificationService } from '../../services/adminNotificationService';
import { buildAuctionPulseFromExternalListings } from './buildAuctionPulse';
import { loadVehicleImpl, selectBestHeroImage } from './loadVehicleData';
import { loadVehicleImagesImpl } from './loadVehicleImages';
import { resolveVehicleImages } from './resolveVehicleImages';
import type { Vehicle, VehiclePermissions, LiveSession, AuctionPulse } from './types';
import type { HeroImageMeta } from './loadVehicleData';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface VehicleProfileContextValue {
  // Core data
  vehicleId: string | undefined;
  vehicle: Vehicle | null;
  vehicleImages: string[];
  fallbackListingImageUrls: string[];
  timelineEvents: any[];
  totalCommentCount: number;
  observationCount: number;

  // Hero
  leadImageUrl: string | null;
  heroMeta: HeroImageMeta | null;

  // Auction
  auctionPulse: AuctionPulse | null;
  liveSession: LiveSession | null;

  // Auth & permissions
  session: any;
  permissions: VehiclePermissions;
  isRowOwner: boolean;
  isVerifiedOwner: boolean;
  hasContributorAccess: boolean;
  canEdit: boolean;
  isAdminUser: boolean;
  canTriggerProofAnalysis: boolean;
  userOwnershipClaim: any;

  // UI state
  loading: boolean;
  isMobile: boolean;
  isPublic: boolean;
  vehicleHeaderHeight: number;

  // Actions
  reloadVehicle: () => void;
  reloadImages: () => void;
  reloadTimeline: () => void;
  setIsPublic: (v: boolean) => void;
  setVehicleHeaderHeight: (h: number) => void;
}

const VehicleProfileContext = createContext<VehicleProfileContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVehicleProfile(): VehicleProfileContextValue {
  const ctx = useContext(VehicleProfileContext);
  if (!ctx) throw new Error('useVehicleProfile must be used within VehicleProfileProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const VehicleProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();

  // ── Core data ──
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleImages, setVehicleImages] = useState<string[]>([]);
  const [fallbackListingImageUrls, setFallbackListingImageUrls] = useState<string[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [totalCommentCount, setTotalCommentCount] = useState(0);
  const [observationCount, setObservationCount] = useState(0);

  // ── Hero ──
  const [leadImageUrl, setLeadImageUrl] = useState<string | null>(null);
  const [heroMeta, setHeroMeta] = useState<HeroImageMeta | null>(null);

  // ── Auction ──
  const [auctionPulse, setAuctionPulse] = useState<AuctionPulse | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);

  // ── Auth ──
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [authChecked, setAuthChecked] = useState(() => readCachedSession() !== null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ownershipVerifications, setOwnershipVerifications] = useState<any[]>([]);

  // ── UI ──
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [vehicleHeaderHeight, setVehicleHeaderHeight] = useState(88);

  // ── Refs ──
  const ranBatSyncRef = useRef<string | null>(null);

  // ── Permissions ──
  const {
    isOwner: isRowOwner,
    hasContributorAccess,
    contributorRole,
    canEdit,
  } = useVehiclePermissions(vehicleId || null, session, vehicle);
  const { isAdmin: isAdminUser } = useAdminAccess();

  const userOwnershipClaim = useMemo(() => {
    const uid = session?.user?.id;
    if (!uid) return null;
    return (ownershipVerifications || []).find((v: any) => v?.user_id === uid) || null;
  }, [ownershipVerifications, session?.user?.id]);

  const isVerifiedOwner = Boolean(vehicle?.ownership_verified) || (() => {
    if (!userOwnershipClaim) return false;
    const hasTitle = !!userOwnershipClaim.title_document_url && userOwnershipClaim.title_document_url !== 'pending';
    const hasId = !!userOwnershipClaim.drivers_license_url && userOwnershipClaim.drivers_license_url !== 'pending';
    return userOwnershipClaim.status === 'approved' && hasTitle && hasId;
  })();

  const isDbUploader = Boolean(session?.user?.id && vehicle?.uploaded_by === session.user.id);
  const canTriggerProofAnalysis = Boolean(isRowOwner || isVerifiedOwner || hasContributorAccess || isAdminUser);

  const permissions: VehiclePermissions = {
    isVerifiedOwner: Boolean(isVerifiedOwner),
    hasContributorAccess: Boolean(hasContributorAccess),
    contributorRole: contributorRole ? String(contributorRole) : null,
    isDbUploader: Boolean(isDbUploader),
  };

  // ── Data fetching ──

  const loadVehicle = useCallback(() => {
    if (!vehicleId) return;
    loadVehicleImpl({
      vehicleId,
      session,
      leadImageUrl,
      supabase,
      navigate,
      ranBatSyncRef,
      setLoading,
      setVehicle,
      setIsPublic,
      setLeadImageUrl,
      setVehicleImages,
      setTimelineEvents,
      setAuctionPulse: setAuctionPulse as any,
    });
    selectBestHeroImage(vehicleId, supabase).then((result) => {
      if (result?.url) {
        setLeadImageUrl(result.url);
        setHeroMeta(result.meta);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, session, navigate]);

  const loadVehicleImages = useCallback(async () => {
    if (!vehicle?.id) return;
    const result = await resolveVehicleImages(vehicle.id);
    setVehicleImages(result.urls);
    if (result.leadUrl) setLeadImageUrl(result.leadUrl);
  }, [vehicle?.id]);

  const loadTimelineEvents = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { data, error } = await supabase
        .from('timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false })
        .limit(200);
      if (!error && data) setTimelineEvents(data);
    } catch { /* ignore */ }
  }, [vehicleId]);

  const loadTotalCommentCount = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { count } = await supabase
        .from('vehicle_comments')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);
      if (count !== null) setTotalCommentCount(count);
    } catch { /* ignore */ }
  }, [vehicleId]);

  const loadOwnershipVerifications = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { data } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('vehicle_id', vehicleId);
      if (data) setOwnershipVerifications(data);
    } catch { /* ignore */ }
  }, [vehicleId]);

  const loadLiveSession = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { data } = await supabase
        .from('live_sessions')
        .select('id, platform, stream_url, title, stream_provider')
        .eq('vehicle_id', vehicleId)
        .eq('is_active', true)
        .maybeSingle();
      setLiveSession(data || null);
    } catch { /* ignore */ }
  }, [vehicleId]);

  // ── Auth bootstrap ──

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      setAuthChecked(true);
      if (s?.user) {
        const admin = await AdminNotificationService.isCurrentUserAdmin();
        setIsAdmin(admin);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // ── Initial data load ──

  useEffect(() => {
    if (!vehicleId || !authChecked) return;
    loadVehicle();
    loadTimelineEvents();
    loadOwnershipVerifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, authChecked]);

  useEffect(() => {
    if (!vehicle?.id) return;
    loadVehicleImages();
    loadTotalCommentCount();
    loadLiveSession();
    supabase
      .from('vehicle_observations')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id)
      .then(({ count }) => { if (count !== null) setObservationCount(count); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  // ── Mobile detection ──

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Realtime subscriptions ──

  useEffect(() => {
    if (!vehicle?.id) return;
    const id = vehicle.id;
    const channel = supabase
      .channel(`vp-ctx:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vehicles', filter: `id=eq.${id}` }, () => loadVehicle())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_images', filter: `vehicle_id=eq.${id}` }, () => loadVehicleImages())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timeline_events', filter: `vehicle_id=eq.${id}` }, () => loadTimelineEvents())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  // ── Auction pulse realtime: vehicle_events + auction_comments ──

  useEffect(() => {
    if (!vehicle?.id) return;
    const vehicleIdForFilter = vehicle.id;

    const channel = supabase
      .channel(`auction-pulse:${vehicleIdForFilter}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicle_events', filter: `vehicle_id=eq.${vehicleIdForFilter}` },
        (payload) => {
          const row = (payload as any)?.new as any;
          if (!row) return;
          if (auctionPulse?.listing_url && row.source_url && row.source_url !== auctionPulse.listing_url) return;

          (async () => {
            try {
              const { data } = await supabase
                .from('vehicle_events')
                .select('source_platform, source_url, event_status, ended_at, current_price, bid_count, watcher_count, view_count, metadata, updated_at')
                .eq('vehicle_id', vehicleIdForFilter)
                .order('updated_at', { ascending: false })
                .limit(20);
              const normalized = (Array.isArray(data) ? data : []).map((r: any) => ({
                platform: r.source_platform, listing_url: r.source_url, listing_status: r.event_status,
                end_date: r.ended_at, current_bid: r.current_price, bid_count: r.bid_count,
                watcher_count: r.watcher_count, view_count: r.view_count, metadata: r.metadata, updated_at: r.updated_at,
              }));
              const merged = buildAuctionPulseFromExternalListings(normalized, vehicleIdForFilter);
              if (merged) setAuctionPulse((prev: any) => ({ ...(prev || {}), ...merged }));
            } catch { /* ignore */ }
          })();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'auction_comments', filter: `vehicle_id=eq.${vehicleIdForFilter}` },
        (payload) => {
          const row = (payload as any)?.new as any;
          const postedAt = row?.posted_at ? String(row.posted_at) : null;
          const isBid = row?.bid_amount !== null && row?.bid_amount !== undefined;
          setAuctionPulse((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              comment_count: typeof prev.comment_count === 'number' ? prev.comment_count + 1 : 1,
              last_comment_at: postedAt || prev.last_comment_at || null,
              last_bid_at: isBid ? (postedAt || prev.last_bid_at || null) : (prev.last_bid_at || null),
            };
          });
        },
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {
        try { channel.unsubscribe(); } catch { /* ignore */ }
      }
    };
  }, [vehicle?.id, auctionPulse?.listing_url, auctionPulse?.platform]);

  // ── Auction pulse polling (60s) ──

  useEffect(() => {
    if (!vehicle?.id) return;
    if (!auctionPulse?.listing_url) return;

    let cancelled = false;

    const refreshAuctionPulse = async () => {
      try {
        const { data: events } = await supabase
          .from('vehicle_events')
          .select('source_platform, source_url, event_status, ended_at, current_price, bid_count, watcher_count, view_count, metadata, updated_at')
          .eq('vehicle_id', vehicle!.id)
          .eq('source_url', auctionPulse?.listing_url || '')
          .order('updated_at', { ascending: false })
          .limit(20);

        const normalized = (Array.isArray(events) ? events : []).map((r: any) => ({
          platform: r.source_platform, listing_url: r.source_url, listing_status: r.event_status,
          end_date: r.ended_at, current_bid: r.current_price, bid_count: r.bid_count,
          watcher_count: r.watcher_count, view_count: r.view_count, metadata: r.metadata, updated_at: r.updated_at,
        }));
        const merged = buildAuctionPulseFromExternalListings(normalized, vehicle!.id);
        const platform = String((merged as any)?.platform || auctionPulse?.platform || '');
        const listingUrl = String((merged as any)?.listing_url || auctionPulse?.listing_url || '');

        let commentCount: number | null =
          typeof (merged as any)?.comment_count === 'number'
            ? (merged as any).comment_count
            : (typeof auctionPulse?.comment_count === 'number' ? auctionPulse.comment_count : null);
        let lastBidAt: string | null = (auctionPulse as any)?.last_bid_at || null;
        let lastCommentAt: string | null = (auctionPulse as any)?.last_comment_at || null;

        try {
          const [cCount, lastBid, lastComment, lastSeller] = await Promise.all([
            commentCount === null
              ? supabase.from('auction_comments').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicle!.id)
              : Promise.resolve({ count: commentCount } as any),
            supabase.from('auction_comments').select('posted_at, author_username').eq('vehicle_id', vehicle!.id)
              .not('bid_amount', 'is', null).order('posted_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('auction_comments').select('posted_at').eq('vehicle_id', vehicle!.id)
              .order('posted_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('auction_comments').select('author_username').eq('vehicle_id', vehicle!.id)
              .eq('is_seller', true).order('posted_at', { ascending: false }).limit(1).maybeSingle(),
          ]);

          if (commentCount === null) commentCount = typeof (cCount as any)?.count === 'number' ? (cCount as any).count : null;
          lastBidAt = (lastBid as any)?.data?.posted_at || lastBidAt;
          lastCommentAt = (lastComment as any)?.data?.posted_at || lastCommentAt;
          const winnerName = String((lastBid as any)?.data?.author_username || '').trim() || null;
          const sellerUsername = String((lastSeller as any)?.data?.author_username || '').trim() || null;
          if (!cancelled) {
            setAuctionPulse((prev: any) => ({
              ...(prev || {}),
              winner_name: winnerName ?? (prev?.winner_name ?? null),
              seller_username: sellerUsername ?? (prev?.seller_username ?? null),
            }));
          }
        } catch { /* ignore telemetry failures */ }

        if (!cancelled) {
          setAuctionPulse({
            platform,
            listing_url: listingUrl,
            listing_status: String((merged as any)?.listing_status || auctionPulse?.listing_status || ''),
            end_date: (merged as any)?.end_date ?? auctionPulse?.end_date ?? null,
            current_bid: typeof (merged as any)?.current_bid === 'number' ? (merged as any).current_bid : (auctionPulse?.current_bid ?? null),
            bid_count: typeof (merged as any)?.bid_count === 'number' ? (merged as any).bid_count : (auctionPulse?.bid_count ?? null),
            watcher_count: typeof (merged as any)?.watcher_count === 'number' ? (merged as any).watcher_count : (auctionPulse?.watcher_count ?? null),
            view_count: typeof (merged as any)?.view_count === 'number' ? (merged as any).view_count : (auctionPulse?.view_count ?? null),
            comment_count: commentCount,
            last_bid_at: lastBidAt,
            last_comment_at: lastCommentAt,
            updated_at: (merged as any)?.updated_at ?? auctionPulse?.updated_at ?? null,
            metadata: (merged as any)?.metadata ?? (auctionPulse as any)?.metadata ?? null,
            winner_name: (auctionPulse as any)?.winner_name ?? null,
            seller_username: (auctionPulse as any)?.seller_username ?? null,
          } as any);
        }
      } catch { /* ignore refresh failures */ }
    };

    refreshAuctionPulse();
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshAuctionPulse();
    }, 60000);

    return () => { cancelled = true; window.clearInterval(id); };
  }, [vehicle?.id, auctionPulse?.listing_url]);

  // ── Fallback listing images (BaT/C&B vehicles with no DB images) ──

  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) return;
        const hasDbImages = vehicleImages.length > 0;
        if (hasDbImages) {
          if (fallbackListingImageUrls.length > 0) setFallbackListingImageUrls([]);
          return;
        }
        const origin = String((vehicle as any)?.profile_origin || '');
        const discoveryUrl = String((vehicle as any)?.discovery_url || '');
        const listingUrl =
          String((auctionPulse as any)?.listing_url || '').trim() ||
          discoveryUrl ||
          String((vehicle as any)?.bat_auction_url || '').trim() ||
          String((vehicle as any)?.listing_url || '').trim();
        const isBat = origin === 'bat_import' || listingUrl.includes('bringatrailer.com/listing/');
        const isCarsAndBids = listingUrl.includes('carsandbids.com/auctions/');
        if (!isBat && !isCarsAndBids) return;
        if (fallbackListingImageUrls.length > 0) return;

        const cacheKey = isCarsAndBids
          ? `carsandbids_fallback_images_${vehicle.id}`
          : `bat_fallback_images_${vehicle.id}`;

        const filterNonPhotoUrls = (arr: string[]): string[] => {
          const urls = Array.isArray(arr) ? arr : [];
          const keep = urls.filter((rawUrl) => {
            const raw = String(rawUrl || '').trim();
            if (!raw || !raw.startsWith('http')) return false;
            const s = raw.toLowerCase();
            if (s.includes('gstatic.com/faviconv2')) return false;
            if (s.includes('favicon.ico') || s.includes('/favicon')) return false;
            if (s.includes('apple-touch-icon')) return false;
            if (s.endsWith('.ico')) return false;
            if (s.includes('bringatrailer.com/wp-content/uploads/')) {
              if (s.includes('qotw') || s.includes('winner-template') || s.includes('weekly-weird') ||
                  s.includes('mile-marker') || s.includes('podcast') || s.includes('merch') ||
                  s.includes('dec-merch') || s.includes('podcast-graphic') ||
                  s.includes('site-post-') || s.includes('thumbnail-template') ||
                  s.includes('screenshot-') || s.includes('countries/') ||
                  s.includes('themes/') || s.includes('assets/img/') ||
                  /\/web-\d{3,}-/i.test(s)) {
                return false;
              }
            }
            try {
              const u = new URL(raw);
              const sizeParam = u.searchParams.get('size') || u.searchParams.get('sz') || u.searchParams.get('w') || u.searchParams.get('width');
              if (sizeParam) {
                const n = Number(String(sizeParam).replace(/[^0-9.]/g, ''));
                if (Number.isFinite(n) && n > 0 && n <= 64) return false;
              }
            } catch { /* ignore */ }
            return true;
          });
          return keep.length > 0 ? keep : urls;
        };

        // Check localStorage cache first
        try {
          const cached = typeof window !== 'undefined' ? window.localStorage.getItem(cacheKey) : null;
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const urls = filterNonPhotoUrls(parsed.filter((u: any) => typeof u === 'string' && u.startsWith('http')));
              if (urls.length > 0) {
                setFallbackListingImageUrls(urls);
                if (!leadImageUrl && urls[0]) setLeadImageUrl(urls[0]);
                return;
              }
            }
          }
        } catch { /* ignore */ }

        if (isCarsAndBids) {
          try {
            const { data: listings } = await supabase
              .from('vehicle_events')
              .select('metadata')
              .eq('vehicle_id', vehicle.id)
              .eq('source_url', listingUrl)
              .order('updated_at', { ascending: false })
              .limit(5);
            const meta = Array.isArray(listings) && listings.length > 0 ? (listings[0] as any)?.metadata : null;
            const images: string[] =
              (Array.isArray(meta?.image_urls) ? meta.image_urls : null) ||
              (Array.isArray(meta?.images) ? meta.images : null) || [];
            const filtered = filterNonPhotoUrls(images);
            if (filtered.length > 0) {
              setFallbackListingImageUrls(filtered);
              try { window.localStorage.setItem(cacheKey, JSON.stringify(filtered.slice(0, 250))); } catch { /* ignore */ }
              if (!leadImageUrl && filtered[0]) setLeadImageUrl(filtered[0]);
            }
          } catch { /* ignore */ }
          return;
        }

        if (!isBat || !listingUrl.includes('bringatrailer.com/listing/')) return;
        const { data, error } = await supabase.functions.invoke('simple-scraper', {
          body: { url: listingUrl },
        });
        if (error) throw error;
        const images: string[] =
          (data?.success && Array.isArray(data?.data?.images) ? data.data.images : null) ||
          (Array.isArray(data?.images) ? data.images : null) || [];
        const filtered = filterNonPhotoUrls(images);
        if (filtered.length > 0) {
          setFallbackListingImageUrls(filtered);
          try { window.localStorage.setItem(cacheKey, JSON.stringify(filtered.slice(0, 250))); } catch { /* ignore */ }
          if (!leadImageUrl && filtered[0]) setLeadImageUrl(filtered[0]);
        }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, (vehicle as any)?.profile_origin, (vehicle as any)?.discovery_url, auctionPulse?.listing_url, vehicleImages.length]);

  // ── Event listeners ──

  useEffect(() => {
    if (!vehicleId) return;
    const imageHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (vid && vid !== vehicleId) return;
      loadVehicleImages();
      loadTimelineEvents();
    };
    const timelineHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (vid && vid !== vehicleId) return;
      loadTimelineEvents();
    };
    window.addEventListener('vehicle_images_updated', imageHandler);
    window.addEventListener('timeline_updated', timelineHandler);
    return () => {
      window.removeEventListener('vehicle_images_updated', imageHandler);
      window.removeEventListener('timeline_updated', timelineHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  // ── Context value ──

  const value = useMemo<VehicleProfileContextValue>(() => ({
    vehicleId,
    vehicle,
    vehicleImages,
    fallbackListingImageUrls,
    timelineEvents,
    totalCommentCount,
    observationCount,
    leadImageUrl,
    heroMeta,
    auctionPulse,
    liveSession,
    session,
    permissions,
    isRowOwner,
    isVerifiedOwner,
    hasContributorAccess,
    canEdit,
    isAdminUser,
    canTriggerProofAnalysis,
    userOwnershipClaim,
    loading,
    isMobile,
    isPublic,
    vehicleHeaderHeight,
    reloadVehicle: loadVehicle,
    reloadImages: loadVehicleImages,
    reloadTimeline: loadTimelineEvents,
    setIsPublic,
    setVehicleHeaderHeight,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    vehicleId, vehicle, vehicleImages, fallbackListingImageUrls,
    timelineEvents, totalCommentCount, observationCount,
    leadImageUrl, heroMeta, auctionPulse, liveSession,
    session, isRowOwner, isVerifiedOwner, hasContributorAccess,
    canEdit, isAdminUser, canTriggerProofAnalysis, userOwnershipClaim,
    loading, isMobile, isPublic, vehicleHeaderHeight,
    loadVehicle, loadVehicleImages, loadTimelineEvents,
  ]);

  return (
    <VehicleProfileContext.Provider value={value}>
      {children}
    </VehicleProfileContext.Provider>
  );
};
