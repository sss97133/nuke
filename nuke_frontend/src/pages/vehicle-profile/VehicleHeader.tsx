import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { VehicleHeaderProps } from './types';
import { computePrimaryPrice, formatCurrency as formatUsdCurrency } from '../../services/priceSignalService';
import { formatCurrencyAmount, resolveCurrencyCode } from '../../utils/currency';
import { supabase } from '../../lib/supabase';
// Deprecated modals (history/analysis/tag review) intentionally removed from UI
import { VehicleValuationService } from '../../services/vehicleValuationService';
import TradePanel from '../../components/trading/TradePanel';
import { VehicleDeduplicationService } from '../../services/vehicleDeduplicationService';
import { ValueProvenancePopup } from '../../components/ValueProvenancePopup';
import DataValidationPopup from '../../components/vehicle/DataValidationPopup';
import { useVINProofs } from '../../hooks/useVINProofs';
import { FaviconIcon } from '../../components/common/FaviconIcon';
import { AuctionPlatformBadge } from '../../components/auction/AuctionBadges';
import { OdometerBadge } from '../../components/vehicle/OdometerBadge';
import MemeDropBadge from '../../components/vehicle/MemeDropBadge';
import vinDecoderService from '../../services/vinDecoder';
import UpdateSalePriceModal from '../../components/vehicle/UpdateSalePriceModal';
import { FollowAuctionCard } from '../../components/auction/FollowAuctionCard';
import OrganizationInvestmentCard from '../../components/organization/OrganizationInvestmentCard';
import { CircularAvatar } from '../../components/common/CircularAvatar';

const RELATIONSHIP_LABELS: Record<string, string> = {
  owner: 'Owner',
  consigner: 'Consignment',
  collaborator: 'Collaborator',
  service_provider: 'Service',
  work_location: 'Work site',
  seller: 'Seller',
  buyer: 'Buyer',
  parts_supplier: 'Parts',
  fabricator: 'Fabricator',
  painter: 'Paint',
  upholstery: 'Upholstery',
  transport: 'Transport',
  storage: 'Storage',
  inspector: 'Inspector'
};

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

const formatLivePlatformLabel = (provider?: string | null, platform?: string | null) => {
  if (provider === 'mux') return 'Nuke Live';
  if (!platform) return 'Live';
  if (platform === 'twitch') return 'Twitch';
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'custom') return 'Live';
  return platform;
};

