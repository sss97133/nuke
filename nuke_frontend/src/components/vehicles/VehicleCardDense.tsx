import React from 'react';
import { Link } from 'react-router-dom';
import { FaviconIcon } from '../common/FaviconIcon';
import { getVehicleIdentityTokens } from '../../utils/vehicleIdentity';
import { UserInteractionService } from '../../services/userInteractionService';
import { getEngineDefinition, getTransmissionDefinition, type PowertrainSpecDefinition } from '../../services/powertrainDefinitionService';
import { getBodyStyleDisplay, getBodyStylePopoverDefinition, type BodyStylePopoverDefinition } from '../../services/bodyStyleTaxonomy';
import ResilientImage from '../images/ResilientImage';
import { OdometerBadge } from '../vehicle/OdometerBadge';
import { useVehicleImages } from '../../hooks/useVehicleImages';
import { LotBadge } from '../auction/LotBadge';
import { getAuctionMode, isActiveAuction as isInActiveAuction, getAuctionStateInfo } from '../../services/unifiedAuctionStateService';
import { OwnershipDetailsPopup } from './OwnershipDetailsPopup';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useVehicleFollow } from '../../hooks/useVehicleFollow';

const parseMoneyNumber = (val: any): number | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) && val > 0 ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

interface VehicleCardDenseProps {
  vehicle: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    series?: string;
    trim?: string;
    vin?: string;
    mileage?: number;
    image_url?: string;
    image_variants?: {
      thumbnail?: string;
      medium?: string;
      large?: string;
    };
    primary_image_url?: string;
    transmission?: string;
    transmission_model?: string;
    sale_price?: number;
    current_value?: number;
    purchase_price?: number;
    asking_price?: number;
    condition_rating?: number;
    location?: string;
    updated_at?: string;
    created_at?: string;
    is_for_sale?: boolean;
    uploader_name?: string;
    event_count?: number;
    image_count?: number;
    view_count?: number;
    active_viewers?: number;
    is_streaming?: boolean;
    price_change?: number;
    roi_pct?: number;
    hype_reason?: string;
    all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
    tier?: string;
    tier_label?: string;
    profile_origin?: string | null; // 'bat_import', 'url_scraper', 'user_upload', etc.
    activity_7d?: number; // Recent activity (timeline events in last 7 days)
    receipt_count?: number; // Number of receipts (build documentation)
    ownership_verified?: boolean; // Has verified ownership records
    listing_start_date?: string; // When listing went live (for auctions, especially BAT)
    // Optional: precomputed display price (avoid per-card pricing RPCs on feed)
    display_price?: number;
    discovery_url?: string | null;
    discovery_source?: string | null;
  };
  viewMode?: 'list' | 'gallery' | 'grid';
  showSocial?: boolean;
  showPriceChange?: boolean;
  /** Controls whether price badges/overlays are shown on cards */
  showPriceOverlay?: boolean;
  /** Controls whether the semi-transparent detail overlay is shown on image */
  showDetailOverlay?: boolean;
  /** Home feed: compact vs info-dense card details */
  infoDense?: boolean;
  /** Optional URL to use for favicon/source stamp (listing source or org website). */
  sourceStampUrl?: string;
  /** When present, we can log identity-part telemetry for training contextual identity selection. */
  viewerUserId?: string;
  /** Optional: card size hint (used to scale typography in grid mode). */
  cardSizePx?: number;
  /** Enable thermal pricing color coding (purple=bad price, red=good deal) */
  thermalPricing?: boolean;
  /** Thumbnail fit mode for the card image (square crop vs original letterbox). */
  thumbnailFit?: 'cover' | 'contain';
  // ===== NEW FEATURE VISIBILITY PROPS =====
  /** Show follow/bookmark button (uses user_subscriptions) */
  showFollowButton?: boolean;
  /** Show relationship badge (owned/contributing/interested/etc.) */
  showRelationshipBadge?: boolean;
  /** Relationship type to display if showRelationshipBadge is true */
  relationshipType?: 'owned' | 'contributing' | 'interested' | 'discovered' | 'curated' | 'consigned' | 'previously_owned';
  /** Show metrics (image count, event count, etc.) */
  showMetrics?: boolean;
  /** Show status badges (discovery status, verification, etc.) */
  showStatusBadges?: boolean;
  /** Responsive sizing: auto-adjust based on container width */
  responsive?: boolean;
  /** Minimum card width in grid mode (default: 200px) */
  minCardWidth?: number;
  /** Maximum card width in grid mode (default: 400px) */
  maxCardWidth?: number;
}

