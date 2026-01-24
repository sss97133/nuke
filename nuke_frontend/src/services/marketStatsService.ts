/**
 * Market Stats Service
 * Centralized service for all market statistics RPC calls
 * Replaces client-side aggregations with server-side database functions
 */

import { supabase } from '../lib/supabase';

// ============================================================================
// Types
// ============================================================================

export interface MarketPulseStats {
  total_vehicles: number;
  avg_price: number;
  for_sale_count: number;
  new_today: number;
}

export interface SquarebodyMarketStats {
  total_discovered: number;
  discovered_today: number;
  discovered_this_week: number;
  discovered_this_month: number;
  average_price: number;
  price_min: number;
  price_max: number;
  regions_active: number;
  with_images: number;
  processing_rate: number;
}

export interface RecentSquarebody {
  id: string;
  year: number;
  make: string;
  model: string;
  asking_price: number | null;
  location: string | null;
  image_url: string | null;
  discovered_at: string;
  listing_url: string;
}

export interface RegionActivity {
  region: string;
  count: number;
}

export interface PriceTrend {
  date: string;
  count: number;
  avg_price: number;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class MarketStatsService {
  /**
   * Get market pulse statistics (total vehicles, avg price, for sale count, new today)
   * Replaces 4 parallel queries in MarketPulse.tsx
   */
  static async getMarketPulseStats(): Promise<MarketPulseStats> {
    const { data, error } = await supabase.rpc('get_market_pulse_stats');

    if (error) {
      console.error('Error fetching market pulse stats:', error);
      // Return defaults on error
      return {
        total_vehicles: 0,
        avg_price: 0,
        for_sale_count: 0,
        new_today: 0
      };
    }

    // RPC returns an array with one row
    const stats = Array.isArray(data) && data.length > 0 ? data[0] : data;

    return {
      total_vehicles: Number(stats?.total_vehicles ?? 0),
      avg_price: Number(stats?.avg_price ?? 0),
      for_sale_count: Number(stats?.for_sale_count ?? 0),
      new_today: Number(stats?.new_today ?? 0)
    };
  }

  /**
   * Get all squarebody market dashboard statistics
   * Replaces client-side date filtering and price calculations
   */
  static async getSquarebodyMarketStats(): Promise<SquarebodyMarketStats> {
    const { data, error } = await supabase.rpc('get_squarebody_market_stats');

    if (error) {
      console.error('Error fetching squarebody market stats:', error);
      // Return defaults on error
      return {
        total_discovered: 0,
        discovered_today: 0,
        discovered_this_week: 0,
        discovered_this_month: 0,
        average_price: 0,
        price_min: 0,
        price_max: 0,
        regions_active: 0,
        with_images: 0,
        processing_rate: 0
      };
    }

    // RPC returns an array with one row
    const stats = Array.isArray(data) && data.length > 0 ? data[0] : data;

    return {
      total_discovered: Number(stats?.total_discovered ?? 0),
      discovered_today: Number(stats?.discovered_today ?? 0),
      discovered_this_week: Number(stats?.discovered_this_week ?? 0),
      discovered_this_month: Number(stats?.discovered_this_month ?? 0),
      average_price: Number(stats?.average_price ?? 0),
      price_min: Number(stats?.price_min ?? 0),
      price_max: Number(stats?.price_max ?? 0),
      regions_active: Number(stats?.regions_active ?? 0),
      with_images: Number(stats?.with_images ?? 0),
      processing_rate: Number(stats?.processing_rate ?? 0)
    };
  }

  /**
   * Get recent squarebody vehicles with images
   * Eliminates N+1 query problem (24+ queries for 12 vehicles)
   */
  static async getRecentSquarebodies(limit: number = 12): Promise<RecentSquarebody[]> {
    const { data, error } = await supabase.rpc('get_recent_squarebodies', {
      limit_count: limit
    });

    if (error) {
      console.error('Error fetching recent squarebodies:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      year: Number(item.year ?? 0),
      make: String(item.make ?? ''),
      model: String(item.model ?? ''),
      asking_price: item.asking_price ? Number(item.asking_price) : null,
      location: item.location || null,
      image_url: item.image_url || null,
      discovered_at: item.discovered_at,
      listing_url: item.listing_url || ''
    }));
  }

  /**
   * Get top regions by squarebody vehicle count
   * Eliminates client-side URL parsing
   */
  static async getSquarebodyRegionActivity(limit: number = 10): Promise<RegionActivity[]> {
    const { data, error } = await supabase.rpc('get_squarebody_region_activity', {
      limit_count: limit
    });

    if (error) {
      console.error('Error fetching region activity:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      region: String(item.region ?? 'unknown'),
      count: Number(item.count ?? 0)
    }));
  }

  /**
   * Get 7-day price trend data
   * Eliminates client-side date bucketing
   */
  static async getSquarebodyPriceTrends(): Promise<PriceTrend[]> {
    const { data, error } = await supabase.rpc('get_squarebody_price_trends');

    if (error) {
      console.error('Error fetching price trends:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      date: String(item.date ?? ''),
      count: Number(item.count ?? 0),
      avg_price: Number(item.avg_price ?? 0)
    }));
  }
}

// Export singleton instance for convenience
export const marketStatsService = new MarketStatsService();
