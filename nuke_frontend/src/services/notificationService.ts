import { supabase } from '../lib/supabase';

export interface Notification {
  id: string;
  user_id: string;
  type: 'vin_request' | 'verification_request' | 'contribution_request' | 'ownership_challenge' | 'data_correction' | 'photo_approval' | 'timeline_contribution' | 'missing_image_dates' | 'incomplete_profile';
  title: string;
  message: string;
  vehicle_id?: string;
  related_user_id?: string;
  metadata: any;
  read?: boolean;
  is_read?: boolean;  // Legacy support
  is_responded?: boolean;
  response_data?: any;
  action_url?: string;
  created_at: string;
  expires_at?: string;
  priority?: number;
}

export interface UserRequest {
  id: string;
  requester_id: string;
  target_user_id: string;
  vehicle_id?: string;
  request_type: 'vin_validation' | 'ownership_verification' | 'data_contribution' | 'photo_submission' | 'timeline_event';
  title: string;
  description?: string;
  request_data: any;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  response_message?: string;
  created_at: string;
  responded_at?: string;
  expires_at: string;
}

export interface ActivityFeedItem {
  id: string;
  user_id: string;
  activity_type: string;
  title: string;
  description?: string;
  vehicle_id?: string;
  metadata: any;
  created_at: string;
}

export class NotificationService {
  // Get user notifications
  static async getUserNotifications(userId: string, unreadOnly = false): Promise<Notification[]> {
    let query = supabase
      .from('user_notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // Mark notification as read
  static async markNotificationRead(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('user_notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) throw error;
  }

  // Mark notification as responded
  static async respondToNotification(notificationId: string, responseData: any): Promise<void> {
    const { error } = await supabase
      .from('user_notifications')
      .update({ 
        is_read: true,
        metadata: responseData 
      })
      .eq('id', notificationId);

    if (error) throw error;
  }

  // Create a new user request
  static async createUserRequest(
    requesterId: string,
    targetUserId: string,
    requestType: UserRequest['request_type'],
    title: string,
    description?: string,
    vehicleId?: string,
    requestData: any = {}
  ): Promise<string> {
    const { data, error } = await supabase.rpc('create_user_request', {
      p_requester_id: requesterId,
      p_target_user_id: targetUserId,
      p_request_type: requestType,
      p_title: title,
      p_description: description,
      p_vehicle_id: vehicleId,
      p_request_data: requestData
    });

    if (error) throw error;
    return data;
  }

  // Get user requests (sent or received)
  static async getUserRequests(userId: string): Promise<UserRequest[]> {
    const { data, error } = await supabase
      .from('user_requests')
      .select('*')
      .or(`requester_id.eq.${userId},target_user_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Respond to a request
  static async respondToRequest(
    requestId: string,
    status: 'approved' | 'rejected',
    responseMessage?: string
  ): Promise<void> {
    const { error } = await supabase
      .from('user_requests')
      .update({
        status,
        response_message: responseMessage,
        responded_at: new Date().toISOString()
      })
      .eq('id', requestId);

    if (error) throw error;
  }

  // Log quick action
  static async logQuickAction(
    userId: string,
    actionType: string,
    actionData: any = {},
    vehicleId?: string
  ): Promise<void> {
    const { error } = await supabase.rpc('log_quick_action', {
      p_user_id: userId,
      p_action_type: actionType,
      p_action_data: actionData,
      p_vehicle_id: vehicleId
    });

    if (error) throw error;
  }

  // Add activity feed item
  static async addActivityFeedItem(
    userId: string,
    activityType: string,
    title: string,
    description?: string,
    vehicleId?: string,
    metadata: any = {}
  ): Promise<void> {
    const { error } = await supabase.rpc('add_activity_feed_item', {
      p_user_id: userId,
      p_activity_type: activityType,
      p_title: title,
      p_description: description,
      p_vehicle_id: vehicleId,
      p_metadata: metadata
    });

    if (error) throw error;
  }

  // Get user activity feed
  static async getUserActivityFeed(userId: string, limit = 10): Promise<ActivityFeedItem[]> {
    const { data, error } = await supabase
      .from('user_activity_feed')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  // Get user stats for dashboard
  static async getUserStats(userId: string): Promise<{
    vehicleCount: number;
    contributionCount: number;
    verificationScore: number;
    pendingRequests: number;
  }> {
    // Get vehicle count
    const { count: vehicleCount } = await supabase
      .from('vehicles')
      .select('id', { count: 'exact' })
      .eq('user_id', userId);

    // Get pending requests count
    const { count: pendingRequests } = await supabase
      .from('user_requests')
      .select('id', { count: 'exact' })
      .eq('target_user_id', userId)
      .eq('status', 'pending');

    // TODO: Calculate contribution count and verification score from actual data
    const contributionCount = 0;
    const verificationScore = 85;

    return {
      vehicleCount: vehicleCount || 0,
      contributionCount,
      verificationScore,
      pendingRequests: pendingRequests || 0
    };
  }

  // Subscribe to real-time notifications
  static subscribeToNotifications(userId: string, callback: (notification: Notification) => void) {
    return supabase
      .channel('user_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          callback(payload.new as Notification);
        }
      )
      .subscribe();
  }
}
