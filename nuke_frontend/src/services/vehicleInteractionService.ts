import { supabase } from '../lib/supabase';
import { EventPipeline } from './eventPipeline';
import type {
  VehicleInteractionRequest,
  VehicleInteractionSession,
  ViewerActivity,
  ViewerReputation,
  VehicleReview,
  InteractionNotification,
  CreateInteractionRequestData,
  UpdateInteractionRequestData,
  CreateSessionData,
  CreateReviewData,
  InteractionRequestWithUser,
  SessionWithParticipants,
  ReviewWithReviewer,
  VehicleInteractionStats,
  ViewerStats
} from '../types/vehicleInteractions';

export class VehicleInteractionService {
  
  // ==================== REQUEST MANAGEMENT ====================
  
  /**
   * Create a new interaction request
   */
  static async createRequest(data: CreateInteractionRequestData): Promise<VehicleInteractionRequest | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const requestData = {
        ...data,
        requester_id: user.id,
        status: 'pending' as const,
        viewed_by_owner: false
      };

      const { data: request, error } = await supabase
        .from('vehicle_interaction_requests')
        .insert([requestData])
        .select()
        .single();

      if (error) throw error;

      // Track activity
      await this.trackViewerActivity({
        user_id: user.id,
        vehicle_id: data.vehicle_id,
        activity_type: 'inquiry_sent',
        duration_seconds: 0,
        interaction_count: 1,
        images_viewed: 0,
        timeline_events_viewed: 0,
        comments_left: 0,
        metadata: { request_type: data.interaction_type }
      });

      // Create notification for vehicle owner
      await this.createNotification({
        vehicle_id: data.vehicle_id,
        request_id: request.id,
        notification_type: 'new_request',
        title: 'New Interaction Request',
        message: `Someone requested ${data.interaction_type.replace('_', ' ')} for your vehicle`,
        sender_id: user.id
      });

      // Integrate with event pipeline
      await EventPipeline.processEvent({
        vehicleId: data.vehicle_id,
        userId: user.id,
        eventType: 'interaction_request',
        eventData: {
          request_type: data.interaction_type,
          title: data.title,
          duration_minutes: data.duration_minutes
        },
        metadata: {
          interaction_request: true,
          request_type: data.interaction_type,
          title: data.title
        }
      });

