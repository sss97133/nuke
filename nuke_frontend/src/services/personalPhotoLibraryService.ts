/**
 * Personal Photo Library Service
 * 
 * Manages the user's personal photo inbox - photos uploaded without vehicle_id
 * Handles bulk uploads, AI processing, smart grouping, and organization
 */

import { supabase } from '../lib/supabase';

export interface PersonalPhoto {
  id: string;
  user_id: string;
  image_url: string;
  thumbnail_url?: string;
  variants?: any;
  file_name: string;
  file_size: number;
  mime_type: string;
  
  // Organization
  vehicle_id?: string;
  organization_status: 'unorganized' | 'organized' | 'ignored';
  organized_at?: string;
  album_count: number;
  
  // AI Analysis
  ai_processing_status: 'pending' | 'processing' | 'complete' | 'failed';
  ai_processing_started_at?: string;
  ai_processing_completed_at?: string;
  ai_suggestions: any;
  ai_detected_vehicle?: {
    year?: number;
    make?: string;
    model?: string;
    confidence?: number;
  };
  ai_detected_angle?: string;
  ai_detected_angle_confidence?: number;
  suggested_vehicle_id?: string;
  
  // Metadata
  exif_data?: any;
  taken_at?: string;
  latitude?: number;
  longitude?: number;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface VehicleSuggestion {
  id: string;
  user_id: string;
  
  // AI-detected vehicle info
  suggested_year?: number;
  suggested_make?: string;
  suggested_model?: string;
  suggested_trim?: string;
  suggested_vin?: string;
  confidence: number;
  
  // Grouping
  image_count: number;
  sample_image_ids: string[];
  sample_images?: PersonalPhoto[]; // Populated from join
  
  // Status
  status: 'pending' | 'accepted' | 'rejected' | 'modified';
  accepted_vehicle_id?: string;
  
  // Reasoning
  detection_method: string;
  reasoning?: string;
  metadata: any;
  
  // Timestamps
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
}

export interface LibraryStats {
  total_photos: number;
  unorganized_photos: number;
  organized_photos: number;
  pending_ai_processing: number;
  ai_suggestions_count: number;
  total_file_size: number;
}

export class PersonalPhotoLibraryService {
  /**
   * Get all unorganized photos (inbox)
   * Uses optimized RPC function for better performance
   */
  static async getUnorganizedPhotos(
    limit = 1000, 
    offset = 0,
    filterStatus?: string,
    filterAngle?: string
  ): Promise<{ photos: PersonalPhoto[]; totalCount: number }> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Not authenticated');
    }

    const userId = session.session.user.id;

