import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, Mail, Settings, Users, AlertTriangle, CheckCircle, XCircle, Plus, Inbox, Send, Archive, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toast } from 'react-hot-toast'
import MessageList from './MessageList'
import AccessKeyManager from './AccessKeyManager'
import DuplicateDetectionModal from './DuplicateDetectionModal'
import VehicleExpertChat from './VehicleExpertChat'
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
  const [vehicleData, setVehicleData] = useState<{ year?: number; make?: string; model?: string; nickname?: string } | null>(null)
  const [activeTab, setActiveTab] = useState<'messages' | 'settings'>('messages')
  const [selectedMessage, setSelectedMessage] = useState<MailboxMessage | null>(null)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftUrgency, setDraftUrgency] = useState<'low' | 'normal' | 'high' | 'emergency'>('normal')
  const [draftFundsUsd, setDraftFundsUsd] = useState<string>('')
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
      loadVehicleData()
    }
  }, [vehicleId])

  // Set up real-time subscription only after mailbox is loaded
  useEffect(() => {
    if (!vehicleId || !mailbox?.id) return

    // Subscribe to real-time updates
    const subscription = supabase
      .channel(`mailbox:${vehicleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mailbox_messages'
      }, (payload) => {
        const newMessage = payload.new as MailboxMessage
        if (newMessage.mailbox_id === mailbox.id) {
          setMessages(prev => [newMessage, ...prev])
          toast.success('New message received')
        }
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
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

  const loadVehicleData = async () => {
    if (!vehicleId) return

    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('year, make, model, nickname')
        .eq('id', vehicleId)
        .single()

      if (error) throw error

      if (data) {
        setVehicleData({
          year: data.year,
          make: data.make,
          model: data.model,
          nickname: data.nickname
        })
      }
    } catch (error) {
      console.error('Error loading vehicle data:', error)
      // Don't show toast - this is optional data
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

  const draftWorkOrder = async () => {
    if (!vehicleId) return
    setSending(true)
    setSendError(null)
    try {
      const authHeaders = await getAuthHeaders()
      const amountUsd = Number(draftFundsUsd || 0)
      const amountCents = Number.isFinite(amountUsd) && amountUsd > 0 ? Math.floor(amountUsd * 100) : 0

      const res = await fetch(`/api/vehicles/${vehicleId}/mailbox/work-orders/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          title: draftTitle,
          description: draftBody,
          urgency: draftUrgency,
          funds_committed: amountCents > 0 ? { amount_cents: amountCents, currency: 'USD' } : null,
          source_message_ids: []
        })
      })

      if (res.ok) {
        toast.success('Work order drafted')
        setDraftTitle('')
        setDraftBody('')
        setDraftFundsUsd('')
        setDraftUrgency('normal')
        setShowCompose(false)
        await loadMessages()
      } else {
        const err = await res.json().catch(() => ({}))
        setSendError(err?.message || 'Draft failed')
      }
    } catch (error) {
      console.error(error)
      setSendError('Draft failed')
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
        <div className="w-64 bg-white border-r-2 border-gray-300 flex flex-col">
          {/* Compose button */}
          <button
            onClick={() => setShowCompose(true)}
            className="m-3 px-3 py-2 bg-gray-900 text-white border-2 border-gray-900 hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 font-semibold"
            style={{ fontSize: '8pt' }}
          >
            <Plus className="w-3 h-3" />
            Compose
          </button>

          {/* Navigation */}
          <nav className="flex-1 px-2 space-y-1">
            <button
              onClick={() => setActiveTab('messages')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 border-2 transition-colors ${
                activeTab === 'messages'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'text-gray-900 border-gray-300 hover:bg-gray-100'
              }`}
              style={{ fontSize: '8pt' }}
            >
              <Inbox className="w-3 h-3" />
              <span>Inbox</span>
              {unreadCount > 0 && (
                <span className="ml-auto bg-red-600 text-white px-1.5 py-0.5 rounded-full" style={{ fontSize: '7pt' }}>
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 border-2 transition-colors ${
                activeTab === 'settings'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'text-gray-900 border-gray-300 hover:bg-gray-100'
              }`}
              style={{ fontSize: '8pt' }}
            >
              <Settings className="w-3 h-3" />
              <span>Mailbox Settings</span>
            </button>
          </nav>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-white border-b-2 border-gray-300 px-4 py-2">
            <div className="flex items-center justify-between">
              <div style={{ fontSize: '8pt' }} className="text-gray-900 font-semibold">
                Vehicle Mailbox VIN: {mailbox.vin}
              </div>
              {unreadCount > 0 && (
                <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-semibold" style={{ fontSize: '8pt' }}>
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
                <div className="p-4 space-y-4">
                  {/* Access Management */}
                  {mailbox.user_access_level === 'read_write' && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-3" style={{ fontSize: '8pt' }}>Access Management</h3>
                      <AccessKeyManager vehicleId={vehicleId!} />
                    </div>
                  )}

                  {/* Stamps */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3" style={{ fontSize: '8pt' }}>Stamps</h3>
                    <div className="space-y-2">
                      <div className="text-gray-600" style={{ fontSize: '8pt' }}>
                        Owned: {stamps.filter(s => !s.is_burned).length}
                      </div>
                      <button
                        onClick={purchaseStamp}
                        disabled={sending}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 border-2 border-gray-300 text-gray-900 font-semibold transition-colors"
                        style={{ fontSize: '8pt' }}
                      >
                        Buy Stamp ($0.01)
                      </button>
                      {purchaseError && (
                        <div className="text-red-600" style={{ fontSize: '8pt' }}>{purchaseError}</div>
                      )}
                    </div>
                  </div>

                  {/* Notification Settings */}
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2" style={{ fontSize: '8pt' }}>Notification Settings</h3>
                    <p className="text-gray-600" style={{ fontSize: '8pt' }}>Notification preferences coming soon.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right panel - Message detail */}
            {selectedMessage && activeTab === 'messages' && (
              <div className="w-96 border-l-2 border-gray-300 bg-white overflow-y-auto">
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h2 className="font-semibold text-gray-900 mb-1" style={{ fontSize: '8pt' }}>{selectedMessage.title}</h2>
                      <p className="text-gray-500" style={{ fontSize: '8pt' }}>
                        {new Date(selectedMessage.created_at).toLocaleString()}
                      </p>
                    </div>
                    {getMessageIcon(selectedMessage.message_type, selectedMessage.priority)}
                  </div>

                  <div className="text-gray-700 leading-relaxed whitespace-pre-wrap" style={{ fontSize: '8pt' }}>
                    {selectedMessage.content}
                  </div>

                  {selectedMessage.metadata && (
                    <div className="text-gray-500 bg-gray-50 p-2 border-2 border-gray-300" style={{ fontSize: '8pt' }}>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(selectedMessage.metadata, null, 2)}</pre>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-gray-600" style={{ fontSize: '8pt' }}>
                    <span>Type: {selectedMessage.message_type}</span>
                    <span>•</span>
                    <span>Priority: {selectedMessage.priority}</span>
                  </div>

                  {!selectedMessage.resolved_at ? (
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1.5 bg-gray-900 text-white border-2 border-gray-900 hover:bg-gray-800 transition-colors font-semibold"
                        style={{ fontSize: '8pt' }}
                        onClick={() => resolveMessage(selectedMessage.id)}
                      >
                        Mark as Resolved
                      </button>
                      {selectedMessage.message_type === 'duplicate_detected' && (
                        <button
                          className="px-3 py-1.5 border-2 border-gray-300 text-gray-900 hover:bg-gray-100 transition-colors font-semibold"
                          style={{ fontSize: '8pt' }}
                          onClick={() => handleDuplicateMessage(selectedMessage)}
                        >
                          Review Duplicate
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-green-700 font-semibold" style={{ fontSize: '8pt' }}>Resolved</div>
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
          <div className="bg-white border-2 border-gray-300 w-full max-w-2xl mx-4">
            <div className="p-3 border-b-2 border-gray-300 flex items-center justify-between bg-gray-100">
              <h3 className="font-semibold text-gray-900" style={{ fontSize: '8pt' }}>New Message</h3>
              <button
                onClick={() => {
                  setShowCompose(false)
                  setDraftTitle('')
                  setDraftBody('')
                  setSendError(null)
                }}
                className="text-gray-600 hover:text-gray-900"
                style={{ fontSize: '8pt' }}
              >
                <XCircle className="w-3 h-3" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block font-semibold text-gray-900 mb-1" style={{ fontSize: '8pt' }}>Title</label>
                <input
                  className="w-full border-2 border-gray-300 px-2 py-1 focus:outline-none focus:border-gray-900"
                  style={{ fontSize: '8pt' }}
                  placeholder="Message title"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-900 mb-1" style={{ fontSize: '8pt' }}>Message</label>
                <textarea
                  className="w-full border-2 border-gray-300 px-2 py-1 focus:outline-none focus:border-gray-900"
                  style={{ fontSize: '8pt' }}
                  rows={6}
                  placeholder="Your message..."
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="block font-semibold text-gray-900 mb-1" style={{ fontSize: '8pt' }}>Urgency</label>
                  <select
                    className="w-full border-2 border-gray-300 px-2 py-1 focus:outline-none focus:border-gray-900"
                    style={{ fontSize: '8pt' }}
                    value={draftUrgency}
                    onChange={(e) => setDraftUrgency(e.target.value as any)}
                  >
                    <option value="low">low</option>
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                    <option value="emergency">emergency</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-gray-900 mb-1" style={{ fontSize: '8pt' }}>Funds committed (USD, optional)</label>
                  <input
                    className="w-full border-2 border-gray-300 px-2 py-1 focus:outline-none focus:border-gray-900"
                    style={{ fontSize: '8pt' }}
                    placeholder="1500"
                    inputMode="numeric"
                    value={draftFundsUsd}
                    onChange={(e) => setDraftFundsUsd(e.target.value)}
                  />
                </div>
              </div>

              {/* Stamp selection */}
              {stamps.length > 0 && (
                <div>
                  <label className="block font-semibold text-gray-900 mb-2" style={{ fontSize: '8pt' }}>Select Stamp</label>
                  <div className="flex flex-wrap gap-2">
                    {stamps.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedStampId(s.id)}
                        className={`px-2 py-1 border-2 transition-colors ${
                          selectedStampId === s.id
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-300 text-gray-900 hover:border-gray-600'
                        }`}
                        style={{ fontSize: '8pt' }}
                      >
                        {s.name || s.sku || 'Stamp'} ({s.remaining_uses ?? 1} uses)
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sendError && (
                <div className="text-red-600 bg-red-50 p-2 border-2 border-red-300" style={{ fontSize: '8pt' }}>{sendError}</div>
              )}

              <div className="flex items-center justify-between pt-3 border-t-2 border-gray-300">
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 bg-gray-900 text-white border-2 border-gray-900 hover:bg-gray-800 transition-colors disabled:opacity-50 font-semibold"
                    style={{ fontSize: '8pt' }}
                    disabled={sending || !selectedStampId}
                    onClick={() => sendMessage('paid')}
                  >
                    Send with Stamp
                  </button>
                  <button
                    className="px-3 py-1.5 border-2 border-gray-300 text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-50 font-semibold"
                    style={{ fontSize: '8pt' }}
                    disabled={sending}
                    onClick={() => sendMessage('comment')}
                  >
                    Post as Comment (free)
                  </button>
                  <button
                    className="px-3 py-1.5 border-2 border-gray-900 text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-50 font-semibold"
                    style={{ fontSize: '8pt' }}
                    disabled={sending || !draftTitle.trim() || !draftBody.trim()}
                    onClick={draftWorkOrder}
                  >
                    Draft Work Order
                  </button>
                </div>
                {stamps.length === 0 && (
                  <button
                    onClick={purchaseStamp}
                    className="px-3 py-1.5 bg-gray-100 text-gray-900 border-2 border-gray-300 hover:bg-gray-200 transition-colors font-semibold"
                    style={{ fontSize: '8pt' }}
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

      {/* Vehicle Expert AI Chat */}
      <VehicleExpertChat
        vehicleId={vehicleId!}
        vehicleVIN={mailbox.vin}
        vehicleYMM={vehicleData?.year && vehicleData?.make && vehicleData?.model 
          ? `${vehicleData.year} ${vehicleData.make} ${vehicleData.model}` 
          : undefined}
        vehicleNickname={vehicleData?.nickname}
        vehicleYear={vehicleData?.year}
        vehicleMake={vehicleData?.make}
        vehicleModel={vehicleData?.model}
      />
    </div>
  )
}

export default VehicleMailbox
