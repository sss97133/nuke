import { supabase } from '../lib/supabase';
import { TimelineEventService } from './timelineEventService';

/**
 * Central Event Pipeline Service
 * 
 * This service creates a unified pipeline that automatically:
 * 1. Creates vehicle timeline events
 * 2. Logs user contributions 
 * 3. Updates profile stats
 * 4. Triggers achievement checks
 * 
 * All user actions flow through this pipeline to ensure consistent data tracking.
 */

export interface EventPipelineData {
  vehicleId: string;
  userId?: string;
  eventType: 'image_upload' | 'vehicle_creation' | 'vehicle_edit' | 'timeline_event' | 'verification' | 'annotation' | 'interaction_request' | 'interaction_session' | 'vehicle_review';
  eventData: any;
  metadata?: Record<string, any>;
}

export class EventPipeline {
  /**
   * Main pipeline entry point - processes all events through the system
   */
  static async processEvent(data: EventPipelineData): Promise<void> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      const userId = data.userId || user?.id;

      if (!userId) {
        console.warn('No user ID available for event pipeline');
        return;
      }

      // 1. Create vehicle timeline event
      await this.createTimelineEvent(data);

      // 2. Log user contribution
      await this.logUserContribution(data, userId);

      // 3. Update profile stats
      await this.updateProfileStats(userId, data.eventType);

      // 4. Create profile activity
      await this.createProfileActivity(data, userId);

