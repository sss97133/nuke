import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MyOrganizationsService, MyOrganization } from '../../services/myOrganizationsService';

interface OrganizationContextFilterProps {
  selectedOrganizationId: string | null;
  onOrganizationChange: (orgId: string | null) => void;
  showPersonalView?: boolean;
}

const OrganizationContextFilter: React.FC<OrganizationContextFilterProps> = ({
  selectedOrganizationId,
  onOrganizationChange,
  showPersonalView = true
}) => {
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const orgs = await MyOrganizationsService.getMyOrganizations({ status: 'active' });
      setOrganizations(orgs);
    } catch (error) {
      console.error('Error loading organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '8px', fontSize: '8pt', color: 'var(--text-muted)' }}>
        Loading organizations...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text-muted)' }}>
        View:
      </label>
      
      {showPersonalView && (
        <button
          onClick={() => onOrganizationChange(null)}
          style={{
            padding: '6px 12px',
            fontSize: '8pt',
            fontWeight: 600,
            border: selectedOrganizationId === null ? '2px solid var(--accent)' : '1px solid var(--border)',
            background: selectedOrganizationId === null ? 'rgba(var(--accent-rgb), 0.1)' : 'white',
            color: selectedOrganizationId === null ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            borderRadius: '4px',
            transition: 'all 0.12s ease'
          }}
        >
          Personal ({organizations.length > 0 ? 'All Vehicles' : 'My Vehicles'})
        </button>
      )}

      {organizations.map((org) => (
        <button
          key={org.organization_id}
          onClick={() => onOrganizationChange(org.organization_id)}
          style={{
            padding: '6px 12px',
            fontSize: '8pt',
            fontWeight: 600,
            border: selectedOrganizationId === org.organization_id ? '2px solid var(--accent)' : '1px solid var(--border)',
            background: selectedOrganizationId === org.organization_id ? 'rgba(var(--accent-rgb), 0.1)' : 'white',
            color: selectedOrganizationId === org.organization_id ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            borderRadius: '4px',
            transition: 'all 0.12s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          {org.organization.logo_url && (
            <img
              src={org.organization.logo_url}
              alt=""
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '2px',
                objectFit: 'cover'
              }}
            />
          )}
          <span>{org.organization.business_name}</span>
          {org.stats && (
            <span style={{ fontSize: '7pt', opacity: 0.7 }}>
              ({org.stats.vehicle_count})
            </span>
          )}
        </button>
      ))}

      {organizations.length === 0 && (
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No organizations found
        </div>
      )}
    </div>
  );
};

export default OrganizationContextFilter;

