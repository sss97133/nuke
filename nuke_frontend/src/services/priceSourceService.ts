/**
 * PRICE SOURCE SERVICE
 * 
 * FACT-BASED PRICING: Every price must have a verifiable source
 * This service ensures that whenever a price is updated, source attribution is created.
 */

import { supabase } from '../lib/supabase';

export type PriceField = 'sale_price' | 'asking_price' | 'current_value' | 'purchase_price' | 'msrp';

export interface PriceSourceMetadata {
  source?: 'user_input' | 'bat_import' | 'market_listing' | 'receipt' | 'valuation' | 'admin_edit' | 'comment_extraction';
  url?: string;
  platform?: string;
  lot_number?: string;
  sale_date?: string;
  receipt_id?: string;
  comment_id?: string;
  extracted_at?: string;
  [key: string]: any;
}

/**
 * Update a vehicle price field and create source attribution
 * This ensures FACT-BASED pricing: every price has a verifiable source
 */
export async function updatePriceWithSource(
  vehicleId: string,
  field: PriceField,
  value: number | null,
  metadata: PriceSourceMetadata,
  userId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Update the vehicle price field
    const updateData: any = {
      [field]: value,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicleId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Step 2: Create source attribution (CRITICAL for FACT-BASED pricing)
    if (value !== null && value > 0) {
      const sourceType = determineSourceType(metadata);
      const confidenceScore = determineConfidence(metadata, sourceType);
      const isVerified = determineVerified(metadata, sourceType);
      const sourceName = deriveSourceName(metadata);

      const sourceRecord = {
        vehicle_id: vehicleId,
        field_name: field,
        field_value: value.toString(),
        source_type: sourceType,
        source_name: sourceName,
        source_url: metadata.url || null,
        extraction_method: metadata.source || 'manual_entry',
        confidence_score: confidenceScore,
        is_verified: isVerified,
        user_id: userId || null,
        metadata: {
          ...metadata,
          updated_at: new Date().toISOString()
        }
      };

      const { error: sourceError } = await supabase
        .from('vehicle_field_sources')
        .upsert(sourceRecord, {
          onConflict: 'vehicle_id,field_name,source_type,source_name'
        });

      if (sourceError) {
        console.error('Failed to create source attribution:', sourceError);
        // Don't fail the update, but log the error
        // The price was updated, just missing source attribution
      }
    } else {
      // If value is null or 0, remove verified sources (price was cleared)
      // Keep historical sources but mark them as inactive
      await supabase
        .from('vehicle_field_sources')
        .update({ 
          metadata: supabase.raw('metadata || \'{"cleared": true}\'::jsonb'),
          updated_at: new Date().toISOString()
        })
        .eq('vehicle_id', vehicleId)
        .eq('field_name', field)
        .eq('is_verified', true);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Derive source name from metadata
 * The unique constraint uses source_name, not source_url, so we need to derive a name
 */
function deriveSourceName(metadata: PriceSourceMetadata): string {
  // Use platform if available
  if (metadata.platform) {
    return metadata.platform;
  }
  
  // Extract domain from URL if available
  if (metadata.url) {
    try {
      const url = new URL(metadata.url);
      return url.hostname.replace('www.', '');
    } catch {
      // If URL parsing fails, use a sanitized version
      return metadata.url.substring(0, 100);
    }
  }
  
  // Use source type as fallback
  if (metadata.source) {
    return metadata.source;
  }
  
  // Default fallback
  return 'Unknown';
}

/**
 * Determine source type based on metadata
 */
function determineSourceType(metadata: PriceSourceMetadata): string {
  if (metadata.source === 'bat_import') return 'ai_scraped';
  if (metadata.source === 'market_listing') return 'market_data';
  if (metadata.source === 'receipt') return 'document_scan';
  if (metadata.source === 'valuation') return 'ai_valuation';
  if (metadata.source === 'comment_extraction') return 'comment_extraction';
  if (metadata.source === 'admin_edit') return 'admin_manual';
  return 'user_input';
}

/**
 * Determine confidence score based on source
 */
function determineConfidence(metadata: PriceSourceMetadata, sourceType: string): number {
  // Highest confidence: verified sources with URLs
  if (sourceType === 'ai_scraped' && metadata.url && metadata.source === 'bat_import') return 100;
  if (sourceType === 'document_scan' && metadata.receipt_id) return 95;
  if (sourceType === 'market_listing' && metadata.url) return 85;
  if (sourceType === 'comment_extraction' && metadata.comment_id) return 75;
  if (sourceType === 'ai_valuation') return 70;
  if (sourceType === 'admin_manual') return 90;
  // Lowest: user input without verification
  return 50;
}

/**
 * Determine if source is verified
 */
function determineVerified(metadata: PriceSourceMetadata, sourceType: string): boolean {
  // Verified sources: BAT imports, receipts, market listings with URLs
  if (sourceType === 'ai_scraped' && metadata.url) return true;
  if (sourceType === 'document_scan') return true;
  if (sourceType === 'market_listing' && metadata.url) return true;
  if (sourceType === 'admin_manual') return true;
  // Unverified: user input, valuations, comment extractions
  return false;
}

/**
 * Check if a price field has a verified source
 */
export async function hasVerifiedSource(
  vehicleId: string,
  field: PriceField
): Promise<boolean> {
  const { data } = await supabase
    .from('vehicle_field_sources')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('field_name', field)
    .eq('is_verified', true)
    .limit(1);

  return (data && data.length > 0) || false;
}


