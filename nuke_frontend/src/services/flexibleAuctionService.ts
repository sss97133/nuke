/**
 * Flexible Auction Service
 * Supports configurable auction durations with last-bid extension mechanics
 * Similar to Sotheby's/Phillips model: optimize timing per item
 */

import { supabase } from '../lib/supabase';

export type AuctionState = 
  | 'scheduled'
  | 'active'
  | 'ending_soon'
  | 'ended'
  | 'sold'
  | 'unsold'
  | 'cancelled';

export interface AuctionConfig {
  // Timing
  initial_duration_seconds: number;
  extend_on_bid: boolean;
  extension_time_seconds: number;
  minimum_seconds_remaining: number;
  maximum_extensions: number;
  maximum_total_duration_seconds: number;
  
  // Bid controls
  starting_bid: number;
  reserve_price?: number;
  increment_amount?: number;
  increment_percent?: number;
  
  // Scheduling
  scheduled_start?: Date;
  scheduled_end?: Date;
}

export interface Auction {
  id: string;
  vehicle_id: string;
  seller_id: string;
  
  // Configuration
  config: AuctionConfig;
  
  // State
  state: AuctionState;
  created_at: Date;
  start_time?: Date;
  end_time?: Date;
  updated_at: Date;
  
  // Bidding
  current_bid: number;
  current_bidder_id?: string;
  bid_count: number;
  last_bid_at?: Date;
  extension_count: number;
  total_duration_used: number;
  
  // Metadata
  title: string;
  description?: string;
  category?: string;
  images?: string[];
}

export interface Bid {
  id?: string;
  auction_id: string;
  bidder_id: string;
  amount: number;
  bid_timestamp: Date;
  extended_auction?: boolean;
}

export interface BidResult {
  success: boolean;
  message: string;
  bid?: Bid;
  auction?: Auction;
  extended?: boolean;
}

export class FlexibleAuctionService {
  /**
   * Create a new auction with flexible timing
   */
  static async createAuction(
    vehicleId: string,
    sellerId: string,
    config: AuctionConfig,
    metadata: { title: string; description?: string; category?: string; images?: string[] }
  ): Promise<Auction> {
    try {
      const now = new Date();
      const scheduledStart = config.scheduled_start || now;
      
      const { data, error } = await supabase
        .from('auctions')
        .insert({
          vehicle_id: vehicleId,
          seller_id: sellerId,
          config,
          state: config.scheduled_start ? 'scheduled' : 'active',
          title: metadata.title,
          description: metadata.description,
          category: metadata.category,
          images: metadata.images || [],
          start_time: scheduledStart,
          end_time: new Date(scheduledStart.getTime() + config.initial_duration_seconds * 1000),
          current_bid: config.starting_bid,
          bid_count: 0,
          extension_count: 0,
          total_duration_used: config.initial_duration_seconds,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (error) throw error;
      
      return this.formatAuction(data);
    } catch (error) {
      console.error('Failed to create auction:', error);
      throw error;
    }
  }

  /**
   * Submit a bid with automatic extension logic
   */
  static async submitBid(
    auctionId: string,
    bidderId: string,
    bidAmount: number
  ): Promise<BidResult> {
    try {
      // Fetch auction
      const auction = await this.getAuction(auctionId);
      if (!auction) {
        return {
          success: false,
          message: 'Auction not found'
        };
      }

      // Validate bid
      const validation = this.validateBid(auction, bidAmount);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.reason
        };
      }

      // Check if auction should be extended
      const shouldExtend = this.shouldExtendAuction(auction);
      let updatedAuction = auction;

      if (shouldExtend) {
        updatedAuction = await this.extendAuction(auctionId, auction.config);
      }

      // Submit bid
      const now = new Date();
      const { data: bidData, error: bidError } = await supabase
        .from('auction_bids')
        .insert({
          auction_id: auctionId,
          bidder_id: bidderId,
          amount: bidAmount,
          bid_timestamp: now,
          extended_auction: shouldExtend
        })
        .select()
        .single();

      if (bidError) throw bidError;

      // Update auction with new bid
      const { data: updatedData, error: updateError } = await supabase
        .from('auctions')
        .update({
          current_bid: bidAmount,
          current_bidder_id: bidderId,
          bid_count: auction.bid_count + 1,
          last_bid_at: now,
          updated_at: now,
          state: updatedAuction.state
        })
        .eq('id', auctionId)
        .select()
        .single();

      if (updateError) throw updateError;

      return {
        success: true,
        message: shouldExtend ? 'Bid placed - auction extended!' : 'Bid placed successfully',
        bid: bidData,
        auction: this.formatAuction(updatedData),
        extended: shouldExtend
      };
    } catch (error) {
      console.error('Failed to submit bid:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to submit bid'
      };
    }
  }

