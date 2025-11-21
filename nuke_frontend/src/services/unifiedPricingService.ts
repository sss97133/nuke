/**
 * UNIFIED PRICING SERVICE
 * 
 * SINGLE SOURCE OF TRUTH for all vehicle pricing displays.
 * 
 * RULES:
 * - All components MUST use this service for price display
 * - NO direct database queries for pricing from components
 * - NO multiple pricing calculation logic
 * - Respects truth hierarchy: sale_price > asking_price > current_value > purchase_price
 * 
 * WHY THIS EXISTS:
 * - Prevents price flickering (multiple sources racing)
 * - Prevents conflicting displays ($11k vs $155k vs $63k)
 * - Single entry point for pricing logic
 * - Easy to audit and debug
 */

import { supabase } from '../lib/supabase';

export interface UnifiedPrice {
  displayValue: number;
  displayLabel: string;
  source: 'sale_price' | 'asking_price' | 'current_value' | 'purchase_price' | 'msrp';
  confidence: 'verified' | 'high' | 'medium' | 'low';
  lastUpdated: string;
  metadata?: {
    platform?: string;
    url?: string;
    verifiedBy?: string;
    bat_auction_url?: string;
  };
}

/**
 * Truth Hierarchy (highest to lowest):
 * 1. sale_price - Actual sale price (VERIFIED TRUTH)
 * 2. asking_price - Owner's asking price (INTENT)
 * 3. current_value - Estimated value (ESTIMATE)
 * 4. purchase_price - Historical purchase (CONTEXT)
 * 5. msrp - Manufacturer suggested (BASELINE)
 */
export class UnifiedPricingService {
  /**
   * Get display price for vehicle (respects truth hierarchy)
   * This is the ONLY function components should call for pricing
   */
  static async getDisplayPrice(vehicleId: string): Promise<UnifiedPrice> {
    // Fetch vehicle data ONCE
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select(`
        sale_price,
        asking_price,
        current_value,
        purchase_price,
        msrp,
        bat_auction_url,
        updated_at
      `)
      .eq('id', vehicleId)
      .single();

    if (error || !vehicle) {
      throw new Error('Vehicle not found');
    }

    // Apply truth hierarchy (highest wins)
    
    // 1. HIGHEST TRUTH: Actual sale price
    if (vehicle.sale_price && vehicle.sale_price > 0) {
      return {
        displayValue: vehicle.sale_price,
        displayLabel: 'Sold for',
        source: 'sale_price',
        confidence: 'verified',
        lastUpdated: vehicle.updated_at || new Date().toISOString(),
        metadata: {
          bat_auction_url: vehicle.bat_auction_url || undefined
        }
      };
    }

    // 2. SECOND TRUTH: Owner's asking price (intent to sell)
    if (vehicle.asking_price && vehicle.asking_price > 0) {
      return {
        displayValue: vehicle.asking_price,
        displayLabel: 'Asking',
        source: 'asking_price',
        confidence: 'high',
        lastUpdated: vehicle.updated_at || new Date().toISOString()
      };
    }

    // 3. THIRD TRUTH: Current estimated value
    if (vehicle.current_value && vehicle.current_value > 0) {
      return {
        displayValue: vehicle.current_value,
        displayLabel: 'Estimated at',
        source: 'current_value',
        confidence: 'medium',
        lastUpdated: vehicle.updated_at || new Date().toISOString()
      };
    }

    // 4. FOURTH TRUTH: Historical purchase price
    if (vehicle.purchase_price && vehicle.purchase_price > 0) {
      return {
        displayValue: vehicle.purchase_price,
        displayLabel: 'Purchased for',
        source: 'purchase_price',
        confidence: 'low',
        lastUpdated: vehicle.updated_at || new Date().toISOString()
      };
    }

    // 5. LOWEST TRUTH: MSRP (baseline reference)
    if (vehicle.msrp && vehicle.msrp > 0) {
      return {
        displayValue: vehicle.msrp,
        displayLabel: 'MSRP',
        source: 'msrp',
        confidence: 'low',
        lastUpdated: vehicle.updated_at || new Date().toISOString()
      };
    }

    // No price available
    throw new Error('No price data available');
  }

