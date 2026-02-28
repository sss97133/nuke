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
    color: 'var(--text-disabled)',
    bgColor: 'var(--bg)',
    borderColor: 'var(--border)',
    description: 'Basic viewing access'
  },
  contributor: {
    label: 'Contributor',
    icon: Users,
    color: 'var(--accent)',
    bgColor: 'var(--accent-dim, #EFF6FF)',
    borderColor: 'var(--accent)',
    description: 'Can add photos and notes'
  },
  photographer: {
    label: 'Photographer',
    icon: Camera,
    color: 'var(--accent)',
    bgColor: 'var(--accent-dim, #F3E8FF)',
    borderColor: 'var(--accent)',
    description: 'Visual documentation specialist'
  },
  previous_owner: {
    label: 'Previous Owner',
    icon: Key,
    color: 'var(--warning)',
    bgColor: 'var(--warning-dim)',
    borderColor: 'var(--warning)',
    description: 'Former owner with historical knowledge'
  },
  mechanic: {
    label: 'Mechanic',
    icon: Wrench,
    color: 'var(--success)',
    bgColor: 'var(--success-dim)',
    borderColor: 'var(--success)',
    description: 'Professional technical expertise'
  },
  restorer: {
    label: 'Restorer',
    icon: Star,
    color: 'var(--warning)',
    bgColor: 'var(--warning-dim)',
    borderColor: 'var(--warning)',
    description: 'Vehicle restoration specialist'
  },
  appraiser: {
    label: 'Appraiser',
    icon: TrendingUp,
    color: 'var(--accent)',
    bgColor: 'var(--accent-dim, #ECFEFF)',
    borderColor: 'var(--accent)',
    description: 'Professional valuation expert'
  },
  dealer: {
    label: 'Dealer',
    icon: Building,
    color: 'var(--accent)',
    bgColor: 'var(--accent-dim, #F3E8FF)',
    borderColor: 'var(--accent)',
    description: 'Licensed automotive dealer'
  },
  moderator: {
    label: 'Moderator',
    icon: Gavel,
    color: 'var(--error)',
    bgColor: 'var(--error-dim)',
    borderColor: 'var(--error)',
    description: 'Platform content moderator'
  },
  owner: {
    label: 'Owner',
    icon: Crown,
    color: 'var(--error)',
    bgColor: 'var(--error-dim)',
    borderColor: 'var(--error)',
    description: 'Legal vehicle owner'
  },
  admin: {
    label: 'Administrator',
    icon: Shield,
    color: 'var(--text)',
    bgColor: 'var(--bg)',
    borderColor: 'var(--border)',
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
    color: 'var(--text-disabled)',
    bgColor: 'var(--bg)'
  },
  medium: {
    label: 'Established',
    color: 'var(--accent)',
    bgColor: 'var(--accent-dim, #EFF6FF)'
  },
  high: {
    label: 'Trusted',
    color: 'var(--success)',
    bgColor: 'var(--success-dim)'
  },
  trusted: {
    label: 'Highly Trusted',
    color: 'var(--success)',
    bgColor: 'var(--success-dim)'
  },
  verified: {
    label: 'Verified Expert',
    color: 'var(--error)',
    bgColor: 'var(--error-dim)'
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
            color: 'var(--bg)',
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
            color: 'var(--text-disabled)'
          }}
        >
          {config.description}
        </div>
      )}
    </div>
  );
};

export default RoleIndicator;