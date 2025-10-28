/**
 * Mobile Organization Dashboard
 * Quick overview of org stats, team, and vehicles
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MobileOrgSwitcher } from './MobileOrgSwitcher';

interface MobileOrgDashboardProps {
  session: any;
}

export const MobileOrgDashboard: React.FC<MobileOrgDashboardProps> = ({ session }) => {
  const [org, setOrg] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedOrgId) {
      loadOrgData(selectedOrgId);
    }
  }, [selectedOrgId]);

  const loadOrgData = async (orgId: string) => {
    // Load org details
    const { data: orgData } = await supabase
      .from('shops')
      .select('*')
      .eq('id', orgId)
      .single();

    setOrg(orgData);

    // Load team members
    const { data: members } = await supabase
      .from('shop_members')
      .select(`
        *,
        profiles:user_id (
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('shop_id', orgId)
      .eq('status', 'active');

    setTeam(members || []);

    // Load org vehicles
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('owner_shop_id', orgId);

    setStats({
      vehicles: vehicles?.length || 0,
      team: members?.length || 0
    });
  };

  if (!session?.user) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>Please log in to access organizations</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Org Switcher */}
      <MobileOrgSwitcher 
        session={session}
        onOrgSelect={setSelectedOrgId}
      />

      {!org && (
        <div style={styles.emptyState}>
          <p>No organization selected</p>
          <a href="/shops/new" style={styles.createLink}>
            + Create Organization
          </a>
        </div>
      )}

      {org && (
        <>
          {/* Org Header */}
          <div style={styles.orgHeader}>
            {org.logo_url && (
              <img src={org.logo_url} alt="" style={styles.orgLogo} />
            )}
            <div style={styles.orgDetails}>
              <h2 style={styles.orgName}>{org.name}</h2>
              <div style={styles.orgMeta}>
                {org.business_type} • {org.city}, {org.state}
                {org.is_verified && <span style={styles.verifiedBadge}>✓ Verified</span>}
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{stats?.vehicles || 0}</div>
              <div style={styles.statLabel}>Vehicles</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{stats?.team || 0}</div>
              <div style={styles.statLabel}>Team</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{org.status}</div>
              <div style={styles.statLabel}>Status</div>
            </div>
          </div>

          {/* Team Members */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>👥 Team Members</div>
            <div style={styles.teamList}>
              {team.length === 0 ? (
                <div style={styles.emptyTeam}>No team members yet</div>
              ) : (
                team.map(member => (
                  <div key={member.id} style={styles.teamCard}>
                    {member.profiles?.avatar_url && (
                      <img src={member.profiles.avatar_url} alt="" style={styles.avatar} />
                    )}
                    <div style={styles.memberInfo}>
                      <div style={styles.memberName}>{member.profiles?.full_name || 'Member'}</div>
                      <div style={styles.memberRole}>{member.role}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div style={styles.actions}>
            <button
              onClick={() => window.location.href = `/org/${org.id}`}
              style={styles.actionBtn}
            >
              View Full Dashboard
            </button>
            <button
              onClick={() => window.location.href = `/org/${org.id}/settings`}
              style={styles.actionBtn}
            >
              ⚙️ Settings
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '16px',
    background: '#f5f5f5',
    minHeight: '100vh',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  emptyState: {
    padding: '40px 20px',
    textAlign: 'center' as const,
    color: '#666'
  },
  createLink: {
    display: 'inline-block',
    marginTop: '16px',
    padding: '12px 24px',
    background: '#000080',
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: '4px',
    border: '2px outset #ffffff',
    fontWeight: 'bold'
  },
  orgHeader: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '8px',
    padding: '16px',
    display: 'flex',
    gap: '16px',
    marginBottom: '16px'
  },
  orgLogo: {
    width: '64px',
    height: '64px',
    borderRadius: '8px',
    objectFit: 'cover' as const,
    border: '2px solid #c0c0c0'
  },
  orgDetails: {
    flex: 1
  },
  orgName: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 'bold'
  },
  orgMeta: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px'
  },
  verifiedBadge: {
    marginLeft: '8px',
    color: '#008000',
    fontWeight: 'bold'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    marginBottom: '16px'
  },
  statCard: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '4px',
    padding: '16px',
    textAlign: 'center' as const
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    fontFamily: 'monospace'
  },
  statLabel: {
    fontSize: '11px',
    color: '#666',
    marginTop: '4px',
    textTransform: 'uppercase' as const
  },
  section: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px'
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: 'bold',
    marginBottom: '12px'
  },
  teamList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px'
  },
  emptyTeam: {
    textAlign: 'center' as const,
    color: '#999',
    padding: '20px',
    fontSize: '13px'
  },
  teamCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    background: '#f9f9f9',
    border: '1px solid #e0e0e0',
    borderRadius: '4px'
  },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    objectFit: 'cover' as const
  },
  memberInfo: {
    flex: 1
  },
  memberName: {
    fontSize: '14px',
    fontWeight: 'bold'
  },
  memberRole: {
    fontSize: '12px',
    color: '#666',
    textTransform: 'capitalize' as const
  },
  actions: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  actionBtn: {
    padding: '14px',
    background: '#000080',
    color: '#ffffff',
    border: '2px outset #ffffff',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  }
};

