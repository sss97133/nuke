/**
 * MarketCheck Integration Service
 * 
 * Provides validated vehicle data from MarketCheck API including:
 * - Real-time market listings and pricing
 * - Vehicle history by VIN
 * - Market trends and analytics
 * - Regional price variations
 */

import { supabase } from '../lib/supabase';

export interface MarketCheckHistoryData {
  vin: string;
  price_history: Array<{
    date: string;
    price: number;
    source: string;
    listing_type: string;
    mileage?: number;
    location?: string;
  }>;
  ownership_history: Array<{
    date: string;
    owner_type: string;
    location: string;
    duration_days: number;
  }>;
  market_exposure: {
    total_days_listed: number;
    listing_count: number;
    average_days_per_listing: number;
    first_listed_date: string;
    last_listed_date: string;
  };
  regional_data: Array<{
    region: string;
    average_price: number;
    listing_count: number;
    days_on_market: number;
  }>;
  confidence_score: number;
  last_updated: string;
}

export interface MarketCheckSummary {
  available: boolean;
  price_points: number;
  ownership_changes: number;
  total_market_days: number;
  confidence: number;
  average_price?: number;
  price_trend?: 'increasing' | 'decreasing' | 'stable';
  market_activity?: 'high' | 'medium' | 'low';
}

export class MarketCheckService {
  