  /**
   * Format price for display (US currency, no decimals)
   */
  static formatPrice(price: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  }

  /**
   * Get full price display with label
   * Example: "Sold for $63,000"
   */
  static async getFormattedDisplay(vehicleId: string): Promise<string> {
    try {
      const price = await this.getDisplayPrice(vehicleId);
      return `${price.displayLabel} ${this.formatPrice(price.displayValue)}`;
    } catch (error) {
      return 'Price unavailable';
    }
  }

  /**
   * Get just the formatted price value (for components that show label separately)
   * Example: "$63,000"
   */
  static async getFormattedValue(vehicleId: string): Promise<string> {
    try {
      const price = await this.getDisplayPrice(vehicleId);
      return this.formatPrice(price.displayValue);
    } catch (error) {
      return '—';
    }
  }

  /**
   * Batch fetch prices for multiple vehicles (optimized for lists/grids)
   */
  static async getDisplayPrices(vehicleIds: string[]): Promise<Map<string, UnifiedPrice>> {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select(`
        id,
        sale_price,
        asking_price,
        current_value,
        purchase_price,
        msrp,
        bat_auction_url,
        updated_at
      `)
      .in('id', vehicleIds);

    if (error || !vehicles) {
      return new Map();
    }

    const priceMap = new Map<string, UnifiedPrice>();

    for (const vehicle of vehicles) {
      try {
        // Apply same truth hierarchy
        let price: UnifiedPrice;

        if (vehicle.sale_price && vehicle.sale_price > 0) {
          price = {
            displayValue: vehicle.sale_price,
            displayLabel: 'Sold for',
            source: 'sale_price',
            confidence: 'verified',
            lastUpdated: vehicle.updated_at || new Date().toISOString(),
            metadata: { bat_auction_url: vehicle.bat_auction_url || undefined }
          };
        } else if (vehicle.asking_price && vehicle.asking_price > 0) {
          price = {
            displayValue: vehicle.asking_price,
            displayLabel: 'Asking',
            source: 'asking_price',
            confidence: 'high',
            lastUpdated: vehicle.updated_at || new Date().toISOString()
          };
        } else if (vehicle.current_value && vehicle.current_value > 0) {
          price = {
            displayValue: vehicle.current_value,
            displayLabel: 'Estimated at',
            source: 'current_value',
            confidence: 'medium',
            lastUpdated: vehicle.updated_at || new Date().toISOString()
          };
        } else if (vehicle.purchase_price && vehicle.purchase_price > 0) {
          price = {
            displayValue: vehicle.purchase_price,
            displayLabel: 'Purchased for',
            source: 'purchase_price',
            confidence: 'low',
            lastUpdated: vehicle.updated_at || new Date().toISOString()
          };
        } else if (vehicle.msrp && vehicle.msrp > 0) {
          price = {
            displayValue: vehicle.msrp,
            displayLabel: 'MSRP',
            source: 'msrp',
            confidence: 'low',
            lastUpdated: vehicle.updated_at || new Date().toISOString()
          };
        } else {
          // Skip vehicles with no price data
          continue;
        }

        priceMap.set(vehicle.id, price);
      } catch (err) {
        console.error(`[UnifiedPricing] Error processing vehicle ${vehicle.id}:`, err);
      }
    }

    return priceMap;
  }

  /**
   * Get price confidence badge color
   */
  static getConfidenceColor(confidence: string): string {
    switch (confidence) {
      case 'verified': return 'var(--success)';
      case 'high': return 'var(--primary)';
      case 'medium': return 'var(--warning)';
      case 'low': return 'var(--text-muted)';
      default: return 'var(--text-muted)';
    }
  }
}

export default UnifiedPricingService;

