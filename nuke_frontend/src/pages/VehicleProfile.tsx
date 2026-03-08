import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatSupabaseInvokeError } from '../utils/formatSupabaseInvokeError';
import { readCachedSession } from '../utils/cachedSession';
import { useVehiclePermissions } from '../hooks/useVehiclePermissions';
import { useValuationIntel } from '../hooks/useValuationIntel';
import { useVehicleMemeDrops } from '../hooks/useVehicleMemeDrops';
import { useAdminAccess } from '../hooks/useAdminAccess';
import { TimelineEventService } from '../services/timelineEventService';
// Lazy-load heavy tab-specific and modal components
const AddEventWizard = React.lazy(() => import('../components/AddEventWizard'));
// Lazy load vehicle profile components to avoid circular dependencies
const VehicleHeader = React.lazy(() => import('./vehicle-profile/VehicleHeader'));
const VehicleHeroImage = React.lazy(() => import('./vehicle-profile/VehicleHeroImage'));
import type {
  Vehicle,
  VehiclePermissions,
  SaleSettings,
  FieldAudit,
  LiveSession
} from './vehicle-profile/types';
import '../styles/unified-design-system.css';
import '../styles/vehicle-profile.css';
const VehicleSubHeader = React.lazy(() => import('./vehicle-profile/VehicleSubHeader'));
import { type LinkedOrg } from '../components/vehicle/LinkedOrganizations';
const AddOrganizationRelationship = React.lazy(() => import('../components/vehicle/AddOrganizationRelationship'));
import { usePageTitle, getVehicleTitle } from '../hooks/usePageTitle';
import { resolveCurrencyCode } from '../utils/currency';
const ValidationPopupV2 = React.lazy(() => import('../components/vehicle/ValidationPopupV2'));
import VehicleMemeOverlay from '../components/vehicle/VehicleMemeOverlay';
import { calculateFieldScore, analyzeImageEvidence, type FieldSource } from '../services/vehicleFieldScoring';
const VehicleOwnershipPanel = React.lazy(() => import('../components/ownership/VehicleOwnershipPanel'));
import { AdminNotificationService } from '../services/adminNotificationService';
// Extracted sub-components
// WorkspaceTabBar removed — all sections render flat in left column
import { buildAuctionPulseFromExternalListings } from './vehicle-profile/buildAuctionPulse';
// Image filter utilities are used by extracted loadVehicleImages.ts and loadVehicleData.ts
import { loadVehicleImagesImpl } from './vehicle-profile/loadVehicleImages';
import { loadVehicleImpl, selectBestHeroImage } from './vehicle-profile/loadVehicleData';
import type { HeroImageMeta } from './vehicle-profile/loadVehicleData';
const WorkspaceContent = React.lazy(() => import('./vehicle-profile/WorkspaceContent'));
const VehicleBanners = React.lazy(() => import('./vehicle-profile/VehicleBanners'));
const BarcodeTimeline = React.lazy(() => import('./vehicle-profile/BarcodeTimeline'));
const VehicleBadgeBar = React.lazy(() => import('./vehicle-profile/VehicleBadgeBar'));
// WalkAroundCarousel removed from vehicle profile layout

