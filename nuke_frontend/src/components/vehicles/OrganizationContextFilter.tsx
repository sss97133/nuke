import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MyOrganizationsService } from '../../services/myOrganizationsService';
import type { MyOrganization } from '../../services/myOrganizationsService';
import { useAuth } from '../../hooks/useAuth';

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
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    // Wait for auth hydration; otherwise supabase.auth.getUser() can be null briefly,
    // which would cause a silent "no orgs" state that never refreshes.
    if (authLoading) return;
    loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      if (!user?.id) {
        setOrganizations([]);
        return;
      }
      const orgs = await MyOrganizationsService.getMyOrganizations({ status: 'active' });
      // Sort pinned orgs first so users with many affiliations see favorites at the top.
      const sorted = [...orgs].sort((a, b) => {
        const ap = a.preferences?.is_pinned ? 1 : 0;
        const bp = b.preferences?.is_pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        // Higher display_order first, then name
        const ao = a.preferences?.display_order || 0;
        const bo = b.preferences?.display_order || 0;
        if (ao !== bo) return bo - ao;
        return (a.organization.business_name || '').localeCompare(b.organization.business_name || '');
      });
      setOrganizations(sorted);
    } catch (error) {
      console.error('Error loading organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  const togglePinned = async (org: MyOrganization) => {
    const nextPinned = !(org.preferences?.is_pinned || false);
    const res = await MyOrganizationsService.togglePin(org.organization_id, nextPinned);
    if (!res.success) {
      alert(res.error || 'Failed to favorite organization');
      return;
    }
    await loadOrganizations();
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
          {/* Favorite/pin toggle */}
          <span
            role="button"
            tabIndex={0}
            title={org.preferences?.is_pinned ? 'Unfavorite organization' : 'Favorite organization'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              togglePinned(org);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                togglePinned(org);
              }
            }}
            style={{
              fontSize: '9pt',
              lineHeight: 1,
              opacity: org.preferences?.is_pinned ? 1 : 0.4,
              color: org.preferences?.is_pinned ? 'var(--accent)' : 'var(--text-muted)',
              userSelect: 'none'
            }}
            aria-label={org.preferences?.is_pinned ? 'Unfavorite organization' : 'Favorite organization'}
          >
            ★
          </span>
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

