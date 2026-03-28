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
import { useViewHistory } from '../../hooks/useViewHistory';
import { AdminNotificationService } from '../../services/adminNotificationService';
import { buildAuctionPulseFromExternalListings } from './buildAuctionPulse';
import { loadVehicleImpl, selectBestHeroImage } from './loadVehicleData';
import { loadVehicleImagesImpl } from './loadVehicleImages';
import { resolveVehicleImages } from './resolveVehicleImages';
import { resolveCurrencyCode } from '../../utils/currency';
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

  // Header data
  responsibleName: string | null;
  linkedOrganizations: any[];
  auctionCurrency: string;

  // UI state
  loading: boolean;
  isMobile: boolean;
  isPublic: boolean;
  vehicleHeaderHeight: number;

  // Actions
  reloadVehicle: () => void;
  reloadImages: () => void;
  reloadTimeline: () => void;
  reloadLinkedOrgs: () => void;
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
  // Once selectBestHeroImage picks a hero, don't let stale closures override it
  const heroResolvedRef = React.useRef(false);

  // ── Auction ──
  const [auctionPulse, setAuctionPulse] = useState<AuctionPulse | null>(null);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);

  // ── Header data ──
  const [responsibleName, setResponsibleName] = useState<string | null>(null);
  const [linkedOrganizations, setLinkedOrganizations] = useState<any[]>([]);

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
    heroResolvedRef.current = false;
    selectBestHeroImage(vehicleId, supabase).then((result) => {
      if (result?.url) {
        setLeadImageUrl(result.url);
        setHeroMeta(result.meta);
        heroResolvedRef.current = true;
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, session, navigate]);

  const loadVehicleImages = useCallback(async () => {
    if (!vehicle?.id) return;
    const result = await resolveVehicleImages(vehicle.id);
    setVehicleImages(result.urls);
    try {
      const heroResult = await selectBestHeroImage(vehicle.id, supabase, result.leadUrl);
      if (heroResult?.url) {
        setLeadImageUrl(heroResult.url);
        setHeroMeta(heroResult.meta);
        heroResolvedRef.current = true;
        return;
      }
    } catch {
      // Ignore and fall back to the resolver lead below.
    }
    if (result.leadUrl && !heroResolvedRef.current) {
      setLeadImageUrl(result.leadUrl);
      setHeroMeta(null);
    }
  }, [vehicle?.id]);

  const loadTimelineEvents = useCallback(async () => {
    if (!vehicleId) return;
    try {
      // Load timeline_events and work_sessions in parallel, merge into unified timeline
      const [tlResult, wsResult] = await Promise.all([
        supabase
          .from('timeline_events')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('event_date', { ascending: false })
          .limit(200),
        supabase
          .from('work_sessions')
          .select('id, session_date, title, work_type, image_count, duration_minutes, total_parts_cost, work_description, status, total_labor_cost, total_job_cost')
          .eq('vehicle_id', vehicleId)
          .order('session_date', { ascending: false }),
      ]);

      const events: any[] = [];
      if (!tlResult.error && tlResult.data) events.push(...tlResult.data);

      // Convert work_sessions to timeline event shape and merge
      if (!wsResult.error && wsResult.data) {
        const existingDates = new Set(events.map((e: any) => e.event_date?.slice(0, 10)));
        for (const ws of wsResult.data) {
          // Add as a work_session event type so BarcodeTimeline can render it
          events.push({
            id: ws.id,
            vehicle_id: vehicleId,
            event_date: ws.session_date,
            event_type: 'work_session',
            title: ws.title,
            category: ws.work_type,
            cost_amount: (ws.total_job_cost || 0) + (ws.total_parts_cost || 0),
            metadata: {
              work_type: ws.work_type,
              image_count: ws.image_count,
              duration_minutes: ws.duration_minutes,
              total_parts_cost: ws.total_parts_cost,
              total_labor_cost: ws.total_labor_cost,
              total_job_cost: ws.total_job_cost,
              work_description: ws.work_description,
              status: ws.status,
              source: 'work_sessions',
            },
          });
        }
      }

      // Sort by event_date descending
      events.sort((a: any, b: any) => {
        const da = a.event_date || a.session_date || '';
        const db = b.event_date || b.session_date || '';
        return db.localeCompare(da);
      });

      setTimelineEvents(events);
    } catch { /* ignore */ }
  }, [vehicleId]);

  const loadTotalCommentCount = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const { count } = await supabase
        .from('vehicle_comments_unified')
        .select('comment_id', { count: 'exact', head: true })
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

  const loadResponsible = useCallback(async () => {
    if (!vehicle) return;
    try {
      const origin = String(vehicle?.profile_origin || '');
      const isImportedProfile = Boolean(
        vehicle?.origin_organization_id &&
        (vehicle?.origin_metadata?.automated_import === true ||
         vehicle?.origin_metadata?.no_user_uploader === true ||
         !vehicle?.uploaded_by ||
         ['dropbox_import', 'url_scraper', 'api_import', 'organization_import', 'classic_com_indexing'].includes(origin))
      );
      if (isImportedProfile && vehicle?.origin_organization_id) {
        const { data: orgData, error: orgError } = await supabase
          .from('businesses').select('business_name').eq('id', vehicle.origin_organization_id).maybeSingle();
        if (!orgError && orgData?.business_name) { setResponsibleName(orgData.business_name); return; }
        setResponsibleName('Imported');
        return;
      }
      if (!vehicle?.uploaded_by) return;
      const { data, error } = await supabase
        .from('profiles').select('username, full_name').eq('id', vehicle.uploaded_by).maybeSingle();
      if (!error && data) setResponsibleName(data.full_name || data.username || null);
    } catch { /* ignore */ }
  }, [vehicle?.id, vehicle?.profile_origin, vehicle?.origin_organization_id, vehicle?.uploaded_by]);

  const loadLinkedOrgs = useCallback(async () => {
    if (!vehicle?.id) return;
    try {
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select('id, organization_id, relationship_type, auto_tagged, gps_match_confidence, status, businesses!inner (id, business_name, business_type, city, state, logo_url)')
        .eq('vehicle_id', vehicle.id)
        .in('status', ['active', 'sold', 'pending', 'past', 'archived']);
      if (error) { setLinkedOrganizations([]); return; }
      const enriched = (data || []).map((ov: any) => ({
        id: ov.id, organization_id: ov.organization_id, relationship_type: ov.relationship_type,
        auto_tagged: ov.auto_tagged, gps_match_confidence: ov.gps_match_confidence, status: ov.status,
        business_name: ov.businesses?.business_name || 'Unknown org', business_type: ov.businesses?.business_type,
        city: ov.businesses?.city, state: ov.businesses?.state, logo_url: ov.businesses?.logo_url,
      }));
      // De-dupe by org, keep most relevant (active > sold > pending > past > archived)
      const rank = (s: any) => { const v = String(s || '').toLowerCase(); return v === 'active' ? 0 : v === 'sold' ? 1 : v === 'pending' ? 2 : v === 'past' ? 3 : v === 'archived' ? 4 : 5; };
      const byOrg = new Map<string, any>();
      for (const link of enriched) {
        const orgId = String(link.organization_id || '');
        if (!orgId) continue;
        const existing = byOrg.get(orgId);
        if (!existing) { byOrg.set(orgId, link); continue; }
        const nr = rank(link.status), pr = rank(existing.status);
        if (nr < pr || (nr === pr && existing.auto_tagged && !link.auto_tagged)) byOrg.set(orgId, link);
      }
      setLinkedOrganizations(Array.from(byOrg.values()));
    } catch { setLinkedOrganizations([]); }
  }, [vehicle?.id]);

  const auctionCurrency = useMemo(() => {
    const v: any = vehicle as any;
    const externalListing = v?.vehicle_events?.[0] ?? v?.external_listings?.[0];
    const pulseMeta = (auctionPulse as any)?.metadata;
    return resolveCurrencyCode(
      pulseMeta?.currency, pulseMeta?.currency_code, pulseMeta?.currencyCode,
      pulseMeta?.price_currency, pulseMeta?.priceCurrency,
      externalListing?.currency, externalListing?.currency_code, externalListing?.price_currency,
      externalListing?.metadata?.currency, externalListing?.metadata?.currency_code,
      externalListing?.metadata?.currencyCode, externalListing?.metadata?.price_currency,
      externalListing?.metadata?.priceCurrency,
      v?.origin_metadata?.currency, v?.origin_metadata?.currency_code,
      v?.origin_metadata?.price_currency, v?.origin_metadata?.priceCurrency,
      v?.origin_metadata?.priceCurrencyCode,
    );
  }, [vehicle, auctionPulse]);

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

  // ── View history tracking ──
  const { recordView: _recordView, endView: _endView } = useViewHistory();
  useEffect(() => {
    if (!vehicleId) return;
    _recordView(vehicleId, 'profile');
    return () => { _endView(vehicleId); };
  }, [vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    loadResponsible();
    loadLinkedOrgs();
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
                if (!leadImageUrl && !heroResolvedRef.current && urls[0]) setLeadImageUrl(urls[0]);
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
              if (!leadImageUrl && !heroResolvedRef.current && filtered[0]) setLeadImageUrl(filtered[0]);
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
          if (!leadImageUrl && !heroResolvedRef.current && filtered[0]) setLeadImageUrl(filtered[0]);
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
    const eventsCreatedHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (vid && vid === vehicleId) loadTimelineEvents();
    };
    window.addEventListener('vehicle_images_updated', imageHandler);
    window.addEventListener('timeline_updated', timelineHandler);
    window.addEventListener('timeline_events_created', eventsCreatedHandler as any);
    return () => {
      window.removeEventListener('vehicle_images_updated', imageHandler);
      window.removeEventListener('timeline_updated', timelineHandler);
      window.removeEventListener('timeline_events_created', eventsCreatedHandler as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  // ── Post-load side effects ──

  useEffect(() => {
    if (!vehicle?.id) return;
    // Record view (fire-and-forget)
    supabase.from('vehicle_views').insert({ vehicle_id: vehicle.id, user_id: session?.user?.id || null, viewed_at: new Date().toISOString() }).then(() => {}).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  // Auto-create bundle events when owner views their vehicle
  useEffect(() => {
    if (!vehicleId || !canEdit) return;
    const token = session?.access_token;
    if (!token) return;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-create-bundle-events`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_id: vehicleId }),
    }).catch(() => {});
  }, [vehicleId, canEdit, session?.access_token]);

  // Heartbeat: upsert current user presence
  useEffect(() => {
    if (!vehicle?.id) return;
    const beat = async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id || null;
        await supabase.from('user_presence').upsert(
          { vehicle_id: vehicle!.id, user_id: uid, last_seen_at: new Date().toISOString() },
          { onConflict: 'vehicle_id,user_id' },
        );
      } catch { /* silent */ }
    };
    beat();
    const t = setInterval(beat, 60_000);
    return () => clearInterval(t);
  }, [vehicle?.id]);

  // BaT auto-import: once per vehicle for bat_import vehicles with no images or broken identity
  const batAutoImportRan = useRef(false);
  useEffect(() => {
    if (!vehicle?.id || !session?.user?.id || batAutoImportRan.current) return;
    (async () => {
      try {
        const origin = String(vehicle?.profile_origin || '');
        const discoveryUrl = String((vehicle as any)?.discovery_url || '');
        const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');
        if (!isBat) return;
        const key = `bat_auto_import_attempted_${vehicle.id}`;
        if (typeof window !== 'undefined' && window.localStorage.getItem(key)) return;
        const make = String(vehicle?.make || '');
        const model = String(vehicle?.model || '');
        const looksBadIdentity = /mile/i.test(make) || /bring a trailer/i.test(model) || /on\s+bat\s+auctions/i.test(model) || model.length > 80;
        if (vehicleImages.length > 0 && !looksBadIdentity) return;
        window.localStorage.setItem(key, new Date().toISOString());
        batAutoImportRan.current = true;
        const batUrl = discoveryUrl || String((vehicle as any)?.bat_auction_url || '') || String((vehicle as any)?.listing_url || '');
        if (!batUrl.includes('bringatrailer.com/listing/')) return;
        const { data, error } = await supabase.functions.invoke('complete-bat-import', { body: { bat_url: batUrl, vehicle_id: vehicle.id } });
        if (error || !data) {
          try { window.localStorage.removeItem(key); } catch { /* ignore */ }
          return;
        }
        loadVehicle();
        loadTimelineEvents();
        loadVehicleImages();
      } catch (e) {
        try { if (vehicle?.id) window.localStorage.removeItem(`bat_auto_import_attempted_${vehicle.id}`); } catch { /* ignore */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, session?.user?.id]);

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
    responsibleName,
    linkedOrganizations,
    auctionCurrency,
    loading,
    isMobile,
    isPublic,
    vehicleHeaderHeight,
    reloadVehicle: loadVehicle,
    reloadImages: loadVehicleImages,
    reloadTimeline: loadTimelineEvents,
    reloadLinkedOrgs: loadLinkedOrgs,
    setIsPublic,
    setVehicleHeaderHeight,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    vehicleId, vehicle, vehicleImages, fallbackListingImageUrls,
    timelineEvents, totalCommentCount, observationCount,
    leadImageUrl, heroMeta, auctionPulse, liveSession,
    session, isRowOwner, isVerifiedOwner, hasContributorAccess,
    canEdit, isAdminUser, canTriggerProofAnalysis, userOwnershipClaim,
    responsibleName, linkedOrganizations, auctionCurrency,
    loading, isMobile, isPublic, vehicleHeaderHeight,
    loadVehicle, loadVehicleImages, loadTimelineEvents, loadLinkedOrgs,
  ]);

  return (
    <VehicleProfileContext.Provider value={value}>
      {children}
    </VehicleProfileContext.Provider>
  );
};