  /**
   * Determine if auction should be extended on this bid
   */
  private static shouldExtendAuction(auction: Auction): boolean {
    if (!auction.config.extend_on_bid) return false;
    if (auction.extension_count >= auction.config.maximum_extensions) return false;

    // Calculate time remaining
    const now = Date.now();
    const endTime = new Date(auction.end_time!).getTime();
    const timeRemaining = (endTime - now) / 1000;

    // Extend if time is below threshold
    return timeRemaining < auction.config.minimum_seconds_remaining;
  }

  /**
   * Extend auction end time
   */
  private static async extendAuction(auctionId: string, config: AuctionConfig): Promise<Auction> {
    try {
      const auction = await this.getAuction(auctionId);
      if (!auction) throw new Error('Auction not found');

      const currentEndTime = new Date(auction.end_time!).getTime();
      const now = Date.now();
      const extensionMs = config.extension_time_seconds * 1000;
      const newEndTime = new Date(Math.max(now + extensionMs, currentEndTime + extensionMs));

      // Check if max duration would be exceeded
      const startTime = new Date(auction.start_time!).getTime();
      const totalDurationMs = newEndTime.getTime() - startTime;
      if (totalDurationMs > config.maximum_total_duration_seconds * 1000) {
        console.warn('Extension would exceed maximum duration, capping');
        const cappedEndTime = new Date(startTime + config.maximum_total_duration_seconds * 1000);
        return this.updateAuctionEnd(auctionId, cappedEndTime, auction.extension_count + 1);
      }

      return this.updateAuctionEnd(auctionId, newEndTime, auction.extension_count + 1);
    } catch (error) {
      console.error('Failed to extend auction:', error);
      throw error;
    }
  }

  /**
   * Update auction end time and extension count
   */
  private static async updateAuctionEnd(
    auctionId: string,
    newEndTime: Date,
    extensionCount: number
  ): Promise<Auction> {
    const { data, error } = await supabase
      .from('auctions')
      .update({
        end_time: newEndTime,
        extension_count: extensionCount,
        state: 'active', // Reset from ending_soon
        updated_at: new Date()
      })
      .eq('id', auctionId)
      .select()
      .single();

    if (error) throw error;
    return this.formatAuction(data);
  }

  /**
   * Get auction by ID
   */
  static async getAuction(auctionId: string): Promise<Auction | null> {
    try {
      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .eq('id', auctionId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }

      return this.formatAuction(data);
    } catch (error) {
      console.error('Failed to get auction:', error);
      return null;
    }
  }

