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
