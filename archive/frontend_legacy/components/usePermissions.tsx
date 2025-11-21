import { useState, useEffect, useCallback } from 'react';
import rbacService from '../services/rbacService';
import type { Permission, UserRole } from '../services/rbacService';

interface UsePermissionsProps {
  vehicleId: string;
  userId: string;
  permissions?: Permission[];
}

interface PermissionState {
  [key: string]: boolean;
}

interface UsePermissionsReturn {
  permissions: PermissionState;
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  userRole: UserRole | null;
  effectiveRole: any;
  loading: boolean;
  refresh: () => Promise<void>;
}

export const usePermissions = ({
  vehicleId,
  userId,
  permissions = []
}: UsePermissionsProps): UsePermissionsReturn => {
  const [permissionState, setPermissionState] = useState<PermissionState>({});
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [effectiveRole, setEffectiveRole] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadPermissions = useCallback(async () => {
    if (!vehicleId || !userId) return;

    try {
      setLoading(true);

      // Load all requested permissions
      const allPermissions = await rbacService.hasPermissions(vehicleId, userId, permissions);
      setPermissionState(allPermissions);

      // Load user's effective role
      const role = await rbacService.getEffectiveRole(vehicleId, userId);
      setUserRole(role.role);
      setEffectiveRole(role);

    } catch (error) {
      console.error('Error loading permissions:', error);
    } finally {
      setLoading(false);
    }
  }, [vehicleId, userId, permissions]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const hasPermission = useCallback((permission: Permission): boolean => {
    return permissionState[permission] || false;
  }, [permissionState]);

  const hasAnyPermission = useCallback((perms: Permission[]): boolean => {
    return perms.some(p => permissionState[p]);
  }, [permissionState]);

  const hasAllPermissions = useCallback((perms: Permission[]): boolean => {
    return perms.every(p => permissionState[p]);
  }, [permissionState]);

  const refresh = useCallback(async () => {
    await loadPermissions();
  }, [loadPermissions]);

  return {
    permissions: permissionState,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    userRole,
    effectiveRole,
    loading,
    refresh
  };
};

// Higher-order component for permission-based rendering
interface WithPermissionsProps {
  vehicleId: string;
  userId: string;
  permission?: Permission;
  permissions?: Permission[];
  requireAll?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const WithPermissions: React.FC<WithPermissionsProps> = ({
  vehicleId,
  userId,
  permission,
  permissions = [],
  requireAll = false,
  fallback = null,
  children
}) => {
  const allPermissions = permission ? [permission, ...permissions] : permissions;
  const { hasPermission, hasAnyPermission, hasAllPermissions, loading } = usePermissions({
    vehicleId,
    userId,
    permissions: allPermissions
  });

  if (loading) return <div>Loading...</div>;

  let hasAccess = false;

  if (permission) {
    hasAccess = hasPermission(permission);
  } else if (permissions.length > 0) {
    hasAccess = requireAll ? hasAllPermissions(permissions) : hasAnyPermission(permissions);
  }

  return hasAccess ? <>{children}</> : <>{fallback}</>;
};

// Hook for checking specific common permission patterns
export const useCommonPermissions = (vehicleId: string, userId: string) => {
  const commonPermissions: Permission[] = [
    'view_basic_info',
    'view_detailed_specs',
    'edit_basic_info',
    'edit_specs',
    'add_photos',
    'add_documents',
    'add_parts',
    'add_notes',
    'manage_contributors',
    'professional_tools'
  ];

  const permissionData = usePermissions({
    vehicleId,
    userId,
    permissions: commonPermissions
  });

  return {
    ...permissionData,
    // Convenience methods for common checks
    canView: permissionData.hasPermission('view_basic_info'),
    canEdit: permissionData.hasAnyPermission(['edit_basic_info', 'edit_specs']),
    canAdd: permissionData.hasAnyPermission(['add_photos', 'add_documents', 'add_parts', 'add_notes']),
    canManage: permissionData.hasPermission('manage_contributors'),
    hasProfessionalTools: permissionData.hasPermission('professional_tools'),
    isContributor: permissionData.userRole && ['contributor', 'restorer', 'mechanic', 'appraiser', 'previous_owner', 'photographer'].includes(permissionData.userRole),
    isOwner: permissionData.userRole === 'owner',
    isModerator: permissionData.userRole === 'moderator',
    isAdmin: permissionData.userRole === 'admin'
  };
};

export default usePermissions;