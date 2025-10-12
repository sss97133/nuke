import React, { useState, useEffect } from 'react';
import { useCommonPermissions } from '../../hooks/usePermissions';
import RoleIndicator from './RoleIndicator';
import RoleRequestWorkflow from './RoleRequestWorkflow';
import contextualPermissionService from '../../services/contextualPermissions';
import {
  Plus, Upload, Camera, FileText, Wrench, TrendingUp,
  Users, Settings, Eye, Edit, Save, MessageSquare,
  AlertTriangle, CheckCircle, Clock, Shield, Star
} from 'lucide-react';

interface VehicleToolbarProps {
  vehicleId: string;
  userId: string;
  vehicleStatus?: 'active' | 'for_sale' | 'sold' | 'private';
  className?: string;
}

interface ToolDefinition {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
  onClick: () => void;
  permission?: string;
  roles?: string[];
  priority: number;
  category: 'primary' | 'secondary' | 'contextual';
  contextualConditions?: {
    showWhen?: (context: any) => boolean;
    hideWhen?: (context: any) => boolean;
  };
}

const VehicleToolbar: React.FC<VehicleToolbarProps> = ({
  vehicleId,
  userId,
  vehicleStatus = 'active',
  className = ''
}) => {
  const [showRoleRequest, setShowRoleRequest] = useState(false);
  const [contextualTools, setContextualTools] = useState<ToolDefinition[]>([]);
  const [userContext, setUserContext] = useState<any>({});

  const permissions = useCommonPermissions(vehicleId, userId);

  // Load contextual data
  useEffect(() => {
    loadContextualData();
  }, [vehicleId, userId, permissions.userRole]);

  const loadContextualData = async () => {
    try {
      // Get contextual permissions and modifiers
      const contextData = await contextualPermissionService.getContextualPermissions(
        vehicleId,
        userId,
        {
          deviceType: getDeviceType(),
          vehicleStatus,
          timeOfDay: getTimeOfDay()
        }
      );

      setUserContext({
        ...contextData,
        deviceType: getDeviceType(),
        vehicleStatus,
        timeOfDay: getTimeOfDay()
      });

      // Update contextual tools based on current conditions
      updateContextualTools(contextData);

    } catch (error) {
      console.error('Error loading contextual data:', error);
    }
  };

  const updateContextualTools = (contextData: any) => {
    const tools: ToolDefinition[] = [];

    // Add contextual tools based on current state
    if (contextData.modifiers) {
      contextData.modifiers.forEach((modifier: any) => {
        if (modifier.effect === 'enhance' && modifier.permissions.includes('add_photos')) {
          tools.push({
            id: 'enhanced-photo',
            icon: Camera,
            label: 'Quick Capture',
            onClick: () => {/* Handle quick photo capture */},
            priority: 10,
            category: 'contextual'
          });
        }

        if (modifier.effect === 'grant' && modifier.permissions.includes('edit_specs')) {
          tools.push({
            id: 'supervised-edit',
            icon: Edit,
            label: 'Collaborative Edit',
            onClick: () => {/* Handle supervised editing */},
            priority: 8,
            category: 'contextual'
          });
        }
      });
    }

    setContextualTools(tools);
  };

  // Base tool definitions
  const baseTools: ToolDefinition[] = [
    // Primary tools (most common actions)
    {
      id: 'add-photo',
      icon: Camera,
      label: 'Add Photo',
      onClick: () => {/* Handle photo upload */},
      permission: 'add_photos',
      priority: 10,
      category: 'primary'
    },
    {
      id: 'add-note',
      icon: MessageSquare,
      label: 'Add Note',
      onClick: () => {/* Handle note creation */},
      permission: 'add_notes',
      priority: 9,
      category: 'primary'
    },
    {
      id: 'add-document',
      icon: FileText,
      label: 'Add Document',
      onClick: () => {/* Handle document upload */},
      permission: 'add_documents',
      priority: 8,
      category: 'primary'
    },
    {
      id: 'manage-documents',
      icon: FileText,
      label: 'Documents',
      onClick: () => {/* Handle document management */},
      permission: 'manage_documents',
      roles: ['owner', 'restorer'],
      priority: 9,
      category: 'primary'
    },

    // Secondary tools (editing and management)
    {
      id: 'edit-specs',
      icon: Edit,
      label: 'Edit Specs',
      onClick: () => {/* Handle spec editing */},
      permission: 'edit_specs',
      priority: 7,
      category: 'secondary'
    },
    {
      id: 'add-part',
      icon: Plus,
      label: 'Add Part',
      onClick: () => {/* Handle part addition */},
      permission: 'add_parts',
      priority: 6,
      category: 'secondary'
    },
    {
      id: 'import-data',
      icon: Upload,
      label: 'Import',
      onClick: () => {/* Handle data import */},
      permission: 'import_build_data',
      roles: ['restorer', 'mechanic', 'owner'],
      priority: 5,
      category: 'secondary'
    },

    // Professional tools
    {
      id: 'professional-tools',
      icon: Wrench,
      label: 'Pro Tools',
      onClick: () => {/* Handle professional tools */},
      permission: 'professional_tools',
      roles: ['mechanic', 'appraiser', 'restorer', 'owner'],
      priority: 4,
      category: 'secondary'
    },
    {
      id: 'valuation',
      icon: TrendingUp,
      label: 'Valuation',
      onClick: () => {/* Handle valuation */},
      permission: 'edit_valuations',
      roles: ['appraiser', 'dealer', 'owner'],
      priority: 3,
      category: 'secondary'
    },

    // Management tools
    {
      id: 'manage-contributors',
      icon: Users,
      label: 'Manage Access',
      onClick: () => {/* Handle contributor management */},
      permission: 'manage_contributors',
      roles: ['owner'],
      priority: 2,
      category: 'secondary'
    },
    {
      id: 'settings',
      icon: Settings,
      label: 'Settings',
      onClick: () => {/* Handle settings */},
      permission: 'manage_contributors',
      roles: ['owner'],
      priority: 1,
      category: 'secondary'
    }
  ];

  // Filter tools based on permissions and context
  const getAvailableTools = (): ToolDefinition[] => {
    const allTools = [...baseTools, ...contextualTools];

    return allTools
      .filter(tool => {
        // Check permission requirements
        if (tool.permission && !permissions.hasPermission(tool.permission as any)) {
          return false;
        }

        // Check role requirements
        if (tool.roles && tool.roles.length > 0) {
          if (!permissions.userRole || !tool.roles.includes(permissions.userRole)) {
            return false;
          }
        }

        // Check contextual conditions
        if (tool.contextualConditions) {
          if (tool.contextualConditions.hideWhen && tool.contextualConditions.hideWhen(userContext)) {
            return false;
          }
          if (tool.contextualConditions.showWhen && !tool.contextualConditions.showWhen(userContext)) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => b.priority - a.priority);
  };

  const availableTools = getAvailableTools();
  const primaryTools = availableTools.filter(t => t.category === 'primary');
  const secondaryTools = availableTools.filter(t => t.category === 'secondary');
  const contextTools = availableTools.filter(t => t.category === 'contextual');

  // Show access request button if user has limited permissions
  const showRequestAccess = permissions.userRole === 'viewer' ||
    (!permissions.canEdit && !permissions.canAdd);

  return (
    <div className={`vehicle-toolbar ${className}`}>

      {/* Role indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <RoleIndicator
          role={permissions.userRole || 'viewer'}
          trustLevel={permissions.effectiveRole?.trustLevel}
          trustScore={permissions.effectiveRole?.trustScore}
          showUpgrade={permissions.effectiveRole?.canUpgrade}
          onUpgradeClick={() => setShowRoleRequest(true)}
        />

        {/* Contextual status indicators */}
        {userContext.modifiers && userContext.modifiers.length > 0 && (
          <div style={{ display: 'flex', gap: '4px' }}>
            {userContext.modifiers.map((modifier: any, index: number) => (
              <div
                key={index}
                title={modifier.reason}
                style={{
                  padding: '2px 6px',
                  fontSize: '10px',
                  borderRadius: '4px',
                  backgroundColor: modifier.effect === 'enhance' ? '#10B981' :
                                 modifier.effect === 'grant' ? '#3B82F6' :
                                 modifier.effect === 'restrict' ? '#F59E0B' : '#EF4444',
                  color: 'white'
                }}
              >
                {modifier.effect === 'enhance' ? '↗' :
                 modifier.effect === 'grant' ? '+' :
                 modifier.effect === 'restrict' ? '!' : '✕'}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Primary tools (always visible if available) */}
      {primaryTools.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {primaryTools.slice(0, 3).map(tool => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={tool.onClick}
                className="button button-primary"
                title={tool.label}
              >
                <Icon size={16} />
                <span>{tool.label}</span>
              </button>
            );
          })}

          {/* Request access button for limited users */}
          {showRequestAccess && (
            <button
              onClick={() => setShowRoleRequest(true)}
              className="button button-secondary"
              title="Request additional permissions"
            >
              <Plus size={16} />
              <span>Request Access</span>
            </button>
          )}
        </div>
      )}

      {/* Contextual tools (shown based on current context) */}
      {contextTools.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '6px',
          marginBottom: '12px',
          padding: '8px',
          backgroundColor: '#F3F4F6',
          borderRadius: '6px',
          border: '1px solid #E5E7EB'
        }}>
          <div style={{
            fontSize: '12px',
            color: '#6B7280',
            marginRight: '8px',
            display: 'flex',
            alignItems: 'center'
          }}>
            <Star size={12} style={{ marginRight: '4px' }} />
            Context:
          </div>
          {contextTools.map(tool => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={tool.onClick}
                className="button button-small button-tertiary"
                title={tool.label}
              >
                <Icon size={14} />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Secondary tools (collapsible) */}
      {secondaryTools.length > 0 && (
        <details>
          <summary style={{
            cursor: 'pointer',
            fontSize: '14px',
            color: '#6B7280',
            marginBottom: '8px'
          }}>
            More Tools ({secondaryTools.length})
          </summary>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {secondaryTools.map(tool => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={tool.onClick}
                  className="button button-small button-secondary"
                  title={tool.label}
                >
                  <Icon size={14} />
                  <span>{tool.label}</span>
                </button>
              );
            })}
          </div>
        </details>
      )}

      {/* Role request workflow */}
      {showRoleRequest && (
        <RoleRequestWorkflow
          vehicleId={vehicleId}
          userId={userId}
          currentRole={permissions.userRole}
          onClose={() => setShowRoleRequest(false)}
          onSuccess={() => {
            setShowRoleRequest(false);
            permissions.refresh();
          }}
        />
      )}
    </div>
  );
};

// Utility functions
function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export default VehicleToolbar;