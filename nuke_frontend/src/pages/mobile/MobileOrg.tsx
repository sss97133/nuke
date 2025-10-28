/**
 * Mobile Organization Management Page
 * Mobile-optimized org dashboard and tools
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { MobileOrgSwitcher } from '../../components/mobile/MobileOrgSwitcher';

export const MobileOrg: React.FC = () => {
  const { orgId } = useParams<{ orgId?: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'team' | 'vehicles'>('overview');
  const [stats, setStats] = useState<any>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  useEffect(() => {
    if (orgId) {
      loadOrgData(orgId);
    }
  }, [orgId]);

  const loadOrgData = async (id: string) => {
    // Load org
    const { data: orgData } = await supabase
      .from('shops')
      .select('*')
      .eq('id', id)
      .single();

    setOrg(orgData);

    // Load stats
    const [teamData, vehicleData] = await Promise.all([
      supabase.from('shop_members').select('id').eq('shop_id', id).eq('status', 'active'),
      supabase.from('vehicles').select('id').eq('owner_shop_id', id)
    ]);

    setStats({
      team: teamData.count || 0,
      vehicles: vehicleData.count || 0
    });

    // Load team for team tab
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
      .eq('shop_id', id)
      .eq('status', 'active');

    setTeam(members || []);

    // Load vehicles for vehicles tab
    const { data: orgVehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, current_value')
      .eq('owner_shop_id', id)
      .limit(20);

    setVehicles(orgVehicles || []);
  };

  const handleOrgSwitch = (newOrgId: string) => {
    navigate(`/mobile/org/${newOrgId}`);
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>←</button>
        <h1 style={styles.title}>Organizations</h1>
      </div>

      {/* Org Switcher */}
      <div style={styles.switcherContainer}>
        <MobileOrgSwitcher session={session} onOrgSelect={handleOrgSwitch} />
      </div>

      {!org ? (
        <div style={styles.emptyState}>Loading...</div>
      ) : (
        <>
          {/* Tab Bar */}
          <div style={styles.tabBar}>
            {['overview', 'team', 'vehicles'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                style={{
                  ...styles.tab,
                  ...(activeTab === tab ? styles.tabActive : {})
                }}
              >
                {tab === 'overview' && '📊 Overview'}
                {tab === 'team' && '👥 Team'}
                {tab === 'vehicles' && '🚗 Vehicles'}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={styles.content}>
            {activeTab === 'overview' && (
              <div>
                {/* Org Info Card */}
                <div style={styles.card}>
                  {org.logo_url && (
                    <img src={org.logo_url} alt="" style={styles.orgLogo} />
                  )}
                  <h2 style={styles.orgName}>{org.name}</h2>
                  <div style={styles.orgType}>{org.business_type}</div>
                  {org.description && (
                    <p style={styles.orgDesc}>{org.description}</p>
                  )}
                  <div style={styles.orgContact}>
                    {org.phone && <div>📞 {org.phone}</div>}
                    {org.email && <div>✉️ {org.email}</div>}
                    {org.website && <div>🌐 {org.website}</div>}
                  </div>
                </div>

                {/* Stats Cards */}
                <div style={styles.statsGrid}>
                  <div style={styles.statCard}>
                    <div style={styles.statValue}>{stats?.vehicles || 0}</div>
                    <div style={styles.statLabel}>Vehicles</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statValue}>{stats?.team || 0}</div>
                    <div style={styles.statLabel}>Team</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'team' && (
              <div style={styles.teamList}>
                {team.map(member => (
                  <div key={member.id} style={styles.teamCard}>
                    {member.profiles?.avatar_url && (
                      <img src={member.profiles.avatar_url} alt="" style={styles.avatar} />
                    )}
                    <div style={styles.memberInfo}>
                      <div style={styles.memberName}>{member.profiles?.full_name || 'Member'}</div>
                      <div style={styles.memberEmail}>{member.profiles?.email}</div>
                      <div style={styles.memberRole}>{member.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'vehicles' && (
              <div style={styles.vehicleList}>
                {vehicles.map(v => (
                  <div 
                    key={v.id} 
                    style={styles.vehicleCard}
                    onClick={() => navigate(`/vehicle/${v.id}`)}
                  >
                    <div style={styles.vehicleName}>{v.year} {v.make} {v.model}</div>
                    <div style={styles.vehicleValue}>
                      ${v.current_value?.toLocaleString() || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f5f5f5',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  header: {
    background: '#000080',
    color: '#ffffff',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#ffffff',
    fontSize: '24px',
    cursor: 'pointer',
    padding: 0
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 'bold'
  },
  switcherContainer: {
    padding: '16px',
    background: '#ffffff',
    borderBottom: '2px solid #c0c0c0'
  },
  emptyState: {
    padding: '40px 20px',
    textAlign: 'center' as const,
    color: '#666'
  },
  tabBar: {
    display: 'flex',
    background: '#c0c0c0',
    borderBottom: '2px solid #808080'
  },
  tab: {
    flex: 1,
    padding: '14px',
    background: '#c0c0c0',
    border: 'none',
    borderRight: '1px solid #808080',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  tabActive: {
    background: '#ffffff',
    borderTop: '3px solid #000080'
  },
  content: {
    padding: '16px'
  },
  card: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px',
    textAlign: 'center' as const
  },
  orgLogo: {
    width: '80px',
    height: '80px',
    borderRadius: '8px',
    margin: '0 auto 12px',
    display: 'block',
    objectFit: 'cover' as const
  },
  orgName: {
    margin: '0 0 8px 0',
    fontSize: '20px',
    fontWeight: 'bold'
  },
  orgType: {
    fontSize: '13px',
    color: '#666',
    textTransform: 'capitalize' as const,
    marginBottom: '12px'
  },
  orgDesc: {
    fontSize: '13px',
    lineHeight: '1.5',
    margin: '12px 0',
    color: '#333'
  },
  orgContact: {
    fontSize: '12px',
    color: '#666',
    textAlign: 'left' as const,
    marginTop: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
    marginBottom: '16px'
  },
  statCard: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '4px',
    padding: '20px',
    textAlign: 'center' as const
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 'bold',
    fontFamily: 'monospace'
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    marginTop: '8px',
    textTransform: 'uppercase' as const
  },
  teamList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  teamCard: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '4px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  avatar: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    objectFit: 'cover' as const,
    border: '2px solid #c0c0c0'
  },
  memberInfo: {
    flex: 1
  },
  memberName: {
    fontSize: '15px',
    fontWeight: 'bold',
    marginBottom: '2px'
  },
  memberEmail: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '4px'
  },
  memberRole: {
    fontSize: '11px',
    color: '#000080',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const
  },
  vehicleList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  vehicleCard: {
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '4px',
    padding: '16px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  vehicleName: {
    fontSize: '14px',
    fontWeight: 'bold'
  },
  vehicleValue: {
    fontSize: '14px',
    fontFamily: 'monospace',
    color: '#008000'
  }
};

