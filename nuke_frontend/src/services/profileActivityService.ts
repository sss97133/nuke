// Profile Activity Service - Manual activity creation for when triggers don't work
import { supabase } from '../lib/supabase';

export interface ProfileActivity {
  id: string;
  user_id: string;
  activity_type: string;
  activity_title: string;
  activity_description?: string;
  related_vehicle_id?: string;
  metadata?: any;
  created_at: string;
}

export interface ProfileStats {
  user_id: string;
  total_vehicles: number;
  total_images: number;
  total_contributions: number;
  total_timeline_events: number;
  total_verifications: number;
  profile_views: number;
  followers_count: number;
  following_count: number;
  last_activity?: string;
  total_points: number;
  reputation_score: number;
  created_at: string;
  updated_at: string;
}

export class ProfileActivityService {
  
  // Create activity when vehicle is added
  static async createVehicleAddedActivity(
    userId: string, 
    vehicleId: string, 
    vehicleData: { make?: string; model?: string; year?: number; vin?: string }
  ): Promise<boolean> {
    try {
      const activityTitle = ProfileActivityService.buildVehicleTitle(vehicleData);
      
      const { error } = await supabase
        .from('profile_activity')
        .insert({
          user_id: userId,
          activity_type: 'vehicle_added',
          activity_title: activityTitle,
          activity_description: 'Added a new vehicle to their collection',
          related_vehicle_id: vehicleId,
          metadata: {
            vehicle_id: vehicleId,
            make: vehicleData.make,
            model: vehicleData.model,
            year: vehicleData.year,
            vin: vehicleData.vin
          }
        });

      if (error) {
        console.error('Error creating vehicle activity:', error);
        return false;
      }

      // Also update profile stats
      await ProfileActivityService.updateProfileStats(userId);
      
      return true;
    } catch (error) {
      console.error('Error in createVehicleAddedActivity:', error);
      return false;
    }
  }

  // Create activity when image is uploaded
  static async createImageUploadedActivity(
    userId: string,
    vehicleId: string,
    imageCount: number = 1
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('profile_activity')
        .insert({
          user_id: userId,
          activity_type: 'image_uploaded',
          activity_title: `Uploaded ${imageCount} ${imageCount === 1 ? 'image' : 'images'}`,
          activity_description: `Added ${imageCount} new ${imageCount === 1 ? 'image' : 'images'} to vehicle`,
          related_vehicle_id: vehicleId,
          metadata: {
            vehicle_id: vehicleId,
            image_count: imageCount
          }
        });

      if (error) {
        console.error('Error creating image activity:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in createImageUploadedActivity:', error);
      return false;
    }
  }

  // Create activity when timeline event is added
  static async createTimelineEventActivity(
    userId: string,
    vehicleId: string,
    eventType: string,
    eventTitle: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('profile_activity')
        .insert({
          user_id: userId,
          activity_type: 'timeline_event_added',
          activity_title: `Added timeline event: ${eventTitle}`,
          activity_description: `Added a new ${eventType} event to vehicle timeline`,
          related_vehicle_id: vehicleId,
          metadata: {
            vehicle_id: vehicleId,
            event_type: eventType,
            event_title: eventTitle
          }
        });

      if (error) {
        console.error('Error creating timeline activity:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in createTimelineEventActivity:', error);
      return false;
    }
  }

  // Update profile stats
  static async updateProfileStats(userId: string): Promise<void> {
    try {
      // Count user's vehicles
      const { count: vehicleCount } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Count user's images
      const { count: imageCount } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Count user's timeline events
      const { count: timelineCount } = await supabase
        .from('vehicle_timeline_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Upsert profile stats
      const { error } = await supabase
        .from('profile_stats')
        .upsert({
          user_id: userId,
          total_vehicles: vehicleCount || 0,
          total_images: imageCount || 0,
          total_timeline_events: timelineCount || 0,
          last_activity: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error updating profile stats:', error);
      }
    } catch (error) {
      console.error('Error in updateProfileStats:', error);
    }
  }

  // Helper to build vehicle title
  private static buildVehicleTitle(vehicleData: { make?: string; model?: string; year?: number }): string {
    const parts = [];
    if (vehicleData.year) parts.push(vehicleData.year.toString());
    if (vehicleData.make) parts.push(vehicleData.make);
    if (vehicleData.model) parts.push(vehicleData.model);
    
    return parts.length > 0 ? `Added vehicle: ${parts.join(' ')}` : 'Added vehicle';
  }

  // Get user activities (wrapper for ProfileService method)
  static async getUserActivities(userId: string, limit: number = 20): Promise<ProfileActivity[]> {
    try {
      const { data, error } = await supabase
        .from('profile_activity')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching user activities:', error);
      return [];
    }
  }

  // Backfill activities for existing vehicles (one-time migration helper)
  static async backfillVehicleActivities(userId: string): Promise<number> {
    try {
      // Get all vehicles for user that don't have activities
      const { data: vehicles, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin, created_at')
        .eq('user_id', userId);

      if (vehiclesError) throw vehiclesError;
      if (!vehicles || vehicles.length === 0) return 0;

      // Get existing activities to avoid duplicates
      const { data: existingActivities, error: activitiesError } = await supabase
        .from('profile_activity')
        .select('related_vehicle_id')
        .eq('user_id', userId)
        .eq('activity_type', 'vehicle_added');

      if (activitiesError) throw activitiesError;

      const existingVehicleIds = new Set(
        (existingActivities || []).map(a => a.related_vehicle_id).filter(Boolean)
      );

      // Create activities for vehicles without them
      const activitiesToCreate = vehicles
        .filter(v => !existingVehicleIds.has(v.id))
        .map(vehicle => ({
          user_id: userId,
          activity_type: 'vehicle_added' as const,
          activity_title: ProfileActivityService.buildVehicleTitle(vehicle),
          activity_description: 'Added a new vehicle to their collection',
          related_vehicle_id: vehicle.id,
          metadata: {
            vehicle_id: vehicle.id,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            vin: vehicle.vin
          },
          created_at: vehicle.created_at // Use original vehicle creation time
        }));

      if (activitiesToCreate.length === 0) return 0;

      const { error: insertError } = await supabase
        .from('profile_activity')
        .insert(activitiesToCreate);

      if (insertError) throw insertError;

      // Update profile stats
      await ProfileActivityService.updateProfileStats(userId);

      return activitiesToCreate.length;
    } catch (error) {
      console.error('Error backfilling vehicle activities:', error);
      return 0;
    }
  }
}
