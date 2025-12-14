import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatSupabaseInvokeError } from '../utils/formatSupabaseInvokeError';
import { useVehiclePermissions } from '../hooks/useVehiclePermissions';
import { useValuationIntel } from '../hooks/useValuationIntel';
import { TimelineEventService } from '../services/timelineEventService';
import AddEventWizard from '../components/AddEventWizard';
import EventMap from '../components/EventMap';
// AppLayout now provided globally by App.tsx
import VehicleDataEditor from '../components/vehicle/VehicleDataEditor';
import EnhancedImageTagger from '../components/vehicle/EnhancedImageTagger';
import { VisualValuationBreakdown } from '../components/vehicle/VisualValuationBreakdown';
// Lazy load vehicle profile components to avoid circular dependencies
const VehicleHeader = React.lazy(() => import('./vehicle-profile/VehicleHeader'));
const VehicleHeroImage = React.lazy(() => import('./vehicle-profile/VehicleHeroImage'));
const VehicleBasicInfo = React.lazy(() => import('./vehicle-profile/VehicleBasicInfo'));
const VehicleTimelineSection = React.lazy(() => import('./vehicle-profile/VehicleTimelineSection'));
const VehiclePricingSection = React.lazy(() => import('./vehicle-profile/VehiclePricingSection'));
const WorkMemorySection = React.lazy(() => import('./vehicle-profile/WorkMemorySection'));
import type {
  Vehicle,
  VehiclePermissions,
  SaleSettings,
  FieldAudit,
  LiveSession
} from './vehicle-profile/types';
import '../design-system.css';
import VehicleShareHolders from '../components/vehicle/VehicleShareHolders';
import FinancialProducts from '../components/financial/FinancialProducts';
import ExternalListingCard from '../components/vehicle/ExternalListingCard';
import { type LinkedOrg } from '../components/vehicle/LinkedOrganizations';
import AddOrganizationRelationship from '../components/vehicle/AddOrganizationRelationship';
import ValuationCitations from '../components/vehicle/ValuationCitations';
import { PartsQuoteGenerator } from '../components/PartsQuoteGenerator';
import WiringQueryContextBar from '../components/wiring/WiringQueryContextBar';
import LiveAuctionBanner from '../components/auction/LiveAuctionBanner';
import TransactionHistory from '../components/vehicle/TransactionHistory';
import ValidationPopupV2 from '../components/vehicle/ValidationPopupV2';
import { BATListingManager } from '../components/vehicle/BATListingManager';
import VehicleDescriptionCard from '../components/vehicle/VehicleDescriptionCard';
import VehicleCommentsCard from '../components/vehicle/VehicleCommentsCard';
import { VehicleStructuredListingDataCard } from './vehicle-profile/VehicleStructuredListingDataCard';
// Lazy load heavy components to avoid circular dependencies
const MergeProposalsPanel = React.lazy(() => import('../components/vehicle/MergeProposalsPanel'));
const ImageGallery = React.lazy(() => import('../components/images/ImageGallery'));
import { calculateFieldScores, calculateFieldScore, analyzeImageEvidence, type FieldSource } from '../services/vehicleFieldScoring';
import type { Session } from '@supabase/supabase-js';
import ReferenceLibraryUpload from '../components/reference/ReferenceLibraryUpload';
import VehicleReferenceLibrary from '../components/vehicle/VehicleReferenceLibrary';
import VehicleOwnershipPanel from '../components/ownership/VehicleOwnershipPanel';
import MailboxNotificationBadge from '../components/VehicleMailbox/MailboxNotificationBadge';
import OrphanedVehicleBanner from '../components/vehicle/OrphanedVehicleBanner';

const WORKSPACE_TABS = [
  { id: 'evidence', label: 'Evidence', helper: 'Timeline, gallery, intake' },
  { id: 'facts', label: 'Facts', helper: 'AI confidence & valuations' },
  { id: 'commerce', label: 'Commerce', helper: 'Listings, supporters, offers' },
  { id: 'financials', label: 'Financials', helper: 'Pricing, history & docs' }
] as const;

type WorkspaceTabId = typeof WORKSPACE_TABS[number]['id'];

