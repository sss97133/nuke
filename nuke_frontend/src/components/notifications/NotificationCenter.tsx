import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import '../../design-system.css';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: any;
  action_url?: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationCenterProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const NotificationCenter = ({ isOpen = true, onClose }: NotificationCenterProps) => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user && isOpen) {
      loadNotifications();
    }
  }, [user, isOpen, filter]);

  useEffect(() => {
    if (!user) return;

    const subscription = supabase
      .channel(`user_notifications_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const n = payload.new as any;
          setNotifications(prev => ([{ ...n, action_url: n?.metadata?.link_url }, ...prev] as Notification[]));
          if (n && n.is_read === false) {
            setUnreadCount(prev => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [user]);

  const loadNotifications = async () => {
    if (!user) return;

    setLoading(true);

    let query = supabase
      .from('user_notifications')
      .select('id, type, title, message, metadata, is_read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (filter === 'unread') {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error loading notifications:', error);
    } else {
      const rows = (data as any[] | null) || [];
      const mapped = rows.map((n: any) => ({ ...n, action_url: n?.metadata?.link_url })) as Notification[];
      setNotifications(mapped);
      setUnreadCount(mapped.filter(n => !n.is_read).length || 0);
    }

    setLoading(false);
  };

  const markAsRead = async (notificationId: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('user_notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error marking notification as read:', error);
    } else {
      setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;

    const { error } = await supabase
      .from('user_notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) {
      console.error('Error marking all notifications as read:', error);
    } else {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    // Deletion not supported by current RLS; mark as read instead
    await markAsRead(notificationId);
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }

    if (notification.action_url) {
      window.location.href = notification.action_url;
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const notificationTime = new Date(timestamp);
    const diffInMinutes = Math.floor((now.getTime() - notificationTime.getTime()) / 60000);

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;

    return notificationTime.toLocaleDateString();
  };

  const getNotificationIcon = (type: string) => {
    const icons: Record<string, string> = {
      like: 'LIKE',
      comment: 'COMMENT',
      follow: 'FOLLOW',
      mention: 'MENTION',
      auction_outbid: 'OUTBID',
      auction_won: 'WON',
      auction_ending: 'ENDING',
      stream_live: 'LIVE',
      build_milestone: 'MILESTONE',
      system: 'SYSTEM'
    };
    return icons[type] || 'NOTIFICATION';
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      style={{
        background: '#f5f5f5',
        border: '1px solid #bdbdbd',
        padding: '0px',
        margin: '16px',
        fontFamily: 'Arial, sans-serif',
        maxHeight: '600px',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Header */}
      <div style={{
        background: '#e0e0e0',
        padding: '8px 12px',
        borderBottom: '1px solid #bdbdbd',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0' }}>
            Notifications
          </h3>
          {unreadCount > 0 && (
            <div style={{
              background: '#dc2626',
              color: 'white',
              borderRadius: '50%',
              width: '16px',
              height: '16px',
              fontSize: '7pt',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold'
            }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '4px' }}>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              style={{
                padding: '2px 6px',
                fontSize: '7pt',
                border: '1px solid #bdbdbd',
                background: '#424242',
                color: 'white',
                borderRadius: '0px',
                cursor: 'pointer'
              }}
            >
              Mark All Read
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '2px 6px',
                fontSize: '7pt',
                border: '1px solid #bdbdbd',
                background: '#e0e0e0',
                color: '#424242',
                borderRadius: '0px',
                cursor: 'pointer'
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{
        background: 'white',
        padding: '8px',
        borderBottom: '1px solid #bdbdbd',
        display: 'flex',
        gap: '4px'
      }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '4px 8px',
            fontSize: '8pt',
            border: '1px solid #bdbdbd',
            background: filter === 'all' ? '#424242' : '#f5f5f5',
            color: filter === 'all' ? 'white' : '#424242',
            borderRadius: '0px',
            cursor: 'pointer'
          }}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter('unread')}
          style={{
            padding: '4px 8px',
            fontSize: '8pt',
            border: '1px solid #bdbdbd',
            background: filter === 'unread' ? '#424242' : '#f5f5f5',
            color: filter === 'unread' ? 'white' : '#424242',
            borderRadius: '0px',
            cursor: 'pointer'
          }}
        >
          Unread ({unreadCount})
        </button>
      </div>

      {/* Notifications List */}
      <div style={{
        flex: '1',
        overflowY: 'auto',
        background: 'white'
      }}>
        {loading ? (
          <div style={{
            padding: '16px',
            textAlign: 'center',
            fontSize: '8pt',
            color: '#757575'
          }}>
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div style={{
            padding: '24px',
            textAlign: 'center',
            fontSize: '8pt',
            color: '#757575'
          }}>
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </div>
        ) : (
          notifications.map(notification => (
              <div
              key={notification.id}
              onClick={() => handleNotificationClick(notification)}
              style={{
                padding: '12px',
                borderBottom: '1px solid #f0f0f0',
                  background: notification.is_read ? 'white' : '#f8fafc',
                cursor: notification.action_url ? 'pointer' : 'default',
                position: 'relative'
              }}
            >
              {/* Unread indicator */}
              {!notification.is_read && (
                <div style={{
                  position: 'absolute',
                  left: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '4px',
                  height: '4px',
                  background: '#3b82f6',
                  borderRadius: '50%'
                }} />
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', paddingLeft: '8px' }}>
                {/* Notification Icon */}
                <div style={{ fontSize: '12pt', minWidth: '16px' }}>
                  {getNotificationIcon(notification.type)}
                </div>

                {/* Notification Content */}
                <div style={{ flex: '1' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '2px' }}>
                    {notification.title}
                  </div>
                  {notification.message && (
                    <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '4px' }}>
                      {notification.message}
                    </div>
                  )}
                  <div style={{ fontSize: '7pt', color: '#9ca3af' }}>
                    {formatTimeAgo(notification.created_at)}
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '2px' }}>
                  {!notification.is_read && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsRead(notification.id);
                      }}
                      style={{
                        padding: '2px 4px',
                        fontSize: '7pt',
                        border: '1px solid #bdbdbd',
                        background: '#f5f5f5',
                        color: '#424242',
                        borderRadius: '0px',
                        cursor: 'pointer'
                      }}
                    >
                      ✓
                    </button>
                  )}
                  {/* Delete hidden due to RLS constraints */}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default NotificationCenter;