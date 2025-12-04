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
  session,
  permissions,
  responsibleName,
  onPriceClick,
  initialValuation,
  initialPriceSignal,
  organizationLinks = [],
  onClaimClick
}) => {
  const navigate = useNavigate();
  const { isVerifiedOwner, contributorRole } = permissions || {};
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
    // Auction current bid
    if (vehicle.auction_source && vehicle.bid_count && typeof vehicle.current_bid === 'number') {
      return { amount: vehicle.current_bid, label: 'Current Bid' };
    }
    // Asking
    if (typeof vehicle.asking_price === 'number') {
      return { amount: vehicle.asking_price, label: 'Asking' };
    }
    // Sold - respect auction outcome
    if (typeof vehicle.sale_price === 'number') {
      const outcome = (vehicle as any).auction_outcome;
      if (outcome === 'sold') {
        return { amount: vehicle.sale_price, label: 'SOLD FOR' };
      } else if (outcome === 'reserve_not_met') {
        // Don't show price for RNM
        return { amount: null, label: 'Reserve Not Met' };
      } else {
        return { amount: vehicle.sale_price, label: 'Sold for' };
      }
    }
    // Reserve Not Met with no sale price
    if ((vehicle as any).auction_outcome === 'reserve_not_met') {
      return { amount: null, label: 'Reserve Not Met' };
    }
    // Estimate
    if (typeof vehicle.current_value === 'number') {
      return { amount: vehicle.current_value, label: 'Estimated Value' };
    }
    // Purchase
    if (typeof vehicle.purchase_price === 'number') {
      return { amount: vehicle.purchase_price, label: 'Purchase Price' };
    }
    // MSRP
    if (typeof vehicle.msrp === 'number') {
      return { amount: vehicle.msrp, label: 'Original MSRP' };
    }
    return { amount: null, label: '' };
  };

  const getDisplayValue = () => {
    if (!vehicle) return { amount: null as number | null, label: '' };
    const mode = displayMode || 'auto';
    if (mode === 'auto') {
      // Prefer computed valuation if available
      if (valuation && typeof valuation.estimatedValue === 'number' && valuation.estimatedValue > 0) {
        return { amount: valuation.estimatedValue, label: 'Estimated Value' };
      }
      return getAutoDisplay();
    }
    if (mode === 'estimate') {
      // Prefer unified valuation service
      if (valuation && typeof valuation.estimatedValue === 'number' && valuation.estimatedValue > 0) {
        return { amount: valuation.estimatedValue, label: 'Estimated Value' };
      }
      // Fallback to RPC/primary price heuristic
      if (rpcSignal && typeof rpcSignal.primary_value === 'number' && rpcSignal.primary_label) {
        return { amount: rpcSignal.primary_value, label: rpcSignal.primary_label };
      }
      const pi = computePrimaryPrice({
        msrp: (vehicle as any).msrp,
        current_value: (vehicle as any).current_value,
        purchase_price: (vehicle as any).purchase_price,
        asking_price: (vehicle as any).asking_price,
        sale_price: (vehicle as any).sale_price,
        is_for_sale: (vehicle as any).is_for_sale,
      } as any);
      return { amount: typeof pi.amount === 'number' ? pi.amount : null, label: pi.label || 'Estimated Value' };
    }
    if (mode === 'auction') return { amount: typeof vehicle.current_bid === 'number' ? vehicle.current_bid : null, label: 'Current Bid' };
    if (mode === 'asking') return { amount: typeof vehicle.asking_price === 'number' ? vehicle.asking_price : null, label: 'Asking Price' };
    if (mode === 'sale') {
      // Respect auction outcome for proper disclosure
      if ((vehicle as any).auction_outcome === 'sold') {
        return { amount: typeof vehicle.sale_price === 'number' ? vehicle.sale_price : null, label: 'SOLD FOR' };
      } else if ((vehicle as any).auction_outcome === 'reserve_not_met') {
        // Don't show high bid for RNM - user needs to click for details
        return { amount: null, label: 'Reserve Not Met' };
      } else if ((vehicle as any).auction_outcome === 'no_sale') {
        return { amount: null, label: 'No Sale' };
      } else if (typeof vehicle.sale_price === 'number') {
        return { amount: vehicle.sale_price, label: 'Sold for' };
      }
      return { amount: null, label: '' };
    }
    if (mode === 'purchase') return { amount: typeof vehicle.purchase_price === 'number' ? vehicle.purchase_price : null, label: 'Purchase Price' };
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
    if (session?.user?.id === vehicle?.uploaded_by) return 'Uploader';
    
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

  const visibleOrganizations = useMemo(() => {
    return (organizationLinks || []).slice(0, 3);
  }, [organizationLinks]);

  const extraOrgCount = Math.max(0, (organizationLinks?.length || 0) - visibleOrganizations.length);

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
  const priceText = primaryAmount !== null ? formatCurrency(primaryAmount) : 'Set a price';
  const priceDescriptor = saleDate ? 'Sold price' : primaryLabel;
  
  // Auction outcome badge and link
  const getAuctionContext = () => {
    const outcome = (vehicle as any)?.auction_outcome;
    const batUrl = (vehicle as any)?.bat_auction_url || ((vehicle as any)?.discovery_url?.includes('bringatrailer') ? (vehicle as any)?.discovery_url : null);
    const kslUrl = (vehicle as any)?.discovery_url?.includes('ksl.com') ? (vehicle as any)?.discovery_url : null;
    const sourceUrl = batUrl || kslUrl || (vehicle as any)?.discovery_url;
    
    const badges: Record<string, any> = {
      'sold': { text: 'SOLD', color: '#22c55e', bg: '#dcfce7' },
      'reserve_not_met': { text: 'RNM', color: '#f59e0b', bg: '#fef3c7' },
      'no_sale': { text: 'NO SALE', color: '#6b7280', bg: '#f3f4f6' },
      'pending': { text: 'LIVE', color: '#3b82f6', bg: '#dbeafe' }
    };
    
    return {
      badge: outcome ? badges[outcome] : null,
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
  const identityParts = vehicle ? [
    vehicle.year,
    vehicle.make,
    displayModel, // Use normalized model if available
    (vehicle as any).series && (vehicle as any).series !== displayModel 
      ? (vehicle as any).series 
      : null, // Include series if different from model
    (vehicle as any).trim 
      ? (vehicle as any).trim 
      : null // Include trim if available
  ].filter(Boolean) : [];
  
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

  // Check if vehicle is pending - either by status or by missing VIN
  const hasVIN = vehicle?.vin && vehicle.vin.trim() !== '' && !vehicle.vin.startsWith('VIVA-');
  const isPending = vehicle && ((vehicle as any).status === 'pending' || !hasVIN);
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
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '3px 8px',
        margin: 0,
        marginLeft: 'calc(-1 * var(--space-2))',
        marginRight: 'calc(-1 * var(--space-2))',
        position: 'sticky',
        top: '48px',
        left: 0,
        right: 0,
        width: '100vw',
        maxWidth: '100vw',
        zIndex: 97,
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'nowrap', justifyContent: 'space-between', alignItems: 'center', gap: '6px', width: '100%' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, color: baseTextColor, display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', overflow: 'hidden' }}>
          <span style={{ fontSize: '8pt', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {identityLabel}
          </span>
          {vehicle && (vehicle as any).profile_origin && (() => {
            // Don't show origin badge if we're showing organization name (avoid duplication)
            const isAutomatedImport = vehicle?.profile_origin === 'dropbox_import' && 
                                      (vehicle?.origin_metadata?.automated_import === true || 
                                       vehicle?.origin_metadata?.no_user_uploader === true ||
                                       !vehicle?.uploaded_by);
            const isOrgName = isAutomatedImport && vehicle?.origin_organization_id && responsibleName;
            
            // Only show badge if not showing org name
            if (isOrgName) return null;
            
            return (
              <span style={{ fontSize: '7pt', color: mutedTextColor, padding: '1px 6px', background: 'var(--grey-100)', borderRadius: '3px', whiteSpace: 'nowrap' }}>
                {(() => {
                  const origin = (vehicle as any).profile_origin;
                  const originLabels: Record<string, string> = {
                    'bat_import': 'BAT',
                    'dropbox_import': 'Dropbox',
                    'url_scraper': 'Scraped',
                    'manual_entry': 'Manual',
                    'api_import': 'API'
                  };
                  return originLabels[origin] || origin;
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
                      background: 'white',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
                      padding: 12,
                      width: 320,
                      zIndex: 50,
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
                                  onClick={() => window.open(`/vehicle/${similar.id}`, '_blank')}
                                  style={{
                                    background: 'transparent',
                                    border: '1px solid #d1d5db',
                                    color: '#374151',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '7pt',
                                    cursor: 'pointer',
                                  }}
                                >
                                  View
                                </button>
                                {permissions?.canEdit && (
                                  <button
                                    onClick={async () => {
                                      if (confirm(`Merge this vehicle into "${similar.year} ${similar.make} ${similar.model}"? This will combine all data.`)) {
                                        try {
                                          await VehicleDeduplicationService.mergeVehicles(similar.id, vehicle.id);
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
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onClaimClick) {
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
                  fontSize: '8pt'
                }}
              >
                Claim This Vehicle
            </button>
            )}
            {responsibleName && showOwnerCard && ownerProfile && (
              <div
                style={{
                  position: 'absolute',
                  top: '130%',
                  left: 0,
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
                  padding: 12,
                  width: 260,
                  zIndex: 50
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
              {visibleOrganizations.map((org) => (
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
            title={auctionContext.link ? `Click to view on ${auctionContext.link.includes('bringatrailer') ? 'Bring a Trailer' : 'original listing'}` : undefined}
          >
            <div 
              style={{ fontSize: '9pt', fontWeight: 700, color: baseTextColor, lineHeight: 1, display: 'flex', alignItems: 'center', gap: 6 }}
              title={priceWasCorrected ? 'Price was auto-corrected from listing (e.g., $15 -> $15,000)' : undefined}
            >
              <span
                className="provenance-price-clickable"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowProvenancePopup(true);
                }}
                style={{
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                  textDecorationColor: 'rgba(0,0,0,0.3)'
                }}
                title="Click to see data source and confidence"
              >
                {priceText}
              </span>
              {priceWasCorrected && (
                <span style={{ fontSize: '7pt', color: 'var(--warning)', fontWeight: 500 }}>*</span>
              )}
              
              {/* Auction Outcome Badge */}
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
                  whiteSpace: 'nowrap'
                }}>
                  {auctionContext.badge.text}
                </span>
              )}
              
              {/* VIN Authority Badge */}
              {vehicle.vin && vehicle.vin.length >= 11 && (
                <span 
                  style={{
                    fontSize: '6pt',
                    fontWeight: 700,
                    color: '#22c55e',
                    background: '#dcfce7',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    letterSpacing: '0.5px',
                    lineHeight: 1
                  }}
                  title="Factory specs verified via VIN decode"
                >
                  VIN VERIFIED
                </span>
              )}
              
              {/* External link icon if has listing URL */}
              {auctionContext.link && (
                <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" opacity="0.4">
                  <path d="M10.5 1.5h-3v1.5h1.94L4.72 7.72l1.06 1.06L10.5 4.06V6h1.5V1.5zM10.5 10.5h-9v-9H6V0H1.5C.67 0 0 .67 0 1.5v9c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5V6h-1.5v4.5z"/>
                </svg>
              )}
            </div>
              {trendIndicator}
          </button>

          {priceMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 8,
                background: 'white',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                boxShadow: '0 12px 24px rgba(15, 23, 42, 0.15)',
                padding: 12,
                fontSize: '8pt',
                color: baseTextColor,
                width: '280px',
                zIndex: 100
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
                <button
                  type="button"
                  className="button button-small"
                  style={{ fontSize: '8pt' }}
                  onClick={handleViewValuation}
                >
                  View valuation details
                </button>
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

      {showProvenancePopup && vehicle && primaryAmount !== null && (
        <ValueProvenancePopup
          vehicleId={vehicle.id}
          field="current_value"
          value={primaryAmount}
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