/** Quick Stats line shown below hero image */
const QuickStatsBar: React.FC<{
  imageCount: number;
  eventCount: number;
  commentCount: number;
  observationCount?: number;
  updatedAt?: string | null;
}> = ({ imageCount, eventCount, commentCount, observationCount, updatedAt }) => {
  const timeAgo = React.useMemo(() => {
    if (!updatedAt) return null;
    try {
      const d = new Date(updatedAt);
      const ms = Date.now() - d.getTime();
      if (ms < 0 || !Number.isFinite(ms)) return null;
      const mins = Math.floor(ms / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 30) return `${days}d ago`;
      return d.toLocaleDateString();
    } catch {
      return null;
    }
  }, [updatedAt]);

  const parts: string[] = [];
  if (imageCount > 0) parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`);
  if (observationCount && observationCount > 0) parts.push(`${observationCount} observation${observationCount === 1 ? '' : 's'}`);
  if (eventCount > 0) parts.push(`${eventCount} event${eventCount === 1 ? '' : 's'}`);
  if (commentCount > 0) parts.push(`${commentCount} comment${commentCount === 1 ? '' : 's'}`);
  if (timeAgo) parts.push(`Updated ${timeAgo}`);

  if (parts.length === 0) return null;

  return (
    <div style={{
      padding: '8px 16px',
      maxWidth: '1600px',
      margin: '0 auto',
      background: 'transparent',
    }}>
      <div style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: '8px',
        fontWeight: 400,
        color: '#888',
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        alignItems: 'center',
      }}>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ opacity: 0.4 }}>&middot;</span>}
            <span>{p}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const VehicleProfile: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // All state hooks must be declared before any conditional returns
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  // Initialize session from localStorage cache so loadVehicle() doesn't have to
  // wait for the async getSession() round-trip before it can start.
  const [session, setSession] = useState<any>(() => readCachedSession());
  const [vehicleImages, setVehicleImages] = useState<string[]>([]);
  const [fallbackListingImageUrls, setFallbackListingImageUrls] = useState<string[]>([]);
  const [viewCount, setViewCount] = useState<number>(0);
  const [referenceLibraryRefreshKey, setReferenceLibraryRefreshKey] = useState(0);
  // Workspace tabs removed — all sections flat

  // STATE DECLARATIONS
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [responsibleName, setResponsibleName] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [presenceCount, setPresenceCount] = useState<number>(0);
  const [leadImageUrl, setLeadImageUrl] = useState<string | null>(null);
  const [heroMeta, setHeroMeta] = useState<HeroImageMeta | null>(null);
  const [recentCommentCount, setRecentCommentCount] = useState<number>(0);
  const [totalCommentCount, setTotalCommentCount] = useState<number>(0);
  const [observationCount, setObservationCount] = useState<number>(0);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [loading, setLoading] = useState(true); // Start true to show loading state until data loads
  const [ownershipVerifications, setOwnershipVerifications] = useState<any[]>([]);
  const [newEventsNotice, setNewEventsNotice] = useState<{ show: boolean; count: number; dates: string[] }>({ show: false, count: 0, dates: [] });
  const [auctionPulse, setAuctionPulse] = useState<any | null>(null);
  // walkAroundImages state removed
  const auctionCurrency = React.useMemo(() => {
    const v: any = vehicle as any;
    const externalListing = v?.vehicle_events?.[0] ?? v?.external_listings?.[0];
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
  const vehicleHeaderRef = React.useRef<HTMLDivElement | null>(null);
  const [vehicleHeaderHeight, setVehicleHeaderHeight] = React.useState<number>(88);
  
  // Measure VehicleHeader height (including auction rail) for sticky positioning
  useEffect(() => {
    const updateHeaderHeight = () => {
      if (vehicleHeaderRef.current) {
        const height = vehicleHeaderRef.current.offsetHeight;
        setVehicleHeaderHeight(height);
      }
    };
    
    updateHeaderHeight();
    const resizeObserver = new ResizeObserver(updateHeaderHeight);
    if (vehicleHeaderRef.current) {
      resizeObserver.observe(vehicleHeaderRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [vehicle, auctionPulse, liveSession]); // Re-measure when auction state changes
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
  const [userProfile, setUserProfile] = useState<any>(null);
  // Start as true if we have a cached session — eliminates the auth-gate waterfall
  // for returning users. The async checkInitialAuth() still runs to validate/refresh.
  const [authChecked, setAuthChecked] = useState(() => readCachedSession() !== null);
  const [latestExpertValuation, setLatestExpertValuation] = useState<any | null>(null);
  const expertAnalysisRunningRef = React.useRef(false);
  const [linkedOrganizations, setLinkedOrganizations] = useState<LinkedOrg[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showAddOrgRelationship, setShowAddOrgRelationship] = useState(false);
  const [showOwnershipClaim, setShowOwnershipClaim] = useState(false);
  const ranBatSyncRef = React.useRef<string | null>(null);
  const [batAutoImportStatus, setBatAutoImportStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const { lastMemeDrop } = useVehicleMemeDrops(vehicle?.id);
  const [isAdmin, setIsAdmin] = useState(false);
  // isMismatchedVehicleImage extracted to imageFilterUtils.ts (used by loadVehicleData.ts)

  // For BaT-import vehicles with no `vehicle_images` yet, fetch listing gallery URLs so the profile isn't empty.
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) return;

        const hasDbImages = Array.isArray(vehicleImages) && vehicleImages.length > 0;
        if (hasDbImages) {
          // If we have real images, we don't need fallback listing images.
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
        const filterNonPhotoListingUrls = (arr: string[]): string[] => {
          const urls = Array.isArray(arr) ? arr : [];
          const keep = urls.filter((rawUrl) => {
            const raw = String(rawUrl || '').trim();
            if (!raw || !raw.startsWith('http')) return false;
            const s = raw.toLowerCase();
            
            // Filter out icons and UI elements
            if (s.includes('gstatic.com/faviconv2')) return false;
            if (s.includes('favicon.ico') || s.includes('/favicon')) return false;
            if (s.includes('apple-touch-icon')) return false;
            if (s.endsWith('.ico')) return false;
            
            // Filter out known BaT non-vehicle content
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
            } catch {
              // ignore
            }
            return true;
          });
          return keep.length > 0 ? keep : urls;
        };
        try {
          const cached = typeof window !== 'undefined' ? window.localStorage.getItem(cacheKey) : null;
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const urls = filterNonPhotoListingUrls(parsed.filter((u: any) => typeof u === 'string' && u.startsWith('http')));
              if (urls.length > 0) {
                setFallbackListingImageUrls(urls);
                if (!leadImageUrl && urls[0]) setLeadImageUrl(urls[0]);
                return;
              }
            }
          }
        } catch {
          // ignore cache parse errors
        }

        // Cars & Bids: do NOT scrape (bot-protected). Use images already stored in vehicle_events metadata.
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
              (Array.isArray(meta?.images) ? meta.images : null) ||
              [];

            const filtered = filterNonPhotoListingUrls(images);
            if (filtered.length > 0) {
              setFallbackListingImageUrls(filtered);
              try {
                window.localStorage.setItem(cacheKey, JSON.stringify(filtered.slice(0, 250)));
              } catch {
                // ignore
              }
              if (!leadImageUrl && filtered[0]) setLeadImageUrl(filtered[0]);
            }
          } catch {
            // carsandbids fallback listing images skipped
          }

          return;
        }

        // BaT-only fallback: fetch gallery URLs via simple-scraper
        if (!isBat) return;
        if (!listingUrl || !listingUrl.includes('bringatrailer.com/listing/')) return;

        const { data, error } = await supabase.functions.invoke('simple-scraper', {
          body: { url: listingUrl },
        });

        if (error) throw error;
        const images: string[] =
          (data?.success && Array.isArray(data?.data?.images) ? data.data.images : null) ||
          (Array.isArray(data?.images) ? data.images : null) ||
          [];

        const filtered = filterNonPhotoListingUrls(images);
        if (filtered.length > 0) {
          setFallbackListingImageUrls(filtered);
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(filtered.slice(0, 250)));
          } catch {
            // ignore
          }
          if (!leadImageUrl && filtered[0]) setLeadImageUrl(filtered[0]);
        }
      } catch {
        // fallback listing images skipped
      }
    })();
    // Intentionally omit leadImageUrl to avoid re-fetch loops; we set it opportunistically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, (vehicle as any)?.profile_origin, (vehicle as any)?.discovery_url, auctionPulse?.listing_url, vehicleImages.length]);

  // buildAuctionPulseFromExternalListings extracted to ./vehicle-profile/buildAuctionPulse.ts (uses vehicle_events now)

  // MOBILE DETECTION
  useEffect(() => {
    const checkMobile = () => {
      const isNarrowScreen = window.innerWidth < 768;
      // Treat tablet widths (e.g., ~800px iPad) as non-mobile. Mobile UI should only
      // activate at true phone widths to avoid degrading tablet/desktop layouts.
      setIsMobile(isNarrowScreen);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Left column: make all cards collapsible by clicking the header bar.
  // This avoids rewriting every individual card component while keeping behavior consistent.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!vehicle?.id) return;

    const container = document.querySelector('.vehicle-profile-left-column');
    if (!container) return;

    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Don't collapse when interacting with controls in the header (buttons, links, inputs, etc.).
      if (target.closest('button, a, input, select, textarea, label, [role="button"]')) return;

      const header = target.closest('.card-header') as HTMLElement | null;
      if (!header) return;

      const card = header.closest('.card') as HTMLElement | null;
      if (!card) return;

      // Only collapse top-level cards in the left column (ignore nested cards inside a card body).
      let p: HTMLElement | null = card.parentElement;
      while (p && p !== container) {
        if (p.classList.contains('card')) return;
        p = p.parentElement;
      }
      if (p !== container) return;

      card.classList.toggle('is-collapsed');
    };

    container.addEventListener('click', onClick);
    return () => {
      container.removeEventListener('click', onClick);
    };
  }, [vehicle?.id]);

  // PAGE TITLE MANAGEMENT
  usePageTitle(() => getVehicleTitle(vehicle));

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
  const { isAdmin: isAdminUser } = useAdminAccess();

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
  const canTriggerProofAnalysis = Boolean(isRowOwner || isVerifiedOwner || hasContributorAccess || isAdminUser);

  // Consolidated permissions object - ensure all values are primitives for React safety
  const permissions: VehiclePermissions = {
    isVerifiedOwner: Boolean(isVerifiedOwner),
    hasContributorAccess: Boolean(hasContributorAccess),
    contributorRole: contributorRole ? String(contributorRole) : null,
    isDbUploader: Boolean(isDbUploader)
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
    } catch { /* ignore */ }
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
      // Trigger vehicle-expert-agent
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
        // Quarantine/duplicate rows should never appear in standard galleries
        .or('is_duplicate.is.null,is_duplicate.eq.false')
        .not('image_vehicle_match_status', 'in', '("mismatch","unrelated")');
        // NO LIMIT - show ALL images from all sources
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
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
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
      
      // Check admin status
      if (currentSession?.user) {
        const adminStatus = await AdminNotificationService.isCurrentUserAdmin();
        setIsAdmin(adminStatus);
      }
    };
    checkInitialAuth();
  }, []);
  
  useEffect(() => {
    if (!vehicleId || !authChecked) return;
    loadVehicle();
    loadTimelineEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, authChecked]);

  // Auto-create bundle events when owner views their vehicle
  // Fire-and-forget: idempotent, safe to run on every load
  useEffect(() => {
    if (!vehicleId || !canEdit) return;
    const token = session?.access_token;
    if (!token) return;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-create-bundle-events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vehicle_id: vehicleId }),
    }).catch(() => {}); // intentionally silent — not critical path
  }, [vehicleId, canEdit, session?.access_token]);

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
      } catch { /* ignore */ }
    };

    const timelineHandler = (e: any) => {
      const vid = e?.detail?.vehicleId;
      if (!vehicleId || (vid && vid !== vehicleId)) return;
      try {
        loadTimelineEvents();
      } catch { /* ignore */ }
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
      loadTotalCommentCount();
      // Load observation count from vehicle_observations
      supabase
        .from('vehicle_observations')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .then(({ count }) => { if (count !== null) setObservationCount(count); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]); // Only re-run when vehicle ID changes, not on every vehicle object change

  useEffect(() => {
    if (!vehicle?.id) return;
    loadLinkedOrgs(vehicle.id);
  }, [vehicle?.id]); // Removed loadLinkedOrgs from deps - it's useCallback with [] deps so never changes

  // Realtime vehicle and image updates: refresh when database changes
  // This ensures profile pages update immediately when fix scripts or other processes update the database
  useEffect(() => {
    if (!vehicle?.id) return;

    const vehicleIdForFilter = vehicle.id;

    const channel = supabase
      .channel(`vehicle-updates:${vehicleIdForFilter}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'vehicles',
          filter: `id=eq.${vehicleIdForFilter}`,
        },
        (payload) => {
          const updatedVehicle = (payload as any)?.new as any;
          if (updatedVehicle) {
            // Vehicle updated via realtime
            // Reload vehicle data to get all updated fields (bat_seller, bat_location, etc.)
            loadVehicle();
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vehicle_images',
          filter: `vehicle_id=eq.${vehicleIdForFilter}`,
        },
        (payload) => {
          const event = (payload as any)?.eventType || (payload as any)?.event;
          // Vehicle images changed via realtime
          // Reload images immediately when source changes, new images added, or images deleted
          loadVehicleImages();
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        try {
          channel.unsubscribe();
        } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]); // Only re-subscribe when vehicle ID changes

  // Realtime auction pulse: update header telemetry as vehicle_events rows change
  // (BaT/Classic/etc) and as auction_comments stream in.
  useEffect(() => {
    if (!vehicle?.id) return;

    const vehicleIdForFilter = vehicle.id;

    const channel = supabase
      .channel(`auction-pulse:${vehicleIdForFilter}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vehicle_events',
          filter: `vehicle_id=eq.${vehicleIdForFilter}`,
        },
        (payload) => {
          const row = (payload as any)?.new as any;
          if (!row) return;
          // If we already have a specific listing_url, ignore other events for this vehicle.
          if (auctionPulse?.listing_url && row.source_url && row.source_url !== auctionPulse.listing_url) return;

          // IMPORTANT: multiple pipelines can create duplicate rows with the same source_url.
          // Recompute from the DB snapshot and merge, so "active" wins over stale "sold" duplicates.
          (async () => {
            try {
              const { data } = await supabase
                .from('vehicle_events')
                .select('source_platform, source_url, event_status, ended_at, current_price, bid_count, watcher_count, view_count, metadata, updated_at')
                .eq('vehicle_id', vehicleIdForFilter)
                .order('updated_at', { ascending: false })
                .limit(20);
              // Normalize vehicle_events columns to legacy shape for buildAuctionPulseFromExternalListings
              const normalized = (Array.isArray(data) ? data : []).map((r: any) => ({
                platform: r.source_platform,
                listing_url: r.source_url,
                listing_status: r.event_status,
                end_date: r.ended_at,
                current_bid: r.current_price,
                bid_count: r.bid_count,
                watcher_count: r.watcher_count,
                view_count: r.view_count,
                metadata: r.metadata,
                updated_at: r.updated_at,
              }));
              const merged = buildAuctionPulseFromExternalListings(normalized, vehicleIdForFilter);
              if (merged) {
                setAuctionPulse((prev: any) => ({ ...(prev || {}), ...merged }));
              }
            } catch {
              // ignore
            }
          })();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'auction_comments',
          filter: `vehicle_id=eq.${vehicleIdForFilter}`,
        },
        (payload) => {
          const row = (payload as any)?.new as any;
          const postedAt = row?.posted_at ? String(row.posted_at) : null;
          const isBid = row?.bid_amount !== null && row?.bid_amount !== undefined;
          setAuctionPulse((prev: any) => {
            if (!prev) return prev;
            const nextCommentCount = typeof prev.comment_count === 'number' ? prev.comment_count + 1 : 1;
            return {
              ...prev,
              comment_count: nextCommentCount,
              last_comment_at: postedAt || prev.last_comment_at || null,
              last_bid_at: isBid ? (postedAt || prev.last_bid_at || null) : (prev.last_bid_at || null),
            };
          });
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        try {
          channel.unsubscribe();
        } catch { /* ignore */ }
      }
    };
  }, [vehicle?.id, auctionPulse?.listing_url, auctionPulse?.platform]);

  // Realtime meme drops on this vehicle are handled by useVehicleMemeDrops()

  // Lightweight auction pulse polling (vehicle_events + last bid/comment timestamps).
  // This makes live auction vehicles feel bustling without needing a full realtime channel.
  useEffect(() => {
    if (!vehicle?.id) return;
    if (!auctionPulse?.listing_url) return;

    let cancelled = false;

    const refreshAuctionPulse = async () => {
      try {
        // Re-read event records and merge duplicates for the same URL.
        const { data: events } = await supabase
          .from('vehicle_events')
          .select('source_platform, source_url, event_status, ended_at, current_price, bid_count, watcher_count, view_count, metadata, updated_at')
          .eq('vehicle_id', vehicle.id)
          .eq('source_url', auctionPulse?.listing_url || '')
          .order('updated_at', { ascending: false })
          .limit(20);

        // Normalize vehicle_events columns to legacy shape for buildAuctionPulseFromExternalListings
        const normalized = (Array.isArray(events) ? events : []).map((r: any) => ({
          platform: r.source_platform,
          listing_url: r.source_url,
          listing_status: r.event_status,
          end_date: r.ended_at,
          current_bid: r.current_price,
          bid_count: r.bid_count,
          watcher_count: r.watcher_count,
          view_count: r.view_count,
          metadata: r.metadata,
          updated_at: r.updated_at,
        }));
        const merged = buildAuctionPulseFromExternalListings(normalized, vehicle.id);
        const platform = String((merged as any)?.platform || auctionPulse?.platform || '');
        const listingUrl = String((merged as any)?.listing_url || auctionPulse?.listing_url || '');

        let commentCount: number | null =
          typeof (merged as any)?.comment_count === 'number'
            ? (merged as any).comment_count
            : (typeof auctionPulse?.comment_count === 'number' ? auctionPulse.comment_count : null);
        let lastBidAt: string | null = auctionPulse?.last_bid_at || null;
        let lastCommentAt: string | null = auctionPulse?.last_comment_at || null;

        try {
          const [cCount, lastBid, lastComment, lastSeller] = await Promise.all([
            commentCount === null
              ? supabase
                  .from('auction_comments')
                  .select('id', { count: 'exact', head: true })
                  .eq('vehicle_id', vehicle.id)
              : Promise.resolve({ count: commentCount } as any),
            supabase
              .from('auction_comments')
              .select('posted_at, author_username')
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
            supabase
              .from('auction_comments')
              .select('author_username')
              .eq('vehicle_id', vehicle.id)
              .eq('is_seller', true)
              .order('posted_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
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
        } catch {
          // ignore telemetry failures
        }

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
            // Preserve any derived winner/seller identity from auction_comments
            winner_name: (auctionPulse as any)?.winner_name ?? null,
            seller_username: (auctionPulse as any)?.seller_username ?? null,
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
      // For imported profiles, show organization instead of user.
      // This applies to Classic.com/org imports too (not just Dropbox).
      const origin = String(vehicle?.profile_origin || '');
      const isImportedProfile = Boolean(
        vehicle?.origin_organization_id &&
          (
            vehicle?.origin_metadata?.automated_import === true ||
            vehicle?.origin_metadata?.no_user_uploader === true ||
            !vehicle?.uploaded_by ||
            ['dropbox_import', 'url_scraper', 'api_import', 'organization_import', 'classic_com_indexing'].includes(origin)
          )
      );
      
      if (isImportedProfile && vehicle?.origin_organization_id) {
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
        // If org exists but name fetch fails, still avoid an empty card.
        setResponsibleName('Imported');
        return;
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

  const loadTotalCommentCount = async () => {
    try {
      if (!vehicle?.id) return;
      const { count, error } = await supabase
        .from('vehicle_comments')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);
      if (!error && count !== null) {
        setTotalCommentCount(count);
      }
    } catch {
      // ignore
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
      if (data) setLiveSession({
        id: data.id,
        platform: data.platform,
        stream_url: data.stream_url,
        title: data.title,
      });
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
    const rpcMatchesThisVehicle =
      rpcData &&
      (rpcData.vehicle_id === vehicleId || (vehicle?.id && rpcData.vehicle_id === vehicle.id));
    if (rpcMatchesThisVehicle && rpcData?.timeline_events) {
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

      // If no timeline_events, synthesize from vehicle_images photo dates
      if (!events?.length && vehicleId) {
        try {
          const { data: photos } = await supabase
            .from('vehicle_images')
            .select('taken_at, source, image_category, category')
            .eq('vehicle_id', vehicleId)
            .not('taken_at', 'is', null)
            .order('taken_at', { ascending: true });

          if (photos?.length) {
            // Group photos by date into synthetic timeline events
            const byDate: Record<string, number> = {};
            for (const p of photos) {
              const d = new Date(p.taken_at).toISOString().slice(0, 10);
              byDate[d] = (byDate[d] || 0) + 1;
            }
            const synthetic = Object.entries(byDate).map(([date, count]) => ({
              event_date: date,
              event_type: 'photo_session',
              title: `${count} photo${count > 1 ? 's' : ''} documented`,
              category: 'documentation',
              created_at: date,
            }));
            setTimelineEvents(synthetic);
            return;
          }
        } catch {
          // Fallback: no synthetic events
        }
      }

      setTimelineEvents(events || []);
    } catch (error) {
      console.error('Error loading timeline events:', error);
    }
  };

  const loadVehicle = async () => {
    await loadVehicleImpl({
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
      setAuctionPulse,
    });

    // Auto-select best hero image based on quality/zone scores (non-blocking)
    if (vehicleId) {
      selectBestHeroImage(vehicleId, supabase).then((result) => {
        if (result?.url) {
          setLeadImageUrl(result.url);
          setHeroMeta(result.meta);
        }
      }).catch(() => {
        // Non-fatal: keep whatever leadImageUrl was already set
      });
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
    } catch {
      // View recording failed silently
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
    } catch {
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
        .eq('vehicle_id', vehicle.id)
        // Quarantine/duplicate rows should never appear in standard galleries
        .or('is_duplicate.is.null,is_duplicate.eq.false')
        .not('image_vehicle_match_status', 'in', '("mismatch","unrelated")');

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
    await loadVehicleImagesImpl({
      vehicle,
      session,
      leadImageUrl,
      supabase,
      setVehicleImages,
      setLeadImageUrl,
    });
  };

  // loadWalkAroundImages removed (carousel removed from layout)

  const handleSetPrimaryImage = async (imageId: string) => {
    if (!vehicle || !isAdmin) {
      return; // Admin privileges required
    }

    try {
      // Clear all primary flags for this vehicle
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicle.id);

      // Set the selected image as primary
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      if (updateError) throw updateError;

      // Also update vehicle's primary_image_url if the image has a URL
      const { data: imageData } = await supabase
        .from('vehicle_images')
        .select('image_url, large_url, medium_url')
        .eq('id', imageId)
        .single();

      if (imageData) {
        const imageUrl = imageData.large_url || imageData.medium_url || imageData.image_url;
        if (imageUrl) {
          await supabase
            .from('vehicles')
            .update({ primary_image_url: imageUrl })
            .eq('id', vehicle.id);
        }
      }

      // Reload images to reflect the change
      await loadVehicleImages();
      // Primary image updated
    } catch (error: any) {
      console.error('Error setting primary image:', error);
      // Failed to set primary image
    }
  };

  // Auto-run BaT import once for bat_import vehicles that have no images / broken identity.
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) return;
        // Only attempt auto-import when auth has been checked and we have a user session.
        // Supabase Edge Functions in this project require a real user JWT (not anon key).
        if (!authChecked) return;
        if (!session?.user?.id) return;

        const origin = String((vehicle as any)?.profile_origin || '');
        const discoveryUrl = String((vehicle as any)?.discovery_url || '');
        const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');
        if (!isBat) return;

        // Guard: don't spam imports for the same vehicle.
        const key = `bat_auto_import_attempted_${vehicle.id}`;
        const attempted = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        if (attempted) return;

        const make = String((vehicle as any)?.make || '');
        const model = String((vehicle as any)?.model || '');
        const looksBadIdentity = /mile/i.test(make) || /bring a trailer/i.test(model) || /on\s+bat\s+auctions/i.test(model) || model.length > 80;

        // If we already have images and identity looks fine, do nothing.
        const hasAnyImages = Array.isArray(vehicleImages) && vehicleImages.length > 0;
        if (hasAnyImages && !looksBadIdentity) return;

        // Mark attempted once we are actually going to call the function (prevents anon 401 from poisoning retries).
        window.localStorage.setItem(key, new Date().toISOString());
        setBatAutoImportStatus('running');

        const batUrl =
          discoveryUrl ||
          String((vehicle as any)?.bat_auction_url || '') ||
          String((vehicle as any)?.listing_url || '');
        if (!batUrl.includes('bringatrailer.com/listing/')) {
          setBatAutoImportStatus('failed');
          return;
        }

        const { data, error } = await supabase.functions.invoke('complete-bat-import', {
          body: { bat_url: batUrl, vehicle_id: vehicle.id }
        });

        if (error || !data) {
          console.warn('BaT auto-import failed:', error);
          // Allow retry next time.
          try { window.localStorage.removeItem(key); } catch { /* ignore */ }
          setBatAutoImportStatus('failed');
          return;
        }

        // Refresh vehicle + images + timeline after import
        await loadVehicle();
        await loadTimelineEvents();
        await loadVehicleImages();
        setBatAutoImportStatus('done');
      } catch (e) {
        console.warn('BaT auto-import exception:', e);
        // Allow retry next time.
        try {
          if (vehicle?.id) window.localStorage.removeItem(`bat_auto_import_attempted_${vehicle.id}`);
        } catch { /* ignore */ }
        try { setBatAutoImportStatus('failed'); } catch { /* ignore */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, authChecked, session?.user?.id]);

  if (loading) {
    return (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicle...</p>
        </div>
    );
  }

  if (!vehicle) {
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
  
  // readinessScore removed - was computed but never used in render

  // renderWorkspaceContent extracted to WorkspaceContent.tsx

  // Render vehicle profile (responsive for mobile and desktop)
  return (
      <div className="vehicle-profile-page">
        {/* Vehicle Sub-Header with Price — sticky, z-900 per V3 spec */}
        <div ref={vehicleHeaderRef} className="vehicle-profile-sub-header" style={{ position: 'sticky', top: 'var(--header-height, 40px)', zIndex: 900 }}>
          <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading header...</div>}>
            <VehicleHeader
              vehicle={vehicle}
              isOwner={isRowOwner || isVerifiedOwner}
              canEdit={canEdit}
              session={session}
              permissions={permissions}
              responsibleName={responsibleName || undefined}
              initialValuation={(window as any).__vehicleProfileRpcData?.latest_valuation}
              initialPriceSignal={(window as any).__vehicleProfileRpcData?.price_signal}
              organizationLinks={linkedOrganizations}
              onClaimClick={() => setShowOwnershipClaim(true)}
              userOwnershipClaim={userOwnershipClaim as any}
              suppressExternalListing={!!userOwnershipClaim}
              leadImageUrl={leadImageUrl}
              liveSession={liveSession}
              auctionPulse={auctionPulse}
            />
          </React.Suspense>
        </div>

        {/* Vehicle Sub-Header — sticky badge bar */}
        <React.Suspense fallback={null}>
          <VehicleSubHeader vehicle={vehicle} />
        </React.Suspense>

        {/* Banners: BaT data flag, live auction, external auction, orphaned vehicle, merge proposals */}
        <React.Suspense fallback={null}>
          <VehicleBanners
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            auctionPulse={auctionPulse}
            auctionCurrency={auctionCurrency}
            isVerifiedOwner={isVerifiedOwner}
            onMergeComplete={() => loadVehicle()}
          />
        </React.Suspense>

        {/* Barcode Timeline — sticky, 10px collapsed, expandable to heatmap */}
        <React.Suspense fallback={null}>
          <BarcodeTimeline vehicle={vehicle} timelineEvents={timelineEvents} />
        </React.Suspense>

        {/* Hero Image Section */}
        <div id="vehicle-hero" className="hero" style={{ scrollMarginTop: 'calc(var(--header-height, 40px) + 88px)' }}>
          <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading hero image...</div>}>
            <VehicleHeroImage
              leadImageUrl={leadImageUrl}
              heroMeta={heroMeta}
              overlayNode={<VehicleMemeOverlay lastEvent={lastMemeDrop} />}
            />
          </React.Suspense>
        </div>

        {/* Quick Stats — real data counts from vehicle_images and vehicle_observations */}
        <QuickStatsBar
          imageCount={vehicleImages.length}
          eventCount={timelineEvents.length}
          commentCount={totalCommentCount}
          observationCount={observationCount}
          updatedAt={vehicle?.updated_at}
        />

        {/* Add Organization Relationship Modal */}
        {showAddOrgRelationship && vehicle && session?.user?.id && (
          <React.Suspense fallback={null}>
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
          </React.Suspense>
        )}

        {/* Workspace tab bar removed — all content renders flat */}

        {/* Main Content */}
        <div style={{ marginTop: '0' }}>
          <React.Suspense fallback={<div style={{ padding: '10px 16px', textAlign: 'center', color: '#888', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Loading...</div>}>
            {vehicle ? (
              <WorkspaceContent
                vehicle={vehicle}
                session={session}
                permissions={permissions}
                activeWorkspaceTab={'evidence' as any}
                isMobile={isMobile}
                isRowOwner={isRowOwner}
                isVerifiedOwner={isVerifiedOwner}
                hasContributorAccess={hasContributorAccess}
                canEdit={canEdit}
                isAdminUser={isAdminUser}
                canTriggerProofAnalysis={canTriggerProofAnalysis}
                timelineEvents={timelineEvents}
                vehicleImages={vehicleImages}
                fallbackListingImageUrls={fallbackListingImageUrls}
                totalCommentCount={totalCommentCount}
                isPublic={isPublic}
                vehicleHeaderHeight={vehicleHeaderHeight}
                liveSession={liveSession}
                referenceLibraryRefreshKey={referenceLibraryRefreshKey}
                auctionPulse={auctionPulse}
                valuationIntel={valuationIntel}
                readinessSnapshot={readinessSnapshot}
                onAddEventClick={() => setShowAddEvent(true)}
                onDataPointClick={handleDataPointClick}
                onEditClick={handleEditClick}
                onLoadLiveSession={loadLiveSession}
                onLoadVehicle={loadVehicle}
                onLoadTimelineEvents={loadTimelineEvents}
                onLoadVehicleImages={loadVehicleImages}
                onUpdatePrivacy={updatePrivacy}
                onSetIsPublic={setIsPublic}
                onSetReferenceLibraryRefreshKey={setReferenceLibraryRefreshKey}
              />
            ) : (
              <div className="card">
                <div className="card-body">
                  Vehicle data is still loading...
                </div>
              </div>
            )}
          </React.Suspense>
        </div>

        {/* Granular Validation Popup */}
        {validationPopup.open && vehicle && (
          <React.Suspense fallback={null}><ValidationPopupV2
            vehicleId={vehicle.id}
            fieldName={validationPopup.fieldName}
            fieldValue={validationPopup.fieldValue}
            vehicleYear={vehicle.year}
            vehicleMake={vehicle.make}
            onClose={() => setValidationPopup(prev => ({ ...prev, open: false }))}
          /></React.Suspense>
        )}

      {/* Add Event Wizard Modal */}
      {showAddEvent && (
        <React.Suspense fallback={null}><AddEventWizard
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
        /></React.Suspense>
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
              backgroundColor: 'var(--surface)',
              borderRadius: '8px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
              <React.Suspense fallback={<div style={{ padding: '12px', color: 'var(--text-muted)' }}>Loading...</div>}>
                <VehicleOwnershipPanel
                  vehicle={vehicle}
                  session={session}
                  isOwner={isRowOwner || isVerifiedOwner}
                  hasContributorAccess={hasContributorAccess}
                  contributorRole={contributorRole ?? undefined}
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}
      </div>
  );
};

export default VehicleProfile;