      return request;
    } catch (error) {
      console.error('Error creating request:', error);
      return null;
    }
  }

  /**
   * Get requests for a vehicle (owner view) or user's requests
   */
  static async getRequests(vehicleId: string, includeRequester = true): Promise<InteractionRequestWithUser[]> {
    try {
      let query = supabase
        .from('vehicle_interaction_requests')
        .select(`
          *,
          ${includeRequester ? `
          requester:requester_id (
            id,
            username,
            full_name,
            avatar_url
          )` : ''}
        `)
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      return (data as unknown as InteractionRequestWithUser[]) || [];
    } catch (error) {
      console.error('Error fetching requests:', error);
      return [];
    }
  }

  /**
   * Update request status (owner action)
   */
  static async updateRequest(requestId: string, updates: UpdateInteractionRequestData): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: request, error } = await supabase
        .from('vehicle_interaction_requests')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
          responded_at: updates.status ? new Date().toISOString() : undefined
        })
        .eq('id', requestId)
        .select(`
          *,
          vehicle:vehicle_id (id, make, model, year, user_id),
          requester:requester_id (id, username, full_name)
        `)
        .single();

      if (error) throw error;

      // Create notification for requester
      if (updates.status) {
        await this.createNotification({
          vehicle_id: request.vehicle_id,
          request_id: requestId,
          notification_type: updates.status === 'approved' ? 'request_approved' : 'request_declined',
          title: `Request ${updates.status}`,
          message: `Your ${request.interaction_type.replace('_', ' ')} request has been ${updates.status}`,
          recipient_id: request.requester_id,
          sender_id: user.id
        });
      }

      return true;
    } catch (error) {
      console.error('Error updating request:', error);
      return false;
    }
  }

  // ==================== SESSION MANAGEMENT ====================

  /**
   * Create a new interaction session
   */
  static async createSession(data: CreateSessionData): Promise<VehicleInteractionSession | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const sessionData = {
        ...data,
        host_id: user.id,
        status: 'scheduled' as const,
        viewer_count: 0,
        max_concurrent_viewers: 0
      };

      const { data: session, error } = await supabase
        .from('vehicle_interaction_sessions')
        .insert([sessionData])
        .select()
        .single();

      if (error) throw error;

      // Create notification for participant
      await this.createNotification({
        vehicle_id: data.vehicle_id,
        session_id: session.id,
        notification_type: 'session_scheduled',
        title: 'Session Scheduled',
        message: `A ${data.session_type.replace('_', ' ')} session has been scheduled`,
        recipient_id: data.participant_id,
        sender_id: user.id
      });

      return session;
    } catch (error) {
      console.error('Error creating session:', error);
      return null;
    }
  }

  /**
   * Update session status and metrics
   */
  static async updateSession(sessionId: string, updates: Partial<VehicleInteractionSession>): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicle_interaction_sessions')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      return !error;
    } catch (error) {
      console.error('Error updating session:', error);
      return false;
    }
  }

  /**
   * Get sessions for a vehicle or user
   */
  static async getSessions(vehicleId?: string, userId?: string): Promise<SessionWithParticipants[]> {
    try {
      let query = supabase
        .from('vehicle_interaction_sessions')
        .select(`
          *,
          host:host_id (id, username, full_name, avatar_url),
          participant:participant_id (id, username, full_name, avatar_url),
          vehicle:vehicle_id (id, make, model, year)
        `);

      if (vehicleId) {
        query = query.eq('vehicle_id', vehicleId);
      }

      if (userId) {
        query = query.or(`host_id.eq.${userId},participant_id.eq.${userId}`);
      }

      const { data, error } = await query.order('start_time', { ascending: false });
      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching sessions:', error);
      return [];
    }
  }

  // ==================== VIEWER ACTIVITY TRACKING ====================

  /**
   * Track viewer activity
   */
  static async trackViewerActivity(activity: Omit<ViewerActivity, 'id' | 'created_at'>): Promise<void> {
    try {
      const { error } = await supabase
        .from('viewer_activity')
        .insert([{
          ...activity,
          created_at: new Date().toISOString()
        }]);

      if (error) throw error;

      // The database trigger will automatically update viewer reputation
    } catch (error) {
      console.error('Error tracking viewer activity:', error);
    }
  }

  /**
   * Track vehicle profile view
   */
  static async trackVehicleView(vehicleId: string, duration: number = 0, context: Record<string, any> = {}): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await this.trackViewerActivity({
      user_id: user.id,
      vehicle_id: vehicleId,
      activity_type: 'profile_view',
      duration_seconds: duration,
      interaction_count: 1,
      images_viewed: 0,
      timeline_events_viewed: 0,
      comments_left: 0,
      engagement_quality: duration > 60 ? 'high' : duration > 20 ? 'medium' : 'low',
      metadata: context
    });
  }

  /**
   * Track streaming session participation
   */
  static async trackStreamingParticipation(
    sessionId: string, 
    vehicleId: string, 
    duration: number,
    engagement: Record<string, any> = {}
  ): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await this.trackViewerActivity({
      user_id: user.id,
      vehicle_id: vehicleId,
      activity_type: 'streaming_session',
      duration_seconds: duration,
      interaction_count: engagement.interactions || 0,
      images_viewed: 0,
      timeline_events_viewed: 0,
      comments_left: 0,
      engagement_quality: duration > 300 ? 'high' : duration > 120 ? 'medium' : 'low',
      session_id: sessionId,
      metadata: engagement
    });
  }

  // ==================== REPUTATION SYSTEM ====================

  /**
   * Get viewer reputation
   */
  static async getViewerReputation(userId: string): Promise<ViewerReputation | null> {
    try {
      const { data, error } = await supabase
        .from('viewer_reputation')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      return data;
    } catch (error) {
      console.error('Error fetching viewer reputation:', error);
      return null;
    }
  }

  /**
   * Update viewer reputation manually (for special achievements)
   */
  static async updateViewerReputation(userId: string, updates: Partial<ViewerReputation>): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('viewer_reputation')
        .upsert({
          user_id: userId,
          ...updates,
          updated_at: new Date().toISOString()
        });

      return !error;
    } catch (error) {
      console.error('Error updating viewer reputation:', error);
      return false;
    }
  }

  /**
   * Get viewer statistics
   */
  static async getViewerStats(userId: string): Promise<ViewerStats | null> {
    try {
      const reputation = await this.getViewerReputation(userId);
      if (!reputation) return null;

      // Get recent activity
      const { data: recentActivity } = await supabase
        .from('viewer_activity')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Calculate average rating given (from reviews)
      const { data: reviews } = await supabase
        .from('vehicle_reviews')
        .select('overall_rating')
        .eq('reviewer_id', userId);

      const averageRatingGiven = reviews?.length 
        ? reviews.reduce((sum, r) => sum + r.overall_rating, 0) / reviews.length 
        : 0;

      return {
        vehicles_viewed: reputation.total_vehicles_viewed,
        total_viewing_time_minutes: reputation.total_viewing_time_minutes,
        sessions_attended: reputation.total_sessions_attended,
        reviews_written: reputation.reviews_written,
        average_rating_given: averageRatingGiven,
        favorite_makes: reputation.favorite_makes,
        recent_activity: recentActivity || []
      };
    } catch (error) {
      console.error('Error fetching viewer stats:', error);
      return null;
    }
  }

  // ==================== REVIEW SYSTEM ====================

  /**
   * Create a vehicle review
   */
  static async createReview(data: CreateReviewData): Promise<VehicleReview | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const reviewData = {
        ...data,
        reviewer_id: user.id,
        status: 'published' as const,
        helpful_votes: 0,
        total_votes: 0,
        verified_interaction: data.session_id ? true : false
      };

      const { data: review, error } = await supabase
        .from('vehicle_reviews')
        .insert([reviewData])
        .select()
        .single();

      if (error) throw error;

      // Track activity
      await this.trackViewerActivity({
        user_id: user.id,
        vehicle_id: data.vehicle_id,
        activity_type: 'rating_given',
        duration_seconds: 0,
        interaction_count: 1,
        images_viewed: 0,
        timeline_events_viewed: 0,
        comments_left: 1,
        metadata: { 
          review_id: review.id, 
          rating: data.overall_rating,
          review_type: data.review_type 
        }
      });

      // Create notification for vehicle owner
      await this.createNotification({
        vehicle_id: data.vehicle_id,
        notification_type: 'review_received',
        title: 'New Review',
        message: `Someone left a ${data.overall_rating}-star review of your vehicle`,
        sender_id: user.id
      });

      return review;
    } catch (error) {
      console.error('Error creating review:', error);
      return null;
    }
  }

  /**
   * Get reviews for a vehicle
   */
  static async getVehicleReviews(vehicleId: string): Promise<ReviewWithReviewer[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_reviews')
        .select(`
          *,
          reviewer:reviewer_id (
            id,
            username,
            full_name,
            avatar_url
          )
        `)
        .eq('vehicle_id', vehicleId)
        .eq('status', 'published')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching reviews:', error);
      return [];
    }
  }

  // ==================== NOTIFICATIONS ====================

  /**
   * Create a notification
   */
  private static async createNotification(data: {
    vehicle_id?: string;
    request_id?: string;
    session_id?: string;
    notification_type: InteractionNotification['notification_type'];
    title: string;
    message: string;
    recipient_id?: string;
    sender_id?: string;
    action_url?: string;
    action_data?: Record<string, any>;
  }): Promise<void> {
    try {
      // If no recipient specified, find vehicle owner
      let recipientId = data.recipient_id;
      if (!recipientId && data.vehicle_id) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('user_id')
          .eq('id', data.vehicle_id)
          .single();
        
        recipientId = vehicle?.user_id;
      }

      if (!recipientId) return;

      await supabase
        .from('interaction_notifications')
        .insert([{
          recipient_id: recipientId,
          sender_id: data.sender_id,
          vehicle_id: data.vehicle_id,
          request_id: data.request_id,
          session_id: data.session_id,
          notification_type: data.notification_type,
          title: data.title,
          message: data.message,
          action_url: data.action_url,
          action_data: data.action_data || {}
        }]);
    } catch (error) {
      console.error('Error creating notification:', error);
    }
  }

  /**
   * Get notifications for current user
   */
  static async getNotifications(limit: number = 20): Promise<InteractionNotification[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('interaction_notifications')
        .select(`
          *,
          sender:sender_id (id, username, full_name, avatar_url),
          vehicle:vehicle_id (id, make, model, year)
        `)
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching notifications:', error);
      return [];
    }
  }

  /**
   * Mark notification as read
   */
  static async markNotificationRead(notificationId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('interaction_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId);

      return !error;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return false;
    }
  }

  // ==================== ANALYTICS ====================

  /**
   * Get vehicle interaction statistics
   */
  static async getVehicleInteractionStats(vehicleId: string): Promise<VehicleInteractionStats> {
    try {
      const [requestsData, sessionsData, reviewsData, activityData] = await Promise.all([
        supabase.from('vehicle_interaction_requests').select('*').eq('vehicle_id', vehicleId),
        supabase.from('vehicle_interaction_sessions').select('*').eq('vehicle_id', vehicleId),
        supabase.from('vehicle_reviews').select('overall_rating').eq('vehicle_id', vehicleId).eq('status', 'published'),
        supabase.from('viewer_activity').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }).limit(10)
      ]);

      const requests = requestsData.data || [];
      const sessions = sessionsData.data || [];
      const reviews = reviewsData.data || [];
      const activity = activityData.data || [];

      // Calculate interaction type distribution
      const interactionTypes: Record<string, number> = {};
      requests.forEach(req => {
        interactionTypes[req.interaction_type] = (interactionTypes[req.interaction_type] || 0) + 1;
      });

      // Calculate average rating
      const averageRating = reviews.length 
        ? reviews.reduce((sum, r) => sum + r.overall_rating, 0) / reviews.length 
        : 0;

      // Count unique viewers
      const uniqueViewers = new Set(activity.map(a => a.user_id)).size;

      return {
        total_requests: requests.length,
        pending_requests: requests.filter(r => r.status === 'pending').length,
        completed_sessions: sessions.filter(s => s.status === 'completed').length,
        total_viewers: uniqueViewers,
        average_rating: averageRating,
        total_reviews: reviews.length,
        interaction_types: interactionTypes,
        recent_activity: activity
      };
    } catch (error) {
      console.error('Error fetching vehicle interaction stats:', error);
      return {
        total_requests: 0,
        pending_requests: 0,
        completed_sessions: 0,
        total_viewers: 0,
        average_rating: 0,
        total_reviews: 0,
        interaction_types: {},
        recent_activity: []
      };
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Check if user can make requests for a vehicle
   */
  static async canMakeRequest(vehicleId: string): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Check if user owns the vehicle
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('user_id')
        .eq('id', vehicleId)
        .single();

      // Users cannot request interactions with their own vehicles
      return vehicle?.user_id !== user.id;
    } catch (error) {
      console.error('Error checking request permissions:', error);
      return false;
    }
  }

  /**
   * Get interaction request by ID with full details
   */
  static async getRequestById(requestId: string): Promise<InteractionRequestWithUser | null> {
    try {
      const { data, error } = await supabase
        .from('vehicle_interaction_requests')
        .select(`
          *,
          requester:requester_id (
            id,
            username,
            full_name,
            avatar_url
          ),
          vehicle:vehicle_id (
            id,
            make,
            model,
            year,
            user_id
          )
        `)
        .eq('id', requestId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching request:', error);
      return null;
    }
  }
}
