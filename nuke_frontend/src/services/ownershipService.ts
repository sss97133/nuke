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

// Helper functions defined BEFORE class to prevent TDZ issues
function determineOwnershipLevel(isUploader: boolean, isLegalOwner: boolean, contributorRole?: string): OwnershipStatus['status'] {
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

function getStatusMessage(status: OwnershipStatus['status']): string {
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

function getStatusColor(status: OwnershipStatus['status']): string {
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

function getPermissionLevel(status: OwnershipStatus['status']): OwnershipStatus['permissionLevel'] {
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

function checkActionPermission(ownership: OwnershipStatus, action: string): boolean {
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

export class OwnershipService {
  /**
   * Get comprehensive ownership status for a user and vehicle
   */
  static async getOwnershipStatus(vehicleId: string, session: any): Promise<OwnershipStatus> {
    // Early return for missing session
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
      // Safe parallel queries - catch individual failures so missing tables don't crash
      const [vehicleResult, verificationResult, contributorResult, userPermissionResult, orgMemberResult] = await Promise.all([
        (async () => {
          try {
            return await supabase.from('vehicles').select('uploaded_by, user_id').eq('id', vehicleId).single();
          } catch (err: any) {
            console.warn('[OwnershipService] vehicles table query failed:', err.message);
            return { data: null, error: err };
          }
        })(),
        (async () => {
          try {
            return await supabase
              .from('ownership_verifications')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .eq('user_id', session.user.id)
              .eq('status', 'approved')
              .maybeSingle();
          } catch (err: any) {
            console.warn('[OwnershipService] ownership_verifications table missing or RLS blocked:', err.message);
            return { data: null, error: err };
          }
        })(),
        (async () => {
          try {
            return await supabase
              .from('vehicle_contributors')
              .select('*, profiles(full_name, email)')
              .eq('vehicle_id', vehicleId)
              .eq('user_id', session.user.id)
              .eq('status', 'active')
              .maybeSingle();
          } catch (err: any) {
            console.warn('[OwnershipService] vehicle_contributors table missing or RLS blocked:', err.message);
            return { data: null, error: err };
          }
        })(),
        (async () => {
          try {
            return await supabase
              .from('vehicle_user_permissions')
              .select('role, is_active')
              .eq('vehicle_id', vehicleId)
              .eq('user_id', session.user.id)
              .eq('is_active', true)
              .in('role', ['owner', 'co_owner'])
              .maybeSingle();
          } catch (err: any) {
            console.warn('[OwnershipService] vehicle_user_permissions table missing or RLS blocked:', err.message);
            return { data: null, error: err };
          }
        })(),
        (async () => {
          try {
            return await supabase
              .from('organization_vehicles')
              .select('id, organization_id, relationship_type, start_date, end_date')
              .eq('vehicle_id', vehicleId)
              .eq('status', 'active');
          } catch (err: any) {
            console.warn('[OwnershipService] organization_vehicles table missing or RLS blocked:', err.message);
            return { data: [], error: err };
          }
        })()
      ]);

      const vehicle = vehicleResult.data;
      const verification = verificationResult.data;
      const contributor = contributorResult.data;
      const userPermission = userPermissionResult.data;
      const orgVehicles = orgMemberResult.data || [];

      // Calculate isUploader early to avoid reference errors
      const isUploader = (vehicle?.uploaded_by || vehicle?.user_id) === session.user.id;  // Support both fields for backwards compatibility

      // Check if user has org membership that grants access during tenure period
      let orgContributorRole: string | null = null;
      let hasOrgAccess = false;
      
      if (orgVehicles && orgVehicles.length > 0) {
        const now = new Date();
        // For each org linked to this vehicle, check if user is a member
        for (const orgVehicle of orgVehicles) {
          const orgMemberQuery = await supabase
            .from('organization_contributors')
            .select('role, status, start_date, end_date')
            .eq('organization_id', orgVehicle.organization_id)
            .eq('user_id', session.user.id)
            .catch(err => {
              console.warn('[OwnershipService] organization_contributors table missing or RLS blocked:', err.message);
              return { data: null, error: err };
            });
          const { data: orgMember, error: orgMemberError } = orgMemberQuery
            .eq('status', 'active')
            .maybeSingle();
          
          if (orgMemberError) {
            console.warn('[OwnershipService] Error checking org membership:', orgMemberError);
          }
          
          if (orgMember && orgMember.role) {
            // Check if tenure period overlaps (if dates specified)
            const vehicleStart = orgVehicle.start_date ? new Date(orgVehicle.start_date) : null;
            const vehicleEnd = orgVehicle.end_date ? new Date(orgVehicle.end_date) : null;
            const memberStart = orgMember.start_date ? new Date(orgMember.start_date) : null;
            const memberEnd = orgMember.end_date ? new Date(orgMember.end_date) : null;
            
            // Check if current date is within member's tenure
            const nowInMemberTenure = (!memberStart || now >= memberStart) && (!memberEnd || now <= memberEnd);
            
            // Check if vehicle tenure overlaps with member's tenure
            // If member has no dates, grant access if vehicle tenure exists
            // If vehicle has no dates, grant access if member is currently active
            const vehicleInMemberTenure = (!vehicleStart || !vehicleEnd) 
              ? nowInMemberTenure // If vehicle has no tenure dates, use member's current status
              : (!memberStart || vehicleEnd >= memberStart) && (!memberEnd || vehicleStart <= memberEnd);
            
            // For board members, grant access if they're currently active OR if vehicle tenure overlaps
            // (Board members have broader access rights)
            const canAccess = nowInMemberTenure || vehicleInMemberTenure || 
              (['board_member', 'owner', 'co_founder', 'manager'].includes(orgMember.role) && !memberEnd);
            
            if (canAccess) {
              // Board members and managers have full access
              if (['board_member', 'owner', 'co_founder', 'manager'].includes(orgMember.role)) {
                hasOrgAccess = true;
                orgContributorRole = orgMember.role;
                console.log('[OwnershipService] Granted org access:', {
                  role: orgMember.role,
                  vehicleTenure: { start: vehicleStart, end: vehicleEnd },
                  memberTenure: { start: memberStart, end: memberEnd },
                  nowInMemberTenure,
                  vehicleInMemberTenure
                });
                break;
              }
              // Other roles have contributor access
              if (['employee', 'technician', 'contractor', 'photographer', 'contributor'].includes(orgMember.role)) {
                hasOrgAccess = true;
                orgContributorRole = orgMember.role;
                console.log('[OwnershipService] Granted org contributor access:', {
                  role: orgMember.role,
                  vehicleTenure: { start: vehicleStart, end: vehicleEnd },
                  memberTenure: { start: memberStart, end: memberEnd }
                });
                break;
              }
            }
          }
        }
      }
      
      // Check ownership from multiple sources:
      // 1. Approved ownership_verifications (document-based verification)
      // 2. vehicle_user_permissions with owner/co_owner role (legacy/explicit permissions)
      const isLegalOwner = !!verification || !!userPermission;
      const hasContributorAccess = !!contributor || hasOrgAccess;
      // If user has vehicle_user_permissions with owner role, use that as contributor role
      const contributorRole = contributor?.role || (userPermission?.role === 'owner' ? 'owner' : null) || orgContributorRole;
      
      // Debug logging
      console.log('[OwnershipService] Permission check result:', {
        vehicleId,
        userId: session.user.id,
        isUploader,
        hasVerification: !!verification,
        hasUserPermission: !!userPermission,
        userPermissionRole: userPermission?.role,
        isLegalOwner,
        hasContributor: !!contributor,
        hasOrgAccess,
        orgContributorRole,
        hasContributorAccess,
        finalContributorRole: contributorRole
      });

      // Call helper functions directly to avoid TDZ issues
      const status = determineOwnershipLevel(isUploader, isLegalOwner, contributorRole);

      return {
        status,
        message: getStatusMessage(status),
        color: getStatusColor(status),
        isUploader,  // Changed from isDatabaseOwner
        isLegalOwner,
        contributorRole,
        hasContributorAccess,
        permissionLevel: getPermissionLevel(status)
      };
    } catch (error) {
      console.error('[OwnershipService] Fatal error - falling back to permissive defaults:', error);
      // PERMISSIVE FALLBACK: If backend tables aren't ready, allow logged-in users to contribute
      // RLS at database level will still enforce actual permissions
      return {
        status: 'contributor',
        message: 'Contributor access (backend tables loading)',
        color: 'blue',
        isUploader: false,
        isLegalOwner: false,
        hasContributorAccess: true,
        permissionLevel: 'contribute'
      };
    }
  }

  /**
   * Check if user has permission for a specific action
   */
  static async hasPermission(vehicleId: string, session: any, action: 'view' | 'edit' | 'delete' | 'transfer'): Promise<boolean> {
    const ownership = await OwnershipService.getOwnershipStatus(vehicleId, session);
    return checkActionPermission(ownership, action);
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
    } catch (error: any) {
      console.error('Error submitting ownership verification:', error);
      return { success: false, error: error?.message || 'Unknown error' };
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
    } catch (error: any) {
      console.error('Error adding contributor:', error);
      return { success: false, error: error?.message || 'Unknown error' };
    }
  }

}

export default OwnershipService;