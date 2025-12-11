import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

interface MailboxMessage {
  id: string
  message_type: string
  title: string
  content: string
  priority: string
  sender_type: string
  metadata: Record<string, any>
  read_by: string[]
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

interface VehicleMailbox {
  id: string
  vehicle_id: string
  vin: string
  user_access_level: string
  message_count: number
  created_at: string
  updated_at: string
}

interface UseVehicleMailboxReturn {
  mailbox: VehicleMailbox | null
  messages: MailboxMessage[]
  loading: boolean
  error: string | null
  unreadCount: number
  urgentCount: number
  duplicateAlerts: number
  hasAccess: boolean
  refreshMailbox: () => Promise<void>
  markAsRead: (messageId: string) => Promise<void>
  resolveMessage: (messageId: string, resolutionData?: Record<string, any>) => Promise<void>
  sendMessage: (messageData: Partial<MailboxMessage>) => Promise<void>
}

export const useVehicleMailbox = (vehicleId: string | undefined): UseVehicleMailboxReturn => {
  const [mailbox, setMailbox] = useState<VehicleMailbox | null>(null)
  const [messages, setMessages] = useState<MailboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasAccess, setHasAccess] = useState(false)

  const getCurrentUserId = () => {
    // This would typically come from your auth context
    // For now, we'll use a placeholder
    return 'current_user'
  }

