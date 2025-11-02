import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getRoleBadge } from '../../services/organizationPermissions';

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  contribution_count: number;
  start_date?: string;
  created_at: string;
  profiles: {
    full_name: string;
    email: string;
    avatar_url?: string;
  };
}

interface Props {
  organizationId: string;
  userId: string | null;
  canManageMembers: boolean;
}

const OrganizationMembersTab: React.FC<Props> = ({ organizationId, userId, canManageMembers }) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');

  useEffect(() => {
    loadMembers();
  }, [organizationId]);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const { data: rawData, error } = await supabase
        .from('organization_contributors')
        .select(`
          id,
          user_id,
          role,
          status,
          contribution_count,
          start_date,
          created_at
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Manually fetch profiles for each member
      const data = await Promise.all(
        (rawData || []).map(async (member) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, email, avatar_url')
            .eq('id', member.user_id)
            .single();

          return {
            ...member,
            profiles: profile || { full_name: 'Unknown', email: '', avatar_url: null }
          };
        })
      );

      setMembers(data || []);
    } catch (error) {
      console.error('Failed to load members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    try {
      // Find user by email
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', inviteEmail.toLowerCase().trim())
        .single();

      if (!profile) {
        alert('User not found with that email. They need to create an account first.');
        return;
      }

      // Add as contributor
      const { error } = await supabase
        .from('organization_contributors')
        .insert({
          organization_id: organizationId,
          user_id: profile.id,
          role: inviteRole,
          status: 'active',
          start_date: new Date().toISOString().split('T')[0]
        });

      if (error) {
        if (error.code === '23505') {
          alert('This user is already a member');
        } else {
          throw error;
        }
        return;
      }

      setInviteEmail('');
      setInviteRole('employee');
      await loadMembers();
      alert('Member added successfully!');
    } catch (error: any) {
      alert('Failed to add member: ' + error.message);
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (memberUserId === userId) {
      alert('You cannot remove yourself');
      return;
    }

    if (!confirm('Remove this member from the organization?')) return;

    try {
      const { error } = await supabase
        .from('organization_contributors')
        .delete()
        .eq('id', memberId);

      if (error) throw error;

      setMembers(members.filter(m => m.id !== memberId));
    } catch (error: any) {
      alert('Failed to remove member: ' + error.message);
    }
  };

  const handleChangeRole = async (memberId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('organization_contributors')
        .update({ role: newRole })
        .eq('id', memberId);

      if (error) throw error;

      await loadMembers();
    } catch (error: any) {
      alert('Failed to change role: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading members...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Invite Section (Owners Only) */}
      {canManageMembers && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
            Add Member
          </div>
          <div className="card-body">
            <form onSubmit={handleInvite}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                  required
                  style={{
                    flex: 1,
                    minWidth: '200px',
                    padding: '8px 12px',
                    fontSize: '9pt',
                    border: '1px solid var(--border)',
                    borderRadius: '4px'
                  }}
                />
                
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    fontSize: '9pt',
                    border: '1px solid var(--border)',
                    borderRadius: '4px'
                  }}
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="technician">Technician</option>
                  <option value="contributor">Contributor</option>
                  <option value="photographer">Photographer</option>
                </select>
                
                <button
                  type="submit"
                  disabled={inviting}
                  className="button button-primary"
                  style={{ fontSize: '9pt' }}
                >
                  {inviting ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Members List */}
      {members.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '40px',
            color: 'var(--text-muted)',
            fontSize: '9pt'
          }}>
            No members yet
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {members.map(member => {
            const badge = getRoleBadge(member.role);
            const isCurrentUser = member.user_id === userId;
            
            return (
              <div key={member.id} className="card">
                <div className="card-body">
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px'
                  }}>
                    {/* Member Info */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1 }}>
                      {/* Avatar */}
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: member.profiles.avatar_url 
                          ? `url(${member.profiles.avatar_url}) center/cover` 
                          : 'var(--grey-200)',
                        border: '2px solid var(--border)',
                        flexShrink: 0
                      }} />

                      {/* Name + Details */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '2px' }}>
                          {member.profiles.full_name}
                          {isCurrentUser && (
                            <span style={{
                              marginLeft: '8px',
                              fontSize: '7pt',
                              color: 'var(--text-muted)',
                              fontWeight: 400
                            }}>
                              (You)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          {member.profiles.email}
                        </div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {member.contribution_count} contributions
                          {member.start_date && ` • Joined ${new Date(member.start_date).toLocaleDateString()}`}
                        </div>
                      </div>
                    </div>

                    {/* Role + Actions */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      alignItems: 'flex-end'
                    }}>
                      {/* Role Badge/Selector */}
                      {canManageMembers && !isCurrentUser ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleChangeRole(member.id, e.target.value)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '7pt',
                            fontWeight: 700,
                            border: '1px solid var(--border)',
                            borderRadius: '3px',
                            background: badge.color,
                            color: 'white',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="owner">Owner</option>
                          <option value="manager">Manager</option>
                          <option value="employee">Employee</option>
                          <option value="technician">Technician</option>
                          <option value="contributor">Contributor</option>
                          <option value="photographer">Photographer</option>
                          <option value="historian">Historian</option>
                        </select>
                      ) : (
                        <div style={{
                          padding: '4px 8px',
                          background: badge.color,
                          color: 'white',
                          fontSize: '7pt',
                          fontWeight: 700,
                          borderRadius: '3px'
                        }}>
                          {badge.text}
                        </div>
                      )}

                      {/* Remove Button */}
                      {canManageMembers && !isCurrentUser && (
                        <button
                          onClick={() => handleRemoveMember(member.id, member.user_id)}
                          style={{
                            padding: '4px 12px',
                            fontSize: '7pt',
                            border: '1px solid var(--danger)',
                            background: 'white',
                            color: 'var(--danger)',
                            cursor: 'pointer',
                            borderRadius: '4px'
                          }}
                        >
                          REMOVE
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrganizationMembersTab;

