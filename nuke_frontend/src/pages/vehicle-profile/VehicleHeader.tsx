import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { VehicleHeaderProps } from './types';
import { computePrimaryPrice, formatCurrency } from '../../services/priceSignalService';
import { supabase } from '../../lib/supabase';
// Deprecated modals (history/analysis/tag review) intentionally removed from UI
import { VehicleValuationService } from '../../services/vehicleValuationService';
import TradePanel from '../../components/trading/TradePanel';
import { VehicleDeduplicationService } from '../../services/vehicleDeduplicationService';
import { ValueProvenancePopup } from '../../components/ValueProvenancePopup';
import DataValidationPopup from '../../components/vehicle/DataValidationPopup';
import { useVINProofs } from '../../hooks/useVINProofs';
import { FaviconIcon } from '../../components/common/FaviconIcon';
import { AuctionPlatformBadge, AuctionStatusBadge } from '../../components/auction/AuctionBadges';
import { OdometerBadge } from '../../components/vehicle/OdometerBadge';
import vinDecoderService from '../../services/vinDecoder';

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
  const [trendPeriod, setTrendPeriod] = useState<'live' | '1w' | '30d' | '6m' | '1y' | '5y'>('30d');
  
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
  const [listingSourceOpen, setListingSourceOpen] = useState(false);
  const listingSourceRef = useRef<HTMLDivElement | null>(null);

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

  // Load trend based on selected period
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) { setTrendPct(null); return; }
        
        // Don't show trend if price was auto-corrected (e.g., $15 -> $15,000)
        // The "trend" would be the correction, not real market movement
        if ((vehicle as any)?.origin_metadata?.price_corrected === true ||
            (vehicle as any)?.origin_metadata?.price_was_corrected === true) {
          setTrendPct(null);
          return;
        }

        // Calculate start date based on period
        const now = Date.now();
        let since = now;
        
        switch (trendPeriod) {
          case 'live': since = now - 24 * 60 * 60 * 1000; break; // Last 24h
          case '1w': since = now - 7 * 24 * 60 * 60 * 1000; break;
          case '30d': since = now - 30 * 24 * 60 * 60 * 1000; break;
          case '6m': since = now - 180 * 24 * 60 * 60 * 1000; break;
          case '1y': since = now - 365 * 24 * 60 * 60 * 1000; break;
          case '5y': since = now - 5 * 365 * 24 * 60 * 60 * 1000; break;
        }

        // Fetch price history
        const { data, error } = await supabase
          .from('vehicle_price_history')
          .select('price_type,value,as_of')
          .eq('vehicle_id', vehicle.id)
          .in('price_type', ['current','asking','sale'])
          .order('as_of', { ascending: false })
          .limit(100); // Fetch more for longer periods

        if (error || !Array.isArray(data) || data.length < 2) {
          setTrendPct(null);
          return;
        }

        // For 'live', we also check builds/receipts for active investment
        if (trendPeriod === 'live') {
          // Get build IDs for this vehicle first
          const { data: builds } = await supabase
            .from('vehicle_builds')
            .select('id')
            .eq('vehicle_id', vehicle.id);
            
          let recentInvestment = 0;
          
          if (builds && builds.length > 0) {
            const buildIds = builds.map(b => b.id);
            // Check for recent build items
            const { data: recentItems } = await supabase
              .from('build_line_items')
              .select('total_price')
              .in('build_id', buildIds)
              .gte('created_at', new Date(since).toISOString());
              
            recentInvestment = recentItems?.reduce((sum, item) => sum + (item.total_price || 0), 0) || 0;
          }
          
          // If there's investment today, show positive trend
          if (recentInvestment > 0) {
             const currentValue = vehicle.current_value || vehicle.purchase_price || 10000; // fallback base
             const pct = (recentInvestment / currentValue) * 100;
             setTrendPct(pct);
             return;
          }
        }

        const withinPeriod = (data as any[]).filter(d => new Date(d.as_of).getTime() >= since);
        // Need at least start and end points, or fallback to closest outside range if needed
        const arr = withinPeriod.length >= 2 ? withinPeriod : (data as any[]);
        
        if (arr.length < 2) { setTrendPct(null); return; }
        
        const latest = arr[0];
        const baseline = arr[arr.length - 1]; // Earliest point in the period (or closest available)
        
        if (!latest?.value || !baseline?.value || baseline.value === 0) { setTrendPct(null); return; }
        
        const pct = ((latest.value - baseline.value) / baseline.value) * 100;
        setTrendPct(pct);
      } catch {
        setTrendPct(null);
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
    
    // 1. Sale price (actual sold price) - highest truth
    if (typeof vehicle.sale_price === 'number' && vehicle.sale_price > 0) {
      const outcome = v.auction_outcome;
      if (outcome === 'sold') {
        return { amount: vehicle.sale_price, label: 'SOLD FOR' };
      } else {
        return { amount: vehicle.sale_price, label: 'Sold for' };
      }
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
      if (auctionPulse?.listing_url) {
        const status = String(auctionPulse.listing_status || '').toLowerCase();
        const isLive = status === 'active' || status === 'live';
        const isSold = status === 'sold';

        if (isSold && typeof (auctionPulse as any).final_price === 'number' && Number.isFinite((auctionPulse as any).final_price) && (auctionPulse as any).final_price > 0) {
          return { amount: (auctionPulse as any).final_price, label: 'SOLD FOR' };
        }
        if (isLive && typeof auctionPulse.current_bid === 'number' && Number.isFinite(auctionPulse.current_bid) && auctionPulse.current_bid > 0) {
          return { amount: auctionPulse.current_bid, label: 'Current Bid' };
        }
      }
    } catch {
      // ignore
    }
    
    // 5. Current bid from vehicle (if no external listing)
    if (typeof vehicle.current_bid === 'number' && Number.isFinite(vehicle.current_bid) && vehicle.current_bid > 0) {
      return { amount: vehicle.current_bid, label: 'Current Bid' };
    }
    
    // 6. Asking price (only if for sale)
    if (typeof vehicle.asking_price === 'number' && vehicle.asking_price > 0 && (v.is_for_sale === true || String(v.sale_status || '').toLowerCase() === 'for_sale')) {
      return { amount: vehicle.asking_price, label: 'Asking' };
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
      if (typeof vehicle.asking_price === 'number') {
        // Asking price can be shown without verified source (user intent to sell)
        // But if there IS a source, prefer it
        return { amount: vehicle.asking_price, label: 'Asking Price' };
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
        
        // Respect auction outcome for proper disclosure
        if ((vehicle as any).auction_outcome === 'sold') {
          return { amount: vehicle.sale_price, label: 'SOLD FOR' };
        } else if ((vehicle as any).auction_outcome === 'reserve_not_met') {
          // Don't show high bid for RNM - user needs to click for details
          return { amount: null, label: 'Reserve Not Met' };
        } else if ((vehicle as any).auction_outcome === 'no_sale') {
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
    // We’d rather show nothing than lie.
    const maxReasonable = 14 * 24 * 60 * 60 * 1000;
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
  const [auctionNow, setAuctionNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!auctionPulse?.end_date) return;
    const tick = () => setAuctionNow(Date.now());
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, 1000);
    return () => window.clearInterval(id);
  }, [auctionPulse?.end_date]);

  const formatCountdownClock = (iso?: string | null) => {
    if (!iso) return null;
    const end = new Date(iso).getTime();
    if (!Number.isFinite(end)) return null;
    const diff = end - auctionNow;
    const maxReasonable = 14 * 24 * 60 * 60 * 1000;
    if (diff > maxReasonable) return null;
    if (diff <= 0) return 'Ended';
    const totalSeconds = Math.floor(diff / 1000);
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  const isAuctionLive = useMemo(() => {
    if (!auctionPulse?.listing_url) return false;
    const status = String(auctionPulse.listing_status || '').toLowerCase();
    // Some environments may backfill listings with status='unknown' initially. If we have a future end_date,
    // treat it as live so the header shows the auction pulse instead of hiding it.
    if (status !== 'active' && status !== 'live') {
      if (!auctionPulse?.end_date) return false;
      const end = new Date(auctionPulse.end_date).getTime();
      if (!Number.isFinite(end)) return false;
      return end > auctionNow;
    }
    if (!auctionPulse.end_date) return true;
    const end = new Date(auctionPulse.end_date).getTime();
    if (!Number.isFinite(end)) return true;
    return end > auctionNow;
  }, [auctionPulse, auctionNow]);

  const auctionTelemetryFresh = useMemo(() => {
    const updatedAt = auctionPulse?.updated_at ? new Date(auctionPulse.updated_at as any).getTime() : NaN;
    if (!Number.isFinite(updatedAt)) return false;
    const diffMin = (Date.now() - updatedAt) / (1000 * 60);
    // If we don't have a recent update, don't trust counts (avoids misleading UI).
    return diffMin >= 0 && diffMin <= 15;
  }, [auctionPulse?.updated_at]);

  const auctionPulseMs = useMemo(() => {
    if (!auctionPulse?.listing_url) return null;
    if (!isAuctionLive) return null;
    if (!auctionPulse?.end_date) return 3800;
    const end = new Date(auctionPulse.end_date).getTime();
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
  }, [auctionPulse?.listing_url, auctionPulse?.end_date, auctionNow, isAuctionLive]);

  const auctionStatusForBadge = useMemo(() => {
    const status = String(auctionPulse?.listing_status || '').toLowerCase();
    if (!auctionPulse?.listing_url) return null;
    if (status === 'sold') return 'sold' as const;
    if (status === 'reserve_not_met') return 'reserve_not_met' as const;
    if (status === 'active' || status === 'live') {
      // "Ending soon" when under 1h
      if (auctionPulse?.end_date) {
        const end = new Date(auctionPulse.end_date).getTime();
        if (Number.isFinite(end)) {
          const mins = Math.floor((end - auctionNow) / 60000);
          if (mins <= 60 && mins > 0) return 'ending_soon' as const;
        }
      }
      return 'active' as const;
    }
    if (status === 'pending') return 'pending' as const;
    if (status === 'ended') return 'ended' as const;
    // Unknown status: infer from end_date if available (common right after backfill).
    if (auctionPulse?.end_date) {
      const end = new Date(auctionPulse.end_date).getTime();
      if (Number.isFinite(end)) {
        const mins = Math.floor((end - auctionNow) / 60000);
        if (mins > 0 && mins <= 60) return 'ending_soon' as const;
        if (mins > 0) return 'active' as const;
        return 'ended' as const;
      }
    }
    return 'ended' as const;
  }, [auctionPulse, auctionNow]);

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
    const first = links
      .filter((x) => x && sellerRels.includes(pickRel(x)))
      .sort((a, b) => sellerRels.indexOf(pickRel(a)) - sellerRels.indexOf(pickRel(b)))[0];

    if (first?.business_name) {
      return {
        label: String(first.business_name),
        logo_url: first.logo_url ? String(first.logo_url) : null,
        relationship: pickRel(first),
      };
    }

    const metaSeller = String((vehicle as any)?.origin_metadata?.bat_seller || (vehicle as any)?.origin_metadata?.seller || '').trim();
    if (metaSeller) {
      const slug = metaSeller
        .trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
        .replace(/\/+$/, '');
      const href = slug ? `https://bringatrailer.com/member/${slug}/` : null;
      return { label: metaSeller, logo_url: null, relationship: 'seller', href, kind: 'bat_user' };
    }

    return null;
  }, [organizationLinks, vehicle]);

  const batMemberLink = useMemo(() => {
    const metaSeller = String((vehicle as any)?.origin_metadata?.bat_seller || (vehicle as any)?.origin_metadata?.seller || '').trim();
    if (!metaSeller) return null;
    const slug = metaSeller
      .trim()
      .replace(/^@/, '')
      .replace(/^https?:\/\/bringatrailer\.com\/member\//i, '')
      .replace(/\/+$/, '');
    if (!slug) return null;
    return { label: metaSeller, href: `https://bringatrailer.com/member/${slug}/` };
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

  const saleDate = (vehicle as any)?.sale_date || (vehicle as any)?.bat_sale_date || null;
  const primaryPrice = getDisplayValue();
  const primaryAmount = typeof primaryPrice.amount === 'number' ? primaryPrice.amount : null;
  const primaryLabel = primaryPrice.label || 'Price pending';
  const priceDescriptor = saleDate ? 'Sold price' : primaryLabel;
  
  // For RNM (Reserve Not Met), show blurred high bid instead of "Set a price"
  const isRNM = (vehicle as any)?.auction_outcome === 'reserve_not_met';
  const highBid = (vehicle as any)?.high_bid || (vehicle as any)?.winning_bid;
  const priceDisplay = (() => {
    // If we have external auction telemetry, reflect it directly in the header.
    if (auctionPulse?.listing_url) {
      const status = String(auctionPulse.listing_status || '').toLowerCase();
      const isLive = status === 'active' || status === 'live';
      const isSold = status === 'sold';
      const isEnded = status === 'ended' || status === 'reserve_not_met';
      
      // Live auction: show current bid
      if (isLive && typeof auctionPulse.current_bid === 'number' && Number.isFinite(auctionPulse.current_bid) && auctionPulse.current_bid > 0) {
        return `Bid: ${formatCurrency(auctionPulse.current_bid)}`;
      }
      if (isLive) return 'BID';
      
      // Sold: show final price or SOLD badge
      if (isSold) {
        const finalPrice = typeof (auctionPulse as any).final_price === 'number' && Number.isFinite((auctionPulse as any).final_price) && (auctionPulse as any).final_price > 0
          ? (auctionPulse as any).final_price
          : (typeof (vehicle as any)?.sale_price === 'number' && (vehicle as any).sale_price > 0 ? (vehicle as any).sale_price : null);
        if (finalPrice) {
          return formatCurrency(finalPrice);
        }
        return 'SOLD';
      }
      
      // Ended/RNM: show final price, high bid, or sale price if available
      if (isEnded) {
        const finalPrice = typeof (auctionPulse as any).final_price === 'number' && Number.isFinite((auctionPulse as any).final_price) && (auctionPulse as any).final_price > 0
          ? (auctionPulse as any).final_price
          : null;
        const salePrice = typeof (vehicle as any)?.sale_price === 'number' && (vehicle as any).sale_price > 0 ? (vehicle as any).sale_price : null;
        const winBid = typeof (vehicle as any)?.winning_bid === 'number' && (vehicle as any).winning_bid > 0 ? (vehicle as any).winning_bid : null;
        const hBid = typeof (vehicle as any)?.high_bid === 'number' && (vehicle as any).high_bid > 0 ? (vehicle as any).high_bid : null;
        
        if (finalPrice) return formatCurrency(finalPrice);
        if (salePrice) return formatCurrency(salePrice);
        if (winBid) return formatCurrency(winBid);
        if (hBid) return formatCurrency(hBid);
        
        // If we have asking price and it's marked for sale, show it
        const askingPrice = typeof (vehicle as any)?.asking_price === 'number' && (vehicle as any).asking_price > 0 && ((vehicle as any).is_for_sale === true || String((vehicle as any).sale_status || '').toLowerCase() === 'for_sale')
          ? (vehicle as any).asking_price
          : null;
        if (askingPrice) return formatCurrency(askingPrice);
        
        // Last resort: show "Ended" or "RNM"
        if (status === 'reserve_not_met') return 'RNM';
        return 'Ended';
      }
      
      // Unknown status: fall through to primary amount
    }

    // Fallback to primary amount or RNM high bid
    return primaryAmount !== null
      ? formatCurrency(primaryAmount)
      : (isRNM && highBid)
        ? formatCurrency(highBid)
        : 'Set a price';
  })();

  const priceHoverText = (() => {
    // Hover reveals more detail (without adding noise to the visible header).
    if (auctionPulse?.listing_url) {
      const status = String(auctionPulse.listing_status || '').toLowerCase();
      const isSold = status === 'sold';
      const isLive = status === 'active' || status === 'live';
      if (isSold && typeof (auctionPulse as any).final_price === 'number' && Number.isFinite((auctionPulse as any).final_price) && (auctionPulse as any).final_price > 0) {
        return `Sold price: ${formatCurrency((auctionPulse as any).final_price)}`;
      }
      if (isLive && typeof auctionPulse.current_bid === 'number' && Number.isFinite(auctionPulse.current_bid) && auctionPulse.current_bid > 0) {
        return `Current bid: ${formatCurrency(auctionPulse.current_bid)}`;
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
    const rawOutcome = (vehicle as any)?.auction_outcome;
    const batUrl = (vehicle as any)?.bat_auction_url || ((vehicle as any)?.discovery_url?.includes('bringatrailer') ? (vehicle as any)?.discovery_url : null);
    const kslUrl = (vehicle as any)?.discovery_url?.includes('ksl.com') ? (vehicle as any)?.discovery_url : null;
    const sourceUrl = batUrl || kslUrl || (vehicle as any)?.discovery_url;
    
    // Never allow conflicting states like "SOLD RNM".
    // SOLD wins if we have any sold signal (telemetry > canonical fields > legacy outcome).
    const telemetryStatus = auctionPulse?.listing_url ? String(auctionPulse.listing_status || '').toLowerCase() : '';
    const hasSoldSignal =
      telemetryStatus === 'sold' ||
      (typeof (auctionPulse as any)?.final_price === 'number' && Number.isFinite((auctionPulse as any).final_price) && (auctionPulse as any).final_price > 0) ||
      (typeof (vehicle as any)?.sale_price === 'number' && Number.isFinite((vehicle as any).sale_price) && (vehicle as any).sale_price > 0) ||
      rawOutcome === 'sold';

    const outcome = hasSoldSignal ? 'sold' : rawOutcome;

    const badges: Record<string, any> = {
      'sold': { text: 'SOLD', color: '#22c55e', bg: '#dcfce7' },
      'reserve_not_met': { text: 'RNM', color: '#f59e0b', bg: '#fef3c7' },
      'no_sale': { text: 'NO SALE', color: '#6b7280', bg: '#f3f4f6' },
      'pending': { text: 'LIVE', color: '#3b82f6', bg: '#dbeafe' }
    };

    // RNM is only valid once the auction has ended (or the platform explicitly reports RNM).
    // If an auction is still live/active, showing RNM is misleading.
    const outcomeIsFinal = (() => {
      if (!outcome) return false;
      if (outcome === 'sold') return true;
      if (outcome !== 'reserve_not_met') return true;

      // Prefer live telemetry when available.
      if (auctionPulse?.listing_url) {
        const status = String(auctionPulse.listing_status || '').toLowerCase();
        if (status === 'reserve_not_met' || status === 'ended' || status === 'sold') return true;
        if (status === 'active' || status === 'live') return false;
        if (auctionPulse.end_date) {
          const end = new Date(auctionPulse.end_date).getTime();
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
    
    return (
      <span 
        onClick={toggleTrendPeriod}
        title={`Click to toggle period (Current: ${periodLabel})`}
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
  }, [trendPct, trendPeriod]);

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

  // Close listing source popover when clicking outside
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!listingSourceOpen) return;
      if (listingSourceRef.current && !listingSourceRef.current.contains(event.target as Node)) {
        setListingSourceOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [listingSourceOpen]);

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
        flex: '1 1 auto',
        minWidth: 0,
        height: '31px',
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
        position: 'static'
      }}>
        {/* 1. Title */}
        <div style={{ flex: '0 1 auto', minWidth: 0, color: baseTextColor, display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '8pt', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
            {identityLabel}
          </span>
        </div>

        {/* 2. Badges Section */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {typeof derivedMileage === 'number' && derivedMileage > 0 ? (
            <OdometerBadge mileage={derivedMileage} year={vehicle?.year ?? null} isExact={mileageIsExact} />
          ) : null}
          {listingUrl ? (
            <div ref={listingSourceRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                type="button"
                className="badge badge-secondary"
                title="Listing source (click)"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setListingSourceOpen((v) => !v);
                }}
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  background: 'var(--grey-50)',
                }}
              >
                <FaviconIcon url={String(listingUrl)} size={14} preserveAspectRatio={true} />
              </button>

              {listingSourceOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    boxShadow: '0 12px 24px rgba(15, 23, 42, 0.15)',
                    padding: 10,
                    minWidth: 260,
                    zIndex: 950,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ fontWeight: 800, fontSize: '10px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Listing source
                  </div>
                  <div style={{ marginTop: 6, fontSize: '10px', fontWeight: 700, color: baseTextColor }}>
                    {listingHost || listingSourceLabel || 'External listing'}
                  </div>
                  <div style={{ marginTop: 6, fontSize: '9px', color: mutedTextColor, wordBreak: 'break-all' }}>
                    {String(listingUrl)}
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="button button-small"
                      onClick={() => {
                        try {
                          window.open(String(listingUrl), '_blank', 'noopener,noreferrer');
                        } catch {
                          // ignore
                        } finally {
                          setListingSourceOpen(false);
                        }
                      }}
                      style={{ fontSize: '8pt' }}
                    >
                      OPEN
                    </button>
                    <button
                      type="button"
                      className="button button-small"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(String(listingUrl));
                          toast.success('Link copied', { duration: 1200 });
                        } catch {
                          toast.error('Copy failed', { duration: 1200 });
                        }
                      }}
                      style={{ fontSize: '8pt' }}
                    >
                      COPY
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Seller visibility (do not hide the seller behind tiny icons) */}
          {sellerBadge?.label ? (
            (sellerBadge as any)?.href ? (
              <a
                href={String((sellerBadge as any).href)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="badge badge-secondary"
                title={sellerBadge.relationship === 'consigner' ? 'Consigner' : 'Seller'}
                style={{ fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 280, textDecoration: 'none', color: 'inherit' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sellerBadge.label}
                </span>
              </a>
            ) : (
              <span
                className="badge badge-secondary"
                title={sellerBadge.relationship === 'consigner' ? 'Consigner' : 'Seller'}
                style={{ fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 280 }}
              >
                {sellerBadge.logo_url ? (
                  <img src={sellerBadge.logo_url} alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} />
                ) : null}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sellerBadge.label}
                </span>
              </span>
            )
          ) : null}
          {/* Live auction pulse badges (vehicle-first: auction is just a live data source) */}
          {auctionPulse?.listing_url && auctionStatusForBadge && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <AuctionPlatformBadge
                platform={auctionPulse.platform}
                urlForFavicon={auctionPulse.listing_url}
                label={auctionPulse.platform === 'bat' ? 'BaT' : undefined}
              />
              <AuctionStatusBadge
                status={auctionStatusForBadge as any}
                title={isAuctionLive ? 'Live auction telemetry' : 'Auction status'}
              />
              {auctionPulse.updated_at ? (
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
              {auctionPulse.end_date ? (
                <span
                  className="badge badge-secondary"
                  style={{ fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  title={auctionPulse.end_date ? `Time remaining: ${formatRemaining(auctionPulse.end_date) || '—'}` : 'Time remaining'}
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
                    {formatCountdownClock(auctionPulse.end_date) || formatRemaining(auctionPulse.end_date) || '—'}
                  </span>
                </span>
              ) : null}
              {auctionTelemetryFresh && typeof auctionPulse.bid_count === 'number' ? (
                <span className="badge badge-secondary" style={{ fontSize: '10px', fontWeight: 700 }} title="Bid count">
                  {auctionPulse.bid_count} bids
                </span>
              ) : null}
              {auctionTelemetryFresh && typeof auctionPulse.watcher_count === 'number' ? (
                <span className="badge badge-secondary" style={{ fontSize: '10px', fontWeight: 700 }} title="Watchers">
                  {auctionPulse.watcher_count.toLocaleString()} watching
                </span>
              ) : null}
              {auctionTelemetryFresh && typeof auctionPulse.view_count === 'number' ? (
                <span className="badge badge-secondary" style={{ fontSize: '10px', fontWeight: 700 }} title="Views">
                  {auctionPulse.view_count.toLocaleString()} views
                </span>
              ) : null}
              {auctionTelemetryFresh && typeof auctionPulse.comment_count === 'number' ? (
                <span className="badge badge-secondary" style={{ fontSize: '10px', fontWeight: 700 }} title="Comments">
                  {auctionPulse.comment_count.toLocaleString()} comments
                </span>
              ) : null}
              {auctionTelemetryFresh && auctionPulse.last_bid_at ? (
                <span className="badge badge-secondary" style={{ fontSize: '10px', fontWeight: 700 }} title="Time since last bid">
                  last bid {formatAge(auctionPulse.last_bid_at) || '—'} ago
                </span>
              ) : null}
            </span>
          )}
          {/* Hide external import/source badge once the profile is claimed/verified to avoid contaminating context */}
          {!isVerifiedOwner && vehicle && (vehicle as any).profile_origin && (() => {
            // Don't show origin badge if we're showing organization name (avoid duplication)
            const isAutomatedImport = vehicle?.profile_origin === 'dropbox_import' && 
                                      (vehicle?.origin_metadata?.automated_import === true || 
                                       vehicle?.origin_metadata?.no_user_uploader === true ||
                                       !vehicle?.uploaded_by);
            const isOrgName = isAutomatedImport && vehicle?.origin_organization_id && responsibleName;
            
            // Only show badge if not showing org name
            if (isOrgName) return null;

            // Avoid duplicate platform badging (e.g. BaT favicon + "BaT" twice) when auction telemetry is present.
            if (auctionPulse?.listing_url) {
              const origin = String((vehicle as any).profile_origin || '');
              const discoveryUrl = String((vehicle as any).discovery_url || '');
              const isBatOrigin = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');
              const isBatPulse = String(auctionPulse.platform || '').toLowerCase() === 'bat';
              if (isBatOrigin && isBatPulse) return null;
            }
            
            return (
              <span 
                style={{ 
                  fontSize: '7pt', 
                  color: mutedTextColor, 
                  padding: '1px 6px', 
                  background: 'var(--grey-100)', 
                  borderRadius: '3px', 
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const origin = (vehicle as any).profile_origin;
                  const discoveryUrl = (vehicle as any).discovery_url;
                  if (discoveryUrl) {
                    window.open(discoveryUrl, '_blank');
                  } else {
                    alert(`Imported via ${origin}\n\nClick the source badge on other vehicles to see their import stats.`);
                  }
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--border)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--grey-100)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
                title={(vehicle as any).discovery_url ? "Click to view original listing" : "Import source"}
              >
                {(() => {
                  const origin = (vehicle as any).profile_origin;
                  const discoveryUrl = (vehicle as any).discovery_url;
                  
                  // Show favicon for known sources with URLs (and ALWAYS show text label)
                  if (discoveryUrl) {
                    try {
                      const domain = new URL(discoveryUrl).hostname;
                      return (
                        <>
                          <img 
                            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                            alt=""
                            style={{ width: '10px', height: '10px' }}
                            onError={(e) => {
                              // Fallback to text if favicon fails
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                          {origin === 'bat_import' ? 'BaT' : 
                           origin === 'ksl_import' ? 'KSL' :
                           origin === 'craigslist_scrape' ? 'CL' :
                           domain.split('.')[0].toUpperCase()}
                        </>
                      );
                    } catch {
                      // Invalid URL, fallback to text
                    }
                  }
                  
                  // Fallback: Just show text label
                  const originLabels: Record<string, string> = {
                    'bat_import': 'BaT',
                    'dropbox_import': 'Dropbox',
                    'url_scraper': 'Scraped',
                    'manual_entry': 'Manual',
                    'craigslist_scrape': 'CL',
                    'ksl_import': 'KSL',
                    'api_import': 'API'
                  };
                  // Map the origin to display label, fallback to origin itself if not in map
                  const displayLabel = originLabels[origin] || origin?.replace(/_/g, ' ') || 'Unknown';
                  return displayLabel;
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
                          {' '}and enter the 17-character VIN
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
                if (auctionPulse?.listing_url) {
                  const status = String(auctionPulse.listing_status || '').toLowerCase();
                  const isLiveStatus = status === 'active' || status === 'live';
                  const isSoldStatus = status === 'sold';
                  const label = (() => {
                    if (isLiveStatus) {
                      return typeof auctionPulse.current_bid === 'number' && Number.isFinite(auctionPulse.current_bid) && auctionPulse.current_bid > 0
                        ? `Bid: ${formatCurrency(auctionPulse.current_bid)}`
                        : 'BID';
                    }
                    if (isSoldStatus && typeof (auctionPulse as any).final_price === 'number' && Number.isFinite((auctionPulse as any).final_price) && (auctionPulse as any).final_price > 0) {
                      return `Sold: ${formatCurrency((auctionPulse as any).final_price)}`;
                    }
                    if (isSoldStatus) return 'SOLD';
                    if (status === 'ended') return 'Auction ended';
                    return 'View auction';
                  })();
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

                if (isDiscoveredVehicle) {
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
                          ? (claimNeedsId ? 'Claim started. Upload your driver’s license to complete.' : 'Claim submitted.')
                          : 'Upload title document to claim ownership'
                      }
                    >
                      {hasClaim ? (claimNeedsId ? 'Complete claim' : 'Claim submitted') : 'Claim this vehicle'}
                    </a>
                  );
                }
                
                // For user-uploaded vehicles, show "Claim this vehicle" button instead of uploader name
                if (!isOrgName && !isVerified) {
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
                          ? (claimNeedsId ? 'Claim started. Upload your driver’s license to complete.' : 'Claim submitted.')
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
              auctionPulse?.listing_url ? null : (
                <a
                  href={claimHref}
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
          {visibleOrganizations.length > 0 && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {visibleOrganizations
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
                .map((org) => (
                <Link
                  key={org.id}
                  to={`/org/${org.organization_id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    toast.success(
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '11px' }}>{org.business_name}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                          {formatRelationship(org.relationship_type)}
                        </div>
                      </div>,
                      { 
                        duration: 3000, 
                        position: 'top-right',
                        style: {
                          borderRadius: '4px',
                          padding: '8px 12px',
                          fontSize: '10px'
                        }
                      }
                    );
                    setTimeout(() => navigate(`/org/${org.organization_id}`), 100);
                  }}
                  title={`${org.business_name} (${formatRelationship(org.relationship_type)})`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '20px',
                    height: '20px',
                    border: '1px solid var(--border)',
                    borderRadius: '50%',
                    background: 'var(--surface)',
                    color: baseTextColor,
                    textDecoration: 'none',
                    fontSize: '10px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'transform 0.1s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  {org.logo_url ? (
                    <img src={org.logo_url} alt={org.business_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    org.business_name.charAt(0).toUpperCase()
                  )}
                </Link>
              ))}
              {extraOrgCount > 0 && (
                <span style={{ fontSize: '8px', color: mutedTextColor }}>+{extraOrgCount}</span>
              )}
            </div>
          )}
        </div>

        <div ref={priceMenuRef} style={{ flex: '0 0 auto', textAlign: 'right', position: 'relative' }}>
          <button
            type="button"
            onClick={(e) => {
              // User wants to click the price value and see data provenance popup
              e.preventDefault();
              e.stopPropagation();
              setShowProvenancePopup(true);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6
            }}
            className="vehicle-price-button"
            title="Click to view price source, confidence, and trend"
          >
            <div 
              style={{ fontSize: '9pt', fontWeight: 700, color: baseTextColor, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 6 }}
              title={priceWasCorrected ? 'Price was auto-corrected from listing (e.g., $15 -> $15,000)' : undefined}
            >
              <span
                className={`provenance-price-clickable${auctionPulseMs && isAuctionLive ? ' auction-price-pulse' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowProvenancePopup(true);
                }}
                style={{
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                  textDecorationColor: 'rgba(0,0,0,0.3)',
                  // Blur effect for RNM auctions (reserve not met)
                  filter: isRNM && highBid && String(priceDisplay).toUpperCase() !== 'SOLD' ? 'blur(4px)' : 'none',
                  transition: 'filter 0.2s ease',
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
                {String(priceDisplay).toUpperCase() === 'SOLD' ? (
                  <span
                    style={{
                      fontSize: '6pt',
                      fontWeight: 800,
                      color: '#22c55e',
                      background: '#dcfce7',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      letterSpacing: '0.5px',
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                      textDecoration: 'none',
                    }}
                  >
                    SOLD
                  </span>
                ) : (
                  priceDisplay
                )}
              </span>
              {priceWasCorrected && (
                <span style={{ fontSize: '7pt', color: 'var(--warning)', fontWeight: 500 }}>*</span>
              )}
              
              {/* Auction Outcome Badge */}
              {auctionContext.badge && auctionContext.badge.text !== 'SOLD' && (
                <span style={{
                  fontSize: '6pt',
                  fontWeight: 700,
                  color: auctionContext.badge.color,
                  background: auctionContext.badge.bg,
                  padding: '2px 6px',
                  borderRadius: '3px',
                  letterSpacing: '0.5px',
                  lineHeight: 1,
                  whiteSpace: 'nowrap'
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
              
              {/* External link icon - move outside price display to avoid layout issues */}
              {auctionContext.link && (
                <a
                  href={auctionContext.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={auctionContext.link.includes('bringatrailer') ? 'Open on Bring a Trailer' : 'Open original listing'}
                  style={{ 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    color: 'inherit', 
                    opacity: 0.6, 
                    textDecoration: 'none',
                    marginLeft: '4px',
                    padding: '2px',
                    borderRadius: '2px',
                    transition: 'opacity 0.12s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.background = 'var(--grey-100)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.6';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M10.5 1.5h-3v1.5h1.94L4.72 7.72l1.06 1.06L10.5 4.06V6h1.5V1.5zM10.5 10.5h-9v-9H6V0H1.5C.67 0 0 .67 0 1.5v9c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5V6h-1.5v4.5z"/>
                  </svg>
                </a>
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
            platform: auctionPulse?.platform ? String(auctionPulse.platform) : null,
            listing_url: auctionPulse?.listing_url ? String(auctionPulse.listing_url) : null,
            listing_status: auctionPulse?.listing_status ? String(auctionPulse.listing_status) : null,
            final_price: typeof (auctionPulse as any)?.final_price === 'number' ? (auctionPulse as any).final_price : null,
            current_bid: typeof auctionPulse?.current_bid === 'number' ? auctionPulse.current_bid : null,
            bid_count: typeof auctionPulse?.bid_count === 'number' ? auctionPulse.bid_count : null,
            winner_name: (() => {
              const pulseWinner =
                typeof (auctionPulse as any)?.winner_name === 'string' ? (auctionPulse as any).winner_name :
                typeof (auctionPulse as any)?.winning_bidder_name === 'string' ? (auctionPulse as any).winning_bidder_name :
                typeof (auctionPulse as any)?.winner_display_name === 'string' ? (auctionPulse as any).winner_display_name :
                null;
              const fallback = String((vehicle as any)?.origin_metadata?.bat_buyer || (vehicle as any)?.origin_metadata?.buyer || '').trim() || null;
              return (pulseWinner && String(pulseWinner).trim()) ? String(pulseWinner).trim() : fallback;
            })(),
            inserted_by_name: auctionPulse?.listing_url ? 'System (auction telemetry)' : null,
            inserted_at: auctionPulse?.updated_at
              ? String(auctionPulse.updated_at as any)
              : (auctionPulse?.end_date ? String(auctionPulse.end_date as any) : null),
            confidence: auctionPulse?.listing_url ? 100 : null,
            evidence_url: auctionPulse?.listing_url ? String(auctionPulse.listing_url) : ((vehicle as any)?.discovery_url ? String((vehicle as any).discovery_url) : null),
            trend_pct: typeof trendPct === 'number' ? trendPct : null,
            trend_period: trendPeriod || null
          }}
          onClose={() => setShowProvenancePopup(false)}
          onUpdate={(newValue) => {
            // Optionally refresh the vehicle data or update local state
            setShowProvenancePopup(false);
            window.location.reload(); // Simple refresh for now
          }}
        />
      )}
    </div>
  );
};

export default VehicleHeader;