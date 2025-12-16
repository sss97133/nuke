/**
 * User Interaction Tracking Service
 * Logs all user interactions for personalization and metrics
 */

import { supabase } from '../lib/supabase';

export interface UserInteraction {
  id?: string;
  user_id: string;
  interaction_type: 'like' | 'dislike' | 'save' | 'skip' | 'share' | 'view' | 'tag_verify' | 'tag_reject';
  target_type: 'image' | 'vehicle' | 'tag' | 'event' | 'user' | 'shop';
  target_id: string;
  context?: {
    vehicle_id?: string;
    session_duration?: number;
    source_page?: string;
    device_type?: 'mobile' | 'desktop';
    gesture_type?: 'swipe' | 'tap' | 'double_tap' | 'long_press' | 'click' | 'hover';
    // Identity telemetry (for training contextual identity/differentiator selection)
    identity_kind?: string;
    identity_value?: string;
    identity_position?: number;
    identity_strategy?: string;
    identity_max_differentiators?: number;
  };
  created_at?: string;
}

export interface UserPreferences {
  liked_tags: string[];
  disliked_tags: string[];
  saved_images: string[];
  saved_vehicles: string[];
  preferred_vendors: string[];
  interaction_style: 'mobile' | 'desktop';
  last_updated: string;
}

