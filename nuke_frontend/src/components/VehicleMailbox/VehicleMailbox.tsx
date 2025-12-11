import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, Mail, Settings, Users, AlertTriangle, CheckCircle, XCircle, Plus, Inbox, Send, Archive, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toast } from 'react-hot-toast'
import MessageList from './MessageList'
import AccessKeyManager from './AccessKeyManager'
import DuplicateDetectionModal from './DuplicateDetectionModal'
import { Link } from 'react-router-dom'

interface VehicleMailbox {
  id: string
  vehicle_id: string
  vin: string
  user_access_level: string
  message_count: number
  created_at: string
  updated_at: string
}

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

const VehicleMailbox: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>()
  const [mailbox, setMailbox] = useState<VehicleMailbox | null>(null)
  const [messages, setMessages] = useState<MailboxMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'messages' | 'settings'>('messages')
  const [selectedMessage, setSelectedMessage] = useState<MailboxMessage | null>(null)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [stamps, setStamps] = useState<Array<{ id: string; name?: string; sku?: string; remaining_uses?: number; is_listed?: boolean; list_price_cents?: number }>>([])
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  const selectedStamp = stamps.find(s => s.id === selectedStampId)

  useEffect(() => {
    if (vehicleId) {
      loadMailbox()
      loadMessages()
      loadStamps()

      // Subscribe to real-time updates
      const subscription = supabase
        .channel(`mailbox:${vehicleId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'mailbox_messages'
        }, (payload) => {
          const newMessage = payload.new as MailboxMessage
          if (newMessage.mailbox_id === mailbox?.id) {
            setMessages(prev => [newMessage, ...prev])
            toast.success('New message received')
          }
        })
        .subscribe()

      return () => {
        subscription.unsubscribe()
      }
    }
  }, [vehicleId, mailbox?.id])

  const getAuthHeaders = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token || localStorage.getItem('auth_token')
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  }


  const loadStamps = async () => {
    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/api/stamps`, { headers: { ...authHeaders } })
      if (res.ok) {
        const result = await res.json()
        setStamps(result.data || [])
        if ((result.data || []).length > 0 && !selectedStampId) {
          setSelectedStampId(result.data[0].id)
        }
      }
    } catch (error) {
      console.error('Error loading stamps:', error)
    }
  }

  const listStamp = async (stampId: string) => {
    const price = prompt('List price (USD):')
    if (!price) return
    const priceNum = Number(price)
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error('Invalid price')
      return
    }
    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch('/api/stamps/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ stamp_id: stampId, list_price_cents: Math.floor(priceNum * 100) })
      })
      if (res.ok) {
        toast.success('Listed')
        await loadStamps()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.message || 'List failed')
      }
    } catch (error) {
      console.error(error)
      toast.error('List failed')
    }
  }

  const unlistStamp = async (stampId: string) => {
    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch('/api/stamps/unlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ stamp_id: stampId })
      })
      if (res.ok) {
        toast.success('Unlisted')
        await loadStamps()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.message || 'Unlist failed')
      }
    } catch (error) {
      console.error(error)
      toast.error('Unlist failed')
    }
  }

  const loadMailbox = async () => {
    if (!vehicleId) return

    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox`, {
        headers: {
          ...authHeaders
        }
      })

      if (response.ok) {
        const result = await response.json()
        setMailbox(result.data.mailbox)
      } else {
        toast.error('Failed to load vehicle mailbox')
      }
    } catch (error) {
      console.error('Error loading mailbox:', error)
      toast.error('Error loading mailbox')
    }
  }

  const loadMessages = async (page = 1, messageType?: string) => {
    if (!vehicleId) return

    setLoading(true)
    try {
      const authHeaders = await getAuthHeaders()
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      })

      if (messageType) {
        params.append('type', messageType)
      }

      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages?${params}`, {
        headers: {
          ...authHeaders
        }
      })

      if (response.ok) {
        const result = await response.json()
        setMessages(result.data)
      } else {
        toast.error('Failed to load messages')
      }
    } catch (error) {
      console.error('Error loading messages:', error)
      toast.error('Error loading messages')
    } finally {
      setLoading(false)
    }
  }

  const markMessageAsRead = async (messageId: string) => {
    if (!vehicleId) return

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
            ? { ...msg, read_by: [...(msg.read_by || []), 'current_user'] }
            : msg
        ))
      }
    } catch (error) {
      console.error('Error marking message as read:', error)
    }
  }

  const resolveMessage = async (messageId: string, resolutionData: Record<string, any> = {}) => {
    if (!vehicleId) return

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
        toast.success('Message resolved successfully')
      } else {
        toast.error('Failed to resolve message')
      }
    } catch (error) {
      console.error('Error resolving message:', error)
      toast.error('Error resolving message')
    }
  }

  const handleDuplicateMessage = (message: MailboxMessage) => {
    setSelectedMessage(message)
    setShowDuplicateModal(true)
  }

  const handleDuplicateConfirmation = async (action: 'confirm' | 'reject') => {
    if (!selectedMessage || !vehicleId) return

    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages/${selectedMessage.id}/duplicate-confirmation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ action })
      })

      if (response.ok) {
        toast.success(`Duplicate ${action}ed successfully`)
        setShowDuplicateModal(false)
        setSelectedMessage(null)
        loadMessages() // Refresh messages
      } else {
        toast.error(`Failed to ${action} duplicate`)
      }
    } catch (error) {
      console.error('Error handling duplicate confirmation:', error)
      toast.error('Error processing duplicate confirmation')
    }
  }

  const getMessageIcon = (messageType: string, priority: string) => {
    switch (messageType) {
      case 'duplicate_detected':
        return <AlertTriangle className={`w-4 h-4 ${priority === 'high' ? 'text-red-500' : 'text-yellow-500'}`} />
      case 'ownership_transfer':
        return <Users className="w-4 h-4 text-blue-500" />
      case 'system_alert':
        return <Bell className="w-4 h-4 text-purple-500" />
      default:
        return <Mail className="w-4 h-4 text-gray-500" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'border-l-red-500'
      case 'high':
        return 'border-l-orange-500'
      case 'medium':
        return 'border-l-yellow-500'
      default:
        return 'border-l-gray-300'
    }
  }

  const sendMessage = async (mode: 'paid' | 'comment') => {
    if (!vehicleId) return
    setSending(true)
    setSendError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(
          mode === 'paid'
            ? { stamp_id: selectedStampId, title: draftTitle, content: draftBody, message_type: 'user_message' }
            : { mode: 'comment', title: draftTitle, content: draftBody, message_type: 'comment' }
        )
      })
      if (res.ok) {
        toast.success(mode === 'paid' ? 'Sent with stamp (burned)' : 'Posted as comment (free)')
        setDraftTitle('')
        setDraftBody('')
        setShowCompose(false)
        await loadMessages()
        if (mode === 'paid') await loadStamps()
      } else {
        const err = await res.json().catch(() => ({}))
        setSendError(err?.message || 'Send failed')
      }
    } catch (error) {
      console.error(error)
      setSendError('Send failed')
    } finally {
      setSending(false)
    }
  }

  const purchaseStamp = async () => {
    setSending(true)
    setPurchaseError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`/api/stamps/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ count: 1, cost_cents_per_stamp: 1 })
      })
      if (res.ok) {
        toast.success('Stamp purchased')
        await loadStamps()
      } else {
        const err = await res.json().catch(() => ({}))
        setPurchaseError(err?.message || 'Purchase failed')
      }
    } catch (error) {
      console.error(error)
      setPurchaseError('Purchase failed')
    } finally {
      setSending(false)
    }
  }

  if (!mailbox) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  const unreadCount = messages.filter(m => !m.read_by?.includes('current_user')).length

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Gmail-style layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Gmail style */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
          {/* Compose button */}
          <button
            onClick={() => setShowCompose(true)}
            className="m-4 px-4 py-3 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
          >
            <Plus className="w-5 h-5" />
            Compose
          </button>

          {/* Navigation */}
          <nav className="flex-1 px-2 space-y-1">
            <button
              onClick={() => setActiveTab('messages')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'messages'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Inbox className="w-5 h-5" />
              <span>Inbox</span>
              {unreadCount > 0 && (
                <span className="ml-auto bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'settings'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Settings className="w-5 h-5" />
              <span>Mailbox Settings</span>
            </button>
          </nav>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-white border-b border-gray-200 px-6 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Vehicle Mailbox</h1>
                <p className="text-xs text-gray-600">VIN: {mailbox.vin}</p>
              </div>
              {unreadCount > 0 && (
                <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-semibold">
                  {unreadCount} unread
                </span>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex overflow-hidden">
            {/* Message list */}
            <div className="flex-1 overflow-y-auto bg-white">
              {activeTab === 'messages' && (
                <MessageList
                  messages={messages}
                  loading={loading}
                  onMarkAsRead={markMessageAsRead}
                  onResolve={resolveMessage}
                  onHandleDuplicate={handleDuplicateMessage}
                  onSelect={(msg) => setSelectedMessage(msg)}
                  getMessageIcon={getMessageIcon}
                  getPriorityColor={getPriorityColor}
                />
              )}

              {activeTab === 'settings' && (
                <div className="p-6 space-y-6">
                  {/* Access Management */}
                  {mailbox.user_access_level === 'read_write' && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Access Management</h3>
                      <AccessKeyManager vehicleId={vehicleId!} />
                    </div>
                  )}

                  {/* Stamps */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Stamps</h3>
                    <div className="space-y-3">
                      <div className="text-sm text-gray-600">
                        Owned: {stamps.filter(s => !s.is_burned).length}
                      </div>
                      <button
                        onClick={purchaseStamp}
                        disabled={sending}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm font-medium text-gray-700 transition-colors"
                      >
                        Buy Stamp ($0.01)
                      </button>
                      {purchaseError && (
                        <div className="text-sm text-red-600">{purchaseError}</div>
                      )}
                    </div>
                  </div>

                  {/* Notification Settings */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">Notification Settings</h3>
                    <p className="text-sm text-gray-600">Notification preferences coming soon.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right panel - Message detail */}
            {selectedMessage && activeTab === 'messages' && (
              <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
                <div className="p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">{selectedMessage.title}</h2>
                      <p className="text-xs text-gray-500">
                        {new Date(selectedMessage.created_at).toLocaleString()}
                      </p>
                    </div>
                    {getMessageIcon(selectedMessage.message_type, selectedMessage.priority)}
                  </div>

                  <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {selectedMessage.content}
                  </div>

                  {selectedMessage.metadata && (
                    <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(selectedMessage.metadata, null, 2)}</pre>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span>Type: {selectedMessage.message_type}</span>
                    <span>•</span>
                    <span>Priority: {selectedMessage.priority}</span>
                  </div>

                  {!selectedMessage.resolved_at ? (
                    <div className="flex gap-2">
                      <button
                        className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors"
                        onClick={() => resolveMessage(selectedMessage.id)}
                      >
                        Mark as Resolved
                      </button>
                      {selectedMessage.message_type === 'duplicate_detected' && (
                        <button
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
                          onClick={() => handleDuplicateMessage(selectedMessage)}
                        >
                          Review Duplicate
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-green-700 font-medium">Resolved</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">New Message</h3>
              <button
                onClick={() => {
                  setShowCompose(false)
                  setDraftTitle('')
                  setDraftBody('')
                  setSendError(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="Message title"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                <textarea
                  className="w-full border rounded px-3 py-2 text-sm"
                  rows={6}
                  placeholder="Your message..."
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                />
              </div>

              {/* Stamp selection */}
              {stamps.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Select Stamp</label>
                  <div className="flex flex-wrap gap-2">
                    {stamps.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedStampId(s.id)}
                        className={`px-3 py-1.5 border rounded text-xs ${
                          selectedStampId === s.id
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        {s.name || s.sku || 'Stamp'} ({s.remaining_uses ?? 1} uses)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sendError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{sendError}</div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                    disabled={sending || !selectedStampId}
                    onClick={() => sendMessage('paid')}
                  >
                    Send with Stamp
                  </button>
                  <button
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                    disabled={sending}
                    onClick={() => sendMessage('comment')}
                  >
                    Post as Comment (free)
                  </button>
                </div>
                {stamps.length === 0 && (
                  <button
                    onClick={purchaseStamp}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
                  >
                    Buy Stamp ($0.01)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Detection Modal */}
      {showDuplicateModal && selectedMessage && (
        <DuplicateDetectionModal
          message={selectedMessage}
          vehicleId={vehicleId!}
          onConfirm={(action) => handleDuplicateConfirmation(action)}
          onClose={() => {
            setShowDuplicateModal(false)
            setSelectedMessage(null)
          }}
        />
      )}
    </div>
  )
}

export default VehicleMailbox
