/**
 * NOTIFICATION BELL
 * 
 * Simple bell icon with unread count
 * Opens notification center on click
 */

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import NotificationCenter from './NotificationCenter'

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    loadUnreadCount()
    
    // Real-time subscription
    const channel = supabase
      .channel('notification_bell')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_notifications'
      }, () => {
        loadUnreadCount()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const loadUnreadCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setUnreadCount(0)
        return
      }

      const { data, error } = await supabase.rpc('get_unread_notification_count', {
        p_user_id: user.id
      })

      if (error) throw error
      setUnreadCount(data || 0)
    } catch (error: any) {
      console.error('Error loading unread count:', error)
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          padding: '8px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer'
        }}
        title="Notifications"
      >
        <span style={{ fontSize: '16pt' }}>🔔</span>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              fontSize: '8pt',
              padding: '2px 6px',
              background: '#dc2626',
              color: 'white',
              borderRadius: '10px',
              minWidth: '18px',
              textAlign: 'center'
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      <NotificationCenter isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
