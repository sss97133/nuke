import { supabase, SUPABASE_URL, getSupabaseFunctionsUrl } from '../lib/supabase';

export interface AuctionBid {
  id: string;
  listing_id: string;
  bidder_id: string;
  displayed_bid_cents: number;
  is_winning: boolean;
  created_at: string;
}

export interface AuctionListing {
  id: string;
  vehicle_id: string;
  seller_id: string;
  sale_type: 'auction' | 'live_auction';
  current_high_bid_cents: number | null;
  current_high_bidder_id: string | null;
  bid_count: number;
  reserve_price_cents: number | null;
  auction_start_time: string | null;
  auction_end_time: string | null;
  auction_duration_minutes: number;
  sniping_protection_minutes: number;
  status: 'draft' | 'active' | 'sold' | 'cancelled' | 'expired';
  created_at: string;
}

export class AuctionService {
  /**
   * Place a bid on an auction
   * Uses proxy bidding - user enters max bid, system auto-increments
   */
  static async placeBid(
    listingId: string,
    proxyMaxBidCents: number,
    bidSource: 'web' | 'mobile' | 'api' = 'web'
  ): Promise<{
    success: boolean;
    bid_id?: string;
    displayed_bid_cents?: number;
    error?: string;
    auction_extended?: boolean;
    new_end_time?: string;
  }> {
    try {
      const session = await supabase.auth.getSession();
      
      const response = await fetch(
        `${getSupabaseFunctionsUrl()}/place-auction-bid`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.data.session?.access_token}`,
            'x-bid-source': bidSource,
          },
          body: JSON.stringify({
            listing_id: listingId,
            proxy_max_bid_cents: proxyMaxBidCents,
          }),
        }
      );

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error placing bid:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to place bid',
      };
    }
  }

  /**
   * Get auction listing details
   */
  static async getListing(listingId: string): Promise<AuctionListing | null> {
    const { data, error } = await supabase
      .from('vehicle_listings')
      .select('*')
      .eq('id', listingId)
      .single();

    if (error) {
      console.error('Error fetching listing:', error);
      return null;
    }

    return data as AuctionListing;
  }

  /**
   * Get all bids for an auction
   */
  static async getBids(listingId: string): Promise<AuctionBid[]> {
    const { data, error } = await supabase
      .from('auction_bids')
      .select('*')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching bids:', error);
      return [];
    }

    return data as AuctionBid[];
  }

  /**
   * Get user's bids on an auction
   */
  static async getUserBids(listingId: string, userId: string): Promise<AuctionBid[]> {
    const { data, error } = await supabase
      .from('auction_bids')
      .select('*')
      .eq('listing_id', listingId)
      .eq('bidder_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user bids:', error);
      return [];
    }

    return data as AuctionBid[];
  }

  /**
   * Create a new auction listing
   */
  static async createListing(listing: {
    vehicle_id: string;
    sale_type: 'auction' | 'live_auction';
    reserve_price_cents?: number;
    auction_start_time?: string;
    auction_duration_minutes: number;
    sniping_protection_minutes?: number;
    description?: string;
  }): Promise<{ success: boolean; listing_id?: string; error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('vehicle_listings')
      .insert({
        vehicle_id: listing.vehicle_id,
        seller_id: user.id,
        sale_type: listing.sale_type,
        reserve_price_cents: listing.reserve_price_cents,
        auction_start_time: listing.auction_start_time || new Date().toISOString(),
        auction_end_time: listing.auction_start_time
          ? new Date(
              new Date(listing.auction_start_time).getTime() +
                listing.auction_duration_minutes * 60 * 1000
            ).toISOString()
          : new Date(
              Date.now() + listing.auction_duration_minutes * 60 * 1000
            ).toISOString(),
        auction_duration_minutes: listing.auction_duration_minutes,
        sniping_protection_minutes: listing.sniping_protection_minutes || 2,
        status: 'draft',
        description: listing.description,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating listing:', error);
      return { success: false, error: error.message };
    }

    return { success: true, listing_id: data.id };
  }

  /**
   * Update auction listing (owner only)
   */
  static async updateListing(
    listingId: string,
    updates: {
      reserve_price_cents?: number;
      description?: string;
      status?: 'draft' | 'active' | 'cancelled';
    }
  ): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase
      .from('vehicle_listings')
      .update(updates)
      .eq('id', listingId)
      .select()
      .single();

    if (error) {
      console.error('Error updating listing:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  /**
   * Calculate minimum bid for an auction
   */
  static async getMinimumBid(listingId: string): Promise<number | null> {
    const listing = await this.getListing(listingId);
    if (!listing) return null;

    const currentBid = listing.current_high_bid_cents || 0;
    
    // Calculate increment based on current bid
    let increment = 50; // Default
    if (currentBid >= 50000) increment = 5000;
    else if (currentBid >= 10000) increment = 2500;
    else if (currentBid >= 5000) increment = 1000;
    else if (currentBid >= 1000) increment = 500;
    else if (currentBid >= 500) increment = 250;
    else if (currentBid >= 100) increment = 100;

    return currentBid + increment;
  }
}

