import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../styles/unified-design-system.css';

interface Affiliation {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_type: string;
  role: string;
  status: string;
  start_date: string;
  end_date?: string;
  contribution_count: number;
  logo_url?: string;
  /** The relation's weight now, from user_org_relations: kept warm only by contributions, dormant a day after the last. */
  relation?: Relation;
}

interface Relation {
  state: 'live' | 'stalling' | 'dormant' | string;
  weight: number;
  last_contribution_at: string | null;
}

interface OrganizationAffiliationsProps {
  userId: string;
  isOwnProfile: boolean;
}

const OrganizationAffiliations: React.FC<OrganizationAffiliationsProps> = ({ userId, isOwnProfile }) => {
  const [affiliations, setAffiliations] = useState<Affiliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadAffiliations();
  }, [userId]);

  const loadAffiliations = async () => {
    try {
      setLoading(true);

      // Membership rows, and the relation weights the server computes from contributions (owner, 2026-10-15:
      // "active cant be a hard code like it is. its a weight."). A failed weight read leaves the badge at MEMBER.
      const relationsRead = supabase.rpc('user_org_relations', { p_user_id: userId });
      const { data, error } = await supabase
        .from('organization_contributors')
        .select(`
          id,
          organization_id,
          role,
          status,
          start_date,
          end_date,
          contribution_count,
          businesses!inner(
            business_name,
            business_type,
            logo_url
          )
        `)
        .eq('user_id', userId)
        .order('start_date', { ascending: false });

      if (error) throw error;

      const { data: relationsData, error: relationsError } = await relationsRead;
      if (relationsError) console.error('Error loading relation weights:', relationsError);
      const relations = new Map<string, Relation>(
        ((relationsData as any)?.relations || []).map((r: any) => [r.organization_id, r.relation as Relation])
      );

      const mapped: Affiliation[] = (data || []).map((a: any) => ({
        id: a.id,
        organization_id: a.organization_id,
        organization_name: a.businesses.business_name,
        organization_type: a.businesses.business_type,
        role: a.role,
        status: a.status,
        start_date: a.start_date,
        end_date: a.end_date,
        contribution_count: a.contribution_count || 0,
        logo_url: a.businesses.logo_url,
        relation: relations.get(a.organization_id)
      }));

      setAffiliations(mapped);
      setLoading(false);
    } catch (error: any) {
      console.error('Error loading affiliations:', error);
      setLoading(false);
    }
  };

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
        return 'var(--success)';
      case 'manager':
      case 'board_member':
        return 'var(--accent)';
      case 'employee':
      case 'technician':
        return 'var(--warning)';
      case 'contractor':
        return '#ff00ff';
      default:
        return 'var(--text-secondary)';
    }
  };

  // An ended or pending membership says so; a current one shows its relation's weight, never a hard-coded ACTIVE.
  const getStatusBadge = (affiliation: Affiliation) => {
    switch (affiliation.status) {
      case 'inactive':
        return { text: 'PAST', color: 'var(--text-secondary)', title: 'Membership ended' };
      case 'pending':
        return { text: 'PENDING', color: 'var(--warning)', title: 'Membership pending' };
    }
    const r = affiliation.relation;
    const last = r?.last_contribution_at
      ? `Last contribution ${new Date(r.last_contribution_at).toLocaleString()}`
      : 'Nothing in the last 2 days';
    switch (r?.state) {
      case 'live':
        return { text: 'LIVE', color: 'var(--success)', title: last };
      case 'stalling':
        return { text: 'STALLING', color: 'var(--warning)', title: last };
      case 'dormant':
        return { text: 'DORMANT', color: 'var(--text-secondary)', title: last };
      default:
        return { text: 'MEMBER', color: 'var(--text-secondary)', title: 'Relation weight unavailable' };
    }
  };

  const updateAffiliation = async (affiliationId: string, updates: { role?: string; status?: string }) => {
    try {
      setSaving(true);
      
      const { error } = await supabase
        .from('organization_contributors')
        .update(updates)
        .eq('id', affiliationId);

      if (error) throw error;

      await loadAffiliations();
      setEditingId(null);
    } catch (error: any) {
      console.error('Error updating affiliation:', error);
      alert('Failed to update affiliation');
    } finally {
      setSaving(false);
    }
  };

  const removeAffiliation = async (affiliationId: string) => {
    if (!confirm('Remove this affiliation?')) return;
    
    try {
      setSaving(true);
      
      const { error } = await supabase
        .from('organization_contributors')
        .delete()
        .eq('id', affiliationId);

      if (error) throw error;

      await loadAffiliations();
    } catch (error: any) {
      console.error('Error removing affiliation:', error);
      alert('Failed to remove affiliation');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading affiliations...
      </div>
    );
  }

  if (affiliations.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: '18px', marginBottom: '10px' }}>
          {isOwnProfile ? 'No Organization Affiliations' : 'Not affiliated with any organizations'}
        </div>
        {isOwnProfile && (
          <div style={{ fontSize: '14px', marginBottom: '20px' }}>
            Join or create an organization to collaborate
          </div>
        )}
        {isOwnProfile && (
          <Link
            to="/org"
            className="cursor-button"
            style={{ textDecoration: 'none', color: 'inherit', padding: '10px 20px' }}
          >
            Browse Organizations
          </Link>
        )}
      </div>
    );
  }

  const ROLE_OPTIONS = [
    'owner', 'co_founder', 'board_member', 'manager', 'employee', 
    'technician', 'contractor', 'moderator', 'contributor', 
    'photographer', 'historian'
  ];

  return (
    <div style={{ padding: '0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--text)', backgroundColor: 'var(--bg)' }}>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>ORGANIZATION</th>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>ROLE</th>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>STATUS</th>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>START DATE</th>
            {isOwnProfile && <th style={{ padding: '8px', textAlign: 'center', fontSize: '10px', fontWeight: 'bold' }}>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {affiliations.map(affiliation => {
            const statusBadge = getStatusBadge(affiliation);
            const isEditing = editingId === affiliation.id;
            
            return (
              <tr
                key={affiliation.id}
                style={{
                  borderBottom: '1px solid var(--border)',
                  cursor: !isEditing ? 'pointer' : 'default'
                }}
                onClick={() => !isEditing && navigate(`/org/${affiliation.organization_id}`)}
              >
                <td style={{ padding: '12px 8px' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {affiliation.organization_name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {affiliation.organization_type?.replace(/_/g, ' ')}
                  </div>
                </td>
                <td style={{ padding: '12px 8px' }}>
                  {isEditing && isOwnProfile ? (
                    <select
                      value={affiliation.role}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateAffiliation(affiliation.id, { role: e.target.value });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={saving}
                      style={{
                        fontSize: '12px',
                        color: getRoleColor(affiliation.role),
                        fontWeight: 'bold',
                        padding: '4px 6px',
                        backgroundColor: 'var(--surface)',
                        border: '1px solid ' + getRoleColor(affiliation.role), cursor: saving ? 'wait' : 'pointer'
                      }}
                    >
                      {ROLE_OPTIONS.map(role => (
                        <option key={role} value={role}>
                          {formatRole(role)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ 
                      fontSize: '12px', 
                      color: getRoleColor(affiliation.role),
                      fontWeight: 'bold'
                    }}>
                      {formatRole(affiliation.role)}
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 8px' }}>
                  {isEditing && isOwnProfile ? (
                    <select
                      value={affiliation.status}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateAffiliation(affiliation.id, { status: e.target.value });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      disabled={saving}
                      style={{
                        fontSize: '10px',
                        fontWeight: 'bold',
                        padding: '3px 6px',
                        backgroundColor: statusBadge.color,
                        color: statusBadge.color === 'var(--warning)' ? 'var(--text)' : 'var(--bg)',
                        border: 'none', cursor: saving ? 'wait' : 'pointer'
                      }}
                    >
                      <option value="active">CURRENT</option>
                      <option value="inactive">PAST</option>
                      <option value="pending">PENDING</option>
                    </select>
                  ) : (
                    <span title={statusBadge.title} style={{
                      fontSize: '10px',
                      fontWeight: 'bold',
                      padding: '3px 6px',
                      backgroundColor: statusBadge.color,
                      color: statusBadge.color === 'var(--warning)' ? 'var(--text)' : 'var(--bg)'}}>
                      {statusBadge.text}
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {new Date(affiliation.start_date).toLocaleDateString()}
                </td>
                {isOwnProfile && (
                  <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                    {!isEditing ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(affiliation.id);
                        }}
                        className="cursor-button"
                        style={{ 
                          padding: '4px 10px', 
                          fontSize: '10px',
                          backgroundColor: 'var(--accent)'
                        }}
                      >
                        EDIT
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(null);
                          }}
                          className="cursor-button"
                          style={{ 
                            padding: '4px 8px', 
                            fontSize: '10px',
                            backgroundColor: 'var(--text-secondary)'
                          }}
                          disabled={saving}
                        >
                          DONE
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAffiliation(affiliation.id);
                          }}
                          className="cursor-button"
                          style={{ 
                            padding: '4px 8px', 
                            fontSize: '10px',
                            backgroundColor: 'var(--error)'
                          }}
                          disabled={saving}
                        >
                          DELETE
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default OrganizationAffiliations;

