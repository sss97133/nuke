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

interface VehicleImage {
  image_url: string
  thumbnail_url?: string
  large_url?: string
  variants?: any
  is_primary?: boolean
}

interface NotificationCenterProps {
  isOpen: boolean
  onClose: () => void
}

export default function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [vehicleImages, setVehicleImages] = useState<Record<string, VehicleImage | null>>({})
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

      // Load ALL notification sources in parallel
      const [userNotifs, workApprovals] = await Promise.all([
        // Standard user notifications
        supabase
          .from('user_notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
        
        // Work approval notifications
        supabase.rpc('get_pending_work_approvals', { p_user_id: user.id })
      ])

      // Combine all notifications into unified format
      const unifiedNotifications: Notification[] = []

      // Add user notifications
      if (userNotifs.data) {
        userNotifs.data.forEach(n => {
          unifiedNotifications.push({
            id: n.id,
            notification_type: n.notification_type || n.type || 'unknown',
            title: n.title,
            message: n.message,
            vehicle_id: n.vehicle_id,
            image_id: n.image_id,
            organization_id: n.organization_id,
            from_user_id: n.from_user_id,
            action_url: n.action_url,
            metadata: n.metadata || {},
            is_read: n.is_read || false,
            created_at: n.created_at
          })
        })
      }

      // Add work approvals
      if (workApprovals.data) {
        workApprovals.data.forEach((wa: any) => {
          unifiedNotifications.push({
            id: `work_${wa.id}`,
            notification_type: 'work_approval_request',
            title: `Work Approval: ${wa.work_type || 'Work'}`,
            message: `${wa.work_type || 'Work'} detected on ${wa.vehicle_name}`,
            vehicle_id: wa.vehicle_id,
            organization_id: wa.organization_id,
            metadata: {
              requires_confirmation: true,
              action: 'approve_work',
              work_id: wa.id,
              work_type: wa.work_type,
              data_point: `${wa.work_type || 'Work'} on ${wa.vehicle_name} - Approve this work?`
            },
            is_read: false,
            created_at: wa.created_at
          })
        })
      }

      // Sort by created_at descending
      unifiedNotifications.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )

      setNotifications(unifiedNotifications.slice(0, 50))
      setUnreadCount(unifiedNotifications.filter(n => !n.is_read).length)

      // Load vehicle images
      const vehicleIds = [...new Set(unifiedNotifications
        .filter(n => n.vehicle_id)
        .map(n => n.vehicle_id)
      )] as string[]

      if (vehicleIds.length > 0) {
        loadVehicleImages(vehicleIds)
      }
    } catch (error: any) {
      console.error('Error loading notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadVehicleImages = async (vehicleIds: string[]) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        // Lean payload: avoid pulling large JSON blobs when just rendering a tiny thumbnail.
        .select('vehicle_id, image_url, thumbnail_url, large_url, is_primary, created_at')
        .in('vehicle_id', vehicleIds)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })

      if (error) throw error

      const imagesMap: Record<string, VehicleImage | null> = {}
      vehicleIds.forEach(id => {
        const vehicleImages = data?.filter(img => img.vehicle_id === id) || []
        const primaryImage = vehicleImages.find(img => img.is_primary) || vehicleImages[0] || null
        imagesMap[id] = primaryImage
      })

      setVehicleImages(imagesMap)
    } catch (error: any) {
      console.error('Error loading vehicle images:', error)
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

  const handleYes = async (notification: Notification) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Handle approval/yes action
      if (notification.metadata?.action === 'approve_assignment') {
        const { error } = await supabase.rpc('approve_pending_assignment', {
          p_assignment_id: notification.metadata.assignment_id,
          p_user_id: user.id,
          p_notes: null
        })
        if (error) throw error
      } else if (notification.metadata?.action === 'approve_work') {
        // Use the work approval RPC
        const { error } = await supabase.rpc('respond_to_work_approval', {
          p_notification_id: notification.metadata.work_id,
          p_user_id: user.id,
          p_response_action: 'approve',
          p_response_notes: null
        })
        if (error) throw error
      } else if (notification.id.startsWith('work_')) {
        // Work approval from ID
        const workId = notification.id.replace('work_', '')
        const { error } = await supabase.rpc('respond_to_work_approval', {
          p_notification_id: workId,
          p_user_id: user.id,
          p_response_action: 'approve',
          p_response_notes: null
        })
        if (error) throw error
      } else if (notification.id.startsWith('assignment_')) {
        // Assignment from ID
        const assignmentId = notification.id.replace('assignment_', '')
        const { error } = await supabase.rpc('approve_pending_assignment', {
          p_assignment_id: assignmentId,
          p_user_id: user.id,
          p_notes: null
        })
        if (error) throw error
      } else {
        // Standard user notification - just mark as read
        await handleMarkRead(notification.id)
      }

      await loadNotifications()
    } catch (error: any) {
      console.error('Error handling yes action:', error)
      alert(`Error: ${error.message}`)
    }
  }

  const [rejectionModal, setRejectionModal] = useState<{
    open: boolean;
    notification: Notification | null;
  } | null>(null)

  const handleNo = async (notification: Notification, notes?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Handle rejection/no action
      if (notification.metadata?.action === 'approve_assignment' || notification.id.startsWith('assignment_')) {
        const assignmentId = notification.metadata?.assignment_id || notification.id.replace('assignment_', '')
        const { error } = await supabase.rpc('reject_pending_assignment', {
          p_assignment_id: assignmentId,
          p_user_id: user.id,
          p_notes: notes || null
        })
        if (error) throw error
      } else if (notification.metadata?.action === 'approve_work' || notification.id.startsWith('work_')) {
        const workId = notification.metadata?.work_id || notification.id.replace('work_', '')
        const { error } = await supabase.rpc('respond_to_work_approval', {
          p_notification_id: workId,
          p_user_id: user.id,
          p_response_action: 'reject',
          p_response_notes: notes || null
        })
        if (error) throw error
      } else {
        // Standard notification - just mark as read
        await handleMarkRead(notification.id)
      }

      await loadNotifications()
      setRejectionModal(null)
    } catch (error: any) {
      console.error('Error handling no action:', error)
      alert(`Error: ${error.message}`)
    }
  }

  const handleNoClick = (notification: Notification) => {
    setRejectionModal({ open: true, notification })
  }

  const handleClick = (notification: Notification) => {
    // Don't navigate on click if there are yes/no actions
    if (notification.metadata?.requires_confirmation) {
      return
    }

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

  const getVehicleImageUrl = (vehicleId?: string): string | null => {
    if (!vehicleId) return null
    const image = vehicleImages[vehicleId]
    if (!image) return null
    
    return image.thumbnail_url || image.variants?.medium || image.variants?.large || image.image_url || null
  }

  const getDataPoint = (notification: Notification): string => {
    // Extract the specific data point from metadata
    if (notification.metadata?.data_point) {
      return notification.metadata.data_point
    }
    if (notification.metadata?.question) {
      return notification.metadata.question
    }
    if (notification.metadata?.field_name) {
      return `${notification.metadata.field_name}: ${notification.metadata.field_value || 'needs confirmation'}`
    }
    return notification.message || notification.title
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'comment_on_vehicle': return '[CMT]'
      case 'vehicle_access_request': return '[ACC]'
      case 'vehicle_contribution': return '[ADD]'
      case 'vehicle_liked': return '[LKE]'
      case 'upload_completed': return '[UPL]'
      case 'analysis_completed': return '[AI]'
      case 'price_updated': return '[PRC]'
      case 'work_order_assigned': return '[WRK]'
      default: return '[NOT]'
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
        background: 'var(--surface)',
        border: '2px solid var(--border)',
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
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg)',
          color: 'var(--text)'
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
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                cursor: 'pointer',
                fontSize: '7pt',
                color: 'var(--text)'
              }}
            >
              Mark All Read
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '4px 8px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer',
              fontSize: '7pt',
              color: 'var(--text)'
            }}
          >
            CLOSE
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
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '8pt' }}>
            Loading...
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '8pt' }}>
            No notifications
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {notifications.map(notification => {
              const vehicleImageUrl = getVehicleImageUrl(notification.vehicle_id || undefined)
              const dataPoint = getDataPoint(notification)
              const requiresConfirmation = notification.metadata?.requires_confirmation || notification.metadata?.action

              return (
                <div
                  key={notification.id}
                  onClick={() => handleClick(notification)}
                  style={{
                    padding: '12px',
                    border: '1px solid var(--border)',
                    background: notification.is_read ? 'var(--surface)' : 'var(--surface-hover)',
                    cursor: requiresConfirmation ? 'default' : 'pointer',
                    transition: '0.12s'
                  }}
                  onMouseEnter={(e) => {
                    if (!requiresConfirmation) {
                      e.currentTarget.style.background = 'var(--surface-hover)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = notification.is_read ? 'var(--surface)' : 'var(--surface-hover)'
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'start' }}>
                    {/* Vehicle Image */}
                    {vehicleImageUrl && (
                      <div style={{ flex: '0 0 60px', height: '60px', background: 'var(--bg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                        <img
                          src={vehicleImageUrl}
                          alt="Vehicle"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      </div>
                    )}

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '9pt', fontWeight: notification.is_read ? '400' : '600', marginBottom: '6px' }}>
                        {notification.title}
                      </div>
                      
                      {/* Data Point */}
                      <div style={{ 
                        fontSize: '8pt', 
                        color: 'var(--text-secondary)', 
                        marginBottom: requiresConfirmation ? '8px' : '4px',
                        fontWeight: '500'
                      }}>
                        {dataPoint}
                      </div>

                      {requiresConfirmation && (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleYes(notification)
                            }}
                            style={{
                              padding: '6px 16px',
                              border: '1px solid var(--success)',
                              background: 'var(--success)',
                              color: 'white',
                              cursor: 'pointer',
                              fontSize: '8pt',
                              fontWeight: '600'
                            }}
                          >
                            YES
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleNo(notification)
                            }}
                            style={{
                              padding: '6px 16px',
                              border: '1px solid var(--error)',
                              background: 'var(--surface)',
                              color: 'var(--error)',
                              cursor: 'pointer',
                              fontSize: '8pt',
                              fontWeight: '600'
                            }}
                          >
                            NO
                          </button>
                        </div>
                      )}

                      <div style={{ fontSize: '7pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        {new Date(notification.created_at).toLocaleString()}
                      </div>
                    </div>

                    {!notification.is_read && !requiresConfirmation && (
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          background: '#0ea5e9',
                          borderRadius: '50%',
                          marginTop: '4px',
                          flexShrink: 0
                        }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
