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
import { PersonalPhotoLibraryService } from '../../services/personalPhotoLibraryService';
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
  photoLibraryStats: any | null;

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
  const { userId: routeUserId, externalIdentityId } = useParams<{
    userId?: string;
    externalIdentityId?: string;
  }>();

  // ── Auth ──
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [authChecked, setAuthChecked] = useState(() => readCachedSession() !== null);
  const { isAdmin } = useAdminAccess();

  // ── Core ──
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserProfileStats | null>(null);
  const [comprehensiveData, setComprehensiveData] = useState<UserComprehensiveData | null>(null);
  const [photoLibraryStats, setPhotoLibraryStats] = useState<any>(null);
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
    return currentUserId || undefined;
  }, [routeUserId, externalIdentityId, currentUserId]);

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

  const loadProfile = useCallback(async () => {
    if (!authChecked) return;

    setLoading(true);
    try {
      if (externalIdentityId) {
        // External identity (unclaimed BaT user)
        const data = await getPublicProfileByExternalIdentity(externalIdentityId);
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
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();

      if (profileRow) {
        setProfile(profileRow as any);
      }

      // Background: comprehensive stats data
      const [compData, profileData] = await Promise.all([
        getUserProfileData(uid).catch(() => null),
        isOwnProfile ? ProfileService.getProfileData(uid).catch(() => null) : null,
      ]);

      if (compData) {
        setStats(compData.stats);
        setComprehensiveData(compData as any);
        buildEventsFromComprehensive(compData as any);
      }

      // Build contribution events from profile data
      if (profileData?.recentContributions) {
        buildContributionEvents(profileData.recentContributions);
      }

      // Photo library stats (own profile only, uses auth session internally)
      if (isOwnProfile) {
        PersonalPhotoLibraryService.getLibraryStats()
          .then((s) => setPhotoLibraryStats(s))
          .catch(() => {});
      }
    } catch (err) {
      console.error('[UserProfileContext] Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  }, [resolvedUserId, externalIdentityId, authChecked, isOwnProfile]);

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

  const buildContributionEvents = useCallback((contributions: any[]) => {
    const events: ContributionEvent[] = [];
    for (const c of contributions) {
      events.push({
        date: c.contribution_date,
        type: c.contribution_type === 'image_upload' ? 'image_upload' : 'timeline_event',
        count: c.contribution_count,
        label: c.contribution_type === 'image_upload'
          ? `${c.contribution_count} photo${c.contribution_count > 1 ? 's' : ''}`
          : c.metadata?.title || 'Activity',
        vehicleId: c.related_vehicle_id || undefined,
        metadata: c.metadata,
      });
    }
    setContributionEvents(events);
  }, []);

  // ── Actions ──

  const saveProfileField = useCallback(async (field: string, value: any) => {
    if (!resolvedUserId) return;
    await ProfileService.updateProfile(resolvedUserId, { [field]: value });
    // Reload to reflect changes
    const { data } = await supabase.from('profiles').select('*').eq('id', resolvedUserId).single();
    if (data) setProfile(data as any);
  }, [resolvedUserId]);

  const uploadAvatar = useCallback(async (file: File): Promise<string> => {
    if (!resolvedUserId) throw new Error('No user ID');
    const url = await ProfileService.uploadAvatar(resolvedUserId, file);
    // Reload profile with new avatar
    const { data } = await supabase.from('profiles').select('*').eq('id', resolvedUserId).single();
    if (data) setProfile(data as any);
    return url;
  }, [resolvedUserId]);

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
    contributionEvents,
    activityEvents,
    session,
    isAdmin,
    currentUserId,
    loading,
    isMobile,
    galleryFilter,
    setGalleryFilter,
    reloadProfile: loadProfile,
    saveProfileField,
    uploadAvatar,
  }), [
    resolvedUserId, profile, isOwnProfile, isExternalIdentity,
    stats, comprehensiveData, photoLibraryStats,
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
