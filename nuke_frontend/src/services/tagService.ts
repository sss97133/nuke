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
      .from('image_tags')
      .select('*')
      .eq('image_id', imageId)
      .order('inserted_at', { ascending: false });

    if (error) {
      console.error('Error loading tags:', error);
      return [];
    }

    return this.normalizeTagsFromDB(data || []);
  }

  /**
   * Get all tags for a vehicle
   */
  static async getTagsForVehicle(vehicleId: string): Promise<Tag[]> {
    const { data, error } = await supabase
      .from('image_tags')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('inserted_at', { ascending: false });

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
      .from('image_tags')
      .update({
        verified: true,
        verified_by: userId,
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
      .from('image_tags')
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
    const { data, error } = await supabase
      .from('image_tags')
      .insert({
        image_id: imageId,
        vehicle_id: vehicleId,
        tag_name: tagData.tag_name,
        tag_type: tagData.tag_type,
        x_position: tagData.x_position,
        y_position: tagData.y_position,
        width: tagData.width,
        height: tagData.height,
        source_type: 'manual',
        confidence: 100,
        verified: true,
        created_by: userId,
        metadata: {}
      })
      .select()
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
    return {
      id: dbTag.id,
      image_id: dbTag.image_id,
      vehicle_id: dbTag.vehicle_id,
      timeline_event_id: dbTag.timeline_event_id,
      tag_name: dbTag.tag_name || dbTag.text || 'Unknown',
      tag_type: dbTag.tag_type || 'custom',
      x_position: dbTag.x_position,
      y_position: dbTag.y_position,
      width: dbTag.width,
      height: dbTag.height,
      source_type: dbTag.source_type || 'manual',
      confidence: typeof dbTag.confidence === 'number' ? dbTag.confidence : 100,
      verified: dbTag.verified || false,
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

