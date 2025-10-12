import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import OwnershipVerificationDashboard from '../components/admin/OwnershipVerificationDashboard';

interface PendingApproval {
  id: string;
  vehicle_id: string;
  user_id: string;
  user_email: string;
  requested_role: string;
  role_justification: string;
  created_at: string;
  year: number;
  make: string;
  model: string;
  shop_id?: string;
  shop_name?: string;
  uploaded_document_ids: string[];
}

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'reviews' | 'ownership' | 'todo' | 'analytics' | 'users'>('reviews');
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    checkAdminAndLoadData();
  }, []);

  const checkAdminAndLoadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/login');
        return;
      }

      setUserId(user.id);

      // Check if user is admin
      const { data: adminData } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();

      if (!adminData) {
        alert('Access denied: Admin privileges required');
        navigate('/dashboard');
        return;
      }

      setIsAdmin(true);
      await loadPendingApprovals();
    } catch (error) {
      console.error('Error checking admin status:', error);
      navigate('/dashboard');
    }
  };

  const loadPendingApprovals = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contributor_onboarding')
        .select(`
          *,
          vehicles(year, make, model),
          profiles(email),
          shops(name)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Transform data to match expected interface
      const transformedData = (data || []).map(item => ({
        id: item.id,
        vehicle_id: item.vehicle_id,
        user_id: item.user_id,
        user_email: item.profiles?.email || 'Unknown',
        requested_role: item.requested_role,
        role_justification: item.role_justification,
        created_at: item.created_at,
        year: item.vehicles?.year || 0,
        make: item.vehicles?.make || 'Unknown',
        model: item.vehicles?.model || 'Unknown',
        shop_id: item.shop_id,
        shop_name: item.shops?.name || null,
        uploaded_document_ids: item.uploaded_document_ids || []
      }));

      setApprovals(transformedData);
    } catch (error) {
      console.error('Error loading approvals:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (requestId: string, approve: boolean) => {
    if (!userId) return;

    try {
      // Update the contributor_onboarding status directly
      const { error: updateError } = await supabase
        .from('contributor_onboarding')
        .update({
          status: approve ? 'approved' : 'rejected',
          reviewed_by: userId,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId);

      if (updateError) throw updateError;

      // If approved, create the contributor role
      if (approve) {
        const approval = approvals.find(a => a.id === requestId);
        if (approval) {
          const { error: roleError } = await supabase
            .from('vehicle_contributor_roles')
            .insert({
              vehicle_id: approval.vehicle_id,
              user_id: approval.user_id,
              role: approval.requested_role,
              start_date: new Date().toISOString().split('T')[0],
              notes: `Approved by admin: ${approval.role_justification}`
            });

          if (roleError) throw roleError;
        }
      }

      alert(approve ? '✅ Request Approved!' : '❌ Request Rejected');
      await loadPendingApprovals();
    } catch (error) {
      console.error('Error processing approval:', error);
      alert('Error processing request');
    }
  };

  if (!isAdmin) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '24px', fontSize: '28px', fontWeight: '700' }}>Admin Dashboard</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e5e7eb', marginBottom: '24px' }}>
        {(['reviews', 'ownership', 'todo', 'analytics', 'users'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? '600' : '400',
              color: activeTab === tab ? '#3b82f6' : '#6b7280',
              position: 'relative',
              marginBottom: '-2px'
            }}
          >
            {tab === 'ownership' ? 'Ownership Verifications' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'reviews' && approvals.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                backgroundColor: '#ef4444',
                color: 'white',
                borderRadius: '10px',
                padding: '2px 6px',
                fontSize: '11px',
                fontWeight: '700'
              }}>
                {approvals.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Reviews Tab */}
      {activeTab === 'reviews' && (
        <div>
          <h2 style={{ marginBottom: '16px', fontSize: '20px', fontWeight: '600' }}>
            Pending Contributor Approvals
          </h2>

          {loading ? (
            <div>Loading...</div>
          ) : approvals.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
              No pending approvals
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {approvals.map((approval) => (
                <div
                  key={approval.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '20px',
                    backgroundColor: 'white'
                  }}
                >
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
                      {approval.year} {approval.make} {approval.model}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      {approval.user_email} • {approval.requested_role.replace(/_/g, ' ')}
                      {approval.shop_name && (
                        <span style={{ marginLeft: '8px', color: '#3b82f6' }}>
                          via {approval.shop_name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>Justification:</div>
                    <div style={{ fontSize: '14px', color: '#374151' }}>{approval.role_justification}</div>
                  </div>

                  {approval.uploaded_document_ids && approval.uploaded_document_ids.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '4px' }}>
                        Documents: {approval.uploaded_document_ids.length}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleApproval(approval.id, true)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleApproval(approval.id, false)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => navigate(`/vehicles/${approval.vehicle_id}`)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'white',
                        color: '#374151',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      View Vehicle
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ownership Tab */}
      {activeTab === 'ownership' && (
        <div>
          <OwnershipVerificationDashboard />
        </div>
      )}

      {/* Todo Tab */}
      {activeTab === 'todo' && (
        <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
          Admin task management coming soon
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
          Platform analytics coming soon
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
          User management coming soon
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
