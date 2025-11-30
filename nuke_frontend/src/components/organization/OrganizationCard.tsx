import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { MyOrganization } from '../../services/myOrganizationsService';
import '../../design-system.css';

interface OrganizationCardProps {
  organization: MyOrganization;
  isOwnProfile: boolean;
  onPinToggle?: (organizationId: string, isPinned: boolean) => void;
}

const OrganizationCard: React.FC<OrganizationCardProps> = ({
  organization,
  isOwnProfile,
  onPinToggle,
}) => {
  const navigate = useNavigate();

  const formatRole = (role: string) => {
    return role
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner':
      case 'co_founder':
        return '#00ff00';
      case 'manager':
      case 'board_member':
        return '#00aaff';
      case 'employee':
      case 'technician':
        return '#ffaa00';
      case 'contractor':
        return '#ff00ff';
      default:
        return '#666';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return { text: 'ACTIVE', color: '#00ff00' };
      case 'inactive':
        return { text: 'PAST', color: '#666' };
      case 'pending':
        return { text: 'PENDING', color: '#ffff00' };
      default:
        return { text: status.toUpperCase(), color: '#666' };
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  const statusBadge = getStatusBadge(organization.status);
  const stats = organization.stats || {
    vehicle_count: 0,
    in_stock_count: 0,
    total_value: 0,
    team_member_count: 0,
  };

  return (
    <div
      className="card"
      style={{
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
      onClick={() => navigate(`/organizations/${organization.organization_id}`)}
    >
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          {organization.organization.logo_url ? (
            <img
              src={organization.organization.logo_url}
              alt={organization.organization.business_name}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '4px',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '4px',
                backgroundColor: '#ddd',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#666',
              }}
            >
              {organization.organization.business_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h3 className="heading-3" style={{ margin: 0, fontSize: '16px' }}>
              {organization.organization.business_name}
            </h3>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
              {organization.organization.business_type?.replace(/_/g, ' ')}
            </div>
          </div>
        </div>
        {isOwnProfile && onPinToggle && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPinToggle(organization.organization_id, !organization.preferences?.is_pinned);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              fontSize: '16px',
            }}
            title={organization.preferences?.is_pinned ? 'Unpin' : 'Pin'}
          >
            {organization.preferences?.is_pinned ? '📌' : '📍'}
          </button>
        )}
      </div>

      <div className="card-body">
        {/* Role & Status */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 'bold',
              padding: '3px 8px',
              borderRadius: '3px',
              backgroundColor: getRoleColor(organization.role),
              color: '#fff',
            }}
          >
            {formatRole(organization.role)}
          </span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 'bold',
              padding: '3px 8px',
              borderRadius: '3px',
              backgroundColor: statusBadge.color,
              color: statusBadge.color === '#ffff00' ? '#000' : '#fff',
            }}
          >
            {statusBadge.text}
          </span>
          {organization.organization.is_verified && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 'bold',
                padding: '3px 8px',
                borderRadius: '3px',
                backgroundColor: '#00ff00',
                color: '#000',
              }}
            >
              VERIFIED
            </span>
          )}
        </div>

        {/* Quick Stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px',
            marginBottom: '12px',
            padding: '8px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
          }}
        >
          <div>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>Vehicles</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{stats.vehicle_count}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>In Stock</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{stats.in_stock_count}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>Total Value</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
              {formatCurrency(stats.total_value)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>Team</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{stats.team_member_count}</div>
          </div>
        </div>

        {/* Contribution Count */}
        <div style={{ fontSize: '11px', color: '#666', marginBottom: '12px' }}>
          Your Contributions: <strong>{organization.contribution_count}</strong>
        </div>

        {/* Quick Actions */}
        {isOwnProfile && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              className="cursor-button"
              style={{
                flex: 1,
                padding: '6px 12px',
                fontSize: '11px',
                backgroundColor: '#0000ff',
              }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/organizations/${organization.organization_id}`);
              }}
            >
              VIEW PROFILE
            </button>
            {(organization.role === 'owner' || organization.role === 'manager') && (
              <button
                className="cursor-button"
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  fontSize: '11px',
                  backgroundColor: '#666',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/organizations/${organization.organization_id}?tab=inventory`);
                }}
              >
                MANAGE
              </button>
            )}
          </div>
        )}

        {/* Start Date */}
        <div style={{ fontSize: '10px', color: '#999', marginTop: '8px', textAlign: 'right' }}>
          Since {new Date(organization.start_date).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
};

export default OrganizationCard;