const VehicleProfile: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  // All state hooks must be declared before any conditional returns
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [session, setSession] = useState<any>(null);
  const [vehicleImages, setVehicleImages] = useState<string[]>([]);
  const [viewCount, setViewCount] = useState<number>(0);
  const [referenceLibraryRefreshKey, setReferenceLibraryRefreshKey] = useState(0);
  // Tabs disabled until backend processing is ready
  // const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTabId>('evidence');

  // STATE DECLARATIONS
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [responsibleName, setResponsibleName] = useState<string | null>(null);
  const [showDataEditor, setShowDataEditor] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [presenceCount, setPresenceCount] = useState<number>(0);
  const [leadImageUrl, setLeadImageUrl] = useState<string | null>(null);
  const [recentCommentCount, setRecentCommentCount] = useState<number>(0);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [loading, setLoading] = useState(true); // Start true to show loading state until data loads
  const [ownershipVerifications, setOwnershipVerifications] = useState<any[]>([]);
  const [newEventsNotice, setNewEventsNotice] = useState<{ show: boolean; count: number; dates: string[] }>({ show: false, count: 0, dates: [] });
  const [showMap, setShowMap] = useState(false);
  const presenceAvailableRef = React.useRef<boolean>(true);
  const liveAvailableRef = React.useRef<boolean>(true);
  const [fieldAudit, setFieldAudit] = useState<FieldAudit>({
    open: false,
    fieldName: '',
    fieldLabel: '',
    entries: []
  });
  const [saleSettings, setSaleSettings] = useState<SaleSettings>({
    for_sale: false,
    live_auction: false,
    partners: [],
    reserve: ''
  });
  const [savingSale, setSavingSale] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [bookmarklets, setBookmarklets] = useState<{ key: string; label: string; href: string }[]>([]);
  const [composeText, setComposeText] = useState<{ title: string; description: string; specs: string[] }>({ title: '', description: '', specs: [] });
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [latestExpertValuation, setLatestExpertValuation] = useState<any | null>(null);
  const expertAnalysisRunningRef = React.useRef(false);
  const [linkedOrganizations, setLinkedOrganizations] = useState<LinkedOrg[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showAddOrgRelationship, setShowAddOrgRelationship] = useState(false);
  const [showOwnershipClaim, setShowOwnershipClaim] = useState(false);
  const [auctionPulse, setAuctionPulse] = useState<any | null>(null);


  // MOBILE DETECTION
  useEffect(() => {
    const checkMobile = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isNarrowScreen = window.innerWidth < 768;
      const isMobileDevice = isNarrowScreen || (hasTouch && window.innerWidth < 1024);
      setIsMobile(isMobileDevice);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // URL-driven claim flow fallback: /vehicle/:id?claim=1 opens the ownership modal
  // This makes "Claim this vehicle" work even if onClick handlers are flaky on some devices.
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      if (params.get('claim') === '1') {
        setShowOwnershipClaim(true);
        params.delete('claim');
        const nextSearch = params.toString();
        const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
        // Replace so refresh doesn't re-open forever
        navigate(nextUrl, { replace: true });
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname]);

  // VALUATION HOOK - Re-enabled after fixing TDZ
  const {
    valuation: valuationIntel,
    components: valuationComponents,
    readiness: readinessSnapshot,
    loading: valuationIntelLoading
  } = useValuationIntel(vehicle?.id || null);
  const valuationPayload = valuationIntelLoading ? undefined : valuationIntel;
  const valuationComponentsPayload = valuationIntelLoading ? undefined : valuationComponents;

  // PERMISSIONS HOOK - Re-enabled after fixing TDZ (with safe fallbacks in OwnershipService)
  const {
    isOwner: isRowOwner,
    hasContributorAccess,
    contributorRole,
    canEdit,
    canUpload
  } = useVehiclePermissions(vehicleId || null, session, vehicle);

  // Additional permission checks - use database function for claim status
  // Ownership claim status should not rely on missing RPCs. Use ownership_verifications directly.
  const userOwnershipClaim = React.useMemo(() => {
    const uid = session?.user?.id;
    if (!uid) return null;
    return (ownershipVerifications || []).find((v: any) => v?.user_id === uid) || null;
  }, [ownershipVerifications, session?.user?.id]);

  const isVerifiedOwner = Boolean((vehicle as any)?.ownership_verified) || (() => {
    // Strict: only treat as verified owner when BOTH documents are present and status is approved.
    if (!userOwnershipClaim) return false;
    const hasTitle = !!userOwnershipClaim.title_document_url && userOwnershipClaim.title_document_url !== 'pending';
    const hasId = !!userOwnershipClaim.drivers_license_url && userOwnershipClaim.drivers_license_url !== 'pending';
    return userOwnershipClaim.status === 'approved' && hasTitle && hasId;
  })();
  const isDbUploader = Boolean(session?.user?.id && vehicle?.uploaded_by === session.user.id);

  // Consolidated permissions object
  const permissions: VehiclePermissions = {
    isVerifiedOwner,
    hasContributorAccess,
    contributorRole,
    isDbUploader
  };

  const loadSaleSettings = async (vehId: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_sale_settings')
        .select('for_sale, live_auction, partners, reserve')
        .eq('vehicle_id', vehId)
        .maybeSingle();
      if (error) {
        // table may not exist yet — skip quietly
        return;
      }
      if (data) {
        setSaleSettings({
          for_sale: !!data.for_sale,
          live_auction: !!data.live_auction,
          partners: Array.isArray(data.partners) ? data.partners : [],
          reserve: typeof data.reserve === 'number' ? data.reserve : ''
        });
      }
    } catch {}
  };


  const shouldRunExpertAgent = useCallback((valuation: any | null) => {
    // RE-ENABLED: Expert agent runs analysis but does NOT auto-update sale prices
    // Analysis creates valuation records for review only
    const canTrigger = Boolean(isRowOwner || isVerifiedOwner || hasContributorAccess);
    if (!canTrigger) return false;
    if (!valuation) return true;
    const lastValuationDate = valuation?.valuation_date ? new Date(valuation.valuation_date) : null;
    if (!lastValuationDate) return true;
    const hoursSince = (Date.now() - lastValuationDate.getTime()) / (1000 * 60 * 60);
    return hoursSince > 24;
  }, [hasContributorAccess, isRowOwner, isVerifiedOwner]);

  const runExpertAgent = useCallback(async (vehId: string) => {
    if (expertAnalysisRunningRef.current) return;
    if (!(isRowOwner || isVerifiedOwner || hasContributorAccess)) return;
    expertAnalysisRunningRef.current = true;
    try {
      console.info('[VehicleProfile] Triggering vehicle-expert-agent for', vehId);
      const { error } = await supabase.functions.invoke('vehicle-expert-agent', {
        body: { vehicleId: vehId }
      });
      if (error) throw new Error(await formatSupabaseInvokeError(error));
      const { data } = await supabase
        .from('vehicle_valuations')
        .select('id, estimated_value, documented_components, confidence_score, components, environmental_context, value_justification, valuation_date')
        .eq('vehicle_id', vehId)
        .order('valuation_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setLatestExpertValuation(data);
      }
      window.dispatchEvent(new Event('vehicle_valuation_updated'));
    } catch (error) {
      console.error('Expert agent failed:', error);
    } finally {
      expertAnalysisRunningRef.current = false;
    }
  }, [hasContributorAccess, isRowOwner, isVerifiedOwner]);

  const fetchLatestExpertValuation = useCallback(async (vehId: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_valuations')
        .select('id, estimated_value, documented_components, confidence_score, components, environmental_context, value_justification, valuation_date')
        .eq('vehicle_id', vehId)
        .order('valuation_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error) {
        setLatestExpertValuation(data || null);
      }

      if (shouldRunExpertAgent(data || null)) {
        await runExpertAgent(vehId);
      }
    } catch (error) {
      console.warn('Failed to fetch expert valuation:', error);
    }
  }, [runExpertAgent, shouldRunExpertAgent]);

  // Build a universal package from live vehicle + images and store in localStorage for bookmarklet
  const composeListingForPartner = async (partnerKey: string) => {
    if (!vehicle) return;
    try {
      // Load images from DB
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('image_url, is_primary')
        .eq('vehicle_id', vehicle.id)
        .limit(300);
      const images = (imgs || []) as any[];
      // Services removed during cleanup - simplified composition
      const pkg = {
        partner: partnerKey,
        vehicle,
        images,
        reserve: saleSettings.reserve === '' ? null : Number(saleSettings.reserve),
        title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        description: vehicle.description || ''
      };
      localStorage.setItem('nuke_sale_package', JSON.stringify(pkg));
      setComposeText({ title: pkg.title, description: pkg.description, specs: [] });
      // Bookmarklet functionality removed during cleanup
      setBookmarklets([]);
    } catch (e) {
      console.warn('Compose failed:', e);
    }
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const saveSaleSettings = async () => {
    if (!vehicle) return;
    setSavingSale(true);
    try {
      const payload = {
        vehicle_id: vehicle.id,
        for_sale: saleSettings.for_sale,
        live_auction: saleSettings.live_auction,
        partners: saleSettings.partners,
        reserve: saleSettings.reserve === '' ? null : Number(saleSettings.reserve),
        updated_at: new Date().toISOString()
      } as any;
      const { error } = await supabase
        .from('vehicle_sale_settings')
        .upsert(payload, { onConflict: 'vehicle_id' });
      if (error) {
        console.warn('Sale settings save failed (table may not exist):', error.message);
      }
    } catch (e) {
      console.warn('Sale settings save error:', e);
    } finally {
      setSavingSale(false);
    }
  };

  useEffect(() => {
    if (!vehicleId) return;
    checkAuth();
    loadOwnershipVerifications();
    // Don't load vehicle and timeline until we know auth status
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);
  
  // Check auth before loading vehicle
  useEffect(() => {
    const checkInitialAuth = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      setAuthChecked(true);
    };
    checkInitialAuth();
  }, []);
  
  useEffect(() => {
    if (!vehicleId || !authChecked) return;
    loadVehicle();
    loadTimelineEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, authChecked]);

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load user profile when session or vehicle changes
  useEffect(() => {
    loadUserProfile();
  }, [session, vehicle]);

  useEffect(() => {
    const imageHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (!vehicleId || (vid && vid !== vehicleId)) return;
      try {
        loadVehicleImages();
        loadTimelineEvents();
      } catch {}
    };

    const timelineHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (!vehicleId || (vid && vid !== vehicleId)) return;
      try {
        loadTimelineEvents();
      } catch {}
    };

    window.addEventListener('vehicle_images_updated', imageHandler);
    window.addEventListener('timeline_updated', timelineHandler);

    // Refresh timeline periodically (reduced from 30s to 60s to prevent excessive re-renders)
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadTimelineEvents();
      }
    }, 60000); // 60 seconds, only when page is visible

    return () => {
      window.removeEventListener('vehicle_images_updated', imageHandler);
      window.removeEventListener('timeline_updated', timelineHandler);
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  // Use vehicle.id instead of vehicle object to prevent render loops
  useEffect(() => {
    if (vehicle?.id) {
      loadVehicleImages();
      loadViewCount();
      recordView();
      loadTimelineEvents();
      loadSaleSettings(vehicle.id);
      loadResponsible();
      loadLiveSession();
      loadPresenceCount();
      loadRecentComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]); // Only re-run when vehicle ID changes, not on every vehicle object change

  useEffect(() => {
    if (!vehicle?.id) return;
    loadLinkedOrgs(vehicle.id);
  }, [vehicle?.id]); // Removed loadLinkedOrgs from deps - it's useCallback with [] deps so never changes

  // Lightweight auction pulse polling (external listings + last bid/comment timestamps).
  // This makes live auction vehicles feel bustling without needing a full realtime channel.
  useEffect(() => {
    if (!vehicle?.id) return;
    if (!auctionPulse?.listing_url) return;

    let cancelled = false;

    const refreshAuctionPulse = async () => {
      try {
        // Re-read the listing record (best-effort; if multiple, prefer the exact URL)
        const { data: listing } = await supabase
          .from('external_listings')
          .select('platform, listing_url, listing_status, end_date, current_bid, bid_count, watcher_count, view_count, metadata, updated_at')
          .eq('vehicle_id', vehicle.id)
          .eq('listing_url', auctionPulse.listing_url)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const platform = String(listing?.platform || auctionPulse.platform || '');
        const listingUrl = String(listing?.listing_url || auctionPulse.listing_url || '');

        let commentCount: number | null =
          typeof (listing as any)?.metadata?.comment_count === 'number'
            ? (listing as any).metadata.comment_count
            : (typeof auctionPulse.comment_count === 'number' ? auctionPulse.comment_count : null);
        let lastBidAt: string | null = auctionPulse.last_bid_at || null;
        let lastCommentAt: string | null = auctionPulse.last_comment_at || null;

        try {
          const [cCount, lastBid, lastComment] = await Promise.all([
            commentCount === null
              ? supabase
                  .from('auction_comments')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicle.id)
              : Promise.resolve({ count: commentCount } as any),
            supabase
              .from('auction_comments')
              .select('posted_at')
              .eq('vehicle_id', vehicle.id)
              .not('bid_amount', 'is', null)
              .order('posted_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from('auction_comments')
              .select('posted_at')
              .eq('vehicle_id', vehicle.id)
              .order('posted_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

          if (commentCount === null) commentCount = typeof (cCount as any)?.count === 'number' ? (cCount as any).count : null;
          lastBidAt = (lastBid as any)?.data?.posted_at || lastBidAt;
          lastCommentAt = (lastComment as any)?.data?.posted_at || lastCommentAt;
        } catch {
          // ignore telemetry failures
        }

        if (!cancelled) {
          setAuctionPulse({
            platform,
            listing_url: listingUrl,
            listing_status: String(listing?.listing_status || auctionPulse.listing_status || ''),
            end_date: (listing as any)?.end_date ?? auctionPulse.end_date ?? null,
            current_bid: typeof (listing as any)?.current_bid === 'number' ? (listing as any).current_bid : (auctionPulse.current_bid ?? null),
            bid_count: typeof (listing as any)?.bid_count === 'number' ? (listing as any).bid_count : (auctionPulse.bid_count ?? null),
            watcher_count: typeof (listing as any)?.watcher_count === 'number' ? (listing as any).watcher_count : (auctionPulse.watcher_count ?? null),
            view_count: typeof (listing as any)?.view_count === 'number' ? (listing as any).view_count : (auctionPulse.view_count ?? null),
            comment_count: commentCount,
            last_bid_at: lastBidAt,
            last_comment_at: lastCommentAt,
            updated_at: (listing as any)?.updated_at ?? auctionPulse.updated_at ?? null,
          });
        }
      } catch {
        // ignore refresh failures
      }
    };

    // Initial refresh (so we don't rely purely on the RPC snapshot)
    refreshAuctionPulse();

    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshAuctionPulse();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [vehicle?.id, auctionPulse?.listing_url]);

  // Refresh hero/gallery when images update elsewhere
  useEffect(() => {
    const handler = (e: any) => {
      if (!vehicle?.id) return;
      if (!e?.detail?.vehicleId || e.detail.vehicleId === vehicle.id) {
        loadVehicleImages();
        // Don't recompute scores on every image update - too expensive and causes loops
        // recomputeScoresForVehicle(vehicle.id);
      }
    };
    window.addEventListener('vehicle_images_updated', handler);
    return () => window.removeEventListener('vehicle_images_updated', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]); // Depend on ID only, not entire vehicle object

  // Listen for timeline events created from image uploads to prompt review and refresh timeline
  useEffect(() => {
    const onEventsCreated = (e: any) => {
      if (!vehicle?.id) return;
      const { vehicleId, count, dates } = e?.detail || {};
      if (vehicleId && vehicleId === vehicle.id) {
        setNewEventsNotice({ show: true, count: count || 0, dates: Array.isArray(dates) ? dates : [] });
        loadTimelineEvents();
      }
    };
    window.addEventListener('timeline_events_created', onEventsCreated as any);
    return () => window.removeEventListener('timeline_events_created', onEventsCreated as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]); // Depend on ID only

  // Recompute and persist scores for key fields
  const recomputeScoresForVehicle = async (vehId: string) => {
    try {
      const fields = ['make','model','year','vin','color','mileage','engine','transmission','body_style','doors','seats'];
      
      // Get current sources and images
      const [sourcesResult, imagesResult] = await Promise.all([
        supabase
          .from('vehicle_field_sources')
          .select('field_name, field_value, source_type, user_id, is_verified')
          .eq('vehicle_id', vehId),
        supabase
          .from('vehicle_images')
          .select('area, labels, sensitive_type')
          .eq('vehicle_id', vehId)
      ]);

      const sources: FieldSource[] = (sourcesResult.data || []).map((s: any) => ({
        field_name: s.field_name,
        field_value: s.field_value,
        source_type: s.source_type,
        user_id: s.user_id
      }));

      const images = (imagesResult.data || []).map((img: any) => ({
        labels: img.labels,
        area: img.area,
        sensitive_type: img.sensitive_type
      }));

      // Use shared utility to calculate scores
      const scores = calculateFieldScores(fields, sources, images);

      // Build upserts from calculated scores
      const byField: Record<string, any> = {};
      (sourcesResult.data || []).forEach((s: any) => { byField[s.field_name] = s; });

      const upserts: any[] = [];
      for (const fieldName of fields) {
        const entry = byField[fieldName];
        const valuePresent = !!entry?.field_value;
        
        if (valuePresent) {
          const result = scores.get(fieldName);
          if (result) {
            upserts.push({
              vehicle_id: vehId,
              field_name: fieldName,
              field_value: entry.field_value || '',
              source_type: entry.source_type || 'computed',
              confidence_score: result.score,
              criteria: { met: result.met, next: result.next },
              updated_at: new Date().toISOString()
            });
          }
        }
      }

      if (upserts.length > 0) {
        await supabase.from('vehicle_field_sources').upsert(upserts, { onConflict: 'vehicle_id,field_name' });
      }
    } catch (e) {
      console.warn('recomputeScoresForVehicle failed:', e);
    }
  };

  const loadUserProfile = async () => {
    if (!session?.user?.id) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, email, phone, address, city, state, zip')
        .eq('id', session?.user?.id)
        .maybeSingle();
      if (error) {
        console.warn('Unable to load user profile:', error.message);
        return;
      }
      if (data) {
        setUserProfile({
          id: data.id,
          full_name: data.full_name || data.username || session?.user?.email || 'Unknown User',
          email: session?.user?.email || data.email || '',
          phone: data.phone,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip
        });
      }
    } catch (err) {
      console.warn('Error loading user profile:', err);
    }
  };

  const loadResponsible = async () => {
    try {
      // For automated bulk imports, show organization instead of user
      const isAutomatedImport = vehicle?.profile_origin === 'dropbox_import' && 
                                (vehicle?.origin_metadata?.automated_import === true || 
                                 vehicle?.origin_metadata?.no_user_uploader === true ||
                                 !vehicle?.uploaded_by);
      
      if (isAutomatedImport && vehicle?.origin_organization_id) {
        // Load organization name for automated imports
        const { data: orgData, error: orgError } = await supabase
          .from('businesses')
          .select('business_name')
          .eq('id', vehicle.origin_organization_id)
          .maybeSingle();
        
        if (!orgError && orgData?.business_name) {
          setResponsibleName(orgData.business_name);
          return;
        }
      }
      
      // For regular user uploads, show user name
      if (!vehicle?.uploaded_by) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('username, full_name')
        .eq('id', vehicle.uploaded_by)
        .maybeSingle();
      if (error) {
        console.warn('Unable to load responsible profile:', error.message);
        return;
      }
      if (data) {
        const display = data.full_name || data.username || null;
        setResponsibleName(display);
      }
    } catch (err) {
      console.warn('Error loading responsible profile:', err);
    }
  };

  const loadRecentComments = async () => {
    try {
      if (!vehicle?.id) return;
      // Count comments in the last 10 minutes for this vehicle
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from('vehicle_comments')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .gte('created_at', tenMinutesAgo);
      if (error) {
        console.warn('Unable to load recent comment count:', error.message);
        return;
      }
      setRecentCommentCount(count || 0);
    } catch (err) {
      console.warn('Error loading recent comment count:', err);
    }
  };

  const loadPresenceCount = async () => {
    try {
      if (!vehicle?.id) return;
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from('user_presence')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .gte('last_seen_at', fiveMinAgo);

      if (!error) {
        setPresenceCount(count || 0);
      } else {
        // Silently default to 0 if table doesn't exist
        setPresenceCount(0);
      }
    } catch {
      // Silently default to 0
      setPresenceCount(0);
    }
  };

  const loadOwnershipVerifications = async () => {
    try {
      // Use route param vehicleId (vehicle may not be loaded yet)
      const vid = vehicle?.id || vehicleId;
      if (!vid) return;
      const { data, error } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('vehicle_id', vid)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Unable to load ownership verifications:', error.message);
        return;
      }
      setOwnershipVerifications(data || []);
    } catch (err) {
      console.warn('Error loading ownership verifications:', err);
    }
  };

  // Heartbeat: upsert current user presence
  useEffect(() => {
    let t: any;
    const beat = async () => {
      try {
        if (!vehicle?.id) return;
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id || null;
        // Presence tracking - silently ignore all errors as table may not exist
        const { error } = await supabase
          .from('user_presence')
          .upsert({ vehicle_id: vehicle.id, user_id: uid, last_seen_at: new Date().toISOString() }, { onConflict: 'vehicle_id,user_id' });
        // Intentionally ignore error - presence is non-critical
      } catch {
        // Silently ignore all presence tracking failures
      }
    };
    if (vehicle) {
      beat();
      t = setInterval(beat, 60 * 1000);
      return () => clearInterval(t);
    }
  }, [vehicle]);

  const loadLiveSession = async () => {
    try {
      if (!vehicle?.id) return;
      const { data, error } = await supabase
        .from('live_streaming_sessions')
        .select('id, platform, stream_url, title, ended_at')
        .eq('vehicle_id', vehicle.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Disable further polling if table is missing or endpoint 404s
        liveAvailableRef.current = false;
        return;
      }
      if (data) setLiveSession({ id: data.id, platform: data.platform, stream_url: data.stream_url, title: data.title });
      else setLiveSession(null);
    } catch (err) {
      liveAvailableRef.current = false;
    }
  };

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
  };

  const loadTimelineEvents = async () => {
    // OPTIMIZED: Timeline events loaded via RPC in loadVehicle()
    // This function used for manual refresh after updates
    if (!vehicleId) return;
    
    // Check if RPC data is available (avoid duplicate query)
    const rpcData = (window as any).__vehicleProfileRpcData;
    if (rpcData?.timeline_events) {
      setTimelineEvents(rpcData.timeline_events);
      return;
    }
    
    try {
      const { data: events, error: eventsError } = await supabase
        .from('timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (eventsError) {
        console.error('Error loading timeline events:', eventsError);
        return;
      }

      setTimelineEvents(events || []);
    } catch (error) {
      console.error('Error loading timeline events:', error);
    }
  };


  const loadVehicle = async () => {
    try {
      setLoading(true);

      // Accept both UUID format (with hyphens) and VIN format (17 chars alphanumeric)
      const isUUID = vehicleId && vehicleId.length >= 20 && vehicleId.includes('-');
      const isVIN = vehicleId && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vehicleId);

      if (!vehicleId || (!isUUID && !isVIN)) {
        console.error('Invalid vehicleId format:', vehicleId);
        navigate('/vehicles');
        return;
      }

      // OPTIMIZED: Try RPC first for fast loading, fallback to direct query if RPC fails
      let rpcData = null;
      let rpcError = null;
      
      // Only try RPC if vehicleId is a UUID (RPC expects UUID, not VIN)
      if (isUUID) {
        const rpcResult = await supabase
          .rpc('get_vehicle_profile_data', { p_vehicle_id: vehicleId });
        rpcData = rpcResult.data;
        rpcError = rpcResult.error;
      }

      let vehicleData;
      
      if (rpcError || !rpcData || !rpcData.vehicle) {
        console.warn('[VehicleProfile] RPC load failed, using fallback query:', rpcError?.message || 'RPC returned null');
        console.warn('[VehicleProfile] RPC error details:', rpcError);
        console.warn('[VehicleProfile] RPC data:', rpcData);
        
        // Fallback to direct query
        try {
          const { data, error } = await supabase
            .from('vehicles')
            .select('*')
            .eq('id', vehicleId)
            .single();

          console.log('[VehicleProfile] Fallback query executed, result:', { hasData: !!data, hasError: !!error, errorCode: error?.code });

          if (error) {
            console.error('[VehicleProfile] Fallback query ERROR:', error);
            console.error('[VehicleProfile] Error details:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
            setVehicle(null);
            setLoading(false);
            return;
          }

          if (!data) {
            console.error('[VehicleProfile] Fallback query returned no data (null/undefined)');
            setVehicle(null);
            setLoading(false);
            return;
          }
          
          console.log('[VehicleProfile] ✅ Fallback query succeeded, vehicle loaded:', { 
            id: data.id, 
            year: data.year,
            make: data.make,
            model: data.model,
            profile_origin: data.profile_origin, 
            is_public: data.is_public,
            status: data.status
          });
          vehicleData = data;
        } catch (fallbackError) {
          console.error('[VehicleProfile] Fallback query exception:', fallbackError);
          setVehicle(null);
          setLoading(false);
          return;
        }
      } else {
        vehicleData = rpcData.vehicle;
        
        // Set additional data from RPC (optimization) - pass to children to avoid duplicate queries
        if (rpcData.images) {
          setVehicleImages(rpcData.images.map((img: any) => img.image_url));
        }
        if (rpcData.timeline_events) {
          setTimelineEvents(rpcData.timeline_events);
        }
        
        // Store RPC data for passing to children (eliminates duplicate queries)
        (window as any).__vehicleProfileRpcData = {
          images: rpcData.images,
          timeline_events: rpcData.timeline_events,
          latest_valuation: rpcData.latest_valuation,
          price_signal: rpcData.price_signal,
          external_listings: rpcData.external_listings,
          comments: rpcData.comments
        };
        
        console.log(`[VehicleProfile] Loaded via RPC: ${rpcData.stats?.image_count || 0} images, ${rpcData.stats?.event_count || 0} events, valuation: ${rpcData.latest_valuation ? 'yes' : 'no'}`);
      }

      // For non-authenticated users, only show public vehicles
      if (!session && !vehicleData.is_public) {
        navigate('/login');
        return;
      }

      // Set vehicle state
      const processedVehicle = { ...vehicleData, isPublic: vehicleData.is_public ?? vehicleData.isPublic };
      setVehicle(processedVehicle);
      setIsPublic(vehicleData.is_public ?? true);

      // Derive auction pulse for header (prefer external_listings over stale vehicles.* fields)
      try {
        const listings = (window as any).__vehicleProfileRpcData?.external_listings;
        const arr = Array.isArray(listings) ? listings : [];
        // Prefer active, ending in the future; fallback to most recent
        const now = Date.now();
        const active = arr
          .filter((l: any) => String(l?.listing_status || '').toLowerCase() === 'active')
          .sort((a: any, b: any) => {
            const ae = a?.end_date ? new Date(a.end_date).getTime() : 0;
            const be = b?.end_date ? new Date(b.end_date).getTime() : 0;
            // Prefer listings with end dates in the future, then sooner-ending first
            const aFuture = ae > now;
            const bFuture = be > now;
            if (aFuture !== bFuture) return aFuture ? -1 : 1;
            if (ae !== be) return ae - be;
            const au = a?.updated_at ? new Date(a.updated_at).getTime() : 0;
            const bu = b?.updated_at ? new Date(b.updated_at).getTime() : 0;
            return bu - au;
          })[0];

        if (active?.listing_url && active?.platform) {
          // Lightweight comment telemetry (best-effort; table may not exist in some envs)
          let commentCount: number | null = typeof active?.metadata?.comment_count === 'number' ? active.metadata.comment_count : null;
          let lastBidAt: string | null = null;
          let lastCommentAt: string | null = null;

          try {
            const [
              cCount,
              lastBid,
              lastComment
            ] = await Promise.all([
              commentCount === null
                ? supabase
                    .from('auction_comments')
                    .select('id', { count: 'exact', head: true })
                    .eq('vehicle_id', vehicleData.id)
                : Promise.resolve({ count: commentCount } as any),
              supabase
                .from('auction_comments')
                .select('posted_at')
                .eq('vehicle_id', vehicleData.id)
                .not('bid_amount', 'is', null)
                .order('posted_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabase
                .from('auction_comments')
                .select('posted_at')
                .eq('vehicle_id', vehicleData.id)
                .order('posted_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            ]);

            if (commentCount === null) commentCount = typeof (cCount as any)?.count === 'number' ? (cCount as any).count : null;
            lastBidAt = (lastBid as any)?.data?.posted_at || null;
            lastCommentAt = (lastComment as any)?.data?.posted_at || null;
          } catch {
            // ignore telemetry failures
          }

          setAuctionPulse({
            platform: String(active.platform),
            listing_url: String(active.listing_url),
            listing_status: String(active.listing_status || ''),
            end_date: active.end_date || null,
            current_bid: typeof active.current_bid === 'number' ? active.current_bid : null,
            bid_count: typeof active.bid_count === 'number' ? active.bid_count : null,
            watcher_count: typeof active.watcher_count === 'number' ? active.watcher_count : null,
            view_count: typeof active.view_count === 'number' ? active.view_count : null,
            comment_count: commentCount,
            last_bid_at: lastBidAt,
            last_comment_at: lastCommentAt,
            updated_at: active.updated_at || null,
          });
        } else {
          setAuctionPulse(null);
        }
      } catch {
        setAuctionPulse(null);
      }
      
    } catch (error) {
      console.error('Error loading vehicle:', error);
      navigate('/vehicles');
    } finally {
      setLoading(false);
    }
  };

  const updatePrivacy = async () => {
    if (!vehicle || vehicle.isAnonymous) return;

    try {
      const oldVehicle = { ...vehicle };
      const { error } = await supabase
        .from('vehicles')
        .update({ is_public: isPublic })
        .eq('id', vehicle.id);

      if (error) {
        console.error('Error updating vehicle visibility:', error);
        return;
      }

      // Create timeline event for visibility change
      await TimelineEventService.createVehicleEditEvent(
        vehicle.id,
        oldVehicle,
        { ...vehicle, is_public: isPublic, isPublic },
        vehicle.uploaded_by || undefined,
        {
          reason: `Vehicle visibility changed to ${isPublic ? 'public' : 'private'}`,
          source: 'manual_edit'
        }
      );
    } catch (error) {
      console.error('Error updating privacy:', error);
    }
  };

  const recordView = async () => {
    if (!vehicleId) return;

    try {
      // Record view in vehicle_views table
      const { error } = await supabase
        .from('vehicle_views')
        .insert({
          vehicle_id: vehicleId,
          user_id: session?.user?.id || null,
          viewed_at: new Date().toISOString(),
          ip_address: null // Could be added later
        });

      if (!error) {
        // Update vehicle view_count
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            view_count: (vehicle?.view_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicleId);

        if (!updateError) {
          setViewCount(prev => prev + 1);
        }
      }
    } catch (error) {
      console.debug('Error recording view:', error);
    }
  };

  const loadViewCount = async () => {
    if (!vehicleId) return;

    try {
      const { count, error } = await supabase
        .from('vehicle_views')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);

      if (!error && count !== null) {
        setViewCount(count);
      } else {
        // Fallback to vehicle.view_count if table doesn't exist
        setViewCount(vehicle?.view_count || 0);
      }
    } catch (error) {
      console.debug('Error loading view count:', error);
      setViewCount(vehicle?.view_count || 0);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  // Granular validation popup state
  const [validationPopup, setValidationPopup] = useState<{
    open: boolean;
    fieldName: string;
    fieldValue: string;
  }>({
    open: false,
    fieldName: '',
    fieldValue: ''
  });

  const handleDataPointClick = (event: React.MouseEvent, dataType: string, dataValue: string, label: string) => {
    event.preventDefault();
    // Show granular validation popup
    setValidationPopup({
      open: true,
      fieldName: dataType,
      fieldValue: dataValue
    });
  };

  const openFieldAudit = async (fieldName: string, fieldLabel: string) => {
    try {
      if (!vehicle?.id) return;
      // Attempt to load field history from vehicle_field_sources
      const { data, error } = await supabase
        .from('vehicle_field_sources')
        .select('field_value, source_type, user_id, is_verified, updated_at')
        .eq('vehicle_id', vehicle.id)
        .eq('field_name', fieldName)
        .order('updated_at', { ascending: false });

      if (error) {
        console.warn('Field audit unavailable:', error.message);
        setFieldAudit({ open: true, fieldName, fieldLabel, entries: [], score: undefined, met: [], next: [] });
        return;
      }

      // Compute score using shared utility
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('area, labels, sensitive_type')
        .eq('vehicle_id', vehicle.id);

      const sources: FieldSource[] = (data || []).map((e: any) => ({
        field_name: fieldName,
        field_value: e.field_value,
        source_type: e.source_type,
        user_id: e.user_id
      }));

      const images = (imgs || []).map((img: any) => ({
        labels: img.labels,
        area: img.area,
        sensitive_type: img.sensitive_type
      }));

      // Use shared utility to calculate score
      const imageEvidence = analyzeImageEvidence(images);
      const result = calculateFieldScore(fieldName, sources, imageEvidence);

      setFieldAudit({ open: true, fieldName, fieldLabel, entries: data || [], score: result.score, met: result.met, next: result.next });

      // Persist score and criteria back to vehicle_field_sources (best-effort)
      try {
        const latestVal = (data && data[0]?.field_value) || '';
        const payload: any = {
          vehicle_id: vehicle.id,
          field_name: fieldName,
          field_value: latestVal,
          source_type: (data && data[0]?.source_type) || 'computed',
          confidence_score: result.score,
          criteria: { met: result.met, next: result.next }
        };
        // Prefer upsert if unique constraint on (vehicle_id, field_name), else fallback to insert
        const { error: upErr } = await supabase.from('vehicle_field_sources').upsert(payload, { onConflict: 'vehicle_id,field_name' });
        if (upErr && upErr.code === '42710') {
          // constraint issue; fallback: update last row
          await supabase
            .from('vehicle_field_sources')
            .update({ confidence_score: result.score, criteria: { met: result.met, next: result.next } })
            .eq('vehicle_id', vehicle.id)
            .eq('field_name', fieldName);
        }
      } catch (persistErr) {
        console.warn('Score persistence skipped:', persistErr);
      }
    } catch (err) {
      console.warn('Error loading field audit:', err);
      setFieldAudit({ open: true, fieldName, fieldLabel, entries: [], score: undefined, met: [], next: [] });
    }
  };

  const formatNumber = (num: number | null) => {
    return num ? num.toLocaleString() : 'Not specified';
  };

  const handleImportComplete = async (results: any) => {
    if (vehicle) {
      await loadVehicleImages();
      await runExpertAgent(vehicle.id);
    }
  };

  const handleEditClick = () => {
    // Refresh vehicle data
    loadVehicle();
  };

  const handlePriceClick = () => {
    // Scroll to the price section
    const priceSection = document.getElementById('price-section');
    if (priceSection) {
      priceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const loadLinkedOrgs = useCallback(async (vehId: string) => {
    try {
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select(`
          id,
          organization_id,
          relationship_type,
          auto_tagged,
          gps_match_confidence,
          status,
          businesses!inner (
            id,
            business_name,
            business_type,
            city,
            state,
            logo_url
          )
        `)
        .eq('vehicle_id', vehId)
        // Include sold/pending relationships so the header can still show the org "emblem"
        // even after inventory status changes.
        .in('status', ['active', 'sold', 'pending', 'past', 'archived']);

      if (error) {
        console.warn('Unable to load linked orgs:', error.message);
        setLinkedOrganizations([]);
        return;
      }

      const enriched = (data || []).map((ov: any) => ({
        id: ov.id,
        organization_id: ov.organization_id,
        relationship_type: ov.relationship_type,
        auto_tagged: ov.auto_tagged,
        gps_match_confidence: ov.gps_match_confidence,
        status: ov.status,
        business_name: ov.businesses?.business_name || 'Unknown org',
        business_type: ov.businesses?.business_type,
        city: ov.businesses?.city,
        state: ov.businesses?.state,
        logo_url: ov.businesses?.logo_url
      })) as LinkedOrg[];

      // De-dupe by org and keep the most relevant link for header display.
      // Priority: active > sold > pending > past > archived
      const statusRank = (s: any) => {
        const v = String(s || '').toLowerCase();
        if (v === 'active') return 0;
        if (v === 'sold') return 1;
        if (v === 'pending') return 2;
        if (v === 'past') return 3;
        if (v === 'archived') return 4;
        return 5;
      };
      const byOrg = new Map<string, LinkedOrg>();
      for (const link of enriched) {
        const orgId = String((link as any).organization_id || '');
        if (!orgId) continue;
        const existing = byOrg.get(orgId);
        if (!existing) {
          byOrg.set(orgId, link);
          continue;
        }
        const nextRank = statusRank((link as any).status);
        const prevRank = statusRank((existing as any).status);
        if (nextRank < prevRank) {
          byOrg.set(orgId, link);
          continue;
        }
        if (nextRank === prevRank) {
          // Prefer non-auto-tagged when status is the same.
          const nextAuto = Boolean((link as any).auto_tagged);
          const prevAuto = Boolean((existing as any).auto_tagged);
          if (prevAuto && !nextAuto) byOrg.set(orgId, link);
        }
      }

      setLinkedOrganizations(Array.from(byOrg.values()));
    } catch (err) {
      console.warn('Linked org load failed:', err);
      setLinkedOrganizations([]);
    }
  }, []);

  const loadVehicleImages = async () => {
    if (!vehicle) return;

    // Check if RPC data is available (avoid duplicate query)
    const rpcData = (window as any).__vehicleProfileRpcData;
    if (rpcData?.images && Array.isArray(rpcData.images) && rpcData.images.length > 0) {
      const images = rpcData.images.map((img: any) => img.image_url);
      setVehicleImages(images);
      const leadImage = rpcData.images.find((img: any) => img.is_primary) || rpcData.images[0];
      if (leadImage) {
        setLeadImageUrl(leadImage.large_url || leadImage.image_url);
      }
      return;
    }

    let images: string[] = [];

    // Load images from database first
    try {
      const { data: imageRecords, error } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .eq('is_document', false) // Filter out documents - they belong in a separate section
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Error loading vehicle images from database:', error);
      } else if (imageRecords && imageRecords.length > 0) {
        // PERFORMANCE FIX: Load lead image immediately, don't wait for all signed URLs
        const leadImage = imageRecords.find((r: any) => r.is_primary === true) || imageRecords[0];

        // Set lead image URL immediately using public URL (fast)
        if (leadImage) {
          // Prefer large_url for hero image, fallback to image_url
          setLeadImageUrl(leadImage.large_url || leadImage.image_url);

          // Signed URL upgrade disabled due to storage configuration issues
          // Would generate 400 errors - using direct public URL instead
        }

        // Auto-set primary if none exists
        if (!imageRecords.find((r: any) => r.is_primary === true) && imageRecords[0]) {
          await supabase
            .from('vehicle_images')
            .update({ is_primary: true })
            .eq('id', imageRecords[0].id);
        }

        // Load all images using public URLs (fast) and de-dupe (storage/variants can create repeats)
        images = Array.from(new Set((imageRecords || []).map((r: any) => r?.image_url).filter(Boolean)));
        setVehicleImages(images);

        // Signed URL generation disabled due to storage configuration issues
        // Would generate 400 errors: createSignedUrl calls failing
        // Using direct public URLs instead which work fine
      } else {
        // No DB rows: try origin_metadata images first (from scraping)
        try {
          const originRaw: unknown =
            (vehicle as any)?.origin_metadata?.images ??
            (vehicle as any)?.origin_metadata?.image_urls ??
            (vehicle as any)?.origin_metadata?.imageUrls ??
            null;

          const originCountRaw: unknown =
            (vehicle as any)?.origin_metadata?.image_count ??
            (vehicle as any)?.origin_metadata?.imageCount ??
            null;

          const originLimit = typeof originCountRaw === 'number' && Number.isFinite(originCountRaw) ? originCountRaw : null;

          const originList = Array.isArray(originRaw) ? originRaw : [];
          const originImages = originList
            .filter((url: any) =>
              url &&
              typeof url === 'string' &&
              url.startsWith('http') &&
              !url.includes('94x63') && // Filter out thumbnails
              !url.includes('youtube.com') && // Filter out YouTube thumbnails
              !url.includes('thumbnail')
            )
            // IMPORTANT: some scrapes may accidentally include site-wide images;
            // trust image_count if present to keep the listing gallery tight.
            .slice(0, originLimit ?? 120);

          if (originImages.length > 0) {
            images = originImages;
            setVehicleImages(images);
            if (!leadImageUrl && images[0]) {
              setLeadImageUrl(images[0]);
            }
            console.log(`✅ Using ${originImages.length} images from origin_metadata`);
          }
        } catch {
          // ignore
        }
        
        // If still no images, attempt storage fallback (canonical + legacy) to avoid empty hero/gallery
        if (images.length === 0) {
          try {
            const bucketCanonical = supabase.storage.from('vehicle-data');
            const bucketLegacy = supabase.storage.from('vehicle-images');
            const gathered: string[] = [];

            const listPath = async (bucketRef: ReturnType<typeof supabase.storage.from>, path: string) => {
              const { data: files, error: listErr } = await bucketRef.list(path, { limit: 1000 });
              if (listErr || !files) return;
              for (const f of files) {
                if (!f?.name) continue;
                const name = String(f.name);
                const lower = name.toLowerCase();

                // Skip directories and non-image files
                if (!/\.(jpg|jpeg|png|webp|gif)$/.test(lower)) continue;

                const full = path ? `${path}/${name}` : name;

                // Do not pollute hero/gallery with ownership verification documents
                if (full.includes('/ownership/')) continue;

                  // Use public URLs for both buckets to avoid 400 errors
                  const { data: pub } = bucketRef.getPublicUrl(full);
                  if (pub?.publicUrl) gathered.push(pub.publicUrl);
              }
            };

            // Canonical path
            await listPath(bucketCanonical, `vehicles/${vehicle.id}`);
            const { data: eventDirsB } = await bucketCanonical.list(`vehicles/${vehicle.id}/events`, { limit: 1000 });
            if (eventDirsB && eventDirsB.length > 0) {
              for (const dir of eventDirsB) {
                if (dir.name) await listPath(bucketCanonical, `vehicles/${vehicle.id}/events/${dir.name}`);
              }
            }

            // Legacy path (read-only)
            await listPath(bucketLegacy, `${vehicle.id}`);
            const { data: eventDirsA } = await bucketLegacy.list(`${vehicle.id}/events`, { limit: 1000 });
            if (eventDirsA && eventDirsA.length > 0) {
              for (const dir of eventDirsA) {
                if (dir.name) await listPath(bucketLegacy, `${vehicle.id}/events/${dir.name}`);
              }
            }

            images = Array.from(new Set(gathered));
            if (images.length > 0 && !leadImageUrl) setLeadImageUrl(images[0]);
          } catch (e) {
            console.warn('Storage fallback for hero/gallery failed:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error querying vehicle images:', error);
    }

    // Also include primary image if available
    if (vehicle.primaryImageUrl && !images.includes(vehicle.primaryImageUrl)) {
      images = [vehicle.primaryImageUrl, ...images];
      // Fallback for lead image
      if (!leadImageUrl) setLeadImageUrl(vehicle.primaryImageUrl);
    }

    setVehicleImages(images);
  };

  if (loading) {
    return (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicle...</p>
        </div>
    );
  }

  if (!vehicle) {
    console.log('Rendering Vehicle Not Found - vehicle state is null, loading:', loading);
    return (
        <div className="card">
          <div className="card-body text-center">
            <h2 className="text font-bold" style={{ marginBottom: '12px' }}>Vehicle Not Found</h2>
            <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
              The requested vehicle could not be found.
            </p>
            <button
              className="button button-primary"
              onClick={() => navigate('/vehicles')}
            >
              View All Vehicles
            </button>
          </div>
        </div>
    );
  }
  
  // console.log('Rendering vehicle profile with vehicle:', vehicle.id); // Removed noisy log

  // Debug ownership check (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.debug('Permissions:', {
      isVerifiedOwner,
      hasContributorAccess,
      contributorRole,
      canCreateAgreements: contributorRole === 'consigner' || isVerifiedOwner
    });
  }

  const readinessScore = typeof readinessSnapshot?.readiness_score === 'number'
    ? readinessSnapshot.readiness_score
    : null;

  const renderWorkspaceContent = () => {
    if (!vehicle) {
      return (
        <div className="card">
          <div className="card-body">
            Vehicle data is still loading...
          </div>
        </div>
      );
    }

    // Simplified view - tabs disabled until backend processing is ready
        return (
          <>
        {/* Timeline - Full width under hero image */}
            <section className="section">
          <VehicleTimelineSection
                vehicle={vehicle}
            session={session}
                permissions={permissions}
            onAddEventClick={() => setShowAddEvent(true)}
              />
            </section>

        {/* Pricing & Analysis Section - Full width */}
            <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading pricing analysis...</div>}>
              <VehiclePricingSection
                vehicle={vehicle}
                permissions={permissions}
                initialValuation={latestExpertValuation}
              />
            </React.Suspense>

            {/* Wiring Query Context Bar & AI Parts Quote Generator */}
            {(isRowOwner || isVerifiedOwner) && (
              <section className="section">
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ 
                    fontSize: '10pt', 
                    fontWeight: 'bold', 
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    WIRING PLAN
                  </div>
                  <WiringQueryContextBar
                    vehicleId={vehicle.id}
                    vehicleInfo={{
                      year: vehicle.year,
                      make: vehicle.make,
                      model: vehicle.model
                    }}
                    onQuoteGenerated={(quote) => {
                      // Quote will be displayed in PartsQuoteGenerator
                      console.log('Quote generated:', quote)
                    }}
                  />
                </div>
                <PartsQuoteGenerator 
                  vehicleId={vehicle.id}
                  vehicleInfo={{
                    year: vehicle.year,
                    make: vehicle.make,
                    model: vehicle.model
                  }}
                />
              </section>
            )}

        {/* Two column layout: Info on left, Images on right */}
            <section className="section">
          <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: '320px 1fr' }}>
            {/* Left Column: Vehicle Info & Tools - Order: Basic Info → Description → Comments → Ref Docs → Maps */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {/* 1. Basic Info */}
                  <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading basic info...</div>}>
                    <VehicleBasicInfo
                      vehicle={vehicle}
                      session={session}
                      permissions={permissions}
                      onDataPointClick={handleDataPointClick}
                      onEditClick={handleEditClick}
                    />
                  </React.Suspense>
                  
                  {/* 2. Description */}
              <VehicleDescriptionCard
                vehicleId={vehicle.id}
                initialDescription={vehicle.description}
                isEditable={canEdit}
                onUpdate={() => loadVehicle()}
              />

                  {/* 2b. Structured listing data (Options / Service records / etc.) */}
                  <VehicleStructuredListingDataCard vehicle={vehicle} />
                  
                  {/* 3. Comments */}
              <VehicleCommentsCard
                vehicleId={vehicle.id}
                    session={session}
                collapsed={true}
                maxVisible={2}
                  />
                  
                  {/* 4. Reference Documents - Upload */}
                  {session && (
                    <ReferenceLibraryUpload
                      vehicleId={vehicle.id}
                      year={vehicle.year}
                      make={vehicle.make}
                      series={(vehicle as any).series}
                      model={vehicle.model}
                      bodyStyle={(vehicle as any).body_style}
                      onUploadComplete={() => {
                        loadVehicle();
                        setReferenceLibraryRefreshKey((v) => v + 1);
                      }}
                    />
                  )}
                  
                  {/* 4. Reference Documents - Display */}
                  <VehicleReferenceLibrary
                    vehicleId={vehicle.id}
                    userId={session?.user?.id}
                    year={vehicle.year}
                    make={vehicle.make}
                    series={(vehicle as any).series}
                    model={vehicle.model}
                    bodyStyle={(vehicle as any).body_style}
                    refreshKey={referenceLibraryRefreshKey}
                  />
                  
                  {/* 5. Coverage Map */}
                  <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Coverage Map</span>
                      <button className="btn-utility" style={{ fontSize: '10px' }} onClick={() => setShowMap(prev => !prev)}>
                        {showMap ? 'Hide map' : 'Show map'}
                      </button>
                    </div>
                    {showMap && (
                      <div className="card-body">
                        <EventMap vehicleId={vehicle.id} />
                      </div>
                    )}
                  </div>
                  
                  {/* Image Tagging (for owners/contributors only) */}
                  {(isRowOwner || isVerifiedOwner || (hasContributorAccess && ['owner','moderator','consigner','co_owner','restorer'].includes(contributorRole || ''))) && vehicle.hero_image && (
                    <div className="card">
                      <div className="card-header">Image Tagging & AI Validation</div>
                      <div className="card-body">
                        <EnhancedImageTagger
                          imageUrl={vehicle.hero_image}
                          vehicleId={vehicle.id}
                          onTagAdded={() => {
                            window.dispatchEvent(new CustomEvent('tags_updated', { detail: { vehicleId: vehicle.id } }));
                          }}
                          onTagValidated={() => {
                            window.dispatchEvent(new CustomEvent('tags_updated', { detail: { vehicleId: vehicle.id } }));
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

            {/* Right Column: Gallery */}
            <div>
              <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading gallery...</div>}>
                <ImageGallery
                  vehicleId={vehicle.id}
                  showUpload={true}
                  fallbackImageUrls={vehicleImages}
                  fallbackLabel={(vehicle as any)?.profile_origin === 'bat_import' ? 'BaT listing' : 'Listing'}
                  fallbackSourceUrl={
                    (vehicle as any)?.discovery_url ||
                    (vehicle as any)?.bat_auction_url ||
                    (vehicle as any)?.listing_url ||
                    undefined
                  }
                  onImagesUpdated={() => {
                    loadVehicle();
                    loadTimelineEvents();
                  }}
                />
              </React.Suspense>
            </div>
          </div>
            </section>
          </>
        );
  };

  // Render vehicle profile (responsive for mobile and desktop)
  return (
      <div>
        {/* Vehicle Header with Price */}
        <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading header...</div>}>
          <VehicleHeader
            vehicle={vehicle}
            isOwner={isRowOwner || isVerifiedOwner}
            canEdit={canEdit}
            session={session}
            permissions={permissions}
            responsibleName={responsibleName || undefined}
            onPriceClick={handlePriceClick}
            initialValuation={(window as any).__vehicleProfileRpcData?.latest_valuation}
            initialPriceSignal={(window as any).__vehicleProfileRpcData?.price_signal}
            organizationLinks={linkedOrganizations}
            onClaimClick={() => setShowOwnershipClaim(true)}
            userOwnershipClaim={userOwnershipClaim as any}
            suppressExternalListing={!!userOwnershipClaim}
            auctionPulse={auctionPulse}
          />
        </React.Suspense>

        {/* Vehicle Mailbox entry point */}
        {vehicle && (
          <div className="card" style={{ marginTop: '8px' }}>
            <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div>
                <div className="text-small text-muted">Mailbox</div>
                <div className="text" style={{ fontWeight: 600 }}>Vehicle messages & alerts</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  className="button button-secondary"
                  style={{ fontSize: '10pt', whiteSpace: 'nowrap' }}
                  onClick={() => navigate(`/vehicle/${vehicle.id}/mailbox`)}
                >
                  Open Mailbox
                </button>
                <MailboxNotificationBadge vehicleId={vehicle.id} showIcon showText />
              </div>
            </div>
          </div>
        )}

        {/* Live Auction Banner - Show if vehicle has active auction */}
        {vehicle && (
          <LiveAuctionBanner vehicleId={vehicle.id} />
        )}

        {/* Orphaned Vehicle Banner - Visible to all users */}
        {vehicle && (
          <OrphanedVehicleBanner
            vehicle={vehicle}
            session={session}
            permissions={permissions}
          />
        )}

        {/* Merge Proposals Panel - Only visible to verified owners */}
        {isVerifiedOwner && (
          <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading merge proposals...</div>}>
            <MergeProposalsPanel
              vehicleId={vehicle.id}
              onMergeComplete={() => {
                // Reload the vehicle after merge
                loadVehicle();
              }}
            />
          </React.Suspense>
        )}

        {/* Live Stats Bar (MVP: hidden to reduce clutter) */}

        {/* Hero Image Section */}
        <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading hero image...</div>}>
          <VehicleHeroImage leadImageUrl={leadImageUrl} />
        </React.Suspense>

        {/* Add Organization Relationship Modal */}
        {showAddOrgRelationship && vehicle && session?.user?.id && (
          <AddOrganizationRelationship
            vehicleId={vehicle.id}
            vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            userId={session.user.id}
            onSuccess={() => {
              loadLinkedOrgs(vehicle.id);
              setShowAddOrgRelationship(false);
            }}
            onClose={() => setShowAddOrgRelationship(false)}
          />
        )}

        {/* Main Content - Tabs disabled until backend processing is ready */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
          {renderWorkspaceContent()}
        </div>

        {/* Vehicle Metadata & Privacy Settings (MVP: hide Sale & Distribution card) */}
        <section className="section">

          {/* REMOVED: VehicleProfileTrading - desktop trading card removed */}
          {/* Trading is handled by MobileTradingPanel in mobile view */}
          {/* Desktop trading will be added in Phase 7 with tab reorganization */}

          {/* Privacy Settings for non-anonymous vehicles */}
          {!vehicle.isAnonymous && session && (
            <div className="card mt-4">
              <div className="card-header">Privacy Settings</div>
              <div className="card-body">
                <div className="vehicle-detail">
                  <span>Visibility</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge ${isPublic ? 'badge-success' : 'badge-secondary'}`}>
                      {isPublic ? 'Public' : 'Private'}
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isPublic}
                        onChange={(e) => {
                          setIsPublic(e.target.checked);
                          updatePrivacy();
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Granular Validation Popup */}
        {validationPopup.open && vehicle && (
          <ValidationPopupV2
            vehicleId={vehicle.id}
            fieldName={validationPopup.fieldName}
            fieldValue={validationPopup.fieldValue}
            vehicleYear={vehicle.year}
            vehicleMake={vehicle.make}
            onClose={() => setValidationPopup(prev => ({ ...prev, open: false }))}
          />
        )}

      {/* Add Event Wizard Modal */}
      {showAddEvent && (
        <AddEventWizard
          vehicleId={vehicle.id}
          onClose={() => {
            setShowAddEvent(false);
            window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
              detail: { vehicleId: vehicle.id }
            }));
          }}
          onEventAdded={() => {
            setShowAddEvent(false);
            window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
              detail: { vehicleId: vehicle.id }
            }));
          }}
          currentUser={session?.user || null}
        />
      )}

      {/* Data Editor Modal */}
      {showDataEditor && (
        <VehicleDataEditor
          vehicleId={vehicle?.id || ''}
          onClose={() => {
            setShowDataEditor(false);
            // Reload vehicle data after editing
            loadVehicle();
          }}
        />
      )}

      {/* Ownership Claim Modal */}
      {showOwnershipClaim && vehicle && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowOwnershipClaim(false)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Claim Vehicle Ownership</h3>
              <button
                onClick={() => setShowOwnershipClaim(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '16px' }}>
              <VehicleOwnershipPanel
                vehicle={vehicle}
                session={session}
                isOwner={isRowOwner || isVerifiedOwner}
                hasContributorAccess={hasContributorAccess}
                contributorRole={contributorRole ?? undefined}
              />
            </div>
          </div>
        </div>
      )}
      </div>
  );
};

interface FactExplorerPanelProps {
  vehicleId: string;
  readinessScore: number | null;
}

interface FactRow {
  id: string;
  fact_type: string;
  label?: string;
  answer_text?: string;
  created_at: string;
  evidence_urls?: string[];
  image_fact_confidence?: Array<{ score: number; state: string; consumer: string }>;
}

const FactExplorerPanel: React.FC<FactExplorerPanelProps> = ({ vehicleId, readinessScore }) => {
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadFacts = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('vehicle_image_facts')
          .select(`
            id,
            fact_type,
            label,
            answer_text,
            created_at,
            evidence_urls,
            image_fact_confidence(score,state,consumer)
          `)
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(25);

        if (error) {
          console.warn('Fact explorer query failed', error);
          if (isMounted) setFacts([]);
          return;
        }

        if (isMounted) {
          setFacts(data as FactRow[] || []);
        }
      } catch (error) {
        console.warn('Fact explorer load failed', error);
        if (isMounted) setFacts([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadFacts();
    return () => {
      isMounted = false;
    };
  }, [vehicleId]);

  return (
    <section className="section">
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '12px' }}>Fact Explorer</h3>
            <p className="text-small text-muted" style={{ margin: 0 }}>
              Guardrailed AI outputs mapped to the vehicle profile
            </p>
          </div>
          {typeof readinessScore === 'number' && (
            <span className="badge badge-secondary">
              Readiness {readinessScore}%
            </span>
          )}
        </div>
        <div className="card-body">
          {loading ? (
            <div className="text-small text-muted">Loading facts...</div>
          ) : facts.length === 0 ? (
            <div className="text-small text-muted">
              No VIFF facts yet — upload evidence from the Evidence tab to kick off the pipeline.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Label</th>
                    <th>Answer</th>
                    <th>Confidence</th>
                    <th>Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.map(fact => {
                    const scores = Array.isArray(fact.image_fact_confidence)
                      ? fact.image_fact_confidence.map(entry => Number(entry.score) || 0)
                      : [];
                    const bestScore = scores.length ? Math.max(...scores) : null;
                    return (
                      <tr key={fact.id}>
                        <td style={{ textTransform: 'capitalize' }}>{fact.fact_type}</td>
                        <td>{fact.label || '—'}</td>
                        <td>{fact.answer_text || '—'}</td>
                        <td>{bestScore !== null ? `${(bestScore * 100).toFixed(0)}%` : 'pending'}</td>
                        <td>{new Date(fact.created_at).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

interface ReadinessGateProps {
  title: string;
  score: number | null;
  threshold: number;
  missing?: string[] | null;
  children: React.ReactNode;
}

const ReadinessGate: React.FC<ReadinessGateProps> = ({ title, score, threshold, missing, children }) => {
  if (score !== null && score >= threshold) {
    return <>{children}</>;
  }

  return (
    <div className="card">
      <div className="card-header">{title}</div>
      <div className="card-body">
        <p className="text-small text-muted">
          {score === null
            ? 'Readiness score not computed yet. Upload photos/documents in the Evidence tab to unlock this module.'
            : `Need readiness score of ${threshold}+ (current ${score}). Continue building evidence to unlock.`}
        </p>
        {!!missing?.length && (
          <div className="text-small text-muted">
            Outstanding requirements:
            <ul>
              {missing.slice(0, 3).map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleProfile;