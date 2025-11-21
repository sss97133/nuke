/**
 * Unified Tag Service - Single source of truth for all tag operations
 * Replaces fragmented tag systems across the codebase
 */

import { supabase } from '../lib/supabase';

export interface Tag {
  id: string;
  image_id?: string;
  vehicle_id?: string;
  timeline_event_id?: string;
  
  // Core tag data
  tag_name: string;
  tag_type: 'part' | 'tool' | 'supply' | 'damage' | 'work' | 'modification' | 'brand' | 'process' | 'issue' | 'custom';
  
  // Spatial data (optional)
  x_position?: number;
  y_position?: number;
  width?: number;
  height?: number;
  
  // Source and confidence
  source_type: 'manual' | 'ai' | 'imported';
  confidence: number;  // 0-100 for display
  verified: boolean;
  
  // Parts Marketplace fields
  is_shoppable?: boolean;
  oem_part_number?: string;
  aftermarket_part_numbers?: string[];
  part_description?: string;
  fits_vehicles?: string;
  suppliers?: Array<{
    supplier_id: string;
    supplier_name: string;
    url: string;
    price_cents: number;
    in_stock: boolean;
    shipping_days?: number;
  }>;
  lowest_price_cents?: number;
  highest_price_cents?: number;
  price_last_updated?: string;
  affiliate_links?: any;
  condition?: string;
  warranty_info?: string;
  install_difficulty?: string;
  estimated_install_time_minutes?: number;
  
  // Metadata (all the good stuff)
  metadata: {
    ai_supervised?: boolean;
    part_number?: string;
    brand?: string;
    category?: string;
    size_spec?: string;
    estimated_cost?: number;
    work_session?: string;
    user_notes?: string;
    confidence_score?: number;
    connected_receipt_id?: string;
    receipt_vendor?: string;
    receipt_amount?: number;
    match_score?: number;
    vendor_links?: Array<{
      vendor: string;
      url: string;
      price?: number;
    }>;
    usage_context?: string;
  };
  
  // Audit
  created_by?: string;
  inserted_at: string;
  updated_at?: string;
  
  // Additional flags
  sellable?: boolean;
}

export class TagService {
  /**
   * Get all tags for an image
   */
  static async getTagsForImage(imageId: string): Promise<Tag[]> {
    const { data, error } = await supabase
      .from('vehicle_image_tags')
      .select('*, vehicle_images(vehicle_id)')
      .eq('image_id', imageId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading tags:', error);
      return [];
    }

    return this.normalizeTagsFromDB(data || []);
  }

  /**
   * Get all tags for a vehicle (via image join)
   */
  static async getTagsForVehicle(vehicleId: string): Promise<Tag[]> {
    // First get all images for the vehicle, then get tags
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicleId);

    if (!images || images.length === 0) return [];

    const imageIds = images.map(img => img.id);

    const { data, error } = await supabase
      .from('vehicle_image_tags')
      .select('*, vehicle_images(vehicle_id)')
      .in('image_id', imageIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading tags:', error);
      return [];
    }

