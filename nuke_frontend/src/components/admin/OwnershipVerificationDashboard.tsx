import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface OwnershipVerification {
  id: string;
  user_id: string;
  vehicle_id: string;
  verification_type: string;
  status: string;
  documents: any[];
  created_at: string;
  updated_at: string;
  profiles?: {
    full_name: string;
    email: string;
  };
  vehicle?: {
    year: number;
    make: string;
    model: string;
    vin?: string;
  };
}

const OwnershipVerificationDashboard = () => {
  const [user, setUser] = useState<any>(null);
  const [verifications, setVerifications] = useState<OwnershipVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'under_review' | 'approved' | 'rejected'>('pending');
  const [selectedVerification, setSelectedVerification] = useState<OwnershipVerification | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  // Check if user is admin (you can adjust this logic based on your admin system)
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (user) {
      checkAdminStatus();
    }
  }, [user]);

  useEffect(() => {
    if (isAdmin) {
      loadVerifications();
    }
  }, [isAdmin, filter]);

  const loadUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    } catch (error) {
      console.error('Error loading user:', error);
    }
  };

  const checkAdminStatus = async () => {
    if (!user) return;

    try {
      // Check if user has admin role in admin_users table
      const { data, error } = await supabase
        .from('admin_users')
        .select('admin_level, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();

      if (!error && data) {
        setIsAdmin(true);
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
    }
  };

  const loadVerifications = async () => {
    setLoading(true);

    try {
      // First, load basic ownership verifications
      let query = supabase
        .from('ownership_verifications')
        .select('*')
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data: ownershipData, error } = await query;

      if (error) {
        console.error('Error loading verifications:', error);
        setVerifications([]);
        return;
      }

      // Then fetch user and vehicle data separately to avoid join issues
      const verificationsWithDetails = await Promise.all(
        (ownershipData || []).map(async (verification) => {
          // Fetch user profile
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', verification.user_id)
            .single();

          // Fetch vehicle data
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('year, make, model, vin')
            .eq('id', verification.vehicle_id)
            .single();

          return {
            ...verification,
            profiles: profile,
            vehicle: vehicle
          };
        })
      );

      setVerifications(verificationsWithDetails);
    } catch (error) {
      console.error('Error loading verifications:', error);
      setVerifications([]);
    } finally {
      setLoading(false);
    }
  };

  const updateVerificationStatus = async (
    verificationId: string,
    newStatus: 'approved' | 'rejected' | 'under_review',
    notes?: string
  ) => {
    if (!user) return;

    setProcessing(verificationId);

    try {
      const { error } = await supabase
        .from('ownership_verifications')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', verificationId);

      if (error) {
        throw error;
      }

      // Create notification for the user
      const verification = verifications.find(v => v.id === verificationId);
      if (verification) {
        try {
          await supabase.rpc('create_notification', {
            recipient_id_param: verification.user_id,
            sender_id_param: user.id,
            type_param: 'account_update',
            title_param: newStatus === 'approved' ? 'Ownership Verified!' :
                        newStatus === 'rejected' ? 'Ownership Verification Rejected' :
                        'Ownership Under Review',
            body_param: newStatus === 'approved' ? 'Your ownership has been verified and you now have full access to your vehicle.' :
                        newStatus === 'rejected' ? 'Your ownership verification was rejected. Please check the review notes and resubmit if necessary.' :
                        'Your ownership documentation is being reviewed by our admin team.',
            entity_type_param: 'vehicle',
            entity_id_param: verification.vehicle_id,
            priority_param: newStatus === 'approved' ? 'high' : 'normal'
          });
        } catch (notifyError) {
          console.error('Error creating notification:', notifyError);
          // Don't fail the whole operation if notification fails
        }
      }

      // Reload verifications
      await loadVerifications();
      setSelectedVerification(null);

    } catch (error) {
      console.error('Error updating verification status:', error);
    } finally {
      setProcessing(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return '#166534';
      case 'rejected': return '#dc2626';
      case 'under_review': return '#d97706';
      case 'pending': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return 'APPROVED';
      case 'rejected': return 'REJECTED';
      case 'under_review': return 'REVIEW';
      case 'pending': return 'PENDING';
      default: return 'STATUS';
    }
  };

  if (!user) {
    return (
      <div style={{
        background: 'var(--bg)',
        border: '1px solid #bdbdbd',
        padding: '16px',
        margin: '16px',
        fontFamily: 'Arial, sans-serif',
        textAlign: 'center',
        fontSize: '8pt'
      }}>
        Please log in to access the admin dashboard.
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{
        background: '#f8d7da',
        border: '1px solid #f5c6cb',
        padding: '16px',
        margin: '16px',
        fontFamily: 'Arial, sans-serif',
        textAlign: 'center',
        fontSize: '8pt',
        color: '#721c24'
      }}>
        Access denied. Admin privileges required.
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)',
      fontFamily: 'Arial, sans-serif',
      padding: '12px'
    }}>

      {/* Filter Tabs */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '8px',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {(['all', 'pending', 'under_review', 'approved', 'rejected'] as const).map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              style={{
                padding: '4px 8px',
                fontSize: '8pt',
                border: '1px solid #bdbdbd',
                background: filter === status ? '#424242' : '#f5f5f5',
                color: filter === status ? 'white' : '#424242',
                borderRadius: '0px',
                cursor: 'pointer'
              }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
              ({verifications.filter(v => status === 'all' || v.status === status).length})
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          background: '#e7f3ff',
          border: '1px solid #b8daff',
          padding: '12px',
          textAlign: 'center',
          fontSize: '8pt',
          marginBottom: '12px'
        }}>
          Loading verifications...
        </div>
      )}

      {/* Verifications List */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        maxHeight: '600px',
        overflowY: 'auto'
      }}>
        {verifications.length === 0 && !loading ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            fontSize: '8pt',
            color: '#757575'
          }}>
            No {filter === 'all' ? '' : filter + ' '}verifications found
          </div>
        ) : (
          verifications.map(verification => (
            <div
              key={verification.id}
              style={{
                padding: '12px',
                borderBottom: '1px solid #e0e0e0',
                cursor: 'pointer',
                background: selectedVerification?.id === verification.id ? '#f8fafc' : 'white'
              }}
              onClick={() => setSelectedVerification(verification)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                  {verification.profiles?.full_name || 'Unknown User'}
                </div>
                <div style={{
                  background: getStatusColor(verification.status),
                  color: 'white',
                  padding: '2px 6px',
                  fontSize: '7pt',
                  fontWeight: 'bold'
                }}>
                  {getStatusIcon(verification.status)} {verification.status.toUpperCase()}
                </div>
              </div>

              <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                <strong>Vehicle:</strong> {verification.vehicle?.year} {verification.vehicle?.make} {verification.vehicle?.model}
                {verification.vehicle?.vin && <span> (VIN: {verification.vehicle.vin})</span>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7pt', color: '#757575' }}>
                <div>Type: {verification.verification_type}</div>
                <div>Submitted: {formatDate(verification.created_at)}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Verification Details Modal */}
      {selectedVerification && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            background: 'var(--surface)',
            border: '2px solid #bdbdbd',
            borderRadius: '0px',
            padding: '0px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
            fontFamily: 'Arial, sans-serif'
          }}>
            {/* Modal Header */}
            <div style={{
              background: '#e0e0e0',
              padding: '12px',
              borderBottom: '1px solid #bdbdbd',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                Ownership Verification Details
              </span>
              <button
                onClick={() => setSelectedVerification(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '12pt',
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '16px' }}>
              {/* User & Vehicle Info */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '8px' }}>
                  User Information
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Name:</strong> {selectedVerification.profiles?.full_name}
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Email:</strong> {selectedVerification.profiles?.email}
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Vehicle:</strong> {selectedVerification.vehicle?.year} {selectedVerification.vehicle?.make} {selectedVerification.vehicle?.model}
                </div>
                {selectedVerification.vehicle?.vin && (
                  <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                    <strong>VIN:</strong> {selectedVerification.vehicle.vin}
                  </div>
                )}
              </div>

              {/* Verification Details */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '8px' }}>
                  Verification Details
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Type:</strong> {selectedVerification.verification_type}
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Status:</strong> {selectedVerification.status}
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Submitted:</strong> {formatDate(selectedVerification.created_at)}
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Documents:</strong> {selectedVerification.documents?.length || 0} files
                </div>
              </div>

              {/* Action Buttons */}
              {selectedVerification.status === 'pending' && (
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <button
                    onClick={() => updateVerificationStatus(selectedVerification.id, 'under_review')}
                    disabled={processing === selectedVerification.id}
                    style={{
                      background: '#d97706',
                      color: 'white',
                      border: '1px solid #bdbdbd',
                      borderRadius: '0px',
                      padding: '6px 12px',
                      fontSize: '8pt',
                      cursor: processing === selectedVerification.id ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {processing === selectedVerification.id ? '...' : 'Review'}
                  </button>
                  <button
                    onClick={() => updateVerificationStatus(selectedVerification.id, 'approved')}
                    disabled={processing === selectedVerification.id}
                    style={{
                      background: '#166534',
                      color: 'white',
                      border: '1px solid #bdbdbd',
                      borderRadius: '0px',
                      padding: '6px 12px',
                      fontSize: '8pt',
                      cursor: processing === selectedVerification.id ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {processing === selectedVerification.id ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => updateVerificationStatus(selectedVerification.id, 'rejected', 'Additional documentation required')}
                    disabled={processing === selectedVerification.id}
                    style={{
                      background: '#dc2626',
                      color: 'white',
                      border: '1px solid #bdbdbd',
                      borderRadius: '0px',
                      padding: '6px 12px',
                      fontSize: '8pt',
                      cursor: processing === selectedVerification.id ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {processing === selectedVerification.id ? '...' : 'Reject'}
                  </button>
                </div>
              )}

              {selectedVerification.status === 'under_review' && (
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <button
                    onClick={() => updateVerificationStatus(selectedVerification.id, 'approved')}
                    disabled={processing === selectedVerification.id}
                    style={{
                      background: '#166534',
                      color: 'white',
                      border: '1px solid #bdbdbd',
                      borderRadius: '0px',
                      padding: '6px 12px',
                      fontSize: '8pt',
                      cursor: processing === selectedVerification.id ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {processing === selectedVerification.id ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => updateVerificationStatus(selectedVerification.id, 'rejected', 'Documentation insufficient')}
                    disabled={processing === selectedVerification.id}
                    style={{
                      background: '#dc2626',
                      color: 'white',
                      border: '1px solid #bdbdbd',
                      borderRadius: '0px',
                      padding: '6px 12px',
                      fontSize: '8pt',
                      cursor: processing === selectedVerification.id ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {processing === selectedVerification.id ? '...' : 'Reject'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OwnershipVerificationDashboard;