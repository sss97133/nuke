import React, { useState, useEffect } from 'react';
import { NotificationService, type Notification } from '../services/notificationService';
import { supabase } from '../lib/supabase';

interface NotificationCenterProps {
  userId: string;
  onNotificationUpdate?: () => void;
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ userId, onNotificationUpdate }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotifications();
    
    // Subscribe to real-time notifications
    const subscription = NotificationService.subscribeToNotifications(userId, (newNotification) => {
      setNotifications(prev => [newNotification, ...prev]);
      onNotificationUpdate?.();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [userId, onNotificationUpdate]);

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
      case 'vin_request': return 'VIN';
      case 'verification_request': return 'VERIFY';
      case 'contribution_request': return 'CONTRIB';
      case 'ownership_challenge': return 'ALERT';
      case 'data_correction': return 'EDIT';
      case 'photo_approval': return 'PHOTO';
      case 'timeline_contribution': return 'TIMELINE';
      case 'missing_image_dates': return 'DATES';
      case 'incomplete_profile': return 'PROFILE';
      default: return 'INFO';
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
            border: '1px solid #bdbdbd', 
            backgroundColor: (!notification.read && !notification.is_read) ? '#f5f5f5' : 'white',
            fontSize: '9pt'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ 
              fontSize: '8pt', 
              marginRight: '6px', 
              padding: '1px 4px',
              backgroundColor: '#e0e0e0',
              fontWeight: 'bold'
            }}>
              {getNotificationIcon(notification.type)}
            </span>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: '9pt' }}>{notification.title}</strong>
              <span style={{ fontSize: '8pt', color: '#757575', marginLeft: '8px' }}>
                {formatDate(notification.created_at)}
              </span>
            </div>
            {(!notification.read && !notification.is_read) && (
              <span style={{
                fontSize: '8pt',
                fontWeight: 'bold',
                padding: '1px 4px',
                backgroundColor: '#757575',
                color: 'white'
              }}>
                NEW
              </span>
            )}
          </div>
          
          <div style={{ 
            marginBottom: '8px', 
            lineHeight: '1.3',
            fontSize: '9pt',
            color: '#000000'
          }}>
            {notification.message}
            {notification.type === 'incomplete_profile' && notification.metadata?.completion_percentage && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ 
                  background: '#e0e0e0', 
                  height: '6px',
                  border: '1px solid #bdbdbd',
                  marginTop: '4px'
                }}>
                  <div style={{ 
                    background: notification.metadata.completion_percentage < 50 ? '#9e9e9e' : '#757575',
                    height: '100%', 
                    width: `${notification.metadata.completion_percentage}%`
                  }} />
                </div>
                <div style={{ 
                  marginTop: '2px',
                  fontSize: '8pt',
                  color: '#757575'
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
              backgroundColor: '#f5f5f5',
              border: '1px solid #e0e0e0',
              fontSize: '8pt'
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
                  backgroundColor: '#757575',
                  color: 'white',
                  fontSize: '8pt',
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
                  color: '#000000',
                  border: '1px solid #bdbdbd',
                  fontSize: '8pt',
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
