import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import rbacService from '../../services/rbacService';
import type { UserRole, Permission } from '../../services/rbacService';
import RoleIndicator from './RoleIndicator';
import {
  Users, UserCheck, UserX, UserPlus, Shield, AlertTriangle,
  CheckCircle, XCircle, Clock, Eye, Edit, Trash2, MessageSquare,
  Star, Award, TrendingUp, Settings, Search, Filter
} from 'lucide-react';

interface RoleManagementInterfaceProps {
  vehicleId: string;
  ownerId: string;
  onClose?: () => void;
}

interface ContributorData {
  id: string;
  user_id: string;
  role: UserRole;
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  granted_at: string;
  granted_by: string;
  context_modifiers: any;
  custom_permissions?: Permission[];
  restrictions?: Permission[];
  notes?: string;
  user_profile?: {
    full_name?: string;
    email?: string;
    avatar_url?: string;
  };
  recent_activity?: any[];
  trust_score?: number;
}

interface RoleRequest {
  id: string;
  user_id: string;
  requested_role: UserRole;
  current_role?: UserRole;
  reason: string;
  evidence: any;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  user_profile?: {
    full_name?: string;
    email?: string;
    avatar_url?: string;
  };
}

const RoleManagementInterface: React.FC<RoleManagementInterfaceProps> = ({
  vehicleId,
  ownerId,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'contributors' | 'requests' | 'settings'>('contributors');
  const [contributors, setContributors] = useState<ContributorData[]>([]);
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState<UserRole | 'all'>('all');
  const [selectedContributor, setSelectedContributor] = useState<ContributorData | null>(null);

  useEffect(() => {
    loadData();
  }, [vehicleId]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadContributors(),
        loadRoleRequests()
      ]);
    } catch (error) {
      console.error('Error loading role management data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadContributors = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_user_relationships')
        .select(`
          *,
          user_profile:profiles!user_id (
            full_name,
            email,
            avatar_url
          )
        `)
        .eq('vehicle_id', vehicleId)
        .neq('user_id', ownerId) // Don't show owner in contributor list
        .order('granted_at', { ascending: false });

      if (error) throw error;

      // Enrich with trust scores and recent activity
      const enrichedData = await Promise.all(
        (data || []).map(async (contributor) => {
          // Get trust score
          const { data: trustData } = await supabase
            .from('trust_scores')
            .select('score')
            .eq('user_id', contributor.user_id)
            .eq('vehicle_id', vehicleId)
            .maybeSingle();

          // Get recent activity
          const { data: activityData } = await supabase
            .from('activity_log')
            .select('action, created_at')
            .eq('user_id', contributor.user_id)
            .eq('vehicle_id', vehicleId)
            .order('created_at', { ascending: false })
            .limit(5);

          return {
            ...contributor,
            trust_score: trustData?.score || 0,
            recent_activity: activityData || []
          };
        })
      );

      setContributors(enrichedData);
    } catch (error) {
      console.error('Error loading contributors:', error);
    }
  };

  const loadRoleRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('role_change_requests')
        .select(`
          *,
          user_profile:profiles!user_id (
            full_name,
            email,
            avatar_url
          )
        `)
        .eq('vehicle_id', vehicleId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRoleRequests(data || []);
    } catch (error) {
      console.error('Error loading role requests:', error);
    }
  };

  const handleApproveRequest = async (requestId: string, request: RoleRequest) => {
    try {
      // Update request status
      await supabase
        .from('role_change_requests')
        .update({ status: 'approved' })
        .eq('id', requestId);

      // Create or update user relationship
      const { error } = await supabase
        .from('vehicle_user_relationships')
        .upsert({
          vehicle_id: vehicleId,
          user_id: request.user_id,
          role: request.requested_role,
          status: 'active',
          granted_by: ownerId,
          granted_at: new Date().toISOString(),
          context_modifiers: {
            verificationLevel: 'email_verified',
            experienceLevel: 'experienced',
            trustScore: 30,
            contributionCount: 0,
            timeAsUser: 1
          }
        });

      if (error) throw error;

      await loadData();
      alert('Role request approved successfully!');
    } catch (error) {
      console.error('Error approving request:', error);
      alert('Failed to approve request');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await supabase
        .from('role_change_requests')
        .update({ status: 'rejected' })
        .eq('id', requestId);

      await loadRoleRequests();
      alert('Role request rejected');
    } catch (error) {
      console.error('Error rejecting request:', error);
      alert('Failed to reject request');
    }
  };

  const handleUpdateContributorRole = async (contributorId: string, newRole: UserRole) => {
    try {
      await supabase
        .from('vehicle_user_relationships')
        .update({ role: newRole })
        .eq('id', contributorId);

      await loadContributors();
      alert('Contributor role updated successfully!');
    } catch (error) {
      console.error('Error updating contributor role:', error);
      alert('Failed to update contributor role');
    }
  };

  const handleSuspendContributor = async (contributorId: string) => {
    try {
      await supabase
        .from('vehicle_user_relationships')
        .update({ status: 'suspended' })
        .eq('id', contributorId);

      await loadContributors();
      alert('Contributor suspended');
    } catch (error) {
      console.error('Error suspending contributor:', error);
      alert('Failed to suspend contributor');
    }
  };

  const handleRemoveContributor = async (contributorId: string) => {
    if (!confirm('Are you sure you want to remove this contributor?')) return;

    try {
      await supabase
        .from('vehicle_user_relationships')
        .update({ status: 'revoked' })
        .eq('id', contributorId);

      await loadContributors();
      alert('Contributor removed');
    } catch (error) {
      console.error('Error removing contributor:', error);
      alert('Failed to remove contributor');
    }
  };

  // Filter contributors based on search and role filter
  const filteredContributors = contributors.filter(contributor => {
    const matchesSearch = !searchTerm ||
      contributor.user_profile?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contributor.user_profile?.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = filterRole === 'all' || contributor.role === filterRole;

    return matchesSearch && matchesRole;
  });

  const renderContributorsTab = () => (
    <div>
      {/* Search and filter controls */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#6B7280'
          }} />
          <input
            type="text"
            placeholder="Search contributors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input"
            style={{ paddingLeft: '40px' }}
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value as UserRole | 'all')}
          className="form-input"
          style={{ minWidth: '150px' }}
        >
          <option value="all">All Roles</option>
          <option value="contributor">Contributor</option>
          <option value="restorer">Restorer</option>
          <option value="mechanic">Mechanic</option>
          <option value="appraiser">Appraiser</option>
          <option value="previous_owner">Previous Owner</option>
          <option value="photographer">Photographer</option>
          <option value="dealer">Dealer</option>
          <option value="moderator">Moderator</option>
        </select>
      </div>

      {/* Contributors list */}
      <div style={{ display: 'grid', gap: '16px' }}>
        {filteredContributors.map(contributor => (
          <div key={contributor.id} className="card">
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                {/* Avatar */}
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#6B7280'
                }}>
                  {contributor.user_profile?.avatar_url ? (
                    <img
                      src={contributor.user_profile.avatar_url}
                      alt="Avatar"
                      style={{ width: '100%', height: '100%', borderRadius: '50%' }}
                    />
                  ) : (
                    contributor.user_profile?.full_name?.charAt(0) || '?'
                  )}
                </div>

                {/* User info */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div className="text font-bold">
                      {contributor.user_profile?.full_name || contributor.user_profile?.email || 'Unknown User'}
                    </div>
                    <RoleIndicator
                      role={contributor.role}
                      trustScore={contributor.trust_score}
                      showTrustScore
                      size="small"
                    />
                    {contributor.status !== 'active' && (
                      <div className={`badge ${
                        contributor.status === 'pending' ? 'badge-warning' :
                        contributor.status === 'suspended' ? 'badge-error' :
                        'badge-secondary'
                      }`}>
                        {contributor.status}
                      </div>
                    )}
                  </div>

                  <div className="text text-sm text-muted" style={{ marginBottom: '8px' }}>
                    {contributor.user_profile?.email}
                  </div>

                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#6B7280' }}>
                    <span>Joined: {new Date(contributor.granted_at).toLocaleDateString()}</span>
                    <span>Trust: {contributor.trust_score}/100</span>
                    <span>Activity: {contributor.recent_activity?.length || 0} recent actions</span>
                  </div>

                  {contributor.notes && (
                    <div className="text text-sm" style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--bg)', borderRadius: '4px' }}>
                      {contributor.notes}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setSelectedContributor(contributor)}
                    className="button button-small button-secondary"
                    title="Edit permissions"
                  >
                    <Edit size={14} />
                  </button>

                  {contributor.status === 'active' ? (
                    <button
                      onClick={() => handleSuspendContributor(contributor.id)}
                      className="button button-small button-warning"
                      title="Suspend access"
                    >
                      <UserX size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateContributorRole(contributor.id, contributor.role)}
                      className="button button-small button-success"
                      title="Reactivate"
                    >
                      <UserCheck size={14} />
                    </button>
                  )}

                  <button
                    onClick={() => handleRemoveContributor(contributor.id)}
                    className="button button-small button-error"
                    title="Remove contributor"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {filteredContributors.length === 0 && (
          <div className="text-center text-muted" style={{ padding: '40px' }}>
            {contributors.length === 0 ? 'No contributors yet' : 'No contributors match your search'}
          </div>
        )}
      </div>
    </div>
  );

  const renderRequestsTab = () => (
    <div>
      <div style={{ display: 'grid', gap: '16px' }}>
        {roleRequests.map(request => (
          <div key={request.id} className="card">
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                {/* Avatar */}
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#6B7280'
                }}>
                  {request.user_profile?.avatar_url ? (
                    <img
                      src={request.user_profile.avatar_url}
                      alt="Avatar"
                      style={{ width: '100%', height: '100%', borderRadius: '50%' }}
                    />
                  ) : (
                    request.user_profile?.full_name?.charAt(0) || '?'
                  )}
                </div>

                {/* Request info */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div className="text font-bold">
                      {request.user_profile?.full_name || request.user_profile?.email || 'Unknown User'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {request.current_role && request.current_role !== 'viewer' && (
                        <>
                          <RoleIndicator role={request.current_role} size="small" />
                          <span>→</span>
                        </>
                      )}
                      <RoleIndicator role={request.requested_role} size="small" />
                    </div>
                  </div>

                  <div className="text text-sm text-muted" style={{ marginBottom: '8px' }}>
                    {request.user_profile?.email}
                  </div>

                  <div className="text text-sm" style={{ marginBottom: '8px' }}>
                    <strong>Reason:</strong> {request.reason}
                  </div>

                  {request.evidence && Object.keys(request.evidence).length > 0 && (
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>
                      <strong>Evidence:</strong> {Object.keys(request.evidence).join(', ')}
                    </div>
                  )}

                  <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '8px' }}>
                    Requested: {new Date(request.created_at).toLocaleDateString()}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleApproveRequest(request.id, request)}
                    className="button button-small button-success"
                    title="Approve request"
                  >
                    <CheckCircle size={14} />
                    Approve
                  </button>
                  <button
                    onClick={() => handleRejectRequest(request.id)}
                    className="button button-small button-error"
                    title="Reject request"
                  >
                    <XCircle size={14} />
                    Reject
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {roleRequests.length === 0 && (
          <div className="text-center text-muted" style={{ padding: '40px' }}>
            No pending role requests
          </div>
        )}
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Access Control Settings</div>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Auto-approve contributor requests</label>
            <input type="checkbox" className="form-checkbox" />
            <div className="form-help">
              Automatically approve basic contributor role requests from verified users
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Require approval for role upgrades</label>
            <input type="checkbox" className="form-checkbox" defaultChecked />
            <div className="form-help">
              Require owner approval when contributors request higher-level roles
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Trust score threshold for editing</label>
            <input type="range" min="0" max="100" defaultValue="30" className="form-input" />
            <div className="form-help">
              Minimum trust score required for editing permissions
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal modal-large">
          <div style={{ padding: '40px', textAlign: 'center' }}>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-large">
        <div className="modal-header">
          <div className="modal-title">
            <Users style={{ marginRight: '8px' }} />
            Manage Contributors
          </div>
          {onClose && (
            <button onClick={onClose} className="modal-close">×</button>
          )}
        </div>

        <div className="modal-body">
          {/* Tab navigation */}
          <div className="tab-nav" style={{ marginBottom: '24px' }}>
            <button
              className={`tab-button ${activeTab === 'contributors' ? 'active' : ''}`}
              onClick={() => setActiveTab('contributors')}
            >
              Contributors ({contributors.length})
            </button>
            <button
              className={`tab-button ${activeTab === 'requests' ? 'active' : ''}`}
              onClick={() => setActiveTab('requests')}
            >
              Requests ({roleRequests.length})
            </button>
            <button
              className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </button>
          </div>

          {/* Tab content */}
          {activeTab === 'contributors' && renderContributorsTab()}
          {activeTab === 'requests' && renderRequestsTab()}
          {activeTab === 'settings' && renderSettingsTab()}
        </div>
      </div>
    </div>
  );
};

export default RoleManagementInterface;