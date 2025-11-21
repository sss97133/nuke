import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface Notification {
  id: string;
  organization_id: string;
  organization_vehicle_id: string;
  verification_id: string | null;
  notification_type: string;
  message: string;
  priority: string;
  status: string;
  assigned_to_user_id: string;
  created_at: string;
  vehicle_relationship_verifications?: {
    id: string;
    verification_type: string;
    proposed_relationship_type: string | null;
    proposed_status: string | null;
    proof_type: string | null;
    proof_url: string | null;
    notes: string | null;
  };
  organization_vehicles?: {
    vehicle_id: string;
    vehicles: {
      year: number;
      make: string;
      model: string;
    };
  };
}

interface Props {
  organizationId: string;
  userId: string | null;
}

const OrganizationNotifications: React.FC<Props> = ({ organizationId, userId }) => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread' | 'pending'>('unread');

  useEffect(() => {
    if (userId) {
      loadNotifications();
    }
  }, [organizationId, userId, filter]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('organization_vehicle_notifications')
        .select(`
          id,
          organization_id,
          organization_vehicle_id,
          verification_id,
          notification_type,
          message,
          priority,
          status,
          assigned_to_user_id,
          created_at,
          vehicle_relationship_verifications (
            id,
            verification_type,
            proposed_relationship_type,
            proposed_status,
            proof_type,
            proof_url,
            notes
          ),
          organization_vehicles (
            vehicle_id,
            vehicles (
              year,
              make,
              model
            )
          )
        `)
        .eq('organization_id', organizationId)
        .eq('assigned_to_user_id', userId || '');

      if (filter === 'unread') {
        query = query.eq('status', 'unread');
      } else if (filter === 'pending') {
        query = query.or('status.eq.unread,status.eq.read');
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    await supabase
      .from('organization_vehicle_notifications')
      .update({ 
        status: 'read',
        read_at: new Date().toISOString()
      })
      .eq('id', notificationId);
    
    loadNotifications();
  };

  const handleVerificationAction = async (verificationId: string, action: 'approve' | 'reject') => {
    try {
      const { error } = await supabase
        .from('vehicle_relationship_verifications')
        .update({
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewed_by_user_id: userId,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', verificationId);

      if (error) throw error;
      loadNotifications();
    } catch (error) {
      console.error('Failed to update verification:', error);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', fontSize: '9pt', color: 'var(--text-muted)' }}>Loading notifications...</div>;
  }

  const unreadCount = notifications.filter(n => n.status === 'unread').length;

  return (
    <div style={{ padding: '16px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h3 style={{ fontSize: '12pt', fontWeight: 700, margin: 0 }}>
          Notifications {unreadCount > 0 && `(${unreadCount})`}
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['all', 'unread', 'pending'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '4px 8px',
                fontSize: '7pt',
                border: filter === f ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: filter === f ? 'rgba(var(--accent-rgb), 0.1)' : 'white',
                cursor: 'pointer',
                borderRadius: '3px'
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          fontSize: '9pt',
          color: 'var(--text-muted)'
        }}>
          No notifications
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {notifications.map(notif => {
            const verification = notif.vehicle_relationship_verifications;
            const vehicle = notif.organization_vehicles?.vehicles;
            const isUnread = notif.status === 'unread';

            return (
              <div
                key={notif.id}
                style={{
                  padding: '12px',
                  border: '2px solid var(--border)',
                  borderRadius: '4px',
                  background: isUnread ? 'rgba(var(--accent-rgb), 0.05)' : 'var(--surface)',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  if (isUnread) markAsRead(notif.id);
                  if (vehicle) {
                    navigate(`/vehicle/${notif.organization_vehicles?.vehicle_id}`);
                  }
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '9pt',
                      fontWeight: isUnread ? 700 : 600,
                      marginBottom: '4px'
                    }}>
                      {vehicle && `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                      {notif.message}
                    </div>
                    {verification && (
                      <div style={{
                        marginTop: '8px',
                        padding: '8px',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '3px',
                        fontSize: '7pt'
                      }}>
                        {verification.proof_url && (
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Proof:</strong>{' '}
                            <a href={verification.proof_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              {verification.proof_type === 'bat_url' ? 'BAT Listing' : verification.proof_type}
                            </a>
                          </div>
                        )}
                        {verification.notes && (
                          <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
                            {verification.notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {isUnread && (
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      flexShrink: 0,
                      marginLeft: '8px'
                    }} />
                  )}
                </div>

                {verification && notif.status !== 'resolved' && (
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    marginTop: '8px',
                    justifyContent: 'flex-end'
                  }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleVerificationAction(verification.id, 'reject')}
                      style={{
                        padding: '4px 8px',
                        fontSize: '7pt',
                        border: '1px solid var(--border)',
                        background: 'white',
                        cursor: 'pointer',
                        borderRadius: '3px'
                      }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleVerificationAction(verification.id, 'approve')}
                      style={{
                        padding: '4px 8px',
                        fontSize: '7pt',
                        border: 'none',
                        background: 'var(--accent)',
                        color: 'white',
                        cursor: 'pointer',
                        borderRadius: '3px',
                        fontWeight: 600
                      }}
                    >
                      Approve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrganizationNotifications;

