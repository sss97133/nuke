import { supabase } from '../lib/supabase';

export interface AdminNotification {
  id: string;
  notification_type: 'ownership_verification_pending' | 'vehicle_verification_pending' | 'user_verification_pending' | 'fraud_alert' | 'system_alert' | 'new_vehicle_import';
  ownership_verification_id?: string;
  vehicle_verification_id?: string;
  user_id?: string;
  vehicle_id?: string;
  title: string;
  message: string;
  priority: number; // 1-5, 5 being critical
  action_required: 'approve_ownership' | 'reject_ownership' | 'approve_vehicle' | 'reject_vehicle' | 'review_fraud' | 'system_action' | 'review_import';
  status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'dismissed';
  reviewed_by_admin_id?: string;
  admin_notes?: string;
  admin_decision?: string;
  reviewed_at?: string;
  metadata: any;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface AdminDashboardStats {
  pending_ownership_verifications: number;
  pending_vehicle_verifications: number;
  total_pending_notifications: number;
  high_priority_notifications: number;
  total_verifications_today: number;
  approved_today: number;
}

export interface OwnershipVerificationDetails {
  id: string;
  user_id: string;
  vehicle_id: string;
  status: string;
  title_document_url: string;
  drivers_license_url: string;
  face_scan_url?: string;
  insurance_document_url?: string;
  extracted_data: any;
  title_owner_name?: string;
  license_holder_name?: string;
  vehicle_vin_from_title?: string;
  ai_confidence_score?: number;
  ai_processing_results: any;
  name_match_score?: number;
  vin_match_confirmed?: boolean;
  document_authenticity_score?: number;
  submitted_at: string;
  user_email?: string;
  vehicle_info?: string;
}

export class AdminNotificationService {
  // Check if current user is admin
  static async isCurrentUserAdmin(): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Primary: explicit admin allowlist table.
      // Use maybeSingle so missing rows are not treated as hard errors.
      const { data, error } = await supabase
        .from('admin_users')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!error && !!data?.id) return true;

      // Fallback: profile-based privilege check (covers environments where admin_users isn't populated).
      try {
        const { data: allowed, error: rpcErr } = await supabase.rpc('is_admin_or_moderator');
        if (!rpcErr && allowed === true) return true;
      } catch {
        // ignore
      }