    // Try optimized RPC function first
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_unorganized_photos_optimized',
      {
        p_user_id: userId,
        p_limit: limit,
        p_offset: offset,
        p_filter_status: filterStatus || null,
        p_filter_angle: filterAngle || null
      }
    );

    if (!rpcError && rpcData) {
      return {
        photos: (rpcData.photos || []) as PersonalPhoto[],
        totalCount: rpcData.total_count || 0
      };
    }

    // Fallback to separate queries if RPC doesn't exist
    console.warn('[PhotoLibrary] RPC function not available, using fallback queries');
    
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('user_id', userId)
      .is('vehicle_id', null)
      // Treat NULL organization_status as "unorganized" so legacy uploads still show in inbox
      // Also include images that don't have organization_status set (manually uploaded)
      .or('organization_status.eq.unorganized,organization_status.is.null,organization_status.eq.ignored')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching unorganized photos:', error);
      throw error;
    }

    // Get album counts separately
    const images = data || [];
    const imageIds = images.map((img: any) => img.id);
    
    let albumCounts: Record<string, number> = {};
    if (imageIds.length > 0) {
      const { data: counts } = await supabase
        .from('image_set_members')
        .select('image_id')
        .in('image_id', imageIds);
      
      if (counts) {
        counts.forEach((member: any) => {
          albumCounts[member.image_id] = (albumCounts[member.image_id] || 0) + 1;
        });
      }
    }

    // Get total count
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('vehicle_id', null)
      .or('organization_status.eq.unorganized,organization_status.is.null');

    // Transform and add album_count
    return {
      photos: images.map((img: any) => ({
        ...img,
        album_count: albumCounts[img.id] || 0
      })),
      totalCount: count || 0
    };
  }

  /**
   * Get organized photos
   */
  static async getOrganizedPhotos(limit = 1000, offset = 0): Promise<PersonalPhoto[]> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Not authenticated');
    }

    const userId = session.session.user.id;

    const { data, error } = await supabase
      .from('vehicle_images')
      .select('*, vehicles(year, make, model)')
      .eq('user_id', userId)
      .or('vehicle_id.not.is.null,organization_status.eq.organized')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching organized photos:', error);
      throw error;
    }

    // Get album counts separately
    const images = data || [];
    const imageIds = images.map((img: any) => img.id);
    
    let albumCounts: Record<string, number> = {};
    if (imageIds.length > 0) {
      const { data: counts } = await supabase
        .from('image_set_members')
        .select('image_id')
        .in('image_id', imageIds);
      
      if (counts) {
        counts.forEach((member: any) => {
          albumCounts[member.image_id] = (albumCounts[member.image_id] || 0) + 1;
        });
      }
    }

    // Transform data to match PersonalPhoto interface
    return images.map((img: any) => ({
      ...img,
      year: img.vehicles?.year,
      make: img.vehicles?.make,
      model: img.vehicles?.model,
      album_count: albumCounts[img.id] || 0
    }));
  }

  /**
   * Get library statistics
   * Uses optimized RPC function for better performance
   */
  static async getLibraryStats(): Promise<LibraryStats & {
    ai_status_breakdown?: { complete: number; pending: number; processing: number; failed: number };
    angle_breakdown?: { front: number; rear: number; side: number; interior: number; engine_bay: number; undercarriage: number; detail: number };
    vehicle_detection?: { found: number; not_found: number };
  }> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Not authenticated');
    }

    const userId = session.session.user.id;

    // Try optimized RPC function first
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_photo_library_stats',
      { p_user_id: userId }
    );

    if (!rpcError && rpcData) {
      return {
        total_photos: rpcData.total_photos || 0,
        unorganized_photos: rpcData.unorganized_photos || 0,
        organized_photos: rpcData.organized_photos || 0,
        pending_ai_processing: rpcData.pending_ai_processing || 0,
        ai_suggestions_count: rpcData.ai_suggestions_count || 0,
        total_file_size: rpcData.total_file_size || 0,
        ai_status_breakdown: rpcData.ai_status_breakdown,
        angle_breakdown: rpcData.angle_breakdown,
        vehicle_detection: rpcData.vehicle_detection
      };
    }

    // Fallback to separate queries if RPC doesn't exist
    console.warn('[PhotoLibrary] RPC stats function not available, using fallback queries');
    
    // Get counts
    const [unorganizedResult, organizedResult, aiPendingResult, suggestionsResult] = await Promise.all([
      supabase.from('vehicle_images')
        .select('id, file_size', { count: 'exact', head: false })
        .eq('user_id', userId)
        .is('vehicle_id', null)
        // Include rows where organization_status is NULL as unorganized
        .or('organization_status.eq.unorganized,organization_status.is.null'),
      
      supabase.from('vehicle_images')
        .select('id, file_size', { count: 'exact', head: false })
        .eq('user_id', userId)
        .eq('organization_status', 'organized'),
      
      supabase.from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('ai_processing_status', ['pending', 'processing']),
      
      supabase.from('vehicle_suggestions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending')
    ]);

    const unorganizedPhotos = unorganizedResult.data || [];
    const organizedPhotos = organizedResult.data || [];
    
    const totalFileSize = [...unorganizedPhotos, ...organizedPhotos]
      .reduce((sum, img: any) => sum + (img.file_size || 0), 0);

    return {
      total_photos: unorganizedPhotos.length + organizedPhotos.length,
      unorganized_photos: unorganizedPhotos.length,
      organized_photos: organizedPhotos.length,
      pending_ai_processing: aiPendingResult.count || 0,
      ai_suggestions_count: suggestionsResult.count || 0,
      total_file_size: totalFileSize
    };
  }

  /**
   * Get vehicle suggestions from AI
   */
  static async getVehicleSuggestions(): Promise<VehicleSuggestion[]> {
    const { data, error } = await supabase
      .from('vehicle_suggestions')
      .select('*')
      .eq('status', 'pending')
      .order('confidence', { ascending: false });

    if (error) {
      console.error('Error fetching vehicle suggestions:', error);
      throw error;
    }

    // Load sample images for each suggestion
    const suggestions = data || [];
    for (const suggestion of suggestions) {
      if (suggestion.sample_image_ids && suggestion.sample_image_ids.length > 0) {
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('*')
          .in('id', suggestion.sample_image_ids)
          .limit(5);
        
        suggestion.sample_images = images || [];
      }
    }

    return suggestions;
  }

  /**
   * Bulk link photos to existing vehicle
   */
  static async bulkLinkToVehicle(imageIds: string[], vehicleId: string): Promise<number> {
    const { data, error } = await supabase.rpc('bulk_link_photos_to_vehicle', {
      p_image_ids: imageIds,
      p_vehicle_id: vehicleId
    });

    if (error) {
      console.error('Error linking photos to vehicle:', error);
      throw error;
    }

    return data || 0;
  }

  /**
   * Accept vehicle suggestion and create new vehicle profile
   */
  static async acceptVehicleSuggestion(
    suggestionId: string,
    vehicleData: {
      year: number;
      make: string;
      model: string;
      trim?: string;
      vin?: string;
    }
  ): Promise<string> {
    const { data, error } = await supabase.rpc('accept_vehicle_suggestion', {
      p_suggestion_id: suggestionId,
      p_year: vehicleData.year,
      p_make: vehicleData.make,
      p_model: vehicleData.model,
      p_trim: vehicleData.trim,
      p_vin: vehicleData.vin
    });

    if (error) {
      console.error('Error accepting vehicle suggestion:', error);
      throw error;
    }

    return data; // Returns new vehicle_id
  }

  /**
   * Reject vehicle suggestion
   */
  static async rejectVehicleSuggestion(suggestionId: string): Promise<void> {
    const { error } = await supabase.rpc('reject_vehicle_suggestion', {
      p_suggestion_id: suggestionId
    });

    if (error) {
      console.error('Error rejecting vehicle suggestion:', error);
      throw error;
    }
  }

  /**
   * Mark photos as ignored (hide from inbox without organizing)
   */
  static async markAsIgnored(imageIds: string[]): Promise<number> {
    const { data, error } = await supabase
      .from('vehicle_images')
      .update({ 
        organization_status: 'ignored',
        organized_at: new Date().toISOString()
      })
      .in('id', imageIds)
      .select('id');

    if (error) {
      console.error('Error marking photos as ignored:', error);
      throw error;
    }

    return data?.length || 0;
  }

  /**
   * Mark photos as organized (already in albums/sets)
   */
  static async markAsOrganized(imageIds: string[]): Promise<number> {
    const { data, error } = await supabase
      .from('vehicle_images')
      .update({ 
        organization_status: 'organized',
        organized_at: new Date().toISOString()
      })
      .in('id', imageIds)
      .select('id');

    if (error) {
      console.error('Error marking photos as organized:', error);
      throw error;
    }

    return data?.length || 0;
  }

  /**
   * Get AI processing status for photos
   */
  static async getAIProcessingStatus(imageIds: string[]): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('id, ai_processing_status')
      .in('id', imageIds);

    if (error) {
      console.error('Error fetching AI processing status:', error);
      return {};
    }

    const statusMap: Record<string, string> = {};
    (data || []).forEach((row: any) => {
      statusMap[row.id] = row.ai_processing_status;
    });

    return statusMap;
  }

  /**
   * Get photos by AI detected vehicle
   */
  static async getPhotosByDetectedVehicle(
    make?: string,
    model?: string,
    year?: number
  ): Promise<PersonalPhoto[]> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Not authenticated');
    }

    const userId = session.session.user.id;

    let query = supabase
      .from('vehicle_images')
      .select('*')
      .eq('user_id', userId)
      .is('vehicle_id', null)
      // Treat NULL organization_status as "unorganized" so legacy uploads still show
      .or('organization_status.eq.unorganized,organization_status.is.null')
      .not('ai_detected_vehicle', 'is', null);

    if (make) {
      query = query.ilike('ai_detected_vehicle->make', `%${make}%`);
    }
    if (model) {
      query = query.ilike('ai_detected_vehicle->model', `%${model}%`);
    }
    if (year) {
      query = query.eq('ai_detected_vehicle->year', year);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching photos by detected vehicle:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Search unorganized photos
   */
  static async searchUnorganizedPhotos(query: string): Promise<PersonalPhoto[]> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Not authenticated');
    }

    const userId = session.session.user.id;
    const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1');
    const querySafe = escapeILike(query);

    const { data, error } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('user_id', userId)
      .is('vehicle_id', null)
      // Treat NULL organization_status as "unorganized" so legacy uploads still show
      .or('organization_status.eq.unorganized,organization_status.is.null')
      .or(`file_name.ilike.%${querySafe}%,ai_detected_angle.ilike.%${querySafe}%`)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error searching photos:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Delete photos from personal library
   */
  static async deletePhotos(imageIds: string[]): Promise<number> {
    const { data, error } = await supabase
      .from('vehicle_images')
      .delete()
      .in('id', imageIds)
      .select('id');

    if (error) {
      console.error('Error deleting photos:', error);
      throw error;
    }

    return data?.length || 0;
  }

  /**
   * Get photo count by AI detected angle
   */
  static async getPhotoCountsByAngle(): Promise<Record<string, number>> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Not authenticated');
    }

    const userId = session.session.user.id;

    const { data, error } = await supabase
      .from('vehicle_images')
      .select('ai_detected_angle')
      .eq('user_id', userId)
      .is('vehicle_id', null)
      // Treat NULL organization_status as "unorganized" so legacy uploads still show
      .or('organization_status.eq.unorganized,organization_status.is.null')
      .not('ai_detected_angle', 'is', null);

    if (error) {
      console.error('Error fetching angle counts:', error);
      return {};
    }

    const counts: Record<string, number> = {};
    (data || []).forEach((row: any) => {
      const angle = row.ai_detected_angle;
      counts[angle] = (counts[angle] || 0) + 1;
    });

    return counts;
  }
}

