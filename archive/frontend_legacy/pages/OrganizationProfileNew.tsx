/**
 * Organization Profile - Clean Rebuild
 * 
 * Architecture follows /docs/ORGANIZATION_DATA_FLOW.md
 * 
 * Permission Model:
 * - Legal Owner (business_ownership) → FULL ACCESS
 * - Contributors (owner/manager) → FULL ACCESS  
 * - Contributors (employee) → EDIT ACCESS
 * - Discoverer (discovered_by) → EDIT ACCESS
 * - Public → READ ACCESS (if is_public=true)
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getOrgPermissions } from '../services/organizationPermissions';

// Modular Tab Components
import OrganizationOverviewTab from '../components/organization/OrganizationOverviewTab';
import OrganizationVehiclesTab from '../components/organization/OrganizationVehiclesTab';
import OrganizationInventoryTab from '../components/organization/OrganizationInventoryTab';
import OrganizationImagesTab from '../components/organization/OrganizationImagesTab';
import OrganizationMembersTab from '../components/organization/OrganizationMembersTab';
import OrganizationTimelineTab from '../components/organization/OrganizationTimelineTab';

interface Organization {
  id: string;
  business_name: string;
  legal_name?: string;
  business_type?: string;
  description?: string;
  logo_url?: string;
  banner_url?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  labor_rate?: number;
  is_public: boolean;
  is_verified: boolean;
  is_tradable?: boolean;
  stock_symbol?: string;
  total_vehicles?: number;
  total_images?: number;
  total_events?: number;
  discovered_by?: string;
  created_at: string;
  updated_at: string;
}

type TabType = 'overview' | 'vehicles' | 'inventory' | 'images' | 'members' | 'timeline';

export default function OrganizationProfileNew() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Core State
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [session, setSession] = useState<any>(null);
  const [permissions, setPermissions] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Stats for Overview Tab
  const [stats, setStats] = useState({
    totalVehicles: 0,
    totalImages: 0,
    totalEvents: 0,
    totalMembers: 0
  });

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (id) {
      loadOrganization();
    }
  }, [id, session]);

  const loadSession = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    setSession(s);
  };

  const loadOrganization = async () => {
    if (!id) return;
    
    setLoading(true);
    try {
      // Load organization
      const { data: org, error: orgError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', id)
        .single();

      if (orgError) throw orgError;
      if (!org) {
        alert('Organization not found');
        navigate('/organizations');
        return;
      }

      setOrganization(org);

      // Load permissions
      const perms = await getOrgPermissions(id, session?.user?.id || null);
      setPermissions(perms);

      // Check if user can view
      if (!perms.canView) {
        alert('This organization is private');
        navigate('/organizations');
        return;
      }

      // Load stats
      await loadStats();
    } catch (error) {
      console.error('Failed to load organization:', error);
      alert('Failed to load organization');
      navigate('/organizations');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    if (!id) return;

    try {
      const [vehiclesCount, imagesCount, eventsCount, membersCount] = await Promise.all([
        supabase
          .from('organization_vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', id),
        
        supabase
          .from('organization_images')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', id),
        
        supabase
          .from('business_timeline_events')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', id),
        
        supabase
          .from('organization_contributors')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', id)
          .eq('status', 'active')
      ]);

      setStats({
        totalVehicles: vehiclesCount.count || 0,
        totalImages: imagesCount.count || 0,
        totalEvents: eventsCount.count || 0,
        totalMembers: membersCount.count || 0
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '11pt',
        color: 'var(--text-muted)'
      }}>
        Loading organization...
      </div>
    );
  }

  if (!organization || !permissions) {
    return null;
  }

  // Determine which tabs to show
  const showInventoryTab = permissions.canEdit || stats.totalVehicles > 0;
  const tabs: Array<{ key: TabType; label: string; count?: number }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'vehicles', label: 'Vehicles', count: stats.totalVehicles },
    ...(showInventoryTab ? [{ key: 'inventory' as TabType, label: 'Inventory' }] : []),
    { key: 'images', label: 'Images', count: stats.totalImages },
    { key: 'members', label: 'Members', count: stats.totalMembers },
    { key: 'timeline', label: 'Timeline', count: stats.totalEvents }
  ];

  return (
    <div style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '20px',
      minHeight: '100vh'
    }}>
      {/* Header */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
            {/* Logo + Name */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flex: 1 }}>
              {organization.logo_url && (
                <div style={{
                  width: '80px',
                  height: '80px',
                  backgroundImage: `url(${organization.logo_url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  border: '2px solid var(--border)',
                  borderRadius: '8px'
                }} />
              )}
              
              <div>
                <h1 style={{
                  fontSize: '18pt',
                  fontWeight: 700,
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  {organization.business_name}
                  
                  {organization.is_verified && (
                    <span style={{
                      fontSize: '7pt',
                      padding: '3px 8px',
                      background: 'var(--success)',
                      color: 'white',
                      fontWeight: 700,
                      borderRadius: '3px'
                    }}>
                      VERIFIED
                    </span>
                  )}
                  
                  {!organization.is_public && (
                    <span style={{
                      fontSize: '7pt',
                      padding: '3px 8px',
                      background: 'var(--warning)',
                      color: 'white',
                      fontWeight: 700,
                      borderRadius: '3px'
                    }}>
                      PRIVATE
                    </span>
                  )}
                </h1>
                
                {organization.business_type && (
                  <div style={{
                    fontSize: '9pt',
                    color: 'var(--text-muted)',
                    marginTop: '4px'
                  }}>
                    {organization.business_type}
                  </div>
                )}
                
                {/* Quick Contact Links */}
                <div style={{
                  fontSize: '8pt',
                  marginTop: '8px',
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}>
                  {organization.website && (
                    <a
                      href={organization.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent)' }}
                    >
                      {organization.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {organization.phone && (
                    <a href={`tel:${organization.phone}`} style={{ color: 'var(--accent)' }}>
                      {organization.phone}
                    </a>
                  )}
                  {organization.email && (
                    <a href={`mailto:${organization.email}`} style={{ color: 'var(--accent)' }}>
                      {organization.email}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Permission Badge */}
            {permissions.role && (
              <div style={{
                padding: '6px 12px',
                background: permissions.role === 'owner' ? 'var(--accent)' : 'var(--grey-100)',
                color: permissions.role === 'owner' ? 'white' : 'var(--text-muted)',
                fontSize: '7pt',
                fontWeight: 700,
                borderRadius: '4px'
              }}>
                YOUR ROLE: {permissions.role.toUpperCase()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '20px',
        borderBottom: '2px solid var(--border)',
        padding: '0 16px',
        flexWrap: 'wrap'
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '12px 20px',
              fontSize: '9pt',
              fontWeight: 600,
              border: 'none',
              background: 'transparent',
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-2px',
              transition: 'all 0.12s ease',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span style={{
                marginLeft: '6px',
                padding: '2px 6px',
                background: activeTab === tab.key ? 'var(--accent)' : 'var(--grey-100)',
                color: activeTab === tab.key ? 'white' : 'var(--text-muted)',
                borderRadius: '10px',
                fontSize: '7pt'
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OrganizationOverviewTab
          organization={organization}
          stats={stats}
          isOwner={permissions.canManageMembers}
          canEdit={permissions.canEdit}
        />
      )}

      {activeTab === 'vehicles' && (
        <OrganizationVehiclesTab
          organizationId={organization.id}
          userId={session?.user?.id || null}
          canEdit={permissions.canEdit}
          isOwner={permissions.canManageMembers}
        />
      )}

      {activeTab === 'inventory' && (
        <OrganizationInventoryTab
          organizationId={organization.id}
          isOwner={permissions.canManageMembers}
        />
      )}

      {activeTab === 'images' && (
        <OrganizationImagesTab
          organizationId={organization.id}
          userId={session?.user?.id || null}
          canEdit={permissions.canEdit}
        />
      )}

      {activeTab === 'members' && (
        <OrganizationMembersTab
          organizationId={organization.id}
          userId={session?.user?.id || null}
          canManageMembers={permissions.canManageMembers}
        />
      )}

      {activeTab === 'timeline' && (
        <OrganizationTimelineTab
          organizationId={organization.id}
          userId={session?.user?.id || null}
        />
      )}
    </div>
  );
}

