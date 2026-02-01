import React from 'react';
import { useCommonPermissions } from '../../hooks/usePermissions';
import type { Permission, UserRole } from '../../services/rbacService';

interface PermissionGateProps {
  vehicleId: string;
  userId: string;
  permission?: Permission;
  permissions?: Permission[];
  requireAll?: boolean;
  roles?: UserRole[];
  minTrustScore?: number;
  fallback?: React.ReactNode;
  loading?: React.ReactNode;
  children: React.ReactNode;
}

const PermissionGate: React.FC<PermissionGateProps> = ({
  vehicleId,
  userId,
  permission,
  permissions = [],
  requireAll = false,
  roles = [],
  minTrustScore,
  fallback = null,
  loading = <div>Loading...</div>,
  children
}) => {
  const {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    userRole,
    effectiveRole,
    loading: isLoading
  } = useCommonPermissions(vehicleId, userId);

  if (isLoading) return <>{loading}</>;

  // Check role-based access
  if (roles.length > 0 && userRole) {
    if (!roles.includes(userRole)) {
      return <>{fallback}</>;
    }
  }

  // Check trust score
  if (minTrustScore && effectiveRole) {
    // This would need to access trust score from context
    // For now, assume it's available in effectiveRole
    const trustScore = effectiveRole.trustScore || 0;
    if (trustScore < minTrustScore) {
      return <>{fallback}</>;
    }
  }

  // Check specific permissions
  let hasAccess = true;

  if (permission) {
    hasAccess = hasPermission(permission);
  } else if (permissions.length > 0) {
    hasAccess = requireAll
      ? hasAllPermissions(permissions)
      : hasAnyPermission(permissions);
  }

  return hasAccess ? <>{children}</> : <>{fallback}</>;
};

// Specialized components for common permission patterns

interface EditableContentProps {
  vehicleId: string;
  userId: string;
  permission: Permission;
  children: (canEdit: boolean) => React.ReactNode;
}

export const EditableContent: React.FC<EditableContentProps> = ({
  vehicleId,
  userId,
  permission,
  children
}) => {
  const { hasPermission } = useCommonPermissions(vehicleId, userId);
  return <>{children(hasPermission(permission))}</>;
};

interface ToolbarProps {
  vehicleId: string;
  userId: string;
  tools: {
    permission?: Permission;
    permissions?: Permission[];
    requireAll?: boolean;
    roles?: UserRole[];
    component: React.ReactNode;
    priority?: number;
  }[];
  maxTools?: number;
}

export const ConditionalToolbar: React.FC<ToolbarProps> = ({
  vehicleId,
  userId,
  tools,
  maxTools
}) => {
  const permissions = useCommonPermissions(vehicleId, userId);

  // Filter and sort tools by permission and priority
  const availableTools = tools
    .filter(tool => {
      // Check role requirements
      if (tool.roles && tool.roles.length > 0) {
        if (!permissions.userRole || !tool.roles.includes(permissions.userRole)) {
          return false;
        }
      }

      // Check permission requirements
      if (tool.permission) {
        return permissions.hasPermission(tool.permission);
      } else if (tool.permissions && tool.permissions.length > 0) {
        return tool.requireAll
          ? permissions.hasAllPermissions(tool.permissions)
          : permissions.hasAnyPermission(tool.permissions);
      }

      return true;
    })
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Apply maxTools limit
  const displayTools = maxTools ? availableTools.slice(0, maxTools) : availableTools;

  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {displayTools.map((tool, index) => (
        <React.Fragment key={index}>
          {tool.component}
        </React.Fragment>
      ))}
    </div>
  );
};

interface ProgressiveDisclosureProps {
  vehicleId: string;
  userId: string;
  levels: {
    permission?: Permission;
    permissions?: Permission[];
    roles?: UserRole[];
    minTrustScore?: number;
    content: React.ReactNode;
  }[];
}

export const ProgressiveDisclosure: React.FC<ProgressiveDisclosureProps> = ({
  vehicleId,
  userId,
  levels
}) => {
  const permissions = useCommonPermissions(vehicleId, userId);

  return (
    <>
      {levels.map((level, index) => {
        let hasAccess = true;

        // Check role requirements
        if (level.roles && level.roles.length > 0) {
          hasAccess = permissions.userRole ? level.roles.includes(permissions.userRole) : false;
        }

        // Check permission requirements
        if (hasAccess && level.permission) {
          hasAccess = permissions.hasPermission(level.permission);
        } else if (hasAccess && level.permissions && level.permissions.length > 0) {
          hasAccess = permissions.hasAnyPermission(level.permissions);
        }

        // Check trust score (would need implementation)
        if (hasAccess && level.minTrustScore) {
          // Implementation would check user's trust score
          // hasAccess = userTrustScore >= level.minTrustScore;
        }

        return hasAccess ? (
          <React.Fragment key={index}>
            {level.content}
          </React.Fragment>
        ) : null;
      })}
    </>
  );
};

export default PermissionGate;