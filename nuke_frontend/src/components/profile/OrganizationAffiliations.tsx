import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

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
        logo_url: a.businesses.logo_url
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
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        Loading affiliations...
      </div>
    );
  }

  if (affiliations.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        <div style={{ fontSize: '18px', marginBottom: '10px' }}>
          {isOwnProfile ? 'No Organization Affiliations' : 'Not affiliated with any organizations'}
        </div>
        {isOwnProfile && (
          <div style={{ fontSize: '14px', marginBottom: '20px' }}>
            Join or create an organization to collaborate
          </div>
        )}
        {isOwnProfile && (
          <button
            onClick={() => navigate('/organizations')}
            className="cursor-button"
            style={{ padding: '10px 20px' }}
          >
            Browse Organizations
          </button>
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
          <tr style={{ borderBottom: '2px solid #000', backgroundColor: 'var(--bg)' }}>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>ORGANIZATION</th>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>ROLE</th>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>STATUS</th>
            <th style={{ padding: '8px', textAlign: 'left', fontSize: '10px', fontWeight: 'bold' }}>START DATE</th>
            {isOwnProfile && <th style={{ padding: '8px', textAlign: 'center', fontSize: '10px', fontWeight: 'bold' }}>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {affiliations.map(affiliation => {
            const statusBadge = getStatusBadge(affiliation.status);
            const isEditing = editingId === affiliation.id;
            
            return (
              <tr
                key={affiliation.id}
                style={{
                  borderBottom: '1px solid #ddd',
                  cursor: !isEditing ? 'pointer' : 'default'
                }}
                onClick={() => !isEditing && navigate(`/organizations/${affiliation.organization_id}`)}
              >
                <td style={{ padding: '12px 8px' }}>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {affiliation.organization_name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#666' }}>
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
                        border: '1px solid ' + getRoleColor(affiliation.role),
                        borderRadius: '3px',
                        cursor: saving ? 'wait' : 'pointer'
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
                        color: statusBadge.color === '#ffff00' ? '#000' : '#fff',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: saving ? 'wait' : 'pointer'
                      }}
                    >
                      <option value="active">ACTIVE</option>
                      <option value="inactive">PAST</option>
                      <option value="pending">PENDING</option>
                    </select>
                  ) : (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 'bold',
                      padding: '3px 6px',
                      backgroundColor: statusBadge.color,
                      color: statusBadge.color === '#ffff00' ? '#000' : '#fff',
                      borderRadius: '3px'
                    }}>
                      {statusBadge.text}
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 8px', fontSize: '12px', color: '#666' }}>
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
                          backgroundColor: '#0000ff'
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
                            backgroundColor: '#666'
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
                            backgroundColor: '#ff0000'
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