  /**
   * Get all bids for an auction
   */
  static async getAuctionBids(auctionId: string): Promise<Bid[]> {
    try {
      const { data, error } = await supabase
        .from('auction_bids')
        .select('*')
        .eq('auction_id', auctionId)
        .order('bid_timestamp', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get auction bids:', error);
      return [];
    }
  }

  /**
   * Get active auctions with optional filters
   */
  static async getActiveAuctions(
    filters?: {
      category?: string;
      minPrice?: number;
      maxPrice?: number;
      limit?: number;
    }
  ): Promise<Auction[]> {
    try {
      let query = supabase
        .from('auctions')
        .select('*')
        .in('state', ['scheduled', 'active', 'ending_soon'])
        .order('end_time', { ascending: true });

      if (filters?.category) {
        query = query.eq('category', filters.category);
      }

      if (filters?.minPrice) {
        query = query.gte('current_bid', filters.minPrice);
      }

      if (filters?.maxPrice) {
        query = query.lte('current_bid', filters.maxPrice);
      }

      const limit = filters?.limit || 50;
      query = query.limit(limit);

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map(a => this.formatAuction(a));
    } catch (error) {
      console.error('Failed to get active auctions:', error);
      return [];
    }
  }

  /**
   * End auction and assign winner
   */
  static async endAuction(auctionId: string): Promise<Auction | null> {
    try {
      const auction = await this.getAuction(auctionId);
      if (!auction) return null;

      // Determine if sold or unsold
      const isSold = auction.current_bidder_id && 
                    auction.current_bid >= (auction.config.reserve_price || 0);
      const newState = isSold ? 'sold' : 'unsold';

      const { data, error } = await supabase
        .from('auctions')
        .update({
          state: newState,
          updated_at: new Date()
        })
        .eq('id', auctionId)
        .select()
        .single();

      if (error) throw error;
      return this.formatAuction(data);
    } catch (error) {
      console.error('Failed to end auction:', error);
      return null;
    }
  }

  /**
   * Cancel auction
   */
  static async cancelAuction(auctionId: string, reason?: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('auctions')
        .update({
          state: 'cancelled',
          updated_at: new Date(),
          metadata: { cancellation_reason: reason }
        })
        .eq('id', auctionId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Failed to cancel auction:', error);
      return false;
    }
  }

  /**
   * Get recommended auction duration based on history
   */
  static async getRecommendedDuration(
    category: string,
    estimatedValue: number
  ): Promise<{
    recommended_seconds: number;
    expected_bids: number;
    confidence: number;
    reason: string;
  }> {
    try {
      // Query similar sold auctions
      const { data, error } = await supabase.rpc('get_auction_recommendations', {
        category_name: category,
        min_price: estimatedValue * 0.8,
        max_price: estimatedValue * 1.2
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          recommended_seconds: 600, // Default 10 minutes
          expected_bids: 3,
          confidence: 0.3,
          reason: 'No historical data, using default recommendation'
        };
      }

      const avgDuration = data.reduce((sum: number, a: any) => sum + a.total_duration_used, 0) / data.length;
      const avgBids = data.reduce((sum: number, a: any) => sum + a.bid_count, 0) / data.length;

      return {
        recommended_seconds: Math.round(avgDuration),
        expected_bids: Math.round(avgBids * 10) / 10,
        confidence: Math.min(0.95, data.length / 10),
        reason: `Based on ${data.length} similar auctions (${category}, $${Math.round(estimatedValue)})`
      };
    } catch (error) {
      console.error('Failed to get recommended duration:', error);
      return {
        recommended_seconds: 600,
        expected_bids: 3,
        confidence: 0,
        reason: 'Error fetching recommendations'
      };
    }
  }

  /**
   * Validate bid amount
   */
  private static validateBid(
    auction: Auction,
    bidAmount: number
  ): { valid: boolean; reason?: string } {
    // Check auction is active
    if (!['active', 'scheduled', 'ending_soon'].includes(auction.state)) {
      return { valid: false, reason: 'Auction is not active' };
    }

    // Check bid exceeds current
    if (bidAmount <= auction.current_bid) {
      return { valid: false, reason: `Bid must be higher than ${auction.current_bid}` };
    }

    // Check minimum increment
    if (auction.config.increment_amount) {
      const minBid = auction.current_bid + auction.config.increment_amount;
      if (bidAmount < minBid) {
        return { valid: false, reason: `Minimum bid increment is ${auction.config.increment_amount}` };
      }
    }

    if (auction.config.increment_percent) {
      const minBid = auction.current_bid * (1 + auction.config.increment_percent / 100);
      if (bidAmount < minBid) {
        return { valid: false, reason: `Bid must be at least ${Math.round(minBid)}` };
      }
    }

    return { valid: true };
  }

  /**
   * Format auction data from database
   */
  private static formatAuction(data: any): Auction {
    return {
      ...data,
      created_at: new Date(data.created_at),
      start_time: data.start_time ? new Date(data.start_time) : undefined,
      end_time: data.end_time ? new Date(data.end_time) : undefined,
      last_bid_at: data.last_bid_at ? new Date(data.last_bid_at) : undefined,
      updated_at: new Date(data.updated_at)
    };
  }

  /**
   * Calculate time remaining for an auction
   */
  static getTimeRemaining(auction: Auction): {
    seconds: number;
    minutes: number;
    hours: number;
    days: number;
    formatted: string;
  } {
    const now = Date.now();
    const endTime = new Date(auction.end_time!).getTime();
    const totalSeconds = Math.max(0, (endTime - now) / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    let formatted = '';
    if (days > 0) formatted = `${days}d ${hours}h`;
    else if (hours > 0) formatted = `${hours}h ${minutes}m`;
    else formatted = `${minutes}m ${seconds}s`;

    return { seconds: Math.floor(totalSeconds), minutes, hours, days, formatted };
  }
}