const VehicleCardDense: React.FC<VehicleCardDenseProps> = ({
  vehicle,
  viewMode = 'list',
  showSocial = false,
  showPriceChange = false,
  showPriceOverlay = true,
  showDetailOverlay = true,
  infoDense = false,
  sourceStampUrl,
  viewerUserId,
  cardSizePx,
  thermalPricing = false,
  thumbnailFit = 'contain',
  // New props
  showFollowButton = false,
  showRelationshipBadge = false,
  relationshipType,
  showMetrics = false,
  showStatusBadges = false,
  responsive = true,
  minCardWidth = 200,
  maxCardWidth = 400,
}) => {
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);
  const [touchStart, setTouchStart] = React.useState(0);
  const [auctionNow, setAuctionNow] = React.useState(() => Date.now());
  const [showOwnershipPopup, setShowOwnershipPopup] = React.useState(false);
  const [specPopover, setSpecPopover] = React.useState<{
    def: PowertrainSpecDefinition | BodyStylePopoverDefinition;
    position: { x: number; y: number };
  } | null>(null);
  const specPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const [specPopoverStyle, setSpecPopoverStyle] = React.useState<React.CSSProperties | null>(null);
  const [specEvidence, setSpecEvidence] = React.useState<{
    loading: boolean;
    images: Array<{
      id: string;
      image_url: string;
      variants?: any;
      thumbnail_url?: string | null;
      medium_url?: string | null;
      category?: string | null;
      ai_detected_angle?: string | null;
      ai_detected_angle_confidence?: number | null;
      caption?: string | null;
      created_at?: string | null;
    }>;
    error: string | null;
  }>({ loading: false, images: [], error: null });
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [computedCardSize, setComputedCardSize] = React.useState(cardSizePx || 200);
  
  // Follow system with ROI tracking (only if enabled)
  const { isFollowing, isLoading: followLoading, followROI, toggleFollow } = useVehicleFollow(
    showFollowButton ? vehicle.id : ''
  );

  // Local CSS for badge animations. We scope keyframes to avoid collisions
  // (the design system defines multiple `@keyframes pulse` variations).
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const id = 'nuke-vehicle-card-dense-animations-v1';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes nuke-auction-pulse {
        0%, 100% { transform: scale(1); filter: saturate(1); }
        50% { transform: scale(1.05); filter: saturate(1.15); }
      }
      @keyframes nuke-badge-pop {
        0% { transform: scale(1); }
        35% { transform: scale(1.22); }
        65% { transform: scale(0.96); }
        100% { transform: scale(1); }
      }
      @keyframes nuke-badge-ticker {
        0%, 40% { transform: translateX(0%); }
        50%, 90% { transform: translateX(-50%); }
        100% { transform: translateX(0%); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Auction timer - updates every second for live auctions
  const auctionEndDate = React.useMemo(() => {
    const v: any = vehicle as any;
    // Check external_listings first (most up-to-date for live auctions)
    const externalListing = v?.external_listings?.[0];
    if (externalListing?.end_date) {
      return externalListing.end_date;
    }
    // Fallback to vehicle-level data
    return v.auction_end_date || v.origin_metadata?.auction_times?.auction_end_date || null;
  }, [vehicle]);

  const formatAuctionTimer = React.useMemo(() => {
    if (!auctionEndDate) return null;
    const end = new Date(auctionEndDate).getTime();
    if (!Number.isFinite(end)) return null;
    const diff = end - auctionNow;
    // Allow up to 60 days for legitimate long auctions (BaT auctions can be up to 10 days, but allow buffer)
    const maxReasonable = 60 * 24 * 60 * 60 * 1000;
    if (diff > maxReasonable) return null;
    if (diff <= 0) return 'Ended';
    
    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    
    // Show days when > 24 hours, HH:MM:SS when <= 24 hours
    // For very long auctions (>7 days), show simplified format (e.g., "19d 18h")
    if (totalSeconds > 7 * 86400) {
      return `${days}d ${hours}h`;
    }
    if (totalSeconds > 86400) {
      return `${days}d`;
    }
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }, [auctionEndDate, auctionNow]);

  // PERF: Never do per-card network calls on the feed.
  // Use the already-available vehicle fields (or precomputed display_price) to render pricing synchronously.
  const { displayPrice } = React.useMemo(() => {
    const v: any = vehicle as any;
    
    // Extract all price fields with proper validation
    const salePrice = parseMoneyNumber(v.sale_price);
    const winningBid = parseMoneyNumber(v.winning_bid);
    const highBid = parseMoneyNumber(v.high_bid);
    
    // Live bid from external_listings (already in vehicle data from homepage query)
    const externalListing = (v as any)?.external_listings?.[0];
    const listingLiveBid = parseMoneyNumber(externalListing?.current_bid);
    // Treat listing as live if end_date is in the future OR status indicates active/live when end_date is missing
    const listingEndDate = externalListing?.end_date ? new Date(externalListing.end_date).getTime() : 0;
    const statusStr = String(externalListing?.listing_status || '').toLowerCase();
    const hasLiveStatus = statusStr === 'active' || statusStr === 'live';
    const isLive = (Number.isFinite(listingEndDate) && listingEndDate > Date.now()) || (!externalListing?.end_date && hasLiveStatus);
    const liveBid = isLive ? listingLiveBid : null;
    
    // Current bid from vehicle (fallback if no external listing)
    const currentBid = parseMoneyNumber(v.current_bid);
    
    // Asking price (only if for sale)
    const saleStatus = String(v.sale_status || '').toLowerCase();
    const askingPrice = parseMoneyNumber(v.asking_price);
    const isForSaleStatus = saleStatus === 'for_sale' || saleStatus === 'available';
    const asking = (askingPrice !== null && (v.is_for_sale === true || isForSaleStatus))
      ? askingPrice
      : null;

    // PRIORITY ORDER (pro semantics):
    // 1. Sale price (executed transaction)
    // 2. Live bid (active auction, from external_listings — freshest signal)
    // 3. Winning bid (sold auction result) [fallback if sale_price missing]
    // 4. High bid (ended / RNM auctions)
    // 5. Current bid (legacy vehicle field fallback)
    // 6. Asking price (only if explicitly for sale)
    // 7. Current value (Nuke mark / estimate)
    // 8. Purchase price (context)
    // 9. MSRP (baseline)
    const currentValue = parseMoneyNumber(v.current_value);
    const purchasePrice = parseMoneyNumber(v.purchase_price);
    const msrp = parseMoneyNumber(v.msrp);
    
    const priceValue =
      salePrice ??
      liveBid ??
      winningBid ??
      highBid ??
      currentBid ??
      asking ??
      currentValue ??
      purchasePrice ??
      msrp ??
      null;

    const formatted = priceValue ? new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(priceValue) : '—';

    return { displayPrice: formatted };
  }, [vehicle]);

  const identity = React.useMemo(() => getVehicleIdentityTokens(vehicle as any), [vehicle]);
  const loggedKeysRef = React.useRef<Set<string>>(new Set());

  const vehicleTitle = React.useMemo(() => {
    const primary = identity.primary.map((t) => t.value).join(' ').trim();
    const diffs = identity.differentiators.map((t) => t.value).join(' ').trim();
    const combined = [primary, diffs].filter(Boolean).join(' ').trim();
    return combined || 'Vehicle';
  }, [identity.primary, identity.differentiators]);

  const gridTypography = React.useMemo(() => {
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    if (!cardSizePx || !Number.isFinite(cardSizePx)) {
      return {
        title: '9pt',
        meta: '7pt',
        badge: '8pt',
      };
    }

    // Map 140px -> 6pt, 260px -> 9pt.
    const t = clamp((cardSizePx - 140) / 120, 0, 1);
    const titlePt = 6 + t * 3;
    const metaPt = 5.5 + t * 2;
    const badgePt = 6.5 + t * 2;
    return {
      title: `${titlePt.toFixed(1)}pt`,
      meta: `${metaPt.toFixed(1)}pt`,
      badge: `${badgePt.toFixed(1)}pt`,
    };
  }, [cardSizePx]);

  // Card size tiers: drive what we render (not just font sizes).
  // This keeps the UI "pro level" across 1..16 cards/row by progressively disclosing details.
  const cardTier = React.useMemo(() => {
    const px = typeof cardSizePx === 'number' && Number.isFinite(cardSizePx) ? cardSizePx : 200;
    if (px <= 105) return 'xs' as const; // 12–16 per row
    if (px <= 135) return 'sm' as const; // 9–11 per row
    if (px <= 175) return 'md' as const; // 6–8 per row
    return 'lg' as const; // 1–5 per row
  }, [cardSizePx]);

  const isCompactCard = cardTier === 'xs' || cardTier === 'sm';

  const logIdentityToken = React.useCallback((kind: string, value: string, position: number) => {
    if (!viewerUserId) return;
    if (!vehicle?.id) return;
    const key = `${vehicle.id}:${kind}:${position}`;
    if (loggedKeysRef.current.has(key)) return;
    loggedKeysRef.current.add(key);

    // Best-effort: do not block rendering.
    UserInteractionService.logInteraction(
      viewerUserId,
      'view',
      'vehicle',
      vehicle.id,
      {
        vehicle_id: vehicle.id,
        source_page: typeof window !== 'undefined' ? window.location.pathname : undefined,
        device_type: 'desktop',
        gesture_type: 'hover',
        identity_kind: kind,
        identity_value: value,
        identity_position: position,
        identity_strategy: identity.meta.transmissionStrategy,
        identity_max_differentiators: identity.meta.maxDifferentiators,
      } as any
    ).catch(() => null);
  }, [viewerUserId, vehicle?.id, identity.meta.maxDifferentiators, identity.meta.transmissionStrategy]);

  const formatPrice = (price?: number) => {
    if (!price) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  // Check if vehicle is from Mecum and extract lot data
  const mecumLotData = React.useMemo(() => {
    const v: any = vehicle as any;
    
    // Check if vehicle is from Mecum
    const discoveryUrl = String(v?.discovery_url || '').toLowerCase();
    const discoverySource = String(v?.discovery_source || '').toLowerCase();
    const externalListing = v?.external_listings?.[0];
    const platform = String(externalListing?.platform || '').toLowerCase();
    
    const isMecum = 
      discoveryUrl.includes('mecum.com') ||
      discoverySource.includes('mecum') ||
      platform === 'mecum';
    
    if (!isMecum) {
      return null;
    }
    
    // Extract lot data from external_listings metadata or vehicle fields
    const metadata = externalListing?.metadata || {};
    
    // Extract lot number from URL if not in metadata: /lots/1154350/... -> 1154350
    let lotNumber = metadata?.lot_number || null;
    if (!lotNumber && discoveryUrl) {
      const lotMatch = String(v?.discovery_url || '').match(/\/lots\/(\d+)/);
      if (lotMatch && lotMatch[1]) {
        lotNumber = lotMatch[1];
      }
    }
    
    const location = metadata?.location || v?.location || null;
    const saleDate = metadata?.sale_date || v?.sale_date || externalListing?.sold_at || null;
    const auctionDate = metadata?.auction_start_date || externalListing?.start_date || v?.auction_end_date || saleDate;
    const salePrice = parseMoneyNumber(v?.sale_price) ?? parseMoneyNumber(externalListing?.final_price) ?? null;
    const estimateLow = metadata?.estimate_low || null;
    const estimateHigh = metadata?.estimate_high || null;
    const listingUrl = externalListing?.listing_url || v?.discovery_url || null;
    
    // Use auction date if available, otherwise sale date
    const date = auctionDate || saleDate;
    
    // Only return data if we have at least lot number or date
    if (!lotNumber && !date && !location) {
      return null;
    }
    
    return {
      lotNumber,
      date,
      location,
      salePrice,
      estimateLow,
      estimateHigh,
      listingUrl,
    };
  }, [vehicle]);

  // Calculate alphabet-based tier (F, E, D, C, B, A, S, SSS)
  // Tier is based on COMPLETENESS and QUALITY of information
  // Tiers increase as users provide more information - NOT locked in
  // S and SSS are ONLY manually assigned (never auto-calculated)
  const calculateVehicleTier = (vehicle: VehicleCardDenseProps['vehicle']): string => {
    // If tier is manually set to S or SSS, use it (never override manual assignments)
    if (vehicle.tier_label === 'S' || vehicle.tier_label === 'SSS') {
      return vehicle.tier_label;
    }
    if (vehicle.tier === 'S' || vehicle.tier === 'SSS') {
      return vehicle.tier;
    }
    
    // Completeness scoring factors (can be extended/modified as requirements evolve)
    const completenessFactors = {
      // Basic identification (required for any tier above F)
      hasVIN: (() => {
        const raw = String(vehicle.vin || '').trim().toUpperCase();
        if (!raw) return false;
        // Treat placeholder/system VINs as missing.
        if (raw.startsWith('VIVA') || raw.startsWith('TEST') || raw.startsWith('FAKE')) return false;
        // Accept modern VINs (17) and legacy chassis/serial identifiers (4-16).
        return /^[A-HJ-NPR-Z0-9]{4,17}$/.test(raw);
      })(),
      hasPrice: !!(vehicle.asking_price || vehicle.current_value || vehicle.sale_price),
      hasYearMakeModel: !!(vehicle.year && vehicle.make && vehicle.model),
      
      // Visual documentation
      imageCount: vehicle.all_images?.length || vehicle.image_count || 0,
      
      // Engagement & activity (shows user investment)
      eventCount: vehicle.event_count || 0,
      recentActivity: vehicle.activity_7d || 0,
      viewCount: vehicle.view_count || 0,
      
      // Documentation quality
      receiptCount: vehicle.receipt_count || 0,
      ownershipVerified: vehicle.ownership_verified || false,
      
      // Source quality
      isBATImport: vehicle.profile_origin === 'bat_import',
      isScraped: vehicle.profile_origin === 'url_scraper' || 
                 vehicle.profile_origin === 'craigslist_scrape' || 
                 vehicle.profile_origin === 'ksl_import',
      isDealer: vehicle.profile_origin === 'url_scraper' || vehicle.profile_origin === 'craigslist_scrape',
      isFlipper: (vehicle.profile_origin === 'url_scraper' || vehicle.profile_origin === 'craigslist_scrape') && vehicle.is_for_sale,
    };
    
    const { hasVIN, hasPrice, hasYearMakeModel, imageCount, eventCount, recentActivity, viewCount, 
            receiptCount, ownershipVerified, isBATImport, isScraped, isDealer, isFlipper } = completenessFactors;
    
    // Calculate completeness score (0-100)
    // This scoring system can be adjusted as requirements evolve
    let completenessScore = 0;
    
    // Basic identification (20 points)
    if (hasYearMakeModel) completenessScore += 5;
    if (hasVIN) completenessScore += 10;
    if (hasPrice) completenessScore += 5;
    
    // Visual documentation (30 points)
    if (imageCount >= 1) completenessScore += 5;
    if (imageCount >= 5) completenessScore += 10;
    if (imageCount >= 10) completenessScore += 10;
    if (imageCount >= 20) completenessScore += 5;
    
    // Engagement & activity (25 points)
    if (eventCount >= 1) completenessScore += 5;
    if (eventCount >= 5) completenessScore += 10;
    if (eventCount >= 10) completenessScore += 10;
    if (recentActivity >= 3) completenessScore += 5;
    if (viewCount >= 50) completenessScore += 5;
    
    // Documentation quality (15 points)
    if (receiptCount >= 1) completenessScore += 5;
    if (receiptCount >= 5) completenessScore += 5;
    if (receiptCount >= 10) completenessScore += 5;
    if (ownershipVerified) completenessScore += 5;
    
    // Source quality adjustments (penalties for dealers/flippers)
    if (isDealer || isFlipper) {
      // Dealers/flippers need to prove quality through engagement
      if (!hasVIN || !hasPrice) completenessScore -= 10;
      if (eventCount < 2 && viewCount < 50) completenessScore -= 5;
    }
    
    // Map completeness score to tier
    // These thresholds can be adjusted as the system evolves
    // Made stricter: C tier requires substantial data (not just basic info)
    if (completenessScore < 10) return 'F'; // No/minimal data
    if (completenessScore < 20) return 'E'; // Very basic (1 image, no VIN/price)
    if (completenessScore < 40) return 'D'; // Has potential, good bones (VIN OR price + some images)
    if (completenessScore < 60) return 'C'; // Vast majority - baseline (VIN + price + 10+ images OR engagement)
    if (completenessScore < 75) return 'B'; // Making an effort / cool BAT cars (engagement + documentation)
    if (completenessScore < 90) return 'A'; // Strong engagement and documentation (comprehensive)
    // 90+ would be S tier, but that's manually assigned only
    
    // Stricter fallback: Don't default to C for basic data
    // Nearly empty profiles should be F/E/D, not C
    if (imageCount === 0) return 'F';
    if (imageCount === 1) return 'E';
    if (imageCount < 5 && !hasVIN && !hasPrice) return 'E';
    if (imageCount < 10 && !hasVIN && !hasPrice && eventCount === 0) return 'D';
    // Only C if has substantial data
    if (hasVIN && hasPrice && imageCount >= 10) return 'C';
    if (hasVIN && hasPrice && imageCount >= 5 && eventCount >= 1) return 'C';
    // Otherwise D or lower
    if (hasVIN || hasPrice) return 'D';
    return 'E';
  };

  const normalizeTierLabel = (raw: any): string | null => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return null;
    // Normalize legacy labels like "Tier C" -> "C"
    const m = s.match(/^tier\s+([a-z]{1,3})$/i);
    if (m?.[1]) return m[1].toUpperCase();
    return s.toUpperCase();
  };

  // Simple image fallback - no complex logic
  const getImageUrl = () => {
    return vehicle.primary_image_url || vehicle.image_url || null;
  };

  const imageUrl = getImageUrl();
  const primaryFromAllImages =
    (vehicle.all_images?.find((img) => img?.is_primary && img?.url)?.url) ||
    (vehicle.all_images?.[0]?.url) ||
    null;
  const normalizeStampHost = (raw: unknown): string => {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    try {
      return new URL(s).hostname.toLowerCase();
    } catch {
      return s.toLowerCase();
    }
  };

  // Two-stamp support:
  // - Source stamp: discovery/listing domain (BaT, Craigslist, etc.)
  // - Org stamp: the associated organization website (dealer/shop) if provided and different.
  const sourceFaviconUrl =
    (vehicle.discovery_url ? String(vehicle.discovery_url).trim() : '') ||
    (sourceStampUrl ? String(sourceStampUrl).trim() : '');
  const orgFaviconUrl = (() => {
    const disc = vehicle.discovery_url ? String(vehicle.discovery_url).trim() : '';
    const org = sourceStampUrl ? String(sourceStampUrl).trim() : '';
    if (!disc || !org) return '';
    if (normalizeStampHost(disc) === normalizeStampHost(org)) return '';
    return org;
  })();

  // STATE-BASED: Is this vehicle in an ACTIVE AUCTION right now?
  // Uses unified auction state service - treats auction as temporary mode, not permanent state
  const isActiveAuction = React.useMemo(() => {
    return isInActiveAuction(vehicle);
  }, [vehicle]);

  // Update timer every second for active auctions (must be after isActiveAuction is defined)
  const lastUpdateRef = React.useRef<number>(Date.now());
  React.useEffect(() => {
    if (!isActiveAuction || !auctionEndDate) return;
    const tick = () => {
      const now = Date.now();
      setAuctionNow(now);
      lastUpdateRef.current = now;
    };
    // Update immediately
    tick();
    // Update every second when visible, every 10 seconds when hidden (to keep it accurate)
    const id = window.setInterval(() => {
      const isVisible = document.visibilityState === 'visible';
      const now = Date.now();
      if (isVisible) {
        tick();
      } else {
        // Update less frequently when hidden, but still update to keep it accurate
        if (now - lastUpdateRef.current >= 10000) { // Update every 10 seconds when hidden
          tick();
        }
      }
    }, 1000);
    
    // Also update when page becomes visible again (to catch up after tab switch)
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
  }, [isActiveAuction, auctionEndDate]);
  
  // Get auction mode for additional context
  const auctionMode = React.useMemo(() => {
    return getAuctionMode(vehicle);
  }, [vehicle]);
  
  // Get complete auction state info
  const auctionState = React.useMemo(() => {
    return getAuctionStateInfo(vehicle);
  }, [vehicle]);
  
  // Keep isAuctionSource for backward compatibility (used in badge animations, etc.)
  // But it should generally match isActiveAuction for live auctions
  const isAuctionSource = isActiveAuction;

  const auctionProgress01 = React.useMemo(() => {
    if (!isAuctionSource) return 0;
    const startRaw = (vehicle as any)?.listing_start_date || vehicle.created_at;
    const start = startRaw ? new Date(startRaw).getTime() : NaN;
    if (!Number.isFinite(start)) return 0;
    const elapsedMs = Date.now() - start;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const p = elapsedMs / sevenDaysMs;
    return Math.max(0, Math.min(1, p));
  }, [isAuctionSource, vehicle.created_at, (vehicle as any)?.listing_start_date]);

  const badgePulseSeconds = React.useMemo(() => {
    // Slow -> fast as the auction progresses.
    // 0%: 6.0s, 100%: 1.2s
    if (!isAuctionSource) return null;
    const min = 1.2;
    const max = 6.0;
    return max - (max - min) * auctionProgress01;
  }, [isAuctionSource, auctionProgress01]);

  // Get current bid for active auctions - prioritize external_listings (live data)
  const auctionHighBidText = React.useMemo(() => {
    const v: any = vehicle as any;
    
    // For active auctions, prioritize external_listings[0].current_bid (live BaT data)
    if (isActiveAuction) {
      const externalListing = v?.external_listings?.[0];
      if (externalListing) {
        // Check current_bid first (most up-to-date for live auctions)
        const listingLiveBid = parseMoneyNumber(externalListing.current_bid);
        if (listingLiveBid !== null) {
          return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(listingLiveBid);
        }
        // If current_bid is 0 or null, check if there are any bids at all
        const bidCount = typeof externalListing.bid_count === 'number' ? externalListing.bid_count : 0;
        if (bidCount === 0) {
          // No bids yet - return null so badge can show "BID" label
          return null;
        }
      }
      
      // Fallback: vehicle.current_bid for active auctions
      const currentBid = parseMoneyNumber(v.current_bid);
      if (currentBid) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(currentBid);
      }
      
      // No bids yet for active auction
      return null;
    }
    
    // For ended auctions or non-auction cases, show final results
    // Priority: sale price > winning bid > high bid
    const salePrice = parseMoneyNumber(v.sale_price);
    const winningBid = parseMoneyNumber(v.winning_bid);
    const highBid = parseMoneyNumber(v.high_bid);
    
    const finalBid = salePrice ?? winningBid ?? highBid;
    if (finalBid) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(finalBid);
    }
    
    // Fallback: check cents fields
    const cents =
      (typeof v.current_high_bid_cents === 'number' ? v.current_high_bid_cents : null) ??
      (typeof v.latest_bid_cents === 'number' ? v.latest_bid_cents : null);
    if (typeof cents === 'number' && Number.isFinite(cents) && cents > 0) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
    }
    
    return null;
  }, [vehicle, isActiveAuction]);

  const auctionBidderDisplay = React.useMemo(() => {
    const v: any = vehicle as any;
    const masked = !!v.latest_bidder_masked;
    const raw =
      typeof v.latest_bidder_display_name === 'string' ? v.latest_bidder_display_name :
      typeof v.latest_bidder_name === 'string' ? v.latest_bidder_name :
      null;
    if (masked) return '***';
    if (raw && raw.trim()) return raw.trim();
    return null;
  }, [vehicle]);

  const badgeExplode = React.useMemo(() => {
    // Hook: set `bid_broke_record=true` on vehicle payload to trigger the pop.
    return !!(vehicle as any)?.bid_broke_record;
  }, [vehicle]);

  // Calculate thermal pricing color (good deal = red, bad price = purple)
  const thermalPriceColor = React.useMemo(() => {
    if (!thermalPricing) return undefined;
    
    const v: any = vehicle as any;
    const displayPriceValue =
      (typeof v.display_price === 'number' && Number.isFinite(v.display_price) && v.display_price > 0) ? v.display_price :
      (typeof v.sale_price === 'number' && v.sale_price > 0) ? v.sale_price :
      (typeof v.asking_price === 'number' && v.asking_price > 0) ? v.asking_price :
      null;
    
    if (!displayPriceValue) return undefined;
    
    // Compare against current_value or similar vehicles' sale prices
    const currentValue = typeof v.current_value === 'number' && v.current_value > 0 ? v.current_value : null;
    const purchasePrice = typeof v.purchase_price === 'number' && v.purchase_price > 0 ? v.purchase_price : null;
    
    // Good deal: asking_price is less than current_value or purchase_price
    // Bad price: asking_price is significantly higher
    if (currentValue) {
      const ratio = displayPriceValue / currentValue;
      // Good deal: < 1.0 (red), Bad price: > 1.2 (purple), Neutral: in between
      if (ratio < 0.95) return '#ef4444'; // Red - good deal
      if (ratio > 1.2) return '#a855f7'; // Purple - bad price
    }
    
    if (purchasePrice && purchasePrice > 0) {
      const ratio = displayPriceValue / purchasePrice;
      if (ratio < 0.95) return '#ef4444'; // Red - good deal
      if (ratio > 1.3) return '#a855f7'; // Purple - bad price
    }
    
    return undefined; // Neutral/no color
  }, [thermalPricing, vehicle]);

  // Check if auction ended more than 1 day ago (for fade logic) - MOVED BEFORE badgeStyle
  const auctionEndedDaysAgo = React.useMemo(() => {
    const v: any = vehicle as any;
    const endDate = v.auction_end_date || v.origin_metadata?.auction_times?.auction_end_date;
    if (!endDate) return null;
    
    const end = new Date(endDate);
    const now = new Date();
    const daysAgo = (now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo > 0 ? daysAgo : null;
  }, [vehicle]);

  // Determine if we should show asset value instead of auction status - MOVED BEFORE badgeStyle
  const shouldShowAssetValue = React.useMemo(() => {
    if (!isAuctionSource) return false;
    const v: any = vehicle as any;
    const outcome = String(v.auction_outcome || '').toLowerCase();
    const saleStatus = String(v.sale_status || '').toLowerCase();
    const isResult = ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(outcome) || ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(saleStatus);
    
    // Show asset value if auction ended more than 1 day ago (especially if unsold)
    if (isResult && auctionEndedDaysAgo !== null && auctionEndedDaysAgo >= 1) {
      // Always fade unsold auctions, but also fade sold after 1 day
      if (outcome === 'reserve_not_met' || outcome === 'no_sale' || outcome === 'ended') {
        return true; // Always show asset value for unsold
      }
      // For sold, fade after 1 day but still show sold price if available
      return true;
    }
    
    return false;
  }, [isAuctionSource, vehicle, auctionEndedDaysAgo]);

  const badgeStyle = React.useMemo((): React.CSSProperties => {
    // Provide subtle, deterministic status differentiation (SOLD vs RESULT) via border color.
    // This keeps the badge readable on mixed imagery while reducing "everything is the same black pill".
    const v: any = vehicle as any;
    const outcome = String(v?.auction_outcome || '').toLowerCase();
    const saleStatus = String(v?.sale_status || '').toLowerCase();
    const externalListing = v?.external_listings?.[0];
    const externalStatus = externalListing ? String(externalListing?.listing_status || '').toLowerCase() : '';
    const hasFinalPrice = externalListing?.final_price || null;
    const hasSoldAt = externalListing?.sold_at || null;
    const isSoldLike =
      outcome === 'sold' ||
      saleStatus === 'sold' ||
      (externalStatus === 'sold' && (hasFinalPrice || hasSoldAt));
    const isResultLike =
      outcome === 'reserve_not_met' ||
      outcome === 'ended' ||
      outcome === 'no_sale' ||
      externalStatus === 'ended';
    const statusBorderColor = isSoldLike ? '#10b981' : isResultLike ? '#f59e0b' : undefined;
    const borderColor = thermalPriceColor || statusBorderColor;

    const base: React.CSSProperties = {
      position: 'absolute',
      top: '6px',
      right: '6px',
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      color: thermalPriceColor || 'white',
      padding: isCompactCard ? '3px 6px' : '4px 8px',
      borderRadius: isCompactCard ? '5px' : '6px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: isCompactCard ? '4px' : '6px',
      maxWidth: '85%',
      border: borderColor ? `1px solid ${borderColor}80` : '1px solid rgba(255,255,255,0.18)',
      transformOrigin: 'center',
      transition: 'opacity 0.3s ease',
    };

    if (!isAuctionSource) return base;

    // Fade out badge if auction ended more than 1 day ago (especially unsold)
    if (shouldShowAssetValue) {
      const v: any = vehicle as any;
      const outcome = String(v.auction_outcome || '').toLowerCase();
      const isUnsold = outcome === 'reserve_not_met' || outcome === 'no_sale' || outcome === 'ended';
      
      // Fade completely for unsold after 1 day
      if (isUnsold && auctionEndedDaysAgo !== null && auctionEndedDaysAgo >= 1) {
        return {
          ...base,
          opacity: 0,
          display: 'none',
        };
      }
      
      // For sold, fade but still show (less prominent)
      if (auctionEndedDaysAgo !== null && auctionEndedDaysAgo >= 1) {
        const fadeAmount = Math.max(0, 1 - (auctionEndedDaysAgo - 1) * 0.5); // Fade over 2 more days
        return {
          ...base,
          opacity: fadeAmount,
        };
      }
    }

    // Heat: subtle border shift (cold -> hot) as listing ages.
    const border =
      auctionProgress01 > 0.9 ? 'rgba(239,68,68,0.55)' :
      auctionProgress01 > 0.7 ? 'rgba(245,158,11,0.45)' :
      'rgba(59,130,246,0.35)';

    const pulse = badgePulseSeconds ? `nuke-auction-pulse ${badgePulseSeconds.toFixed(2)}s ease-in-out infinite` : '';
    const pop = badgeExplode ? 'nuke-badge-pop 650ms cubic-bezier(0.2, 1.2, 0.2, 1) 1' : '';
    const anim = [pop, pulse].filter(Boolean).join(', ');

    return {
      ...base,
      border: thermalPriceColor ? `1px solid ${thermalPriceColor}80` : border,
      animation: anim || undefined,
    };
  }, [isAuctionSource, auctionProgress01, badgePulseSeconds, badgeExplode, thermalPriceColor, shouldShowAssetValue, vehicle, auctionEndedDaysAgo, isCompactCard]);

  // Get market value (current_value or estimated value)
  const marketValue = React.useMemo(() => {
    const v: any = vehicle as any;
    // Priority: current_value > asking_price > purchase_price
    return v.current_value || v.asking_price || v.purchase_price || null;
  }, [vehicle]);

  // Get owner cost (total investment)
  const ownerCost = React.useMemo(() => {
    const v: any = vehicle as any;
    // Priority: cost_basis > purchase_price > sum of receipts
    return v.cost_basis || v.purchase_price || null;
  }, [vehicle]);

  // Check if SOLD badge should be shown (time-based: hide after 30 days)
  const shouldShowSoldBadge = React.useMemo(() => {
    const v: any = vehicle as any;
    const saleDate = v.sale_date || 
                     (v.external_listings?.[0]?.sold_at) ||
                     null;
    
    if (!saleDate) return true; // Show if no sale date (let other logic decide)
    
    const SOLD_BADGE_DISPLAY_DAYS = 30;
    const sale = new Date(saleDate).getTime();
    if (!Number.isFinite(sale)) return true;
    
    const daysSinceSale = (Date.now() - sale) / (1000 * 60 * 60 * 24);
    return daysSinceSale <= SOLD_BADGE_DISPLAY_DAYS;
  }, [vehicle]);

  // Check if vehicle is sold (for popup clickability)
  const isSold = React.useMemo(() => {
    const v: any = vehicle as any;
    const outcome = String(v.auction_outcome || '').toLowerCase();
    const saleStatus = String(v.sale_status || '').toLowerCase();
    const externalListing = v?.external_listings?.[0];
    const externalStatus = externalListing ? String(externalListing.listing_status || '').toLowerCase() : '';
    const hasFinalPrice = externalListing?.final_price || null;
    const hasSoldAt = externalListing?.sold_at || null;
    
    return outcome === 'sold' || 
           saleStatus === 'sold' || 
           (externalStatus === 'sold' && (hasFinalPrice || hasSoldAt)) ||
           (typeof v.sale_price === 'number' && v.sale_price > 0 && saleStatus === 'sold');
  }, [vehicle]);

  // STATE-BASED: What's the most relevant price to show RIGHT NOW?
  const badgeMainText = React.useMemo(() => {
    const v: any = vehicle as any;
    
    // Extract status fields at the beginning
    const outcome = String(v.auction_outcome || '').toLowerCase();
    const saleStatus = String(v.sale_status || '').toLowerCase();
    const externalListing = v?.external_listings?.[0];
    const externalStatus = externalListing ? String(externalListing.listing_status || '').toLowerCase() : '';
    
    // PRIORITY 1: ACTIVE TRANSACTION STATE (what's happening NOW)
    if (isActiveAuction) {
      // Live auction - show bid amount (badge will add "BID" label separately)
      return auctionHighBidText || 'BID';
    }
    
    // PRIORITY 2: RECENTLY COMPLETED TRANSACTION (what just happened)
    // Only show SOLD if within time window
    if (isSold && shouldShowSoldBadge) {
      return `SOLD ${auctionHighBidText || ''}`.trim();
    }
    
    // If sold but beyond time window, fall through to show asset value
    
    // Check if auction ended but didn't sell (RNM, no sale, etc.)
    if (outcome === 'reserve_not_met' || outcome === 'ended' || outcome === 'no_sale' || externalStatus === 'ended') {
      return auctionHighBidText ? `RESULT ${auctionHighBidText}`.trim() : 'ENDED';
    }
    
    // If we have sale_price but status is 'available', it's likely just a high bid for a timed auction
    // Show it as a bid/result, not as sold
    if (typeof v.sale_price === 'number' && v.sale_price > 0 && saleStatus === 'available' && !isActiveAuction) {
      // Auction ended but status is available - likely high bid, not sold
      // Just show the price without "SOLD" prefix
      return auctionHighBidText || formatPrice(v.sale_price);
    }
    
    // PRIORITY 3: CURRENT ASSET VALUE (what it's worth NOW)
    // If auction ended > 1 day ago, show asset value instead of auction status
    if (shouldShowAssetValue) {
      if (marketValue) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(marketValue);
      }
      if (ownerCost) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(ownerCost);
      }
    }
    
    // PRIORITY 4: REGULAR PRICE (for sale, estimated value, etc.)
    // For non-auction vehicles, use displayPrice which handles: sale_price > asking_price > etc.
    // But also check marketValue/ownerCost as fallback if displayPrice is "—"
    if (displayPrice && displayPrice !== '—') {
      return displayPrice;
    }
    // Fallback to market value if displayPrice is empty
    if (marketValue) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(marketValue);
    }
    if (ownerCost) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(ownerCost);
    }
    return displayPrice; // Will be "—" if nothing found
  }, [isActiveAuction, displayPrice, vehicle, auctionHighBidText, shouldShowAssetValue, marketValue, ownerCost, isSold, shouldShowSoldBadge]);

  const closeSpecPopover = React.useCallback(() => setSpecPopover(null), []);

  React.useEffect(() => {
    if (!specPopover) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSpecPopover();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [specPopover, closeSpecPopover]);

  // Keep the spec popover within the viewport (prevents "off-screen" popups near edges).
  React.useEffect(() => {
    if (!specPopover) {
      setSpecPopoverStyle(null);
      return;
    }
    if (typeof window === 'undefined') return;

    const margin = 12;
    const gap = 12;

    const measureAndClamp = () => {
      const el = specPopoverRef.current;
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      if (!el || vw <= 0 || vh <= 0) return;

      const rect = el.getBoundingClientRect();
      const w = rect.width || Math.min(360, Math.max(0, vw - margin * 2));
      const h = rect.height || 160;

      const anchorX = specPopover.position.x;
      const anchorY = specPopover.position.y;

      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

      // Prefer below cursor; if it would overflow, flip above.
      const canPlaceBelow = anchorY + gap + h <= vh - margin;
      const top = canPlaceBelow
        ? clamp(anchorY + gap, margin, vh - margin - h)
        : clamp(anchorY - gap - h, margin, vh - margin - h);

      // Center horizontally on cursor, but clamp within viewport.
      const left = clamp(anchorX - w / 2, margin, vw - margin - w);

      setSpecPopoverStyle({
        position: 'fixed',
        left,
        top,
        transform: 'none',
      });
    };

    // Measure immediately and on next frame (fonts/layout can settle).
    measureAndClamp();
    const raf = window.requestAnimationFrame(() => measureAndClamp());
    window.addEventListener('resize', measureAndClamp);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', measureAndClamp);
    };
  }, [specPopover]);

  // Load "proof" images for the spec popover when we have AI angle classification.
  // This is the first step toward evidence-backed fields (e.g., "Transmission" with supporting photos).
  React.useEffect(() => {
    let cancelled = false;

    if (!specPopover) {
      setSpecEvidence({ loading: false, images: [], error: null });
      return () => {
        cancelled = true;
      };
    }

    const kind = (specPopover.def as any)?.kind;
    if (kind !== 'engine' && kind !== 'transmission') {
      setSpecEvidence({ loading: false, images: [], error: null });
      return () => {
        cancelled = true;
      };
    }

    const vehicleId = String(vehicle?.id || '').trim();
    if (!vehicleId) return () => {
      cancelled = true;
    };

    const token = kind === 'transmission' ? 'transmission' : 'engine';

    setSpecEvidence((prev) => ({ ...prev, loading: true, error: null, images: [] }));

    const isMissingColumn = (err: any): boolean => {
      const code = String(err?.code || '').toUpperCase();
      const msg = String(err?.message || '').toLowerCase();
      return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
    };

    const run = async () => {
      try {
        // NOTE: avoid depending on optional columns in WHERE clauses (some environments drift).
        // Fetch a small window and filter client-side.
        const selectFields =
          'id, image_url, variants, thumbnail_url, medium_url, category, caption, is_primary, created_at, ai_detected_angle, ai_detected_angle_confidence';

        const { data, error } = await supabase
          .from('vehicle_images')
          .select(selectFields)
          .eq('vehicle_id', vehicleId)
          .order('is_primary', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(60);

        if (error) throw error;

        const rows = Array.isArray(data) ? (data as any[]) : [];
        const filtered = rows.filter((img) => {
          const angle = String(img?.ai_detected_angle || '').toLowerCase();
          const cat = String(img?.category || '').toLowerCase();
          const cap = String(img?.caption || '').toLowerCase();
          const match =
            (angle && angle.includes(token)) ||
            (cat && cat.includes(token)) ||
            (cap && cap.includes(token));

          // Skip obvious documents/duplicates when those flags exist.
          if ((img as any)?.is_document === true) return false;
          if ((img as any)?.is_duplicate === true) return false;

          return match;
        });

        const images = filtered.slice(0, 12).map((img) => ({
          id: String(img?.id || ''),
          image_url: String(img?.image_url || ''),
          variants: (img as any)?.variants,
          thumbnail_url: (img as any)?.thumbnail_url ?? null,
          medium_url: (img as any)?.medium_url ?? null,
          category: (img as any)?.category ?? null,
          ai_detected_angle: (img as any)?.ai_detected_angle ?? null,
          ai_detected_angle_confidence:
            typeof (img as any)?.ai_detected_angle_confidence === 'number'
              ? (img as any).ai_detected_angle_confidence
              : null,
          caption: (img as any)?.caption ?? null,
          created_at: (img as any)?.created_at ?? null,
        }));

        if (cancelled) return;
        setSpecEvidence({ loading: false, images, error: null });
      } catch (e: any) {
        // If the environment doesn't have the newer AI columns, silently fall back.
        if (isMissingColumn(e)) {
          try {
            const { data: data2, error: err2 } = await supabase
              .from('vehicle_images')
              .select('id, image_url, variants, category, caption, is_primary, created_at')
              .eq('vehicle_id', vehicleId)
              .order('is_primary', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(60);
            if (err2) throw err2;

            const rows2 = Array.isArray(data2) ? (data2 as any[]) : [];
            const filtered2 = rows2.filter((img) => {
              const cat = String(img?.category || '').toLowerCase();
              const cap = String(img?.caption || '').toLowerCase();
              const match = (cat && cat.includes(token)) || (cap && cap.includes(token));
              if ((img as any)?.is_document === true) return false;
              if ((img as any)?.is_duplicate === true) return false;
              return match;
            });

            const images2 = filtered2.slice(0, 12).map((img) => ({
              id: String(img?.id || ''),
              image_url: String(img?.image_url || ''),
              variants: (img as any)?.variants,
              thumbnail_url: null,
              medium_url: null,
              category: (img as any)?.category ?? null,
              ai_detected_angle: null,
              ai_detected_angle_confidence: null,
              caption: (img as any)?.caption ?? null,
              created_at: (img as any)?.created_at ?? null,
            }));

            if (cancelled) return;
            setSpecEvidence({ loading: false, images: images2, error: null });
            return;
          } catch {
            // Fall through to "no evidence" state below.
          }
        }

        if (cancelled) return;
        setSpecEvidence({ loading: false, images: [], error: null });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [specPopover, vehicle?.id]);

  const openSpecPopover = React.useCallback(
    (e: React.MouseEvent, kind: 'engine' | 'transmission' | 'body_style', raw: unknown) => {
      e.preventDefault();
      e.stopPropagation();
      const def =
        kind === 'engine'
          ? getEngineDefinition(raw)
          : kind === 'transmission'
            ? getTransmissionDefinition(raw)
            : getBodyStylePopoverDefinition(raw);
      if (!def) return;

      // Set an initial clamped position immediately (avoid a 1-frame offscreen flash).
      try {
        if (typeof window !== 'undefined') {
          const vw = window.innerWidth || 0;
          const vh = window.innerHeight || 0;
          const margin = 12;
          const gap = 12;
          const assumedW = Math.min(360, Math.max(0, vw - margin * 2));
          const assumedH = 220; // reasonable estimate; we refine after measuring
          const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

          const canPlaceBelow = e.clientY + gap + assumedH <= vh - margin;
          const top = canPlaceBelow
            ? clamp(e.clientY + gap, margin, vh - margin - assumedH)
            : clamp(e.clientY - gap - assumedH, margin, vh - margin - assumedH);
          const left = clamp(e.clientX - assumedW / 2, margin, vw - margin - assumedW);

          setSpecPopoverStyle({ position: 'fixed', left, top, transform: 'none' });
        }
      } catch {
        // ignore
      }

      setSpecPopover({
        def,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    []
  );

  const badgeParts = React.useMemo(() => {
    const raw = String(badgeMainText || '').trim();
    const up = raw.toUpperCase();
    if (up.startsWith('SOLD ')) return { label: 'SOLD', value: raw.slice(5).trim() || null };
    if (up.startsWith('RESULT ')) return { label: 'RESULT', value: raw.slice(7).trim() || null };
    if (up === 'ENDED') return { label: 'ENDED', value: null as string | null };
    return { label: null as string | null, value: raw || null };
  }, [badgeMainText]);

  // LIST VIEW: Cursor-style - compact, dense, single row
  if (viewMode === 'list') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        state={{ vehicleTitle }}
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 2fr 1fr 1fr 80px 60px',
          gap: '12px',
          alignItems: 'center',
          padding: '6px 8px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0px',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '1px',
          fontSize: '8pt',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--grey-50)';
          e.currentTarget.style.borderColor = 'var(--text)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        {/* Compact thumbnail - 60px */}
        <div
          style={{
            width: '60px',
            height: '60px',
            flexShrink: 0,
            borderRadius: '0px',
            border: '1px solid var(--border)',
            background: 'var(--grey-200)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <ResilientImage
            sources={[
              vehicle?.image_variants?.thumbnail,
              vehicle?.image_variants?.medium,
              vehicle?.image_variants?.large,
              primaryFromAllImages,
              imageUrl,
              vehicle.primary_image_url,
              vehicle.image_url,
            ]}
            alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'}
            fill={true}
            objectFit={thumbnailFit}
            placeholderSrc="/n-zero.png"
            placeholderOpacity={0.25}
          />
        </div>
        
        {/* Vehicle - single line */}
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, fontSize: '9pt' }}>
            {vehicleTitle}
          </span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
            {vehicle.uploader_name && `by ${vehicle.uploader_name}`}
          </span>
        </div>
        
        {/* Stats - compact */}
        <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
          {typeof vehicle.mileage === 'number' && vehicle.mileage > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {/* Clean numeric mileage for extraction (no "k", no "mi", no stroke). */}
              <span
                title={`${Math.floor(vehicle.mileage).toLocaleString()} miles`}
                aria-label={`Mileage: ${Math.floor(vehicle.mileage).toLocaleString()} miles`}
                data-mileage={Math.max(0, Math.floor(Math.abs(vehicle.mileage || 0)))}
                style={{ fontWeight: 700 }}
              >
                {Math.max(0, Math.floor(Math.abs(vehicle.mileage || 0)))}
              </span>
            </span>
          ) : (
            '—'
          )}
          {vehicle.condition_rating && ` • C:${vehicle.condition_rating}`}
        </div>
        
        {/* Counts */}
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          {vehicle.image_count || 0} img • {vehicle.event_count || 0} evt
        </div>
        
        {/* Value - Show LotBadge for Mecum, otherwise show price */}
        <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '9pt' }}>
          {mecumLotData ? (
            <LotBadge
              lotNumber={mecumLotData.lotNumber}
              date={mecumLotData.date}
              location={mecumLotData.location}
              salePrice={mecumLotData.salePrice}
              estimateLow={mecumLotData.estimateLow}
              estimateHigh={mecumLotData.estimateHigh}
              listingUrl={mecumLotData.listingUrl}
            />
          ) : (
            badgeMainText
          )}
        </div>
        
        {/* Profit (if valid) */}
        <div style={{ textAlign: 'right', fontSize: '8pt', fontWeight: 600 }}>
          {vehicle.current_value && vehicle.purchase_price && 
           vehicle.purchase_price > 0 && 
           vehicle.purchase_price < vehicle.current_value * 5 ? (
            <span style={{ color: vehicle.current_value > vehicle.purchase_price ? '#10b981' : '#ef4444' }}>
              {vehicle.current_value > vehicle.purchase_price ? '+' : ''}
              {formatPrice(vehicle.current_value - vehicle.purchase_price)}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </div>
      </Link>
    );
  }

  // GALLERY VIEW: card with image and semi-transparent detail overlay
  if (viewMode === 'gallery') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        state={{ vehicleTitle }}
        style={{
          display: 'block',
          background: 'rgba(0, 0, 0, 0.9)',
          borderRadius: '8px',
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '8px',
        }}
      >
        {/* Image preview with overlays */}
        <div
          style={{
            width: '100%',
            height: '220px',
            backgroundColor: '#000',
            position: 'relative',
          }}
        >
          <ResilientImage
            sources={[
              vehicle?.image_variants?.large,
              vehicle?.image_variants?.medium,
              vehicle?.image_variants?.thumbnail,
              primaryFromAllImages,
              imageUrl,
              vehicle.primary_image_url,
              vehicle.image_url,
            ]}
            alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'}
            fill={true}
            objectFit={thumbnailFit}
            placeholderSrc="/n-zero.png"
            placeholderOpacity={0.25}
          />

          {/* LIVE badge (kept separate) */}
          {vehicle.is_streaming && (
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                background: '#ef4444',
                color: 'white',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '7pt',
                fontWeight: 700,
                letterSpacing: '0.5px',
                boxShadow: '0 2px 8px rgba(239, 68, 68, 0.5)',
              }}
            >
              LIVE
            </div>
          )}

          {/* Timer badge (separate, on left side top) - only for ACTIVE auctions */}
          {isActiveAuction && formatAuctionTimer && (
            <div style={{
              position: 'absolute',
              top: vehicle.is_streaming ? '34px' : '8px', // Below LIVE badge if it exists
              left: '8px',
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(6px)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '7pt',
              fontWeight: 700,
              fontFamily: 'monospace',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              border: '1px solid rgba(255,255,255,0.18)',
              zIndex: 5,
            }}>
              {formatAuctionTimer}
            </div>
          )}

          {/* Price/Bid badge (no favicon here) - Show LotBadge for Mecum, otherwise show price */}
          {showPriceOverlay && (mecumLotData || badgeMainText !== '—') && (
            <div 
              style={{ 
                ...badgeStyle, 
                top: '8px', 
                right: '8px',
                cursor: (isSold && shouldShowSoldBadge) ? 'pointer' : 'default',
                transition: (isSold && shouldShowSoldBadge) ? 'all 0.12s ease' : undefined,
              }}
              onClick={(e) => {
                if (isSold && shouldShowSoldBadge) {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowOwnershipPopup(true);
                }
              }}
              onMouseEnter={(e) => {
                if (isSold && shouldShowSoldBadge) {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                }
              }}
              onMouseLeave={(e) => {
                if (isSold && shouldShowSoldBadge) {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = undefined;
                }
              }}
            >
              {mecumLotData ? (
                <LotBadge
                  lotNumber={mecumLotData.lotNumber}
                  date={mecumLotData.date}
                  location={mecumLotData.location}
                  salePrice={mecumLotData.salePrice}
                  estimateLow={mecumLotData.estimateLow}
                  estimateHigh={mecumLotData.estimateHigh}
                  listingUrl={mecumLotData.listingUrl}
                />
              ) : isActiveAuction ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '6.5pt', fontWeight: 800, lineHeight: 1 }}>
                    BID
                  </div>
                  {auctionHighBidText && (
                    <div style={{ fontSize: '9pt', fontWeight: 800, lineHeight: 1 }}>
                      {auctionHighBidText}
                    </div>
                  )}
                  {(() => {
                    const v: any = vehicle as any;
                    // Prioritize bid_count from external_listings (live data), fallback to vehicle
                    const externalBidCount = typeof v?.external_listings?.[0]?.bid_count === 'number' 
                      ? v.external_listings[0].bid_count 
                      : null;
                    const vehicleBidCount = typeof v.bid_count === 'number' && Number.isFinite(v.bid_count) && v.bid_count > 0 
                      ? v.bid_count 
                      : null;
                    const bidCount = externalBidCount ?? vehicleBidCount;
                    return bidCount ? (
                      <div style={{ fontSize: '6pt', fontWeight: 600, opacity: 0.85, lineHeight: 1 }}>
                        {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
                      </div>
                    ) : null;
                  })()}
                </div>
              ) : badgeParts.label ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                  <div
                    style={{
                      fontSize: '6.5pt',
                      fontWeight: 800,
                      lineHeight: 1,
                      color:
                        badgeParts.label === 'SOLD'
                          ? '#10b981'
                          : badgeParts.label === 'RESULT'
                          ? '#f59e0b'
                          : 'rgba(255,255,255,0.92)',
                    }}
                  >
                    {badgeParts.label}
                    </div>
                  {badgeParts.value ? (
                    <div style={{ fontSize: '9pt', fontWeight: 800, lineHeight: 1 }}>
                      {badgeParts.value}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ fontSize: '9pt', fontWeight: 800 }}>
                  {badgeParts.value || badgeMainText}
                </div>
              )}
            </div>
          )}

          {/* Favicon in bottom-left corner (positioned relative to card, above overlay) */}
          {sourceFaviconUrl && (
            <div style={{
              position: 'absolute',
              bottom: showDetailOverlay ? '52px' : '8px', // Above detail overlay if visible
              left: '8px',
              background: 'transparent',
              padding: 0,
              borderRadius: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              border: 'none',
              zIndex: 10,
            }}>
              <FaviconIcon url={sourceFaviconUrl} size={14} preserveAspectRatio={true} />
              {orgFaviconUrl ? <FaviconIcon url={orgFaviconUrl} size={14} preserveAspectRatio={true} /> : null}
            </div>
          )}

          {/* Detail overlay along bottom of image */}
          {showDetailOverlay && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '10px 12px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.45))',
                color: '#fff',
              }}
            >
              {/* Vehicle name */}
              <div
                style={{
                  fontSize: '10pt',
                  fontWeight: 700,
                  lineHeight: 1.2,
                  marginBottom: '4px',
                }}
              >
                {vehicleTitle}
              </div>

              {/* Metadata row - clean by default; infoDense adds extras */}
              <div
                style={{
                  fontSize: '7pt',
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  opacity: 0.9,
                }}
              >
                  {/* Compact odometer badge (optional, infoDense only) */}
                  {infoDense && typeof vehicle.mileage === 'number' && vehicle.mileage > 0 ? (
                    <OdometerBadge
                      mileage={vehicle.mileage}
                      year={vehicle.year ?? null}
                      isExact={true}
                      className=""
                    />
                  ) : null}
                {/* Vehicle Tier - alphabet-based (F, E, D, C, B, A, S, SSS) */}
                {(() => {
                  const tierLabel = normalizeTierLabel(vehicle.tier_label) || normalizeTierLabel(calculateVehicleTier(vehicle));
                  
                  // Color mapping for alphabet tiers
                  const getTierColor = (tier: string) => {
                    switch (tier) {
                      // User-defined core mapping: C=green, F=purple, S=red.
                      case 'SSS': return '#7c3aed'; // purple variant
                      case 'SS': return '#8b5cf6';
                      case 'S': return '#ef4444'; // red
                      case 'A': return '#f59e0b'; // warm
                      case 'B': return '#3b82f6'; // blue
                      case 'C': return '#10b981'; // green
                      case 'D': return '#6b7280'; // gray
                      case 'E': return '#9ca3af'; // light gray
                      case 'F': return '#a855f7'; // purple
                      default: return '#6b7280';
                    }
                  };
                  
                  if (tierLabel) {
                    return (
                      <span style={{ fontWeight: 700 }}>
                        <span style={{ color: getTierColor(tierLabel), fontWeight: 800 }}>
                          {tierLabel}
                        </span>{' '}
                        tier
                      </span>
                    );
                  }
                  return null;
                })()}

                {infoDense && vehicle.uploader_name && (
                  <span style={{ fontWeight: 600 }}>{vehicle.uploader_name}</span>
                )}

                {infoDense && vehicle.view_count !== undefined && vehicle.view_count > 0 && (
                  <span>{vehicle.view_count.toLocaleString()} {vehicle.view_count === 1 ? 'view' : 'views'}</span>
                )}

                {infoDense && typeof vehicle.active_viewers === 'number' && vehicle.active_viewers > 0 && (
                  <span>{vehicle.active_viewers.toLocaleString()} watching</span>
                )}

                {infoDense && vehicle.condition_rating && (
                  <span
                      style={{
                        fontWeight: 700,
                        color:
                          vehicle.condition_rating >= 8
                            ? '#10b981'
                            : vehicle.condition_rating >= 6
                            ? '#f59e0b'
                            : '#ef4444',
                      }}
                    >
                      Grade{' '}
                      {vehicle.condition_rating >= 9
                        ? 'A+'
                        : vehicle.condition_rating >= 8
                        ? 'A'
                        : vehicle.condition_rating >= 7
                        ? 'B+'
                        : vehicle.condition_rating >= 6
                        ? 'B'
                        : vehicle.condition_rating >= 5
                        ? 'C'
                        : 'D'}
                  </span>
                )}

                {infoDense && vehicle.hype_reason && <span>{vehicle.hype_reason}</span>}
              </div>
            </div>
          )}

          {/* Active viewers - small pill above overlay */}
          {typeof vehicle.active_viewers === 'number' && vehicle.active_viewers > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                background: 'rgba(0, 0, 0, 0.75)',
                color: 'white',
                padding: '3px 8px',
                borderRadius: '12px',
                fontSize: '7pt',
                fontWeight: 600,
              }}
            >
              {vehicle.active_viewers} watching
            </div>
          )}

          {/* Ownership Details Popup */}
          {showOwnershipPopup && (
            <OwnershipDetailsPopup
              vehicleId={vehicle.id}
              isOpen={showOwnershipPopup}
              onClose={() => setShowOwnershipPopup(false)}
              salePrice={(() => {
                const v: any = vehicle as any;
                return v.sale_price || v.external_listings?.[0]?.final_price || null;
              })()}
              saleDate={(() => {
                const v: any = vehicle as any;
                return v.sale_date || v.external_listings?.[0]?.sold_at || null;
              })()}
            />
          )}
        </div>
      </Link>
    );
  }

  // GRID VIEW: Mobile-optimized card with horizontal swipeable image carousel
  // Shows multiple images in a grid that user can swipe through
  
  // Fetch images from database if not available in vehicle prop
  const { primaryImage: dbPrimaryImage, images: dbImages, loading: dbImagesLoading } = useVehicleImages(vehicle.id);
  
  // Helper functions
  const isLikelyImageUrl = React.useCallback((url: string) => {
    const u = String(url || '').trim();
    if (!u) return false;
    // Filter obvious non-image URLs that sometimes sneak in via metadata/link scraping.
    if (u.includes('linkedin.com/shareArticle')) return false;
    if (u.includes('shareArticle?mini=true')) return false;
    if (u.startsWith('https://') || u.startsWith('http://') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('/')) return true;
    return false;
  }, []);
  
  // Helper to extract URLs from image data objects
  const extractImageUrls = React.useCallback((imgData: any): string[] => {
    if (!imgData) return [];
    const urls: string[] = [];
    if (imgData.variants?.thumbnail) urls.push(imgData.variants.thumbnail);
    if (imgData.variants?.medium) urls.push(imgData.variants.medium);
    if (imgData.variants?.large) urls.push(imgData.variants.large);
    if (imgData.image_url) urls.push(imgData.image_url);
    if (imgData.thumbnail_url) urls.push(imgData.thumbnail_url);
    if (imgData.medium_url) urls.push(imgData.medium_url);
    if (imgData.large_url) urls.push(imgData.large_url);
    return urls.filter(u => u && isLikelyImageUrl(u));
  }, [isLikelyImageUrl]);

  // Prefer a single URL per image record for carousel display.
  // Otherwise we end up with the same photo repeated (thumbnail + medium + large + full).
  const pickCarouselUrl = React.useCallback((imgData: any): string | null => {
    if (!imgData) return null;

    const candidates = [
      imgData?.variants?.thumbnail,
      imgData?.variants?.medium,
      imgData?.variants?.large,
      imgData?.thumbnail_url,
      imgData?.medium_url,
      imgData?.large_url,
      imgData?.image_url,
    ];

    for (const c of candidates) {
      const u = c ? String(c) : '';
      if (u && isLikelyImageUrl(u)) return u;
    }

    return null;
  }, [isLikelyImageUrl]);
  
  // Build vehicle images array reactively - recalculates when hook data changes
  const vehicleImages = React.useMemo(() => {
    const images: string[] = [];
    
    // Prefer exactly ONE variant from homepage-precomputed `image_variants`.
    // This avoids showing duplicate slides for the same photo (thumbnail + medium).
    if (vehicle.image_variants) {
      const chosen =
        (vehicle.image_variants.thumbnail && isLikelyImageUrl(vehicle.image_variants.thumbnail))
          ? vehicle.image_variants.thumbnail
          : (vehicle.image_variants.medium && isLikelyImageUrl(vehicle.image_variants.medium))
            ? vehicle.image_variants.medium
            : (vehicle.image_variants.large && isLikelyImageUrl(vehicle.image_variants.large))
              ? vehicle.image_variants.large
              : null;
      if (chosen) images.push(chosen);
    }
    
    // Use all_images array as fallback (already contains optimized URLs from homepage)
    if (vehicle.all_images && vehicle.all_images.length > 0) {
      const urls = vehicle.all_images
        .map(img => img.url || (img as any).thumbnail_url || (img as any).medium_url)
        .filter((u) => !!u && isLikelyImageUrl(String(u)));
      urls.forEach(url => {
        if (!images.includes(url)) images.push(url);
      });
    }
    
    // Add primary database image as a single carousel entry
    // (variants remain available as fallbacks in ResilientImage.sources)
    if (dbPrimaryImage) {
      const chosen = pickCarouselUrl(dbPrimaryImage);
      if (chosen && !images.includes(chosen)) images.push(chosen);
    }
    
    // Add other database images (one entry per image record)
    if (dbImages && dbImages.length > 0) {
      dbImages.forEach(img => {
        const chosen = pickCarouselUrl(img);
        if (chosen && !images.includes(chosen)) images.push(chosen);
      });
    }
    
    // Fallback to primary_image_url (prefer medium/thumbnail if available)
    if (vehicle.primary_image_url && isLikelyImageUrl(vehicle.primary_image_url) && !images.includes(vehicle.primary_image_url)) {
      images.push(vehicle.primary_image_url);
    }
    
    // Last resort: image_url
    if (vehicle.image_url && isLikelyImageUrl(vehicle.image_url) && !images.includes(vehicle.image_url)) {
      images.push(vehicle.image_url);
    }
    
    return images;
  }, [vehicle.image_variants, vehicle.all_images, vehicle.primary_image_url, vehicle.image_url, dbPrimaryImage, dbImages, isLikelyImageUrl, pickCarouselUrl]);
  
  // Get current image URL (prefer thumbnail/medium for grid) - reactive to vehicleImages changes
  const currentImageUrl = React.useMemo(() => {
    const url = vehicleImages[currentImageIndex] || vehicleImages[0] || null;
    if (url) return url;
    // CRITICAL FIX: If still no URL, check imageUrl from getImageUrl() as last resort
    return imageUrl && isLikelyImageUrl(imageUrl) ? imageUrl : null;
  }, [vehicleImages, currentImageIndex, imageUrl, isLikelyImageUrl]);

  const hasValidImage = React.useMemo(() => {
    return !!(currentImageUrl && isLikelyImageUrl(currentImageUrl));
  }, [currentImageUrl, isLikelyImageUrl]);
  
  
  
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    
    if (Math.abs(diff) > 50) {
      e.preventDefault();
      e.stopPropagation();
      
      if (diff > 0 && currentImageIndex < vehicleImages.length - 1) {
        setCurrentImageIndex(currentImageIndex + 1);
      } else if (diff < 0 && currentImageIndex > 0) {
        setCurrentImageIndex(currentImageIndex - 1);
      }
    }
  };
  
  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{
        display: 'block',
        background: 'transparent',
        border: 'none',
        borderRadius: '0',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
        cursor: 'pointer',
        position: 'relative',
        // Huge perf win on large grids: let the browser skip offscreen card rendering.
        contentVisibility: 'auto',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '0.85';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
    >
      {/* Horizontal swipeable image grid (1:1 ratio) */}
      <div
        style={{
          width: '100%',
          paddingBottom: '100%',
          backgroundColor: 'var(--bg)', // Fallback background
          position: 'relative',
          overflow: 'hidden',
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {(hasValidImage || vehicleImages.length > 0 || dbImagesLoading) && (
          <ResilientImage
            sources={[
              ...vehicleImages, // All available images for carousel (includes DB images, reactive)
              // Additional fallbacks
              vehicle?.image_variants?.thumbnail,
              vehicle?.image_variants?.medium,
              vehicle?.image_variants?.large,
              primaryFromAllImages,
              imageUrl,
              vehicle.primary_image_url,
              vehicle.image_url,
              // Database images as explicit fallbacks (reactive)
              ...(dbPrimaryImage ? extractImageUrls(dbPrimaryImage) : []),
              ...(dbImages || []).flatMap(img => extractImageUrls(img)),
            ]}
            alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'}
            fill={true}
            objectFit={thumbnailFit}
            // Grid cards use the "padding-bottom: 100%" square pattern (height is auto).
            // `ResilientImage` fill mode previously used a wrapper with `height: 100%`,
            // which collapses when the parent height isn't definite. Force absolute fill.
            style={{ position: 'absolute', inset: 0 }}
            placeholderSrc="/n-zero.png"
            placeholderOpacity={0.25}
          />
        )}
        {!hasValidImage && !dbImagesLoading && vehicleImages.length === 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '9pt',
              background: 'var(--grey-100)',
              border: '1px dashed var(--border)'
            }}
          >
            No Image
          </div>
        )}
        {/* LIVE badge (kept separate) */}
        {vehicle.is_streaming && (
          <div style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            background: '#ef4444',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '3px',
            fontSize: '7pt',
            fontWeight: 700,
            letterSpacing: '0.5px',
            animation: 'pulse 2s ease-in-out infinite'
          }}>
            LIVE
          </div>
        )}

        {/* Timer badge (separate, on left side top) - only for ACTIVE auctions */}
        {isActiveAuction && formatAuctionTimer && (
          <div style={{
            position: 'absolute',
            top: vehicle.is_streaming ? '28px' : '6px', // Below LIVE badge if it exists
            left: '6px',
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '6px',
            fontSize: '6.5pt',
            fontWeight: 700,
            fontFamily: 'monospace',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            border: '1px solid rgba(255,255,255,0.18)',
            zIndex: 5,
          }}>
            {formatAuctionTimer}
          </div>
        )}

        {/* Top-right overlay stack (prevents Follow overlapping price) */}
        {(showPriceOverlay && (mecumLotData || badgeMainText !== '—')) || showFollowButton ? (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '6px',
              zIndex: 12,
              maxWidth: '85%',
            }}
          >
            {/* Price/Bid badge (Show LotBadge for Mecum, otherwise show price) */}
            {showPriceOverlay && (mecumLotData || badgeMainText !== '—') && (
              <div 
                style={{
                  ...badgeStyle,
                  // Un-absolute when inside the stack
                  position: 'relative',
                  top: undefined,
                  right: undefined,
                  maxWidth: '100%',
                  cursor: (isSold && shouldShowSoldBadge) ? 'pointer' : 'default',
                  transition: (isSold && shouldShowSoldBadge) ? 'all 0.12s ease' : undefined,
                }}
                onClick={(e) => {
                  // Make clickable if sold and within display window
                  if (isSold && shouldShowSoldBadge) {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowOwnershipPopup(true);
                  }
                }}
                onMouseEnter={(e) => {
                  if (isSold && shouldShowSoldBadge) {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (isSold && shouldShowSoldBadge) {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = undefined;
                  }
                }}
              >
                {mecumLotData ? (
                  <LotBadge
                    lotNumber={mecumLotData.lotNumber}
                    date={mecumLotData.date}
                    location={mecumLotData.location}
                    salePrice={mecumLotData.salePrice}
                    estimateLow={mecumLotData.estimateLow}
                    estimateHigh={mecumLotData.estimateHigh}
                    listingUrl={mecumLotData.listingUrl}
                  />
                ) : isCompactCard ? (
                  // Compact mode: single-line badge (border color already encodes SOLD/RESULT).
                  <div style={{ fontSize: gridTypography.badge, fontWeight: 900, lineHeight: 1 }}>
                    {(() => {
                      if (isActiveAuction) return auctionHighBidText || 'BID';
                      if (badgeParts.value) return badgeParts.value;
                      if (badgeParts.label) return badgeParts.label;
                      return badgeMainText;
                    })()}
                  </div>
                ) : isActiveAuction ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: '6.5pt', fontWeight: 800, lineHeight: 1 }}>
                      BID
                    </div>
                    {auctionHighBidText && (
                      <div style={{ fontSize: gridTypography.badge, fontWeight: 800, lineHeight: 1 }}>
                        {auctionHighBidText}
                      </div>
                    )}
                    {(() => {
                      const v: any = vehicle as any;
                      // Prioritize bid_count from external_listings (live data), fallback to vehicle
                      const externalBidCount = typeof v?.external_listings?.[0]?.bid_count === 'number' 
                        ? v.external_listings[0].bid_count 
                        : null;
                      const vehicleBidCount = typeof v.bid_count === 'number' && Number.isFinite(v.bid_count) && v.bid_count > 0 
                        ? v.bid_count 
                        : null;
                      const bidCount = externalBidCount ?? vehicleBidCount;
                      return bidCount ? (
                        <div style={{ fontSize: '5.5pt', fontWeight: 600, opacity: 0.85, lineHeight: 1 }}>
                          {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
                        </div>
                      ) : null;
                    })()}
                  </div>
                ) : badgeParts.label ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                    <div
                      style={{
                        fontSize: '6.5pt',
                        fontWeight: 800,
                        lineHeight: 1,
                        color:
                          badgeParts.label === 'SOLD'
                            ? '#10b981'
                            : badgeParts.label === 'RESULT'
                            ? '#f59e0b'
                            : 'rgba(255,255,255,0.92)',
                      }}
                    >
                      {badgeParts.label}
                    </div>
                    {badgeParts.value ? (
                      <div style={{ fontSize: gridTypography.badge, fontWeight: 800, lineHeight: 1 }}>
                        {badgeParts.value}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ fontSize: gridTypography.badge, fontWeight: 800 }}>
                    {badgeParts.value || badgeMainText}
                  </div>
                )}
              </div>
            )}

            {/* Follow Button with ROI (compact at small card sizes) */}
            {showFollowButton && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFollow();
                }}
                disabled={followLoading}
                style={{
                  background: isFollowing 
                    ? 'rgba(59, 130, 246, 0.9)' 
                    : 'rgba(0, 0, 0, 0.7)',
                  backdropFilter: 'blur(4px)',
                  border: isFollowing 
                    ? '1px solid rgba(59, 130, 246, 0.5)' 
                    : '1px solid rgba(255,255,255,0.2)',
                  color: 'white',
                  padding: isCompactCard ? '0' : '4px 8px',
                  width: isCompactCard ? '22px' : undefined,
                  height: isCompactCard ? '22px' : undefined,
                  borderRadius: isCompactCard ? '999px' : '4px',
                  fontSize: isCompactCard ? '10pt' : '7pt',
                  fontWeight: 700,
                  cursor: followLoading ? 'wait' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  if (!followLoading) {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                title={
                  isFollowing && followROI
                    ? `Following since ${followROI.days_following} days ago. If you invested $${followROI.price_at_follow?.toLocaleString()} when you started following, you'd have ${followROI.hypothetical_roi_pct && followROI.hypothetical_roi_pct > 0 ? '+' : ''}${followROI.hypothetical_roi_pct?.toFixed(1)}% return (${followROI.hypothetical_gain && followROI.hypothetical_gain > 0 ? '+' : ''}$${followROI.hypothetical_gain?.toLocaleString()})`
                    : 'Follow this vehicle to track hypothetical ROI'
                }
              >
                {followLoading ? (
                  '...'
                ) : isFollowing ? (
                  <>
                    {isCompactCard ? (
                      '★'
                    ) : followROI && followROI.hypothetical_roi_pct !== null ? (
                      <span style={{
                        color: followROI.hypothetical_roi_pct > 0 ? '#10b981' : followROI.hypothetical_roi_pct < 0 ? '#ef4444' : 'inherit',
                        fontWeight: 800,
                      }}>
                        {followROI.hypothetical_roi_pct > 0 ? '+' : ''}{followROI.hypothetical_roi_pct.toFixed(1)}%
                      </span>
                    ) : (
                      'Following'
                    )}
                  </>
                ) : (
                  isCompactCard ? '☆' : 'Follow'
                )}
              </button>
            )}
          </div>
        ) : null}

      </div>

      {/* Favicon in top-left corner (hide on tiniest cards; it turns into noise) */}
      {sourceFaviconUrl && cardTier !== 'xs' && (
        <div style={{
          position: 'absolute',
          top: '6px',
          left: '6px',
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          padding: '3px 5px',
          borderRadius: '4px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          border: '1px solid rgba(255,255,255,0.15)',
          zIndex: 10,
        }}>
          <FaviconIcon url={sourceFaviconUrl} size={12} preserveAspectRatio={true} />
          {orgFaviconUrl ? <FaviconIcon url={orgFaviconUrl} size={12} preserveAspectRatio={true} /> : null}
        </div>
      )}

      {/* Follow button is rendered in the image overlay stack (top-right). */}
      
      {/* Detail overlay on image instead of separate panel (progressive disclosure by card size) */}
      {showDetailOverlay && cardTier !== 'xs' && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.4))',
            color: '#fff',
          }}
        >
          {/* Vehicle name - with truncation */}
          <div
            style={{
              fontSize: gridTypography.title,
              fontWeight: 700,
              lineHeight: 1.1,
              marginBottom: '4px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}
            title={vehicleTitle}
          >
            {identity.primary.map((t, idx) => (
              <span
                key={`p-${t.kind}-${idx}`}
                title={t.kind.toUpperCase()}
                onMouseEnter={() => logIdentityToken(t.kind, t.value, idx)}
                style={{ cursor: viewerUserId ? 'help' : 'default' }}
              >
                {idx === 0 ? t.value : ` ${t.value}`}
              </span>
            ))}
            {/* Hide differentiators on small cards; they become illegible noise. */}
            {cardTier === 'lg' && identity.differentiators.length > 0 ? (
              <span>
                {' '}
                {identity.differentiators.slice(0, 2).map((t, j) => (
                  <span
                    key={`d-${t.kind}-${j}`}
                    title={t.kind.toUpperCase()}
                    onMouseEnter={() => logIdentityToken(t.kind, t.value, identity.primary.length + j)}
                    style={{ cursor: viewerUserId ? 'help' : 'default' }}
                  >
                    {`• ${t.value} `}
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          {/* Metadata row - clean by default; infoDense adds extras */}
          {cardTier === 'lg' ? (
          <div
            style={{
              fontSize: gridTypography.meta,
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              alignItems: 'center',
              opacity: 0.9,
            }}
          >
            {/* Vehicle Tier - alphabet-based (F, E, D, C, B, A, S, SSS) */}
            {(() => {
              const tierLabel = normalizeTierLabel(vehicle.tier_label) || normalizeTierLabel(calculateVehicleTier(vehicle));
              
              // Color mapping for alphabet tiers
              const getTierColor = (tier: string) => {
                switch (tier) {
                  case 'SSS': return '#7c3aed';
                  case 'SS': return '#8b5cf6';
                  case 'S': return '#ef4444';
                  case 'A': return '#f59e0b';
                  case 'B': return '#3b82f6';
                  case 'C': return '#10b981';
                  case 'D': return '#6b7280';
                  case 'E': return '#9ca3af';
                  case 'F': return '#a855f7';
                  default: return '#6b7280';
                }
              };
              
              if (tierLabel) {
                return (
                  <span style={{ fontWeight: 700 }}>
                    <span style={{ color: getTierColor(tierLabel), fontWeight: 800 }}>{tierLabel}</span> tier
                  </span>
                );
              }
              return null;
            })()}

            {infoDense && vehicle.uploader_name && <span style={{ fontWeight: 500 }}>{vehicle.uploader_name}</span>}

            {infoDense && vehicle.view_count !== undefined && vehicle.view_count > 0 && (
              <span>{vehicle.view_count.toLocaleString()} {vehicle.view_count === 1 ? 'view' : 'views'}</span>
            )}

            {infoDense && typeof vehicle.active_viewers === 'number' && vehicle.active_viewers > 0 && (
              <span>{vehicle.active_viewers.toLocaleString()} watching</span>
            )}

            {infoDense && vehicle.condition_rating && (
              <span
                style={{
                  fontWeight: 700,
                  color:
                    vehicle.condition_rating >= 8
                      ? '#10b981'
                      : vehicle.condition_rating >= 6
                      ? '#f59e0b'
                      : '#ef4444',
                }}
              >
                {vehicle.condition_rating >= 9
                  ? 'A+'
                  : vehicle.condition_rating >= 8
                  ? 'A'
                  : vehicle.condition_rating >= 7
                  ? 'B+'
                  : vehicle.condition_rating >= 6
                  ? 'B'
                  : vehicle.condition_rating >= 5
                  ? 'C'
                  : 'D'}
              </span>
            )}
          </div>
          ) : null}
        </div>
      )}

      {/* Card Body Below Image - Investment-Relevant Info */}
      {/* Only show card body when overlay is disabled (original grid view behavior) */}
      {viewMode === 'grid' && !showDetailOverlay && (
        <div style={{
          padding: '8px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          height: '88px', // Fixed height to prevent size variation
          overflow: 'hidden' // Prevent content from expanding beyond fixed height
        }}>
          {/* Title - with better truncation for square cards */}
          <div style={{
            fontSize: '10pt',
            fontWeight: 700,
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}>
            {vehicleTitle}
          </div>

          {/* Key feature tokens (BaT-title-style): transmission / engine / trim / config / type */}
          {(() => {
            const v: any = vehicle as any;
            const tokens: Array<{
              kind: 'transmission' | 'engine' | 'trim' | 'config' | 'type';
              label: string;
              raw: any;
              clickable: boolean;
            }> = [];

            const transmissionRaw = (v?.transmission_model || v?.transmission || '').toString().trim();
            if (transmissionRaw) {
              const def = getTransmissionDefinition(transmissionRaw);
              // Shorten transmission labels more aggressively
              const label = def?.label || transmissionRaw;
              tokens.push({
                kind: 'transmission',
                label: label.length > 12 ? `${label.slice(0, 12)}…` : label,
                raw: transmissionRaw,
                clickable: true,
              });
            }

            const engineRaw = (v?.engine || v?.engine_size || '').toString().trim();
            if (engineRaw) {
              const def = getEngineDefinition(engineRaw);
              // Shorten engine labels more aggressively
              const label = def?.label || engineRaw;
              tokens.push({
                kind: 'engine',
                label: label.length > 12 ? `${label.slice(0, 12)}…` : label,
                raw: engineRaw,
                clickable: true,
              });
            }

            const trimRaw = (v?.trim || v?.series || '').toString().trim();
            if (trimRaw) {
              tokens.push({
                kind: 'trim',
                label: trimRaw.length > 14 ? `${trimRaw.slice(0, 14)}…` : trimRaw,
                raw: trimRaw,
                clickable: false,
              });
            }

            const drivetrainRaw = (v?.drivetrain || '').toString().trim();
            const drive = drivetrainRaw.toLowerCase();
            // Keep the token row niche-first: only show drivetrain/config when it is high-signal.
            // (Trucks/SUVs: 4x4/AWD is meaningful; cars: RWD/FWD usually isn’t.)
            const configLabel =
              (drive.includes('4x4') || drive.includes('4wd')) ? '4x4' :
              (drive.includes('awd') ? 'AWD' : '');
            if (configLabel) tokens.push({ kind: 'config', label: configLabel, raw: configLabel, clickable: false });

            const bodyStyleRaw = (v?.canonical_body_style || v?.body_style || '').toString().trim();
            if (bodyStyleRaw) {
              const display = getBodyStyleDisplay(bodyStyleRaw) || bodyStyleRaw;
              tokens.push({
                kind: 'type',
                label: display.length > 12 ? `${display.slice(0, 12)}…` : display,
                raw: display,
                clickable: true,
              });
            }

            // Cap visible tokens to keep the card clean - limit to 3 for better fit
            const visible = tokens.filter(t => t.label).slice(0, 3);
            if (visible.length === 0) return null;

            const tokenStyleBase: React.CSSProperties = {
              display: 'inline-flex',
              alignItems: 'center',
              height: 18,
              padding: '0 5px', // Reduced padding for more compact badges
              borderRadius: 3,
              border: '1px solid var(--border)',
              background: 'var(--grey-50)',
              color: 'var(--text)',
              fontSize: '6.5pt', // Slightly smaller font
              fontWeight: 700,
              lineHeight: 1,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            };

            return (
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '4px', // Reduced gap for tighter layout
                alignItems: 'center',
                overflow: 'hidden' // Prevent wrapping from expanding height
              }}>
                {visible.map((t, idx) => {
                  const isClickable = t.clickable && (t.kind === 'engine' || t.kind === 'transmission' || t.kind === 'type');
                  const tokenKey = `${t.kind}-${idx}-${t.label}`;
                  const commonProps = {
                    title: t.raw ? String(t.raw) : t.label,
                    style: {
                      ...tokenStyleBase,
                      cursor: isClickable ? 'pointer' : 'default',
                      background: isClickable ? 'var(--surface)' : 'var(--grey-50)',
                    } as React.CSSProperties,
                  };

                  if (!isClickable) {
                    return <span key={tokenKey} {...commonProps}>{t.label}</span>;
                  }

                  return (
                    <button
                      key={tokenKey}
                      type="button"
                      {...commonProps}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openSpecPopover(e, (t.kind === 'type' ? 'body_style' : (t.kind as any)), t.raw);
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Definition popover (engine/transmission/body style) */}
      {specPopover && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 10000,
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            closeSpecPopover();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              ...(specPopoverStyle || {
                position: 'fixed',
                left: specPopover.position.x,
                top: specPopover.position.y,
                transform: 'translate(-50%, 12px)',
              }),
              width: 'min(360px, calc(100vw - 24px))',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: '2px 2px 10px rgba(0,0,0,0.25)',
              padding: '10px',
              borderRadius: 6,
              color: 'var(--text)',
            }}
            ref={specPopoverRef}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 800 }}>
                  {specPopover.def.kind === 'engine'
                    ? 'ENGINE'
                    : specPopover.def.kind === 'transmission'
                      ? 'TRANSMISSION'
                      : 'BODY STYLE'}
                </div>
                <div style={{ fontSize: '10pt', fontWeight: 800, lineHeight: 1.1 }}>
                  {specPopover.def.title}
                </div>
              </div>
              <button
                type="button"
                className="button-win95"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSpecPopover();
                }}
                style={{ height: 22, padding: '0 8px', fontSize: '8pt' }}
              >
                CLOSE
              </button>
            </div>

            <div style={{ marginTop: '8px', fontSize: '9pt', lineHeight: 1.25 }}>
              {specPopover.def.summary}
            </div>

            {Array.isArray(specPopover.def.details) && specPopover.def.details.length > 0 && (
              <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: '8.5pt', lineHeight: 1.25 }}>
                {specPopover.def.details.slice(0, 6).map((d, i) => (
                  <li key={i} style={{ marginBottom: '4px' }}>{d}</li>
                ))}
              </ul>
            )}

            {/* Evidence thumbnails (AI-tagged photos) */}
            {(specPopover.def.kind === 'engine' || specPopover.def.kind === 'transmission') && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 800, letterSpacing: '0.4px' }}>
                    EVIDENCE
                  </div>
                  {!specEvidence.loading && specEvidence.images.length > 0 && (
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      {specEvidence.images.length} photos
                    </div>
                  )}
                </div>

                {specEvidence.loading ? (
                  <div style={{ marginTop: '6px', fontSize: '8pt', color: 'var(--text-muted)' }}>
                    Loading…
                  </div>
                ) : specEvidence.images.length > 0 ? (
                  <div style={{ marginTop: '6px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
                    {specEvidence.images.map((img) => {
                      const sources = [
                        img?.variants?.thumbnail,
                        img?.thumbnail_url,
                        img?.variants?.medium,
                        img?.medium_url,
                        img?.image_url,
                      ].filter(Boolean);

                      const titleParts = [
                        img?.ai_detected_angle ? `AI angle: ${img.ai_detected_angle}` : null,
                        img?.category ? `Category: ${img.category}` : null,
                        img?.caption ? `Caption: ${img.caption}` : null,
                      ].filter(Boolean);

                      return (
                        <button
                          key={img.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (img.image_url) {
                              window.open(img.image_url, '_blank', 'noopener,noreferrer');
                            }
                          }}
                          title={titleParts.join('\n') || 'Open image'}
                          style={{
                            border: '1px solid var(--border)',
                            background: 'var(--grey-50)',
                            padding: 0,
                            borderRadius: 4,
                            overflow: 'hidden',
                            cursor: img.image_url ? 'pointer' : 'default',
                          }}
                        >
                          <div style={{ width: '100%', paddingBottom: '100%', position: 'relative', background: 'var(--grey-200)' }}>
                            <ResilientImage
                              sources={sources}
                              alt="Evidence image"
                              fill={true}
                              objectFit="cover"
                              placeholderSrc="/n-zero.png"
                              placeholderOpacity={0.15}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ marginTop: '6px', fontSize: '8pt', color: 'var(--text-muted)' }}>
                    No AI-tagged {specPopover.def.kind === 'transmission' ? 'transmission' : 'engine'} photos yet.
                  </div>
                )}
              </div>
            )}

            {!specPopover.def.known && (
              <div style={{ marginTop: '8px', fontSize: '8pt', color: 'var(--text-muted)' }}>
                Unmapped token. We’ll promote it to canon once it’s seen consistently (and ideally backed by sources/photos).
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ownership Details Popup */}
      {showOwnershipPopup && (
        <OwnershipDetailsPopup
          vehicleId={vehicle.id}
          isOpen={showOwnershipPopup}
          onClose={() => setShowOwnershipPopup(false)}
          salePrice={(() => {
            const v: any = vehicle as any;
            return v.sale_price || v.external_listings?.[0]?.final_price || null;
          })()}
          saleDate={(() => {
            const v: any = vehicle as any;
            return v.sale_date || v.external_listings?.[0]?.sold_at || null;
          })()}
        />
      )}
    </Link>
  );
};

export default VehicleCardDense;

