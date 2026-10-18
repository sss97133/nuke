/**
 * UserProfileContext — Single source of truth for user profile data.
 *
 * Mirrors VehicleProfileContext.tsx pattern. All data fetching happens here.
 * Components call useUserProfile() to read data.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { readCachedSession } from '../../utils/cachedSession';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { ProfileService } from '../../services/profileService';
import { getUserProfileData, getPublicProfileByExternalIdentity } from '../../services/profileStatsService';
import { PersonalPhotoLibraryService, type LibraryStats } from '../../services/personalPhotoLibraryService';
import type { UserProfile, UserProfileStats, UserComprehensiveData, ContributionEvent, ActivityEvent, GalleryFilter } from './types';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface UserProfileContextValue {
  // Core
  userId: string | undefined;
  profile: UserProfile | null;
  isOwnProfile: boolean;
  isExternalIdentity: boolean;

  // Stats & data
  stats: UserProfileStats | null;
  comprehensiveData: UserComprehensiveData | null;
  photoLibraryStats: LibraryStats | null;
  photoLibraryError: string | null;

  // Events
  contributionEvents: ContributionEvent[];
  activityEvents: ActivityEvent[];

  // Auth
  session: any;
  isAdmin: boolean;
  currentUserId: string | null;

  // UI
  loading: boolean;
  isMobile: boolean;

  // Cross-column coordination
  galleryFilter: GalleryFilter | null;
  setGalleryFilter: (f: GalleryFilter | null) => void;

  // Actions
  reloadProfile: () => void;
  saveProfileField: (field: string, value: any) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUserProfile(): UserProfileContextValue {
  const ctx = useContext(UserProfileContext);
  if (!ctx) throw new Error('useUserProfile must be used within UserProfileProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const UserProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { userId: routeUserId, externalIdentityId, handle: routeHandle } = useParams<{
    userId?: string;
    externalIdentityId?: string;
    handle?: string;
  }>();

  // Handle → userId resolver (for /u/:handle canonical route per frontend-doctrine §2a)
  const [resolvedHandleUserId, setResolvedHandleUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (routeHandle && !routeUserId) {
      supabase
        .from('profiles')
        .select('id')
        .eq('username', routeHandle)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setResolvedHandleUserId(data?.id ?? null);
        });
    } else {
      setResolvedHandleUserId(null);
    }
    return () => { cancelled = true; };
  }, [routeHandle, routeUserId]);

  // ── Auth ──
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [authChecked, setAuthChecked] = useState(() => readCachedSession() !== null);
  const { isAdmin } = useAdminAccess();

  // ── Core ──
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserProfileStats | null>(null);
  const [comprehensiveData, setComprehensiveData] = useState<UserComprehensiveData | null>(null);
  const [photoLibraryStats, setPhotoLibraryStats] = useState<LibraryStats | null>(null);
  const [photoLibraryError, setPhotoLibraryError] = useState<string | null>(null);
  const [contributionEvents, setContributionEvents] = useState<ContributionEvent[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  // ── UI ──
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter | null>(null);

  const currentUserId = session?.user?.id || null;
  const isExternalIdentity = Boolean(externalIdentityId);

  // Resolve which userId to load
  const resolvedUserId = useMemo(() => {
    if (externalIdentityId) return undefined; // external identity path
    if (routeUserId) return routeUserId;
    if (routeHandle) return resolvedHandleUserId || undefined; // /u/:handle path
    return currentUserId || undefined;
  }, [routeUserId, externalIdentityId, routeHandle, resolvedHandleUserId, currentUserId]);

  const isOwnProfile = Boolean(
    resolvedUserId && currentUserId && resolvedUserId === currentUserId
  );

  // ── Auth bootstrap ──

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      setAuthChecked(true);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // ── Data fetching ──

  // In-flight guard: auth bootstrap settles deps twice on a cold load
  // (cached-session render, then getSession render), which re-created this
  // callback and ran the whole multi-second waterfall TWICE per visit.
  const loadingForUidRef = React.useRef<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!authChecked) return;

    const loadKey = `${externalIdentityId || resolvedUserId || ''}:${currentUserId || 'anon'}`;
    if (loadingForUidRef.current === loadKey) return;
    loadingForUidRef.current = loadKey;

    setLoading(true);
    setProfile(null);
    setStats(null);
    setComprehensiveData(null);
    setPhotoLibraryStats(null);
    setPhotoLibraryError(null);
    try {
      if (externalIdentityId) {
        // External identity (unclaimed BaT user)
        const data = await getPublicProfileByExternalIdentity(externalIdentityId);
        if (loadingForUidRef.current !== loadKey) return;
        if (data) {
          setProfile(data.profile as any);
          setStats(data.stats);
          setComprehensiveData(data as any);
          buildEventsFromComprehensive(data as any);
        }
        setLoading(false);
        return;
      }

      const uid = resolvedUserId;
      if (!uid) {
        setLoading(false);
        return;
      }

      // Fast path: get profile record directly
      const { data: profileRow, error: profileError } = await ProfileService.getProfileRecord(uid);
      if (loadingForUidRef.current !== loadKey) return;
      if (profileError) throw profileError;

      if (profileRow) {
        setProfile(profileRow as any);
        // FIRST PAINT GATE: the page rendered a blank 100vh div until the
        // entire stats waterfall finished — measured 24.6-25.5s cold. The
        // header/garage/timeline only need the profile row; stats and
        // comprehensive data stream into state below and every consumer
        // already null-handles them.
        setLoading(false);
      }

      // Start independent owner coverage before the slower profile statistics.
      if (isOwnProfile) {
        PersonalPhotoLibraryService.getLibraryStats()
          .then((s) => { if (loadingForUidRef.current === loadKey) setPhotoLibraryStats(s); })
          .catch(() => { if (loadingForUidRef.current === loadKey) setPhotoLibraryError('Photo coverage could not load. Reload to retry.'); });
      }

      // Background: comprehensive stats data + per-day contribution aggregates.
      // getContributionDays replaces the ProfileService.getProfileData leg here:
      // that path ran three wide row-level selects (vehicle_images /
      // vehicle_timeline_events / business_timeline_events) each silently
      // capped at 1000 rows by PostgREST db-max-rows, so the timeline rendered
      // whichever arbitrary slice fit — and only for the owner. The RPC returns
      // complete (day, kind, n) aggregates for any profile in one small call.
      const [compData, contributionDays] = await Promise.all([
        getUserProfileData(uid).catch(() => null),
        ProfileService.getContributionDays(uid).catch(() => null),
      ]);
      if (loadingForUidRef.current !== loadKey) return;

      if (compData) {
        setStats(compData.stats);
        setComprehensiveData(compData as any);
        buildEventsFromComprehensive(compData as any);
      }

      if (contributionDays) {
        buildContributionEvents(contributionDays);
      }

    } catch (err) {
      console.error('[UserProfileContext] Error loading profile:', err);
    } finally {
      if (loadingForUidRef.current === loadKey) setLoading(false);
    }
  }, [resolvedUserId, externalIdentityId, authChecked, isOwnProfile, currentUserId]);

  const buildEventsFromComprehensive = useCallback((data: UserComprehensiveData) => {
    const events: ActivityEvent[] = [];

    // Listings → activity
    for (const listing of (data.listings || []).slice(0, 50)) {
      const vehicle = listing.vehicle;
      events.push({
        id: listing.id || `listing-${events.length}`,
        date: listing.ended_at || listing.created_at || '',
        type: 'listing',
        description: vehicle ? `Listed ${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Listed a vehicle',
        vehicleId: vehicle?.id,
        vehicleName: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : undefined,
        vehicleThumb: vehicle?.primary_image_url,
      });
    }

    // Bids → activity
    for (const bid of (data.bids || []).slice(0, 50)) {
      const vehicle = bid.vehicle || bid.auction?.vehicle;
      events.push({
        id: bid.id || `bid-${events.length}`,
        date: bid.ended_at || bid.created_at || '',
        type: 'bid',
        description: vehicle ? `Bid on ${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Placed a bid',
        vehicleId: vehicle?.id,
        vehicleName: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : undefined,
        vehicleThumb: vehicle?.primary_image_url,
      });
    }

    // Wins → activity
    for (const win of (data.auction_wins || []).slice(0, 50)) {
      const vehicle = win.vehicle;
      events.push({
        id: win.id || `win-${events.length}`,
        date: win.ended_at || win.created_at || '',
        type: 'auction_win',
        description: vehicle ? `Won ${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Won an auction',
        vehicleId: vehicle?.id,
        vehicleName: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : undefined,
        vehicleThumb: vehicle?.primary_image_url,
      });
    }

    // Sort by date descending
    events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    setActivityEvents(events);
  }, []);

  // Map get_user_contribution_days rows (day, kind, n) → ContributionEvents.
  // The kind map is OPEN: photo/event/work flow today; business / auction /
  // comment kinds pass through to their own facets the moment the RPC emits
  // them, instead of being collapsed into timeline_event (the old remap
  // flattened everything non-photo, which is why auctions/comments never
  // reached the heatmap).
  const buildContributionEvents = useCallback((rows: Array<{ day: string; kind: string; n: number }>) => {
    const KIND_TO_TYPE: Record<string, ContributionEvent['type']> = {
      photo: 'image_upload',
      event: 'timeline_event',
      work: 'work',
      business: 'business_event',
      auction: 'auction_activity',
      comment: 'comment',
    };
    const KIND_LABEL: Record<string, [string, string]> = {
      photo: ['photo', 'photos'],
      event: ['event', 'events'],
      work: ['work session', 'work sessions'],
    };
    const events: ContributionEvent[] = [];
    for (const r of rows) {
      if (!r?.day || !r?.n) continue;
      const [one, many] = KIND_LABEL[r.kind] || ['contribution', 'contributions'];
      events.push({
        date: r.day,
        type: KIND_TO_TYPE[r.kind] ?? 'timeline_event',
        count: r.n,
        label: `${r.n} ${r.n === 1 ? one : many}`,
      });
    }
    setContributionEvents(events);
  }, []);

  // ── Actions ──

  const saveProfileField = useCallback(async (field: string, value: any) => {
    if (!resolvedUserId || !isOwnProfile) throw new Error('Profile editing requires its owner');
    await ProfileService.updateProfile(resolvedUserId, { [field]: value });
    // Reload to reflect changes
    const { data } = await ProfileService.getProfileRecord(resolvedUserId);
    if (data) setProfile(data as any);
  }, [resolvedUserId, isOwnProfile]);

  const uploadAvatar = useCallback(async (file: File): Promise<string> => {
    if (!resolvedUserId || !isOwnProfile) throw new Error('Avatar editing requires its owner');
    const url = await ProfileService.uploadAvatar(resolvedUserId, file);
    // Reload profile with new avatar
    const { data } = await ProfileService.getProfileRecord(resolvedUserId);
    if (data) setProfile(data as any);
    return url;
  }, [resolvedUserId, isOwnProfile]);

  // ── Effects ──

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Context value ──

  const value = useMemo<UserProfileContextValue>(() => ({
    userId: resolvedUserId,
    profile,
    isOwnProfile,
    isExternalIdentity,
    stats,
    comprehensiveData,
    photoLibraryStats,
    photoLibraryError,
    contributionEvents,
    activityEvents,
    session,
    isAdmin,
    currentUserId,
    loading,
    isMobile,
    galleryFilter,
    setGalleryFilter,
    reloadProfile: () => { loadingForUidRef.current = null; void loadProfile(); },
    saveProfileField,
    uploadAvatar,
  }), [
    resolvedUserId, profile, isOwnProfile, isExternalIdentity,
    stats, comprehensiveData, photoLibraryStats, photoLibraryError,
    contributionEvents, activityEvents,
    session, isAdmin, currentUserId,
    loading, isMobile, galleryFilter,
    loadProfile, saveProfileField, uploadAvatar,
  ]);

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
};
