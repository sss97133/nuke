import React, { useState, useEffect, useRef } from 'react';
import { NotificationService, type Notification } from '../services/notificationService';

interface NotificationCenterProps {
  userId: string;
  onNotificationUpdate?: () => void;
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ userId, onNotificationUpdate }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  // Stable ref to avoid re-subscribing when callback identity changes
  const onNotificationUpdateRef = useRef(onNotificationUpdate);
  onNotificationUpdateRef.current = onNotificationUpdate;

  useEffect(() => {
    loadNotifications();

    // Subscribe to real-time notifications
    const subscription = NotificationService.subscribeToNotifications(userId, (newNotification) => {
      setNotifications(prev => [newNotification, ...prev]);
      onNotificationUpdateRef.current?.();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const data = await NotificationService.getUserNotifications(userId);
      setNotifications(data);
    } catch (error) {
      console.error('Error loading notifications:', error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    try {
      await NotificationService.markNotificationRead(notificationId);
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      onNotificationUpdate?.();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleRespond = async (notificationId: string, responseData: any) => {
    try {
      await NotificationService.respondToNotification(notificationId, responseData);
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_responded: true, is_read: true } : n)
      );
      onNotificationUpdate?.();
    } catch (error) {
      console.error('Error responding to notification:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'price_change': return '$';
      case 'new_listing': return 'CAR';
      case 'auction_result': return 'BID';
      case 'observation_added': return 'EYE';
      case 'vin_request': return 'VIN';
      case 'verification_request': return 'VERIFY';
      case 'contribution_request': return 'CONTRIB';
      case 'ownership_challenge': return 'ALERT';
      case 'data_correction': return 'EDIT';
      case 'photo_approval': return 'PHOTO';
      case 'timeline_contribution': return 'TIMELINE';
      case 'missing_image_dates': return 'DATES';
      case 'incomplete_profile': return 'PROFILE';
      default: return 'NTF';
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading notifications...</p>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: '48px 24px' }}>
          <h3 style={{ marginBottom: '8px' }}>No notifications</h3>
          <p className="text-small text-muted">
            You're all caught up! New notifications will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="notification-center">
      {notifications.map((notification) => (
        <div 
          key={notification.id} 
          style={{ 
            padding: '8px', 
            marginBottom: '8px', 
            border: '1px solid var(--border)',
            backgroundColor: (!notification.read && !notification.is_read) ? 'var(--bg-secondary)' : 'var(--surface)',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ 
              fontSize: '11px', 
              marginRight: '6px', 
              padding: '1px 4px',
              backgroundColor: 'var(--border)',
              fontWeight: 'bold'
            }}>
              {getNotificationIcon(notification.type)}
            </span>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: '12px' }}>{notification.title}</strong>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                {formatDate(notification.created_at)}
              </span>
            </div>
            {(!notification.read && !notification.is_read) && (
              <span style={{
                fontSize: '11px',
                fontWeight: 'bold',
                padding: '1px 4px',
                backgroundColor: 'var(--text-secondary)',
                color: 'var(--bg)'
              }}>
                NEW
              </span>
            )}
          </div>
          
          <div style={{ 
            marginBottom: '8px', 
            lineHeight: '1.3',
            fontSize: '12px',
            color: 'var(--text)'
          }}>
            {notification.message}
            {notification.type === 'incomplete_profile' && notification.metadata?.completion_percentage && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ 
                  background: 'var(--border)',
                  height: '6px',
                  border: '1px solid var(--border)',
                  marginTop: '4px'
                }}>
                  <div style={{ 
                    background: notification.metadata.completion_percentage < 50 ? 'var(--text-muted)' : 'var(--text-secondary)',
                    height: '100%', 
                    width: `${notification.metadata.completion_percentage}%`
                  }} />
                </div>
                <div style={{ 
                  marginTop: '2px',
                  fontSize: '11px',
                  color: 'var(--text-secondary)'
                }}>
                  {notification.metadata.completion_percentage}% Complete
                  {notification.metadata.missing_items && notification.metadata.missing_items.length > 0 && (
                    <span>
                      {' '}- Missing: {notification.metadata.missing_items.slice(0, 2).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {notification.type === 'missing_image_dates' && notification.metadata?.image_count && (
            <div style={{ 
              marginBottom: '8px',
              padding: '4px',
              backgroundColor: 'var(--bg)',
              border: '1px solid var(--border)',
              fontSize: '11px'
            }}>
              {notification.metadata.image_count} {notification.metadata.image_count === 1 ? 'image needs' : 'images need'} date information
            </div>
          )}

          <div style={{ 
            display: 'flex', 
            gap: '6px'
          }}>
            {notification.action_url && (
              <a 
                href={notification.action_url}
                style={{ 
                  textDecoration: 'none',
                  padding: '2px 8px',
                  backgroundColor: 'var(--text-secondary)',
                  color: 'var(--bg)',
                  fontSize: '11px',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {notification.type === 'missing_image_dates' ? 'Add Dates' : 
                 notification.type === 'incomplete_profile' ? 'Complete Profile' : 
                 'View'}
              </a>
            )}
            
            {!notification.is_responded && !notification.action_url && (
              <button 
                className="button button-primary"
                onClick={() => {
                  // For now, just mark as responded with a simple response
                  handleRespond(notification.id, { action: 'acknowledged', timestamp: new Date().toISOString() });
                }}
              >
                Respond
              </button>
            )}
            
            {!notification.read && !notification.is_read && (
              <button 
                onClick={() => handleMarkRead(notification.id)}
                style={{
                  padding: '2px 8px',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Mark Read
              </button>
            )}

            {notification.is_responded && (
              <span className="text-small text-success" style={{ display: 'flex', alignItems: 'center' }}>
                RESPONDED
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default NotificationCenter;