    return this.normalizeTagsFromDB(data || []);
  }

  /**
   * Verify an AI tag
   */
  static async verifyTag(tagId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('vehicle_image_tags')
      .update({
        updated_at: new Date().toISOString()
      })
      .eq('id', tagId);

    if (error) {
      console.error('Error verifying tag:', error);
      return false;
    }

    return true;
  }

  /**
   * Reject/delete an AI tag
   */
  static async rejectTag(tagId: string): Promise<boolean> {
    const { error } = await supabase
      .from('vehicle_image_tags')
      .delete()
      .eq('id', tagId);

    if (error) {
      console.error('Error rejecting tag:', error);
      return false;
    }

    return true;
  }

  /**
   * Create a manual tag
   */
  static async createManualTag(
    imageId: string,
    vehicleId: string,
    tagData: {
      tag_name: string;
      tag_type: string;
      x_position?: number;
      y_position?: number;
      width?: number;
      height?: number;
    },
    userId: string
  ): Promise<Tag | null> {
    // Convert percentage to integer (0-10000 for 0.00-100.00)
    const xPos = tagData.x_position ? Math.round(tagData.x_position * 100) : null;
    const yPos = tagData.y_position ? Math.round(tagData.y_position * 100) : null;

    const { data, error } = await supabase
      .from('vehicle_image_tags')
      .insert({
        image_id: imageId,
        tag_text: tagData.tag_name,
        tag_type: tagData.tag_type,
        x_position: xPos,
        y_position: yPos,
        created_by: userId
      })
      .select('*, vehicle_images(vehicle_id)')
      .single();

    if (error) {
      console.error('Error creating tag:', error);
      return null;
    }

    return this.normalizeTagFromDB(data);
  }

  /**
   * Normalize database tag to frontend Tag interface
   */
  private static normalizeTagFromDB(dbTag: any): Tag {
    // Get vehicle_id from joined vehicle_images if available
    const vehicleId = dbTag.vehicle_images?.vehicle_id || null;
    
    // Convert integer positions back to percentages (0-10000 -> 0-100)
    const xPos = dbTag.x_position != null ? dbTag.x_position / 100 : undefined;
    const yPos = dbTag.y_position != null ? dbTag.y_position / 100 : undefined;

    return {
      id: dbTag.id,
      image_id: dbTag.image_id,
      vehicle_id: vehicleId,
      timeline_event_id: dbTag.timeline_event_id,
      tag_name: dbTag.tag_text || dbTag.tag_name || 'Unknown',
      tag_type: dbTag.tag_type || 'custom',
      x_position: xPos,
      y_position: yPos,
      width: dbTag.width, // Not in schema, but keep for compatibility
      height: dbTag.height, // Not in schema, but keep for compatibility
      source_type: 'manual', // vehicle_image_tags doesn't have source_type
      confidence: 100, // Default for manual tags
      verified: true, // Manual tags are verified by default
      // Parts marketplace fields
      is_shoppable: dbTag.is_shoppable,
      oem_part_number: dbTag.oem_part_number,
      aftermarket_part_numbers: dbTag.aftermarket_part_numbers,
      part_description: dbTag.part_description,
      fits_vehicles: dbTag.fits_vehicles,
      suppliers: dbTag.suppliers,
      lowest_price_cents: dbTag.lowest_price_cents,
      highest_price_cents: dbTag.highest_price_cents,
      price_last_updated: dbTag.price_last_updated,
      affiliate_links: dbTag.affiliate_links,
      condition: dbTag.condition,
      warranty_info: dbTag.warranty_info,
      install_difficulty: dbTag.install_difficulty,
      estimated_install_time_minutes: dbTag.estimated_install_time_minutes,
      // Metadata and audit
      metadata: dbTag.metadata || {},
      created_by: dbTag.created_by,
      inserted_at: dbTag.inserted_at,
      updated_at: dbTag.updated_at,
      sellable: dbTag.sellable || false
    };
  }

  private static normalizeTagsFromDB(dbTags: any[]): Tag[] {
    return dbTags.map(tag => this.normalizeTagFromDB(tag));
  }

  /**
   * Trigger AI analysis for an image
   */
  static async triggerAIAnalysis(imageUrl: string, vehicleId: string, imageId?: string): Promise<{success: boolean; error?: string}> {
    try {
      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/auto-analyze-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          image_url: imageUrl,
          vehicle_id: vehicleId,
          trigger_source: 'manual'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get tag statistics for a vehicle
   */
  static async getTagStats(vehicleId: string): Promise<{
    total: number;
    ai_supervised: number;
    verified: number;
    with_receipts: number;
    with_part_numbers: number;
  }> {
    const tags = await this.getTagsForVehicle(vehicleId);
    
    return {
      total: tags.length,
      ai_supervised: tags.filter(t => t.metadata.ai_supervised === true).length,
      verified: tags.filter(t => t.verified).length,
      with_receipts: tags.filter(t => t.metadata.connected_receipt_id).length,
      with_part_numbers: tags.filter(t => t.metadata.part_number).length
    };
  }
}