  const getAuthHeaders = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token || localStorage.getItem('auth_token')
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  }

  const refreshMailbox = useCallback(async () => {
    if (!vehicleId) return

    setLoading(true)
    setError(null)

    try {
      // Load mailbox info
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox`, {
        headers: {
          ...authHeaders
        }
      })

      if (response.ok) {
        const result = await response.json()
        setMailbox(result.data.mailbox)
        setHasAccess(true)

        // Load messages
        const authHeadersMessages = await getAuthHeaders()
        const messagesResponse = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages?limit=50`, {
          headers: {
            ...authHeadersMessages
          }
        })

        if (messagesResponse.ok) {
          const messagesResult = await messagesResponse.json()
          setMessages(messagesResult.data)
        }
      } else if (response.status === 403) {
        setHasAccess(false)
        setError('Access denied to this mailbox')
      } else {
        setError('Failed to load mailbox')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setHasAccess(false)
    } finally {
      setLoading(false)
    }
  }, [vehicleId])

  const markAsRead = useCallback(async (messageId: string) => {
    if (!vehicleId || !hasAccess) return

    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages/${messageId}/read`, {
        method: 'PATCH',
        headers: {
          ...authHeaders
        }
      })

      if (response.ok) {
        setMessages(prev => prev.map(msg =>
          msg.id === messageId
            ? { ...msg, read_by: [...(msg.read_by || []), getCurrentUserId()] }
            : msg
        ))
      }
    } catch (err) {
      console.error('Failed to mark message as read:', err)
    }
  }, [vehicleId, hasAccess])

  const resolveMessage = useCallback(async (messageId: string, resolutionData: Record<string, any> = {}) => {
    if (!vehicleId || !hasAccess) return

    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages/${messageId}/resolve`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ resolution_data: resolutionData })
      })

      if (response.ok) {
        const result = await response.json()
        setMessages(prev => prev.map(msg =>
          msg.id === messageId ? result.data : msg
        ))
      }
    } catch (err) {
      console.error('Failed to resolve message:', err)
      throw err
    }
  }, [vehicleId, hasAccess])

  const sendMessage = useCallback(async (messageData: Partial<MailboxMessage>) => {
    if (!vehicleId || !hasAccess) return

    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(messageData)
      })

      if (response.ok) {
        const result = await response.json()
        setMessages(prev => [result.data, ...prev])
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      throw err
    }
  }, [vehicleId, hasAccess])

  // Calculate derived state
  const currentUserId = getCurrentUserId()
  const unreadCount = messages.filter(msg =>
    !msg.read_by || !msg.read_by.includes(currentUserId)
  ).length

  const urgentCount = messages.filter(msg =>
    msg.priority === 'urgent' &&
    (!msg.read_by || !msg.read_by.includes(currentUserId))
  ).length

  const duplicateAlerts = messages.filter(msg =>
    msg.message_type === 'duplicate_detected' &&
    !msg.resolved_at &&
    (!msg.read_by || !msg.read_by.includes(currentUserId))
  ).length

  // Set up real-time subscriptions
  useEffect(() => {
    if (!vehicleId || !hasAccess) return

    // Initial load
    refreshMailbox()

    // Set up real-time subscription for new messages
    const messageSubscription = supabase
      .channel(`mailbox_messages:${vehicleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mailbox_messages'
      }, (payload) => {
        const newMessage = payload.new as MailboxMessage
        // Check if this message belongs to our mailbox
        if (newMessage.mailbox_id === mailbox?.id) {
          setMessages(prev => [newMessage, ...prev])
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'mailbox_messages'
      }, (payload) => {
        const updatedMessage = payload.new as MailboxMessage
        if (updatedMessage.mailbox_id === mailbox?.id) {
          setMessages(prev => prev.map(msg =>
            msg.id === updatedMessage.id ? updatedMessage : msg
          ))
        }
      })
      .subscribe()

    // Set up subscription for duplicate detection notifications
    const duplicateSubscription = supabase
      .channel(`duplicate_detection:${vehicleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'duplicate_detections',
        filter: `original_vehicle_id=eq.${vehicleId}`
      }, (payload) => {
        // Refresh mailbox when new duplicates are detected
        refreshMailbox()
      })
      .subscribe()

    // Cleanup subscriptions
    return () => {
      messageSubscription.unsubscribe()
      duplicateSubscription.unsubscribe()
    }
  }, [vehicleId, hasAccess, mailbox?.id, refreshMailbox])

  // Set up periodic refresh for mailbox status
  useEffect(() => {
    if (!vehicleId || !hasAccess) return

    const interval = setInterval(() => {
      // Light refresh to update message counts without full reload
      if (mailbox) {
        fetch(`/api/vehicles/${vehicleId}/mailbox`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        })
        .then(response => response.json())
        .then(result => {
          if (result.data?.mailbox) {
            setMailbox(prev => prev ? { ...prev, message_count: result.data.mailbox.message_count } : null)
          }
        })
        .catch(console.error)
      }
    }, 30000) // Every 30 seconds

    return () => clearInterval(interval)
  }, [vehicleId, hasAccess, mailbox])

  return {
    mailbox,
    messages,
    loading,
    error,
    unreadCount,
    urgentCount,
    duplicateAlerts,
    hasAccess,
    refreshMailbox,
    markAsRead,
    resolveMessage,
    sendMessage
  }
}

// Hook for global mailbox notifications across all vehicles
export const useGlobalMailboxNotifications = () => {
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0)
  const [globalUrgentCount, setGlobalUrgentCount] = useState(0)

  useEffect(() => {
    // Load initial global counts
    const loadGlobalCounts = async () => {
      try {
        // This would need a new API endpoint to get global message counts
        const response = await fetch('/api/mailbox/global-counts', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
          }
        })

        if (response.ok) {
          const result = await response.json()
          setGlobalUnreadCount(result.data.unread_count)
          setGlobalUrgentCount(result.data.urgent_count)
        }
      } catch (error) {
        console.error('Failed to load global mailbox counts:', error)
      }
    }

    loadGlobalCounts()

    // Set up global subscription for all mailbox messages
    const globalSubscription = supabase
      .channel('global_mailbox_messages')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mailbox_messages'
      }, () => {
        // Refresh global counts when any message changes
        loadGlobalCounts()
      })
      .subscribe()

    return () => {
      globalSubscription.unsubscribe()
    }
  }, [])

  return {
    globalUnreadCount,
    globalUrgentCount
  }
}