export class UserInteractionService {
  /**
   * Log a user interaction
   */
  static async logInteraction(
    userId: string,
    interactionType: UserInteraction['interaction_type'],
    targetType: UserInteraction['target_type'],
    targetId: string,
    context?: UserInteraction['context']
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('user_interactions')
        .insert({
          user_id: userId,
          interaction_type: interactionType,
          target_type: targetType,
          target_id: targetId,
          context: context || {},
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error logging interaction:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error logging interaction:', error);
      return false;
    }
  }

  /**
   * Like an image
   */
  static async likeImage(userId: string, imageId: string, vehicleId?: string): Promise<boolean> {
    return this.logInteraction(userId, 'like', 'image', imageId, {
      vehicle_id: vehicleId,
      device_type: this.detectDeviceType(),
      gesture_type: 'tap'
    });
  }

  /**
   * Dislike an image
   */
  static async dislikeImage(userId: string, imageId: string, vehicleId?: string): Promise<boolean> {
    return this.logInteraction(userId, 'dislike', 'image', imageId, {
      vehicle_id: vehicleId,
      device_type: this.detectDeviceType(),
      gesture_type: 'swipe'
    });
  }

  /**
   * Save an image to favorites
   */
  static async saveImage(userId: string, imageId: string, vehicleId?: string): Promise<boolean> {
    // Log interaction
    await this.logInteraction(userId, 'save', 'image', imageId, {
      vehicle_id: vehicleId,
      device_type: this.detectDeviceType()
    });

    // Also save to user_saved_images table
    const { error } = await supabase
      .from('user_saved_images')
      .insert({
        user_id: userId,
        image_id: imageId,
        vehicle_id: vehicleId,
        saved_at: new Date().toISOString()
      })
      .onConflict('user_id,image_id')
      .ignore();

    return !error;
  }

  /**
   * Unsave an image
   */
  static async unsaveImage(userId: string, imageId: string): Promise<boolean> {
    const { error } = await supabase
      .from('user_saved_images')
      .delete()
      .eq('user_id', userId)
      .eq('image_id', imageId);

    return !error;
  }

  /**
   * Check if image is saved
   */
  static async isImageSaved(userId: string, imageId: string): Promise<boolean> {
    const { data } = await supabase
      .from('user_saved_images')
      .select('id')
      .eq('user_id', userId)
      .eq('image_id', imageId)
      .single();

    return !!data;
  }

  /**
   * Get user preferences based on interaction history
   */
  static async getUserPreferences(userId: string): Promise<UserPreferences> {
    try {
      // Get interaction summary
      const { data: interactions } = await supabase
        .from('user_interactions')
        .select('interaction_type, target_type, target_id, context')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1000);

      const prefs: UserPreferences = {
        liked_tags: [],
        disliked_tags: [],
        saved_images: [],
        saved_vehicles: [],
        preferred_vendors: [],
        interaction_style: this.detectDeviceType(),
        last_updated: new Date().toISOString()
      };

      if (interactions) {
        // Extract preferences from interactions
        prefs.liked_tags = interactions
          .filter(i => i.interaction_type === 'like' && i.target_type === 'tag')
          .map(i => i.target_id);

        prefs.disliked_tags = interactions
          .filter(i => i.interaction_type === 'dislike' && i.target_type === 'tag')
          .map(i => i.target_id);

        prefs.saved_images = interactions
          .filter(i => i.interaction_type === 'save' && i.target_type === 'image')
          .map(i => i.target_id);

        prefs.saved_vehicles = interactions
          .filter(i => i.interaction_type === 'save' && i.target_type === 'vehicle')
          .map(i => i.target_id);

        // Detect preferred vendors from interactions with vendor links
        const vendorClicks = interactions
          .filter(i => i.context?.vendor_name)
          .map(i => i.context?.vendor_name as string);
        
        const vendorCounts = vendorClicks.reduce((acc, vendor) => {
          acc[vendor] = (acc[vendor] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        prefs.preferred_vendors = Object.entries(vendorCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([vendor]) => vendor);
      }

      return prefs;
    } catch (error) {
      console.error('Error getting user preferences:', error);
      return {
        liked_tags: [],
        disliked_tags: [],
        saved_images: [],
        saved_vehicles: [],
        preferred_vendors: [],
        interaction_style: this.detectDeviceType(),
        last_updated: new Date().toISOString()
      };
    }
  }

  /**
   * Get interaction analytics for a user
   */
  static async getUserAnalytics(userId: string): Promise<{
    total_interactions: number;
    likes: number;
    dislikes: number;
    saves: number;
    tags_verified: number;
    tags_rejected: number;
    most_active_hour: number;
    favorite_vehicles: string[];
  }> {
    const { data: interactions } = await supabase
      .from('user_interactions')
      .select('interaction_type, target_type, target_id, created_at')
      .eq('user_id', userId);

    if (!interactions) {
      return {
        total_interactions: 0,
        likes: 0,
        dislikes: 0,
        saves: 0,
        tags_verified: 0,
        tags_rejected: 0,
        most_active_hour: 0,
        favorite_vehicles: []
      };
    }

    // Calculate analytics
    const analytics = {
      total_interactions: interactions.length,
      likes: interactions.filter(i => i.interaction_type === 'like').length,
      dislikes: interactions.filter(i => i.interaction_type === 'dislike').length,
      saves: interactions.filter(i => i.interaction_type === 'save').length,
      tags_verified: interactions.filter(i => i.interaction_type === 'tag_verify').length,
      tags_rejected: interactions.filter(i => i.interaction_type === 'tag_reject').length,
      most_active_hour: this.getMostActiveHour(interactions),
      favorite_vehicles: this.getFavoriteVehicles(interactions)
    };

    return analytics;
  }

  /**
   * Detect if user is on mobile or desktop
   */
  private static detectDeviceType(): 'mobile' | 'desktop' {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      ? 'mobile'
      : 'desktop';
  }

  /**
   * Get most active hour from interaction timestamps
   */
  private static getMostActiveHour(interactions: any[]): number {
    const hours = interactions.map(i => new Date(i.created_at).getHours());
    const hourCounts = hours.reduce((acc, hour) => {
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const mostActive = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)[0];

    return mostActive ? parseInt(mostActive[0]) : 0;
  }

  /**
   * Get favorite vehicles based on interaction frequency
   */
  private static getFavoriteVehicles(interactions: any[]): string[] {
    const vehicleInteractions = interactions.filter(i => 
      i.target_type === 'vehicle' || i.target_type === 'image'
    );

    const vehicleCounts = vehicleInteractions.reduce((acc, i) => {
      const vehicleId = i.target_type === 'vehicle' ? i.target_id : i.context?.vehicle_id;
      if (vehicleId) {
        acc[vehicleId] = (acc[vehicleId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(vehicleCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([vehicleId]) => vehicleId);
  }

  /**
   * Track vendor click
   */
  static async trackVendorClick(userId: string, vendorName: string, vehicleId?: string): Promise<boolean> {
    return this.logInteraction(userId, 'view', 'tag', vendorName, {
      vehicle_id: vehicleId,
      vendor_name: vendorName,
      device_type: this.detectDeviceType()
    });
  }
}