const normalizePartyHandle = (raw?: string | null): string | null => {
  const h = String(raw || '').trim();
  if (!h) return null;
  const normalized = h
    .replace(/^@/, '')
    .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
    .replace(/^https?:\/\/carsandbids\.com\/u\//i, '')
    .replace(/^https?:\/\/www\.hagerty\.com\/marketplace\/profile\//i, '')
    .replace(/^https?:\/\/pcarmarket\.com\/member\//i, '')
    .replace(/\/+$/, '')
    .trim();
  return normalized || null;
};

const toTitleCase = (input: string) =>
  input
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatAuctionHouseLabel = (platform?: string | null, host?: string | null, source?: string | null) => {
  const raw = String(platform || source || host || '').trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.com$/, '')
    .replace(/\s+/g, '_');
  const map: Record<string, string> = {
    bat: 'Bring a Trailer',
    bringatrailer: 'Bring a Trailer',
    bring_a_trailer: 'Bring a Trailer',
    carsandbids: 'Cars & Bids',
    cars_and_bids: 'Cars & Bids',
    hagerty: 'Hagerty Marketplace',
    hagerty_marketplace: 'Hagerty Marketplace',
    pcarmarket: 'PCarMarket',
    mecum: 'Mecum',
    barrett_jackson: 'Barrett-Jackson',
    barrettjackson: 'Barrett-Jackson',
    rm_sothebys: "RM Sotheby's",
    rmsothebys: "RM Sotheby's",
    collecting_cars: 'Collecting Cars',
    collectingcars: 'Collecting Cars',
    sbxcars: 'SBX Cars',
    broadarrow: 'Broad Arrow',
    broad_arrow: 'Broad Arrow',
    ebay_motors: 'eBay Motors',
    ebay: 'eBay Motors',
    facebook_marketplace: 'Facebook Marketplace',
    facebook: 'Facebook Marketplace',
    hemmings: 'Hemmings',
    autotrader: 'AutoTrader',
    classic: 'Classic.com',
    classic_com: 'Classic.com',
  };
  if (map[normalized]) return map[normalized];
  return toTitleCase(normalized.replace(/[_-]+/g, ' '));
};

// Classified platforms are not auctions - they have sellers, not consigners
const isClassifiedPlatform = (platform?: string | null) => {
  const normalized = String(platform || '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  const classifiedPlatforms = [
    'facebookmarketplace', 'facebook',
    'craigslist',
    'autotrader',
    'carscom', 'cars',
    'carfax',
    'carsdirect',
    'truecar',
    'ksl',
    'offerup',
  ];
  return classifiedPlatforms.some(p => normalized.includes(p));
};

const normalizeBusinessType = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
};

const isIntermediaryBusinessType = (value?: string | null) => {
  const normalized = normalizeBusinessType(value);
  if (!normalized) return false;
  return (
    normalized.includes('auction') ||
    normalized.includes('platform') ||
    normalized.includes('marketplace') ||
    normalized.includes('broker') ||
    normalized.includes('aggregator')
  );
};

const roleLabelFromBusinessType = (value?: string | null) => {
  const normalized = normalizeBusinessType(value);
  if (!normalized) return null;
  if (normalized === 'auction_house' || normalized.includes('auction')) return 'Auction platform';
  if (normalized === 'dealer' || normalized === 'dealership' || normalized === 'classic_car_dealer' || normalized === 'dealer_group') return 'Dealer';
  if (normalized.includes('broker')) return 'Broker';
  if (normalized.includes('marketplace') || normalized.includes('platform') || normalized.includes('aggregator')) return 'Marketplace';
  return null;
};

const formatSellerRoleLabel = (relationship?: string | null, businessType?: string | null) => {
  const fromBusiness = roleLabelFromBusinessType(businessType);
  if (fromBusiness) return fromBusiness;
  const rel = String(relationship || '').toLowerCase();
  if (rel === 'consigner') return 'Consigner';
  if (rel === 'sold_by' || rel === 'seller') return 'Seller';
  return rel ? toTitleCase(rel.replace(/[_-]+/g, ' ')) : 'Seller';
};

const VehicleHeader: React.FC<VehicleHeaderProps> = ({
  vehicle,
  isOwner,
  canEdit,
  session,
  permissions,
  responsibleName,
  onPriceClick,
  initialValuation,
  initialPriceSignal,
  organizationLinks = [],
  onClaimClick,
  userOwnershipClaim,
  suppressExternalListing = false,
  leadImageUrl = null,
  liveSession = null,
  auctionPulse = null
}) => {
  const navigate = useNavigate();
  const { isVerifiedOwner, contributorRole } = permissions || {};
  const isVerified = isVerifiedOwner || isOwner;
  const hasClaim = !!userOwnershipClaim;
  const claimHasTitle = !!userOwnershipClaim?.title_document_url && userOwnershipClaim?.title_document_url !== 'pending';
  const claimHasId = !!userOwnershipClaim?.drivers_license_url && userOwnershipClaim?.drivers_license_url !== 'pending';
  const claimNeedsId = hasClaim && !claimHasId;
  const [rpcSignal, setRpcSignal] = useState<any | null>(initialPriceSignal || null);
  const [trendPct, setTrendPct] = useState<number | null>(null);
  const [trendPriceType, setTrendPriceType] = useState<string | null>(null);
  const [trendBaselineValue, setTrendBaselineValue] = useState<number | null>(null);
  const [trendBaselineAsOf, setTrendBaselineAsOf] = useState<string | null>(null);
  const [trendBaselineSource, setTrendBaselineSource] = useState<string | null>(null);
  const [trendOutlierCount, setTrendOutlierCount] = useState<number | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<'live' | '1w' | '30d' | '6m' | '1y' | '5y'>('30d');
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [showOwnerClaimDropdown, setShowOwnerClaimDropdown] = useState(false);
  const [showOwnerPopover, setShowOwnerPopover] = useState(false);
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
  const [showAccessInfo, setShowAccessInfo] = useState(false);
  const locationRef = useRef<HTMLDivElement>(null);
  const ownerClaimRef = useRef<HTMLDivElement>(null);
  const accessRef = useRef<HTMLDivElement>(null);
  const auctionCurrency = useMemo(() => {
    const v: any = vehicle as any;
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
        fallback: '—',
      });
    }
    return formatUsdCurrency(value);
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (locationRef.current && !locationRef.current.contains(e.target as Node)) {
        setShowLocationDropdown(false);
      }
      if (ownerClaimRef.current && !ownerClaimRef.current.contains(e.target as Node)) {
        setShowOwnerClaimDropdown(false);
        setShowOwnerPopover(false);
      }
      if (accessRef.current && !accessRef.current.contains(e.target as Node)) {
        setShowAccessInfo(false);
      }
    };
    if (showLocationDropdown || showOwnerClaimDropdown || showOwnerPopover || showAccessInfo) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLocationDropdown, showOwnerClaimDropdown, showOwnerPopover, showAccessInfo]);

  // Derive current owner (best guess) from BaT data
  const ownerGuess = useMemo(() => {
    const v = vehicle as any;

    const rawOutcome = String(v?.auction_outcome || '').toLowerCase();
    const saleStatus = String(v?.sale_status || '').toLowerCase();
    const pulseStatus = auctionPulse?.listing_url ? String((auctionPulse as any)?.listing_status || '').toLowerCase() : '';

    const pulseFinal = parseMoneyNumber((auctionPulse as any)?.final_price);
    const pulseSoldAt = (auctionPulse as any)?.sold_at ?? null;
    const telemetryUnsold = pulseStatus === 'reserve_not_met' || pulseStatus === 'no_sale';
    const telemetrySold = pulseStatus === 'sold' && (pulseFinal !== null || !!pulseSoldAt);
    const vehicleUnsold = rawOutcome === 'reserve_not_met' || rawOutcome === 'no_sale';
    const vehicleSold = saleStatus === 'sold' || rawOutcome === 'sold';

    // Precedence: telemetry overrides stale vehicle fields (fixes cases where vehicles.auction_outcome is wrong).
    // - If telemetry says SOLD, trust it even if vehicle says RNM.
    // - If telemetry says RNM/NO SALE, trust it even if vehicle says SOLD.
    const hasSoldSignal = telemetrySold || (!telemetryUnsold && vehicleSold);

    // Filter out obviously invalid/useless usernames
    const isValidUsername = (username: string | null | undefined): boolean => {
      if (!username || typeof username !== 'string') return false;
      const u = username.trim().toLowerCase();
      // Reject generic/placeholder usernames
      const invalid = ['everyone', 'unknown', 'n/a', 'none', 'null', 'undefined', 'seller', 'buyer', 'owner', 'user', 'admin'];
      return u.length > 0 && !invalid.includes(u) && u.length >= 2;
    };

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

    // If sold, buyer is current owner; otherwise seller owns it
    if (hasSoldSignal) {
      if (buyer && isValidUsername(buyer)) {
        const fromSeller = seller && isValidUsername(seller) ? seller : null;
        return { username: buyer, from: fromSeller, role: 'buyer' };
      }
      return null;
    }
    
    // Not sold - seller is current owner (consigning)
    if (seller && isValidUsername(seller)) {
      return { username: seller, from: null, role: 'seller' };
    }
    return null;
  }, [vehicle, auctionPulse]);

  // Load partner signals for the @handle popover (unverified owner guess)
  useEffect(() => {
    if (!showOwnerPopover) return;
    const raw = String(ownerGuess?.username || '').trim();
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
          // Non-fatal: we can still show partial signals using handle matching.
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
  }, [showOwnerPopover, ownerGuess?.username]);

  // Derive location display - prefer city codes (ATL, LAX, NYC) or state abbrev
  const locationDisplay = useMemo(() => {
    const v = vehicle as any;
    const city = v?.city;
    const state = v?.state;
    const country = v?.country;
    const batLoc = v?.bat_location;
    const listingLoc = v?.listing_location || v?.listing_location_raw;
    
    // City code mappings for major metro areas
    const cityCodes: Record<string, string> = {
      'atlanta': 'ATL', 'los angeles': 'LAX', 'new york': 'NYC', 'chicago': 'CHI',
      'miami': 'MIA', 'dallas': 'DFW', 'houston': 'HOU', 'phoenix': 'PHX',
      'san francisco': 'SFO', 'seattle': 'SEA', 'denver': 'DEN', 'boston': 'BOS',
      'detroit': 'DTW', 'minneapolis': 'MSP', 'san diego': 'SAN', 'las vegas': 'LAS',
      'portland': 'PDX', 'austin': 'AUS', 'nashville': 'BNA', 'charlotte': 'CLT',
      'raleigh': 'RDU', 'tampa': 'TPA', 'orlando': 'MCO', 'philadelphia': 'PHL',
      'pittsburgh': 'PIT', 'cleveland': 'CLE', 'cincinnati': 'CVG', 'st louis': 'STL',
      'kansas city': 'MCI', 'indianapolis': 'IND', 'columbus': 'CMH', 'milwaukee': 'MKE',
      'salt lake city': 'SLC', 'sacramento': 'SMF', 'san jose': 'SJC', 'san antonio': 'SAT',
    };
    
    // Best: city code if major metro
    if (city) {
      const code = cityCodes[city.toLowerCase()];
      if (code) return { short: code, full: `${city}, ${state || ''}`.trim() };
    }
    // Next: state abbreviation (but skip if it's corrupted data like ":")
    if (state && state !== ':' && state.length <= 3) return { short: state, full: city ? `${city}, ${state}` : state };
    // Fallback: bat_location or listing_location (extract state if possible)
    if (batLoc && batLoc !== 'United States') {
      const stateMatch = batLoc.match(/,\s*([A-Z]{2})\b/);
      return { short: stateMatch ? stateMatch[1] : batLoc.slice(0, 3).toUpperCase(), full: batLoc };
    }
    if (listingLoc) {
      const stateMatch = listingLoc.match(/,\s*([A-Z]{2})\b/);
      return { short: stateMatch ? stateMatch[1] : listingLoc.slice(0, 3).toUpperCase(), full: listingLoc };
    }
    // Country only
    if (country && country !== 'USA' && country !== 'US') return { short: country.slice(0, 3).toUpperCase(), full: country };
    
    return null;
  }, [(vehicle as any)?.city, (vehicle as any)?.state, (vehicle as any)?.country, (vehicle as any)?.bat_location, (vehicle as any)?.listing_location]);
  
  // Cycle through trend periods
  const toggleTrendPeriod = (e: React.MouseEvent) => {
    e.stopPropagation();
    const periods: ('live' | '1w' | '30d' | '6m' | '1y' | '5y')[] = ['live', '1w', '30d', '6m', '1y', '5y'];
    const currentIndex = periods.indexOf(trendPeriod);
    const nextIndex = (currentIndex + 1) % periods.length;
    setTrendPeriod(periods[nextIndex]);
  };
  const [displayMode, setDisplayMode] = useState<'auto'|'estimate'|'auction'|'asking'|'sale'|'purchase'|'msrp'>('auto');
  const [responsibleMode, setResponsibleMode] = useState<'auto'|'owner'|'consigner'|'uploader'|'listed_by'|'custom'>('auto');
  const [responsibleCustom, setResponsibleCustom] = useState<string>('');
  const [valuation, setValuation] = useState<any | null>(initialValuation || null);
  const [showTrade, setShowTrade] = useState(false);
  const [showOwnerCard, setShowOwnerCard] = useState(false);
  const [ownerProfile, setOwnerProfile] = useState<any | null>(null);
  const [ownerStats, setOwnerStats] = useState<{ contributions: number; vehicles: number } | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [priceMenuOpen, setPriceMenuOpen] = useState(false);
  const priceMenuRef = useRef<HTMLDivElement | null>(null);
  const [showPendingDetails, setShowPendingDetails] = useState(false);
  const [similarVehicles, setSimilarVehicles] = useState<any[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [imageCount, setImageCount] = useState(0);
  const pendingDetailsRef = useRef<HTMLDivElement | null>(null);
  const [showOriginDetails, setShowOriginDetails] = useState(false);
  const originDetailsRef = useRef<HTMLDivElement | null>(null);
  const [showProvenancePopup, setShowProvenancePopup] = useState(false);
  const [priceSources, setPriceSources] = useState<Record<string, boolean>>({});
  const [showVinValidation, setShowVinValidation] = useState(false);
  const [showUpdateSalePriceModal, setShowUpdateSalePriceModal] = useState(false);
  const [showFollowAuctionCard, setShowFollowAuctionCard] = useState(false);
  const [futureAuctionListing, setFutureAuctionListing] = useState<any | null>(null);
  const [showOrgInvestmentCard, setShowOrgInvestmentCard] = useState<string | null>(null);
  const [orgCardAnchor, setOrgCardAnchor] = useState<HTMLElement | null>(null);

  const { summary: vinProofSummary } = useVINProofs(vehicle?.id);
  // STRICT: "VIN VERIFIED" only when we have at least one conclusive, cited proof
  // (VIN plate/stamping photo OCR, title OCR, etc). Manual entry alone is not enough.
  const vinIsEvidenceBacked = !!vinProofSummary?.hasConclusiveProof;
  const vinLooksValid = useMemo(() => {
    const raw = (vehicle as any)?.vin;
    if (!raw || typeof raw !== 'string') return false;
    const v = raw.trim();
    if (!v) return false;
    const validation = vinDecoderService.validateVIN(v);
    // Guard against garbage strings that happen to be 17 letters (e.g. "DUALEXHASUTSTACKS").
    if (!validation.valid) return false;
    if (!/\d/.test(validation.normalized)) return false;
    return true;
  }, [(vehicle as any)?.vin]);

  // Check if price fields have verified sources (FACT-BASED requirement)
  useEffect(() => {
    const checkPriceSources = async () => {
      if (!vehicle?.id) return;
      
      const sources: Record<string, boolean> = {};
      
      // Check each price field for verified sources
      const priceFields = ['sale_price', 'asking_price', 'current_value', 'purchase_price', 'msrp'];
      
      for (const field of priceFields) {
        const { data } = await supabase
          .from('vehicle_field_sources')
          .select('id, is_verified')
          .eq('vehicle_id', vehicle.id)
          .eq('field_name', field)
          .eq('is_verified', true)
          .limit(1);
        
        sources[field] = (data && data.length > 0) || false;
      }
      
      setPriceSources(sources);
    };
    
    checkPriceSources();
  }, [vehicle?.id]);

  // Check for future auction dates (for Mecum or other future auctions)
  useEffect(() => {
    const checkFutureAuction = async () => {
      if (!vehicle?.id) {
        setFutureAuctionListing(null);
        return;
      }

      try {
        const now = new Date().toISOString();
        const { data, error } = await supabase
          .from('external_listings')
          .select('id, platform, listing_url, listing_status, start_date, end_date, metadata')
          .eq('vehicle_id', vehicle.id)
          .order('start_date', { ascending: true, nullsFirst: false })
          .limit(10);

        if (error) {
          console.error('Error checking future auctions:', error);
          setFutureAuctionListing(null);
          return;
        }

        // Find the first listing with a future date (start_date, end_date, or metadata.sale_date)
        const futureListing = (data || []).find((listing: any) => {
          const nowMs = Date.now();
          
          // Check start_date first (auction start)
          if (listing.start_date) {
            const startDate = new Date(listing.start_date).getTime();
            if (Number.isFinite(startDate) && startDate > nowMs) {
              return true;
            }
          }
          // Check end_date (auction end)
          if (listing.end_date) {
            const endDate = new Date(listing.end_date).getTime();
            if (Number.isFinite(endDate) && endDate > nowMs) {
              return true;
            }
          }
          // Check metadata.sale_date (Mecum and other auction houses store dates here)
          if (listing.metadata?.sale_date) {
            const saleDate = new Date(listing.metadata.sale_date).getTime();
            if (Number.isFinite(saleDate) && saleDate > nowMs) {
              return true;
            }
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
  }, [vehicle?.id]);

  // Only fetch if not provided via props (eliminates duplicate query)
  useEffect(() => {
    if (initialPriceSignal) {
      setRpcSignal(initialPriceSignal);
      return; // Skip fetch if provided
    }
    (async () => {
      try {
        if (!vehicle?.id) { setRpcSignal(null); return; }
        const { data, error } = await supabase.rpc('vehicle_price_signal', { vehicle_ids: [vehicle.id] });
        if (!error && Array.isArray(data) && data.length > 0) {
          setRpcSignal(data[0]);
        } else {
          setRpcSignal(null);
        }
      } catch {
        setRpcSignal(null);
      }
    })();
  }, [vehicle?.id, initialPriceSignal]);

  // Only fetch if not provided via props (eliminates duplicate query)
  useEffect(() => {
    if (initialValuation) {
      setValuation(initialValuation);
      return; // Skip fetch if provided
    }
    (async () => {
      try {
        if (!vehicle?.id) { setValuation(null); return; }
        const v = await VehicleValuationService.getValuation(vehicle.id);
        setValuation(v);
      } catch {
        setValuation(null);
      } finally {
      }
    })();
  }, [vehicle?.id, initialValuation]);

  // Load pending details if vehicle is pending
  useEffect(() => {
    if (!vehicle || (vehicle as any).status !== 'pending') {
      setSimilarVehicles([]);
      setImageCount(0);
      return;
    }

    (async () => {
      // Count images
      const { count } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);
      setImageCount(count || 0);

      // Find similar vehicles if we have basic info
      if (vehicle.year && vehicle.make && vehicle.model) {
        setLoadingSimilar(true);
        try {
          const matches = await VehicleDeduplicationService.findDuplicates({
            vin: vehicle.vin || undefined,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
          });

          // Filter out this vehicle and enrich with image counts
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

  // Load owner's preferred display settings (if the table/columns exist)
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) return;
        const { data, error } = await supabase
          .from('vehicle_sale_settings')
          .select('display_price_mode, display_responsible_mode, display_responsible_custom')
          .eq('vehicle_id', vehicle.id)
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
  }, [vehicle?.id]);

  // Load trend based on selected period (baseline + outlier filtering from DB)
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

        // Don't show trend if price was auto-corrected (e.g., $15 -> $15,000)
        // The "trend" would be the correction, not real market movement
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

        // For 'live', we also check builds/receipts for active investment
        if (trendPeriod === 'live') {
          try {
            const since = Date.now() - 24 * 60 * 60 * 1000;
            const { data: builds } = await supabase
              .from('vehicle_builds')
              .select('id')
              .eq('vehicle_id', vehicle.id);

            let recentInvestment = 0;
            if (builds && builds.length > 0) {
              const buildIds = builds.map(b => b.id);
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

  // Load owner profile and stats when owner card opens
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
        if (session?.user?.id) {
          const { data: follow } = await supabase
            .from('user_follows')
            .select('id')
            .eq('follower_id', session.user.id)
            .eq('following_id', ownerId)
            .maybeSingle();
          setIsFollowing(!!follow);
        }
      } catch (err) {
        console.warn('Owner card load failed:', err);
      }
    })();
  }, [showOwnerCard, vehicle, session?.user?.id]);

  // Close price popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!priceMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!priceMenuRef.current) return;
      if (!priceMenuRef.current.contains(event.target as Node)) {
        setPriceMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPriceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [priceMenuOpen]);

  const getAutoDisplay = () => {
    if (!vehicle) return { amount: null as number | null, label: '' };
    
    // CORRECT PRIORITY ORDER (DO NOT USE current_value):
    // 1. sale_price (actual sold price)
    // 2. winning_bid (auction result)
    // 3. high_bid (RNM auctions)
    // 4. Live bid (from external_listings/auctionPulse for active auctions)
    // 5. Current bid (from vehicle, if no external listing)
    // 6. Asking price (only if for sale)
    
    const v = vehicle as any;
    
    // 1. Sale price / final bid
    // NOTE: Many auction imports historically stored "Bid to" (RNM) into `vehicles.sale_price`.
    // We must not label this as "Sold for" when reserve was not met.
    if (typeof vehicle.sale_price === 'number' && vehicle.sale_price > 0) {
      const outcome = String(v.auction_outcome || '').toLowerCase();
      const reserveStatus = String(v.reserve_status || '').toLowerCase();
      const isUnsold = reserveStatus === 'reserve_not_met' || reserveStatus === 'no_sale' || outcome === 'reserve_not_met' || outcome === 'no_sale';
      if (isUnsold) {
        return { amount: vehicle.sale_price, label: 'High Bid' };
      }
      if (outcome === 'sold') {
        return { amount: vehicle.sale_price, label: 'SOLD FOR' };
      }
      return { amount: vehicle.sale_price, label: 'Sold for' };
    }
    
    // 2. Winning bid (auction result)
    if (typeof v.winning_bid === 'number' && Number.isFinite(v.winning_bid) && v.winning_bid > 0) {
      return { amount: v.winning_bid, label: 'Winning Bid' };
    }
    
    // 3. High bid (RNM auctions)
    if (typeof v.high_bid === 'number' && Number.isFinite(v.high_bid) && v.high_bid > 0) {
      return { amount: v.high_bid, label: 'High Bid' };
    }
    
    // 4. Live bid from auction telemetry (external_listings pulse)
    try {
      // First check auctionPulse (most up-to-date)
      if (auctionPulse?.listing_url) {
        const status = String(auctionPulse.listing_status || '').toLowerCase();
        const isLive = status === 'active' || status === 'live';
        const isSold = status === 'sold';

        const pulseFinal = parseMoneyNumber((auctionPulse as any).final_price);
        if (isSold && pulseFinal) {
          return { amount: pulseFinal, label: 'SOLD FOR' };
        }
        const pulseBid = parseMoneyNumber((auctionPulse as any).current_bid);
        if (isLive && pulseBid) {
          return { amount: pulseBid, label: 'Current Bid' };
        }
      }
      
      // Fallback: check external_listings directly from vehicle data
      const v: any = vehicle as any;
      const externalListing = v?.external_listings?.[0];
      if (externalListing) {
        // Treat listing as live if either:
        // - end_date is in the future, OR
        // - end_date is missing but status indicates 'active' or 'live'
        const listingEndDate = externalListing.end_date ? new Date(externalListing.end_date).getTime() : 0;
        const statusStr = String(externalListing.listing_status || '').toLowerCase();
        const hasLiveStatus = statusStr === 'active' || statusStr === 'live';
        const isLive = (Number.isFinite(listingEndDate) && listingEndDate > Date.now()) || (!externalListing.end_date && hasLiveStatus);
        const listingBid = parseMoneyNumber(externalListing.current_bid);
        if (isLive && listingBid) {
          return { amount: listingBid, label: 'Current Bid' };
        }
      }
    } catch {
      // ignore
    }
    
    // 5. Current bid from vehicle (if no external listing)
    if (typeof vehicle.current_bid === 'number' && Number.isFinite(vehicle.current_bid) && vehicle.current_bid > 0) {
      return { amount: vehicle.current_bid, label: 'Current Bid' };
    }
    
    // 6. Asking price (show if exists - having an asking price implies it's for sale)
    const askingPrice = typeof vehicle.asking_price === 'number' 
      ? vehicle.asking_price 
      : (typeof vehicle.asking_price === 'string' ? parseFloat(vehicle.asking_price) : null);
    if (askingPrice && !isNaN(askingPrice) && askingPrice > 0) {
      return { amount: askingPrice, label: 'Asking' };
    }
    
    // Reserve Not Met with no price
    if (v.auction_outcome === 'reserve_not_met') {
      return { amount: null, label: 'Reserve Not Met' };
    }
    
    // No price available - DO NOT fall back to current_value, purchase_price, msrp, or estimates
    return { amount: null, label: '' };
  };

  const getDisplayValue = () => {
    if (!vehicle) return { amount: null as number | null, label: '' };
    const mode = displayMode || 'auto';
    if (mode === 'auto') {
      return getAutoDisplay();
    }
    if (mode === 'estimate') {
      // Prefer unified valuation service (these are computed estimates, always show)
      if (valuation && typeof valuation.estimatedValue === 'number' && valuation.estimatedValue > 0) {
        return { amount: valuation.estimatedValue, label: 'Estimated Value' };
      }
      // Fallback to RPC/primary price heuristic
      if (rpcSignal && typeof rpcSignal.primary_value === 'number' && rpcSignal.primary_label) {
        return { amount: rpcSignal.primary_value, label: rpcSignal.primary_label };
      }
      // FACT-BASED: Only show current_value if has verified source
      if (typeof vehicle.current_value === 'number' && priceSources.current_value) {
        return { amount: vehicle.current_value, label: 'Estimated Value' };
      }
      // If no verified current_value, return null (don't show unverified estimates)
      return { amount: null, label: '' };
    }
    if (mode === 'auction') {
      const pulseBid = (auctionPulse && typeof auctionPulse.current_bid === 'number' && Number.isFinite(auctionPulse.current_bid) && auctionPulse.current_bid > 0)
        ? auctionPulse.current_bid
        : null;
      return { amount: pulseBid ?? (typeof vehicle.current_bid === 'number' ? vehicle.current_bid : null), label: 'Current Bid' };
    }
    if (mode === 'asking') {
      // Asking price - user intent, but still check for verified source if available
      const askingPrice = typeof vehicle.asking_price === 'number' 
        ? vehicle.asking_price 
        : (typeof vehicle.asking_price === 'string' ? parseFloat(vehicle.asking_price) : null);
      if (askingPrice && !isNaN(askingPrice) && askingPrice > 0) {
        // Asking price can be shown without verified source (user intent to sell)
        // But if there IS a source, prefer it
        return { amount: askingPrice, label: 'Asking Price' };
      }
      return { amount: null, label: '' };
    }
    if (mode === 'sale') {
      // FACT-BASED: Only show sale_price if it has a verified source
      if (typeof vehicle.sale_price === 'number') {
        // Check if sale_price has a verified source
        if (!priceSources.sale_price && !(vehicle as any).bat_auction_url) {
          // No verified source - don't show unverified prices
          return { amount: null, label: '' };
        }
        
        // Respect auction outcome / reserve status for proper disclosure
        const outcome = String((vehicle as any).auction_outcome || '').toLowerCase();
        const reserveStatus = String((vehicle as any).reserve_status || '').toLowerCase();
        if (outcome === 'sold') {
          return { amount: vehicle.sale_price, label: 'SOLD FOR' };
        } else if (outcome === 'reserve_not_met' || reserveStatus === 'reserve_not_met') {
          // Don't show high bid for RNM - user needs to click for details
          return { amount: null, label: 'Reserve Not Met' };
        } else if (outcome === 'no_sale' || reserveStatus === 'no_sale') {
          return { amount: null, label: 'No Sale' };
        } else {
          return { amount: vehicle.sale_price, label: 'Sold for' };
        }
      }
      return { amount: null, label: '' };
    }
    if (mode === 'purchase') {
      // FACT-BASED: Only show purchase_price if has verified source (e.g., receipt)
      if (typeof vehicle.purchase_price === 'number') {
        if (!priceSources.purchase_price) {
          // No verified source - don't show unverified purchase prices
          return { amount: null, label: '' };
        }
        return { amount: vehicle.purchase_price, label: 'Purchase Price' };
      }
      return { amount: null, label: '' };
    }
    if (mode === 'msrp') return { amount: typeof vehicle.msrp === 'number' ? vehicle.msrp : null, label: 'Original MSRP' };
    return getAutoDisplay();
  };

  const persistDisplayMode = async (mode: typeof displayMode) => {
    setDisplayMode(mode);
    try {
      if (!vehicle?.id) return;
      await supabase
        .from('vehicle_sale_settings')
        .upsert({ vehicle_id: vehicle.id, display_price_mode: mode, updated_at: new Date().toISOString() } as any, { onConflict: 'vehicle_id' });
    } catch (e) {
      console.debug('Display mode persistence skipped/failed:', e);
    }
  };

  const persistResponsibleSettings = async (mode: typeof responsibleMode, custom?: string) => {
    setResponsibleMode(mode);
    if (typeof custom === 'string') setResponsibleCustom(custom);
    try {
      if (!vehicle?.id) return;
      await supabase
        .from('vehicle_sale_settings')
        .upsert({
          vehicle_id: vehicle.id,
          display_responsible_mode: mode,
          display_responsible_custom: typeof custom === 'string' ? custom : responsibleCustom,
          updated_at: new Date().toISOString()
        } as any, { onConflict: 'vehicle_id' });
    } catch (e) {
      console.debug('Responsible mode persistence skipped/failed:', e);
    }
  };

  const isOwnerLike = isVerifiedOwner || contributorRole === 'owner';
  // IMPORTANT: Claim flow should work even if React onClick handlers are flaky.
  // We intentionally use a normal href to navigate to `?claim=1`,
  // and VehicleProfile will open the claim modal from the URL param and then clean it up.
  const claimHref = vehicle?.id ? `/vehicle/${vehicle.id}?claim=1` : '#';

  const computeResponsibleLabel = (): string => {
    const mode = responsibleMode || 'auto';
    if (mode === 'custom' && responsibleCustom.trim()) return responsibleCustom.trim();
    if (mode === 'owner') return 'Owner';
    if (mode === 'consigner') return 'Consigner';
    if (mode === 'uploader') return 'Uploader';
    if (mode === 'listed_by') return 'Listed by';
    
    // Check if this is an automated import (should show organization, not user)
    const isAutomatedImport = vehicle?.profile_origin === 'dropbox_import' && 
                              (vehicle?.origin_metadata?.automated_import === true || 
                               vehicle?.origin_metadata?.no_user_uploader === true ||
                               !vehicle?.uploaded_by);
    if (isAutomatedImport) {
      return 'Imported by'; // Organization import, not user upload
    }
    
    // Auto logic based on permissions
    if (isVerifiedOwner || contributorRole === 'owner') return 'Owner';
    if (contributorRole === 'consigner') return 'Consigner';
    if (contributorRole === 'discovered') return 'Discoverer';
    if (contributorRole === 'photographer') return 'Photographer';
    if (contributorRole === 'restorer') return 'Restorer';
    
    // Fallback: if they are just the uploader without a specific role
    if (session?.user?.id === vehicle?.uploaded_by) return ''; // Don't spam self-attribution in header
    
    return 'Listed by';
  };

  const formatShortDate = (value?: string | null) => {
    if (!value) return undefined;
    try {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
    } catch {
      return undefined;
    }
  };

  const fieldSource = (field: string, fallback?: string) => (vehicle as any)?.[`${field}_source`] || fallback;
  const fieldConfidence = (field: string) => {
    const value = (vehicle as any)?.[`${field}_confidence`];
    return typeof value === 'number' ? value : undefined;
  };

  const formatAge = (iso?: string | null) => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    const diff = Date.now() - t;
    if (diff < 0) return '0s';
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  const formatRemaining = (iso?: string | null) => {
    if (!iso) return null;
    const end = new Date(iso).getTime();
    if (!Number.isFinite(end)) return null;
    const diff = end - Date.now();
    // Guard against obviously-wrong countdowns (bad imports/backfills).
    // We'd rather show nothing than lie. Allow up to 60 days for legitimate long auctions.
    const maxReasonable = 60 * 24 * 60 * 60 * 1000;
    if (diff > maxReasonable) return null;
    if (diff <= 0) return 'Ended';
    const s = Math.floor(diff / 1000);
    const d = Math.floor(s / (60 * 60 * 24));
    const h = Math.floor((s % (60 * 60 * 24)) / (60 * 60));
    const m = Math.floor((s % (60 * 60)) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  // Live auction timer (header should feel alive)
  // Check for end_date from auctionPulse OR external_listings OR vehicle-level data
  const auctionEndDateForTimer = useMemo(() => {
    // Priority 1: auctionPulse (most up-to-date telemetry)
    if (auctionPulse?.end_date) return auctionPulse.end_date;
    // Priority 2: external_listings (if available in vehicle data)
    const v: any = vehicle as any;
    const externalListing = v?.external_listings?.[0];
    if (externalListing?.end_date) return externalListing.end_date;
    // Priority 3: vehicle-level auction_end_date
    return v?.auction_end_date || v?.origin_metadata?.auction_times?.auction_end_date || null;
  }, [auctionPulse?.end_date, vehicle]);

  const [auctionNow, setAuctionNow] = useState<number>(() => Date.now());
  const lastUpdateRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!auctionEndDateForTimer) return;
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
  }, [auctionEndDateForTimer]);

  const formatCountdownClock = (iso?: string | null, skipEndedText?: boolean) => {
    if (!iso) return null;
    const end = new Date(iso).getTime();
    if (!Number.isFinite(end)) return null;
    const diff = end - auctionNow;
    // For very long auctions (>30 days), show days/hours format instead of full countdown
    const veryLongThreshold = 30 * 24 * 60 * 60 * 1000;
    const maxReasonable = 60 * 24 * 60 * 60 * 1000; // Allow up to 60 days
    if (diff > maxReasonable) return null;
    // Don't show redundant "Ended" when SOLD badge is already visible
    if (diff <= 0) return skipEndedText ? null : 'Ended';
    const totalSeconds = Math.floor(diff / 1000);
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    // For very long auctions, show simplified format (e.g., "19d 18h")
    if (diff > veryLongThreshold) {
      return `${d}d ${h}h`;
    }
    if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  // Get the most up-to-date end_date for timer display
  const timerEndDate = useMemo(() => {
    // Priority 1: auctionPulse (most up-to-date telemetry)
    if (auctionPulse?.end_date) return auctionPulse.end_date;
    // Priority 2: external_listings (if available in vehicle data)
    const v: any = vehicle as any;
    const externalListing = v?.external_listings?.[0];
    if (externalListing?.end_date) return externalListing.end_date;
    // Priority 3: vehicle-level auction_end_date
    return v?.auction_end_date || v?.origin_metadata?.auction_times?.auction_end_date || null;
  }, [auctionPulse?.end_date, vehicle]);

  const isAuctionLive = useMemo(() => {
    const v: any = vehicle as any;
    const externalListing = v?.external_listings?.[0];
    const activeListing = auctionPulse || externalListing;
    
    if (!activeListing?.listing_url && !activeListing) return false;
    
    // CRITICAL: Trust end_date over status field (scrapers use inconsistent status values)
    const endDate = activeListing.end_date || timerEndDate;
    
    // If we have an end_date, that's the source of truth for "live" status
    if (endDate) {
      const end = new Date(endDate).getTime();
      if (Number.isFinite(end) && end > auctionNow) {
        // Future end date means it's still live, regardless of status field
        return true;
      }
    }
    
    // Fallback: check status field only if no reliable end_date
    const status = String(activeListing.listing_status || '').toLowerCase();
    if (status === 'active' || status === 'live') {
      // No end date but status is active/live - assume it's live
      return true;
    }
    
    // Also check vehicle-level auction_end_date as fallback
    if (vehicle) {
      const vehicleEndDate = v?.auction_end_date || v?.origin_metadata?.auction_times?.auction_end_date;
      if (vehicleEndDate) {
        const end = new Date(vehicleEndDate).getTime();
        if (Number.isFinite(end) && end > auctionNow) {
          // Vehicle has future end date - check it's not explicitly ended
          const outcome = String(v?.auction_outcome || '').toLowerCase();
          const saleStatus = String(v?.sale_status || '').toLowerCase();
          const isEnded = ['sold', 'ended', 'reserve_not_met', 'no_sale'].includes(outcome) || 
                          ['sold', 'ended'].includes(saleStatus);
          if (!isEnded) {
            return true;
          }
        }
      }
    }
    
    return false;
  }, [auctionPulse, timerEndDate, auctionNow, vehicle]);

  const auctionTelemetryFresh = useMemo(() => {
    const updatedAt = auctionPulse?.updated_at ? new Date(auctionPulse.updated_at as any).getTime() : NaN;
    if (!Number.isFinite(updatedAt)) return false;
    const diffMin = (Date.now() - updatedAt) / (1000 * 60);
    // If we don't have a recent update, don't trust counts (avoids misleading UI).
    return diffMin >= 0 && diffMin <= 15;
  }, [auctionPulse?.updated_at]);

  const batIdentityHref = useMemo(() => {
    const makeHref = (rawHandle: string | null): { handle: string; href: string; proofUrl: string } | null => {
      const h = String(rawHandle || '').trim();
      if (!h) return null;
      const handle = h
        .replace(/^@/, '')
        .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
        .replace(/\/+$/, '')
        .trim();
      if (!handle) return null;
      const proofUrl = `https://bringatrailer.com/member/${handle}/`;
      const href = `/claim-identity?platform=bat&handle=${encodeURIComponent(handle)}&profileUrl=${encodeURIComponent(proofUrl)}`;
      return { handle, href, proofUrl };
    };

    const sellerRaw = String(
      // Prefer auction telemetry metadata (authoritative for BaT participant usernames)
      (auctionPulse as any)?.seller_username ||
        (auctionPulse as any)?.metadata?.seller_username ||
        (auctionPulse as any)?.metadata?.seller ||
        // Fallbacks
        (vehicle as any)?.origin_metadata?.bat_seller ||
        (vehicle as any)?.origin_metadata?.seller ||
        ''
    ).trim() || null;
    const winnerRaw =
      // Prefer auction telemetry metadata (authoritative for buyer username)
      String((auctionPulse as any)?.winner_name || '').trim() ||
      String((auctionPulse as any)?.metadata?.buyer_username || (auctionPulse as any)?.metadata?.buyer || '').trim() ||
      // Some pipelines may place winner fields at top-level
      (typeof (auctionPulse as any)?.winner_name === 'string' ? String((auctionPulse as any)?.winner_name) : '') ||
      (typeof (auctionPulse as any)?.winning_bidder_name === 'string' ? String((auctionPulse as any)?.winning_bidder_name) : '') ||
      (typeof (auctionPulse as any)?.winner_display_name === 'string' ? String((auctionPulse as any)?.winner_display_name) : '') ||
      // Legacy fallbacks
      String((vehicle as any)?.origin_metadata?.bat_buyer || (vehicle as any)?.origin_metadata?.buyer || '').trim() ||
      null;

    return {
      seller: makeHref(sellerRaw),
      winner: makeHref(winnerRaw),
    };
  }, [vehicle, auctionPulse]);

  const auctionPulseMs = useMemo(() => {
    if (!isAuctionLive) return null;
    if (!timerEndDate) return 3800;
    const end = new Date(timerEndDate).getTime();
    if (!Number.isFinite(end)) return 3800;
    const diff = end - auctionNow;
    if (diff <= 0) return null;
    const s = diff / 1000;
    if (s <= 30) return 500;
    if (s <= 60) return 650;
    if (s <= 5 * 60) return 900;
    if (s <= 30 * 60) return 1400;
    if (s <= 2 * 60 * 60) return 2200;
    if (s <= 24 * 60 * 60) return 3200;
    return 4200;
  }, [timerEndDate, auctionNow, isAuctionLive]);


  // Header org pills are tiny; if the same org is linked multiple times (e.g. legacy `consigner` + `sold_by`),
  // we should display a single pill with the "best" relationship to avoid duplicates.
  const { visibleOrganizations, extraOrgCount } = useMemo(() => {
    const links = (organizationLinks || []) as any[];
    if (links.length === 0) return { visibleOrganizations: [], extraOrgCount: 0 };

    const relPriority = (rel?: string | null) => {
      const r = String(rel || '').toLowerCase();
      // Higher-signal dealer relationships first
      const order = [
        'sold_by',
        'seller',
        'consigner',
        // common non-dealer relationships
        'owner',
        'service_provider',
        'work_location',
        'parts_supplier',
        'fabricator',
        'painter',
        'upholstery',
        'transport',
        'storage',
        'inspector',
        'collaborator',
      ];
      const idx = order.indexOf(r);
      return idx >= 0 ? idx : 999;
    };

    const byOrg = new Map<string, any>();
    for (const link of links) {
      const orgId = String(link?.organization_id || link?.id || '');
      if (!orgId) continue;
      const existing = byOrg.get(orgId);
      if (!existing) {
        byOrg.set(orgId, link);
        continue;
      }

      const nextRank = relPriority(link?.relationship_type);
      const prevRank = relPriority(existing?.relationship_type);

      // Prefer higher-priority relationship; if equal, prefer non-auto-tagged (manually curated).
      const nextAuto = Boolean(link?.auto_tagged);
      const prevAuto = Boolean(existing?.auto_tagged);
      if (nextRank < prevRank || (nextRank === prevRank && prevAuto && !nextAuto)) {
        byOrg.set(orgId, link);
      }
    }

    const unique = Array.from(byOrg.values());
    const visible = unique.slice(0, 3);
    const extra = Math.max(0, unique.length - visible.length);
    return { visibleOrganizations: visible, extraOrgCount: extra };
  }, [organizationLinks]);

  const sellerBadge = useMemo(() => {
    const links = (organizationLinks || []) as any[];
    const pickRel = (r: any) => String(r?.relationship_type || '').toLowerCase();
    const sellerRels = ['sold_by', 'seller', 'consigner'];
    const candidates = links.filter((x) => x && sellerRels.includes(pickRel(x)));
    const first = [...candidates].sort((a, b) => {
      const aIntermediary = isIntermediaryBusinessType(a?.business_type);
      const bIntermediary = isIntermediaryBusinessType(b?.business_type);
      if (aIntermediary !== bIntermediary) return aIntermediary ? 1 : -1;
      return sellerRels.indexOf(pickRel(a)) - sellerRels.indexOf(pickRel(b));
    })[0];

    const metaSeller = String(
      (auctionPulse as any)?.seller_username ||
        (auctionPulse as any)?.metadata?.seller_username ||
        (auctionPulse as any)?.metadata?.seller ||
        (vehicle as any)?.origin_metadata?.bat_seller ||
        (vehicle as any)?.origin_metadata?.seller ||
        ''
    ).trim();
    const firstIsIntermediary = first ? isIntermediaryBusinessType(first.business_type) : false;

    if (first?.business_name && !firstIsIntermediary) {
      // Ensure we use business_name, not description or any other field
      const businessName = String(first.business_name || '').trim();
      // If business_name appears to be a description (too long or contains certain patterns), fall back to organization ID or skip
      if (!businessName || businessName.length > 100 || businessName.toLowerCase().includes('is a dealer') || businessName.toLowerCase().includes('specializing')) {
        // Skip this badge if business_name looks corrupted
        return null;
      }
      return {
        label: businessName,
        logo_url: first.logo_url ? String(first.logo_url) : null,
        relationship: pickRel(first),
        business_type: first.business_type || null,
      };
    }

    if (metaSeller) {
      // Detect platform for generating correct profile URL
      const platform = String(
        (auctionPulse as any)?.platform ||
        (vehicle as any)?.profile_origin?.replace('_import', '') ||
        'bat'
      ).toLowerCase();

      const slug = metaSeller
        .trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
        .replace(/^https?:\/\/www\.hagerty\.com\/marketplace\/profile\//i, '')
        .replace(/^https?:\/\/carsandbids\.com\/u\//i, '')
        .replace(/\/+$/, '');

      // Generate platform-specific profile URL
      let proofUrl: string | null = null;
      if (platform === 'bat' || platform === 'bringatrailer') {
        proofUrl = slug ? `https://bringatrailer.com/member/${slug}/` : null;
      } else if (platform === 'hagerty') {
        const sellerSlug = (auctionPulse as any)?.metadata?.seller_slug || slug;
        proofUrl = sellerSlug ? `https://www.hagerty.com/marketplace/profile/${sellerSlug}` : null;
      } else if (platform === 'cars_and_bids' || platform === 'carsandbids') {
        proofUrl = slug ? `https://carsandbids.com/u/${slug}/` : null;
      } else if (platform === 'pcarmarket') {
        proofUrl = slug ? `https://pcarmarket.com/member/${slug}/` : null;
      }

      const normalizedPlatform = platform === 'bringatrailer' ? 'bat' : platform;
      const href = slug && proofUrl
        ? `/claim-identity?platform=${encodeURIComponent(normalizedPlatform)}&handle=${encodeURIComponent(slug)}&profileUrl=${encodeURIComponent(proofUrl)}`
        : null;
      return { label: metaSeller, logo_url: null, relationship: 'seller', business_type: null, href, proofUrl, handle: slug, kind: `${normalizedPlatform}_user` };
    }

    if (first?.business_name) {
      const businessName = String(first.business_name || '').trim();
      if (!businessName || businessName.length > 100 || businessName.toLowerCase().includes('is a dealer') || businessName.toLowerCase().includes('specializing')) {
        return null;
      }
      return {
        label: businessName,
        logo_url: first.logo_url ? String(first.logo_url) : null,
        relationship: pickRel(first),
        business_type: first.business_type || null,
      };
    }

    return null;
  }, [organizationLinks, vehicle, auctionPulse]);

  const batMemberLink = useMemo(() => {
    const metaSeller = String((vehicle as any)?.origin_metadata?.bat_seller || (vehicle as any)?.origin_metadata?.seller || '').trim();
    if (!metaSeller) return null;
    const slug = metaSeller
      .trim()
      .replace(/^@/, '')
      .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
      .replace(/\/+$/, '');
    if (!slug) return null;
    const proofUrl = `https://bringatrailer.com/member/${slug}/`;
    const href = `/claim-identity?platform=bat&handle=${encodeURIComponent(slug)}&profileUrl=${encodeURIComponent(proofUrl)}`;
    return { label: metaSeller, href, proofUrl, handle: slug };
  }, [vehicle]);

  const formatRelationship = (relationship?: string | null) => {
    if (!relationship) return 'Partner';
    return RELATIONSHIP_LABELS[relationship] || relationship.replace(/_/g, ' ');
  };

  type PriceEntry = {
    id: string;
    label: string;
    amount: number;
    source?: string;
    date?: string | null;
    confidence?: number;
    note?: string;
  };

  const priceEntries = useMemo<PriceEntry[]>(() => {
    if (!vehicle) return [];
    const entries: PriceEntry[] = [];
    const pushEntry = (entry: Omit<PriceEntry, 'amount'> & { amount?: number | null }) => {
      if (typeof entry.amount === 'number' && !Number.isNaN(entry.amount) && entry.amount > 0) {
        entries.push({ ...entry, amount: entry.amount });
      }
    };

    const saleDate = (vehicle as any)?.sale_date || (vehicle as any)?.bat_sale_date || null;
    pushEntry({
      id: 'sale',
      label: 'Recorded Sale',
      amount: vehicle.sale_price,
      date: saleDate,
      source: fieldSource('sale_price', (vehicle as any)?.platform_source || 'Vehicle record'),
      confidence: fieldConfidence('sale_price')
    });

    const batSale = (vehicle as any)?.bat_sold_price;
    if (typeof batSale === 'number' && batSale !== vehicle.sale_price) {
      pushEntry({
        id: 'bat_sale',
        label: 'Bring a Trailer Result',
        amount: batSale,
        date: (vehicle as any)?.bat_sale_date || saleDate,
        source: 'Bring a Trailer',
        confidence: fieldConfidence('bat_sold_price')
      });
    }

    pushEntry({
      id: 'asking',
      label: 'Asking Price',
      amount: vehicle.asking_price,
      date: (vehicle as any)?.asking_price_date || null,
      source: fieldSource('asking_price', 'Seller provided'),
      confidence: fieldConfidence('asking_price')
    });

    pushEntry({
      id: 'auction',
      label: vehicle.auction_source ? `${vehicle.auction_source} Bid` : 'Current Bid',
      amount: vehicle.current_bid,
      date: vehicle.auction_end_date || null,
      source: vehicle.auction_source || undefined,
      note: vehicle.bid_count ? `${vehicle.bid_count} bids` : undefined
    });

    pushEntry({
      id: 'purchase',
      label: 'Purchase Price',
      amount: vehicle.purchase_price,
      date: (vehicle as any)?.purchase_date || null,
      source: fieldSource('purchase_price', 'Owner provided'),
      confidence: fieldConfidence('purchase_price')
    });

    const estimatedValue = valuation && typeof valuation.estimatedValue === 'number'
      ? valuation.estimatedValue
      : (vehicle.current_value || null);
    pushEntry({
      id: 'estimate',
      label: 'Estimated Value',
      amount: estimatedValue as number,
      date: valuation?.lastUpdated || null,
      source: valuation?.dataSources?.length ? valuation.dataSources[0] : 'Valuation engine',
      confidence: valuation?.confidence
    });

    pushEntry({
      id: 'msrp',
      label: 'Original MSRP',
      amount: vehicle.msrp,
      date: vehicle.year ? `${vehicle.year}` : undefined,
      source: 'Factory data'
    });

    const order = ['sale', 'bat_sale', 'asking', 'auction', 'estimate', 'purchase', 'msrp'];
    const priority = (id: string) => {
      const idx = order.indexOf(id);
      return idx === -1 ? order.length : idx;
    };
    return entries
      .filter((entry, index, self) =>
        entry && typeof entry.amount === 'number' &&
        self.findIndex(s => s.label === entry.label && s.amount === entry.amount) === index
      )
      .sort((a, b) => priority(a.id) - priority(b.id));
  }, [vehicle, valuation]);

  // "saleDate" is used purely for the small "Xd ago" indicator.
  // For unsold auctions (RNM / bid-to), we prefer the auction end date so the user still sees recency.
  const saleDate = (() => {
    const v: any = vehicle as any;
    const explicit = v?.sale_date || v?.bat_sale_date || ((auctionPulse as any)?.sold_at ?? null);
    if (explicit) return explicit;

    const externalListing = v?.external_listings?.[0];
    const activeListing: any = auctionPulse || externalListing;
    const end = activeListing?.end_date || v?.auction_end_date || v?.origin_metadata?.auction_times?.auction_end_date || null;
    if (!end) return null;
    try {
      const t = new Date(end).getTime();
      if (Number.isFinite(t) && t <= Date.now()) return end;
    } catch {}
    return null;
  })();
  const primaryPrice = getDisplayValue();
  const primaryAmount = typeof primaryPrice.amount === 'number' ? primaryPrice.amount : null;
  const primaryLabel = primaryPrice.label || 'Price pending';
  // "saleDate" may represent an auction close date for unsold auctions (e.g., RNM "bid to").
  // Only label as "Sold price" when we have an explicit sold signal.
  const vehicleOutcome = String((vehicle as any)?.auction_outcome || '').toLowerCase();
  const vehicleSaleStatus = String((vehicle as any)?.sale_status || '').toLowerCase();
  const pulseStatus = auctionPulse?.listing_url ? String(auctionPulse.listing_status || '').toLowerCase() : '';
  const pulseFinal = parseMoneyNumber((auctionPulse as any)?.final_price);
  const pulseSoldAt = (auctionPulse as any)?.sold_at ?? null;
  const isSoldContext =
    vehicleSaleStatus === 'sold' ||
    vehicleOutcome === 'sold' ||
    (pulseStatus === 'sold' && (pulseFinal !== null || !!pulseSoldAt));
  const priceDescriptor = isSoldContext ? 'Sold price' : primaryLabel;
  
  // Calculate days since sale validation (sale date)
  const daysSinceSale = useMemo(() => {
    if (!saleDate) return null;
    try {
      const sale = new Date(saleDate).getTime();
      if (!Number.isFinite(sale)) return null;
      const diffMs = Date.now() - sale;
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return days >= 0 ? days : null;
    } catch {
      return null;
    }
  }, [saleDate]);
  
  // For RNM (Reserve Not Met), show blurred high bid instead of "Set a price"
  const isRNM = (() => {
    const outcome = String((vehicle as any)?.auction_outcome || '').toLowerCase();
    if (outcome === 'reserve_not_met' || outcome === 'no_sale') return true;
    const status = auctionPulse?.listing_url ? String(auctionPulse.listing_status || '').toLowerCase() : '';
    if (status === 'reserve_not_met' || status === 'no_sale') return true;

    // Fall back to reserve_status (vehicle + external listing metadata).
    const reserve = String((vehicle as any)?.reserve_status || '').toLowerCase();
    const extReserve = String(((vehicle as any)?.external_listings?.[0]?.metadata?.reserve_status) || '').toLowerCase();
    const hasRNMFlag = reserve === 'reserve_not_met' || extReserve === 'reserve_not_met';
    if (!hasRNMFlag) return false;

    // Only show RNM once the auction has ended (avoid misleading RNM during a live auction).
    const v: any = vehicle as any;
    const externalListing = v?.external_listings?.[0];
    const activeListing: any = auctionPulse || externalListing;
    const endDate = activeListing?.end_date || v?.auction_end_date || null;
    if (endDate) {
      const end = new Date(endDate).getTime();
      if (Number.isFinite(end)) return end <= Date.now();
    }
    // If we can't determine end date, be conservative.
    return false;
  })();
  const highBid = (vehicle as any)?.high_bid || (vehicle as any)?.winning_bid;
  const priceDisplay = useMemo(() => {
    // HIGHEST PRIORITY: If vehicle has a sale_price, always show it (overrides auction pulse)
    const vehicleSalePrice = parseMoneyNumber((vehicle as any)?.sale_price);
    const vehicleSaleDate = (vehicle as any)?.sale_date || saleDate;
    const vehicleIsSold = vehicleSaleDate !== null || 
                         String((vehicle as any)?.sale_status || '').toLowerCase() === 'sold' ||
                         String((vehicle as any)?.auction_outcome || '').toLowerCase() === 'sold';
    
    // If vehicle is sold and has sale_price, show it (no "Bid:" prefix)
    if (vehicleIsSold && vehicleSalePrice) {
      return formatCurrency(vehicleSalePrice);
    }
    
    // If we have external auction telemetry, reflect it directly in the header.
    // Check both auctionPulse and external_listings for the most up-to-date data
    const v: any = vehicle as any;
    const externalListing = v?.external_listings?.[0];
    const activeListing = auctionPulse || externalListing;
    
    if (activeListing?.listing_url || activeListing) {
      // CRITICAL: Use end_date to determine if auction is truly live (more reliable than status field)
      const endDate = activeListing.end_date;
      const endTimestamp = endDate ? new Date(endDate).getTime() : 0;
      const isLive = Number.isFinite(endTimestamp) && endTimestamp > Date.now();
      
      const status = String(activeListing.listing_status || '').toLowerCase();
      const isSold = status === 'sold';
      const isEnded = (status === 'ended' || status === 'reserve_not_met') && !isLive; // Only ended if past end_date
      
      // Get current_bid from the most up-to-date source
      const currentBid = parseMoneyNumber((activeListing as any).current_bid);
      
      // Live auction: show current bid (only if vehicle isn't sold)
      if (isLive && !vehicleIsSold && currentBid) {
        return `Bid: ${formatCurrency(currentBid)}`;
      }
      if (isLive && !vehicleIsSold) return 'BID';
      
      // Sold: show final price (NO "Bid:" prefix) or SOLD badge
      if (isSold) {
        const finalPrice = parseMoneyNumber((activeListing as any).final_price) ?? vehicleSalePrice;
        if (finalPrice) {
          // Don't show "Bid:" prefix for sold vehicles - just show the price
          return formatCurrency(finalPrice);
        }
        return 'SOLD';
      }
      
      // Ended/RNM: show final price, high bid, or sale price if available (NO "Bid:" prefix)
      if (isEnded) {
        const finalPrice = parseMoneyNumber((activeListing as any).final_price);
        const winBid = parseMoneyNumber((vehicle as any)?.winning_bid);
        const hBid = parseMoneyNumber((vehicle as any)?.high_bid);
        
        // Prioritize sale price over bid amounts for ended auctions
        if (vehicleSalePrice) return formatCurrency(vehicleSalePrice);
        if (finalPrice) return formatCurrency(finalPrice);
        if (winBid) return formatCurrency(winBid);
        if (hBid) return formatCurrency(hBid);
        
        // If we have asking price and it's marked for sale, show it
        const askingPrice = typeof (vehicle as any)?.asking_price === 'number' && (vehicle as any).asking_price > 0 && ((vehicle as any).is_for_sale === true || String((vehicle as any).sale_status || '').toLowerCase() === 'for_sale')
          ? (vehicle as any).asking_price
          : null;
        if (askingPrice) return formatCurrency(askingPrice);
        
        // For ended auctions without price, don't show "Auction" - show status or nothing
        if (status === 'reserve_not_met') return 'RNM';
        // Don't show "Ended" or "Auction" - fall through to show price from primaryAmount if available
      }
      
      // Unknown status: fall through to primary amount
    }

    // Check if vehicle is sold (sale_date exists or sale_status is 'sold')
    const isSold = vehicleSaleDate !== null || 
                   String((vehicle as any)?.sale_status || '').toLowerCase() === 'sold' ||
                   String((vehicle as any)?.auction_outcome || '').toLowerCase() === 'sold';

    // Check for future auction date - if we have one and would show "Set a price", show the auction date instead
    if (futureAuctionListing && primaryAmount === null && !isRNM && !isSold) {
      // Check start_date, end_date, or metadata.sale_date
      const auctionDate = futureAuctionListing.start_date || 
                          futureAuctionListing.end_date || 
                          futureAuctionListing.metadata?.sale_date;
      if (auctionDate) {
        const dateTime = new Date(auctionDate).getTime();
        if (Number.isFinite(dateTime) && dateTime > Date.now()) {
          // Format date as compact "JAN 17" badge style
          try {
            const d = new Date(auctionDate);
            const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
            const day = d.getDate();
            return `${month} ${day}`;
          } catch {
            // Fall through to default
          }
        }
      }
    }

    // Fallback to primary amount or RNM high bid
    return primaryAmount !== null
      ? formatCurrency(primaryAmount)
      : (isRNM && highBid)
        ? formatCurrency(highBid)
        : isSold
          ? 'SOLD'
          : 'Set a price';
  }, [vehicle, auctionPulse, futureAuctionListing, primaryAmount, isRNM, highBid, saleDate]);

  const priceHoverText = (() => {
    // Hover reveals more detail (without adding noise to the visible header).
    if (auctionPulse?.listing_url) {
      const status = String(auctionPulse.listing_status || '').toLowerCase();
      const isSold = status === 'sold';
      const isLive = status === 'active' || status === 'live';
      const finalPrice = parseMoneyNumber((auctionPulse as any).final_price);
      if (isSold && finalPrice) {
        return `Sold price: ${formatCurrency(finalPrice)}`;
      }
      const bid = parseMoneyNumber((auctionPulse as any).current_bid);
      if (isLive && bid) {
        return `Current bid: ${formatCurrency(bid)}`;
      }
    }
    if (primaryAmount !== null) return `${priceDescriptor}: ${formatCurrency(primaryAmount)}`;
    return null;
  })();
  
  // Auction outcome badge and link
  const getAuctionContext = () => {
    if (suppressExternalListing || hasClaim) {
      return { badge: null, link: null, outcome: null };
    }
    const badges: Record<string, any> = {
      sold: { text: 'SOLD', color: '#22c55e', bg: '#dcfce7' },
      reserve_not_met: { text: 'RNM', color: '#f59e0b', bg: '#fef3c7' },
      no_sale: { text: 'NO SALE', color: '#6b7280', bg: '#f3f4f6' },
      pending: { text: 'LIVE', color: '#3b82f6', bg: '#dbeafe' }
    };
    
    const rawOutcome = String((vehicle as any)?.auction_outcome || '').toLowerCase();
    const saleStatus = String((vehicle as any)?.sale_status || '').toLowerCase();
    const reserveStatus = String((vehicle as any)?.reserve_status || '').toLowerCase();
    const extReserveStatus = String(((vehicle as any)?.external_listings?.[0]?.metadata?.reserve_status) || '').toLowerCase();
    const batUrl = (vehicle as any)?.bat_auction_url || ((vehicle as any)?.discovery_url?.includes('bringatrailer') ? (vehicle as any)?.discovery_url : null);
    const kslUrl = (vehicle as any)?.discovery_url?.includes('ksl.com') ? (vehicle as any)?.discovery_url : null;
    const sourceUrl = batUrl || kslUrl || (vehicle as any)?.discovery_url;
    
    // Never allow conflicting states like "SOLD RNM".
    // Check auction_outcome FIRST - it's the most authoritative
    // RNM/No Sale takes precedence over sale_price (high bid != sold)
    const telemetryStatus = auctionPulse?.listing_url ? String(auctionPulse.listing_status || '').toLowerCase() : '';

    const derivedOutcome =
      rawOutcome ||
      (telemetryStatus === 'reserve_not_met' || telemetryStatus === 'no_sale' ? telemetryStatus : '') ||
      (extReserveStatus === 'reserve_not_met' ? 'reserve_not_met' : '') ||
      (reserveStatus === 'reserve_not_met' ? 'reserve_not_met' : '') ||
      '';
    
    // If either vehicle or telemetry explicitly says RNM/No Sale, use that (do NOT override with numeric prices)
    const explicitUnsold =
      telemetryStatus === 'reserve_not_met' || telemetryStatus === 'no_sale'
        ? telemetryStatus
        : (derivedOutcome === 'reserve_not_met' || derivedOutcome === 'no_sale')
          ? derivedOutcome
          : null;
    if (explicitUnsold) {
      const outcome = explicitUnsold;
      return {
        badge: badges[outcome] || null,
        link: sourceUrl,
        outcome: outcome
      };
    }
    
    // SOLD requires a real sold signal (status/outcome/sold_at), not merely a numeric price.
    const pulseFinal = parseMoneyNumber((auctionPulse as any)?.final_price);
    const pulseSoldAt = (auctionPulse as any)?.sold_at ?? null;
    const hasSoldSignal =
      rawOutcome === 'sold' ||
      saleStatus === 'sold' ||
      (telemetryStatus === 'sold' && (pulseFinal !== null || !!pulseSoldAt));

    const outcome = hasSoldSignal ? 'sold' : (derivedOutcome || null);

    // RNM is only valid once the auction has ended (or the platform explicitly reports RNM).
    // If an auction is still live/active, showing RNM is misleading.
    const outcomeIsFinal = (() => {
      if (!outcome) return false;
      if (outcome === 'sold') return true;
      if (outcome !== 'reserve_not_met') return true;

      // Prefer live telemetry when available.
      const v: any = vehicle as any;
      const externalListing = v?.external_listings?.[0];
      const activeListing = auctionPulse || externalListing;
      
      if (activeListing?.listing_url || activeListing) {
        const status = String(activeListing.listing_status || '').toLowerCase();
        if (status === 'reserve_not_met' || status === 'ended' || status === 'sold') return true;
        if (status === 'active' || status === 'live') return false;
        const endDate = activeListing.end_date || timerEndDate;
        if (endDate) {
          const end = new Date(endDate).getTime();
          if (Number.isFinite(end)) return end <= auctionNow;
        }
        return false;
      }

      // Fallback to vehicle-level auction_end_date if present.
      const endDate = (vehicle as any)?.auction_end_date;
      if (endDate) {
        const end = new Date(endDate).getTime();
        if (Number.isFinite(end)) return end <= Date.now();
      }
      return false;
    })();
    
    return {
      badge: outcome && outcomeIsFinal ? badges[outcome] : null,
      link: sourceUrl,
      outcome: outcome
    };
  };
  
  const auctionContext = getAuctionContext();
  
  // Check if price was auto-corrected (e.g., "15" -> "15000")
  const priceWasCorrected = (vehicle as any)?.origin_metadata?.price_corrected === true ||
                            (vehicle as any)?.origin_metadata?.price_was_corrected === true;
  
  // Build full vehicle identity: Year, Make, Model, Series, Trim
  // Example: "1985 GMC K10 Wagon" -> "1985 GMC K10" (no body style, include series/trim if available)
  // Prefer normalized_model over raw model
  const displayModel = (vehicle as any)?.normalized_model || vehicle?.model;

  // Shared helper (must be in outer scope; used by multiple helpers below)
  const escapeRegExp = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const extractMileageFromText = (text: string | null | undefined): number | null => {
    if (!text) return null;
    const km = text.match(/\b(\d{1,3}(?:,\d{3})?)\s*[kK]\s*[-\s]*mile\b/);
    if (km?.[1]) return parseInt(km[1].replace(/,/g, ''), 10) * 1000;
    const mile = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{1,6})\s*[-\s]*mile\b/i);
    if (mile?.[1]) return parseInt(mile[1].replace(/,/g, ''), 10);
    const odo = text.match(/\bodometer\s+shows\s+(\d{1,3}(?:,\d{3})+|\d{1,6})\b/i);
    if (odo?.[1]) return parseInt(odo[1].replace(/,/g, ''), 10);
    return null;
  };

  const cleanListingishTitle = (raw: string, year?: number | null, make?: string | null): string => {
    let s = String(raw || '').trim();
    if (!s) return s;

    // Drop the trailing site name (often after a pipe)
    s = s.split('|')[0].trim();

    // Remove common BaT boilerplate
    s = s.replace(/\bon\s+BaT\s+Auctions\b/gi, '').trim();
    s = s.replace(/\bBaT\s+Auctions\b/gi, '').trim();
    s = s.replace(/\bBring\s+a\s+Trailer\b/gi, '').trim();
    
    // Fix numeric model designations like "3 0csi" -> "3.0 CSi"
    // Pattern: single digit, space, digit, lowercase letters (e.g., "3 0csi", "5 30si")
    s = s.replace(/\b(\d)\s+(\d)([a-z]+)\b/gi, (match, d1, d2, suffix) => {
      // Handle special BMW model suffixes: "CSi" should have CS uppercase, i lowercase
      // Other common patterns: "CSI" -> "CSi", "csi" -> "CSi"
      let formattedSuffix = suffix.toLowerCase();
      if (formattedSuffix === 'csi') {
        formattedSuffix = 'CSi';
      } else {
        // For other suffixes, capitalize first letter (default behavior)
        formattedSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1);
      }
      return `${d1}.${d2} ${formattedSuffix}`;
    });
    s = s.replace(/\bending\b[\s\S]*$/i, '').trim();

    // Remove lot number parenthetical
    s = s.replace(/\(\s*Lot\s*#.*?\)\s*/gi, ' ').trim();

    // Remove leading mileage words like "42k-mile"
    s = s.replace(/^\s*\d{1,3}(?:,\d{3})?\s*[kK]\s*[-\s]*mile\s+/i, '').trim();
    s = s.replace(/^\s*\d{1,3}(?:,\d{3})+\s*[-\s]*mile\s+/i, '').trim();

    // Remove leading year (we render year separately)
    if (typeof year === 'number') {
      const yr = escapeRegExp(String(year));
      s = s.replace(new RegExp(`^\\s*${yr}\\s+`, 'i'), '').trim();
    } else {
      s = s.replace(/^\s*(19|20)\d{2}\s+/, '').trim();
    }

    // Remove leading make if it already exists (avoid "Porsche Porsche ...")
    if (make) {
      const mk = String(make).trim();
      if (mk) s = s.replace(new RegExp(`^\\s*${escapeRegExp(mk)}\\s+`, 'i'), '').trim();
    }

    // Remove contaminated listing patterns: "Model - COLOR - $Price (Location)"
    if (s.includes(' - $') || (s.includes(' - ') && s.match(/\$[\d,]+/))) {
      const parts = s.split(/\s*-\s*(?=\$|\([A-Z])/);
      if (parts.length > 0) {
        s = parts[0].trim();
      }
    }
    
    // Remove color patterns that might still be present
    s = s.replace(/\s*-\s*(BLACK|WHITE|RED|BLUE|GREEN|SILVER|GRAY|GREY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|TAN)\s*$/i, '').trim();
    
    // Remove location patterns like "(Torrance)", "(Los Angeles)"
    s = s.replace(/\s*\([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\)\s*$/g, '').trim();

    // Collapse whitespace + trim dangling separators.
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[-–—]\s*$/g, '').trim();

    // Guardrails: if it's still a paragraph, treat as unusable.
    if (s.length > 80) return '';
    return s;

    // Remove contaminated listing patterns: "Model - COLOR - $Price (Location)"
    if (s.includes(' - $') || (s.includes(' - ') && s.match(/\$[\d,]+/))) {
      const parts = s.split(/\s*-\s*(?=\$|\([A-Z])/);
      if (parts.length > 0) {
        s = parts[0].trim();
      }
    }
    
    // Remove color patterns that might still be present
    s = s.replace(/\s*-\s*(BLACK|WHITE|RED|BLUE|GREEN|SILVER|GRAY|GREY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|TAN)\s*$/i, '').trim();
    
    // Remove location patterns like "(Torrance)", "(Los Angeles)"
    s = s.replace(/\s*\([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\)\s*$/g, '').trim();

    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    // Trim trailing separators from previous removals
    s = s.replace(/[-–—]\s*$/g, '').trim();
    return s;
  };

  const appendUnique = (arr: Array<string | number>, part: any) => {
    const p = String(part || '').trim();
    if (!p) return;
    const existing = arr.map(v => String(v).toLowerCase());
    const lower = p.toLowerCase();
    if (existing.some(e => e === lower || e.includes(lower) || lower.includes(e))) return;
    arr.push(p);
  };

  const normalizeListingLocation = (raw: any): string | null => {
    let s = String(raw ?? '').trim();
    if (!s) return null;

    // Some scraped sources accidentally concatenate adjacent CTA/link text into the "location" field.
    // Example: "United StatesView all listingsNotify me about new listings"
    const junkPhrases = ['View all listings', 'Notify me about new listings'];
    for (const phrase of junkPhrases) {
      // allow missing or weird whitespace in the concatenated string
      const re = new RegExp(escapeRegExp(phrase).replace(/\s+/g, '\\s*'), 'gi');
      s = s.replace(re, ' ');
    }

    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[•·|,;:–—-]\s*$/g, '').trim();
    return s || null;
  };

  const derivedMileage = useMemo(() => {
    if (typeof (vehicle as any)?.mileage === 'number') return (vehicle as any).mileage as number;
    return extractMileageFromText(String(displayModel || ''));
  }, [vehicle, displayModel]);
  const mileageIsExact = typeof (vehicle as any)?.mileage === 'number';

  const listingUrl = (vehicle as any)?.listing_url || (vehicle as any)?.discovery_url || null;
  const listingLocationRaw =
    (vehicle as any)?.listing_location ||
    (vehicle as any)?.location ||
    (vehicle as any)?.origin_metadata?.listing_location ||
    (vehicle as any)?.origin_metadata?.location ||
    null;
  const listingLocation = normalizeListingLocation(listingLocationRaw);
  const listingSourceLabel =
    String((vehicle as any)?.listing_source || (vehicle as any)?.discovery_source || '').trim() || null;
  const listingHost = (() => {
    if (!listingUrl) return null;
    try {
      const host = new URL(String(listingUrl)).hostname;
      return host.startsWith('www.') ? host.slice(4) : host;
    } catch {
      return null;
    }
  })();

  const auctionListingUrl =
    String(
      (auctionPulse as any)?.listing_url ||
        (vehicle as any)?.bat_auction_url ||
        (vehicle as any)?.listing_url ||
        (vehicle as any)?.discovery_url ||
        ''
    ).trim() || null;
  const auctionHost = (() => {
    if (!auctionListingUrl) return null;
    try {
      const host = new URL(String(auctionListingUrl)).hostname;
      return host.startsWith('www.') ? host.slice(4) : host;
    } catch {
      return null;
    }
  })();
  const auctionHouseLabel = formatAuctionHouseLabel(
    String((auctionPulse as any)?.platform || (vehicle as any)?.auction_source || '').trim() || null,
    auctionHost,
    listingSourceLabel || listingHost || null,
  );
  const headerLocationLabel =
    (locationDisplay?.short && locationDisplay.short !== ':' ? locationDisplay.short : null) ||
    listingLocation ||
    (vehicle as any)?.bat_location ||
    null;
  const headerLocationTitle =
    (locationDisplay?.full || locationDisplay?.short) ||
    listingLocation ||
    (vehicle as any)?.bat_location ||
    null;

  const identityParts = vehicle ? [vehicle.year, vehicle.make].filter(Boolean) : [];
  const cleanedModelForHeader = cleanListingishTitle(String(displayModel || ''), vehicle?.year ?? null, vehicle?.make ?? null);
  appendUnique(identityParts, cleanedModelForHeader);
  appendUnique(identityParts, (vehicle as any).series);
  appendUnique(identityParts, (vehicle as any).trim);

  const identityLabel = identityParts.join(' ').trim() || 'Vehicle';
  
  const lastSoldText = saleDate ? `Last sold ${formatShortDate(saleDate)}` : 'Off-market estimate';
  const canOpenOwnerCard = Boolean(responsibleName);

  const baseTextColor = 'var(--text)';
  const mutedTextColor = 'var(--text-muted)';
  const hasAuctionContext = Boolean(
    (auctionPulse as any)?.listing_url ||
      (vehicle as any)?.auction_end_date ||
      (vehicle as any)?.auction_outcome ||
      (vehicle as any)?.auction_source ||
      (vehicle as any)?.bat_auction_url ||
      (vehicle as any)?.listing_kind === 'auction'
  );
  const headerSeller = useMemo(() => {
    if (!hasAuctionContext) return null;
    if (sellerBadge?.label) {
      const relationship = String((sellerBadge as any)?.relationship || '').toLowerCase();
      const roleLabel = formatSellerRoleLabel(relationship, (sellerBadge as any)?.business_type || null);
      const label = String(sellerBadge.label || '').trim();
      if (!label) return null;
      return {
        roleLabel,
        label,
        href: (sellerBadge as any)?.href || null,
        title: `${roleLabel}: ${label}`,
      };
    }

    const sellerHandle = normalizePartyHandle(
      (auctionPulse as any)?.seller_username ||
        (auctionPulse as any)?.metadata?.seller_username ||
        (auctionPulse as any)?.metadata?.seller ||
        (vehicle as any)?.bat_seller ||
        (vehicle as any)?.origin_metadata?.bat_seller ||
        (vehicle as any)?.origin_metadata?.seller ||
        null
    );
    if (!sellerHandle) return null;
    return {
      roleLabel: 'Seller',
      label: `@${sellerHandle}`,
      href: batIdentityHref?.seller?.href || null,
      title: `Seller: @${sellerHandle}`,
    };
  }, [hasAuctionContext, sellerBadge, auctionPulse, vehicle, batIdentityHref]);
  const headerBuyer = useMemo(() => {
    if (!hasAuctionContext) return null;
    const outcome = auctionContext?.outcome;
    const isUnsold = outcome === 'reserve_not_met' || outcome === 'no_sale' || isRNM;
    const winnerHandle =
      normalizePartyHandle(
        (auctionPulse as any)?.winner_name ||
          (auctionPulse as any)?.metadata?.buyer_username ||
          (auctionPulse as any)?.metadata?.buyer ||
          (auctionPulse as any)?.winning_bidder_name ||
          (auctionPulse as any)?.winner_display_name ||
          (vehicle as any)?.bat_buyer ||
          (vehicle as any)?.origin_metadata?.bat_buyer ||
          (vehicle as any)?.origin_metadata?.buyer ||
          null
      ) ||
      (ownerGuess?.role === 'buyer' ? normalizePartyHandle(ownerGuess.username) : null);
    const winnerHref =
      batIdentityHref?.winner?.handle && winnerHandle && batIdentityHref.winner.handle === winnerHandle
        ? batIdentityHref.winner.href
        : null;
    const highBidderHandle = normalizePartyHandle(
      (auctionPulse as any)?.metadata?.high_bidder_username ||
        (auctionPulse as any)?.metadata?.high_bidder ||
        (auctionPulse as any)?.metadata?.current_bidder ||
        (auctionPulse as any)?.metadata?.current_bidder_username ||
        null
    );
    const currentBid =
      parseMoneyNumber((auctionPulse as any)?.current_bid) ??
      parseMoneyNumber((vehicle as any)?.current_bid) ??
      null;

    if (isAuctionLive) {
      if (highBidderHandle) {
        return {
          label: `High Bidder: @${highBidderHandle}`,
          href: null,
          tone: 'neutral',
        };
      }
      if (currentBid) {
        return {
          label: `High Bid: ${formatCurrency(currentBid)}`,
          tone: 'neutral',
        };
      }
      return { label: 'High Bid: —', tone: 'muted' };
    }

    if (isSoldContext) {
      if (winnerHandle) {
        return {
          label: `Winner: @${winnerHandle}`,
          href: winnerHref,
          tone: 'success',
        };
      }
      return { label: 'Winner: Unverified', tone: 'success' };
    }

    if (isUnsold) {
      const text = outcome === 'no_sale' ? 'NO SALE' : 'RNM';
      return { label: text, tone: 'muted' };
    }
    return null;
  }, [hasAuctionContext, auctionContext?.outcome, isRNM, auctionPulse, vehicle, isAuctionLive, isSoldContext, ownerGuess, batIdentityHref]);
  const headerCountdown = useMemo(() => {
    if (!hasAuctionContext || !timerEndDate) return null;
    const rawLabel = formatCountdownClock(timerEndDate, true) || formatRemaining(timerEndDate);
    if (!rawLabel) return null;
    if (rawLabel === 'Ended') return null;
    const label = `Ends ${rawLabel}`;
    const title = timerEndDate
      ? `Auction ends in ${formatRemaining(timerEndDate) || rawLabel}`
      : 'Auction countdown';
    return {
      label,
      title,
      isLive: isAuctionLive,
    };
  }, [hasAuctionContext, timerEndDate, isAuctionLive, auctionNow]);
  const headerAuctionHouse = useMemo(() => {
    if (!auctionHouseLabel) return null;
    return { label: auctionHouseLabel, url: auctionListingUrl };
  }, [auctionHouseLabel, auctionListingUrl]);
  const bidCta = useMemo(() => {
    if (!isAuctionLive || !auctionListingUrl) return null;
    const currentBid = parseMoneyNumber((auctionPulse as any)?.current_bid);
    const label = currentBid ? `Bid ${formatCurrency(currentBid)}` : 'Bid';
    return { label, url: auctionListingUrl };
  }, [isAuctionLive, auctionListingUrl, auctionPulse]);
  const trendIndicator = useMemo(() => {
    if (trendPct === null) return null;
    const positive = trendPct >= 0;
    const color = positive ? '#22c55e' : '#ef4444';
    const triangleStyle = positive
      ? {
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderBottom: `7px solid ${color}`
        }
      : {
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `7px solid ${color}`
        };
    
    const periodLabel = trendPeriod.toUpperCase();
    const baselineLabel =
      (typeof trendBaselineValue === 'number' && Number.isFinite(trendBaselineValue) && trendBaselineAsOf)
        ? `Baseline: ${trendBaselineValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} on ${new Date(String(trendBaselineAsOf)).toLocaleDateString()} (${String(trendBaselineSource || 'auto').toUpperCase()})`
        : null;
    const outlierLabel =
      (typeof trendOutlierCount === 'number' && trendOutlierCount > 0)
        ? `Filtered ${trendOutlierCount} outlier${trendOutlierCount === 1 ? '' : 's'}`
        : null;
    
    return (
      <span 
        onClick={toggleTrendPeriod}
        title={[
          `Click to toggle period (Current: ${periodLabel})`,
          baselineLabel,
          outlierLabel,
        ].filter(Boolean).join(' • ')}
        style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: 3, 
          fontSize: '8px', 
          color,
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <span style={{ width: 0, height: 0, ...triangleStyle, borderWidth: '4px', borderTopWidth: positive ? '0' : '5px', borderBottomWidth: positive ? '5px' : '0' }} />
        {`${positive ? '+' : ''}${trendPct.toFixed(1)}%`}
        <span style={{ fontSize: '7px', color: mutedTextColor, marginLeft: '1px' }}>
          {periodLabel}
        </span>
      </span>
    );
  }, [trendPct, trendPeriod, trendBaselineValue, trendBaselineAsOf, trendBaselineSource, trendOutlierCount]);

  const handleViewValuation = () => {
    setPriceMenuOpen(false);
    if (onPriceClick && typeof onPriceClick === 'function') {
    onPriceClick();
    }
  };

  const handleTradeClick = () => {
    setPriceMenuOpen(false);
    setShowTrade(true);
  };

  const responsibleLabel = computeResponsibleLabel();

  // Pending should reflect workflow state, not data completeness.
  // Data gaps like missing VIN are common for scraped listings and should not mark the profile "Pending"
  // if the vehicle is otherwise active/public.
  const hasVIN = vehicle?.vin && vehicle.vin.trim() !== '' && !vehicle.vin.startsWith('VIVA-');
  const vehicleStatus = String((vehicle as any)?.status || '').toLowerCase();
  const isPending = vehicle && (vehicleStatus === 'pending' || vehicleStatus === 'draft');
  const needsVIN = isPending && !hasVIN;
  const needsImages = isPending && imageCount === 0;
  const pendingReasons: string[] = [];
  if (needsVIN) pendingReasons.push('VIN');
  if (needsImages) pendingReasons.push('images');
  const pendingReasonText = pendingReasons.length > 0 ? `Missing: ${pendingReasons.join(' and ')}` : 'Pending review';

  // Close pending details when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pendingDetailsRef.current && !pendingDetailsRef.current.contains(event.target as Node)) {
        setShowPendingDetails(false);
      }
    };
    if (showPendingDetails) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPendingDetails]);


  return (
    <div
      className="vehicle-price-header"
      style={{
        position: 'sticky',
        top: 'var(--header-height, 40px)',
        zIndex: 900,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0px 8px',
        margin: 0,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 'calc(-1 * var(--space-2))',
        marginRight: 'calc(-1 * var(--space-2))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: '0px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        justifyContent: 'flex-start', 
        alignItems: 'center', 
        gap: '8px', 
        rowGap: '4px',
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: '31px',
        height: 'auto',
        // Allow dropdowns + multi-row badges to render below the sticky header.
        overflow: 'visible',
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 2,
        paddingBottom: 2,
        position: 'static'
      }}>
        {/* 1. Title */}
        <div style={{ flex: '0 1 auto', minWidth: 0, color: baseTextColor, display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '8pt', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
            {identityLabel}
          </span>
        </div>

        {/* 2. Badges Section */}
        <div className="vehicle-header-badges" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, rowGap: 4, alignItems: 'center', flexShrink: 0, overflow: 'visible', maxWidth: '100%' }}>
          {typeof derivedMileage === 'number' && derivedMileage > 0 ? (
            <div className="badge-priority-2">
            <OdometerBadge mileage={derivedMileage} year={vehicle?.year ?? null} isExact={mileageIsExact} />
            </div>
          ) : null}

          {/* Meme Drop Count Badge */}
          {vehicle?.id && (
            <div className="badge-priority-4">
              <MemeDropBadge vehicleId={vehicle.id} compact />
            </div>
          )}

          {/* Access badge: explain why owners/responsible parties see extra tools */}
          {(() => {
            const isOwnerish = Boolean(permissions?.isVerifiedOwner || isOwner);
            const isResponsible = Boolean(!isOwnerish && permissions?.hasContributorAccess);
            const label = isOwnerish ? 'OWNER' : isResponsible ? 'RESP' : null;
            if (!label) return null;

            return (
              <div ref={accessRef} className="badge-priority-3" style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAccessInfo((prev) => !prev);
                  }}
                  style={{
                    fontSize: '9px',
                    fontWeight: 800,
                    fontFamily: 'monospace',
                    letterSpacing: '0.5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    padding: '2px 4px',
                    color: label === 'OWNER' ? '#15803d' : '#1d4ed8',
                    textTransform: 'uppercase'
                  }}
                  title="Why does this vehicle profile look different?"
                >
                  {label}
                  <span style={{ marginLeft: 4, fontSize: '8px', color: 'var(--text-muted)', fontWeight: 700 }}>?</span>
                </button>

                {showAccessInfo && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      zIndex: 1000,
                      background: 'var(--bg)',
                      border: '2px solid var(--border)',
                      padding: '10px 12px',
                      width: '280px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                      marginTop: '4px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ fontWeight: 800, fontSize: '9pt', marginBottom: 6 }}>
                      Why does this profile look different?
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      You’re seeing extra tools because you’re a <strong>{label === 'OWNER' ? 'verified owner' : 'responsible party'}</strong> on this vehicle.
                      <div style={{ marginTop: 6 }}>
                        Examples: Proof tasks, uploading receipts, generating draft invoices, editing timeline/work.
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => setShowAccessInfo(false)}
                        style={{ fontSize: '9px', fontWeight: 700 }}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Auction metadata (seller/location/house/buyer/timer) */}
          {hasAuctionContext && (
            <>
              {headerSeller && (
                <div className="badge-priority-3">
                  {headerSeller.href ? (
                    <a
                      href={headerSeller.href}
                      onClick={(e) => e.stopPropagation()}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                      title={headerSeller.title}
                    >
                      <span
                        className="badge"
                        style={{
                          fontSize: '8px',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: baseTextColor,
                          lineHeight: 1,
                        }}
                      >
                        {headerSeller.roleLabel}: {headerSeller.label}
                      </span>
                    </a>
                  ) : (
                    <span
                      className="badge"
                      title={headerSeller.title}
                      style={{
                        fontSize: '8px',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: baseTextColor,
                        lineHeight: 1,
                      }}
                    >
                      {headerSeller.roleLabel}: {headerSeller.label}
                    </span>
                  )}
                </div>
              )}
              {!locationDisplay?.short && headerLocationLabel && (
                <div className="badge-priority-3">
                  <span
                    className="badge"
                    title={headerLocationTitle || headerLocationLabel}
                    style={{
                      fontSize: '8px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: baseTextColor,
                      lineHeight: 1,
                    }}
                  >
                    LOC {headerLocationLabel}
                  </span>
                </div>
              )}
              {headerAuctionHouse?.label && (() => {
                const platformSource = String(
                  (auctionPulse as any)?.platform ||
                  (vehicle as any)?.profile_origin ||
                  (vehicle as any)?.discovery_source ||
                  ''
                ).trim();
                const isClassified = isClassifiedPlatform(platformSource);
                const classifiedSellerName = String(
                  (vehicle as any)?.origin_metadata?.seller_name ||
                  (vehicle as any)?.origin_metadata?.seller ||
                  ''
                ).trim() || null;

                if (isClassified) {
                  // For classifieds: show favicon badge + seller name (if available)
                  const platformUrl = headerAuctionHouse.url || (vehicle as any)?.discovery_url || 'https://facebook.com';
                  return (
                    <>
                      {/* Platform favicon badge */}
                      <div className="badge-priority-3">
                        <a
                          href={headerAuctionHouse.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!headerAuctionHouse.url) e.preventDefault();
                          }}
                          title={headerAuctionHouse.label}
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                          <span
                            className="badge"
                            style={{
                              fontSize: '8px',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              color: baseTextColor,
                              lineHeight: 1,
                            }}
                          >
                            <FaviconIcon url={platformUrl} size={12} style={{ margin: 0 }} />
                          </span>
                        </a>
                      </div>
                      {/* Seller name badge (if available) */}
                      {classifiedSellerName && (
                        <div className="badge-priority-3">
                          <span
                            className="badge"
                            title={`Seller: ${classifiedSellerName}`}
                            style={{
                              fontSize: '8px',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              color: baseTextColor,
                              lineHeight: 1,
                            }}
                          >
                            {classifiedSellerName}
                          </span>
                        </div>
                      )}
                    </>
                  );
                }

                // For auctions: show "Auction: X" format
                return (
                  <div className="badge-priority-3">
                    {headerAuctionHouse.url ? (
                      <a
                        href={headerAuctionHouse.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ textDecoration: 'none', color: 'inherit' }}
                        title={`Auction house: ${headerAuctionHouse.label}`}
                      >
                        <span
                          className="badge"
                          style={{
                            fontSize: '8px',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            color: baseTextColor,
                            lineHeight: 1,
                          }}
                        >
                          Auction: {headerAuctionHouse.label}
                        </span>
                      </a>
                    ) : (
                      <span
                        className="badge"
                        title={`Auction house: ${headerAuctionHouse.label}`}
                        style={{
                          fontSize: '8px',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: baseTextColor,
                          lineHeight: 1,
                        }}
                      >
                        Auction: {headerAuctionHouse.label}
                      </span>
                    )}
                  </div>
                );
              })()}
              {headerBuyer && (
                <div className="badge-priority-3">
                  {headerBuyer.href ? (
                    <a
                      href={headerBuyer.href}
                      onClick={(e) => e.stopPropagation()}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                      title={headerBuyer.label}
                    >
                      <span
                        className="badge"
                        style={{
                          fontSize: '8px',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background:
                            headerBuyer.tone === 'success'
                              ? '#dcfce7'
                              : headerBuyer.tone === 'muted'
                                ? 'var(--grey-100)'
                                : 'var(--surface)',
                          border:
                            headerBuyer.tone === 'success'
                              ? '1px solid #166534'
                              : '1px solid var(--border)',
                          color:
                            headerBuyer.tone === 'success'
                              ? '#166534'
                              : headerBuyer.tone === 'muted'
                                ? mutedTextColor
                                : baseTextColor,
                          lineHeight: 1,
                        }}
                      >
                        {headerBuyer.label}
                      </span>
                    </a>
                  ) : (
                    <span
                      className="badge"
                      title={headerBuyer.label}
                      style={{
                        fontSize: '8px',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background:
                          headerBuyer.tone === 'success'
                            ? '#dcfce7'
                            : headerBuyer.tone === 'muted'
                              ? 'var(--grey-100)'
                              : 'var(--surface)',
                        border:
                          headerBuyer.tone === 'success'
                            ? '1px solid #166534'
                            : '1px solid var(--border)',
                        color:
                          headerBuyer.tone === 'success'
                            ? '#166534'
                            : headerBuyer.tone === 'muted'
                              ? mutedTextColor
                              : baseTextColor,
                        lineHeight: 1,
                      }}
                    >
                      {headerBuyer.label}
                    </span>
                  )}
                </div>
              )}
              {headerCountdown && (
                <div className="badge-priority-3">
                  <span
                    className="badge"
                    title={headerCountdown.title || headerCountdown.label}
                    style={{
                      fontSize: '8px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: baseTextColor,
                      lineHeight: 1,
                    }}
                  >
                    <span
                      className={headerCountdown.isLive ? 'auction-live-dot' : undefined}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: headerCountdown.isLive ? '#dc2626' : '#94a3b8',
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    {headerCountdown.label}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Location Badge with Dropdown */}
          {locationDisplay && locationDisplay.short && locationDisplay.short.trim().length > 0 && locationDisplay.short !== ':' && (
            <div ref={locationRef} className="badge-priority-3" style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowLocationDropdown((prev) => !prev);
                }}
                style={{
                  fontSize: '8px',
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  letterSpacing: '0.5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  padding: '2px 6px',
                  color: 'var(--text)',
                  borderRadius: '4px',
                }}
                title={`Location: ${locationDisplay.full || locationDisplay.short}`}
              >
                LOC {locationDisplay.short}
              </button>
              
              {/* Location Dropdown */}
              {showLocationDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    zIndex: 1000,
                    background: 'var(--bg)',
                    border: '2px solid var(--primary)',
                    padding: '12px',
                    width: '260px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    marginTop: '4px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '8px',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '6px'
                  }}>
                    <span style={{ fontWeight: 'bold', fontSize: '9pt' }}>Last Known Location</span>
                    <button
                      type="button"
                      onClick={() => setShowLocationDropdown(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12pt',
                        color: 'var(--text-muted)',
                      }}
                    >
                      x
                    </button>
                  </div>
                  
                  <div style={{ fontSize: '8pt' }}>
                    {/* Location Details */}
                    <div style={{ marginBottom: '8px' }}>
                      {(vehicle as any)?.city && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: 'var(--text-muted)' }}>City</span>
                          <span>{(vehicle as any).city}</span>
                        </div>
                      )}
                      {(vehicle as any)?.state && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: 'var(--text-muted)' }}>State</span>
                          <span>{(vehicle as any).state}</span>
                        </div>
                      )}
                      {(vehicle as any)?.zip_code && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: 'var(--text-muted)' }}>ZIP Code</span>
                          <span style={{ fontFamily: 'monospace' }}>{(vehicle as any).zip_code}</span>
                        </div>
                      )}
                      {!(vehicle as any)?.zip_code && !(vehicle as any)?.city && (vehicle as any)?.bat_location && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Region</span>
                          <span>{(vehicle as any).bat_location}</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Area Demographics (placeholder - would need API) */}
                    <div style={{ 
                      borderTop: '1px solid var(--border)', 
                      paddingTop: '8px',
                      marginTop: '8px'
                    }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px', color: 'var(--text-muted)', fontSize: '7pt' }}>
                        AREA VEHICLE DEMOGRAPHICS
                      </div>
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        {(vehicle as any)?.zip_code ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                              <span>Similar vehicles nearby</span>
                              <span>--</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                              <span>Avg. market price</span>
                              <span>--</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                              <span>Climate rating</span>
                              <span>--</span>
                            </div>
                          </>
                        ) : (
                          <span>Add ZIP code for area demographics</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Source */}
                    <div style={{ 
                      marginTop: '8px', 
                      paddingTop: '6px', 
                      borderTop: '1px solid var(--border)',
                      fontSize: '6pt',
                      color: 'var(--text-muted)'
                    }}>
                      Source: {(vehicle as any)?.listing_location_source || (vehicle as any)?.bat_location ? 'BaT listing' : 'Vehicle record'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Owner Badge with Claim Dropdown - shows best guess owner (only show if not replacing "Claim this vehicle") */}
          {ownerGuess && !permissions?.isVerifiedOwner && !responsibleName && (
            <div ref={ownerClaimRef} className="badge-priority-5" style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Shift+Click opens the claim/help dropdown. Normal click opens the partner card popover.
                  if (e.shiftKey) {
                    setShowOwnerClaimDropdown((prev) => !prev);
                    setShowOwnerPopover(false);
                    return;
                  }
                  setShowOwnerPopover((prev) => !prev);
                  setShowOwnerClaimDropdown(false);
                }}
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  display: 'inline-flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  background: 'transparent',
                  border: 'none',
                  padding: '2px 4px',
                  color: 'var(--text-muted)',
                  height: '100%',
                }}
                title={`Owner (unverified): @${ownerGuess.username} (Click to view profile. Shift+Click for claim details)`}
              >
                @{ownerGuess.username}<sup style={{ fontSize: '6px', color: 'var(--warning)', marginLeft: '1px' }}>*</sup>
              </button>

              {/* Owner Partner Card Popover */}
              {showOwnerPopover && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    zIndex: 1000,
                    background: 'var(--bg)',
                    border: '2px solid var(--primary)',
                    padding: '12px',
                    width: '320px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    marginTop: '4px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '6px'
                  }}>
                    <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>Partner card</div>
                    <button
                      type="button"
                      onClick={() => setShowOwnerPopover(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12pt',
                        color: 'var(--text-muted)',
                      }}
                      aria-label="Close"
                      title="Close"
                    >
                      x
                    </button>
                  </div>

                  <div style={{ fontSize: '7pt', color: 'var(--text)', lineHeight: 1.4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 800 }}>@{ownerGuess.username}</div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        {ownerGuess.role === 'buyer' ? 'Role: buyer' : ownerGuess.role === 'seller' ? 'Role: seller' : 'Role: unknown'}
                      </div>
                    </div>

                    {ownerGuess.from ? (
                      <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>
                        Prior seller: <span style={{ fontFamily: 'monospace' }}>@{ownerGuess.from}</span>
                      </div>
                    ) : null}

                    {ownerPopoverLoading ? (
                      <div style={{ marginTop: 10, color: 'var(--text-muted)' }}>Loading partner signals...</div>
                    ) : ownerPopoverError ? (
                      <div style={{ marginTop: 10, color: 'var(--error-text, #dc2626)' }}>{ownerPopoverError}</div>
                    ) : ownerPopoverData ? (
                      <>
                        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                          <div style={{ fontWeight: 800, color: 'var(--text-muted)', marginBottom: 6 }}>ACTIVITY</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Auctions won</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ownerPopoverData.auctionsWon}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Auctions sold</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ownerPopoverData.auctionsSold}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Comments</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ownerPopoverData.commentCount}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Last comment</span>
                              <span style={{ fontFamily: 'monospace' }}>
                                {ownerPopoverData.lastCommentAt ? new Date(ownerPopoverData.lastCommentAt).toLocaleDateString() : '—'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                          <div style={{ fontWeight: 800, color: 'var(--text-muted)', marginBottom: 6 }}>TRUST</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Claimed</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                              {ownerPopoverData.claimedByUserId ? 'yes' : 'no'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>First seen</span>
                            <span style={{ fontFamily: 'monospace' }}>
                              {ownerPopoverData.firstSeenAt ? new Date(ownerPopoverData.firstSeenAt).toLocaleDateString() : '—'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Last seen</span>
                            <span style={{ fontFamily: 'monospace' }}>
                              {ownerPopoverData.lastSeenAt ? new Date(ownerPopoverData.lastSeenAt).toLocaleDateString() : '—'}
                            </span>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="button button-small"
                            onClick={(e) => {
                              e.stopPropagation();
                              (async () => {
                                try {
                                  const raw = String(ownerGuess.username || '').trim();
                                  const handle = raw.replace(/^@/, '').trim();
                                  if (!handle) return;

                                  const proofUrl = `https://bringatrailer.com/member/${handle}/`;
                                  const { data: identity } = await supabase
                                    .from('external_identities')
                                    .select('id, claimed_by_user_id, profile_url')
                                    .eq('platform', 'bat')
                                    .eq('handle', handle)
                                    .maybeSingle();

                                  setShowOwnerPopover(false);
                                  if (identity?.claimed_by_user_id) {
                                    navigate(`/profile/${identity.claimed_by_user_id}`);
                                    return;
                                  }
                                  if (identity?.id) {
                                    navigate(`/profile/external/${identity.id}`);
                                    return;
                                  }

                                  navigate(
                                    `/claim-identity?platform=bat&handle=${encodeURIComponent(handle)}&profileUrl=${encodeURIComponent(identity?.profile_url || proofUrl)}`,
                                  );
                                } catch (err) {
                                  console.warn('Owner identity navigation failed:', err);
                                }
                              })();
                            }}
                            style={{ fontSize: '7pt' }}
                          >
                            View details
                          </button>
                          <button
                            type="button"
                            className="button button-small"
                            onClick={(e) => {
                              e.stopPropagation();
                              const raw = String(ownerGuess.username || '').trim();
                              const handle = raw.replace(/^@/, '').trim();
                              if (!handle) return;
                              const proofUrl = `https://bringatrailer.com/member/${handle}/`;
                              setShowOwnerPopover(false);
                              navigate(
                                `/claim-identity?platform=bat&handle=${encodeURIComponent(handle)}&profileUrl=${encodeURIComponent(proofUrl)}`
                              );
                            }}
                            style={{ fontSize: '7pt' }}
                          >
                            Claim identity
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ marginTop: 10, color: 'var(--text-muted)' }}>
                        No partner signals available yet.
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Owner Claim Dropdown */}
              {showOwnerClaimDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    zIndex: 1000,
                    background: 'var(--bg)',
                    border: '2px solid var(--primary)',
                    padding: '12px',
                    width: '280px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    marginTop: '4px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '8px',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '6px'
                  }}>
                    <span style={{ fontWeight: 'bold', fontSize: '9pt' }}>Claim This Vehicle</span>
                    <button
                      type="button"
                      onClick={() => setShowOwnerClaimDropdown(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12pt',
                        color: 'var(--text-muted)',
                      }}
                    >
                      x
                    </button>
                  </div>
                  <div style={{ fontSize: '7pt', color: 'var(--text)', lineHeight: 1.4 }}>
                    <p style={{ margin: '0 0 8px 0' }}>
                      <span style={{ color: 'var(--warning)' }}>*</span> Based on auction data, we believe <strong>@{ownerGuess.username}</strong> is the current owner.
                    </p>
                    {ownerGuess.from && (
                      <p style={{ margin: '0 0 8px 0', fontSize: '6pt', color: 'var(--text-muted)' }}>
                        Purchased from{' '}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowOwnerClaimDropdown(false);
                            const raw = String(ownerGuess.from || '').trim();
                            const handle = raw
                              .replace(/^@/, '')
                              .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
                              .replace(/\/+$/, '')
                              .trim();
                            if (handle) {
                              const proofUrl = `https://bringatrailer.com/member/${handle}/`;
                              navigate(
                                `/claim-identity?platform=bat&handle=${encodeURIComponent(handle)}&profileUrl=${encodeURIComponent(proofUrl)}`
                              );
                            }
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            color: 'var(--primary)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '6pt',
                            textDecoration: 'underline',
                          }}
                        >
                          @{ownerGuess.from}
                        </button>
                      </p>
                    )}
                    <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>
                      Is this you?
                    </p>
                    <ol style={{ margin: '0 0 8px 0', paddingLeft: '16px', fontSize: '7pt' }}>
                      <li style={{ marginBottom: '4px' }}>Login or create an n-zero account</li>
                      <li style={{ marginBottom: '4px' }}>Link your BaT username</li>
                      <li style={{ marginBottom: '4px' }}>Claim ownership of this vehicle</li>
                    </ol>
                    <p style={{ margin: '0 0 8px 0', fontSize: '6pt', color: 'var(--text-muted)' }}>
                      Verified owners can update specs, add service history, and track value.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowOwnerClaimDropdown(false);
                        navigate('/login?claim=' + encodeURIComponent(ownerGuess.username || ''));
                      }}
                      style={{
                        width: '100%',
                        background: 'var(--primary)',
                        color: 'var(--white)',
                        border: 'none',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        fontSize: '8pt',
                      }}
                    >
                      Claim Vehicle
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Seller visibility (do not hide the seller behind tiny icons) */}
          {sellerBadge?.label && (() => {
            // Don't show "Bring a Trailer" consigner badge if we're already showing BaT platform badge
            // Also check for origin badge showing BaT
            const isBatConsigner = sellerBadge.label?.toLowerCase().includes('bring a trailer') || sellerBadge.label?.toLowerCase().includes('bat');
            const isBatPulse = auctionPulse?.listing_url && String(auctionPulse.platform || '').toLowerCase() === 'bat';
            const isBatOrigin = (vehicle as any)?.profile_origin === 'bat_import' || String((vehicle as any)?.discovery_url || '').includes('bringatrailer.com');
            // Hide seller badge if BaT platform badge OR origin badge is showing BaT
            if (isBatConsigner && (isBatPulse || isBatOrigin)) return null;
            
            // Don't show "Cars & Bids" consigner badge if we're already showing Cars & Bids platform badge or origin badge
            const isCarsAndBidsConsigner = sellerBadge.label?.toLowerCase().includes('cars & bids') || sellerBadge.label?.toLowerCase().includes('carsandbids');
            const isCarsAndBidsPulse = auctionPulse?.listing_url && (String(auctionPulse.platform || '').toLowerCase() === 'cars_and_bids' || String(auctionPulse.platform || '').toLowerCase() === 'carsandbids');
            const isCarsAndBidsOrigin = String((vehicle as any)?.discovery_url || '').toLowerCase().includes('carsandbids.com');
            // Hide seller badge if Cars & Bids platform badge OR origin badge is showing Cars & Bids
            if (isCarsAndBidsConsigner && (isCarsAndBidsPulse || isCarsAndBidsOrigin)) return null;
            
            // Show seller as circular favicon icon (not text badge)
            // Find matching organization for favicon
            const sellerLabelLower = sellerBadge.label?.toLowerCase() || '';
            const sellerOrg = visibleOrganizations.find((org: any) => {
              const orgName = String(org?.business_name || '').toLowerCase();
              if (!orgName || !sellerLabelLower) return false;
              // Match if org name contains first word of seller label or vice versa
              const sellerFirstWord = sellerLabelLower.replace(/\s+auctions?$/i, '').split(/\s+/)[0];
              const orgFirstWord = orgName.replace(/\s+auctions?$/i, '').split(/\s+/)[0];
              return sellerFirstWord && orgFirstWord && (
                orgFirstWord.includes(sellerFirstWord) || 
                sellerFirstWord.includes(orgFirstWord)
              );
            });
            
            // If we have a matching org, show circular favicon icon
            if (sellerOrg) {
              // Avoid duplicate org bubbles: the seller org is already rendered in the org icon cluster (badge-priority-1),
              // which opens the investment/details card (and that card links to /org/:id).
              return null;
            }
            
            // Fallback: If seller badge has href (BaT user), show circular favicon
            if ((sellerBadge as any)?.href && (sellerBadge as any)?.kind === 'bat_user') {
              const proofUrl = (sellerBadge as any)?.proofUrl || `https://bringatrailer.com/member/${(sellerBadge as any)?.handle}/`;
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = String((sellerBadge as any).href);
                  }}
                  title={`Seller: @${(sellerBadge as any)?.handle || sellerBadge.label} - Click to claim identity`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    padding: 0,
                    margin: 0,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box',
                  }}
                >
                  <FaviconIcon url={proofUrl} size={14} style={{ margin: 0 }} />
                </button>
              );
            }
            
            // Last resort: text badge (shouldn't happen if orgs are linked properly)
            return null;
          })()}
          {/* Live auction pulse badges (vehicle-first: auction is just a live data source) */}
          {/* Fade out auction badges after auction ends (especially unsold) - show asset value instead */}
          {auctionPulse?.listing_url && (() => {
            const status = String(auctionPulse.listing_status || '').toLowerCase();
            const isLive = status === 'active' || status === 'live';
            const isSold = status === 'sold';
            const isEnded = status === 'ended' || status === 'reserve_not_met';
            
            // Check if auction ended more than 1 day ago
            const endDate = auctionPulse.end_date || (vehicle as any)?.auction_end_date;
            let daysSinceEnd = null;
            let shouldFade = false;
            
            if (endDate && (isSold || isEnded)) {
              const end = new Date(endDate);
              const now = new Date();
              daysSinceEnd = (now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24);
              
              // Fade unsold auctions completely after 1 day
              if (isEnded && daysSinceEnd >= 1) {
                return null; // Don't show at all
              }
              
              // Fade sold auctions gradually after 1 day
              if (isSold && daysSinceEnd >= 1) {
                shouldFade = true;
              }
            }
            
            // Don't show auction badges if auction has ended or sold (unless very recent)
            if ((isSold || isEnded) && !shouldFade && daysSinceEnd === null) return null;
            
            // Calculate fade opacity
            const fadeOpacity = shouldFade && daysSinceEnd !== null 
              ? Math.max(0, 1 - (daysSinceEnd - 1) * 0.5) // Fade over 2 more days
              : 1;
            
            if (fadeOpacity <= 0) return null;
            
            return (
              <span 
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 6, 
                  flexShrink: 0,
                  opacity: fadeOpacity,
                  transition: 'opacity 0.3s ease'
                }}
              >
                {/* Always show platform badge (BaT) as circular favicon icon */}
                {(() => {
                  const isBat = auctionPulse.platform === 'bat' || String((vehicle as any)?.discovery_url || '').includes('bringatrailer.com');
                  const batUrl = auctionPulse.listing_url || (vehicle as any)?.bat_auction_url || (vehicle as any)?.discovery_url || 'https://bringatrailer.com';
                  
                  if (isBat) {
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (batUrl) window.open(batUrl, '_blank');
                        }}
                        title="Bring a Trailer - Click to view listing"
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          padding: 0,
                          margin: 0,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                      >
                        <img src="/vendor/bat/favicon.ico" alt="Bring a Trailer" style={{ width: '14px', height: '14px', objectFit: 'contain' }} />
                      </button>
                    );
                  }
                  
                  if (auctionPulse.platform) {
                    const platformUrl = auctionPulse.listing_url || 
                      (auctionPulse.platform === 'cars_and_bids' ? 'https://carsandbids.com' : 
                       auctionPulse.platform === 'ebay_motors' ? 'https://ebay.com' : 
                       'https://n-zero.com');
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (auctionPulse.listing_url) window.open(auctionPulse.listing_url, '_blank');
                        }}
                        title={`${auctionPulse.platform} - Click to view listing`}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          padding: 0,
                          margin: 0,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                      >
                        <FaviconIcon url={platformUrl} size={14} style={{ margin: 0 }} />
                      </button>
                    );
                  }
                  
                  return null;
                })()}
                {/* Seller bubble: if we have a BaT seller handle, show a circle that opens seller info on click */}
                {batIdentityHref?.seller?.handle ? (() => {
                  // Check if seller is an organization (matches any visible org)
                  const sellerHandle = batIdentityHref.seller.handle.toLowerCase();
                  const sellerOrg = visibleOrganizations.find((o: any) => {
                    const orgName = String(o?.business_name || '').toLowerCase();
                    return orgName.includes(sellerHandle) || sellerHandle.includes(orgName.split(' ')[0]);
                  });
                  
                  return (
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (sellerOrg) {
                            // If seller is an org, show org card
                            setOrgCardAnchor(e.currentTarget);
                            setShowOrgInvestmentCard(sellerOrg.organization_id);
                          } else {
                            // Otherwise show seller identity claim page
                            navigate(batIdentityHref.seller.href);
                          }
                        }}
                        title={sellerOrg ? `${sellerOrg.business_name} (${formatRelationship(sellerOrg.relationship_type)}) - Click to view details` : `Seller: @${batIdentityHref.seller.handle} - Click to claim identity`}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          color: 'var(--text)',
                          fontSize: '9px',
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                          padding: 0,
                          margin: 0,
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                        }}
                      >
                        {String(batIdentityHref.seller.handle || '').slice(0, 1).toUpperCase()}
                      </button>
                    </div>
                  );
                })() : null}
              {/* Hide "updated X ago" for sold/ended auctions - redundant with SOLD badge */}
              {auctionPulse.updated_at && !isSold && !isEnded ? (
                <span
                  className="badge badge-secondary"
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: (() => {
                      const age = formatAge(auctionPulse.updated_at);
                      if (!age) return undefined;
                      // If older than ~3 minutes, warn.
                      const t = new Date(auctionPulse.updated_at as any).getTime();
                      if (!Number.isFinite(t)) return undefined;
                      const diffMin = (Date.now() - t) / (1000 * 60);
                      return diffMin > 3 ? '#b45309' : undefined;
                    })(),
                  }}
                  title="Telemetry freshness"
                >
                  updated {formatAge(auctionPulse.updated_at) || '—'} ago
                </span>
              ) : null}
              {/* Hide countdown for sold auctions - SOLD badge is enough */}
              {timerEndDate && !isSold ? (
                <span
                  className="badge badge-secondary"
                  style={{ fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  title={timerEndDate ? `Time remaining: ${formatRemaining(timerEndDate) || '—'}` : 'Time remaining'}
                >
                  <span
                    className={isAuctionLive ? 'auction-live-dot' : undefined}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: isAuctionLive ? '#dc2626' : '#94a3b8',
                      display: 'inline-block',
                      flexShrink: 0
                    }}
                  />
                  <span style={{ fontFamily: 'monospace' }}>
                    {formatCountdownClock(timerEndDate) || formatRemaining(timerEndDate) || '—'}
                  </span>
                </span>
              ) : null}
              {/* Reserve status - CRITICAL: tells you if it will sell */}
              {isAuctionLive && (() => {
                // Check for reserve price in auctionPulse metadata or vehicle
                const reservePrice = 
                  typeof (auctionPulse as any)?.reserve_price === 'number' ? (auctionPulse as any).reserve_price :
                  typeof (vehicle as any)?.reserve_price === 'number' ? (vehicle as any).reserve_price :
                  typeof (auctionPulse as any)?.metadata?.reserve_price === 'number' ? (auctionPulse as any).metadata.reserve_price :
                  null;
                const currentBid = typeof auctionPulse.current_bid === 'number' ? auctionPulse.current_bid : null;
                const reserveMet = reservePrice && currentBid && currentBid >= reservePrice;
                
                if (reservePrice && currentBid) {
                  return (
                    <span 
                      className="badge badge-secondary" 
                      style={{ 
                        fontSize: '10px', 
                        fontWeight: 700,
                        color: reserveMet ? '#22c55e' : '#f59e0b',
                        border: `1px solid ${reserveMet ? '#22c55e' : '#f59e0b'}`,
                        backgroundColor: reserveMet ? '#dcfce7' : '#fef3c7'
                      }} 
                      title={reserveMet ? 'Reserve met - will sell' : `Reserve: ${formatCurrency(reservePrice)}`}
                    >
                      {reserveMet ? '✓ Reserve Met' : `Reserve: ${formatCurrency(reservePrice)}`}
                    </span>
                  );
                }
                return null;
              })()}
              {/* Performance indicator - outperforming/underperforming typical sale */}
              {isAuctionLive && (() => {
                const currentBid = typeof auctionPulse.current_bid === 'number' ? auctionPulse.current_bid : null;
                const marketValue = typeof (vehicle as any)?.current_value === 'number' ? (vehicle as any).current_value : null;
                const typicalSale = typeof (vehicle as any)?.market_value === 'number' ? (vehicle as any).market_value : marketValue;
                
                if (currentBid && typicalSale && typicalSale > 0) {
                  const diffPct = ((currentBid - typicalSale) / typicalSale) * 100;
                  const isOutperforming = diffPct > 10; // 10% above typical
                  const isUnderperforming = diffPct < -10; // 10% below typical
                  
                  if (isOutperforming || isUnderperforming) {
                    return (
                      <span 
                        className="badge badge-secondary" 
                        style={{ 
                          fontSize: '10px', 
                          fontWeight: 700,
                          color: isOutperforming ? '#22c55e' : '#f59e0b',
                          border: `1px solid ${isOutperforming ? '#22c55e' : '#f59e0b'}`,
                          backgroundColor: isOutperforming ? '#dcfce7' : '#fef3c7'
                        }} 
                        title={`${isOutperforming ? 'Outperforming' : 'Underperforming'} typical sale by ${Math.abs(diffPct).toFixed(0)}%`}
                      >
                        {isOutperforming ? '↑ Outperforming' : '↓ Underperforming'}
                      </span>
                    );
                  }
                }
                return null;
              })()}
              </span>
            );
          })()}
          <div style={{ position: 'relative', fontSize: '7pt', color: mutedTextColor, display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            {isVerifiedOwner ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                  if (showOwnerCard) {
                    window.location.href = `/profile/${session?.user?.id || ''}`;
                  } else {
                    setShowOwnerCard(true);
                  }
                }}
                style={{
                  border: '1px solid #22c55e',
                  background: '#f0fdf4',
                  color: '#15803d',
                  fontWeight: 600,
                  padding: '1px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '8pt'
                }}
              >
                Your Vehicle
              </button>
            ) : isPending ? (
              <div style={{ position: 'relative' }} ref={pendingDetailsRef}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowPendingDetails(!showPendingDetails);
                  }}
                  style={{
                    border: '1px solid #f59e0b',
                    background: '#fef3c7',
                    color: '#92400e',
                    fontWeight: 600,
                    padding: '1px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '8pt'
                  }}
                >
                  Pending
                </button>
                {showPendingDetails && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '130%',
                      left: 0,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
                      padding: 12,
                      width: 320,
                      zIndex: 950,
                      maxHeight: '400px',
                      overflowY: 'auto'
                    }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div style={{ fontSize: '9pt', fontWeight: 600, color: '#92400e', marginBottom: '8px' }}>
                      {pendingReasonText}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#78350f', marginBottom: '12px', lineHeight: '1.5' }}>
                      To activate this vehicle:
                    </div>
                    <ul style={{ fontSize: '8pt', color: '#78350f', margin: '0 0 12px 0', paddingLeft: '20px', lineHeight: '1.6' }}>
                      {needsVIN && (
                        <li style={{ marginBottom: '6px' }}>
                          <strong>Add a VIN:</strong> Go to{' '}
                          <button
                            onClick={() => navigate(`/vehicle/${vehicle.id}/edit`)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#92400e',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: 'inherit',
                            }}
                          >
                            Edit Vehicle
                          </button>
                          {' '}and enter the VIN or chassis identifier
                        </li>
                      )}
                      {needsImages && (
                        <li style={{ marginBottom: '6px' }}>
                          <strong>Add images:</strong> Upload at least one photo of this vehicle
                        </li>
                      )}
                      {similarVehicles.length > 0 && (
                        <li style={{ marginBottom: '6px' }}>
                          <strong>Check for duplicates:</strong> Similar vehicles found below
                        </li>
                      )}
                    </ul>

                    {similarVehicles.length > 0 && (
                      <div>
                        <div style={{ fontSize: '9pt', fontWeight: 600, color: '#92400e', marginBottom: '8px' }}>
                          Similar Vehicles ({similarVehicles.length}):
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {similarVehicles.map((similar) => (
                            <div
                              key={similar.id}
                              style={{
                                background: '#fef3c7',
                                border: '1px solid #fbbf24',
                                borderRadius: '4px',
                                padding: '8px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '9pt', fontWeight: 600, color: '#1f2937' }}>
                                  {similar.year} {similar.make} {similar.model}
                                </div>
                                <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '2px' }}>
                                  {similar.vin ? `VIN: ${similar.vin.substring(0, 8)}...` : 'No VIN'} • {similar.image_count} images • {similar.confidence}% match
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                  onClick={() => window.open(`/vehicle/${similar.id}`, '_blank', 'noopener,noreferrer')}
                                  style={{
                                    background: 'transparent',
                                    border: '1px solid var(--border)',
                                    color: 'var(--text)',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '7pt',
                                    cursor: 'pointer',
                                  }}
                                >
                                  View
                                </button>
                                {canEdit && (
                                  <button
                                    onClick={async () => {
                                      if (confirm(`Merge this vehicle into "${similar.year} ${similar.make} ${similar.model}"? This will combine all data.`)) {
                                        try {
                                          const userId = session?.user?.id ? String(session.user.id) : '';
                                          if (!userId) {
                                            toast.error('You must be signed in to merge vehicles');
                                            return;
                                          }
                                          await VehicleDeduplicationService.mergeVehicles(similar.id, vehicle.id, userId);
                                          toast.success('Vehicles merged successfully');
                                          window.location.reload();
                                        } catch (error: any) {
                                          toast.error(error.message || 'Failed to merge vehicles');
                                        }
                                      }
                                    }}
                                    style={{
                                      background: '#f59e0b',
                                      border: '1px solid #d97706',
                                      color: 'white',
                                      padding: '4px 8px',
                                      borderRadius: '4px',
                                      fontSize: '7pt',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Merge
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {loadingSimilar && (
                      <div style={{ fontSize: '8pt', color: '#6b7280', marginTop: '8px' }}>
                        Loading similar vehicles...
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : responsibleName ? (
              (() => {
                // Check if this is an automated import (organization, not user)
                const isAutomatedImport = vehicle?.profile_origin === 'dropbox_import' && 
                                          (vehicle?.origin_metadata?.automated_import === true || 
                                           vehicle?.origin_metadata?.no_user_uploader === true ||
                                           !vehicle?.uploaded_by);
                const isOrgName = isAutomatedImport && vehicle?.origin_organization_id;
                
                // For discovered vehicles, show "Claim this vehicle" button
                const isDiscoveredVehicle = Boolean(
                  (vehicle as any)?.discovery_url || 
                  (vehicle as any)?.discovery_source ||
                  ['craigslist_scrape', 'ksl_import', 'bat_import', 'url_scraper'].includes((vehicle as any)?.profile_origin)
                );
                
                // During a live auction, deprioritize claim CTA and foreground auction telemetry + BID.
                // Don't show link for sold auctions (user requested removal of SOLD link button)
                if (auctionPulse?.listing_url) {
                  const status = String(auctionPulse.listing_status || '').toLowerCase();
                  const endDate = auctionPulse.end_date ? new Date(auctionPulse.end_date).getTime() : null;
                  const isPastEnd = endDate !== null && endDate < Date.now();
                  const vehicleIsSold = (vehicle as any)?.sale_status === 'sold' || 
                                       (vehicle as any)?.sale_price > 0 || 
                                       (vehicle as any)?.auction_outcome === 'sold';
                  const isLiveStatus = (status === 'active' || status === 'live') && !isPastEnd && !vehicleIsSold;
                  const isSoldStatus = status === 'sold' || status === 'ended' || vehicleIsSold;
                  
                  // Only show link for live auctions, not sold/ended ones
                  if (isLiveStatus && !isSoldStatus) {
                    const label = typeof auctionPulse.current_bid === 'number' && Number.isFinite(auctionPulse.current_bid) && auctionPulse.current_bid > 0
                      ? `Bid: ${formatCurrency(auctionPulse.current_bid)}`
                      : 'BID';
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <a
                          href={auctionPulse.listing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            border: '2px solid var(--border)',
                            background: 'var(--white)',
                            color: 'var(--text)',
                            fontWeight: 700,
                            padding: '4px 8px',
                            cursor: 'pointer',
                            fontSize: '8pt',
                            borderRadius: '3px',
                            transition: 'all 0.12s ease',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            ...(auctionPulseMs ? ({ ['--auction-pulse-ms' as any]: `${auctionPulseMs}ms` } as any) : {}),
                          }}
                          className={auctionPulseMs && isLiveStatus ? 'auction-cta-pulse' : undefined}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLAnchorElement).style.background = 'var(--grey-100)';
                            (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLAnchorElement).style.background = 'var(--white)';
                            (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                          }}
                          title="Open live auction (place bids on the auction platform)"
                        >
                          {label}
                        </a>
                      </span>
                    );
                  }
                  // For sold/ended auctions, don't show the link button
                }

                if (isDiscoveredVehicle) {
                  // If ownerGuess exists, show owner name instead of "Claim this vehicle"
                  if (ownerGuess && !permissions?.isVerifiedOwner) {
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowOwnerClaimDropdown(!showOwnerClaimDropdown);
                        }}
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          display: 'inline-flex',
                          alignItems: 'center',
                          cursor: 'pointer',
                          background: 'transparent',
                          border: 'none',
                          padding: '2px 4px',
                          color: baseTextColor,
                          height: '100%',
                        }}
                        title={`Owner (unverified): @${ownerGuess.username}`}
                      >
                        @{ownerGuess.username}<sup style={{ fontSize: '6px', color: 'var(--warning)', marginLeft: '1px' }}>*</sup>
                      </button>
                    );
                  }
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {batIdentityHref?.winner?.handle && !isAuctionLive ? (
                        <Link
                          to={batIdentityHref.winner.href}
                          onClick={(e) => e.stopPropagation()}
                          className="badge badge-secondary"
                          title="Winner (internal profile)"
                          style={{ fontSize: '10px', fontWeight: 700, textDecoration: 'none', color: 'inherit' }}
                        >
                          Winner: {batIdentityHref.winner.handle}
                        </Link>
                      ) : null}
                      <a
                        href={claimHref}
                        style={{
                          border: '2px solid var(--border)',
                          background: 'var(--white)',
                          color: 'var(--text)',
                          fontWeight: 700,
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: '8pt',
                          borderRadius: '3px',
                          transition: 'all 0.12s ease',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLAnchorElement).style.background = 'var(--grey-100)';
                          (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLAnchorElement).style.background = 'var(--white)';
                          (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                        }}
                        title={
                          hasClaim
                              ? (claimNeedsId ? 'Claim started. Upload your driver\'s license to complete.' : 'Claim submitted.')
                            : (batIdentityHref?.winner?.handle
                              ? `Winner is ${batIdentityHref.winner.handle}. If that's you, claim your BaT identity and upload a title document.`
                              : 'Upload title document to claim ownership')
                        }
                      >
                        {hasClaim ? (claimNeedsId ? 'Complete claim' : 'Claim submitted') : 'Claim this vehicle'}
                      </a>
                    </span>
                  );
                }
                
                // For user-uploaded vehicles, show "Claim this vehicle" button instead of uploader name
                // OR show ownerGuess if available
                if (!isOrgName && !isVerified) {
                  // If ownerGuess exists, show owner name instead of "Claim this vehicle"
                  if (ownerGuess && !permissions?.isVerifiedOwner) {
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowOwnerClaimDropdown(!showOwnerClaimDropdown);
                        }}
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          display: 'inline-flex',
                          alignItems: 'center',
                          cursor: 'pointer',
                          background: 'transparent',
                          border: 'none',
                          padding: '2px 4px',
                          color: baseTextColor,
                          height: '100%',
                        }}
                        title={`Owner (unverified): @${ownerGuess.username}`}
                      >
                        @{ownerGuess.username}<sup style={{ fontSize: '6px', color: 'var(--warning)', marginLeft: '1px' }}>*</sup>
                      </button>
                    );
                  }
                  return (
                    <a
                      href={claimHref}
                      style={{
                        border: '2px solid var(--border)',
                        background: 'var(--white)',
                        color: 'var(--text)',
                        fontWeight: 700,
                        padding: '4px 8px',
                        cursor: 'pointer',
                        fontSize: '8pt',
                        borderRadius: '3px',
                        transition: 'all 0.12s ease',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center'
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = 'var(--grey-100)';
                        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = 'var(--white)';
                        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                      }}
                      title={
                        hasClaim
                            ? (claimNeedsId ? 'Claim started. Upload your driver\'s license to complete.' : 'Claim submitted.')
                          : 'Upload title document to claim ownership'
                      }
                    >
                      {hasClaim ? (claimNeedsId ? 'Complete claim' : 'Claim submitted') : 'Claim this vehicle'}
                    </a>
                  );
                }
                
                // For organizations or verified owners, show the name/link
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isOrgName && vehicle?.origin_organization_id) {
                        // Link to organization profile for automated imports
                        window.location.href = `/organization/${vehicle.origin_organization_id}`;
                      } else {
                        // Link to user profile for regular uploads
                        if (showOwnerCard) {
                          window.location.href = `/profile/${(vehicle as any).uploaded_by || (vehicle as any).user_id || ''}`;
                        } else {
                          setShowOwnerCard(true);
                        }
                      }
                    }}
                    title={isOrgName ? `View ${responsibleName} organization` : `View ${responsibleName}'s profile`}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: baseTextColor,
                      fontWeight: 600,
                      padding: 0,
                      cursor: 'pointer',
                      textDecoration: 'underline dotted',
                      fontSize: 'inherit'
                    }}
                  >
                    {responsibleName}
                  </button>
                );
              })()
            ) : (
              // Show claim button for vehicles not in a live auction and not already owned by current user
              // OR show ownerGuess if available
              !isAuctionLive && !isOwner && session?.user?.id ? (
                ownerGuess && !permissions?.isVerifiedOwner ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowOwnerClaimDropdown(!showOwnerClaimDropdown);
                    }}
                    style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      fontFamily: 'monospace',
                      display: 'inline-flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      background: 'transparent',
                      border: 'none',
                      padding: '2px 4px',
                      color: baseTextColor,
                      height: '100%',
                    }}
                    title={`Owner (unverified): @${ownerGuess.username}`}
                  >
                    @{ownerGuess.username}<sup style={{ fontSize: '6px', color: 'var(--warning)', marginLeft: '1px' }}>*</sup>
                  </button>
                ) : (
                <a
                  href={claimHref}
                  onClick={(e) => {
                    if (onClaimClick) {
                      e.preventDefault();
                      onClaimClick();
                    }
                  }}
                  style={{
                    border: '1px solid var(--primary)',
                    background: 'var(--surface)',
                    color: 'var(--primary)',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center'
                  }}
                >
                  Claim This Vehicle
                </a>
                )
              ) : null
            )}
            {responsibleName && showOwnerCard && ownerProfile && (
              <div
                style={{
                  position: 'absolute',
                  top: '130%',
                  left: 0,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
                  padding: 12,
                  width: 260,
                  zIndex: 950
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  {ownerProfile.avatar_url && (
                    <img src={ownerProfile.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)' }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '9px' }}>
                      {ownerProfile.full_name || ownerProfile.username || 'Profile'}
                    </div>
                    <div style={{ fontSize: '8px', color: mutedTextColor }}>
                      @{ownerProfile.username || ownerProfile.id.slice(0, 8)}
                    </div>
                  </div>
                </div>
                {ownerStats && (
                  <div style={{ display: 'flex', gap: 12, fontSize: '8px', color: mutedTextColor }}>
                    <span>{ownerStats.contributions} contributions</span>
                    <span>{ownerStats.vehicles} vehicles</span>
                  </div>
                )}
                <button
                  className="button button-small"
                  style={{ width: '100%', marginTop: 8, fontSize: '8pt' }}
                  onClick={async () => {
                    if (!session?.user?.id) return;
                    const ownerId = ownerProfile.id;
                    if (isFollowing) {
                      await supabase.from('user_follows').delete().eq('follower_id', session.user.id).eq('following_id', ownerId);
                      setIsFollowing(false);
                    } else {
                      await supabase.from('user_follows').insert({ follower_id: session.user.id, following_id: ownerId });
                      setIsFollowing(true);
                    }
                  }}
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </button>
                <div style={{ fontSize: '8px', color: mutedTextColor, marginTop: 6, textAlign: 'center' }}>
                  Click name again to open full profile
                </div>
              </div>
            )}
          </div>
          {(() => {
            // Separate seller/consigner orgs from other orgs, prioritize sellers
            const sellerOrgs = visibleOrganizations.filter((org) => {
              const rel = String(org?.relationship_type || '').toLowerCase();
              return ['sold_by', 'seller', 'consigner'].includes(rel);
            });
            const otherOrgs = visibleOrganizations.filter((org) => {
              const rel = String(org?.relationship_type || '').toLowerCase();
              return !['sold_by', 'seller', 'consigner'].includes(rel);
            });
            const allDisplayOrgs = [...sellerOrgs, ...otherOrgs];
            
            if (allDisplayOrgs.length === 0) return null;
            
            return (
              <div className="badge-priority-1" style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                {allDisplayOrgs
                  .filter((org) => {
                    const name = String(org?.business_name || '').toLowerCase();
                    const origin = String((vehicle as any)?.profile_origin || '').toLowerCase();
                    const hasBatMember = !!batMemberLink;
                    // For BaT imports, don't show the generic BaT org bubble when we have a concrete seller identity.
                    if (hasBatMember && (origin.includes('bat') || String((vehicle as any)?.discovery_url || '').includes('bringatrailer.com'))) {
                      if (name.includes('bring a trailer') || name === 'bat' || name.includes('ba t')) return false;
                    }
                    return true;
                  })
                  .map((org) => {
                    const orgName = String(org?.business_name || '');
                    const isBatOrg = orgName.toLowerCase().includes('bring a trailer') || orgName.toLowerCase() === 'bat' || orgName.toLowerCase().includes('ba t');
                    const isCarsAndBidsOrg = orgName.toLowerCase().includes('cars & bids') || orgName.toLowerCase().includes('carsandbids');
                    const batUrl = 'https://bringatrailer.com';
                    const carsAndBidsUrl = (vehicle as any)?.discovery_url?.includes('carsandbids.com') 
                      ? (vehicle as any).discovery_url.split('/').slice(0, 3).join('/')
                      : 'https://carsandbids.com';
                    
                    // Get website URL from vehicle discovery_url if it matches the org
                    let orgWebsiteUrl = org.website_url;
                    if (!orgWebsiteUrl && isCarsAndBidsOrg) {
                      orgWebsiteUrl = carsAndBidsUrl;
                    }
                    
                    return (
                      <button
                        key={org.id}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOrgCardAnchor(e.currentTarget);
                          setShowOrgInvestmentCard(org.organization_id);
                        }}
                        title={`${org.business_name} (${formatRelationship(org.relationship_type)}) - Click to view details`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          margin: 0,
                          cursor: 'pointer',
                          transition: 'transform 0.1s ease',
                          background: 'transparent',
                          border: 'none'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                        }}
                      >
                      {isBatOrg ? (
                          <div style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src="/vendor/bat/favicon.ico" alt="Bring a Trailer" style={{ margin: 0, width: '18px', height: '18px', objectFit: 'contain' }} />
                          </div>
                        ) : isCarsAndBidsOrg ? (
                          <div style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FaviconIcon url={carsAndBidsUrl} size={18} style={{ margin: 0 }} />
                          </div>
                        ) : org.logo_url ? (
                          <CircularAvatar
                            src={org.logo_url}
                            alt={org.business_name}
                            size={22}
                            fallback={org.business_name?.charAt(0)?.toUpperCase() || '?'}
                          />
                        ) : orgWebsiteUrl ? (
                          <div style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FaviconIcon url={orgWebsiteUrl} size={18} style={{ margin: 0 }} />
                          </div>
                        ) : (
                          <CircularAvatar
                            size={22}
                            fallback={org.business_name?.charAt(0)?.toUpperCase() || '?'}
                          />
                        )}
                      </button>
                    );
                  })}
                {extraOrgCount > 0 && (
                  <span style={{ fontSize: '8px', color: mutedTextColor }}>+{extraOrgCount}</span>
                )}
              </div>
            );
          })()}
          
          {/* Organization Investment Card */}
          {showOrgInvestmentCard && (() => {
            const org = visibleOrganizations.find((o: any) => o.organization_id === showOrgInvestmentCard) ||
                       (organizationLinks || []).find((o: any) => o.organization_id === showOrgInvestmentCard);
            if (!org) return null;
            return (
              <OrganizationInvestmentCard
                organizationId={showOrgInvestmentCard}
                organizationName={org.business_name || 'Unknown'}
                relationshipType={org.relationship_type || 'collaborator'}
                onClose={() => {
                  setShowOrgInvestmentCard(null);
                  setOrgCardAnchor(null);
                }}
                anchorElement={orgCardAnchor}
              />
            );
          })()}
        </div>

        <div ref={priceMenuRef} style={{ 
          flex: '0 1 auto', 
          textAlign: 'right', 
          position: 'relative', 
          zIndex: showFollowAuctionCard ? 1001 : 'auto',
          minWidth: 0,
          maxWidth: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          justifyContent: 'flex-end'
        }}>
          {bidCta ? (
            <a
              href={bidCta.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={auctionPulseMs && isAuctionLive ? 'auction-cta-pulse' : undefined}
              style={{
                border: '2px solid var(--border)',
                background: 'var(--white)',
                color: 'var(--text)',
                fontWeight: 800,
                padding: '4px 8px',
                cursor: 'pointer',
                fontSize: '8pt',
                borderRadius: '3px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                ...(auctionPulseMs ? ({ ['--auction-pulse-ms' as any]: `${auctionPulseMs}ms` } as any) : {}),
              }}
              title="Open live auction (place bids on the auction platform)"
            >
              {bidCta.label}
            </a>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              
              // If this is a future auction date display, show follow card instead of provenance
              const isFutureAuctionDate = futureAuctionListing && 
                priceDisplay !== 'Set a price' && 
                priceDisplay !== 'SOLD' && 
                !priceDisplay.startsWith('$') &&
                !priceDisplay.startsWith('Bid:') &&
                !priceDisplay.startsWith('BID');
              
              if (isFutureAuctionDate) {
                setShowFollowAuctionCard(!showFollowAuctionCard);
                setShowProvenancePopup(false);
              } else {
                // User wants to click the price value and see data provenance popup
                setShowProvenancePopup(true);
                setShowFollowAuctionCard(false);
              }
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              minWidth: 0,
              maxWidth: '100%',
              justifyContent: 'flex-end',
              width: '100%'
            }}
            className="vehicle-price-button"
            title="Click to view price source, confidence, and trend"
          >
            <div 
              style={{ 
                fontSize: '9pt', 
                fontWeight: 700, 
                color: baseTextColor, 
                lineHeight: 1, 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6,
                flexWrap: 'wrap',
                minWidth: 0,
                maxWidth: '100%'
              }}
              title={priceWasCorrected ? 'Price was auto-corrected from listing (e.g., $15 -> $15,000)' : undefined}
            >
              <span
                className={`provenance-price-clickable${auctionPulseMs && isAuctionLive ? ' auction-price-pulse' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  
                  // If this is a future auction date display, show follow card instead of provenance
                  const isFutureAuctionDate = futureAuctionListing && 
                    priceDisplay !== 'Set a price' && 
                    priceDisplay !== 'SOLD' && 
                    !priceDisplay.startsWith('$') &&
                    !priceDisplay.startsWith('Bid:') &&
                    !priceDisplay.startsWith('BID');
                  
                  if (isFutureAuctionDate) {
                    setShowFollowAuctionCard(!showFollowAuctionCard);
                    setShowProvenancePopup(false);
                  } else {
                    setShowProvenancePopup(true);
                    setShowFollowAuctionCard(false);
                  }
                }}
                style={{
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                  textDecorationColor: 'rgba(0,0,0,0.3)',
                  // Blur effect for RNM auctions (reserve not met)
                  filter: isRNM && highBid && String(priceDisplay).toUpperCase() !== 'SOLD' ? 'blur(4px)' : 'none',
                  transition: 'filter 0.2s ease',
                  flexShrink: 0,
                  minWidth: 0,
                  ...(auctionPulseMs && isAuctionLive ? ({ ['--auction-pulse-ms' as any]: `${auctionPulseMs}ms` } as any) : {}),
                }}
                // Prefer compact visible text; reveal actual amount on hover when available.
                // We intentionally avoid asserting price in the primary display for SOLD states.
                // (Time is linear; by the time a number is posted, it may already be "stale".)
                // Users can still see the amount via hover/provenance.
                title={priceHoverText || (isRNM ? "Reserve not met - high bid hidden (click to reveal)" : "Click to see data source and confidence")}
                onMouseEnter={(e) => {
                  // Un-blur on hover for RNM
                  if (isRNM && highBid && String(priceDisplay).toUpperCase() !== 'SOLD') {
                    e.currentTarget.style.filter = 'blur(0px)';
                  }
                }}
                onMouseLeave={(e) => {
                  // Re-blur on mouse leave for RNM
                  if (isRNM && highBid && String(priceDisplay).toUpperCase() !== 'SOLD') {
                    e.currentTarget.style.filter = 'blur(4px)';
                  }
                }}
              >
                {(() => {
                  // Check if bid is RNM and make it red
                  if (isAuctionLive && typeof priceDisplay === 'string' && priceDisplay.startsWith('Bid: ')) {
                    const reservePrice = 
                      typeof (auctionPulse as any)?.reserve_price === 'number' ? (auctionPulse as any).reserve_price :
                      typeof (vehicle as any)?.reserve_price === 'number' ? (vehicle as any).reserve_price :
                      typeof (auctionPulse as any)?.metadata?.reserve_price === 'number' ? (auctionPulse as any).metadata.reserve_price :
                      null;
                    const currentBid = auctionPulse && typeof auctionPulse.current_bid === 'number' ? auctionPulse.current_bid : null;
                    const isRNM = reservePrice && currentBid && currentBid < reservePrice;
                    
                    return (
                      <span style={{ color: isRNM ? '#dc2626' : undefined }}>
                        {priceDisplay}
                      </span>
                    );
                  }
                  return String(priceDisplay).toUpperCase() !== 'SOLD' ? priceDisplay : null;
                })()}
              </span>
              {priceWasCorrected && (
                <span style={{ fontSize: '7pt', color: 'var(--warning)', fontWeight: 500, flexShrink: 0 }}>*</span>
              )}
              {daysSinceSale !== null && daysSinceSale >= 0 && (
                <span style={{ fontSize: '7pt', color: mutedTextColor, fontWeight: 500, marginLeft: '4px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {(() => {
                    if (daysSinceSale === 0) return 'today';
                    if (daysSinceSale >= 365) return `${Math.floor(daysSinceSale / 365)}y ago`;
                    if (daysSinceSale >= 30) return `${Math.floor(daysSinceSale / 30)}mo ago`;
                    return `${daysSinceSale}d ago`;
                  })()}
                </span>
              )}
              
              {/* Auction Outcome Badge - only show if not already showing SOLD in price */}
              {auctionContext.badge && (
                <span style={{
                  fontSize: '6pt',
                  fontWeight: 700,
                  color: auctionContext.badge.color,
                  background: auctionContext.badge.bg,
                  padding: '2px 6px',
                  borderRadius: '3px',
                  letterSpacing: '0.5px',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  display: 'inline-block'
                }}>
                  {auctionContext.badge.text}
                </span>
              )}
              
              {/* VIN Authority Badge: only show when both (a) structurally valid VIN and (b) conclusive proof exists. */}
              {vinLooksValid && vinIsEvidenceBacked && (
                <span 
                  style={{
                    fontSize: '6pt',
                    fontWeight: 700,
                    color: '#22c55e',
                    background: '#dcfce7',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    letterSpacing: '0.5px',
                    lineHeight: 1,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                  title={
                    `VIN evidence available (${vinProofSummary?.proofCount || 0} proof${(vinProofSummary?.proofCount || 0) === 1 ? '' : 's'}). Click to view citations.`
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowVinValidation(true);
                  }}
                >
                  VIN VERIFIED
                </span>
              )}

              {/* Ownership Verified Badge (separate from VIN VERIFIED) */}
              {isVerifiedOwner && (
                <span
                  style={{
                    fontSize: '6pt',
                    fontWeight: 700,
                    color: '#155e75',
                    background: '#cffafe',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    letterSpacing: '0.5px',
                    lineHeight: 1,
                    whiteSpace: 'nowrap'
                  }}
                  title="Ownership verified (title-based claim). Ownership effective date is anchored to the title issue/print date when available."
                >
                  OWNERSHIP VERIFIED
                </span>
              )}
            </div>
          </button>

          {priceMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 8,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 12px 24px rgba(15, 23, 42, 0.15)',
                padding: 12,
                fontSize: '8pt',
                color: baseTextColor,
                width: '280px',
                zIndex: 950
              }}
            >
              <div style={{ fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                Price timeline
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {priceEntries.length === 0 && (
                  <div style={{ color: mutedTextColor }}>
                    No price data has been recorded yet. Add a receipt, BaT link, or asking price to populate this list.
                  </div>
                )}
                {priceEntries.map((entry) => (
                  <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ textAlign: 'left', flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{entry.label}</div>
                      <div style={{ color: mutedTextColor }}>
                        {entry.source || 'Unverified'}
                        {entry.date && ` · ${formatShortDate(entry.date)}`}
                      </div>
                      {entry.note && (
                        <div style={{ color: mutedTextColor }}>{entry.note}</div>
                      )}
                      {typeof entry.confidence === 'number' && (
                        <div style={{ color: mutedTextColor }}>
                          Confidence {entry.confidence}%
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, minWidth: 90, textAlign: 'right' }}>
                      {formatCurrency(entry.amount)}
                    </div>
                  </div>
                ))}
              </div>

              {isOwnerLike && (
                <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPriceMenuOpen(false);
                      setShowUpdateSalePriceModal(true);
                    }}
                    style={{
                      padding: '6px 12px',
                      fontSize: '8pt',
                      fontWeight: 'bold',
                      background: 'var(--accent)',
                      color: 'var(--white)',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      textAlign: 'center'
                    }}
                  >
                    Update Sale Price
                  </button>
                  <div style={{ fontWeight: 600 }}>Display price</div>
                  <select
                    value={displayMode}
                    onChange={(e) => persistDisplayMode(e.target.value as any)}
                    className="form-select"
                    style={{ fontSize: '8pt', padding: '2px 4px' }}
                  >
                    <option value="auto">Auto</option>
                    <option value="estimate">Estimate</option>
                    <option value="auction">Auction Bid</option>
                    <option value="asking">Asking</option>
                    <option value="sale">Sale</option>
                    <option value="purchase">Purchase</option>
                    <option value="msrp">MSRP</option>
                  </select>
                  <div style={{ fontWeight: 600 }}>Responsible label</div>
                  <select
                    value={responsibleMode}
                    onChange={(e) => persistResponsibleSettings(e.target.value as any)}
                    className="form-select"
                    style={{ fontSize: '8pt', padding: '2px 4px' }}
                  >
                    <option value="auto">Auto</option>
                    <option value="owner">Owner</option>
                    <option value="consigner">Consigner</option>
                    <option value="uploader">Uploader</option>
                    <option value="listed_by">Listed by</option>
                    <option value="custom">Custom</option>
                  </select>
                  {responsibleMode === 'custom' && (
                    <input
                      value={responsibleCustom}
                      onChange={(e) => persistResponsibleSettings('custom', e.target.value)}
                      placeholder="Label"
                      className="form-input"
                      style={{ fontSize: '8pt', padding: '2px 4px' }}
                    />
                  )}
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Boolean(onPriceClick) && (
                  <button
                    type="button"
                    className="button button-small"
                    style={{ fontSize: '8pt' }}
                    onClick={handleViewValuation}
                  >
                    View valuation details
                  </button>
                )}
                <button
                  type="button"
                  className="button button-small"
                  style={{ fontSize: '8pt' }}
                  onClick={handleTradeClick}
                >
                  Trade shares
                </button>
              </div>
            </div>
          )}

          {showVinValidation && vehicle?.id && vehicle?.vin && (
            <DataValidationPopup
              vehicleId={vehicle.id}
              fieldName="vin"
              fieldValue={vehicle.vin}
              onClose={() => setShowVinValidation(false)}
            />
          )}
        </div>
      </div>

      {/* Sticky live auction rail: keep comments + car view in-frame */}
      {(() => {
        const v: any = vehicle as any;
        const streamUrl = liveSession?.stream_url ? String(liveSession.stream_url).trim() : '';
        const streamProvider = liveSession?.stream_provider ? String(liveSession.stream_provider).trim() : '';
        const platformLabel = formatLivePlatformLabel(streamProvider || undefined, liveSession?.platform || undefined);
        const hasStream = Boolean(streamUrl);

        const pulseUrl = auctionPulse?.listing_url ? String(auctionPulse.listing_url).trim() : '';
        const fallbackListingUrl = String(v?.bat_auction_url || v?.discovery_url || v?.listing_url || '').trim();
        const listingUrl = pulseUrl || fallbackListingUrl;
        const showAuctionRail = Boolean(isAuctionLive && listingUrl);

        if (!showAuctionRail && !hasStream) return null;

        const currentBid =
          auctionPulse && typeof auctionPulse.current_bid === 'number' && Number.isFinite(auctionPulse.current_bid) && auctionPulse.current_bid > 0
            ? auctionPulse.current_bid
            : null;

        const commentCount =
          auctionPulse && typeof auctionPulse.comment_count === 'number' && Number.isFinite(auctionPulse.comment_count) && auctionPulse.comment_count >= 0
            ? auctionPulse.comment_count
            : null;

        const lastCommentAt = auctionPulse?.last_comment_at ? String(auctionPulse.last_comment_at) : null;
        const lastCommentMs = lastCommentAt ? new Date(lastCommentAt).getTime() : NaN;
        const hasFreshComment =
          Number.isFinite(lastCommentMs) && auctionNow - lastCommentMs >= 0 && auctionNow - lastCommentMs < 5 * 60 * 1000;

        const thumbRaw = leadImageUrl ? String(leadImageUrl).trim() : '';
        const thumbSrc = thumbRaw && thumbRaw !== 'undefined' && thumbRaw !== 'null' ? thumbRaw : null;

        return (
          <div
            style={{
              flex: '0 0 100%',
              width: '100%',
              borderTop: '1px solid var(--border)',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
              {thumbSrc ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const el = document.getElementById('vehicle-hero');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  title="Jump to vehicle photos"
                  aria-label="Jump to vehicle photos"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 3,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    padding: 0,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={thumbSrc}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              ) : null}

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0, fontSize: '8pt' }}>
                {showAuctionRail ? (
                  <>
                    <span
                      className={isAuctionLive ? 'auction-live-dot' : undefined}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: isAuctionLive ? '#dc2626' : '#94a3b8',
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 800, fontFamily: 'monospace' }}>LIVE AUCTION</span>
                    {timerEndDate ? (
                      <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {formatCountdownClock(timerEndDate, true) || formatRemaining(timerEndDate) || '—'}
                      </span>
                    ) : null}
                    {typeof currentBid === 'number' ? <span style={{ fontWeight: 800 }}>Bid {formatCurrency(currentBid)}</span> : null}
                    {typeof commentCount === 'number' ? (
                      <span style={{ color: 'var(--text-muted)' }}>{commentCount} comments</span>
                    ) : null}
                    {lastCommentAt ? (
                      <span style={{ color: 'var(--text-muted)' }}>last {formatAge(lastCommentAt) || '—'} ago</span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: '#dc2626',
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 800, fontFamily: 'monospace' }}>LIVE</span>
                    {liveSession?.title ? (
                      <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {String(liveSession.title)}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {hasStream ? (
                <a
                  href={streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-small"
                  style={{ fontSize: '8pt', fontWeight: 800, fontFamily: 'monospace', whiteSpace: 'nowrap' }}
                  title={platformLabel ? `Watch live (${platformLabel})` : 'Watch live'}
                  onClick={(e) => e.stopPropagation()}
                >
                  WATCH
                </a>
              ) : null}

              {showAuctionRail && listingUrl ? (
                <a
                  href={listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-small"
                  style={{ fontSize: '8pt', fontWeight: 800, fontFamily: 'monospace', whiteSpace: 'nowrap' }}
                  title="Open live auction on platform"
                  onClick={(e) => e.stopPropagation()}
                >
                  BID
                </a>
              ) : null}

              <button
                type="button"
                className="button button-small"
                style={{
                  fontSize: '8pt',
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const el = document.getElementById('vehicle-comments');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                title="Jump to comments & bids"
              >
                {hasFreshComment ? (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: '#dc2626',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                COMMENTS{typeof commentCount === 'number' ? ` (${commentCount})` : ''}
              </button>
            </div>
          </div>
        );
      })()}

      {showTrade && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setShowTrade(false)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '520px', maxWidth: '95vw' }}>
            <TradePanel
              vehicleId={vehicle?.id || ''}
              vehicleName={vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Vehicle'}
              currentSharePrice={(valuation && typeof valuation.sharePrice === 'number') ? valuation.sharePrice : 1.00}
              totalShares={1000}
            />
            <div style={{ textAlign: 'right', marginTop: 6 }}>
              <button className="button button-small" onClick={() => setShowTrade(false)} style={{ fontSize: '8pt' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showProvenancePopup && vehicle && (
        <ValueProvenancePopup
          vehicleId={vehicle.id}
          field={(() => {
            // If no price exists, default to asking_price for "Set a price"
            if (primaryAmount === null) {
              return 'asking_price';
            }

            // If we are displaying an RNM "bid to" amount, treat it as `high_bid` (auction evidence),
            // not `current_value` or `sale_price`.
            if (isRNM && typeof highBid === 'number' && Number.isFinite(highBid) && highBid > 0 && primaryAmount === highBid) {
              return 'high_bid';
            }
            // Determine which field is actually being displayed based on primaryPrice
            const displayModeValue = displayMode || 'auto';
            if (displayModeValue === 'sale' || primaryPrice.label?.includes('SOLD') || primaryPrice.label?.includes('Sold')) {
              return 'sale_price';
            }
            if (displayModeValue === 'asking' || primaryPrice.label?.includes('Asking')) {
              return 'asking_price';
            }
            if (displayModeValue === 'purchase' || primaryPrice.label?.includes('Purchase')) {
              return 'purchase_price';
            }
            // Default to sale_price if vehicle has it, otherwise current_value
            if (vehicle.sale_price && vehicle.sale_price === primaryAmount) {
              return 'sale_price';
            }
            return 'current_value';
          })()}
          value={primaryAmount || 0}
          context={{
            platform: (() => {
              const pulse = auctionPulse?.platform ? String(auctionPulse.platform) : null;
              if (pulse) return pulse;
              const u = String((vehicle as any)?.bat_auction_url || (vehicle as any)?.discovery_url || (vehicle as any)?.listing_url || '');
              return u.includes('bringatrailer.com/listing/') ? 'bat' : null;
            })(),
            listing_url: (() => {
              const pulseUrl = auctionPulse?.listing_url ? String(auctionPulse.listing_url) : null;
              if (pulseUrl) return pulseUrl;
              const u = String((vehicle as any)?.bat_auction_url || (vehicle as any)?.discovery_url || (vehicle as any)?.listing_url || '').trim();
              return u || null;
            })(),
            listing_status: (() => {
              const pulseStatus = auctionPulse?.listing_status ? String(auctionPulse.listing_status) : null;
              if (pulseStatus) return pulseStatus;
              if (isRNM) return 'reserve_not_met';
              // If we have an explicit sold signal, treat as sold for provenance purposes.
              if (isSoldContext) return 'sold';
              return null;
            })(),
            final_price: (() => {
              const pulseFinal = typeof (auctionPulse as any)?.final_price === 'number' ? (auctionPulse as any).final_price : null;
              if (typeof pulseFinal === 'number' && Number.isFinite(pulseFinal) && pulseFinal > 0) return pulseFinal;
              const vSale = typeof (vehicle as any)?.sale_price === 'number' ? (vehicle as any).sale_price : null;
              if (typeof vSale === 'number' && Number.isFinite(vSale) && vSale > 0) return vSale;
              return null;
            })(),
            current_bid: (() => {
              const pulseBid = typeof auctionPulse?.current_bid === 'number' ? auctionPulse.current_bid : null;
              if (typeof pulseBid === 'number' && Number.isFinite(pulseBid) && pulseBid > 0) return pulseBid;
              if (isRNM && typeof highBid === 'number' && Number.isFinite(highBid) && highBid > 0) return highBid;
              return null;
            })(),
            bid_count: (() => {
              const pulse = typeof auctionPulse?.bid_count === 'number' ? auctionPulse.bid_count : null;
              if (typeof pulse === 'number' && Number.isFinite(pulse) && pulse > 0) return pulse;
              const v = (vehicle as any)?.bat_bids;
              if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
              return null;
            })(),
            winner_name: (() => {
              const pulseWinner =
                typeof (auctionPulse as any)?.winner_name === 'string' ? (auctionPulse as any).winner_name :
                typeof (auctionPulse as any)?.winning_bidder_name === 'string' ? (auctionPulse as any).winning_bidder_name :
                typeof (auctionPulse as any)?.winner_display_name === 'string' ? (auctionPulse as any).winner_display_name :
                null;
              const fallback = String((vehicle as any)?.origin_metadata?.bat_buyer || (vehicle as any)?.origin_metadata?.buyer || '').trim() || null;
              return (pulseWinner && String(pulseWinner).trim()) ? String(pulseWinner).trim() : fallback;
            })(),
            inserted_by_name: (() => {
              if (auctionPulse?.listing_url) return 'System (auction telemetry)';
              // If this looks like a BaT-derived auction outcome/high-bid, treat as system-extracted.
              const u = String((vehicle as any)?.bat_auction_url || (vehicle as any)?.discovery_url || '');
              if (u.includes('bringatrailer.com/listing/') && (isRNM || isSoldContext)) return 'System (BaT extraction)';
              return null;
            })(),
            inserted_at: auctionPulse?.updated_at
              ? String(auctionPulse.updated_at as any)
              : (auctionPulse?.end_date ? String(auctionPulse.end_date as any) : null),
            confidence: (() => {
              if (auctionPulse?.listing_url) return 100;
              const u = String((vehicle as any)?.bat_auction_url || (vehicle as any)?.discovery_url || '');
              if (u.includes('bringatrailer.com/listing/') && (isRNM || isSoldContext)) return 95;
              return null;
            })(),
            evidence_url: (() => {
              const pulseUrl = auctionPulse?.listing_url ? String(auctionPulse.listing_url) : null;
              if (pulseUrl) return pulseUrl;
              const u = String((vehicle as any)?.bat_auction_url || (vehicle as any)?.discovery_url || '').trim();
              return u || null;
            })(),
            trend_pct: typeof trendPct === 'number' ? trendPct : null,
            trend_period: trendPeriod || null,
            trend_price_type: trendPriceType || null,
            trend_baseline_value: typeof trendBaselineValue === 'number' ? trendBaselineValue : null,
            trend_baseline_as_of: trendBaselineAsOf || null,
            trend_baseline_source: trendBaselineSource || null,
            trend_outlier_count: typeof trendOutlierCount === 'number' ? trendOutlierCount : null,
          }}
          onClose={() => setShowProvenancePopup(false)}
          onUpdate={(newValue) => {
            // Optionally refresh the vehicle data or update local state
            setShowProvenancePopup(false);
            window.location.reload(); // Simple refresh for now
          }}
        />
      )}

      {/* Update Sale Price Modal */}
      {vehicle && (
        <UpdateSalePriceModal
          vehicleId={vehicle.id}
          vehicleName={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'}
          currentSalePrice={vehicle.sale_price ?? null}
          currentSaleDate={vehicle.sale_date || null}
          auctionBid={vehicle.current_bid || (auctionPulse as any)?.current_bid || null}
          isOpen={showUpdateSalePriceModal}
          onClose={() => setShowUpdateSalePriceModal(false)}
          onSuccess={() => {
            // Refresh vehicle data
            window.location.reload();
          }}
        />
      )}

      {/* Follow Auction Card - positioned relative to price button */}
      {vehicle && showFollowAuctionCard && futureAuctionListing && (
        <div 
          style={{ 
            position: 'absolute',
            top: '100%',
            right: 0,
            zIndex: 1002,
            marginTop: '8px'
          }}
        >
          <FollowAuctionCard
            vehicleId={vehicle.id}
            listingUrl={futureAuctionListing.listing_url}
            platform={futureAuctionListing.platform}
            auctionDate={futureAuctionListing.start_date || futureAuctionListing.end_date || futureAuctionListing.metadata?.sale_date}
            onClose={() => setShowFollowAuctionCard(false)}
          />
        </div>
      )}
    </div>
  );
};

export default VehicleHeader;