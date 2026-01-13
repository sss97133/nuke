/**
 * VALUE PROVENANCE POPUP
 * 
 * Click any value → See where it came from
 * Permission-based editing (only inserter can modify)
 * 
 * Simple, instant transparency
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { FaviconIcon } from './common/FaviconIcon';
import { getPlatformDisplayName, normalizePlatform } from '../services/platformNomenclature';

interface ValueProvenancePopupProps {
  vehicleId: string;
  field: 'current_value' | 'sale_price' | 'purchase_price' | 'asking_price' | 'high_bid';
  value: number;
  context?: {
    platform?: string | null;
    listing_url?: string | null;
    listing_status?: string | null;
    final_price?: number | null;
    current_bid?: number | null;
    bid_count?: number | null;
    view_count?: number | null;
    watcher_count?: number | null;
    winner_name?: string | null;
    inserted_by_name?: string | null;
    inserted_at?: string | null;
    confidence?: number | null;
    evidence_url?: string | null;
    trend_pct?: number | null;
    trend_period?: string | null;
  };
  onClose: () => void;
  onUpdate?: (newValue: number) => void;
}

interface Provenance {
  source: string;
  confidence: number;
  inserted_by: string;
  inserted_by_name: string;
  inserted_at: string;
  evidence_count: number;
  can_edit: boolean;
  bat_url?: string;
  lot_number?: string;
  sale_date?: string;
  buyer_name?: string;
  seller_username?: string;
  seller_profile_url?: string;
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
}

type AuctionSource = {
  platform: string;
  platform_name: string;
  url: string;
  lot_number: string | null;
  auction_end_date: string | null;
  outcome: string | null;
  winning_bid: number | null;
  high_bid: number | null;
  bid_count: number | null;
  total_bids: number | null;
  comments_count: number | null;
  view_count: number | null;
  watcher_count: number | null;
  seller_name: string | null;
  winning_bidder: string | null;
};

export const ValueProvenancePopup: React.FC<ValueProvenancePopupProps> = ({
  vehicleId,
  field,
  value,
  context,
  onClose,
  onUpdate
}) => {
  const navigate = useNavigate();
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState(value);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [auctionSources, setAuctionSources] = useState<AuctionSource[]>([]);
  const [batAuctionInfo, setBatAuctionInfo] = useState<{ platform?: string; platform_name?: string; url?: string; lot_number?: string; sale_date?: string } | null>(null);
  const [buyerProfileLink, setBuyerProfileLink] = useState<{ url: string; isExternal: boolean } | null>(null);
  const [sellerProfileLink, setSellerProfileLink] = useState<{ url: string; isExternal: boolean } | null>(null);
  const [marketData, setMarketData] = useState<{ prices: number[]; mean: number; stdDev: number } | null>(null);
  
  // Helper to calculate days/years since sale
  const calculateTimeSinceSale = (saleDate: string | null | undefined): string | null => {
    if (!saleDate) return null;
    try {
      const sale = new Date(saleDate);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - sale.getTime());
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays >= 365) {
        const years = Math.floor(diffDays / 365);
        const remainingDays = diffDays % 365;
        return remainingDays > 0 ? `${years} year${years > 1 ? 's' : ''}, ${remainingDays} day${remainingDays !== 1 ? 's' : ''}` : `${years} year${years > 1 ? 's' : ''}`;
      }
      return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadProvenance();
    loadMarketData();
  }, []);

  const loadMarketData = async () => {
    try {
      // Load vehicle details to find comparables
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('year, make, model')
        .eq('id', vehicleId)
        .single();
      
      if (!vehicle?.year || !vehicle?.make || !vehicle?.model) return;
      
      // Find comparable sales (same make/model, +/- 3 years, with sale_price)
      const { data: comparables } = await supabase
        .from('vehicles')
        .select('sale_price, current_value')
        .eq('make', vehicle.make)
        .eq('model', vehicle.model)
        .gte('year', vehicle.year - 3)
        .lte('year', vehicle.year + 3)
        .neq('id', vehicleId)
        .not('sale_price', 'is', null)
        .limit(50);
      
      if (!comparables || comparables.length < 3) {
        // Try with current_value if not enough sale_price data
        const { data: valueComparables } = await supabase
          .from('vehicles')
          .select('current_value')
          .eq('make', vehicle.make)
          .eq('model', vehicle.model)
          .gte('year', vehicle.year - 3)
          .lte('year', vehicle.year + 3)
          .neq('id', vehicleId)
          .not('current_value', 'is', null)
          .limit(50);
        
        if (valueComparables && valueComparables.length >= 3) {
          const prices = valueComparables.map(v => v.current_value).filter((p): p is number => typeof p === 'number' && p > 0);
          if (prices.length >= 3) {
            const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
            const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
            const stdDev = Math.sqrt(variance);
            setMarketData({ prices, mean, stdDev });
          }
        }
        return;
      }
      
      const prices = comparables.map(v => v.sale_price || v.current_value).filter((p): p is number => typeof p === 'number' && p > 0);
      if (prices.length >= 3) {
        const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);
        setMarketData({ prices, mean, stdDev });
      }
    } catch (error) {
      console.error('Error loading market data:', error);
    }
  };

  const loadProvenance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Also load vehicle data to check for BAT auction info
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('bat_auction_url, sale_date, bat_sale_date, updated_at, user_id, uploaded_by, discovery_url, origin_metadata, profile_origin')
        .eq('id', vehicleId)
        .single();
      
      // Check field_evidence for this value
      const { data: evidenceData } = await supabase
        .from('field_evidence')
        .select(`
          *,
          profiles(id, raw_user_meta_data)
        `)
        .eq('vehicle_id', vehicleId)
        .eq('field_name', field)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });
      
      // Check external_listings and auction_events for auction-derived price context (sold or bid-to)
      let auctionInfo: any = null;
      let auctionMetrics: { buyer_name?: string; seller_username?: string; seller_profile_url?: string; bid_count?: number; view_count?: number; watcher_count?: number } = {};
      let auctionHistory: AuctionSource[] = [];
      
      if ((field === 'sale_price' || field === 'high_bid') && (vehicle?.bat_auction_url || vehicle?.discovery_url)) {
        // Detect platform from discovery_url
        const discoveryUrl = vehicle?.discovery_url || vehicle?.bat_auction_url || '';
        let detectedPlatform = 'bat';
        if (discoveryUrl.includes('mecum.com')) detectedPlatform = 'mecum';
        else if (discoveryUrl.includes('barrett-jackson')) detectedPlatform = 'barrett-jackson';
        else if (discoveryUrl.includes('carsandbids.com')) detectedPlatform = 'cars_and_bids';
        else if (discoveryUrl.includes('bonhams.com')) detectedPlatform = 'bonhams';
        else if (discoveryUrl.includes('rmsothebys.com')) detectedPlatform = 'rmsothebys';
        
        const platform = normalizePlatform(detectedPlatform);

        const normalizeUrlLoose = (u: string | null | undefined): string => {
          const s = String(u || '').trim();
          if (!s) return '';
          try {
            const url = new URL(s);
            url.hash = '';
            url.search = '';
            // normalize trailing slash differences
            const out = url.toString();
            return out.endsWith('/') ? out.slice(0, -1) : out;
          } catch {
            const out = s.split('#')[0].split('?')[0].trim();
            return out.endsWith('/') ? out.slice(0, -1) : out;
          }
        };

        const urlCandidates = Array.from(new Set([
          context?.listing_url,
          context?.evidence_url,
          vehicle?.bat_auction_url,
          vehicle?.discovery_url,
        ].map((u) => normalizeUrlLoose(u)).filter(Boolean)));

        // Load ALL auction events for this vehicle/platform (multi-auction aware)
        const { data: auctionEvents } = await supabase
          .from('auction_events')
          .select('source, source_url, lot_number, outcome, auction_start_date, auction_end_date, high_bid, winning_bid, winning_bidder, seller_name, total_bids, comments_count, page_views, watchers')
          .eq('vehicle_id', vehicleId)
          .eq('source', platform)
          .order('auction_end_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(20);

        // Load ALL external listings for this vehicle/platform
        const { data: listings } = await supabase
          .from('external_listings')
          .select('platform, sold_at, end_date, metadata, bid_count, view_count, watcher_count, listing_url')
          .eq('vehicle_id', vehicleId)
          .eq('platform', platform)
          .order('sold_at', { ascending: false, nullsFirst: false })
          .order('end_date', { ascending: false, nullsFirst: false })
          .limit(20);

        const listingByUrl = new Map<string, any>();
        for (const l of (listings || [])) {
          const k = normalizeUrlLoose(l?.listing_url);
          if (k) listingByUrl.set(k, l);
        }

        const platformKey = normalizePlatform(platform);
        const platformName = getPlatformDisplayName(platformKey);

        auctionHistory = (auctionEvents || [])
          .map((ev: any) => {
            const url = normalizeUrlLoose(ev?.source_url);
            if (!url) return null;
            const listing = listingByUrl.get(url) || null;
            return {
              platform: platformKey,
              platform_name: platformName,
              url,
              lot_number: ev?.lot_number ? String(ev.lot_number) : (listing?.metadata?.lot_number ? String(listing.metadata.lot_number) : null),
              auction_end_date: ev?.auction_end_date ? String(ev.auction_end_date) : null,
              outcome: ev?.outcome ? String(ev.outcome) : null,
              winning_bid: typeof ev?.winning_bid === 'number' ? ev.winning_bid : (typeof ev?.winning_bid === 'string' ? Number(ev.winning_bid) : null),
              high_bid: typeof ev?.high_bid === 'number' ? ev.high_bid : (typeof ev?.high_bid === 'string' ? Number(ev.high_bid) : null),
              bid_count: (typeof listing?.bid_count === 'number' ? listing.bid_count : (typeof ev?.total_bids === 'number' ? ev.total_bids : null)),
              total_bids: typeof ev?.total_bids === 'number' ? ev.total_bids : null,
              comments_count: typeof ev?.comments_count === 'number' ? ev.comments_count : null,
              view_count: (typeof listing?.view_count === 'number' ? listing.view_count : (typeof ev?.page_views === 'number' ? ev.page_views : null)),
              watcher_count: (typeof listing?.watcher_count === 'number' ? listing.watcher_count : (typeof ev?.watchers === 'number' ? ev.watchers : null)),
              seller_name: ev?.seller_name ? String(ev.seller_name) : (listing?.metadata?.seller_username ? String(listing.metadata.seller_username) : null),
              winning_bidder: ev?.winning_bidder ? String(ev.winning_bidder) : (listing?.metadata?.buyer_username ? String(listing.metadata.buyer_username) : null),
            } as AuctionSource;
          })
          .filter((x: any): x is AuctionSource => Boolean(x && x.url));

        setAuctionSources(auctionHistory);

        const selectedAuction =
          (auctionHistory.find((a) => urlCandidates.includes(normalizeUrlLoose(a.url))) || auctionHistory[0] || null);
        const selectedListing = selectedAuction ? (listingByUrl.get(normalizeUrlLoose(selectedAuction.url)) || null) : null;
        
        // Also check timeline_events for sale event
        const { data: saleEvent } = await supabase
          .from('timeline_events')
          .select('event_date, cost_amount, metadata')
          .eq('vehicle_id', vehicleId)
          .eq('event_type', 'auction_sold')
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        // For high-bid / RNM, prefer end_date (auction close) instead of sold_at.
        const derivedDate =
          field === 'high_bid'
            ? (selectedListing?.end_date || selectedAuction?.auction_end_date || (vehicle as any)?.auction_end_date || null)
            : (selectedListing?.sold_at || selectedAuction?.auction_end_date || saleEvent?.event_date || vehicle.bat_sale_date || vehicle.sale_date || null);
        
        // Extract lot number from URL for non-BaT platforms
        let lotNumberFromUrl: string | null = null;
        if (platform === 'mecum') {
          const match = (selectedListing?.listing_url || discoveryUrl).match(/\/lots\/(\d+)\//);
          lotNumberFromUrl = match ? match[1] : null;
        }
        
        // Extract lot number from multiple possible sources
        const lotNumber = selectedAuction?.lot_number ||
                         selectedListing?.metadata?.lot_number || 
                         saleEvent?.metadata?.lot_number ||
                         lotNumberFromUrl ||
                         (vehicle as any)?.origin_metadata?.lot_number ||
                         (vehicle as any)?.origin_metadata?.bat_lot_number ||
                         null;
        
        // Extract seller username from multiple sources
        const sellerUsername = selectedAuction?.seller_name ||
                              selectedListing?.metadata?.seller_username || 
                              selectedListing?.metadata?.seller ||
                              saleEvent?.metadata?.seller_username ||
                              saleEvent?.metadata?.seller ||
                              (vehicle as any)?.origin_metadata?.bat_seller_username ||
                              (vehicle as any)?.bat_seller ||
                              null;
        
        // Construct seller profile URL based on platform
        const sellerProfileUrl = platform === 'bat' && sellerUsername
          ? `https://bringatrailer.com/member/${sellerUsername}/`
          : (selectedListing?.metadata?.seller_profile_url || 
             saleEvent?.metadata?.seller_profile_url ||
             (vehicle as any)?.origin_metadata?.bat_seller_profile_url ||
             null);
        
        if (selectedListing || saleEvent || derivedDate || selectedAuction) {
          auctionInfo = {
            platform: platformKey,
            platform_name: platformName,
            url: (selectedListing?.listing_url || selectedAuction?.url || vehicle.bat_auction_url || vehicle?.discovery_url),
            lot_number: lotNumber,
            sale_date: derivedDate
          };
          
          // Extract buyer name and seller info from metadata
          // For SOLD results, do NOT prefer context values (context can be mixed across multiple auctions).
          const isFinalStatus = String(context?.listing_status || '').toLowerCase() === 'sold';
          auctionMetrics = {
            buyer_name: selectedAuction?.winning_bidder || selectedListing?.metadata?.buyer_username || selectedListing?.metadata?.buyer || saleEvent?.metadata?.buyer || saleEvent?.metadata?.buyer_username,
            seller_username: sellerUsername,
            seller_profile_url: sellerProfileUrl,
            bid_count: (isFinalStatus ? null : ((typeof context?.bid_count === 'number' && context.bid_count > 0) ? context.bid_count : null))
              ?? (typeof selectedListing?.bid_count === 'number' ? selectedListing.bid_count : null)
              ?? (typeof selectedAuction?.total_bids === 'number' ? selectedAuction.total_bids : null),
            view_count: (isFinalStatus ? null : ((typeof context?.view_count === 'number' && context.view_count > 0) ? context.view_count : null))
              ?? (typeof selectedListing?.view_count === 'number' ? selectedListing.view_count : null),
            watcher_count: (isFinalStatus ? null : ((typeof context?.watcher_count === 'number' && context.watcher_count > 0) ? context.watcher_count : null))
              ?? (typeof selectedListing?.watcher_count === 'number' ? selectedListing.watcher_count : null)
          };
          
          // Check if buyer has linked N-Zero profile (only for sold events)
          if (auctionMetrics.buyer_name && field === 'sale_price' && platform === 'bat') {
            const { data: buyerIdentity } = await supabase
              .from('external_identities')
              .select('claimed_by_user_id, profile_url, id')
              .eq('platform', 'bat')
              .eq('handle', auctionMetrics.buyer_name)
              .maybeSingle();
            
            if (buyerIdentity?.claimed_by_user_id) {
              setBuyerProfileLink({ url: `/profile/${buyerIdentity.claimed_by_user_id}`, isExternal: false });
            } else if (buyerIdentity?.id) {
              setBuyerProfileLink({ url: `/profile/external/${buyerIdentity.id}`, isExternal: false });
            } else {
              const batProfileUrl = buyerIdentity?.profile_url || `https://bringatrailer.com/member/${auctionMetrics.buyer_name}/`;
              const internal = `/claim-identity?platform=bat&handle=${encodeURIComponent(auctionMetrics.buyer_name)}&profileUrl=${encodeURIComponent(batProfileUrl)}`;
              setBuyerProfileLink({ url: internal, isExternal: false });
            }
          } else {
            setBuyerProfileLink(null);
          }
          
          // Check if seller has linked N-Zero profile
          if (auctionMetrics.seller_username && platform === 'bat') {
            const { data: sellerIdentity } = await supabase
              .from('external_identities')
              .select('claimed_by_user_id, profile_url, id')
              .eq('platform', 'bat')
              .eq('handle', auctionMetrics.seller_username)
              .maybeSingle();
            
            if (sellerIdentity?.claimed_by_user_id) {
              setSellerProfileLink({ url: `/profile/${sellerIdentity.claimed_by_user_id}`, isExternal: false });
            } else if (sellerIdentity?.id) {
              setSellerProfileLink({ url: `/profile/external/${sellerIdentity.id}`, isExternal: false });
            } else {
              const proofUrl = auctionMetrics.seller_profile_url || `https://bringatrailer.com/member/${auctionMetrics.seller_username}/`;
              setSellerProfileLink({ url: `/claim-identity?platform=bat&handle=${encodeURIComponent(auctionMetrics.seller_username)}&profileUrl=${encodeURIComponent(proofUrl)}`, isExternal: false });
            }
          } else {
            setSellerProfileLink(null);
          }
        }
      }
      
      setEvidence(evidenceData || []);
      
      if (evidenceData && evidenceData.length > 0) {
        const latest = evidenceData[0];
        let sourceLabel = latest.source_type;
        if (auctionInfo && (field === 'sale_price' || field === 'high_bid')) {
          sourceLabel = `${auctionInfo.platform_name}${auctionInfo.lot_number ? ` (Lot #${auctionInfo.lot_number})` : ''}`;
        }
        
        setProvenance({
          source: sourceLabel,
          confidence: latest.source_confidence,
          inserted_by: latest.profiles?.id || 'Unknown',
          inserted_by_name: latest.profiles?.raw_user_meta_data?.username || 'Unknown',
          inserted_at: latest.created_at,
          evidence_count: evidenceData.length,
          can_edit: user?.id === latest.profiles?.id,
          bat_url: auctionInfo?.url,
          lot_number: auctionInfo?.lot_number,
          sale_date: auctionInfo?.sale_date,
          buyer_name: auctionMetrics.buyer_name,
          seller_username: auctionMetrics.seller_username,
          seller_profile_url: auctionMetrics.seller_profile_url,
          bid_count: auctionMetrics.bid_count,
          view_count: auctionMetrics.view_count,
          watcher_count: auctionMetrics.watcher_count
        });
        if (auctionInfo) setBatAuctionInfo(auctionInfo);
      } else if (auctionInfo && (field === 'sale_price' || field === 'high_bid')) {
        // No evidence but we have auction info - use that as source
        setProvenance({
          source: `${auctionInfo.platform_name}${auctionInfo.lot_number ? ` (Lot #${auctionInfo.lot_number})` : ''}`,
          confidence: 100,
          inserted_by: 'system',
          inserted_by_name: 'System (auction telemetry)',
          inserted_at: auctionInfo.sale_date || vehicle?.updated_at || new Date().toISOString(),
          evidence_count: 1,
          can_edit: false,
          bat_url: auctionInfo.url,
          lot_number: auctionInfo.lot_number,
          sale_date: auctionInfo.sale_date,
          buyer_name: auctionMetrics.buyer_name,
          seller_username: auctionMetrics.seller_username,
          seller_profile_url: auctionMetrics.seller_profile_url,
          bid_count: auctionMetrics.bid_count,
          view_count: auctionMetrics.view_count,
          watcher_count: auctionMetrics.watcher_count
        });
        setBatAuctionInfo(auctionInfo);
        // Add auction history as evidence (multi-auction aware)
        const auctionEvidence = (auctionHistory.length > 0 ? auctionHistory : [{
          platform: auctionInfo.platform,
          platform_name: auctionInfo.platform_name,
          url: auctionInfo.url,
          lot_number: auctionInfo.lot_number || null,
          auction_end_date: auctionInfo.sale_date || null,
          outcome: String(context?.listing_status || '').toLowerCase() || null,
          winning_bid: value,
          high_bid: value,
          total_bids: null,
          comments_count: null,
          view_count: null,
          watcher_count: null,
          seller_name: auctionMetrics.seller_username || null,
          winning_bidder: auctionMetrics.buyer_name || null,
        } as any]).map((a: any) => ({
          source_type: `${a.platform}_auction`,
          proposed_value: String((field === 'sale_price' ? (a.winning_bid ?? value) : (a.high_bid ?? value)) ?? value),
          source_confidence: 100,
          extraction_context: `Auction URL: ${a.url}`,
          created_at: a.auction_end_date || auctionInfo.sale_date || vehicle?.updated_at || new Date().toISOString(),
        }));
        setEvidence(auctionEvidence);
      } else {
        // No evidence - check who last updated vehicle
        setProvenance({
          source: 'Manual entry (no evidence)',
          confidence: 50,
          inserted_by: vehicle?.uploaded_by || vehicle?.user_id || 'Unknown',
          inserted_by_name: 'Unknown',
          inserted_at: vehicle?.updated_at || new Date().toISOString(),
          evidence_count: 0,
          can_edit: user?.id === vehicle?.uploaded_by || user?.id === vehicle?.user_id
        });
      }
    } catch (error) {
      console.error('Error loading provenance:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!provenance?.can_edit) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Update vehicle value
      const { error: vehicleError } = await supabase
        .from('vehicles')
        .update({ [field]: newValue })
        .eq('id', vehicleId);
      
      if (vehicleError) throw vehicleError;
      
      // Create evidence record
      await supabase
        .from('field_evidence')
        .insert({
          vehicle_id: vehicleId,
          field_name: field,
          proposed_value: newValue.toString(),
          source_type: 'user_input_verified',
          source_confidence: 70,
          extraction_context: `Updated by ${user?.email}`,
          status: 'accepted'
        });
      
      onUpdate?.(newValue);
      onClose();
    } catch (error: any) {
      alert('Failed to update: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'var(--surface)',
        border: '2px solid #000',
        padding: '20px',
        zIndex: 10000,
        minWidth: '400px'
      }}>
        Loading...
      </div>
    );
  }

  const getConfidenceColor = (conf: number) => {
    if (conf >= 90) return '#10b981';
    if (conf >= 75) return '#3b82f6';
    if (conf >= 60) return '#f59e0b';
    return '#ef4444';
  };

  const isAuctionResultMode = (() => {
    const status = String(context?.listing_status || '').toLowerCase();
    const platform = String(context?.platform || '').toLowerCase();
    const hasFinal = typeof context?.final_price === 'number' && Number.isFinite(context.final_price) && context.final_price > 0;
    if (field !== 'sale_price' && field !== 'high_bid') return false;
    // Only show "auction result" when the auction is actually final (blank is better than wrong).
    const outcomeIsFinal =
      status === 'sold' ||
      status === 'ended' ||
      status === 'reserve_not_met';
    const hasBid =
      typeof context?.current_bid === 'number' && Number.isFinite(context.current_bid) && context.current_bid > 0;
    if (outcomeIsFinal && (hasFinal || hasBid || (typeof value === 'number' && value > 0))) {
      return true;
    }
    // Fallback: BaT timeline-event-based sale price can be treated as an auction result only when there's an explicit "sold" marker.
    if (
      status === 'sold' &&
      (platform === 'bat' || (context?.listing_url || '').includes('bringatrailer.com')) &&
      (context?.evidence_url || provenance?.bat_url || batAuctionInfo?.url)
    ) {
      return true;
    }
    return false;
  })();

  const auctionStatus = String(context?.listing_status || '').toLowerCase();
  const auctionPrice = (() => {
    if (!isAuctionResultMode) return null;
    if (typeof context?.final_price === 'number' && Number.isFinite(context.final_price) && context.final_price > 0) return context.final_price;
    if (typeof context?.current_bid === 'number' && Number.isFinite(context.current_bid) && context.current_bid > 0) return context.current_bid;
    return value;
  })();

  const headerValue = (() => {
    if (isAuctionResultMode) {
      const finalPrice = typeof context?.final_price === 'number' && Number.isFinite(context.final_price) && context.final_price > 0 ? context.final_price : null;
      if (finalPrice !== null) return finalPrice;
    }
    return value;
  })();

  const headerPrefix = (() => {
    if (!isAuctionResultMode) return null;
    if (auctionStatus === 'sold') return 'SOLD';
    if (auctionStatus === 'reserve_not_met') return field === 'high_bid' ? 'BID TO (RNM)' : 'WINNING BID (RNM)';
    return field === 'high_bid' ? 'BID TO' : 'WINNING BID';
  })();

  const effectiveConfidence = (() => {
    if (typeof context?.confidence === 'number' && Number.isFinite(context.confidence)) return context.confidence;
    if (isAuctionResultMode && (context?.evidence_url || context?.listing_url)) return 100;
    if (typeof provenance?.confidence === 'number' && Number.isFinite(provenance.confidence)) return provenance.confidence;
    return 0;
  })();

  const insertedAtLabel = (() => {
    const ts = context?.inserted_at || provenance?.inserted_at;
    if (!ts) return null;
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) return null;
    return new Date(t).toLocaleString();
  })();

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      'vin_checksum_valid': 'VIN Decode (Authoritative)',
      'nhtsa_vin_decode': 'NHTSA Official Data',
      'auction_result_bat': 'BaT Auction Result',
      'bat_auction': 'BaT Auction Result',
      'scraped_listing': 'Scraped Listing',
      'build_estimate_csv': 'Build Estimate CSV',
      'user_input_verified': 'User Entry',
      'receipts_validated': 'Verified Receipts',
      'Manual entry (no evidence)': 'Manual Entry (No Proof)'
    };
    return labels[source] || source;
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          minWidth: '700px',
          maxWidth: '900px',
          fontFamily: 'Arial, sans-serif',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg)'
        }}>
          <div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              {isAuctionResultMode ? 'Auction result' : 'Value provenance'}
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>
              {isAuctionResultMode
                ? `${headerPrefix || ''} ${Number(auctionPrice ?? headerValue).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`.trim()
                : headerValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </div>
            {isAuctionResultMode && (context?.winner_name || '').trim() ? (
              <div style={{ marginTop: 4, fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 600 }}>
                Winner: {String(context?.winner_name).trim()}
              </div>
            ) : null}
          </div>
          <button
            onClick={onClose}
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              padding: '4px 12px',
              fontSize: '7pt',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            CLOSE
          </button>
        </div>

        {/* Two-column layout: Provenance Info (left) and Bell Curve (right) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
          {/* Provenance Info - Left Column */}
          <div style={{ padding: '16px', borderRight: '1px solid var(--border)' }}>
          {/* Trend (what we think it’s worth based on price signal) */}
          {typeof context?.trend_pct === 'number' && Number.isFinite(context.trend_pct) ? (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
                Trend
              </div>
              <div style={{ fontSize: '9pt', fontWeight: 800, color: context.trend_pct >= 0 ? '#16a34a' : '#dc2626' }}>
                {context.trend_pct >= 0 ? 'UP' : 'DOWN'} {Math.abs(context.trend_pct).toFixed(1)}% {context.trend_period ? String(context.trend_period).toUpperCase() : ''}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 4 }}>
                Based on internal price signal. Open price timeline for details.
              </div>
            </div>
          ) : null}

          {/* Source */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              Source
            </div>
            <div style={{ fontSize: '9pt', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              {(context?.evidence_url || provenance?.bat_url) ? (
                <FaviconIcon url={String(context?.evidence_url || provenance?.bat_url)} size={14} preserveAspectRatio={true} />
              ) : null}
              <span>
                {(() => {
                  // Prefer explicit platform label when auction telemetry is present.
                  const platform = String(context?.platform || '').toLowerCase();
                  if (platform === 'bat') {
                    const lotNumber = provenance?.lot_number || batAuctionInfo?.lot_number;
                    const platformName = batAuctionInfo?.platform_name || 'Bring a Trailer';
                    return lotNumber ? `${platformName} (Lot #${lotNumber})` : platformName;
                  }
                  // Check if provenance source already includes lot number
                  const sourceText = provenance ? getSourceLabel(provenance.source) : 'Unknown';
                  // If it's a BaT source and we have lot number, ensure it's included
                  if ((sourceText.includes('Bring a Trailer') || provenance?.source?.includes('Bring a Trailer')) && provenance?.lot_number && !sourceText.includes('Lot #')) {
                    return `Bring a Trailer (Lot #${provenance.lot_number})`;
                  }
                  return sourceText;
                })()}
              </span>
            </div>
            {/* Seller Username with Profile Link */}
            {provenance?.seller_username && (
              <div style={{ marginTop: '8px', fontSize: '8pt', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Seller:</span>
                {sellerProfileLink ? (
                  <a
                    href={sellerProfileLink.url}
                    style={{
                      color: 'var(--primary)',
                      textDecoration: 'underline',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontWeight: 600
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      navigate(sellerProfileLink.url);
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        fontWeight: 800,
                        color: 'var(--text)',
                        lineHeight: 1,
                        paddingTop: 1,
                        boxSizing: 'border-box'
                      }}
                      aria-hidden="true"
                    >
                      {String(provenance.seller_username || '').slice(0, 1).toUpperCase()}
                    </span>
                    {provenance.seller_username}
                  </a>
                ) : (
                  <span>{provenance.seller_username}</span>
                )}
              </div>
            )}
          </div>

          {/* Auction history (multi-auction provenance) */}
          {(field === 'sale_price' || field === 'high_bid') && auctionSources.length > 1 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
                Auction history
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {auctionSources.map((a) => {
                  const d = a.auction_end_date ? new Date(a.auction_end_date) : null;
                  const dLabel = d && Number.isFinite(d.getTime())
                    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Date unknown';

                  const amount = field === 'high_bid'
                    ? (a.high_bid ?? a.winning_bid)
                    : (a.winning_bid ?? a.high_bid);

                  const amountLabel = (typeof amount === 'number' && Number.isFinite(amount) && amount > 0)
                    ? amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
                    : '—';

                  const outcome = String(a.outcome || '').trim() || '—';
                  const bids = (typeof a.bid_count === 'number' && Number.isFinite(a.bid_count) && a.bid_count > 0) ? `${a.bid_count.toLocaleString()} bids` : null;
                  const views = (typeof a.view_count === 'number' && Number.isFinite(a.view_count) && a.view_count > 0) ? `${a.view_count.toLocaleString()} views` : null;
                  const watchers = (typeof a.watcher_count === 'number' && Number.isFinite(a.watcher_count) && a.watcher_count > 0) ? `${a.watcher_count.toLocaleString()} watchers` : null;
                  const metaBits = [bids, views, watchers].filter(Boolean).join(' • ');

                  return (
                    <div
                      key={a.url}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        background: 'var(--bg)',
                        padding: '8px 10px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                        <div style={{ fontSize: '8pt', fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.platform_name}{a.lot_number ? ` (Lot #${a.lot_number})` : ''}
                        </div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{dLabel}</div>
                      </div>
                      <div style={{ marginTop: 4, fontSize: '8pt', display: 'flex', gap: 10, flexWrap: 'wrap', color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--text)', fontWeight: 700 }}>{amountLabel}</span>
                        <span>{outcome}</span>
                        {a.seller_name ? <span>Seller: {a.seller_name}</span> : null}
                        {a.winning_bidder ? <span>Buyer: {a.winning_bidder}</span> : null}
                        {metaBits ? <span>{metaBits}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              Confidence
            </div>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold',
              color: getConfidenceColor(effectiveConfidence)
            }}>
              {effectiveConfidence}%
            </div>
          </div>

          {/* Inserted By - Show only inserter name, rest in hover */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              Inserted By
            </div>
            <div 
              style={{ fontSize: '9pt' }}
              title={(() => {
                const parts: string[] = [];
                const inserterName = context?.inserted_by_name || provenance?.inserted_by_name || 'Unknown';
                if (insertedAtLabel) parts.push(insertedAtLabel);
                if (!provenance?.can_edit && inserterName) {
                  parts.push(`Only ${inserterName} can edit this value`);
                }
                return parts.length > 0 ? parts.join('\n') : undefined;
              })()}
            >
              {context?.inserted_by_name || provenance?.inserted_by_name || 'Unknown'}
            </div>
          </div>

          {/* Sale Date / Auction End */}
          {(field === 'sale_price' || field === 'high_bid') && provenance?.sale_date && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
                {field === 'sale_price' ? 'Date Sold' : 'Auction Ended'}
              </div>
              <div style={{ fontSize: '9pt', fontWeight: 600 }}>
                {new Date(provenance.sale_date).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                })}
                {(() => {
                  const timeSince = calculateTimeSinceSale(provenance.sale_date);
                  return timeSince ? ` (${timeSince} ago)` : '';
                })()}
              </div>
              {field === 'sale_price' && provenance.buyer_name && (
                <div style={{ fontSize: '9pt', marginTop: '4px', color: 'var(--text-muted)' }}>
                  To: {buyerProfileLink ? (
                    <a
                      href={buyerProfileLink.url}
                      target={buyerProfileLink.isExternal ? '_blank' : undefined}
                      rel={buyerProfileLink.isExternal ? 'noopener noreferrer' : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!buyerProfileLink.isExternal) {
                          e.preventDefault();
                          // Navigate internally
                          navigate(buyerProfileLink.url);
                        }
                      }}
                      style={{
                        color: 'var(--primary)',
                        textDecoration: 'underline',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {provenance.buyer_name}
                    </a>
                  ) : (
                    provenance.buyer_name
                  )}
                </div>
              )}
            </div>
          )}

          {/* Auction Metrics (bids, views, watchers) */}
          {field === 'sale_price' && (provenance?.bid_count !== undefined || provenance?.view_count !== undefined || provenance?.watcher_count !== undefined || context?.bid_count !== undefined || context?.view_count !== undefined || context?.watcher_count !== undefined) && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
                Auction Metrics
              </div>
              <div style={{ fontSize: '9pt', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {(() => {
                  // Prefer context (live data) over provenance (database), but show provenance if context is missing
                  const bidCount = (typeof context?.bid_count === 'number' && context.bid_count > 0) ? context.bid_count : (provenance?.bid_count ?? null);
                  return bidCount !== null && bidCount !== undefined ? (
                    <a
                      href={provenance?.bat_url || context?.evidence_url || context?.listing_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        color: 'var(--text)',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        padding: '2px 8px',
                        borderRadius: '3px',
                        background: 'var(--grey-100)',
                        border: '1px solid var(--border)',
                        fontWeight: 600,
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--grey-200)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--grey-100)';
                      }}
                    >
                      <strong>{bidCount.toLocaleString()}</strong> {bidCount === 1 ? 'bid' : 'bids'}
                    </a>
                  ) : null;
                })()}
                {(() => {
                  // Prefer context (live data) over provenance (database)
                  const viewCount = (typeof context?.view_count === 'number' && context.view_count > 0) ? context.view_count : (provenance?.view_count ?? null);
                  return viewCount !== null && viewCount !== undefined ? (
                    <a
                      href={provenance?.bat_url || context?.evidence_url || context?.listing_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        color: 'var(--text)',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        padding: '2px 8px',
                        borderRadius: '3px',
                        background: 'var(--grey-100)',
                        border: '1px solid var(--border)',
                        fontWeight: 600,
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--grey-200)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--grey-100)';
                      }}
                    >
                      <strong>{viewCount.toLocaleString()}</strong> {viewCount === 1 ? 'view' : 'views'}
                    </a>
                  ) : null;
                })()}
                {(() => {
                  // Prefer context (live data) over provenance (database)
                  const watcherCount = (typeof context?.watcher_count === 'number' && context.watcher_count > 0) ? context.watcher_count : (provenance?.watcher_count ?? null);
                  return watcherCount !== null && watcherCount !== undefined ? (
                    <a
                      href={provenance?.bat_url || context?.evidence_url || context?.listing_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        color: 'var(--text)',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        padding: '2px 8px',
                        borderRadius: '3px',
                        background: 'var(--grey-100)',
                        border: '1px solid var(--border)',
                        fontWeight: 600,
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--grey-200)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--grey-100)';
                      }}
                    >
                      <strong>{watcherCount.toLocaleString()}</strong> {watcherCount === 1 ? 'watcher' : 'watchers'}
                    </a>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          {/* Evidence (at minimum, the listing URL counts as evidence for auction telemetry) */}
          {/* Evidence link removed - keeping users on site */}

          {/* Evidence Count */}
          {evidence.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
                Supporting Evidence
              </div>
              <div style={{ fontSize: '9pt' }}>
                {evidence.length} source{evidence.length > 1 ? 's' : ''}
              </div>
              {evidence.length > 1 && (
                <div style={{ marginTop: '8px', maxHeight: '150px', overflowY: 'auto' }}>
                  {evidence.map((e, idx) => (
                    <div key={idx} style={{
                      padding: '6px',
                      marginBottom: '4px',
                      background: '#f9f9f9',
                      border: '1px solid #e0e0e0',
                      fontSize: '7pt'
                    }}>
                      <div style={{ fontWeight: 'bold' }}>{getSourceLabel(e.source_type)}</div>
                      <div style={{ color: '#666' }}>
                        Value: ${parseFloat(e.proposed_value).toLocaleString()} • 
                        Confidence: {e.source_confidence}%
                      </div>
                      {e.extraction_context && (
                        <div style={{ marginTop: '4px', fontStyle: 'italic' }}>
                          "{e.extraction_context}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* No Evidence Warning */}
          {evidence.length === 0 && !(context?.evidence_url || provenance?.bat_url) && (
            <div style={{
              padding: '12px',
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '4px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '7pt', fontWeight: 'bold', color: '#856404', marginBottom: '4px' }}>
                NO EVIDENCE FOUND
              </div>
              <div style={{ fontSize: '7pt', color: '#856404' }}>
                This value has no supporting evidence. Upload receipts or build estimates to verify.
              </div>
            </div>
          )}

            {/* Edit Section (only if user has permission) */}
            {provenance?.can_edit && (
              <div style={{
                borderTop: '1px solid #e0e0e0',
                paddingTop: '16px',
                marginTop: '16px'
              }}>
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px solid #000',
                    background: 'var(--surface)',
                    fontSize: '7pt',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    textTransform: 'uppercase'
                  }}
                >
                  EDIT VALUE
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
                    New Value
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="number"
                      value={newValue}
                      onChange={(e) => setNewValue(parseFloat(e.target.value))}
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '2px solid #000',
                        fontSize: '9pt'
                      }}
                    />
                    <button
                      onClick={handleUpdate}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid #000',
                        background: '#000',
                        color: '#fff',
                        fontSize: '7pt',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      SAVE
                    </button>
                    <button
                      onClick={() => {
                        setEditing(false);
                        setNewValue(value);
                      }}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid #000',
                        background: 'var(--surface)',
                        fontSize: '7pt',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          </div>

          {/* Bell Curve Chart - Right Column */}
          <div style={{ padding: '16px', background: 'var(--bg)' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.6px', fontWeight: 700 }}>
              Market Distribution
            </div>
            {marketData && marketData.prices.length >= 3 ? (
              <BellCurveChart 
                value={value}
                mean={marketData.mean}
                stdDev={marketData.stdDev}
                prices={marketData.prices}
              />
            ) : (
              <div style={{ 
                padding: '20px', 
                textAlign: 'center', 
                color: 'var(--text-muted)', 
                fontSize: '8pt',
                fontStyle: 'italic'
              }}>
                Insufficient market data<br/>for comparable vehicles
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Bell Curve Chart Component
const BellCurveChart: React.FC<{ value: number; mean: number; stdDev: number; prices: number[] }> = ({ 
  value, 
  mean, 
  stdDev,
  prices 
}) => {
  const width = 280;
  const height = 180;
  const padding = { top: 20, right: 20, bottom: 40, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate price range (mean ± 3 standard deviations)
  const minPrice = Math.max(0, mean - 3 * stdDev);
  const maxPrice = mean + 3 * stdDev;
  const priceRange = maxPrice - minPrice;

  // Generate bell curve points
  const generateBellCurve = (steps: number = 100) => {
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const price = minPrice + (priceRange * i) / steps;
      const z = (price - mean) / stdDev;
      // Normal distribution PDF: (1 / (stdDev * sqrt(2π))) * exp(-0.5 * z^2)
      const density = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
      points.push({ x: price, y: density });
    }
    return points;
  };

  const curvePoints = generateBellCurve();
  const maxDensity = Math.max(...curvePoints.map(p => p.y));

  // Scale to chart coordinates
  const scaleX = (price: number) => padding.left + ((price - minPrice) / priceRange) * chartWidth;
  const scaleY = (density: number) => padding.top + chartHeight - (density / maxDensity) * chartHeight;

  // Create SVG path for bell curve
  const curvePath = curvePoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.x)} ${scaleY(p.y)}`)
    .join(' ');

  // Calculate z-score for current value
  const zScore = (value - mean) / stdDev;
  const valueX = scaleX(value);

  // Create histogram from actual prices
  const bins = 20;
  const binSize = priceRange / bins;
  const histogram: number[] = new Array(bins).fill(0);
  prices.forEach(price => {
    if (price >= minPrice && price <= maxPrice) {
      const binIndex = Math.min(Math.floor((price - minPrice) / binSize), bins - 1);
      histogram[binIndex]++;
    }
  });
  const maxCount = Math.max(...histogram);

  return (
    <div>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {/* Grid lines */}
        {[0, 0.5, 1].map(factor => {
          const price = minPrice + priceRange * factor;
          const x = scaleX(price);
          return (
            <line
              key={factor}
              x1={x}
              y1={padding.top}
              x2={x}
              y2={height - padding.bottom}
              stroke="var(--border)"
              strokeWidth="0.5"
              opacity={0.3}
            />
          );
        })}

        {/* Histogram bars */}
        {histogram.map((count, i) => {
          const binStart = minPrice + i * binSize;
          const binEnd = binStart + binSize;
          const x = scaleX(binStart);
          const barWidth = scaleX(binEnd) - x;
          const barHeight = count > 0 ? (count / maxCount) * chartHeight * 0.3 : 0;
          return (
            <rect
              key={i}
              x={x}
              y={height - padding.bottom - barHeight}
              width={barWidth}
              height={barHeight}
              fill="#0ea5e9"
              opacity={0.2}
            />
          );
        })}

        {/* Bell curve */}
        <path
          d={curvePath}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="2"
        />

        {/* Current value line */}
        <line
          x1={valueX}
          y1={padding.top}
          x2={valueX}
          y2={height - padding.bottom}
          stroke="#dc2626"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        <circle
          cx={valueX}
          cy={scaleY((1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * zScore * zScore))}
          r="4"
          fill="#dc2626"
        />

        {/* Labels */}
        <text
          x={width / 2}
          y={height - 5}
          textAnchor="middle"
          fontSize="7pt"
          fill="var(--text-muted)"
        >
          Price
        </text>
        <text
          x={padding.left - 5}
          y={height / 2}
          textAnchor="middle"
          fontSize="7pt"
          fill="var(--text-muted)"
          transform={`rotate(-90 ${padding.left - 5} ${height / 2})`}
        >
          Density
        </text>

        {/* Value label */}
        <text
          x={valueX}
          y={padding.top - 5}
          textAnchor="middle"
          fontSize="7pt"
          fill="#dc2626"
          fontWeight="bold"
        >
          ${value.toLocaleString()}
        </text>

        {/* Stats */}
        <text
          x={padding.left}
          y={padding.top + 15}
          fontSize="7pt"
          fill="var(--text-muted)"
        >
          Mean: ${mean.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>
        <text
          x={padding.left}
          y={padding.top + 27}
          fontSize="7pt"
          fill="var(--text-muted)"
        >
          σ: ${stdDev.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>
        <text
          x={padding.left}
          y={padding.top + 39}
          fontSize="7pt"
          fill="var(--text-muted)"
        >
          Z: {zScore.toFixed(2)}
        </text>
        <text
          x={padding.left}
          y={padding.top + 51}
          fontSize="7pt"
          fill="var(--text-muted)"
        >
          n: {prices.length}
        </text>
      </svg>
    </div>
  );
};

