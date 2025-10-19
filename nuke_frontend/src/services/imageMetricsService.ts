/**
 * Image Metrics Service
 * Tracks views, engagement, and technical value of images
 */

import { supabase } from '../lib/supabase';

export class ImageMetricsService {
  /**
   * Log an image view
   */
  static async logImageView(
    imageId: string,
    userId?: string,
    viewDuration?: number
  ): Promise<void> {
    try {
      // Increment view count via function
      await supabase.rpc('increment_image_view_count', {
        image_uuid: imageId
      });

      // Log detailed view
      await supabase.from('image_views').insert({
        image_id: imageId,
        user_id: userId,
        view_duration_seconds: viewDuration,
        device_type: this.getDeviceType()
      });

      // Recalculate engagement score
      await this.calculateEngagement(imageId);
    } catch (error) {
      console.error('Failed to log image view:', error);
    }
  }

  /**
   * Like an image
   */
  static async likeImage(imageId: string, userId: string): Promise<void> {
    try {
      await supabase.from('image_interactions').insert({
        image_id: imageId,
        user_id: userId,
        interaction_type: 'like'
      });

      await this.calculateEngagement(imageId);
    } catch (error) {
      console.error('Failed to like image:', error);
    }
  }

  /**
   * Unlike an image
   */
  static async unlikeImage(imageId: string, userId: string): Promise<void> {
    try {
      await supabase
        .from('image_interactions')
        .delete()
        .eq('image_id', imageId)
        .eq('user_id', userId)
        .eq('interaction_type', 'like');

      await this.calculateEngagement(imageId);
    } catch (error) {
      console.error('Failed to unlike image:', error);
    }
  }

  /**
   * Comment on an image
   */
  static async commentOnImage(
    imageId: string,
    userId: string,
    commentText: string
  ): Promise<void> {
    try {
      await supabase.from('image_interactions').insert({
        image_id: imageId,
        user_id: userId,
        interaction_type: 'comment',
        comment_text: commentText
      });

      await this.calculateEngagement(imageId);
    } catch (error) {
      console.error('Failed to comment on image:', error);
    }
  }

  /**
   * Get image metrics
   */
  static async getImageMetrics(imageId: string): Promise<any> {
    try {
      const { data: image } = await supabase
        .from('vehicle_images')
        .select('view_count, engagement_score, technical_value, tag_count')
        .eq('id', imageId)
        .single();

      const { data: interactions } = await supabase
        .from('image_interactions')
        .select('interaction_type')
        .eq('image_id', imageId);

      const likes = interactions?.filter(i => i.interaction_type === 'like').length || 0;
      const comments = interactions?.filter(i => i.interaction_type === 'comment').length || 0;

      return {
        ...image,
        likes,
        comments
      };
    } catch (error) {
      console.error('Failed to get image metrics:', error);
      return null;
    }
  }

  /**
   * Get user's liked images
   */
  static async getUserLikedImages(userId: string): Promise<string[]> {
    try {
      const { data } = await supabase
        .from('image_interactions')
        .select('image_id')
        .eq('user_id', userId)
        .eq('interaction_type', 'like');

      return data?.map(d => d.image_id) || [];
    } catch (error) {
      console.error('Failed to get liked images:', error);
      return [];
    }
  }

  /**
   * Calculate and update engagement score
   */
  private static async calculateEngagement(imageId: string): Promise<void> {
    try {
      await supabase.rpc('calculate_engagement_score', {
        image_uuid: imageId
      });
    } catch (error) {
      console.error('Failed to calculate engagement:', error);
    }
  }

  /**
   * Detect device type
   */
  private static getDeviceType(): string {
    if (typeof window === 'undefined') return 'unknown';
    
    const ua = navigator.userAgent;
    if (/mobile/i.test(ua)) return 'mobile';
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    return 'desktop';
  }
}

