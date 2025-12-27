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
import { usePageTitle, getVehicleTitle } from '../hooks/usePageTitle';
import LiveAuctionBanner from '../components/auction/LiveAuctionBanner';
import TransactionHistory from '../components/vehicle/TransactionHistory';
import ValidationPopupV2 from '../components/vehicle/ValidationPopupV2';
import { BATListingManager } from '../components/vehicle/BATListingManager';
import VehicleDescriptionCard from '../components/vehicle/VehicleDescriptionCard';
import VehicleCommentsCard from '../components/vehicle/VehicleCommentsCard';
import VehicleROISummaryCard from '../components/vehicle/VehicleROISummaryCard';
import { VehicleStructuredListingDataCard } from './vehicle-profile/VehicleStructuredListingDataCard';
import VehicleMemeOverlay from '../components/vehicle/VehicleMemeOverlay';
import VehicleMemePanel from '../components/vehicle/VehicleMemePanel';
import type { ContentActionEvent } from '../services/streamActionsService';
// Lazy load heavy components to avoid circular dependencies
const MergeProposalsPanel = React.lazy(() => import('../components/vehicle/MergeProposalsPanel'));
// VehicleProfileTabs removed - using curated layout instead
import { calculateFieldScores, calculateFieldScore, analyzeImageEvidence, type FieldSource } from '../services/vehicleFieldScoring';
import type { Session } from '@supabase/supabase-js';
import ReferenceLibraryUpload from '../components/reference/ReferenceLibraryUpload';
import VehicleReferenceLibrary from '../components/vehicle/VehicleReferenceLibrary';
import VehicleOwnershipPanel from '../components/ownership/VehicleOwnershipPanel';
import OrphanedVehicleBanner from '../components/vehicle/OrphanedVehicleBanner';
import { AdminNotificationService } from '../services/adminNotificationService';
import ImageGallery from '../components/images/ImageGallery';

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
  const [fallbackListingImageUrls, setFallbackListingImageUrls] = useState<string[]>([]);
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
  const ranBatSyncRef = React.useRef<string | null>(null);
  const [batAutoImportStatus, setBatAutoImportStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [lastMemeDrop, setLastMemeDrop] = useState<ContentActionEvent | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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
        if (!isBat) return;
        if (!listingUrl || !listingUrl.includes('bringatrailer.com/listing/')) return;
        if (fallbackListingImageUrls.length > 0) return;

        const cacheKey = `bat_fallback_images_${vehicle.id}`;
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
      } catch (e) {
        console.debug('[VehicleProfile] fallback listing images skipped:', e);
      }
    })();
    // Intentionally omit leadImageUrl to avoid re-fetch loops; we set it opportunistically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, (vehicle as any)?.profile_origin, (vehicle as any)?.discovery_url, auctionPulse?.listing_url, vehicleImages.length]);

  // Build a stable "auction pulse" for the header from *all* external listing rows.
  // We intentionally merge duplicate rows that share the same `listing_url` (multiple import pipelines)
  // so the UI doesn't flip to SOLD just because a stale duplicate row updated last.
  const buildAuctionPulseFromExternalListings = useCallback((rows: any[], vehicleIdForRows: string) => {
    let arr = Array.isArray(rows) ? rows.filter((r) => r && r.listing_url && r.platform) : [];
    if (arr.length === 0) return null;
    
    // Filter out stale "active" listings if vehicle is sold (check vehicle data if available)
    // This prevents showing old bid amounts when vehicle has been sold
    const vehicleData = (window as any).__vehicleProfileRpcData?.vehicle;
    const vehicleIsSold = vehicleData?.sale_price > 0 || 
                         vehicleData?.sale_status === 'sold' ||
                         vehicleData?.auction_outcome === 'sold';
    
    if (vehicleIsSold) {
      // Remove "active" listings when vehicle is sold - they're stale
      const filtered = arr.filter(r => {
        const status = String(r.listing_status || '').toLowerCase();
        return status !== 'active' && status !== 'live';
      });
      if (filtered.length > 0) {
        arr = filtered;
      }
    }

    const now = Date.now();
    const toLower = (v: any) => String(v || '').toLowerCase();
    const parseTs = (v: any) => {
      try {
        if (v === null || typeof v === 'undefined') return NaN;
        // Support unix timestamps (seconds or millis) in addition to ISO strings.
        if (typeof v === 'number' && Number.isFinite(v)) {
          const ms = v < 1e12 ? v * 1000 : v;
          return Number.isFinite(ms) ? ms : NaN;
        }
        const s = String(v).trim();
        if (!s) return NaN;
        if (/^\d{9,14}$/.test(s)) {
          const n = Number(s);
          if (!Number.isFinite(n)) return NaN;
          return n < 1e12 ? n * 1000 : n;
        }
        const t = new Date(s).getTime();
        return Number.isFinite(t) ? t : NaN;
      } catch {
        return NaN;
      }
    };

    const maxAuctionHorizonMs = (platform: string, url: string) => {
      const p = toLower(platform);
      const u = toLower(url);
      // Auction-style platforms should never show 30+ day countdowns.
      if (p === 'bat' || u.includes('bringatrailer.com')) return 10 * 24 * 60 * 60 * 1000;
      if (p === 'cars_and_bids' || u.includes('carsandbids.com')) return 10 * 24 * 60 * 60 * 1000;
      if (p.includes('ebay') || u.includes('ebay.com')) return 21 * 24 * 60 * 60 * 1000;
      // Default: 14 days (keeps us from rendering obvious garbage timers).
      return 14 * 24 * 60 * 60 * 1000;
    };

    const byUrl = new Map<string, any[]>();
    for (const r of arr) {
      const url = String(r.listing_url || '').trim();
      if (!url) continue;
      const list = byUrl.get(url) || [];
      list.push(r);
      byUrl.set(url, list);
    }

    const scoreRow = (r: any) => {
      const status = toLower(r?.listing_status);
      const end = parseTs(r?.end_date);
      const endFuture = Number.isFinite(end) ? end > now : false;
      const hasTelemetry =
        typeof r?.current_bid === 'number' ||
        typeof r?.bid_count === 'number' ||
        typeof r?.watcher_count === 'number' ||
        typeof r?.view_count === 'number' ||
        (typeof r?.metadata?.comment_count === 'number');
      const hasFinalPrice = typeof r?.final_price === 'number' && Number.isFinite(r.final_price) && r.final_price > 0;
      const hasLiveSignals =
        endFuture ||
        (typeof r?.current_bid === 'number' && Number.isFinite(r.current_bid) && r.current_bid > 0) ||
        (typeof r?.bid_count === 'number' && Number.isFinite(r.bid_count) && r.bid_count > 0);

      // Prefer rows that are demonstrably live or demonstrably sold.
      if (status === 'sold' && hasFinalPrice) return 5;
      if ((status === 'active' || status === 'live') && hasLiveSignals) return 4;
      if (status === 'sold') return 3;
      if (status === 'active' || status === 'live') return 2;
      if (endFuture) return 2;
      if (hasTelemetry) return 1;
      return 0;
    };

    const maxNum = (vals: any[]) => {
      const nums = vals.map((v) => (typeof v === 'number' ? v : Number.NaN)).filter((n) => Number.isFinite(n));
      return nums.length ? Math.max(...nums) : null;
    };

    const mergeGroup = (group: any[]) => {
      const sorted = (group || []).slice().sort((a, b) => {
        const as = scoreRow(a);
        const bs = scoreRow(b);
        if (as !== bs) return bs - as;
        const au = parseTs(a?.updated_at);
        const bu = parseTs(b?.updated_at);
        if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
        return 0;
      });

      const best = sorted[0];
      if (!best) return null;

      // Prefer telemetry values from the "best" (highest-signal, freshest) row instead of max() across duplicates.
      const pickNum = (key: string) => {
        for (const r of sorted) {
          const v = (r as any)?.[key];
          if (typeof v === 'number' && Number.isFinite(v)) return v;
        }
        return null;
      };

      const statuses = sorted.map((r) => toLower(r?.listing_status)).filter(Boolean);
      const hasActive = statuses.some((s) => s === 'active' || s === 'live');
      const hasSold = statuses.some((s) => s === 'sold');
      const mergedStatus = (() => {
        // If any row has a sold marker + final_price, treat the group as sold.
        const anyFinal = maxNum(sorted.map((r) => r?.final_price));
        if (typeof anyFinal === 'number' && anyFinal > 0) return 'sold';
        // Otherwise, keep active if we have active/live.
        if (hasActive) return 'active';
        if (hasSold) return 'sold';
        return String(best.listing_status || '');
      })();

      const commentCounts = sorted.map((r) => (typeof r?.metadata?.comment_count === 'number' ? r.metadata.comment_count : null));
      const mergedCommentCount = maxNum(commentCounts);

      const endCandidates = sorted
        .flatMap((r) => {
          const direct = r?.end_date ? [r.end_date] : [];
          const meta = r?.metadata?.auction_end_date ? [r.metadata.auction_end_date] : [];
          return [...direct, ...meta];
        })
        .filter(Boolean)
        .map((iso) => ({ iso: String(iso), t: parseTs(iso) }))
        .filter((x) => Number.isFinite(x.t));
      const horizonMs = maxAuctionHorizonMs(String(best.platform || ''), String(best.listing_url || ''));
      const futureEnd = endCandidates
        .filter((x) => x.t > now && (x.t - now) <= horizonMs)
        .sort((a, b) => a.t - b.t)[0];
      // If no reasonable future end date exists, don't render a countdown (avoid misleading UI).
      const mergedEndDate = (futureEnd?.iso || null) as string | null;

      const updatedAt = (() => {
        const ts = sorted
          .map((r) => ({ iso: r?.updated_at ? String(r.updated_at) : null, t: parseTs(r?.updated_at) }))
          .filter((x) => x.iso && Number.isFinite(x.t))
          .sort((a, b) => b.t - a.t)[0];
        return ts?.iso || null;
      })();

      const soldAt = (() => {
        const ts = sorted
          .map((r) => ({ iso: r?.sold_at ? String(r.sold_at) : null, t: parseTs(r?.sold_at) }))
          .filter((x) => x.iso && Number.isFinite(x.t))
          .sort((a, b) => b.t - a.t)[0];
        return ts?.iso || null;
      })();

      return {
        external_listing_id: String(best.id || ''),
        platform: String(best.platform || ''),
        listing_url: String(best.listing_url || ''),
        listing_status: mergedStatus,
        end_date: mergedEndDate,
        current_bid: maxNum(sorted.map((r) => r?.current_bid)),
        bid_count: pickNum('bid_count'),
        watcher_count: pickNum('watcher_count'),
        view_count: pickNum('view_count'),
        comment_count: mergedCommentCount,
        final_price: maxNum(sorted.map((r) => r?.final_price)),
        sold_at: soldAt,
        last_bid_at: null as string | null,
        last_comment_at: null as string | null,
        updated_at: updatedAt,
        _vehicle_id: vehicleIdForRows,
      };
    };

    const mergedGroups = Array.from(byUrl.values()).map(mergeGroup).filter(Boolean) as any[];
    if (mergedGroups.length === 0) return null;

    mergedGroups.sort((a, b) => {
      const as = scoreRow(a);
      const bs = scoreRow(b);
      if (as !== bs) return bs - as;
      const ae = parseTs(a?.end_date);
      const be = parseTs(b?.end_date);
      const aFuture = Number.isFinite(ae) ? ae > now : false;
      const bFuture = Number.isFinite(be) ? be > now : false;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      if (aFuture && bFuture && ae !== be) return ae - be;
      const au = parseTs(a?.updated_at);
      const bu = parseTs(b?.updated_at);
      if (Number.isFinite(au) && Number.isFinite(bu) && au !== bu) return bu - au;
      return 0;
    });

    return mergedGroups[0] || null;
  }, []);


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
        .eq('vehicle_id', vehicle.id);
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
            console.log('[VehicleProfile] Vehicle updated via realtime, refreshing...');
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
          console.log(`[VehicleProfile] Vehicle images ${event} via realtime, refreshing...`);
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
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]); // Only re-subscribe when vehicle ID changes

  // Realtime auction pulse: update header telemetry as external listing rows change
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
          table: 'external_listings',
          filter: `vehicle_id=eq.${vehicleIdForFilter}`,
        },
        (payload) => {
          const row = (payload as any)?.new as any;
          if (!row) return;
          // If we already have a specific listing_url, ignore other listings for this vehicle.
          if (auctionPulse?.listing_url && row.listing_url && row.listing_url !== auctionPulse.listing_url) return;

          // IMPORTANT: multiple pipelines can create duplicate rows with the same listing_url.
          // Recompute from the DB snapshot and merge, so "active" wins over stale "sold" duplicates.
          (async () => {
            try {
              const { data } = await supabase
                .from('external_listings')
                .select('platform, listing_url, listing_status, end_date, current_bid, bid_count, watcher_count, view_count, metadata, updated_at')
                .eq('vehicle_id', vehicleIdForFilter)
                .order('updated_at', { ascending: false })
                .limit(20);
              const merged = buildAuctionPulseFromExternalListings(Array.isArray(data) ? data : [], vehicleIdForFilter);
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
          event: '*',
          schema: 'public',
          table: 'bat_listings',
          filter: `vehicle_id=eq.${vehicleIdForFilter}`,
        },
        (payload) => {
          const row = (payload as any)?.new as any;
          if (!row) return;
          // Only apply BaT table updates when the pulse is already BaT (or not set yet).
          if (auctionPulse?.platform && auctionPulse.platform !== 'bat') return;

          setAuctionPulse((prev: any) => {
            const p = prev || ({} as any);
            return {
              platform: 'bat',
              listing_url: String(row?.bat_listing_url || p.listing_url || ''),
              listing_status: String(row?.listing_status || p.listing_status || ''),
              end_date: row?.auction_end_date ? new Date(row.auction_end_date).toISOString() : (p.end_date ?? null),
              current_bid: typeof row?.current_bid === 'number' ? row.current_bid : (p.current_bid ?? null),
              bid_count: typeof row?.bid_count === 'number' ? row.bid_count : (p.bid_count ?? null),
              watcher_count: typeof row?.watcher_count === 'number' ? row.watcher_count : (p.watcher_count ?? null),
              view_count: typeof row?.view_count === 'number' ? row.view_count : (p.view_count ?? null),
              comment_count: typeof row?.comment_count === 'number' ? row.comment_count : (p.comment_count ?? null),
              last_bid_at: p.last_bid_at ?? null,
              last_comment_at: p.last_comment_at ?? null,
              updated_at: row?.updated_at ?? p.updated_at ?? null,
            };
          });
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
        } catch {}
      }
    };
  }, [vehicle?.id, auctionPulse?.listing_url, auctionPulse?.platform]);

  // Realtime meme drops on this vehicle
  useEffect(() => {
    if (!vehicle?.id) return;

    const targetKey = `vehicle:${vehicle.id}`;
    const channel = supabase
      .channel(`meme-drops:${vehicle.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'content_action_events',
          filter: `target_key=eq.${targetKey}`,
        },
        (payload) => {
          const row = (payload as any)?.new as any;
          if (!row) return;
          setLastMemeDrop(row as any);
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        try {
          channel.unsubscribe();
        } catch {}
      }
    };
  }, [vehicle?.id]);

  // Lightweight auction pulse polling (external listings + last bid/comment timestamps).
  // This makes live auction vehicles feel bustling without needing a full realtime channel.
  useEffect(() => {
    if (!vehicle?.id) return;
    if (!auctionPulse?.listing_url) return;

    let cancelled = false;

    const refreshAuctionPulse = async () => {
      try {
        // Re-read listing records and merge duplicates for the same URL.
        const { data: listings } = await supabase
          .from('external_listings')
          .select('platform, listing_url, listing_status, end_date, current_bid, bid_count, watcher_count, view_count, metadata, updated_at')
          .eq('vehicle_id', vehicle.id)
          .eq('listing_url', auctionPulse.listing_url)
          .order('updated_at', { ascending: false })
          .limit(20);

        const merged = buildAuctionPulseFromExternalListings(Array.isArray(listings) ? listings : [], vehicle.id);
        const platform = String((merged as any)?.platform || auctionPulse.platform || '');
        const listingUrl = String((merged as any)?.listing_url || auctionPulse.listing_url || '');

        let commentCount: number | null =
          typeof (merged as any)?.comment_count === 'number'
            ? (merged as any).comment_count
            : (typeof auctionPulse.comment_count === 'number' ? auctionPulse.comment_count : null);
        let lastBidAt: string | null = auctionPulse.last_bid_at || null;
        let lastCommentAt: string | null = auctionPulse.last_comment_at || null;

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
            listing_status: String((merged as any)?.listing_status || auctionPulse.listing_status || ''),
            end_date: (merged as any)?.end_date ?? auctionPulse.end_date ?? null,
            current_bid: typeof (merged as any)?.current_bid === 'number' ? (merged as any).current_bid : (auctionPulse.current_bid ?? null),
            bid_count: typeof (merged as any)?.bid_count === 'number' ? (merged as any).bid_count : (auctionPulse.bid_count ?? null),
            watcher_count: typeof (merged as any)?.watcher_count === 'number' ? (merged as any).watcher_count : (auctionPulse.watcher_count ?? null),
            view_count: typeof (merged as any)?.view_count === 'number' ? (merged as any).view_count : (auctionPulse.view_count ?? null),
            comment_count: commentCount,
            last_bid_at: lastBidAt,
            last_comment_at: lastCommentAt,
            updated_at: (merged as any)?.updated_at ?? auctionPulse.updated_at ?? null,
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

      setTimelineEvents(events || []);
    } catch (error) {
      console.error('Error loading timeline events:', error);
    }
  };


  const loadVehicle = async () => {
    try {
      setLoading(true);
      // Prevent cross-vehicle cache bleed when navigating between profiles.
      // We only trust RPC caches when they explicitly match the current vehicle.
      (window as any).__vehicleProfileRpcData = null;

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
          vehicle_id: vehicleData.id,
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
      
      // Initialize leadImageUrl from primary_image_url if available
      const primaryImg = (vehicleData as any)?.primary_image_url || (vehicleData as any)?.primaryImageUrl || (vehicleData as any)?.image_url;
      if (primaryImg && !leadImageUrl) {
        setLeadImageUrl(primaryImg);
      }

      // Derive auction pulse for header (prefer external_listings over stale vehicles.* fields)
      try {
        const rpcCache = (window as any).__vehicleProfileRpcData;
        const listings =
          rpcCache && rpcCache.vehicle_id === vehicleData.id ? rpcCache.external_listings : null;
        let arr = Array.isArray(listings) ? listings : [];

        // If RPC didn't include listings (or returned empty due to env/RLS quirks), do a direct fetch.
        if (arr.length === 0) {
          try {
            const { data } = await supabase
              .from('external_listings')
              .select('id, platform, listing_url, listing_status, end_date, current_bid, bid_count, watcher_count, view_count, final_price, sold_at, metadata, updated_at')
              .eq('vehicle_id', vehicleData.id)
              .order('updated_at', { ascending: false })
              .limit(10);
            arr = Array.isArray(data) ? data : [];
          } catch {
            // ignore
          }
        }
        // Filter out stale active listings if vehicle is sold
        const vehicleIsSold = (vehicleData as any)?.sale_price > 0 || 
                             (vehicleData as any)?.sale_status === 'sold' ||
                             (vehicleData as any)?.auction_outcome === 'sold';
        if (vehicleIsSold) {
          arr = arr.filter((r: any) => {
            const status = String(r.listing_status || '').toLowerCase();
            return status !== 'active' && status !== 'live';
          });
        }
        
        const best = buildAuctionPulseFromExternalListings(arr, vehicleData.id);

        // Fallback: if we can't access external_listings due to RLS, still treat BaT-discovered vehicles as "auction mode"
        // so we hide Claim/Set-price and show a link to the listing.
        const fallbackListingUrl =
          (vehicleData as any)?.bat_auction_url ||
          (String((vehicleData as any)?.discovery_url || '').includes('bringatrailer.com/listing/')
            ? String((vehicleData as any)?.discovery_url)
            : null);

        const effective = best?.listing_url && best?.platform
          ? best
          : (fallbackListingUrl
              ? ({
                  external_listing_id: null,
                  platform: 'bat',
                  listing_url: fallbackListingUrl,
                  listing_status: String((vehicleData as any)?.auction_outcome || 'unknown'),
                  end_date: (vehicleData as any)?.auction_end_date || null,
                  current_bid: typeof (vehicleData as any)?.current_bid === 'number' ? (vehicleData as any).current_bid : null,
                  bid_count: typeof (vehicleData as any)?.bid_count === 'number' ? (vehicleData as any).bid_count : null,
                  watcher_count: null,
                  view_count: null,
                  comment_count: null,
                  final_price: typeof (vehicleData as any)?.sale_price === 'number' ? (vehicleData as any).sale_price : null,
                  sold_at: (vehicleData as any)?.sold_at || null,
                  updated_at: (vehicleData as any)?.updated_at || null,
                } as any)
              : null);

        if (effective?.listing_url && effective?.platform) {
          // Lightweight comment telemetry (best-effort; table may not exist in some envs)
          // IMPORTANT: Separate bids from comments - don't combine them
          let bidCount: number | null = typeof (effective as any)?.bid_count === 'number' ? (effective as any).bid_count : null;
          let commentCount: number | null = null; // Only non-bid comments
          let lastBidAt: string | null = null;
          let lastCommentAt: string | null = null;

          try {
            const [
              bidCountResult,
              commentCountResult,
              lastBid,
              lastComment,
              lastSeller
            ] = await Promise.all([
              // Count only bids (where bid_amount is not null)
              bidCount === null
                ? supabase
                    .from('auction_comments')
                    .select('id', { count: 'exact', head: true })
                    .eq('vehicle_id', vehicleData.id)
                    .not('bid_amount', 'is', null)
                : Promise.resolve({ count: bidCount } as any),
              // Count only non-bid comments (where bid_amount is null or comment_type != 'bid')
              supabase
                .from('auction_comments')
                .select('id', { count: 'exact', head: true })
                .eq('vehicle_id', vehicleData.id)
                .or('bid_amount.is.null,comment_type.neq.bid'),
              supabase
                .from('auction_comments')
                .select('posted_at, author_username')
                .eq('vehicle_id', vehicleData.id)
                .not('bid_amount', 'is', null)
                .order('posted_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabase
                .from('auction_comments')
                .select('posted_at')
                .eq('vehicle_id', vehicleData.id)
                .or('bid_amount.is.null,comment_type.neq.bid')
                .order('posted_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabase
                .from('auction_comments')
                .select('author_username')
                .eq('vehicle_id', vehicleData.id)
                .eq('is_seller', true)
                .order('posted_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            ]);

            if (bidCount === null) bidCount = typeof (bidCountResult as any)?.count === 'number' ? (bidCountResult as any).count : null;
            commentCount = typeof (commentCountResult as any)?.count === 'number' ? (commentCountResult as any).count : null;
            lastBidAt = (lastBid as any)?.data?.posted_at || null;
            lastCommentAt = (lastComment as any)?.data?.posted_at || null;
            const winnerName = String((lastBid as any)?.data?.author_username || '').trim() || null;
            const sellerUsername = String((lastSeller as any)?.data?.author_username || '').trim() || null;
            (effective as any).winner_name = winnerName;
            (effective as any).seller_username = sellerUsername;
          } catch {
            // ignore telemetry failures
          }

          setAuctionPulse({
            external_listing_id: (effective as any).external_listing_id || null,
            platform: String((effective as any).platform),
            listing_url: String((effective as any).listing_url),
            listing_status: String((effective as any).listing_status || ''),
            end_date: (effective as any).end_date || null,
            current_bid: typeof (effective as any).current_bid === 'number' ? (effective as any).current_bid : null,
            bid_count: bidCount, // Use separated bid count
            watcher_count: typeof (effective as any).watcher_count === 'number' ? (effective as any).watcher_count : null,
            view_count: typeof (effective as any).view_count === 'number' ? (effective as any).view_count : null,
            comment_count: commentCount, // Only non-bid comments
            final_price: typeof (effective as any).final_price === 'number' ? (effective as any).final_price : null,
            sold_at: (effective as any).sold_at || null,
            last_bid_at: lastBidAt,
            last_comment_at: lastCommentAt,
            updated_at: (effective as any).updated_at || null,
            winner_name: (effective as any).winner_name ?? null,
            seller_username: (effective as any).seller_username ?? null,
          });

          // Best-effort: if this is a BaT listing and we don't yet have end_date/final_price,
          // trigger a server-side sync once per page load so the header can show a real countdown / sold price.
          try {
            const isBat = String((effective as any).platform || '').toLowerCase() === 'bat';
            const extId = (effective as any).external_listing_id ? String((effective as any).external_listing_id) : null;
            const needsSync =
              isBat &&
              !!extId &&
              (!((effective as any).end_date) || (typeof (effective as any).final_price !== 'number'));

            if (needsSync && ranBatSyncRef.current !== extId) {
              ranBatSyncRef.current = extId;
              supabase.functions
                .invoke('sync-bat-listing', { body: { externalListingId: extId } })
                .then(async () => {
                  // Refresh latest listing rows and re-derive pulse.
                  const { data } = await supabase
                    .from('external_listings')
                    .select('id, platform, listing_url, listing_status, end_date, current_bid, bid_count, watcher_count, view_count, final_price, sold_at, metadata, updated_at')
                    .eq('vehicle_id', vehicleData.id)
                    .order('updated_at', { ascending: false })
                    .limit(10);
                  const merged = buildAuctionPulseFromExternalListings(Array.isArray(data) ? data : [], vehicleData.id);
                  if (merged) {
                    setAuctionPulse((prev: any) => ({ ...(prev || {}), ...merged }));
                  }
                })
                .catch(() => {});
            }
          } catch {
            // non-blocking
          }
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

    const normalizeUrl = (u: any): string => {
      const s = String(u || '').trim();
      if (!s) return '';
      // Some scrapers store HTML-encoded query params (e.g. &amp;). Browsers won't decode those in URLs.
      return s.replace(/&amp;/g, '&');
    };

    const buildBatImageNeedle = (v: any): string | null => {
      try {
        const discoveryUrl = String(v?.discovery_url || '');
        const origin = String(v?.profile_origin || '');
        const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');
        if (!isBat) return null;
        const year = v?.year ? String(v.year) : '';
        const makeRaw = String(v?.make || '').trim().toLowerCase();
        const modelRaw = String(v?.model || '').trim().toLowerCase();
        if (!year || !makeRaw || !modelRaw) return null;
        const makeSlug = makeRaw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const modelSlug = modelRaw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!makeSlug || !modelSlug) return null;
        // BaT WordPress image paths typically include `${year}_${make}_${model}` with `_` between year+make and `-` in model tokens.
        return `${year}_${makeSlug}_${modelSlug}`;
      } catch {
        return null;
      }
    };

    const isIconUrl = (rawUrl: string): boolean => {
      const raw = String(rawUrl || '').trim();
      if (!raw) return true;
      const s = raw.toLowerCase();

      // Hard blocks: favicon endpoints and icon manifests
      if (s.includes('gstatic.com/faviconv2')) return true;
      if (s.includes('favicon.ico') || s.includes('/favicon')) return true;
      if (s.includes('apple-touch-icon')) return true;
      if (s.includes('site.webmanifest')) return true;
      if (s.includes('safari-pinned-tab')) return true;
      if (s.includes('android-chrome')) return true;
      if (s.includes('mstile')) return true;

      // Likely non-photo assets (avoid using as hero/gallery)
      if (s.endsWith('.ico')) return true;
      // Filter SVGs that are clearly UI elements (social icons, navigation, etc.)
      // BUT preserve business/auction/dealer logos stored in proper paths
      if (s.endsWith('.svg')) {
        // Allow logos from known business/auction paths
        if (s.includes('/businesses/') || s.includes('/organizations/') || 
            s.includes('/dealers/') || s.includes('/auctions/') ||
            s.includes('logo_url') || s.includes('business_logo')) {
          return false; // Keep these
        }
        // Filter out UI chrome SVGs (social icons, navigation, etc.)
        if (s.includes('social-') || s.includes('nav-') || s.includes('icon-') ||
            s.includes('/assets/') || s.includes('/icons/') || s.includes('/themes/')) {
          return true; // Filter these
        }
        return true; // Default: filter other SVGs
      }
      // CRITICAL: Filter out organization/dealer logos - these should NEVER be vehicle images
      // Organization logos are stored in organization-logos/ and should only appear as favicons
      if (s.includes('organization-logos/') || s.includes('organization_logos/')) return true;
      if (s.includes('images.classic.com/uploads/dealer/')) return true;
      if (s.includes('/uploads/dealer/')) return true;
      
      // Filter generic logo paths that are site chrome, but preserve business logos in specific contexts
      if (s.includes('/logo') || s.includes('logo.')) {
        // Filter ALL logos in storage paths (these are organization/dealer logos)
        if (s.includes('/storage/') || s.includes('supabase.co')) return true;
        // Filter site chrome logos (navigation, header, footer)
        if (s.includes('/assets/') || s.includes('/themes/') || 
            s.includes('/header') || s.includes('/footer') || s.includes('/nav')) {
          return true; // Filter these
        }
        return true; // Default: filter other logo paths (vehicle images should not be logos)
      }
      if (s.includes('avatar') || s.includes('badge') || s.includes('sprite')) return true;

      // Query-param size heuristics (favicons/icons are commonly <= 64px)
      try {
        const url = new URL(raw);
        // Small square assets (e.g. Framer site badges/icons) often appear as PNGs with width/height params.
        const wRaw = url.searchParams.get('width') || url.searchParams.get('w');
        const hRaw = url.searchParams.get('height') || url.searchParams.get('h');
        if (wRaw && hRaw) {
          const w = Number(String(wRaw).replace(/[^0-9.]/g, ''));
          const h = Number(String(hRaw).replace(/[^0-9.]/g, ''));
          if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            const squareish = Math.abs(w - h) <= 8;
            // More aggressive: filter square images with small dimensions (likely logos/badges)
            if (squareish && Math.max(w, h) <= 600 && (s.endsWith('.png') || s.endsWith('.svg'))) return true;
            // Filter very small images (icons)
            if (Math.max(w, h) <= 200 && (s.endsWith('.png') || s.endsWith('.svg') || s.endsWith('.jpg') || s.endsWith('.jpeg'))) return true;
          }
        }
        const sizeParam =
          url.searchParams.get('size') ||
          url.searchParams.get('sz') ||
          url.searchParams.get('w') ||
          url.searchParams.get('width');
        if (sizeParam) {
          const n = Number(String(sizeParam).replace(/[^0-9.]/g, ''));
          if (Number.isFinite(n) && n > 0 && n <= 64) return true;
        }
      } catch {
        // ignore URL parsing errors; fall back to substring filters above
      }
      
      // Additional checks for Framer/CDN hosted logos and UI elements
      if (s.includes('framerusercontent.com') && (
        s.includes('logo') || 
        s.includes('icon') || 
        s.includes('badge') ||
        s.match(/width=\d+.*height=\d+.*[&=](width|height)=\d{1,3}/) // Small square with width/height params
      )) return true;

      // Flag/banner/site chrome frequently leaks into naive scrapes and even imports.
      // Treat these as noise so they can never become the computed hero/primary.
      // Aggressive filtering: catch all flag variations and patterns
      if (
        /(?:^|\/|\-|_)(flag|flags|banner)(?:$|\/|\-|_|\.)/i.test(s) ||
        s.includes('stars-and-stripes') ||
        s.includes('stars_and_stripes') ||
        s.includes('american-flag') ||
        s.includes('american_flag') ||
        s.includes('us-flag') ||
        s.includes('us_flag') ||
        s.includes('usa-flag') ||
        s.includes('usa_flag') ||
        s.includes('flag-usa') ||
        s.includes('flag_usa') ||
        s.includes('united-states-flag') ||
        s.includes('united_states_flag') ||
        s.includes('old-glory') ||
        s.includes('old_glory') ||
        /(?:^|\/|\-|_)(flag|flags)(?:.*usa|.*us|.*american)/i.test(s) ||
        /(?:usa|us|american).*(?:flag|flags)/i.test(s)
      ) return true;

      return false;
    };

    const filterIconNoise = (urls: string[]): string[] => {
      const arr = Array.isArray(urls) ? urls : [];
      const keep = arr.filter((u) => !isIconUrl(String(u || '')));
      // Safety: if we filtered everything out, keep the originals rather than showing nothing.
      return keep.length > 0 ? keep : arr;
    };

    const filterBatNoise = (urls: string[], v: any): string[] => {
      const cleaned = (urls || []).map(u => normalizeUrl(u)).filter(Boolean);
      
      // Never filter out non-BaT URLs (user uploads, Supabase storage, etc.)
      const nonBat = cleaned.filter(u => !u.includes('bringatrailer.com/wp-content/uploads/'));
      const batUrls = cleaned.filter(u => u.includes('bringatrailer.com/wp-content/uploads/'));
      
      if (batUrls.length === 0) return cleaned;
      
      // First: Filter known BaT page noise that frequently appears but isn't vehicle images
      const isKnownNoise = (u: string) => {
        const f = u.toLowerCase();
        return (
          f.includes('qotw') ||
          f.includes('winner-template') ||
          f.includes('weekly-weird') ||
          f.includes('mile-marker') ||
          f.includes('podcast') ||
          f.includes('merch') ||
          f.includes('dec-merch') ||
          f.includes('podcast-graphic') ||
          // Generic editorial "Web-#####-" images
          /\/web-\d{3,}-/i.test(f) ||
          // Homepage/featured content that appears on listing pages
          f.includes('site-post-') ||
          f.includes('thumbnail-template') ||
          // Screenshots of listings (not the actual listing)
          f.includes('screenshot-') ||
          // Social media images
          f.includes('countries/') ||
          f.includes('themes/') ||
          f.includes('assets/img/')
        );
      };
      
      let filtered = batUrls.filter(u => !isKnownNoise(u));
      
      // Second: Try to match by vehicle pattern (year_make_model in filename)
      const needle = buildBatImageNeedle(v);
      if (needle && filtered.length > 0) {
        const patternMatched = filtered.filter(u => 
          u.toLowerCase().includes(needle.toLowerCase())
        );
        // Only use pattern matching if we get at least 3 matches (prevents false positives)
        if (patternMatched.length >= 3) {
          filtered = patternMatched;
        }
      }
      
      // Third: Use date bucket clustering (images from same YYYY/MM upload tend to be from same listing)
      if (filtered.length > 0) {
        const bucketKey = (u: string) => {
          const m = u.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
          return m ? `${m[1]}/${m[2]}` : '';
        };
        const bucketCounts = new Map<string, number>();
        for (const u of filtered) {
          const k = bucketKey(u);
          if (k) bucketCounts.set(k, (bucketCounts.get(k) || 0) + 1);
        }
        let bestBucket = '';
        let bestCount = 0;
        for (const [k, c] of bucketCounts.entries()) {
          if (c > bestCount) {
            bestBucket = k;
            bestCount = c;
          }
        }
        // If we have a clear dominant bucket (>=8 images and >=50% of total), use it
        if (bestBucket && bestCount >= 8 && bestCount >= Math.floor(filtered.length * 0.5)) {
          filtered = filtered.filter(u => bucketKey(u) === bestBucket);
        }
      }
      
      // Combine filtered BaT URLs with non-BaT URLs
      const result = [...nonBat, ...filtered];
      
      // Safety: if we filtered everything out, keep at least the non-BaT URLs
      return result.length > 0 ? result : (nonBat.length > 0 ? nonBat : urls);
    };

    const filterClassicNoise = (urls: string[], v: any): string[] => {
      try {
        const discoveryUrl = String(v?.discovery_url || '');
        const origin = String(v?.profile_origin || '');
        const isClassic = origin === 'url_scraper' && discoveryUrl.includes('classic.com/veh/');
        if (!isClassic) return urls;

        const keep = (urls || []).filter((u) => {
          const raw = normalizeUrl(u);
          if (!raw) return false;
          const s = raw.toLowerCase();

          // Remove dealer logos and other site assets that get picked up by naive image scraping.
          if (s.includes('images.classic.com/uploads/dealer/')) return false;
          if (s.includes('/uploads/dealer/')) return false;

          // For Classic CDN, only keep actual vehicle images.
          if (s.includes('images.classic.com/')) {
            if (!s.includes('/vehicles/')) return false;
          }

          return true;
        });

        return keep.length > 0 ? keep : urls;
      } catch {
        return urls;
      }
    };

    const filterCarsAndBidsNoise = (urls: string[], v: any): string[] => {
      const cleaned = (urls || []).map(u => normalizeUrl(u)).filter(Boolean);
      
      // Never filter out non-Cars & Bids URLs (user uploads, Supabase storage, etc.)
      const nonCarsAndBids = cleaned.filter(u => !u.includes('media.carsandbids.com'));
      const carsAndBidsUrls = cleaned.filter(u => u.includes('media.carsandbids.com'));
      
      if (carsAndBidsUrls.length === 0) return cleaned;
      
      // Filter out known Cars & Bids noise: video thumbnails, UI elements, small thumbnails
      const isKnownNoise = (u: string) => {
        const f = u.toLowerCase();
        // Exclude video thumbnails/freeze frames
        if (f.includes('/video') || f.includes('video') || f.includes('thumbnail') || f.includes('thumb')) {
          return true;
        }
        // Exclude UI elements and icons
        if (f.includes('/icon') || f.includes('/logo') || f.includes('/button') || f.includes('/ui/') || f.includes('/assets/')) {
          return true;
        }
        // Exclude small thumbnails (common patterns: -thumb, -small, -150x, -300x)
        if (f.match(/-\d+x\d+\.(jpg|jpeg|png|webp)$/) || f.includes('-thumb') || f.includes('-small')) {
          return true;
        }
        // Exclude static assets
        if (f.includes('/static/')) {
          return true;
        }
        return false;
      };
      
      let filtered = carsAndBidsUrls.filter(u => !isKnownNoise(u));
      
      // Combine filtered Cars & Bids URLs with non-Cars & Bids URLs
      const result = [...nonCarsAndBids, ...filtered];
      
      // Safety: if we filtered everything out, keep at least the non-Cars & Bids URLs
      return result.length > 0 ? result : (nonCarsAndBids.length > 0 ? nonCarsAndBids : urls);
    };

    const filterProfileImages = (urls: string[], v: any): string[] => {
      const normalized = (Array.isArray(urls) ? urls : []).map(normalizeUrl).filter(Boolean);
      // Exclude organization/dealer logos and import_queue images from profile display
      const withoutOrgLogos = normalized.filter((u: string) => {
        const urlLower = String(u || '').toLowerCase();
        // Exclude import_queue images (these are organization/dealer images)
        if (urlLower.includes('import_queue')) return false;
        // Exclude organization logo storage paths
        if (urlLower.includes('organization-logos/') || urlLower.includes('organization_logos/')) return false;
        // Exclude Classic.com dealer logos
        if (urlLower.includes('images.classic.com/uploads/dealer/')) return false;
        if (urlLower.includes('/uploads/dealer/')) return false;
        // Exclude any storage path that looks like a logo
        if (urlLower.includes('/logo') && (urlLower.includes('/storage/') || urlLower.includes('supabase.co'))) return false;
        return true;
      });
      return filterIconNoise(filterCarsAndBidsNoise(filterClassicNoise(filterBatNoise(withoutOrgLogos, v), v), v));
    };

    const getOriginImages = (v: any): { images: string[]; declaredCount: number | null } => {
      try {
        const originRaw: unknown =
          v?.origin_metadata?.images ??
          v?.origin_metadata?.image_urls ??
          v?.origin_metadata?.imageUrls ??
          null;

        const originCountRaw: unknown =
          v?.origin_metadata?.image_count ??
          v?.origin_metadata?.imageCount ??
          null;

        const declaredCount = typeof originCountRaw === 'number' && Number.isFinite(originCountRaw) ? originCountRaw : null;
        const originList = Array.isArray(originRaw) ? originRaw : [];

        // Normalize + basic cleanup; then apply our general filters.
        const cleaned = originList
          .map((u: any) => normalizeUrl(u))
          .filter((url: any) =>
            url &&
            typeof url === 'string' &&
            url.startsWith('http') &&
            !url.includes('94x63') &&
            !url.toLowerCase().includes('youtube.com') &&
            !url.toLowerCase().includes('thumbnail')
          );

        const filtered = filterProfileImages(cleaned, v);
        // NO LIMIT - show ALL images from source
        return { images: filtered, declaredCount };
      } catch {
        return { images: [], declaredCount: null };
      }
    };

    const { images: originImages, declaredCount } = getOriginImages(vehicle);

    const isSupabaseHostedImageUrl = (rawUrl: any): boolean => {
      const u = typeof rawUrl === 'string' ? rawUrl.trim() : '';
      if (!u) return false;
      return u.includes('/storage/v1/object/public/');
    };

    const resolveDbImageUrl = (row: any, preferFullRes: boolean = false): string | null => {
      try {
        const variantsRaw = (row as any)?.variants;
        const variants = variantsRaw && typeof variantsRaw === 'object' ? variantsRaw : null;
        // For primary images, prioritize full resolution
        if (preferFullRes) {
          return (
            (variants as any)?.full ||
            (variants as any)?.large ||
            (row as any)?.image_url ||
            (variants as any)?.medium ||
            (row as any)?.medium_url ||
            (row as any)?.thumbnail_url ||
            null
          );
        }
        // For gallery display, use appropriate size
        return (
          (variants as any)?.large ||
          (variants as any)?.medium ||
          (variants as any)?.full ||
          (row as any)?.medium_url ||
          (row as any)?.thumbnail_url ||
          (row as any)?.image_url ||
          null
        );
      } catch {
        return (row as any)?.image_url || null;
      }
    };

    // Check if RPC data is available (avoid duplicate query)
    const rpcData = (window as any).__vehicleProfileRpcData;
    const rpcMatchesThisVehicle = rpcData && rpcData.vehicle_id === vehicle.id;
    if (rpcMatchesThisVehicle && rpcData?.images && Array.isArray(rpcData.images) && rpcData.images.length > 0) {
      const imagesRaw = rpcData.images.map((img: any) => img.image_url).filter(Boolean);
      const images = filterProfileImages(imagesRaw, vehicle);
      setVehicleImages(images);
      // Pick lead image from the filtered list to avoid BaT homepage noise becoming the hero.
      const leadFromRpc = rpcData.images.find((img: any) => img.is_primary) || rpcData.images[0];
      const leadCandidate = resolveDbImageUrl(leadFromRpc) || leadFromRpc?.image_url;
      const leadOk = leadCandidate && filterProfileImages([leadCandidate], vehicle).length > 0;
      const lead = leadOk ? leadCandidate : (images[0] || null);
      if (lead) {
        setLeadImageUrl(lead as any);
      }
      return;
    }

    let images: string[] = [];

    // Load images from database first
    try {
      const { data: imageRecords, error } = await supabase
        .from('vehicle_images')
        // Keep payload lean to reduce DB load/timeouts; we only need URLs + ordering fields here.
        .select('id, vehicle_id, image_url, thumbnail_url, medium_url, variants, is_primary, is_document, position, created_at, storage_path')
        .eq('vehicle_id', vehicle.id)
        // Legacy rows may have is_document = NULL; treat that as "not a document"
        .not('is_document', 'is', true) // Filter out documents - they belong in a separate section
        .order('is_primary', { ascending: false })
          // IMPORTANT: NULL positions should sort LAST (older backfills didn't set position).
          .order('position', { ascending: true, nullsFirst: false })
          // For un-positioned rows, show in chronological insert order (stable, matches source list order better than DESC).
          .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ Error loading vehicle images from database:', error);
      } else if (imageRecords && imageRecords.length > 0) {
        const origin = String((vehicle as any)?.profile_origin || '');
        const discoveryUrl = String((vehicle as any)?.discovery_url || '');
        const isClassicScrape = origin === 'url_scraper' && discoveryUrl.includes('classic.com/veh/');
        const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');

        const isImportedStoragePath = (p: any) => {
          const s = String(p || '').toLowerCase();
          return s.includes('external_import') || s.includes('organization_import') || s.includes('import_queue');
        };
        
        // Check if image URL is an organization/dealer logo (should never be used as vehicle image)
        const isOrganizationLogo = (url: string): boolean => {
          const urlLower = String(url || '').toLowerCase();
          // Organization logo storage paths
          if (urlLower.includes('organization-logos/') || urlLower.includes('organization_logos/')) return true;
          // Classic.com dealer logos
          if (urlLower.includes('images.classic.com/uploads/dealer/')) return true;
          if (urlLower.includes('/uploads/dealer/')) return true;
          // Storage paths containing "logo"
          if (urlLower.includes('/logo') && (urlLower.includes('/storage/') || urlLower.includes('supabase.co'))) return true;
          return false;
        };

        const primaryRow = imageRecords.find((r: any) => r?.is_primary === true) || null;
        const primaryCandidate = primaryRow ? (resolveDbImageUrl(primaryRow) || null) : null;
        // Exclude import_queue images and organization logos from primary selection
        const primaryIsImportQueue = primaryRow && isImportedStoragePath(primaryRow?.storage_path);
        const primaryIsOrgLogo = primaryCandidate && isOrganizationLogo(primaryCandidate);
        const primaryOk = primaryCandidate && !primaryIsImportQueue && !primaryIsOrgLogo && filterProfileImages([primaryCandidate], vehicle).length > 0;

        // Build fallback pool, excluding import_queue images and organization logos
        const fallbackPool = imageRecords
          .filter((r: any) => {
            // Exclude import_queue images
            if (isImportedStoragePath(r?.storage_path)) return false;
            // Exclude organization/dealer logos
            const url = resolveDbImageUrl(r) || r?.image_url;
            if (url && isOrganizationLogo(url)) return false;
            return true;
          })
          .map((r: any) => resolveDbImageUrl(r))
          .filter(Boolean) as string[];
        
        // For BaT vehicles, prioritize origin_metadata images (certified source) over DB images
        const poolForFiltering = isBat && originImages.length > 0 
          ? [...originImages, ...fallbackPool] // Origin images first for BaT
          : [...fallbackPool, ...originImages]; // Default: DB images first, then origin
        const filteredPool = filterProfileImages(poolForFiltering, vehicle);
        const firstFiltered = filteredPool.find((u) => isSupabaseHostedImageUrl(u)) || filteredPool[0] || null;

        const lead = (primaryOk ? primaryCandidate : firstFiltered) || null;
        if (lead) setLeadImageUrl(lead as any);

        // Auto-set primary if none exists OR if existing primary is filtered out.
        // Only attempt when authenticated; otherwise just render using filtered lead.
        const hasPrimary = !!primaryRow;
        const shouldHealPrimary = (!hasPrimary && imageRecords[0]) || (hasPrimary && !primaryOk);
        if (shouldHealPrimary && session?.user?.id) {
          const isValidForPrimary = (r: any) => {
            // Exclude documents (spec sheets, window stickers, etc.)
            if (r?.is_document === true) return false;
            // Exclude import_queue images from primary selection
            if (isImportedStoragePath(r?.storage_path)) return false;
            // Use full-resolution URL for primary images
            const url = resolveDbImageUrl(r, true) || r?.image_url;
            if (!url) return false;
            // Exclude organization/dealer logos
            if (isOrganizationLogo(url)) return false;
            // Exclude documents by URL patterns (window sticker, spec sheet, monroney, etc.)
            const urlLower = url.toLowerCase();
            if (urlLower.includes('window-sticker') || urlLower.includes('window_sticker') ||
                urlLower.includes('monroney') || urlLower.includes('spec-sheet') ||
                urlLower.includes('spec_sheet') || urlLower.includes('build-sheet') ||
                urlLower.includes('build_sheet') || urlLower.includes('spid') ||
                urlLower.includes('service-parts') || urlLower.includes('rpo') ||
                urlLower.includes('document') || urlLower.includes('sticker') ||
                urlLower.includes('sheet') || urlLower.includes('receipt') ||
                urlLower.includes('invoice') || urlLower.includes('title')) {
              return false;
            }
            return filterProfileImages([url], vehicle).length > 0;
          };
          // Prefer Supabase-hosted images to avoid hotlink/403 issues on external sources.
          const bestDbRow =
            imageRecords.find((r: any) => isValidForPrimary(r) && (r?.storage_path || isSupabaseHostedImageUrl(r?.image_url))) ||
            imageRecords.find((r: any) => isValidForPrimary(r)) ||
            null;

          if (bestDbRow?.id) {
            try {
              // Clear any existing primary first (best-effort)
              await supabase
                .from('vehicle_images')
                .update({ is_primary: false } as any)
                .eq('vehicle_id', vehicle.id)
                .eq('is_primary', true);
              await supabase
                .from('vehicle_images')
                .update({ is_primary: true } as any)
                .eq('id', bestDbRow.id);
            } catch {
              // non-blocking
            }
          }
        }

        // Load all images using public URLs (fast) and de-dupe (storage/variants can create repeats)
        const raw = Array.from(new Set((imageRecords || []).map((r: any) => normalizeUrl(r?.image_url)).filter(Boolean)));
        
        // Identify noisy patterns from origin_metadata (logos, icons, small UI elements)
        // Note: originImages already declared above at line 2186
        const originNoiseHashes = new Set<string>();
        originImages.forEach((origUrl: string) => {
          const normalized = normalizeUrl(origUrl).toLowerCase();
          // Check for SVG files, small square images with width/height params, logos
          if (normalized.includes('.svg') || 
              normalized.includes('logo') ||
              normalized.includes('icon') ||
              /width=\d+.*height=\d+/.test(normalized)) {
            // Extract a hash/fingerprint from the URL to match stored images
            // For framerusercontent.com URLs, the hash is in the filename
            const hashMatch = normalized.match(/([a-f0-9]{32,})/i);
            if (hashMatch) {
              originNoiseHashes.add(hashMatch[1]);
            }
            // Also check for small dimension indicators
            const wMatch = normalized.match(/width=(\d+)/i);
            const hMatch = normalized.match(/height=(\d+)/i);
            if (wMatch && hMatch) {
              const w = parseInt(wMatch[1], 10);
              const h = parseInt(hMatch[1], 10);
              // If it's a small or very wide/short image (likely a header/logo), mark as noise
              if (w <= 600 || h <= 200 || (w > h * 3)) {
                originNoiseHashes.add(`${w}x${h}`);
              }
            }
          }
        });
        
        // Filter stored images that came from noisy origin URLs
        // Check storage paths for hash matches
        const preFiltered = raw.filter((url: string) => {
          // Skip filtering if no noise detected
          if (originNoiseHashes.size === 0) return true;
          
          // Check if the storage path contains a hash that matches a noisy origin
          const urlLower = url.toLowerCase();
          for (const noiseHash of originNoiseHashes) {
            if (urlLower.includes(noiseHash.toLowerCase())) {
              return false; // Filter out this image
            }
          }
          return true;
        });
        
        images = filterProfileImages(preFiltered.length > 0 ? preFiltered : raw, vehicle);

        // If this is a Classic.com scraped vehicle, prefer the origin_metadata gallery over contaminated imports.
        // Keep any non-imported images (e.g., manual uploads) in front.
        if (isClassicScrape && originImages.length > 0) {
          const manual = (imageRecords || [])
            .filter((r: any) => r?.image_url && !isImportedStoragePath(r?.storage_path))
            .map((r: any) => normalizeUrl(r?.image_url))
            .filter(Boolean) as string[];

          const merged = Array.from(new Set([...manual, ...originImages]));
          const mergedFiltered = filterProfileImages(merged, vehicle);

          // If DB images look significantly larger than the source gallery, assume contamination and override display set.
          const dbCount = images.length;
          const sourceCount = declaredCount ?? originImages.length;
          const looksContaminated = dbCount > sourceCount + 10;

          if (looksContaminated && mergedFiltered.length > 0) {
            images = mergedFiltered;
          }
        }

        // For BaT vehicles, origin_metadata is the ONLY certified source for listing images
        // But user-uploaded images (with user_id, not import_queue) should still be shown
        if (isBat && originImages.length > 0) {
          // Get user-uploaded images (those with user_id and not from import_queue)
          const userUploaded = (imageRecords || [])
            .filter((r: any) => {
              // Must have user_id (actual user upload) and not be from import_queue
              return r?.user_id && !isImportedStoragePath(r?.storage_path);
            })
            .map((r: any) => resolveDbImageUrl(r))
            .filter(Boolean) as string[];

          // Combine: origin_metadata images first (certified BaT source), then user uploads
          const combined = Array.from(new Set([...originImages, ...userUploaded]));
          const batFiltered = filterProfileImages(combined, vehicle);
          
          if (batFiltered.length > 0) {
            images = batFiltered;
            // Prefer origin_metadata image for lead, but fall back to user upload if needed
            const originLead = batFiltered.find((u) => 
              originImages.some(orig => normalizeUrl(orig) === normalizeUrl(u))
            ) || batFiltered.find((u) => isSupabaseHostedImageUrl(u)) || batFiltered[0] || null;
            if (originLead) setLeadImageUrl(originLead);
          }
        }

        // Fallback: If all DB images were filtered out (e.g., all were import_queue), try URLs from external_listings for ALL platforms
        if (images.length === 0) {
          try {
            const { data: externalListing } = await supabase
              .from('external_listings')
              .select('metadata, listing_url, platform')
              .eq('vehicle_id', vehicle.id)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (externalListing?.metadata) {
              const metadata = externalListing.metadata as any;
              const platform = externalListing.platform || 'unknown';
              const metadataImages = metadata.images || metadata.image_urls || [];
              if (Array.isArray(metadataImages) && metadataImages.length > 0) {
                // Universal URL cleaner: remove resize params for ALL platforms
                const cleanImageUrl = (url: string): string => {
                  if (!url || typeof url !== 'string') return url;
                  let cleaned = String(url || '')
                    .replace(/&#038;/g, '&')
                    .replace(/&#039;/g, "'")
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/[?&]w=\d+/g, '')
                    .replace(/[?&]h=\d+/g, '')
                    .replace(/[?&]width=\d+/g, '')
                    .replace(/[?&]height=\d+/g, '')
                    .replace(/[?&]resize=[^&]*/g, '')
                    .replace(/[?&]fit=[^&]*/g, '')
                    .replace(/[?&]quality=[^&]*/g, '')
                    .replace(/[?&]strip=[^&]*/g, '')
                    .replace(/[?&]format=[^&]*/g, '')
                    .replace(/[?&]+$/, '');
                  
                  // Platform-specific cleaning
                  if (cleaned.includes('bringatrailer.com')) {
                    cleaned = cleaned
                      .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
                      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');
                  } else if (cleaned.includes('carsandbids.com')) {
                    cleaned = cleaned.split('?')[0];
                  } else if (cleaned.includes('mecum.com')) {
                    cleaned = cleaned.split('?')[0];
                  } else if (cleaned.includes('barrett-jackson.com') || cleaned.includes('barrettjackson.com')) {
                    cleaned = cleaned.split('?')[0].split('#')[0];
                  }
                  
                  return cleaned.trim();
                };
                
                const cleaned = metadataImages
                  .map(cleanImageUrl)
                  .filter((url: string) => {
                    const s = url.toLowerCase();
                    // Filter out flags and banners
                    if (s.includes('flag') || s.includes('banner')) return false;
                    // Filter out UI icons (social, navigation) but NOT business logos
                    if (s.includes('icon') && (s.includes('social-') || s.includes('nav-') || s.includes('/assets/'))) return false;
                    // Filter out generic site chrome logos, but preserve business logos
                    if (s.includes('logo') && (s.includes('/assets/') || s.includes('/themes/') || s.includes('/header'))) return false;
                    // Filter out SVGs that are UI elements
                    if (s.endsWith('.svg') && (s.includes('social-') || s.includes('/assets/') || s.includes('/icons/'))) return false;
                    // Platform-specific: only include actual vehicle images
                    if (platform === 'bat') {
                      return s.includes('bringatrailer.com/wp-content/uploads/');
                    } else if (platform === 'carsandbids') {
                      // Cars & Bids: filter out video thumbnails, UI elements, and small thumbnails
                      if (!s.includes('media.carsandbids.com')) return false;
                      // Exclude video thumbnails/freeze frames
                      if (s.includes('/video') || s.includes('video') || s.includes('thumbnail') || s.includes('thumb')) return false;
                      // Exclude UI elements
                      if (s.includes('/icon') || s.includes('/logo') || s.includes('/button') || s.includes('/ui/') || s.includes('/assets/') || s.includes('/static/')) return false;
                      // Exclude small thumbnails
                      if (s.match(/-\d+x\d+\.(jpg|jpeg|png|webp)$/) || s.includes('-thumb') || s.includes('-small')) return false;
                      return true;
                    } else if (platform === 'mecum') {
                      return s.includes('images.mecum.com');
                    } else if (platform === 'barrettjackson') {
                      return s.includes('barrett-jackson.com') || s.includes('barrettjackson.com');
                    }
                    // Default: accept any valid image URL
                    return s.startsWith('http') && (s.includes('.jpg') || s.includes('.jpeg') || s.includes('.png') || s.includes('.webp'));
                  });
                
                if (cleaned.length > 0) {
                  const filtered = filterProfileImages(cleaned, vehicle);
                  if (filtered.length > 0) {
                    images = filtered;
                    const lead = filtered.find((u) => isSupabaseHostedImageUrl(u)) || filtered[0] || null;
                    if (lead) setLeadImageUrl(lead);
                    console.log(`✅ Using ${filtered.length} ${platform.toUpperCase()} URLs from external_listings metadata (fallback)`);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Error loading URLs from external_listings (fallback):', err);
          }
        }
        
        // Final fallback: If still no images, use originImages
        if (images.length === 0 && originImages.length > 0) {
          images = filterProfileImages(originImages, vehicle);
          // Also set lead image from originImages if current lead is invalid or missing
          if (!lead || String(lead || '').toLowerCase().includes('import_queue')) {
            const originLead = images.find((u) => isSupabaseHostedImageUrl(u)) || images[0] || null;
            if (originLead) setLeadImageUrl(originLead);
          }
        }

        setVehicleImages(images);

        // If we filtered out a noisy lead image, ensure we still have a hero.
        // Also check that lead doesn't contain import_queue in the URL path
        if (images.length > 0) {
          const leadStr = String(lead || '').toLowerCase();
          const leadIsImportQueue = leadStr.includes('import_queue');
          const leadStillOk = lead && !leadIsImportQueue && filterProfileImages([String(lead)], vehicle).length > 0;
          if (!leadStillOk) setLeadImageUrl(images[0]);
        }

        // Signed URL generation disabled due to storage configuration issues
        // Would generate 400 errors: createSignedUrl calls failing
        // Using direct public URLs instead which work fine
      } else {
        // No DB rows: try origin_metadata images first (from scraping)
        try {
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
        
        // If still no images, try BaT URLs from external_listings metadata
        if (images.length === 0) {
          try {
            const { data: externalListing } = await supabase
              .from('external_listings')
              .select('metadata, listing_url')
              .eq('vehicle_id', vehicle.id)
              .eq('platform', 'bat')
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (externalListing?.metadata) {
              const metadata = externalListing.metadata as any;
              // Check for image URLs in metadata (from extract-premium-auction)
              const metadataImages = metadata.images || metadata.image_urls || [];
              if (Array.isArray(metadataImages) && metadataImages.length > 0) {
                // Clean BaT URLs: remove resize params and -scaled suffixes (matches extract-premium-auction logic)
                const cleanBatUrl = (url: string): string => {
                  if (!url || typeof url !== 'string' || !url.includes('bringatrailer.com')) {
                    return url;
                  }
                  return String(url || '')
                    .replace(/&#038;/g, '&')
                    .replace(/&#039;/g, "'")
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/[?&]w=\d+/g, '')
                    .replace(/[?&]h=\d+/g, '')
                    .replace(/[?&]resize=[^&]*/g, '')
                    .replace(/[?&]fit=[^&]*/g, '')
                    .replace(/[?&]quality=[^&]*/g, '')
                    .replace(/[?&]strip=[^&]*/g, '')
                    .replace(/[?&]+$/, '')
                    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
                    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
                    .trim();
                };
                
                const cleaned = metadataImages
                  .map(cleanBatUrl)
                  .filter((url: string) => {
                    const s = url.toLowerCase();
                    // Filter out flags and banners (but preserve business/auction logos if needed)
                    if (s.includes('flag') || s.includes('banner')) return false;
                    // Filter out UI icons (social, navigation) but NOT business logos
                    if (s.includes('icon') && (s.includes('social-') || s.includes('nav-') || s.includes('/assets/'))) return false;
                    // Filter out generic site chrome logos, but preserve business logos
                    if (s.includes('logo') && (s.includes('/assets/') || s.includes('/themes/') || s.includes('/header'))) return false;
                    // Filter out SVGs that are UI elements (but business logos are handled separately)
                    if (s.endsWith('.svg') && (s.includes('social-') || s.includes('/assets/') || s.includes('/icons/'))) return false;
                    // Only include actual vehicle images from BaT uploads
                    return s.includes('bringatrailer.com/wp-content/uploads/');
                  });
                
                if (cleaned.length > 0) {
                  const filtered = filterProfileImages(cleaned, vehicle);
                  if (filtered.length > 0) {
                    images = filtered;
                    setVehicleImages(images);
                    if (!leadImageUrl && images[0]) {
                      setLeadImageUrl(images[0]);
                    }
                    console.log(`✅ Using ${filtered.length} BaT URLs from external_listings metadata`);
                    return; // Skip storage fallback
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Error loading BaT URLs from external_listings:', err);
          }
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

            images = filterIconNoise(Array.from(new Set(gathered)));
            if (images.length > 0 && !leadImageUrl) setLeadImageUrl(images[0]);
          } catch (e) {
            console.warn('Storage fallback for hero/gallery failed:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error querying vehicle images:', error);
    }

    // Also include primary image if available (support both legacy camelCase and canonical snake_case fields).
    const primaryUrl =
      (vehicle as any)?.primary_image_url ||
      (vehicle as any)?.primaryImageUrl ||
      (vehicle as any)?.image_url ||
      null;
    const primaryOk = primaryUrl && typeof primaryUrl === 'string' && filterProfileImages([primaryUrl], vehicle).length > 0;
    if (primaryOk && typeof primaryUrl === 'string' && !images.includes(primaryUrl)) {
      images = [primaryUrl, ...images];
      // Fallback for lead image - ensure it's set from primary
      if (!leadImageUrl) setLeadImageUrl(primaryUrl);
    }
    
    // Ensure leadImageUrl is always set if we have images but no lead yet
    if (!leadImageUrl && images.length > 0) {
      setLeadImageUrl(images[0]);
    }

    setVehicleImages(images);
  };

  const handleSetPrimaryImage = async (imageId: string) => {
    if (!vehicle || !isAdmin) {
      alert('Admin privileges required to set primary image');
      return;
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
      alert('Primary image updated successfully');
    } catch (error: any) {
      console.error('Error setting primary image:', error);
      alert(`Failed to set primary image: ${error.message}`);
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
          try { window.localStorage.removeItem(key); } catch {}
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
        } catch {}
        try { setBatAutoImportStatus('failed'); } catch {}
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

  // readinessScore removed - was computed but never used in render

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

    return (
      <>
        {/* Primary Image and Timeline - Full width top section (one column) */}
        <section className="section">
          <VehicleTimelineSection
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            onAddEventClick={() => setShowAddEvent(true)}
          />
        </section>

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

        {/* Two Column Layout: Left (vehicle info, investment, ref docs, description, comments & bids, privacy) | Right (image gallery) */}
        <section className="section">
          <div 
            className="vehicle-profile-two-column"
            style={{ 
              display: 'grid', 
              gridTemplateColumns: '320px 1fr', 
              gap: 'var(--space-4)'
            }}
          >
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Vehicle Info */}
              <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading basic info...</div>}>
                <VehicleBasicInfo
                  vehicle={vehicle}
                  session={session}
                  permissions={permissions}
                  onDataPointClick={handleDataPointClick}
                  onEditClick={handleEditClick}
                />
              </React.Suspense>

              {/* Investment Summary */}
              <VehicleROISummaryCard vehicleId={vehicle.id} />
              
              {/* Structured listing data (Options / Service records / etc.) */}
              <VehicleStructuredListingDataCard vehicle={vehicle} />
              
              {/* Reference Documents - Upload */}
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
              
              {/* Reference Documents - Display */}
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

              {/* Description */}
              <VehicleDescriptionCard
                vehicleId={vehicle.id}
                initialDescription={vehicle.description}
                isEditable={canEdit}
                onUpdate={() => {}}
              />

              {/* Comments & Bids */}
              <VehicleCommentsCard
                vehicleId={vehicle.id}
                session={session}
                collapsed={false}
                maxVisible={50}
              />

              {/* Privacy Settings */}
              {!vehicle.isAnonymous && session && (
                <div className="card">
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
            </div>

            {/* Right Column: Image Gallery */}
            <div>
              <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading gallery...</div>}>
                <ImageGallery
                  vehicleId={vehicle.id}
                  showUpload={true}
                  fallbackImageUrls={vehicleImages.length > 0 ? [] : fallbackListingImageUrls}
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
                    loadVehicleImages();
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
            initialValuation={(window as any).__vehicleProfileRpcData?.latest_valuation}
            initialPriceSignal={(window as any).__vehicleProfileRpcData?.price_signal}
            organizationLinks={linkedOrganizations}
            onClaimClick={() => setShowOwnershipClaim(true)}
            userOwnershipClaim={userOwnershipClaim as any}
            suppressExternalListing={!!userOwnershipClaim}
            auctionPulse={auctionPulse}
          />
        </React.Suspense>

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
          <VehicleHeroImage
            leadImageUrl={leadImageUrl}
            overlayNode={<VehicleMemeOverlay lastEvent={lastMemeDrop} />}
          />
        </React.Suspense>

        {/* Meme Drops (paid reactions) */}
        {vehicle?.id && (
          <section className="section">
            <VehicleMemePanel vehicleId={vehicle.id} disabled={!vehicle?.isPublic && !session?.user?.id} />
          </section>
        )}

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

        {/* Main Content - Curated layout (no tabs) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
          {renderWorkspaceContent()}
        </div>

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