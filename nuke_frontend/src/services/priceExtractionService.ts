/**
 * PRICE EXTRACTION SERVICE - AI Automation for Price Discovery
 * 
 * This service provides the groundwork for AI to automatically extract
 * prices from comments, marketplace listings, and external sources.
 * 
 * USAGE:
 * 1. Call scanCommentForPrice() on new/updated comments
 * 2. AI extracts price, platform, and URL
 * 3. Store in price_history and market_listings tables
 * 4. Update vehicle asking_price if appropriate
 */

import { supabase } from '../lib/supabase';
import { extractPriceFromComment, MARKETPLACE_PATTERNS } from './pricingService';

export interface ExtractedPrice {
  price: number;
  platform: string;
  url: string;
  confidence: 'high' | 'medium' | 'low';
  context?: string;
}

/**
 * Scan a comment for price information
 * This is the entry point for AI automation
 */
export async function scanCommentForPrice(
  commentId: string,
  commentText: string,
  vehicleId: string,
  userId: string
): Promise<ExtractedPrice | null> {
  try {
    // Use the extraction logic from pricingService
    const extracted = extractPriceFromComment(commentText);
    
    if (!extracted.price || !extracted.platform) {
      return null;
    }
    
    // Record the extracted price
    const recorded = await recordExtractedPrice(
      vehicleId,
      commentId,
      extracted.price,
      extracted.platform,
      extracted.url || '',
      extracted.confidence
    );
    
    if (recorded) {
      return {
        price: extracted.price,
        platform: extracted.platform,
        url: extracted.url || '',
        confidence: extracted.confidence,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error scanning comment for price:', error);
    return null;
  }
}

/**
 * Record an extracted price in the database
 */
export async function recordExtractedPrice(
  vehicleId: string,
  commentId: string,
  price: number,
  platform: string,
  url: string,
  confidence: 'high' | 'medium' | 'low'
): Promise<boolean> {
  try {
    // Call the database function
    const { data, error } = await supabase.rpc('record_price_from_comment', {
      p_vehicle_id: vehicleId,
      p_comment_id: commentId,
      p_price: price,
      p_platform: platform,
      p_url: url,
      p_confidence: confidence,
    });
    
    if (error) {
      console.error('Error recording price:', error);
      return false;
    }
    
    // Optionally update vehicle asking_price if this is high confidence
    if (confidence === 'high') {
      await maybeUpdateVehiclePrice(vehicleId, price, 'asking_price');
    }
    
    return true;
  } catch (error) {
    console.error('Error in recordExtractedPrice:', error);
    return false;
  }
}

/**
 * Update vehicle price field if the new price is better
 * FACT-BASED: Creates source attribution when updating
 */
async function maybeUpdateVehiclePrice(
  vehicleId: string,
  newPrice: number,
  field: 'asking_price' | 'current_value',
  metadata?: { url?: string; platform?: string; comment_id?: string }
): Promise<void> {
  try {
    // Get current vehicle data
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('asking_price, current_value')
      .eq('id', vehicleId)
      .single();
    
    if (!vehicle) return;
    
    const currentPrice = vehicle[field];
    
    // Only update if:
    // 1. No current price exists, OR
    // 2. New price is within reasonable range (not an outlier)
    const shouldUpdate = !currentPrice || 
      (newPrice > currentPrice * 0.5 && newPrice < currentPrice * 2);
    
    if (shouldUpdate) {
      // Use price source service to update with source attribution
      const { updatePriceWithSource } = await import('./priceSourceService');
      
      await updatePriceWithSource(
        vehicleId,
        field,
        newPrice,
        {
          source: metadata?.url ? 'market_listing' : 'comment_extraction',
          url: metadata?.url,
          platform: metadata?.platform,
          comment_id: metadata?.comment_id,
          updated_at: new Date().toISOString()
        }
      );
    }
  } catch (error) {
    console.error('Error updating vehicle price:', error);
  }
}

/**
 * Get price history for a vehicle
 */
export async function getPriceHistory(vehicleId: string) {
  try {
    const { data, error } = await supabase
      .from('price_history')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('valid_from', { ascending: false });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching price history:', error);
    return [];
  }
}

/**
 * Get market listings for a vehicle
 */
export async function getMarketListings(vehicleId: string) {
  try {
    const { data, error } = await supabase
      .from('market_listings')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching market listings:', error);
    return [];
  }
}

/**
 * AI AUTOMATION WORKFLOW
 * 
 * This describes how AI should use these services:
 * 
 * 1. COMMENT WEBHOOK:
 *    When a new comment is created:
 *    - Call scanCommentForPrice(commentId, text, vehicleId, userId)
 *    - If price extracted, it's automatically recorded
 * 
 * 2. PERIODIC SCAN:
 *    Every hour/day, scan recent comments for missed prices:
 *    - Query comments from last 24 hours
 *    - For each, call scanCommentForPrice()
 *    - Update any new findings
 * 
 * 3. MARKETPLACE MONITORING:
 *    For tracked vehicles with market listings:
 *    - Check if listing still active
 *    - Update price if changed
 *    - Mark as sold/expired if gone
 * 
 * 4. PRICE VALIDATION:
 *    Before recording:
 *    - Check if price is reasonable (not 10x or 0.1x average)
 *    - Compare to similar vehicles
 *    - Flag outliers for human review
 * 
 * 5. OWNER VERIFICATION:
 *    If price comes from verified owner comment:
 *    - Set verified_by_owner = true
 *    - Increase confidence to 'high'
 *    - Prioritize over other sources
 */

/**
 * Validate if a price is reasonable for a vehicle
 */
export function validatePrice(
  price: number,
  vehicleYear: number,
  vehicleMake: string
): { valid: boolean; reason?: string } {
  // Basic sanity checks
  if (price <= 0) {
    return { valid: false, reason: 'Price must be positive' };
  }
  
  if (price < 100) {
    return { valid: false, reason: 'Price too low (< $100)' };
  }
  
  if (price > 10000000) {
    return { valid: false, reason: 'Price too high (> $10M)' };
  }
  
  // Age-based validation
  const currentYear = new Date().getFullYear();
  const age = currentYear - vehicleYear;
  
  // Very old cars shouldn't be extremely expensive (except classics)
  if (age > 50 && price > 500000) {
    return { valid: true, reason: 'High price for classic car - may need review' };
  }
  
  // Very new cars shouldn't be too cheap
  if (age < 3 && price < 5000) {
    return { valid: false, reason: 'Price too low for recent model year' };
  }
  
  return { valid: true };
}

/**
 * Hook for AI to process a batch of comments
 */
export async function processBatchComments(commentIds: string[]): Promise<{
  processed: number;
  extracted: number;
  errors: number;
}> {
  let processed = 0;
  let extracted = 0;
  let errors = 0;
  
  for (const commentId of commentIds) {
    try {
      // Get comment data
      const { data: comment } = await supabase
        .from('vehicle_comments')
        .select('comment_text, vehicle_id, user_id')
        .eq('id', commentId)
        .single();
      
      if (!comment) continue;
      
      processed++;
      
      // Try to extract price
      const result = await scanCommentForPrice(
        commentId,
        comment.comment_text,
        comment.vehicle_id,
        comment.user_id
      );
      
      if (result) {
        extracted++;
      }
    } catch (error) {
      errors++;
      console.error(`Error processing comment ${commentId}:`, error);
    }
  }
  
  return { processed, extracted, errors };
}

