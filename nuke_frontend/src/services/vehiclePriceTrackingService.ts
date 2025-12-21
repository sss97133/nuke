/**
 * Vehicle Price Tracking Service
 * 
 * Tracks vehicle prices over time like stock prices - every price change
 * is recorded as a point in the price history graph. Prices are treated
 * as "transfers of ownership" that go up and down.
 * 
 * The backend automatically tracks price changes via database triggers,
 * but this service provides a convenient API for:
 * - Recording sold prices
 * - Querying price history over time
 * - Getting price trends and analytics
 */

import { supabase } from '../lib/supabase';

export interface PriceHistoryPoint {
  id: string;
  vehicle_id: string;
  price_type: 'msrp' | 'purchase' | 'current' | 'asking' | 'sale';
  value: number;
  source: string;
  as_of: string;
  created_at: string;
  confidence?: number;
  is_estimate?: boolean;
  is_approximate?: boolean;
  logged_by?: string;
  proof_type?: string;
  proof_url?: string;
  seller_name?: string;
  buyer_name?: string;
  notes?: string;
}

export interface PriceHistoryQuery {
  vehicleId: string;
  priceType?: 'msrp' | 'purchase' | 'current' | 'asking' | 'sale';
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface PriceTrend {
  vehicle_id: string;
  price_type: string;
  current_value: number;
  previous_value: number;
  change: number;
  change_percent: number;
  as_of: string;
}

/**
 * Record a sold price for a vehicle
 * This will automatically trigger the price history logging
 */
export async function recordSoldPrice(
  vehicleId: string,
  salePrice: number,
  saleDate: string,
  metadata?: {
    source?: string;
    seller_name?: string;
    buyer_name?: string;
    proof_url?: string;
    notes?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current user for attribution
    const { data: { user } } = await supabase.auth.getUser();
    
    // Update vehicle sale_price and sale_date
    // The database trigger will automatically log this to vehicle_price_history
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        sale_price: salePrice,
        sale_date: saleDate,
        sale_status: 'sold',
        updated_at: new Date().toISOString()
      })
      .eq('id', vehicleId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Manually add enriched price history entry with metadata
    // (The trigger already added one, but we want to add metadata)
    const { error: historyError } = await supabase
      .from('vehicle_price_history')
      .insert({
        vehicle_id: vehicleId,
        price_type: 'sale',
        value: salePrice,
        source: metadata?.source || 'manual_entry',
        as_of: saleDate,
        logged_by: user?.id,
        seller_name: metadata?.seller_name,
        buyer_name: metadata?.buyer_name,
        proof_url: metadata?.proof_url,
        notes: metadata?.notes,
        confidence: 100, // Sold prices are 100% accurate
        is_estimate: false
      });

    // Don't fail if history insert fails - the trigger already logged it
    if (historyError) {
      console.warn('Failed to add enriched price history:', historyError);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error recording sold price:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get price history for a vehicle over time
 * Returns data points that can be plotted like a stock price graph
 */
export async function getPriceHistory(
  query: PriceHistoryQuery
): Promise<PriceHistoryPoint[]> {
  try {
    let queryBuilder = supabase
      .from('vehicle_price_history')
      .select('*')
      .eq('vehicle_id', query.vehicleId)
      .order('as_of', { ascending: false });

    if (query.priceType) {
      queryBuilder = queryBuilder.eq('price_type', query.priceType);
    }

    if (query.startDate) {
      queryBuilder = queryBuilder.gte('as_of', query.startDate);
    }

    if (query.endDate) {
      queryBuilder = queryBuilder.lte('as_of', query.endDate);
    }

    if (query.limit) {
      queryBuilder = queryBuilder.limit(query.limit);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      throw error;
    }

    return (data || []) as PriceHistoryPoint[];
  } catch (error: any) {
    console.error('Error fetching price history:', error);
    throw error;
  }
}

/**
 * Get price trends for a vehicle
 * Shows how prices have changed over time
 */
export async function getPriceTrends(
  vehicleId: string
): Promise<PriceTrend[]> {
  try {
    // Get latest price for each type
    const { data: latestPrices, error: latestError } = await supabase
      .from('vehicle_price_history')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('as_of', { ascending: false });

    if (latestError) throw latestError;

    // Group by price_type and get current vs previous
    const trends: PriceTrend[] = [];
    const priceTypes = ['msrp', 'purchase', 'current', 'asking', 'sale'] as const;

    for (const priceType of priceTypes) {
      const prices = (latestPrices || []).filter(p => p.price_type === priceType);
      
      if (prices.length === 0) continue;

      const current = prices[0];
      const previous = prices[1] || null;

      if (previous) {
        const change = current.value - previous.value;
        const changePercent = previous.value > 0 
          ? (change / previous.value) * 100 
          : 0;

        trends.push({
          vehicle_id: vehicleId,
          price_type: priceType,
          current_value: current.value,
          previous_value: previous.value,
          change,
          change_percent: changePercent,
          as_of: current.as_of
        });
      } else {
        // First price point - no change
        trends.push({
          vehicle_id: vehicleId,
          price_type: priceType,
          current_value: current.value,
          previous_value: current.value,
          change: 0,
          change_percent: 0,
          as_of: current.as_of
        });
      }
    }

    return trends;
  } catch (error: any) {
    console.error('Error fetching price trends:', error);
    throw error;
  }
}

/**
 * Get all vehicles missing sold price data
 * Useful for backfilling sold prices
 */
export async function getVehiclesMissingSoldPrice(): Promise<Array<{
  id: string;
  year: number | null;
  make: string;
  model: string;
  sale_status: string | null;
  sale_price: number | null;
  sale_date: string | null;
}>> {
  try {
    // Find vehicles that are marked as sold but missing sale_price
    const { data: soldMissingPrice, error: error1 } = await supabase
      .from('vehicles')
      .select('id, year, make, model, sale_status, sale_price, sale_date')
      .eq('sale_status', 'sold')
      .is('sale_price', null);

    // Find vehicles with sale_date but no sale_price
    const { data: hasDateNoPrice, error: error2 } = await supabase
      .from('vehicles')
      .select('id, year, make, model, sale_status, sale_price, sale_date')
      .not('sale_date', 'is', null)
      .is('sale_price', null);

    if (error1 || error2) {
      throw error1 || error2;
    }

    // Combine and deduplicate
    const all = [
      ...(soldMissingPrice || []),
      ...(hasDateNoPrice || [])
    ];

    // Deduplicate by id
    const unique = Array.from(
      new Map(all.map(v => [v.id, v])).values()
    );

    return unique;
  } catch (error: any) {
    console.error('Error fetching vehicles missing sold price:', error);
    throw error;
  }
}

/**
 * Batch update sold prices for multiple vehicles
 */
export async function batchRecordSoldPrices(
  updates: Array<{
    vehicleId: string;
    salePrice: number;
    saleDate: string;
    metadata?: {
      source?: string;
      seller_name?: string;
      buyer_name?: string;
      proof_url?: string;
      notes?: string;
    };
  }>
): Promise<Array<{ vehicleId: string; success: boolean; error?: string }>> {
  const results = [];

  for (const update of updates) {
    const result = await recordSoldPrice(
      update.vehicleId,
      update.salePrice,
      update.saleDate,
      update.metadata
    );
    results.push({
      vehicleId: update.vehicleId,
      success: result.success,
      error: result.error
    });
  }

  return results;
}

