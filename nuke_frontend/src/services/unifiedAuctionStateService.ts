/**
 * Unified Auction State Service
 * 
 * Treats auction states (timer, live, future) as TEMPORARY MODES, not permanent vehicle properties.
 * All auction types are handled uniformly through external_listings.
 * 
 * Key concept: A vehicle can be "in auction mode" temporarily, then return to normal state.
 */

export type AuctionMode = 
  | 'scheduled'      // Future auction (not started yet)
  | 'active_timer'   // Timer auction (countdown running)
  | 'active_live'   // Live auction (happening now)
  | 'ending_soon'    // Timer auction < 60s remaining
  | 'ended'          // Auction ended (processing)
  | 'sold'           // Auction completed - sold
  | 'unsold'         // Auction ended - not sold (RNM, no bids, etc.)
  | 'cancelled'      // Auction cancelled
  | null;            // Not in auction mode

export interface AuctionStateInfo {
  mode: AuctionMode;
  platform: string | null;
  currentBid: number | null;
  endDate: string | null;
  startDate: string | null;
  listingUrl: string | null;
  listingId: string | null;
  bidCount: number | null;
  reservePrice: number | null;
  finalPrice: number | null;
  soldAt: string | null;
  metadata: Record<string, any>;
}

/**
 * Determine the current auction mode for a vehicle
 * This is the single source of truth for "is this vehicle in auction mode?"
 */
export function getAuctionMode(vehicle: any): AuctionMode {
  const now = Date.now();
  
  // Priority 1: Check external_listings (most reliable, platform-agnostic)
  const externalListing = vehicle?.external_listings?.[0];
  if (externalListing) {
    const status = String(externalListing.listing_status || '').toLowerCase();
    const endDate = externalListing.end_date;
    const startDate = externalListing.start_date;
    
    // Check if scheduled (future start date)
    if (startDate) {
      const start = new Date(startDate).getTime();
      if (Number.isFinite(start) && start > now) {
        return 'scheduled';
      }
    }
    
    // Check if active
    if (status === 'active' || status === 'live') {
      if (endDate) {
        const end = new Date(endDate).getTime();
        if (Number.isFinite(end)) {
          const secondsRemaining = (end - now) / 1000;
          
          // Timer auction with < 60s remaining
          if (secondsRemaining > 0 && secondsRemaining < 60) {
            return 'ending_soon';
          }
          
          // Timer auction (future end date)
          if (end > now) {
            return status === 'live' ? 'active_live' : 'active_timer';
          }
        }
      } else {
        // No end date but status is active/live - assume live auction
        return status === 'live' ? 'active_live' : 'active_timer';
      }
    }
    
    // Check if ended
    if (status === 'ended' || status === 'reserve_not_met') {
      return 'unsold';
    }
    
    if (status === 'sold') {
      return 'sold';
    }
    
    if (status === 'cancelled') {
      return 'cancelled';
    }
  }
  
  // Priority 2: Check vehicle-level auction data (fallback)
  const endDate = vehicle?.auction_end_date || vehicle?.origin_metadata?.auction_times?.auction_end_date;
  if (endDate) {
    const end = new Date(endDate).getTime();
    if (Number.isFinite(end)) {
      const outcome = String(vehicle?.auction_outcome || '').toLowerCase();
      const saleStatus = String(vehicle?.sale_status || '').toLowerCase();
      
      // Check if ended
      if (end <= now) {
        if (outcome === 'sold' || saleStatus === 'sold') {
          return 'sold';
        }
        if (outcome === 'reserve_not_met' || outcome === 'no_sale' || outcome === 'ended') {
          return 'unsold';
        }
        return 'ended';
      }
      
      // Check if ending soon
      const secondsRemaining = (end - now) / 1000;
      if (secondsRemaining > 0 && secondsRemaining < 60) {
        return 'ending_soon';
      }
      
      // Active timer auction
      if (end > now) {
        return 'active_timer';
      }
    }
  }
  
  // Check if scheduled (future start)
  const startDate = vehicle?.origin_metadata?.auction_times?.auction_start_date;
  if (startDate) {
    const start = new Date(startDate).getTime();
    if (Number.isFinite(start) && start > now) {
      return 'scheduled';
    }
  }
  
  // Not in auction mode
  return null;
}

/**
 * Get complete auction state information
 */
export function getAuctionStateInfo(vehicle: any): AuctionStateInfo {
  const mode = getAuctionMode(vehicle);
  const externalListing = vehicle?.external_listings?.[0];
  
  return {
    mode,
    platform: externalListing?.platform || null,
    currentBid: externalListing?.current_bid || vehicle?.current_bid || null,
    endDate: externalListing?.end_date || vehicle?.auction_end_date || null,
    startDate: externalListing?.start_date || vehicle?.origin_metadata?.auction_times?.auction_start_date || null,
    listingUrl: externalListing?.listing_url || vehicle?.discovery_url || null,
    listingId: externalListing?.listing_id || null,
    bidCount: externalListing?.bid_count || vehicle?.bid_count || null,
    reservePrice: externalListing?.reserve_price || null,
    finalPrice: externalListing?.final_price || vehicle?.sale_price || null,
    soldAt: externalListing?.sold_at || vehicle?.sale_date || null,
    metadata: externalListing?.metadata || {},
  };
}

/**
 * Check if vehicle is currently in any auction mode
 */
export function isInAuctionMode(vehicle: any): boolean {
  return getAuctionMode(vehicle) !== null;
}

/**
 * Check if auction is active (timer or live)
 */
export function isActiveAuction(vehicle: any): boolean {
  const mode = getAuctionMode(vehicle);
  return mode === 'active_timer' || mode === 'active_live' || mode === 'ending_soon';
}

/**
 * Check if auction is scheduled (future)
 */
export function isScheduledAuction(vehicle: any): boolean {
  return getAuctionMode(vehicle) === 'scheduled';
}

/**
 * Check if auction has ended (sold or unsold)
 */
export function isEndedAuction(vehicle: any): boolean {
  const mode = getAuctionMode(vehicle);
  return mode === 'sold' || mode === 'unsold' || mode === 'ended';
}

/**
 * Get time remaining for active auctions (in seconds)
 */
export function getTimeRemaining(vehicle: any): number | null {
  const state = getAuctionStateInfo(vehicle);
  if (!state.endDate || !isActiveAuction(vehicle)) {
    return null;
  }
  
  const end = new Date(state.endDate).getTime();
  const now = Date.now();
  const remaining = (end - now) / 1000;
  
  return remaining > 0 ? Math.floor(remaining) : 0;
}

/**
 * Format time remaining as human-readable string
 */
export function formatTimeRemaining(vehicle: any): string | null {
  const seconds = getTimeRemaining(vehicle);
  if (seconds === null) return null;
  
  if (seconds <= 0) return 'Ended';
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

