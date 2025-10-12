/**
 * Unified Ownership Service
 *
 * Consolidates all ownership-related logic from the frontend into a single, consistent service.
 * This service acts as the single source of truth for ownership status determination and permissions.
 */

import { supabase } from '../lib/supabase';

// Force module refresh

export interface OwnershipStatus {
  status: 'legal_owner' | 'contributor_owner' | 'previous_owner' | 'restorer' | 'contributor' | 'uploader' | 'viewer' | 'no_access' |
          'consigner' | 'enthusiast' | 'historian' | 'curator' | 'moderator' | 'collector' |
          'appraiser' | 'detailer' | 'inspector' | 'photographer' | 'sales_agent';
  message: string;
  color: string;
  isUploader: boolean;  // Changed from isDatabaseOwner
  isLegalOwner: boolean;
  contributorRole?: string;
  hasContributorAccess: boolean;
  permissionLevel: 'full' | 'edit' | 'contribute' | 'view';
}

export interface OwnershipVerification {
  id: string;
  vehicle_id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  verification_type: string;
  submitted_at: string;
  reviewed_at?: string;
}

export interface VehicleContributor {
  id: string;
  vehicle_id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  profiles?: {
    full_name: string;
    email: string;
  };
}

export class OwnershipService {
  /**
   * Get comprehensive ownership status for a user and vehicle
   */
  static async getOwnershipStatus(vehicleId: string, session: any): Promise<OwnershipStatus> {
    if (!session?.user?.id) {
      return {
        status: 'no_access',
        message: 'Login required',
        color: 'gray',
        isUploader: false,
        isLegalOwner: false,
        hasContributorAccess: false,
        permissionLevel: 'view'
      };
    }

    try {
      // Parallel queries for efficiency
      const [vehicleResult, verificationResult, contributorResult] = await Promise.all([
        supabase.from('vehicles').select('uploaded_by, user_id').eq('id', vehicleId).single(),
        supabase
          .from('ownership_verifications')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .eq('user_id', session.user.id)
          .eq('status', 'approved')
          .maybeSingle(),
        supabase
          .from('vehicle_contributors')
          .select('*, profiles(full_name, email)')
          .eq('vehicle_id', vehicleId)
          .eq('user_id', session.user.id)
          .eq('status', 'active')
          .maybeSingle()
      ]);

      const vehicle = vehicleResult.data;
      const verification = verificationResult.data;
      const contributor = contributorResult.data;

      const isUploader = (vehicle?.uploaded_by || vehicle?.user_id) === session.user.id;  // Support both fields for backwards compatibility
      const isLegalOwner = !!verification;
      const hasContributorAccess = !!contributor;
      const contributorRole = contributor?.role;

      const status = this.determineOwnershipLevel(isUploader, isLegalOwner, contributorRole);

      return {
        status,
        message: this.getStatusMessage(status),
        color: this.getStatusColor(status),
        isUploader,  // Changed from isDatabaseOwner
        isLegalOwner,
        contributorRole,
        hasContributorAccess,
        permissionLevel: this.getPermissionLevel(status)
      };
    } catch (error) {
      console.error('Error getting ownership status:', error);
      return {
        status: 'no_access',
        message: 'Error loading ownership',
        color: 'red',
        isUploader: false,
        isLegalOwner: false,
        hasContributorAccess: false,
        permissionLevel: 'view'
      };
    }
  }

  /**
   * Check if user has permission for a specific action
   */
  static async hasPermission(vehicleId: string, session: any, action: 'view' | 'edit' | 'delete' | 'transfer'): Promise<boolean> {
    const ownership = await this.getOwnershipStatus(vehicleId, session);
    return this.checkActionPermission(ownership, action);
  }

