import { supabase } from '../lib/supabase';

export interface ImageTag {
  id: string;
  image_id: string;
  vehicle_id?: string;
  tag_text: string;
  tag_type: string;
  x_position: number;
  y_position: number;
  width?: number;
  height?: number;
  confidence?: number;
  source_type: 'manual' | 'ai' | 'corrected';
  verified?: boolean;
  validation_status?: 'pending' | 'approved' | 'rejected';
  user_id?: string;
  user_quality_score?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SpatialTag {
  id: string;
  text: string;
  x: number;
  y: number;
  type: string;
  width?: number;
  height?: number;
  confidence?: number;
  source_type?: 'manual' | 'ai' | 'corrected';
  verified?: boolean;
}

export interface CreateTagRequest {
  image_id: string;
  vehicle_id?: string;
  tag_text: string;
  tag_type: string;
  x_position: number;
  y_position: number;
  width?: number;
  height?: number;
  confidence?: number;
}

class ImageTaggingService {
  // Get all tags for an image
  static async getImageTags(imageId: string): Promise<ImageTag[]> {
    try {
      const { data, error } = await supabase
        .from('image_tags')
        .select('*')
        .eq('image_id', imageId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching image tags:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error in getImageTags:', error);
      throw error;
    }
  }

  // Create a new tag
  static async createTag(tagRequest: CreateTagRequest): Promise<ImageTag | null> {
    try {
      // Get current user to add quality scoring
      const { data: { user } } = await supabase.auth.getUser();

      const tagData = {
        image_id: tagRequest.image_id,
        vehicle_id: tagRequest.vehicle_id,
        text: tagRequest.tag_text, // Main text field
        tag_name: tagRequest.tag_text, // Also populate tag_name
        tag_type: tagRequest.tag_type,
        x_position: tagRequest.x_position,
        y_position: tagRequest.y_position,
        width: tagRequest.width || 5,
        height: tagRequest.height || 5,
        confidence: tagRequest.confidence || 100,
        source_type: 'manual',
        verified: true,
        validation_status: 'approved',
        created_by: user?.id,
        trust_score: Math.round((await this.calculateUserQuality(user?.id)) * 100),
      };

      const { data, error } = await supabase
        .from('image_tags')
        .insert([tagData])
        .select()
        .single();

      if (error) {
        console.error('Error creating tag:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in createTag:', error);
      throw error;
    }
  }

  // Update an existing tag
  static async updateTag(tagId: string, updates: Partial<ImageTag>): Promise<ImageTag | null> {
    try {
      const { data, error } = await supabase
        .from('image_tags')
        .update(updates)
        .eq('id', tagId)
        .select()
        .single();

      if (error) {
        console.error('Error updating tag:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in updateTag:', error);
      throw error;
    }
  }

  // Delete a tag
  static async deleteTag(tagId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('image_tags')
        .delete()
        .eq('id', tagId);

      if (error) {
        console.error('Error deleting tag:', error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error('Error in deleteTag:', error);
      return false;
    }
  }

  // Bulk tag multiple images
  static async bulkTagImages(imageIds: string[], tagText: string, tagType: string): Promise<ImageTag[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userQuality = await this.calculateUserQuality(user?.id);

      const tags = imageIds.map(imageId => ({
        image_id: imageId,
        text: tagText,
        tag_name: tagText,
        tag_type: tagType,
        x_position: 50, // Center position for bulk tags
        y_position: 50,
        width: 5,
        height: 5,
        confidence: 100,
        source_type: 'manual' as const,
        verified: true,
        validation_status: 'approved' as const,
        created_by: user?.id,
        trust_score: Math.round(userQuality * 100),
      }));

      const { data, error } = await supabase
        .from('image_tags')
        .insert(tags)
        .select();

      if (error) {
        console.error('Error bulk creating tags:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error in bulkTagImages:', error);
      throw error;
    }
  }

  // Convert database format to UI format
  static convertToUIFormat(dbTags: ImageTag[]): SpatialTag[] {
    return dbTags.map(tag => ({
      id: tag.id,
      text: tag.tag_text || (tag as any).text, // Handle both field names
      x: tag.x_position,
      y: tag.y_position,
      type: tag.tag_type,
      width: tag.width,
      height: tag.height,
      confidence: tag.confidence,
      source_type: tag.source_type,
      verified: tag.verified
    }));
  }

  // Validate tag request
  static validateTag(tagRequest: CreateTagRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!tagRequest.image_id?.trim()) {
      errors.push('Image ID is required');
    }

    if (!tagRequest.tag_text?.trim()) {
      errors.push('Tag text is required');
    } else if (tagRequest.tag_text.trim().length < 2) {
      errors.push('Tag text must be at least 2 characters');
    } else if (tagRequest.tag_text.trim().length > 100) {
      errors.push('Tag text must be less than 100 characters');
    }

    if (!tagRequest.tag_type?.trim()) {
      errors.push('Tag type is required');
    }

    if (typeof tagRequest.x_position !== 'number' || tagRequest.x_position < 0 || tagRequest.x_position > 100) {
      errors.push('X position must be between 0 and 100');
    }

    if (typeof tagRequest.y_position !== 'number' || tagRequest.y_position < 0 || tagRequest.y_position > 100) {
      errors.push('Y position must be between 0 and 100');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Calculate user quality score based on their role and activity
  private static async calculateUserQuality(userId?: string): Promise<number> {
    if (!userId) return 0.3; // Anonymous/guest user

    try {
      // Get user profile to check role and permissions
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_type, verification_level, is_verified')
        .eq('id', userId)
        .single();

      if (!profile) return 0.5; // Unknown user

      // Base score from user type
      let qualityScore = 0.5; // Default user

      switch (profile.user_type) {
        case 'owner':
          qualityScore = 1.0; // Owner gets maximum quality
          break;
        case 'previous_owner':
          qualityScore = 0.9;
          break;
        case 'technician':
          qualityScore = 0.95;
          break;
        case 'historian':
          qualityScore = 0.9;
          break;
        case 'curator':
          qualityScore = 0.85;
          break;
        case 'consigner':
          qualityScore = 0.8;
          break;
        case 'moderator':
          qualityScore = 0.9;
          break;
        case 'premium':
          qualityScore = 0.7;
          break;
        case 'verified':
          qualityScore = 0.6;
          break;
        default:
          qualityScore = 0.5; // Regular user
      }

      // Adjust based on verification level
      if (profile.is_verified) {
        qualityScore *= 1.1; // 10% boost for verified users
      }

      if (profile.verification_level === 'fully_verified') {
        qualityScore *= 1.05; // Additional 5% for full verification
      }

      return Math.min(1.0, Math.max(0.1, qualityScore));
    } catch (error) {
      console.error('Error calculating user quality:', error);
      return 0.5; // Default on error
    }
  }

  // Get tag statistics for analytics
  static async getTagStats(vehicleId?: string): Promise<{
    totalTags: number;
    manualTags: number;
    aiTags: number;
    verifiedTags: number;
    uniqueUsers: number;
    avgQualityScore: number;
  }> {
    try {
      let query = supabase.from('image_tags').select('source_type, verified, created_by, trust_score');

      if (vehicleId) {
        query = query.eq('vehicle_id', vehicleId);
      }

      const { data, error } = await query;

      if (error) throw error;

      const tags = data || [];
      const uniqueUsers = new Set(tags.map(t => t.created_by).filter(Boolean)).size;
      const qualityScores = tags.map(t => t.trust_score).filter(s => typeof s === 'number');
      const avgQualityScore = qualityScores.length > 0 ?
        qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length : 0;

      return {
        totalTags: tags.length,
        manualTags: tags.filter(t => t.source_type === 'manual').length,
        aiTags: tags.filter(t => t.source_type === 'ai').length,
        verifiedTags: tags.filter(t => t.verified).length,
        uniqueUsers,
        avgQualityScore
      };
    } catch (error) {
      console.error('Error getting tag stats:', error);
      return {
        totalTags: 0,
        manualTags: 0,
        aiTags: 0,
        verifiedTags: 0,
        uniqueUsers: 0,
        avgQualityScore: 0
      };
    }
  }
}

export default ImageTaggingService;