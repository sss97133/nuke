import { supabase } from '../lib/supabase';

// Core role definitions with hierarchical permissions
export type UserRole =
  | 'viewer'           // Basic viewer, no editing
  | 'contributor'      // Can add data, photos, notes
  | 'restorer'        // Can manage parts, builds, extensive editing
  | 'mechanic'        // Technical data, maintenance records, diagnostics
  | 'appraiser'       // Valuation, market data, condition assessment
  | 'previous_owner'  // Historical data, stories, maintenance history
  | 'dealer'          // Commercial tools, market insights, sales data
  | 'photographer'    // Photo management, visual documentation
  | 'moderator'       // Content moderation, dispute resolution
  | 'owner'           // Legal owner, full control
  | 'admin';          // Platform admin

// Verification levels that affect trust and permissions
export type VerificationLevel =
  | 'unverified'      // New user, limited access
  | 'email_verified'  // Basic verification
  | 'phone_verified'  // Additional verification
  | 'id_verified'     // Government ID verified
  | 'expert_verified' // Professional credentials verified
  | 'background_checked'; // Full background check

// Experience levels that modify permissions
export type ExperienceLevel = 'learning' | 'experienced' | 'expert' | 'professional';

// Trust score affects permission scope
export type TrustLevel = 'low' | 'medium' | 'high' | 'trusted' | 'verified';

// Permission categories
export type Permission =
  // Viewing permissions
  | 'view_basic_info'
  | 'view_detailed_specs'
  | 'view_maintenance_records'
  | 'view_financial_data'
  | 'view_private_notes'
  | 'view_owner_contact'
  | 'view_build_data'
  | 'view_documents'

  // Editing permissions
  | 'edit_basic_info'
  | 'edit_specs'
  | 'edit_maintenance_records'
  | 'add_photos'
  | 'add_documents'
  | 'add_parts'
  | 'add_notes'
  | 'manage_documents'
  | 'edit_build_data'
  | 'edit_timeline'

  // Administrative permissions
  | 'manage_contributors'
  | 'assign_roles'
  | 'verify_data'
  | 'delete_content'
  | 'professional_tools'
  | 'financial_management';

// Simple RBAC service class
class RBACService {
  // Basic permission check
  hasPermission(userRole: UserRole, permission: Permission): boolean {
    // Simple role-based permissions - can be expanded
    const rolePermissions: Record<UserRole, Permission[]> = {
      viewer: ['view_basic_info'],
      contributor: ['view_basic_info', 'view_detailed_specs', 'add_photos', 'add_notes'],
      restorer: ['view_basic_info', 'view_detailed_specs', 'edit_basic_info', 'add_photos', 'edit_build_data', 'add_parts', 'add_notes'],
      mechanic: ['view_basic_info', 'view_detailed_specs', 'edit_maintenance_records', 'add_photos', 'add_notes'],
      appraiser: ['view_basic_info', 'view_detailed_specs', 'view_financial_data', 'professional_tools'],
      previous_owner: ['view_basic_info', 'view_detailed_specs', 'add_photos', 'add_notes', 'edit_timeline'],
      dealer: ['view_basic_info', 'view_detailed_specs', 'professional_tools', 'financial_management'],
      photographer: ['view_basic_info', 'add_photos', 'manage_documents', 'add_notes'],
      moderator: ['view_basic_info', 'view_detailed_specs', 'manage_contributors', 'verify_data'],
      owner: ['view_basic_info', 'view_detailed_specs', 'edit_basic_info', 'edit_specs', 'manage_contributors', 'assign_roles'],
      admin: ['view_basic_info', 'view_detailed_specs', 'edit_basic_info', 'edit_specs', 'manage_contributors', 'assign_roles', 'verify_data', 'delete_content', 'professional_tools', 'financial_management']
    };

    const permissions = rolePermissions[userRole] || [];
    return permissions.includes(permission);
  }

  // Get display name for role
  getRoleDisplayName(role: UserRole): string {
    const displayNames: Record<UserRole, string> = {
      viewer: 'Viewer',
      contributor: 'Contributor',
      restorer: 'Restorer',
      mechanic: 'Mechanic',
      appraiser: 'Appraiser',
      previous_owner: 'Previous Owner',
      dealer: 'Dealer',
      photographer: 'Photographer',
      moderator: 'Moderator',
      owner: 'Owner',
      admin: 'Administrator'
    };

    return displayNames[role] || 'Unknown';
  }

  // Determine a user's effective role for a given vehicle context
  // Safe fallback to 'viewer' if no relationship is found or on error
  async getEffectiveRole(vehicleId: string, userId: string): Promise<{ role: UserRole; trustScore?: number; [k: string]: any }> {
    try {
      // Try to read relationship from DB if table exists; otherwise fallback
      const { data, error } = await supabase
        .from('vehicle_user_relationships')
        .select('role, context_modifiers, status, granted_at')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId)
        .order('granted_at', { ascending: false })
        .limit(1);

      if (error) {
        // Table may not exist or RLS may block; fall back gracefully
        return { role: 'viewer' };
      }

      const rel = (data && data[0]) as any;
      if (!rel) return { role: 'viewer' };

      const role = (rel.role as UserRole) || 'viewer';
      const trustScore = rel?.context_modifiers?.trustScore as number | undefined;
      return { role, trustScore, ...rel };
    } catch {
      return { role: 'viewer' };
    }
  }

  // Batch permission check for a user within a vehicle context
  async hasPermissions(vehicleId: string, userId: string, permissions: Permission[]): Promise<Record<Permission, boolean>> {
    const result = {} as Record<Permission, boolean>;
    try {
      const effective = await this.getEffectiveRole(vehicleId, userId);
      for (const p of permissions) {
        result[p] = this.hasPermission(effective.role, p);
      }
      return result;
    } catch {
      for (const p of permissions) {
        result[p] = false;
      }
      return result;
    }
  }

  // Submit a role change request
  async requestRoleChange(
    vehicleId: string,
    userId: string,
    requestedRole: UserRole,
    reason: string,
    context?: any
  ): Promise<boolean> {
    try {
      const payload: any = {
        vehicle_id: vehicleId,
        user_id: userId,
        requested_role: requestedRole,
        reason,
        evidence: context || {},
        status: 'pending'
      };
      const { error } = await supabase.from('role_change_requests').insert(payload);
      if (error) return false;
      return true;
    } catch {
      return false;
    }
  }
}

export const rbacService = new RBACService();
export default rbacService;