  /**
   * Get all ownership verifications for a vehicle
   */
  static async getOwnershipVerifications(vehicleId: string): Promise<OwnershipVerification[]> {
    const { data, error } = await supabase
      .from('ownership_verifications')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading ownership verifications:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get all contributors for a vehicle
   */
  static async getContributors(vehicleId: string): Promise<VehicleContributor[]> {
    const { data, error } = await supabase
      .from('vehicle_contributors')
      .select('*, profiles(full_name, email)')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading contributors:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Submit ownership verification claim
   */
  static async submitOwnershipVerification(claimData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('ownership_verifications')
        .insert({
          ...claimData,
          submitted_at: new Date().toISOString()
        });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error submitting ownership verification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add contributor to vehicle
   */
  static async addContributor(vehicleId: string, userId: string, role: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('vehicle_contributors')
        .insert({
          vehicle_id: vehicleId,
          user_id: userId,
          role,
          status: 'active'
        });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error adding contributor:', error);
      return { success: false, error: error.message };
    }
  }

  // Private helper methods

  private static determineOwnershipLevel(isUploader: boolean, isLegalOwner: boolean, contributorRole?: string): OwnershipStatus['status'] {
    if (isLegalOwner) return 'legal_owner';
    if (contributorRole === 'owner') return 'contributor_owner';

    // Handle all the new role types from the consolidated system
    if (contributorRole === 'previous_owner') return 'previous_owner';
    if (contributorRole === 'restorer') return 'restorer';
    if (contributorRole === 'consigner') return 'consigner';
    if (contributorRole === 'enthusiast') return 'enthusiast';
    if (contributorRole === 'historian') return 'historian';
    if (contributorRole === 'curator') return 'curator';
    if (contributorRole === 'moderator') return 'moderator';
    if (contributorRole === 'collector') return 'collector';
    if (contributorRole === 'appraiser') return 'appraiser';
    if (contributorRole === 'detailer') return 'detailer';
    if (contributorRole === 'inspector') return 'inspector';
    if (contributorRole === 'photographer') return 'photographer';
    if (contributorRole === 'sales_agent') return 'sales_agent';

    if (contributorRole) return 'contributor';  // Fallback for other roles
    if (isUploader) return 'uploader';  // New: uploader has basic access but is NOT an owner
    return 'viewer';
  }

  private static getStatusMessage(status: OwnershipStatus['status']): string {
    switch (status) {
      case 'legal_owner': return 'Legal Owner';
      case 'contributor_owner': return 'Owner (Contributor)';
      case 'previous_owner': return 'Previous Owner';
      case 'restorer': return 'Restorer';
      case 'contributor': return 'Contributor';
      case 'uploader': return 'Uploader (needs ownership verification)';
      case 'viewer': return 'Viewer Only';
      case 'no_access': return 'No Access';

      // New role types
      case 'consigner': return 'Consigner';
      case 'enthusiast': return 'Enthusiast';
      case 'historian': return 'Historian';
      case 'curator': return 'Curator';
      case 'moderator': return 'Moderator';
      case 'collector': return 'Collector';
      case 'appraiser': return 'Appraiser';
      case 'detailer': return 'Detailer';
      case 'inspector': return 'Inspector';
      case 'photographer': return 'Photographer';
      case 'sales_agent': return 'Sales Agent';

      default: return 'Unknown Status';
    }
  }

  private static getStatusColor(status: OwnershipStatus['status']): string {
    switch (status) {
      case 'legal_owner': return 'green';
      case 'contributor_owner': return 'blue';
      case 'previous_owner': return 'yellow';
      case 'restorer': return 'purple';
      case 'contributor': return 'blue';
      case 'uploader': return 'orange';  // Orange indicates needs verification
      case 'viewer': return 'gray';
      case 'no_access': return 'red';

      // New role colors
      case 'consigner': return 'teal';
      case 'enthusiast': return 'cyan';
      case 'historian': return 'indigo';
      case 'curator': return 'violet';
      case 'moderator': return 'red';
      case 'collector': return 'pink';
      case 'appraiser': return 'emerald';
      case 'detailer': return 'lime';
      case 'inspector': return 'amber';
      case 'photographer': return 'fuchsia';
      case 'sales_agent': return 'sky';

      default: return 'gray';
    }
  }

  private static getPermissionLevel(status: OwnershipStatus['status']): OwnershipStatus['permissionLevel'] {
    switch (status) {
      case 'legal_owner':
      case 'contributor_owner':
      case 'moderator':  // Moderators have full access
        return 'full';

      case 'restorer':
      case 'previous_owner':
      case 'consigner':   // Consigners need edit access
      case 'curator':     // Curators need edit access
      case 'appraiser':   // Appraisers need edit access
      case 'sales_agent': // Sales agents need edit access
        return 'edit';

      case 'contributor':
      case 'uploader':    // Uploaders have contribute access, not full ownership
      case 'enthusiast':  // Enthusiasts can contribute
      case 'historian':   // Historians can contribute
      case 'collector':   // Collectors can contribute
      case 'detailer':    // Detailers can contribute
      case 'inspector':   // Inspectors can contribute
      case 'photographer': // Photographers can contribute
        return 'contribute';

      default:
        return 'view';
    }
  }

  private static checkActionPermission(ownership: OwnershipStatus, action: string): boolean {
    switch (ownership.permissionLevel) {
      case 'full':
        return true;
      case 'edit':
        return ['view', 'edit'].includes(action);
      case 'contribute':
        return ['view', 'edit'].includes(action);
      case 'view':
        return action === 'view';
      default:
        return false;
    }
  }
}

export default OwnershipService;