      return false;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }

  // Get all pending admin notifications
  static async getPendingNotifications(): Promise<AdminNotification[]> {
    const { data, error } = await supabase
      .from('admin_notifications')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Get admin dashboard stats
  static async getDashboardStats(): Promise<AdminDashboardStats> {
    try {
      const { data, error } = await supabase.rpc('get_admin_dashboard_stats');

      if (error) {
        // If RPC function doesn't exist, calculate stats manually
        if (error.code === '42883') { // function does not exist
          return await this.calculateStatsManually();
        }
        throw error;
      }
      return data || await this.calculateStatsManually();
    } catch (error) {
      console.warn('Using manual stats calculation due to missing RPC function');
      return await this.calculateStatsManually();
    }
  }

  private static async calculateStatsManually(): Promise<AdminDashboardStats> {
    try {
      // Get pending ownership verifications count
      const { count: pendingOwnership } = await supabase
        .from('ownership_verifications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      return {
        pending_ownership_verifications: pendingOwnership || 0,
        pending_vehicle_verifications: 0,
        total_pending_notifications: pendingOwnership || 0,
        high_priority_notifications: 0,
        total_verifications_today: 0,
        approved_today: 0
      };
    } catch (error) {
      console.error('Error calculating manual stats:', error);
      return {
        pending_ownership_verifications: 0,
        pending_vehicle_verifications: 0,
        total_pending_notifications: 0,
        high_priority_notifications: 0,
        total_verifications_today: 0,
        approved_today: 0
      };
    }
  }

  // Get ownership verification details for admin review
  static async getOwnershipVerificationDetails(verificationId: string): Promise<OwnershipVerificationDetails | null> {
    try {
      // Get the verification record first
      const { data: verification, error: verificationError } = await supabase
        .from('ownership_verifications')
        .select('*')
        .eq('id', verificationId)
        .single();

      if (verificationError || !verification) {
        console.error('Error fetching ownership verification:', verificationError);
        return null;
      }

      // Get vehicle info
      let vehicleInfo = 'Unknown Vehicle';
      if (verification.vehicle_id) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('make, model, year, vin')
          .eq('id', verification.vehicle_id)
          .single();
        
        if (vehicle) {
          vehicleInfo = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
        }
      }

      // Return formatted data (user_email will come from notification metadata)
      return {
        ...verification,
        user_email: 'User Email', // This will be populated from notification metadata
        vehicle_info: vehicleInfo
      } as OwnershipVerificationDetails;
    } catch (error) {
      console.error('Error fetching ownership verification details:', error);
      return null;
    }
  }

  // Approve ownership verification
  static async approveOwnershipVerification(
    notificationId: string, 
    adminNotes?: string
  ): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.rpc('admin_approve_ownership_verification', {
        p_notification_id: notificationId,
        p_admin_user_id: user.id,
        p_admin_notes: adminNotes || null
      });

      if (error) throw error;
      return data === true;
    } catch (error) {
      console.error('Error approving ownership verification:', error);
      throw error;
    }
  }

  // Reject ownership verification
  static async rejectOwnershipVerification(
    notificationId: string, 
    rejectionReason: string
  ): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.rpc('admin_reject_ownership_verification', {
        p_notification_id: notificationId,
        p_admin_user_id: user.id,
        p_rejection_reason: rejectionReason
      });

      if (error) throw error;
      return data === true;
    } catch (error) {
      console.error('Error rejecting ownership verification:', error);
      throw error;
    }
  }

  // Mark notification as in review
  static async markNotificationInReview(notificationId: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('admin_notifications')
      .update({
        status: 'in_review',
        reviewed_by_admin_id: user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', notificationId);

    if (error) throw error;
  }

  // Dismiss notification
  static async dismissNotification(notificationId: string, reason?: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('admin_notifications')
      .update({
        status: 'dismissed',
        reviewed_by_admin_id: user.id,
        admin_notes: reason,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', notificationId);

    if (error) throw error;
  }

  // Get notification history (approved, rejected, dismissed)
  static async getNotificationHistory(limit = 50): Promise<AdminNotification[]> {
    const { data, error } = await supabase
      .from('admin_notifications')
      .select('*')
      .in('status', ['approved', 'rejected', 'dismissed'])
      .order('reviewed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  // Subscribe to new admin notifications
  static subscribeToNotifications(callback: (notification: AdminNotification) => void) {
    return supabase
      .channel('admin_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'admin_notifications',
          filter: 'status=eq.pending'
        },
        (payload) => {
          callback(payload.new as AdminNotification);
        }
      )
      .subscribe();
  }

  // Get signed URL for secure document viewing
  static async getSecureDocumentUrl(documentPath: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.storage
        .from('user-documents')
        .createSignedUrl(documentPath, 3600); // 1 hour expiry

      if (error) {
        console.error('Error creating signed URL:', error);
        return null;
      }

      return data.signedUrl;
    } catch (error) {
      console.error('Error getting secure document URL:', error);
      return null;
    }
  }

  // Create manual admin notification (for testing or special cases)
  static async createManualNotification(
    type: AdminNotification['notification_type'],
    title: string,
    message: string,
    priority: number = 2,
    metadata: any = {}
  ): Promise<string> {
    const { data, error } = await supabase
      .from('admin_notifications')
      .insert({
        notification_type: type,
        title,
        message,
        priority,
        action_required: type.includes('ownership') ? 'approve_ownership' : 'approve_vehicle',
        metadata
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }
}
