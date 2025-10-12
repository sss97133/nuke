import React from 'react';
import type { UserRole, TrustLevel } from '../../services/rbacService';
import {
  Shield, User, Users, Crown, Key, Star, Award, Camera,
  Wrench, TrendingUp, Building, Gavel, Eye
} from 'lucide-react';

interface RoleIndicatorProps {
  role: UserRole;
  trustLevel?: TrustLevel;
  trustScore?: number;
  showUpgrade?: boolean;
  onUpgradeClick?: () => void;
  size?: 'small' | 'medium' | 'large';
  showTrustScore?: boolean;
  className?: string;
}

const ROLE_CONFIG: Record<UserRole, {
  label: string;
  icon: React.ComponentType<any>;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}> = {
  viewer: {
    label: 'Viewer',
    icon: Eye,
    color: '#6B7280',
    bgColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    description: 'Basic viewing access'
  },
  contributor: {
    label: 'Contributor',
    icon: Users,
    color: '#3B82F6',
    bgColor: '#EFF6FF',
    borderColor: '#DBEAFE',
    description: 'Can add photos and notes'
  },
  photographer: {
    label: 'Photographer',
    icon: Camera,
    color: '#8B5CF6',
    bgColor: '#F3E8FF',
    borderColor: '#E9D5FF',
    description: 'Visual documentation specialist'
  },
  previous_owner: {
    label: 'Previous Owner',
    icon: Key,
    color: '#F59E0B',
    bgColor: '#FFFBEB',
    borderColor: '#FED7AA',
    description: 'Former owner with historical knowledge'
  },
  mechanic: {
    label: 'Mechanic',
    icon: Wrench,
    color: '#10B981',
    bgColor: '#ECFDF5',
    borderColor: '#D1FAE5',
    description: 'Professional technical expertise'
  },
  restorer: {
    label: 'Restorer',
    icon: Star,
    color: '#F97316',
    bgColor: '#FFF7ED',
    borderColor: '#FEDEC7',
    description: 'Vehicle restoration specialist'
  },
  appraiser: {
    label: 'Appraiser',
    icon: TrendingUp,
    color: '#06B6D4',
    bgColor: '#ECFEFF',
    borderColor: '#CFFAFE',
    description: 'Professional valuation expert'
  },
  dealer: {
    label: 'Dealer',
    icon: Building,
    color: '#8B5CF6',
    bgColor: '#F3E8FF',
    borderColor: '#E9D5FF',
    description: 'Licensed automotive dealer'
  },
  moderator: {
    label: 'Moderator',
    icon: Gavel,
    color: '#DC2626',
    bgColor: '#FEF2F2',
    borderColor: '#FECACA',
    description: 'Platform content moderator'
  },
  owner: {
    label: 'Owner',
    icon: Crown,
    color: '#DC2626',
    bgColor: '#FEF2F2',
    borderColor: '#FECACA',
    description: 'Legal vehicle owner'
  },
  admin: {
    label: 'Administrator',
    icon: Shield,
    color: '#1F2937',
    bgColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    description: 'Platform administrator'
  }
};

const TRUST_LEVEL_CONFIG: Record<TrustLevel, {
  label: string;
  color: string;
  bgColor: string;
}> = {
  low: {
    label: 'New User',
    color: '#6B7280',
    bgColor: '#F9FAFB'
  },
  medium: {
    label: 'Established',
    color: '#3B82F6',
    bgColor: '#EFF6FF'
  },
  high: {
    label: 'Trusted',
    color: '#10B981',
    bgColor: '#ECFDF5'
  },
  trusted: {
    label: 'Highly Trusted',
    color: '#059669',
    bgColor: '#D1FAE5'
  },
  verified: {
    label: 'Verified Expert',
    color: '#DC2626',
    bgColor: '#FEF2F2'
  }
};

const RoleIndicator: React.FC<RoleIndicatorProps> = ({
  role,
  trustLevel = 'low',
  trustScore,
  showUpgrade = false,
  onUpgradeClick,
  size = 'medium',
  showTrustScore = false,
  className = ''
}) => {
  const config = ROLE_CONFIG[role];
  const trustConfig = TRUST_LEVEL_CONFIG[trustLevel];
  const Icon = config.icon;

  const sizes = {
    small: {
      padding: '4px 8px',
      fontSize: '12px',
      iconSize: 12,
      gap: '4px'
    },
    medium: {
      padding: '6px 12px',
      fontSize: '14px',
      iconSize: 16,
      gap: '6px'
    },
    large: {
      padding: '8px 16px',
      fontSize: '16px',
      iconSize: 20,
      gap: '8px'
    }
  };

  const sizeConfig = sizes[size];

  return (
    <div className={`role-indicator ${className}`}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: sizeConfig.gap,
          padding: sizeConfig.padding,
          backgroundColor: config.bgColor,
          color: config.color,
          border: `1px solid ${config.borderColor}`,
          borderRadius: '6px',
          fontSize: sizeConfig.fontSize,
          fontWeight: '500'
        }}
      >
        <Icon size={sizeConfig.iconSize} />
        <span>{config.label}</span>

        {showTrustScore && trustScore !== undefined && (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              backgroundColor: trustConfig.bgColor,
              color: trustConfig.color,
              borderRadius: '4px',
              marginLeft: '4px'
            }}
          >
            {trustScore}
          </span>
        )}
      </div>

      {showUpgrade && onUpgradeClick && (
        <button
          onClick={onUpgradeClick}
          style={{
            marginLeft: '8px',
            padding: '4px 8px',
            fontSize: '12px',
            backgroundColor: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Upgrade
        </button>
      )}

      {size === 'large' && (
        <div
          style={{
            marginTop: '4px',
            fontSize: '12px',
            color: '#6B7280'
          }}
        >
          {config.description}
        </div>
      )}
    </div>
  );
};

export default RoleIndicator;