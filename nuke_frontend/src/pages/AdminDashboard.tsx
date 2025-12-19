import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import OwnershipVerificationDashboard from '../components/admin/OwnershipVerificationDashboard';
import AdminAnalytics from './AdminAnalytics';
import CraigslistQueueDashboard from '../components/admin/CraigslistQueueDashboard';
import { IDHoverCard } from '../components/admin';
import '../design-system.css';

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
  const [activeTab, setActiveTab] = useState<'reviews' | 'ownership' | 'todo' | 'analytics' | 'users' | 'processing' | 'tables' | 'cl-scraping'>('reviews');
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
        navigate('/org/dashboard');
        return;
      }

      setIsAdmin(true);
      await loadPendingApprovals();
    } catch (error) {
      console.error('Error checking admin status:', error);
      navigate('/org/dashboard');
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

      alert(approve ? 'Request Approved' : 'Request Rejected');
      await loadPendingApprovals();
    } catch (error) {
      console.error('Error processing approval:', error);
      alert('Error processing request');
    }
  };

  if (!isAdmin) {
    return <div style={{ padding: '40px', textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="button button-secondary cursor-button"
            style={{ 
              marginBottom: '16px',
              fontSize: '8pt', 
              padding: '6px 12px',
              border: '2px solid var(--border-light)',
              transition: 'all 0.12s ease'
            }}
          >
            ← Back to Mission Control
          </button>
          <h1 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Legacy Admin Dashboard
          </h1>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Manage user approvals and legacy verification requests
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid var(--border-light)', marginBottom: '24px' }}>
        {(['reviews', 'ownership', 'todo', 'analytics', 'users', 'tables', 'cl-scraping'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? '700' : '400',
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
              position: 'relative',
              marginBottom: '-2px',
              fontSize: '8pt',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              transition: 'all 0.12s ease'
            }}
          >
            {tab === 'ownership' ? 'OWNERSHIP VERIFICATIONS' : 
             tab === 'tables' ? 'TABLE STATUS' :
             tab === 'cl-scraping' ? 'CL SCRAPING' :
             tab.toUpperCase()}
            {tab === 'reviews' && approvals.length > 0 && (
              <span style={{
                marginLeft: '8px',
                backgroundColor: 'var(--error)',
                color: 'white',
                borderRadius: '2px',
                padding: '1px 4px',
                fontSize: '8pt',
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
          <h2 style={{ marginBottom: '16px', fontSize: '8pt', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            PENDING CONTRIBUTOR APPROVALS
          </h2>

          {loading ? (
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Loading...</div>
          ) : approvals.length === 0 ? (
            <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', borderStyle: 'dashed' }}>
              <div style={{ fontSize: '8pt' }}>No pending approvals</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {approvals.map((approval) => (
                <div
                  key={approval.id}
                  className="card"
                  style={{ padding: '20px' }}
                >
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '10pt', fontWeight: '700', marginBottom: '4px' }}>
                      {approval.year} {approval.make} {approval.model}
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {approval.user_email} • {approval.requested_role.replace(/_/g, ' ')}
                      {approval.shop_name && (
                        <span style={{ marginLeft: '8px', color: 'var(--accent)' }}>
                          via {approval.shop_name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', border: '1px solid var(--border-light)' }}>
                    <div style={{ fontWeight: '700', marginBottom: '4px', fontSize: '8pt' }}>JUSTIFICATION</div>
                    <div style={{ fontSize: '8pt', color: 'var(--text)' }}>{approval.role_justification}</div>
                  </div>

                  {approval.uploaded_document_ids && approval.uploaded_document_ids.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '8pt', fontWeight: '700', marginBottom: '4px' }}>
                        DOCUMENTS: {approval.uploaded_document_ids.length}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleApproval(approval.id, true)}
                      className="button button-primary cursor-button"
                      style={{
                        padding: '8px 16px',
                        fontSize: '8pt',
                        backgroundColor: 'var(--success)',
                        borderColor: 'var(--success)'
                      }}
                    >
                      APPROVE
                    </button>
                    <button
                      onClick={() => handleApproval(approval.id, false)}
                      className="button button-secondary cursor-button"
                      style={{
                        padding: '8px 16px',
                        fontSize: '8pt',
                        color: 'var(--error)',
                        borderColor: 'var(--error)'
                      }}
                    >
                      REJECT
                    </button>
                    <button
                      onClick={() => navigate(`/vehicles/${approval.vehicle_id}`)}
                      className="button button-secondary cursor-button"
                      style={{
                        padding: '8px 16px',
                        fontSize: '8pt'
                      }}
                    >
                      VIEW VEHICLE
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
        <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', borderStyle: 'dashed' }}>
          <div style={{ fontSize: '8pt' }}>Admin task management coming soon</div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <AdminAnalytics />
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="card" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', borderStyle: 'dashed' }}>
          <div style={{ fontSize: '8pt' }}>User management coming soon</div>
        </div>
      )}

      {/* CL Scraping Tab */}
      {activeTab === 'cl-scraping' && (
        <CraigslistQueueDashboard />
      )}
    </div>
  );
};

export default AdminDashboard;