import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';

interface CollaborationNotification {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  action_url: string | null;
  action_label: string | null;
  priority: string;
  status: string;
  created_at: string;
  metadata: any;
  vehicle_id: string | null;
  organization_id: string | null;
}

interface Props {
  userId: string;
  organizationId?: string;
  limit?: number;
  showAll?: boolean;
}

export default function CollaborationNotifications({ userId, organizationId, limit = 10, showAll = false }: Props) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<CollaborationNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('unread');

  useEffect(() => {
    loadNotifications();
    
    // Subscribe to new notifications
    const channel = supabase
      .channel('collaboration_notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_notifications',
          filter: `user_id=eq.${userId}`
        },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, organizationId, filter]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('collaboration_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      if (filter === 'unread') {
        query = query.in('status', ['pending', 'sent']);
      } else if (filter === 'urgent') {
        query = query.in('priority', ['high', 'urgent']);
      }

      if (!showAll && limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await supabase
        .from('collaboration_notifications')
        .update({ status: 'read', read_at: new Date().toISOString() })
        .eq('id', notificationId);
      
      loadNotifications();
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const handleAction = async (notification: CollaborationNotification) => {
    // Mark as acted
    try {
      await supabase
        .from('collaboration_notifications')
        .update({ status: 'acted', acted_at: new Date().toISOString() })
        .eq('id', notification.id);
    } catch (error) {
      console.error('Failed to update notification:', error);
    }

    // Navigate to action URL
    if (notification.action_url) {
      navigate(notification.action_url);
    }
  };

  const dismissNotification = async (notificationId: string) => {
    try {
      await supabase
        .from('collaboration_notifications')
        .update({ status: 'dismissed' })
        .eq('id', notificationId);
      
      loadNotifications();
    } catch (error) {
      console.error('Failed to dismiss notification:', error);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return '#dc2626';
      case 'high': return '#ea580c';
      case 'normal': return '#2563eb';
      case 'low': return '#64748b';
      default: return '#64748b';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'URGENT';
      case 'high': return 'HIGH PRIORITY';
      case 'normal': return '';
      case 'low': return 'Low Priority';
      default: return '';
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'verify_responsibility': return '👤';
      case 'collaboration_invite': return '🤝';
      case 'responsibility_transfer': return '📋';
      case 'data_quality_check': return '🔍';
      case 'missing_vin': return '⚠️';
      case 'invalid_vin': return '❌';
      case 'assignment_needed': return '📍';
      default: return '📬';
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading notifications...
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>📬</div>
        <div style={{ fontSize: '10pt' }}>No notifications</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Filter tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        borderBottom: '2px solid var(--border-primary)',
        paddingBottom: '8px'
      }}>
        <button
          onClick={() => setFilter('unread')}
          style={{
            padding: '6px 12px',
            background: filter === 'unread' ? 'var(--primary)' : 'transparent',
            color: filter === 'unread' ? 'white' : 'var(--text-primary)',
            border: '2px solid var(--border-primary)',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '9pt',
            fontWeight: 600
          }}
        >
          Unread
        </button>
        <button
          onClick={() => setFilter('urgent')}
          style={{
            padding: '6px 12px',
            background: filter === 'urgent' ? 'var(--primary)' : 'transparent',
            color: filter === 'urgent' ? 'white' : 'var(--text-primary)',
            border: '2px solid var(--border-primary)',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '9pt',
            fontWeight: 600
          }}
        >
          Urgent
        </button>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '6px 12px',
            background: filter === 'all' ? 'var(--primary)' : 'transparent',
            color: filter === 'all' ? 'white' : 'var(--text-primary)',
            border: '2px solid var(--border-primary)',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '9pt',
            fontWeight: 600
          }}
        >
          All
        </button>
      </div>

      {/* Notifications list */}
      {notifications.map((notification) => (
        <div
          key={notification.id}
          style={{
            padding: '16px',
            border: '2px solid var(--border-primary)',
            borderRadius: '6px',
            background: notification.status === 'pending' || notification.status === 'sent' 
              ? 'var(--surface-primary)' 
              : 'var(--surface-secondary)',
            opacity: notification.status === 'read' || notification.status === 'dismissed' ? 0.6 : 1
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
              <span style={{ fontSize: '20px' }}>{getNotificationIcon(notification.notification_type)}</span>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '10pt',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '4px'
                }}>
                  {notification.title}
                </div>
                {getPriorityLabel(notification.priority) && (
                  <span style={{
                    fontSize: '7pt',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '3px',
                    background: getPriorityColor(notification.priority),
                    color: 'white'
                  }}>
                    {getPriorityLabel(notification.priority)}
                  </span>
                )}
              </div>
            </div>
            
            {/* Time */}
            <div style={{
              fontSize: '8pt',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap'
            }}>
              {new Date(notification.created_at).toLocaleDateString()}
            </div>
          </div>

          {/* Message */}
          <div style={{
            fontSize: '9pt',
            color: 'var(--text-secondary)',
            marginBottom: '12px',
            lineHeight: 1.5
          }}>
            {notification.message}
          </div>

          {/* Vehicle info if available */}
          {notification.metadata?.vehicle && (
            <div style={{
              fontSize: '8pt',
              padding: '8px',
              background: 'var(--surface-secondary)',
              borderRadius: '3px',
              marginBottom: '12px',
              color: 'var(--text-muted)'
            }}>
              <strong>Vehicle:</strong> {notification.metadata.vehicle.year} {notification.metadata.vehicle.make} {notification.metadata.vehicle.model}
              {notification.metadata.vehicle.vin && (
                <span style={{ marginLeft: '8px', fontFamily: 'monospace' }}>
                  VIN: {notification.metadata.vehicle.vin}
                  {notification.metadata.vehicle.vin_is_valid === false && (
                    <span style={{ color: '#dc2626', marginLeft: '4px' }}>❌ INVALID</span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {notification.action_url && notification.action_label && (
              <button
                onClick={() => handleAction(notification)}
                style={{
                  padding: '8px 16px',
                  background: getPriorityColor(notification.priority),
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '9pt',
                  fontWeight: 600
                }}
              >
                {notification.action_label}
              </button>
            )}
            
            {(notification.status === 'pending' || notification.status === 'sent') && (
              <>
                <button
                  onClick={() => markAsRead(notification.id)}
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '2px solid var(--border-primary)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '9pt',
                    fontWeight: 600
                  }}
                >
                  Mark Read
                </button>
                
                <button
                  onClick={() => dismissNotification(notification.id)}
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: '2px solid var(--border-primary)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '9pt'
                  }}
                >
                  Dismiss
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