      // 5. Check for achievements
      await this.checkAchievements(userId, data.eventType);

    } catch (error) {
      console.error('Error in event pipeline:', error);
    }
  }

  /**
   * Create timeline event based on event type
   */
  private static async createTimelineEvent(data: EventPipelineData): Promise<void> {
    switch (data.eventType) {
      case 'image_upload':
        await this.createImageUploadTimelineEvent(data);
        break;

      case 'vehicle_creation':
        await TimelineEventService.createVehicleCreationEvent(
          data.vehicleId,
          data.eventData,
          data.eventData.initialImages
        );
        break;

      case 'vehicle_edit':
        await TimelineEventService.createVehicleEditEvent(
          data.vehicleId,
          data.eventData.oldData,
          data.eventData.newData,
          data.userId,
          data.eventData.editContext
        );
        break;

      case 'verification':
        await this.createVerificationTimelineEvent(data);
        break;

      case 'annotation':
        await this.createAnnotationTimelineEvent(data);
        break;
    }
  }

  /**
   * Log contribution to user_contributions table
   */
  private static async logUserContribution(data: EventPipelineData, userId: string): Promise<void> {
    const contributionTypeMap = {
      'image_upload': 'image_upload',
      'vehicle_creation': 'vehicle_data',
      'vehicle_edit': 'vehicle_data',
      'timeline_event': 'timeline_event',
      'verification': 'verification',
      'annotation': 'annotation',
      'interaction_request': 'timeline_event',
      'interaction_session': 'timeline_event',
      'vehicle_review': 'annotation'
    };

    const contributionType = contributionTypeMap[data.eventType];
    if (!contributionType) return;

    // Call the database function to log contribution
    const { error } = await supabase.rpc('log_contribution', {
      user_uuid: userId,
      contribution_type_param: contributionType,
      related_vehicle_uuid: data.vehicleId,
      contribution_metadata: data.metadata || {}
    });

    if (error) {
      console.error('Error logging user contribution:', error);
    }
  }

  /**
   * Update profile stats
   */
  private static async updateProfileStats(userId: string, eventType: string): Promise<void> {
    const updateFields: Record<string, any> = {
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Get current stats to increment
    const { data: currentStats } = await supabase
      .from('profile_stats')
      .select('total_images, total_vehicles, total_contributions, total_timeline_events, total_verifications')
      .eq('user_id', userId)
      .single();

    const stats = currentStats || {
      total_images: 0,
      total_vehicles: 0,
      total_contributions: 0,
      total_timeline_events: 0,
      total_verifications: 0
    };

    // Increment specific counters based on event type
    switch (eventType) {
      case 'image_upload':
        updateFields.total_images = stats.total_images + 1;
        updateFields.total_contributions = stats.total_contributions + 1;
        break;
      case 'vehicle_creation':
        updateFields.total_vehicles = stats.total_vehicles + 1;
        updateFields.total_contributions = stats.total_contributions + 1;
        break;
      case 'vehicle_edit':
        updateFields.total_contributions = stats.total_contributions + 1;
        break;
      case 'timeline_event':
        updateFields.total_timeline_events = stats.total_timeline_events + 1;
        updateFields.total_contributions = stats.total_contributions + 1;
        break;
      case 'verification':
        updateFields.total_verifications = stats.total_verifications + 1;
        updateFields.total_contributions = stats.total_contributions + 1;
        break;
    }

    // Upsert profile stats
    const { error } = await supabase
      .from('profile_stats')
      .upsert({
        user_id: userId,
        ...updateFields
      }, {
        onConflict: 'user_id'
      });

    if (error) {
      console.error('Error updating profile stats:', error);
    }
  }

  /**
   * Create profile activity entry
   */
  private static async createProfileActivity(data: EventPipelineData, userId: string): Promise<void> {
    const activityTitles = {
      'image_upload': 'Uploaded vehicle photo',
      'vehicle_creation': 'Added new vehicle',
      'vehicle_edit': 'Updated vehicle information',
      'timeline_event': 'Added timeline event',
      'verification': 'Verified vehicle data',
      'annotation': 'Added data annotation',
      'interaction_request': 'Made interaction request',
      'interaction_session': 'Participated in session',
      'vehicle_review': 'Wrote vehicle review'
    };

    const activityDescriptions = {
      'image_upload': 'Uploaded a new photo to vehicle profile',
      'vehicle_creation': 'Created a new vehicle profile',
      'vehicle_edit': 'Modified vehicle information',
      'timeline_event': 'Added an event to vehicle timeline',
      'verification': 'Verified accuracy of vehicle data',
      'annotation': 'Added detailed annotation to vehicle data',
      'interaction_request': 'Requested interaction with vehicle',
      'interaction_session': 'Participated in live interaction session',
      'vehicle_review': 'Wrote detailed review of vehicle'
    };

    const activityTypeMap = {
      'image_upload': 'image_uploaded',
      'vehicle_creation': 'vehicle_added',
      'vehicle_edit': 'profile_updated',
      'timeline_event': 'timeline_event_added',
      'verification': 'verification_completed',
      'annotation': 'contribution_made',
      'interaction_request': 'contribution_made',
      'interaction_session': 'contribution_made',
      'vehicle_review': 'contribution_made'
    };

    const { error } = await supabase
      .from('profile_activity')
      .insert({
        user_id: userId,
        activity_type: activityTypeMap[data.eventType],
        activity_title: activityTitles[data.eventType],
        activity_description: activityDescriptions[data.eventType],
        related_vehicle_id: data.vehicleId,
        metadata: {
          event_type: data.eventType,
          ...data.metadata
        }
      });

    if (error) {
      console.error('Error creating profile activity:', error);
    }
  }

  /**
   * Check and award achievements
   */
  private static async checkAchievements(userId: string, eventType: string): Promise<void> {
    try {
      // Get current user stats
      const { data: stats } = await supabase
        .from('profile_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!stats) return;

      const achievementsToCheck = [];

      // Check for various achievements based on stats
      if (stats.total_vehicles === 1) {
        achievementsToCheck.push({
          type: 'first_vehicle',
          title: 'First Vehicle',
          description: 'Added your first vehicle to the platform',
          points: 10
        });
      }

      if (stats.total_images === 1) {
        achievementsToCheck.push({
          type: 'first_image',
          title: 'First Photo',
          description: 'Uploaded your first vehicle photo',
          points: 5
        });
      }

      if (stats.total_vehicles >= 5) {
        achievementsToCheck.push({
          type: 'vehicle_collector',
          title: 'Vehicle Collector',
          description: 'Added 5 or more vehicles',
          points: 50
        });
      }

      if (stats.total_images >= 10) {
        achievementsToCheck.push({
          type: 'image_enthusiast',
          title: 'Photo Enthusiast',
          description: 'Uploaded 10 or more photos',
          points: 25
        });
      }

      if (stats.total_contributions >= 25) {
        achievementsToCheck.push({
          type: 'contributor',
          title: 'Active Contributor',
          description: 'Made 25 or more contributions',
          points: 100
        });
      }

      // Award achievements that haven't been earned yet
      for (const achievement of achievementsToCheck) {
        await supabase.rpc('award_achievement', {
          user_uuid: userId,
          achievement_type_param: achievement.type,
          achievement_title_param: achievement.title,
          achievement_description_param: achievement.description,
          points_param: achievement.points
        });
      }

    } catch (error) {
      console.error('Error checking achievements:', error);
    }
  }

  /**
   * Create verification timeline event
   */
  private static async createVerificationTimelineEvent(data: EventPipelineData): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    const metadata = {
      who: {
        user_id: user?.id,
        user_email: user?.email,
        user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
        user_role: user?.user_metadata?.role || 'user'
      },
      what: {
        action: 'data_verification',
        verified_fields: data.eventData.verifiedFields || [],
        verification_type: data.eventData.verificationType || 'manual',
        confidence_score: data.eventData.confidenceScore || 85
      },
      when: {
        timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      where: {
        user_agent: navigator.userAgent,
        location: 'web_app'
      },
      why: {
        reason: 'Data accuracy verification',
        context: 'User verified vehicle information accuracy'
      }
    };

    const eventData = {
      vehicle_id: data.vehicleId,
      user_id: user?.id,
      event_type: 'verification_completed',
      source: 'user_verification',
      event_date: new Date().toISOString().split('T')[0],
      title: 'Data Verified',
      description: `Verified ${data.eventData.verifiedFields?.length || 'multiple'} data fields`,
      confidence_score: data.eventData.confidenceScore || 85,
      metadata
    };

    const { error } = await supabase
      .from('vehicle_timeline_events')
      .insert([eventData]);

    if (error) {
      console.error('Error creating verification timeline event:', error);
    }
  }

  /**
   * Create annotation timeline event
   */
  private static async createAnnotationTimelineEvent(data: EventPipelineData): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    const metadata = {
      who: {
        user_id: user?.id,
        user_email: user?.email,
        user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
        user_role: user?.user_metadata?.role || 'user'
      },
      what: {
        action: 'data_annotation',
        annotated_field: data.eventData.field,
        annotation_type: data.eventData.annotationType,
        source_reference: data.eventData.sourceReference,
        provenance: data.eventData.provenance
      },
      when: {
        timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      where: {
        user_agent: navigator.userAgent,
        location: 'web_app'
      },
      why: {
        reason: 'Data provenance tracking',
        context: 'User added source annotation to vehicle data'
      }
    };

    const eventData = {
      vehicle_id: data.vehicleId,
      user_id: user?.id,
      event_type: 'annotation_added',
      source: 'user_annotation',
      event_date: new Date().toISOString().split('T')[0],
      title: 'Data Annotated',
      description: `Added annotation for ${data.eventData.field}: ${data.eventData.annotation}`,
      confidence_score: 90,
      metadata
    };

    const { error } = await supabase
      .from('vehicle_timeline_events')
      .insert([eventData]);

    if (error) {
      console.error('Error creating annotation timeline event:', error);
    }
  }

  /**
   * Create timeline event for image uploads
   */
  private static async createImageUploadTimelineEvent(data: EventPipelineData): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    
    const count = data.eventData.count || 1;
    const today = new Date().toISOString().split('T')[0];
    
    const eventData = {
      vehicle_id: data.vehicleId,
      user_id: data.userId || user?.id,
      event_type: 'batch_image_upload',
      source: data.eventData.source || 'image_upload',
      event_date: today,
      title: count === 1 ? 'Photo Added' : `${count} Photos Added`,
      description: count === 1 ? 'Uploaded 1 image' : `Uploaded ${count} images`,
      metadata: {
        ...data.metadata,
        count,
        source: data.eventData.source || 'image_upload',
        confidence_score: 100 // Store in metadata instead
      }
    };

    const { error } = await supabase
      .from('vehicle_timeline_events')
      .insert([eventData]);

    if (error) {
      console.error('Error creating image upload timeline event:', error);
    }
  }

  /**
   * Batch process multiple events (useful for bulk operations)
   */
  static async processBatchEvents(events: EventPipelineData[]): Promise<void> {
    for (const event of events) {
      await this.processEvent(event);
      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Get user's recent activity for dashboard
   */
  static async getUserActivity(userId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await supabase
      .from('profile_activity')
      .select(`
        *,
        vehicles:related_vehicle_id (
          make, model, year, id
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching user activity:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get user's contribution summary
   */
  static async getUserContributionSummary(userId: string): Promise<any> {
    const { data, error } = await supabase
      .from('user_contributions')
      .select('contribution_type, contribution_count')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching contribution summary:', error);
      return {};
    }

    // Aggregate contributions by type
    const summary = data?.reduce((acc, contrib) => {
      acc[contrib.contribution_type] = (acc[contrib.contribution_type] || 0) + contrib.contribution_count;
      return acc;
    }, {} as Record<string, number>) || {};

    return summary;
  }
}
