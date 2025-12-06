/**
 * NOTIFICATION CENTER
 * 
 * Simple, fundamental notification system
 * Shows user-to-user and system-to-user notifications
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface Notification {
  id: string
  notification_type: string
  title: string
  message?: string
  vehicle_id?: string
  image_id?: string
  organization_id?: string
  from_user_id?: string
  action_url?: string
  metadata: any
  is_read: boolean
  created_at: string
}

interface NotificationCenterProps {
  isOpen: boolean
  onClose: () => void
}

export default function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      loadNotifications()
      
      // Real-time subscription
      const channel = supabase
        .channel('user_notifications')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${(async () => {
            const { data: { user } } = await supabase.auth.getUser()
            return user?.id
          })()}`
        }, () => {
          loadNotifications()
        })
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }
  }, [isOpen])

  const loadNotifications = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Get notifications
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      setNotifications(data || [])
      setUnreadCount(data?.filter(n => !n.is_read).length || 0)
    } catch (error: any) {
      console.error('Error loading notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleMarkRead = async (notificationId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId,
        p_user_id: user.id
      })

      await loadNotifications()
    } catch (error: any) {
      console.error('Error marking notification as read:', error)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase.rpc('mark_all_notifications_read', {
        p_user_id: user.id
      })

      await loadNotifications()
    } catch (error: any) {
      console.error('Error marking all as read:', error)
    }
  }

  const handleClick = (notification: Notification) => {
    // Mark as read
    if (!notification.is_read) {
      handleMarkRead(notification.id)
    }

    // Navigate to action
    if (notification.action_url) {
      navigate(notification.action_url)
      onClose()
    } else if (notification.vehicle_id) {
      navigate(`/vehicle/${notification.vehicle_id}`)
      onClose()
    } else if (notification.organization_id) {
      navigate(`/organization/${notification.organization_id}`)
      onClose()
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'comment_on_vehicle': return '💬'
      case 'vehicle_access_request': return '🔓'
      case 'vehicle_contribution': return '➕'
      case 'vehicle_liked': return '❤️'
      case 'upload_completed': return '✅'
      case 'analysis_completed': return '🤖'
      case 'price_updated': return '💰'
      case 'work_order_assigned': return '🔧'
      default: return '🔔'
    }
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: '60px',
        right: '16px',
        width: '400px',
        maxHeight: '600px',
        background: '#ffffff',
        border: '2px solid #bdbdbd',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px',
          borderBottom: '1px solid #bdbdbd',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f5f5f5'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10pt', fontWeight: '600' }}>Notifications</span>
          {unreadCount > 0 && (
            <span
              style={{
                fontSize: '7pt',
                padding: '2px 6px',
                background: '#dc2626',
                color: 'white',
                borderRadius: '10px'
              }}
            >
              {unreadCount}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              style={{
                padding: '4px 8px',
                border: '1px solid #bdbdbd',
                background: '#ffffff',
                cursor: 'pointer',
                fontSize: '7pt'
              }}
            >
              Mark All Read
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '4px 8px',
              border: '1px solid #bdbdbd',
              background: '#ffffff',
              cursor: 'pointer',
              fontSize: '7pt'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px'
        }}
      >
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#757575', fontSize: '8pt' }}>
            Loading...
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#757575', fontSize: '8pt' }}>
            No notifications
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {notifications.map(notification => (
              <div
                key={notification.id}
                onClick={() => handleClick(notification)}
                style={{
                  padding: '12px',
                  border: '1px solid #bdbdbd',
                  background: notification.is_read ? '#ffffff' : '#f0f9ff',
                  cursor: 'pointer',
                  transition: '0.12s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f5f5f5'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = notification.is_read ? '#ffffff' : '#f0f9ff'
                }}
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'start' }}>
                  <span style={{ fontSize: '14pt' }}>{getNotificationIcon(notification.notification_type)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '9pt', fontWeight: notification.is_read ? '400' : '600', marginBottom: '4px' }}>
                      {notification.title}
                    </div>
                    {notification.message && (
                      <div style={{ fontSize: '8pt', color: '#757575', marginBottom: '4px' }}>
                        {notification.message}
                      </div>
                    )}
                    <div style={{ fontSize: '7pt', color: '#9e9e9e' }}>
                      {new Date(notification.created_at).toLocaleString()}
                    </div>
                  </div>
                  {!notification.is_read && (
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        background: '#0ea5e9',
                        borderRadius: '50%',
                        marginTop: '4px'
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
