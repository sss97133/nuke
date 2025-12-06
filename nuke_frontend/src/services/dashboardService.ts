import { supabase } from '../lib/supabase';

export interface PendingCounts {
  work_approvals: number;
  vehicle_assignments: number;
  photo_reviews: number;
  document_reviews: number;
  user_requests: number;
  interaction_requests: number;
  ownership_verifications: number;
  unread_notifications: number;
}

export interface DashboardNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  vehicle_id: string | null;
  organization_id: string | null;
  related_user_id: string | null;
  is_read: boolean;
  is_responded: boolean;
  priority: number;
  created_at: string;
  metadata: any;
}

export interface PendingWorkApproval {
  id: string;
  organization_name: string;
  vehicle_name: string;
  work_type: string | null;
  work_description: string | null;
  match_confidence: number;
  created_at: string;
  vehicle_id: string;
  organization_id: string;
}

export interface PendingVehicleAssignment {
  id: string;
  vehicle_name: string;
  organization_name: string;
  relationship_type: string;
  confidence: number;
  evidence_sources: string[];
  created_at: string;
  vehicle_id: string;
  organization_id: string;
}

export interface ConnectedProfilesSummary {
  vehicles: number;
  organizations: number;
  recent_activity: number;
}

export class DashboardService {
  static async getPendingCounts(userId: string): Promise<PendingCounts> {
    const { data, error } = await supabase.rpc('get_dashboard_pending_counts', {
      p_user_id: userId
    });

    if (error) throw error;
    return data as PendingCounts;
  }

  static async getRecentNotifications(
    userId: string,
    limit: number = 20
  ): Promise<DashboardNotification[]> {
    const { data, error } = await supabase.rpc('get_recent_notifications', {
      p_user_id: userId,
      p_limit: limit
    });

    if (error) throw error;
    return (data || []) as DashboardNotification[];
  }

  static async getPendingWorkApprovals(
    userId: string
  ): Promise<PendingWorkApproval[]> {
    const { data, error } = await supabase.rpc('get_pending_work_approvals', {
      p_user_id: userId
    });

    if (error) throw error;
    return (data || []) as PendingWorkApproval[];
  }

  static async getPendingVehicleAssignments(
    userId: string
  ): Promise<PendingVehicleAssignment[]> {
    const { data, error } = await supabase.rpc('get_pending_vehicle_assignments', {
      p_user_id: userId
    });

    if (error) throw error;
    return (data || []) as PendingVehicleAssignment[];
  }

  static async markNotificationRead(
    userId: string,
    notificationId: string
  ): Promise<boolean> {
    const { data, error } = await supabase.rpc('mark_notification_read', {
      p_user_id: userId,
      p_notification_id: notificationId
    });

    if (error) throw error;
    return data as boolean;
  }

  static async markAllNotificationsRead(userId: string): Promise<number> {
    const { data, error } = await supabase.rpc('mark_all_notifications_read', {
      p_user_id: userId
    });

    if (error) throw error;
    return data as number;
  }

  static async getConnectedProfilesSummary(
    userId: string
  ): Promise<ConnectedProfilesSummary> {
    const { data, error } = await supabase.rpc('get_connected_profiles_summary', {
      p_user_id: userId
    });

    if (error) throw error;
    return data as ConnectedProfilesSummary;
  }

  static async approveWorkNotification(
    notificationId: string,
    notes?: string
  ): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase.rpc('respond_to_work_approval', {
      p_notification_id: notificationId,
      p_user_id: user.id,
      p_response_action: 'approve',
      p_response_notes: notes || null,
      p_ip_address: null,
      p_user_agent: navigator.userAgent
    });

    if (error) throw error;
    if (data && data.length > 0 && !data[0].success) {
      throw new Error(data[0].message || 'Failed to approve work');
    }
  }

  static async rejectWorkNotification(
    notificationId: string,
    notes?: string
  ): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase.rpc('respond_to_work_approval', {
      p_notification_id: notificationId,
      p_user_id: user.id,
      p_response_action: 'reject',
      p_response_notes: notes || null,
      p_ip_address: null,
      p_user_agent: navigator.userAgent
    });

    if (error) throw error;
    if (data && data.length > 0 && !data[0].success) {
      throw new Error(data[0].message || 'Failed to reject work');
    }
  }

  static async approveVehicleAssignment(
    assignmentId: string,
    notes?: string
  ): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Use RPC function instead of direct update (handles RLS properly)
    const { error } = await supabase.rpc('approve_pending_assignment', {
      p_assignment_id: assignmentId,
      p_user_id: user.id,
      p_notes: notes || null
    });

    if (error) throw error;
  }

  static async rejectVehicleAssignment(
    assignmentId: string,
    notes?: string
  ): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Use RPC function instead of direct update (handles RLS properly)
    const { error } = await supabase.rpc('reject_pending_assignment', {
      p_assignment_id: assignmentId,
      p_user_id: user.id,
      p_notes: notes || null
    });

    if (error) throw error;
  }
}