  /**
   * Fetch vehicle history from MarketCheck API by VIN
   * This provides comprehensive validation data for vehicle valuations
   */
  static async fetchVehicleHistory(vin: string, vehicleId?: string): Promise<{
    success: boolean;
    data?: MarketCheckHistoryData;
    summary?: MarketCheckSummary;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase.functions.invoke('marketcheck-vehicle-history', {
        body: { vin, vehicle_id: vehicleId }
      });

      if (error) {
        console.error('MarketCheck history error:', error);
        return {
          success: false,
          error: error.message || 'Failed to fetch vehicle history'
        };
      }

      return {
        success: data.success,
        data: data.data,
        summary: data.summary,
        error: data.error
      };
    } catch (error) {
      console.error('MarketCheck service error:', error);
      return {
        success: false,
        error: 'Service unavailable'
      };
    }
  }

  /**
   * Get cached MarketCheck data for a vehicle
   */
  static async getCachedMarketData(vehicleId: string): Promise<{
    listings?: any;
    history?: any;
    trends?: any;
    lastUpdated?: string;
  }> {
    try {
      const { data: marketData } = await supabase
        .from('market_data')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .in('source', ['marketcheck', 'marketcheck_history', 'marketcheck_trends'])
        .order('created_at', { ascending: false });

      if (!marketData || marketData.length === 0) {
        return {};
      }

      const result: any = {};
      
      marketData.forEach(record => {
        switch (record.source) {
          case 'marketcheck':
            result.listings = record;
            break;
          case 'marketcheck_history':
            result.history = record;
            break;
          case 'marketcheck_trends':
            result.trends = record;
            break;
        }
      });

      // Get the most recent update time
      result.lastUpdated = marketData[0]?.created_at;

      return result;
    } catch (error) {
      console.error('Error fetching cached MarketCheck data:', error);
      return {};
    }
  }

  /**
   * Check if MarketCheck data needs refresh (older than 24 hours)
   */
  static needsRefresh(lastUpdated?: string): boolean {
    if (!lastUpdated) return true;
    
    const updateTime = new Date(lastUpdated);
    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - updateTime.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceUpdate > 24;
  }

  /**
   * Analyze MarketCheck data to provide valuation insights
   */
  static analyzeMarketData(marketData: {
    listings?: any;
    history?: any;
    trends?: any;
  }): {
    currentMarketValue?: number;
    priceRange?: { low: number; high: number };
    marketActivity?: 'high' | 'medium' | 'low';
    priceTrend?: 'increasing' | 'decreasing' | 'stable';
    daysOnMarket?: number;
    confidence: number;
    insights: string[];
  } {
    const insights: string[] = [];
    let confidence = 50;
    let currentMarketValue: number | undefined;
    let priceRange: { low: number; high: number } | undefined;

    // Analyze current listings
    if (marketData.listings?.raw_data) {
      const listingsData = marketData.listings.raw_data;
      
      if (listingsData.listings && listingsData.listings.length > 0) {
        const prices = listingsData.listings
          .map((l: any) => l.price)
          .filter((p: any) => p && p > 0)
          .sort((a: number, b: number) => a - b);

        if (prices.length > 0) {
          currentMarketValue = prices[Math.floor(prices.length / 2)]; // Median price
          priceRange = {
            low: prices[0],
            high: prices[prices.length - 1]
          };
          
          confidence += 20;
          insights.push(`Found ${prices.length} comparable listings`);
          
          if (prices.length > 10) {
            confidence += 10;
            insights.push('High market activity with many comparable vehicles');
          }
        }
      }
    }

    // Analyze historical data
    if (marketData.history?.raw_data?.price_history) {
      const priceHistory = marketData.history.raw_data.price_history;
      
      if (priceHistory.length > 0) {
        confidence += 15;
        insights.push(`Historical data shows ${priceHistory.length} previous price points`);
        
        // Analyze price trend
        if (priceHistory.length > 1) {
          const recent = priceHistory.slice(-3);
          const older = priceHistory.slice(0, -3);
          
          if (recent.length > 0 && older.length > 0) {
            const recentAvg = recent.reduce((sum: number, p: any) => sum + p.price, 0) / recent.length;
            const olderAvg = older.reduce((sum: number, p: any) => sum + p.price, 0) / older.length;
            
            const percentChange = ((recentAvg - olderAvg) / olderAvg) * 100;
            
            if (percentChange > 5) {
              insights.push('Price trend: Increasing');
            } else if (percentChange < -5) {
              insights.push('Price trend: Decreasing');
            } else {
              insights.push('Price trend: Stable');
            }
          }
        }
      }
    }

    // Analyze market exposure
    if (marketData.history?.raw_data?.market_exposure) {
      const exposure = marketData.history.raw_data.market_exposure;
      
      if (exposure.total_days_listed > 0) {
        insights.push(`Vehicle was listed for ${exposure.total_days_listed} total days`);
        
        if (exposure.average_days_per_listing < 30) {
          insights.push('Quick sales indicate strong demand');
          confidence += 5;
        } else if (exposure.average_days_per_listing > 90) {
          insights.push('Extended listing periods may indicate pricing challenges');
        }
      }
    }

    // Analyze trends data
    if (marketData.trends?.raw_data) {
      const trends = marketData.trends.raw_data;
      
      if (trends.demand_score) {
        if (trends.demand_score > 70) {
          insights.push('High market demand for this vehicle type');
          confidence += 5;
        } else if (trends.demand_score < 30) {
          insights.push('Lower market demand for this vehicle type');
        }
      }
    }

    return {
      currentMarketValue,
      priceRange,
      confidence: Math.min(confidence, 95),
      insights
    };
  }

  /**
   * Format MarketCheck data for display
   */
  static formatHistoryForDisplay(history: MarketCheckHistoryData): {
    priceChart: Array<{ date: string; price: number; source: string }>;
    ownershipTimeline: Array<{ date: string; owner: string; location: string }>;
    marketSummary: {
      totalListings: number;
      averageDaysListed: number;
      priceRange: string;
    };
  } {
    const priceChart = history.price_history
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(entry => ({
        date: entry.date,
        price: entry.price,
        source: entry.source
      }));

    const ownershipTimeline = history.ownership_history
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(entry => ({
        date: entry.date,
        owner: entry.owner_type,
        location: entry.location
      }));

    const prices = history.price_history.map(p => p.price).filter(p => p > 0);
    const priceRange = prices.length > 0 
      ? `$${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`
      : 'N/A';

    return {
      priceChart,
      ownershipTimeline,
      marketSummary: {
        totalListings: history.market_exposure.listing_count,
        averageDaysListed: history.market_exposure.average_days_per_listing,
        priceRange
      }
    };
  }
}