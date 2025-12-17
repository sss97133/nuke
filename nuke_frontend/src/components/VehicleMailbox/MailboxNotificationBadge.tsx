import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Bell, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface MailboxNotificationBadgeProps {
  vehicleId: string
  className?: string
  showIcon?: boolean
  showText?: boolean
}

interface MailboxSummary {
  total_messages: number
  unread_count: number
  urgent_count: number
  duplicate_alerts: number
  user_access_level: string | null
}

const MailboxNotificationBadge: React.FC<MailboxNotificationBadgeProps> = ({
  vehicleId,
  className = '',
  showIcon = true,
  showText = false
}) => {
  const [summary, setSummary] = useState<MailboxSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)

  useEffect(() => {
    loadMailboxSummary()

    // Subscribe to real-time updates
    const subscription = supabase
      .channel(`mailbox_badge:${vehicleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mailbox_messages',
        filter: `mailbox_id=eq.${vehicleId}`
      }, () => {
        loadMailboxSummary() // Refresh when messages change
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [vehicleId])

  const getAuthHeaders = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token || localStorage.getItem('auth_token')
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  }

  const loadMailboxSummary = async () => {
    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox`, {
        headers: {
          ...authHeaders
        }
      })

      const isJson = (res: Response) => {
        const ct = res.headers.get('content-type') || ''
        return ct.toLowerCase().includes('application/json')
      }

      // If this app is deployed without server routes for /api/*, Vercel will often return index.html (200)
      // which will crash response.json() with "Unexpected token '<'".
      if (response.ok && !isJson(response)) {
        setHasAccess(false)
        return
      }

      if (response.ok) {
        const result = await response.json().catch(() => null as any)
        if (!result?.data?.mailbox) {
          setHasAccess(false)
          return
        }
        const mailbox = result.data.mailbox

        // Get message counts
        const authHeadersMessages = await getAuthHeaders()
        const messagesResponse = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages?limit=100`, {
          headers: {
            ...authHeadersMessages
          }
        })

        if (messagesResponse.ok && !isJson(messagesResponse)) {
          setHasAccess(false)
          return
        }

        if (messagesResponse.ok) {
          const messagesResult = await messagesResponse.json().catch(() => null as any)
          const messages = Array.isArray(messagesResult?.data) ? messagesResult.data : []

          const summary: MailboxSummary = {
            total_messages: messages.length,
            unread_count: messages.filter((msg: any) =>
              !msg.read_by || !msg.read_by.includes('current_user')
            ).length,
            urgent_count: messages.filter((msg: any) =>
              msg.priority === 'urgent' &&
              (!msg.read_by || !msg.read_by.includes('current_user'))
            ).length,
            duplicate_alerts: messages.filter((msg: any) =>
              msg.message_type === 'duplicate_detected' &&
              !msg.resolved_at &&
              (!msg.read_by || !msg.read_by.includes('current_user'))
            ).length,
            user_access_level: mailbox.user_access_level
          }

          setSummary(summary)
          setHasAccess(true)
        }
      } else if (response.status === 403 || response.status === 404) {
        // User doesn't have access to this mailbox
        setHasAccess(false)
      }
    } catch (error) {
      console.error('Error loading mailbox summary:', error)
      setHasAccess(false)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="w-8 h-8 bg-gray-300 rounded-full"></div>
      </div>
    )
  }

  if (!hasAccess || !summary) {
    return null // Don't show badge if user has no access
  }

  const getIcon = () => {
    if (summary.duplicate_alerts > 0) {
      return <AlertTriangle className="w-5 h-5" />
    }
    if (summary.urgent_count > 0) {
      return <Bell className="w-5 h-5" />
    }
    return <Mail className="w-5 h-5" />
  }

  const getBadgeColor = () => {
    if (summary.duplicate_alerts > 0) {
      return 'bg-red-500 text-white'
    }
    if (summary.urgent_count > 0) {
      return 'bg-orange-500 text-white'
    }
    if (summary.unread_count > 0) {
      return 'bg-blue-500 text-white'
    }
    return 'bg-gray-500 text-white'
  }

  const getTooltipText = () => {
    const parts = []
    if (summary.unread_count > 0) {
      parts.push(`${summary.unread_count} unread message${summary.unread_count === 1 ? '' : 's'}`)
    }
    if (summary.urgent_count > 0) {
      parts.push(`${summary.urgent_count} urgent`)
    }
    if (summary.duplicate_alerts > 0) {
      parts.push(`${summary.duplicate_alerts} duplicate alert${summary.duplicate_alerts === 1 ? '' : 's'}`)
    }
    return parts.length > 0 ? parts.join(', ') : 'No unread messages'
  }

  const totalUnread = summary.unread_count

  return (
    <Link
      to={`/vehicle/${vehicleId}/mailbox`}
      className={`relative inline-flex items-center space-x-2 hover:opacity-75 transition-opacity ${className}`}
      title={getTooltipText()}
    >
      {showIcon && (
        <div className="relative">
          <div className={`p-2 rounded-full ${getBadgeColor()}`}>
            {getIcon()}
          </div>
          {totalUnread > 0 && (
            <div className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold">
              {totalUnread > 99 ? '99+' : totalUnread}
            </div>
          )}
        </div>
      )}

      {showText && (
        <div className="flex flex-col">
          <span className="text-sm font-medium" style={{ fontSize: '9px' }}>
            Mailbox
          </span>
          {totalUnread > 0 && (
            <span className="text-xs text-gray-500">
              {totalUnread} unread
            </span>
          )}
        </div>
      )}
    </Link>
  )
}

export default MailboxNotificationBadge