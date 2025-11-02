/**
 * Organization Permission Service
 * 
 * Centralized permission checks following the documented model in:
 * /docs/ORGANIZATION_DATA_FLOW.md
 * 
 * Permission Hierarchy:
 * 1. Legal Owner (business_ownership) - FULL ACCESS
 * 2. Contributors (owner/manager) - FULL ACCESS
 * 3. Contributors (employee/technician) - EDIT ACCESS
 * 4. Discoverer (discovered_by) - EDIT ACCESS
 * 5. Public (is_public=true) - READ ACCESS
 */

import { supabase } from '../lib/supabase';

export interface OrgPermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  canLinkVehicles: boolean;
  canUploadImages: boolean;
  canCreateEvents: boolean;
  role: 'owner' | 'manager' | 'employee' | 'contributor' | 'viewer' | null;
  isDiscoverer: boolean;
  isLegalOwner: boolean;
}

/**
 * Get comprehensive permissions for a user on an organization
 */
export const getOrgPermissions = async (
  orgId: string,
  userId: string | null
): Promise<OrgPermissions> => {
  // Default permissions for unauthenticated users
  if (!userId) {
    const { data: org } = await supabase
      .from('businesses')
      .select('is_public')
      .eq('id', orgId)
      .single();
    
    return {
      canView: org?.is_public || false,
      canEdit: false,
      canDelete: false,
      canManageMembers: false,
      canLinkVehicles: false,
      canUploadImages: false,
      canCreateEvents: false,
      role: null,
      isDiscoverer: false,
      isLegalOwner: false
    };
  }

  // Load org data and user's relationship to it
  const [orgData, contributorData, ownershipData] = await Promise.all([
    supabase
      .from('businesses')
      .select('discovered_by, is_public')
      .eq('id', orgId)
      .single(),
    
    supabase
      .from('organization_contributors')
      .select('role, status')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
    
    supabase
      .from('business_ownership')
      .select('id')
      .eq('business_id', orgId)
      .eq('owner_id', userId)
      .eq('status', 'active')
      .maybeSingle()
  ]);

  const org = orgData.data;
  const contributor = contributorData.data;
  const ownership = ownershipData.data;

  // Determine role and permissions
  const isDiscoverer = org?.discovered_by === userId;
  const isLegalOwner = !!ownership;
  const contributorRole = contributor?.role;

  // FULL ACCESS roles
  const hasFullAccess = 
    isLegalOwner || 
    contributorRole === 'owner' ||
    contributorRole === 'co_founder' ||
    contributorRole === 'board_member' ||
    contributorRole === 'manager';

  // EDIT ACCESS roles
  const hasEditAccess = 
    hasFullAccess ||
    isDiscoverer ||
    contributorRole === 'employee' ||
    contributorRole === 'technician' ||
    contributorRole === 'contractor' ||
    contributorRole === 'moderator' ||
    contributorRole === 'contributor';

  return {
    canView: org?.is_public || hasEditAccess || false,
    canEdit: hasEditAccess,
    canDelete: hasFullAccess,
    canManageMembers: hasFullAccess,
    canLinkVehicles: hasEditAccess, // Anyone who can edit can link vehicles
    canUploadImages: userId !== null, // Anyone authenticated can upload
    canCreateEvents: userId !== null, // Anyone authenticated can create events
    role: contributorRole || (isDiscoverer ? 'contributor' : 'viewer'),
    isDiscoverer,
    isLegalOwner
  };
};

/**
 * Quick check: Is user an owner? (Legal or Administrative)
 */
export const isOrgOwner = async (orgId: string, userId: string | null): Promise<boolean> => {
  if (!userId) return false;

  const [contributor, ownership] = await Promise.all([
    supabase
      .from('organization_contributors')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .in('role', ['owner', 'co_founder', 'board_member', 'manager'])
      .eq('status', 'active')
      .maybeSingle(),
    
    supabase
      .from('business_ownership')
      .select('id')
      .eq('business_id', orgId)
      .eq('owner_id', userId)
      .eq('status', 'active')
      .maybeSingle()
  ]);

  return !!contributor.data || !!ownership.data;
};

/**
 * Quick check: Can user edit organization data?
 */
export const canEditOrg = async (orgId: string, userId: string | null): Promise<boolean> => {
  if (!userId) return false;

  // Check 1: Is discoverer?
  const { data: org } = await supabase
    .from('businesses')
    .select('discovered_by')
    .eq('id', orgId)
    .single();
  
  if (org?.discovered_by === userId) return true;

  // Check 2: Is contributor?
  const { data: contributor } = await supabase
    .from('organization_contributors')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  
  return !!contributor;
};

/**
 * Check if user can link a specific vehicle to an organization
 */
export const canLinkVehicle = async (
  orgId: string,
  vehicleId: string,
  userId: string | null
): Promise<boolean> => {
  if (!userId) return false;

  const [vehicleOwner, orgPerms] = await Promise.all([
    supabase
      .from('vehicles')
      .select('user_id, uploaded_by')
      .eq('id', vehicleId)
      .single(),
    
    canEditOrg(orgId, userId)
  ]);

  // Can link if: own the vehicle OR can edit the org
  return (
    vehicleOwner.data?.user_id === userId ||
    vehicleOwner.data?.uploaded_by === userId ||
    orgPerms
  );
};

/**
 * Check if user can manage organization members
 */
export const canManageMembers = async (orgId: string, userId: string | null): Promise<boolean> => {
  if (!userId) return false;

  return await isOrgOwner(orgId, userId);
};

/**
 * Get user's role badge for display
 */
export const getRoleBadge = (role: string | null): { text: string; color: string } => {
  switch (role) {
    case 'owner':
    case 'co_founder':
      return { text: 'OWNER', color: 'var(--accent)' };
    case 'board_member':
    case 'manager':
      return { text: 'MANAGER', color: 'var(--success)' };
    case 'employee':
    case 'technician':
      return { text: 'EMPLOYEE', color: 'var(--warning)' };
    case 'contributor':
    case 'photographer':
    case 'historian':
      return { text: 'CONTRIBUTOR', color: 'var(--info)' };
    default:
      return { text: 'VIEWER', color: 'var(--text-muted)' };
  }
};

/**
 * Validate relationship_type for vehicle links
 */
export const isValidRelationshipType = (type: string): boolean => {
  const validTypes = ['owner', 'in_stock', 'consignment', 'sold', 'service', 'work_location'];
  return validTypes.includes(type);
};

/**
 * Get relationship type badge for display
 */
export const getRelationshipBadge = (type: string): { text: string; color: string } => {
  switch (type) {
    case 'owner':
      return { text: 'OWNER', color: 'var(--accent)' };
    case 'in_stock':
      return { text: 'IN STOCK', color: 'var(--success)' };
    case 'consignment':
      return { text: 'CONSIGNMENT', color: 'var(--info)' };
    case 'sold':
      return { text: 'SOLD', color: 'var(--text-muted)' };
    case 'service':
      return { text: 'SERVICE', color: 'var(--warning)' };
    case 'work_location':
      return { text: 'WORK LOCATION', color: 'var(--info)' };
    default:
      return { text: type.toUpperCase(), color: 'var(--text-muted)' };
  }
};

