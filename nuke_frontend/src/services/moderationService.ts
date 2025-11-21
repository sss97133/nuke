import { supabase } from '../lib/supabase';
import type { 
  VehicleAccessLevel, 
  VehicleContentSubmission, 
  VehicleProfileSettings, 
  VehicleContributor,
  CreateSubmissionData,
  UpdateProfileSettingsData,
  GrantAccessData,
  ModerationDashboardData,
  PublicVehicleProfile,
  AccessLevel,
  SubmissionStatus
} from '../types/moderation';

export class ModerationService {
  /**
   * Get moderation dashboard data for vehicle owners/moderators
   */
  static async getModerationDashboard(vehicleId: string): Promise<ModerationDashboardData | null> {
    try {
      const [pendingSubmissions, recentActivity, contributors, accessLevels, profileSettings] = await Promise.all([
        // Pending submissions
        supabase
          .from('vehicle_content_submissions')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('status', 'pending')
          .order('submission_date', { ascending: false }),
        
        // Recent activity (last 30 days)
        supabase
          .from('vehicle_content_submissions')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .gte('submission_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('submission_date', { ascending: false })
          .limit(20),
        
        // Contributors
        supabase
          .from('vehicle_contributors')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('reputation_score', { ascending: false }),
        
        // Access levels
        supabase
          .from('vehicle_access_levels')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('is_active', true),
        
        // Profile settings
        supabase
          .from('vehicle_profile_settings')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .single()
      ]);

      if (pendingSubmissions.error || recentActivity.error || contributors.error || accessLevels.error || profileSettings.error) {
        console.error('Error fetching moderation dashboard:', {
          pendingSubmissions: pendingSubmissions.error,
          recentActivity: recentActivity.error,
          contributors: contributors.error,
          accessLevels: accessLevels.error,
          profileSettings: profileSettings.error
        });
        return null;
      }

      return {
        pending_submissions: pendingSubmissions.data || [],
        recent_activity: recentActivity.data || [],
        contributor_stats: contributors.data || [],
        access_levels: accessLevels.data || [],
        profile_settings: profileSettings.data
      };
    } catch (error) {
      console.error('Error getting moderation dashboard:', error);
      return null;
    }
  }

  /**
   * Get public vehicle profile data
   */
  static async getPublicVehicleProfile(vehicleSlug: string): Promise<PublicVehicleProfile | null> {
    try {
      // First get the vehicle by slug
      const { data: profileSettings, error: settingsError } = await supabase
        .from('vehicle_profile_settings')
        .select('*, vehicles(*)')
        .eq('public_url_slug', vehicleSlug)
        .eq('is_public', true)
        .single();

      if (settingsError || !profileSettings) {
        console.error('Vehicle not found or not public:', settingsError);
        return null;
      }

      const vehicleId = profileSettings.vehicle_id;

      // Get approved content and other public data
      const [approvedContent, contributors, timelineEvents] = await Promise.all([
        supabase
          .from('vehicle_content_submissions')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('status', 'approved')
          .eq('is_public', true)
          .order('display_priority', { ascending: false }),
        
        supabase
          .from('vehicle_contributors')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('reputation_score', { ascending: false }),
        
        // Get timeline events if enabled
        profileSettings.show_timeline ? supabase
          .from('vehicle_timeline')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('is_public', true)
          .order('event_date', { ascending: false }) : Promise.resolve({ data: [], error: null })
      ]);

      return {
        vehicle: profileSettings.vehicles,
        profile_settings: profileSettings,
        approved_content: approvedContent.data || [],
        contributors: contributors.data || [],
        timeline_events: timelineEvents.data || [],
        specifications: {}, // TODO: Extract from vehicle data
        modifications: [] // TODO: Get from modifications table
      };
    } catch (error) {
      console.error('Error getting public vehicle profile:', error);
      return null;
    }
  }

  /**
   * Submit content for moderation
   */
  static async submitContent(submissionData: CreateSubmissionData): Promise<VehicleContentSubmission | null> {
    try {
      const { data, error } = await supabase
        .from('vehicle_content_submissions')
        .insert([{
          ...submissionData,
          submitted_by: (await supabase.auth.getUser()).data.user?.id || null,
          submission_date: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Error submitting content:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error submitting content:', error);
      return null;
    }
  }

  /**
   * Review and approve/reject submission
   */
  static async reviewSubmission(
    submissionId: string, 
    status: SubmissionStatus, 
    reviewNotes?: string,
    isPublic?: boolean,
    displayPriority?: number
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicle_content_submissions')
        .update({
          status,
          reviewed_by: (await supabase.auth.getUser()).data.user?.id,
          reviewed_at: new Date().toISOString(),
          review_notes: reviewNotes,
          is_public: isPublic ?? (status === 'approved'),
          display_priority: displayPriority ?? 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', submissionId);

      if (error) {
        console.error('Error reviewing submission:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error reviewing submission:', error);
      return false;
    }
  }

  /**
   * Update vehicle profile settings
   */
  static async updateProfileSettings(
    vehicleId: string, 
    settings: UpdateProfileSettingsData
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicle_profile_settings')
        .update({
          ...settings,
          updated_at: new Date().toISOString()
        })
        .eq('vehicle_id', vehicleId);

      if (error) {
        console.error('Error updating profile settings:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating profile settings:', error);
      return false;
    }
  }

  /**
   * Grant access level to user
   */
  static async grantAccess(vehicleId: string, accessData: GrantAccessData): Promise<boolean> {
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) return false;

      const { error } = await supabase
        .from('vehicle_access_levels')
        .upsert({
          vehicle_id: vehicleId,
          user_id: accessData.user_id,
          access_level: accessData.access_level,
          granted_by: currentUser.id,
          expires_at: accessData.expires_at,
          permissions: accessData.permissions || {},
          notes: accessData.notes,
          is_active: true,
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error granting access:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error granting access:', error);
      return false;
    }
  }

  /**
   * Revoke access level from user
   */
  static async revokeAccess(vehicleId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('vehicle_access_levels')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error revoking access:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error revoking access:', error);
      return false;
    }
  }

  /**
   * Check user's access level for a vehicle
   */
  static async getUserAccessLevel(vehicleId: string, userId?: string): Promise<AccessLevel | null> {
    try {
      const currentUserId = userId || (await supabase.auth.getUser()).data.user?.id;
      if (!currentUserId) return null;

      const { data, error } = await supabase
        .from('vehicle_access_levels')
        .select('access_level')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', currentUserId)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return data.access_level as AccessLevel;
    } catch (error) {
      console.error('Error checking user access level:', error);
      return null;
    }
  }

  /**
   * Get vehicle's public URL slug
   */
  static async getVehicleSlug(vehicleId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('vehicle_profile_settings')
        .select('public_url_slug')
        .eq('vehicle_id', vehicleId)
        .single();

      if (error || !data) {
        return null;
      }

      return data.public_url_slug;
    } catch (error) {
      console.error('Error getting vehicle slug:', error);
      return null;
    }
  }

  /**
   * Bulk approve submissions
   */
  static async bulkApproveSubmissions(submissionIds: string[]): Promise<boolean> {
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) return false;

      const { error } = await supabase
        .from('vehicle_content_submissions')
        .update({
          status: 'approved',
          reviewed_by: currentUser.id,
          reviewed_at: new Date().toISOString(),
          is_public: true,
          updated_at: new Date().toISOString()
        })
        .in('id', submissionIds);

      if (error) {
        console.error('Error bulk approving submissions:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error bulk approving submissions:', error);
      return false;
    }
  }
}
