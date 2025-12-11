import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Bell, Mail, Settings, Users, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toast } from 'react-hot-toast'
import MessageList from './MessageList'
import AccessKeyManager from './AccessKeyManager'
import DuplicateDetectionModal from './DuplicateDetectionModal'
import { Link } from 'react-router-dom'
import CashBalance from '../trading/CashBalance'
import StampMarket from './StampMarket'

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
  const [activeTab, setActiveTab] = useState<'messages' | 'access' | 'settings'>('messages')
  const [selectedMessage, setSelectedMessage] = useState<MailboxMessage | null>(null)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
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
        return <AlertTriangle className={`w-5 h-5 ${priority === 'high' ? 'text-red-500' : 'text-yellow-500'}`} />
      case 'ownership_transfer':
        return <Users className="w-5 h-5 text-blue-500" />
      case 'system_alert':
        return <Bell className="w-5 h-5 text-purple-500" />
      default:
        return <Mail className="w-5 h-5 text-gray-500" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'border-l-red-500 bg-red-50'
      case 'high':
        return 'border-l-orange-500 bg-orange-50'
      case 'medium':
        return 'border-l-yellow-500 bg-yellow-50'
      default:
        return 'border-l-gray-500 bg-gray-50'
    }
  }

  if (!mailbox) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  const vehicleMailboxItems = mailbox ? [{
    id: mailbox.id,
    label: mailbox.vin ? `Vehicle ${mailbox.vin}` : 'Vehicle mailbox',
    unread: mailbox.message_count
  }] : []

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_320px] gap-4">
        {/* Far-left navigation */}
        <div className="space-y-3 bg-white shadow rounded-lg p-3 text-[10px]">
          <div className="border-b pb-2 font-semibold text-gray-900">File Navigation</div>
          <div className="space-y-2 text-gray-700">
            <div className="font-semibold text-gray-900">My Mailbox</div>
            <div className="text-gray-600">Personal mailbox coming soon.</div>
          </div>
          <div className="space-y-2 text-gray-700">
            <div className="font-semibold text-gray-900">Organization Mailboxes</div>
            <div className="text-gray-600">No organization mailboxes available yet.</div>
          </div>
          <div className="space-y-2 text-gray-700">
            <div className="font-semibold text-gray-900">Vehicle Mailboxes</div>
            <div className="divide-y divide-gray-200">
              {vehicleMailboxItems.length === 0 ? (
                <div className="py-2 text-gray-600">No vehicle mailbox found.</div>
              ) : vehicleMailboxItems.map((item) => (
                <Link
                  key={item.id}
                  to={`/vehicle/${vehicleId}/mailbox`}
                  className="flex items-center justify-between py-2 hover:bg-gray-50 transition-colors"
                >
                  <div className="text-left">
                    <div className="text-gray-900 font-medium">{item.label}</div>
                    <div className="text-gray-500 text-[9px]">Current vehicle</div>
                  </div>
                  {item.unread > 0 && (
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-[9px] font-semibold">
                      {item.unread} unread
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          <div className="border-t pt-2">
            <div className="text-gray-900 font-semibold mb-1">Wallet</div>
            <div className="text-[9px] text-gray-600 mb-1">Cash balance (stamps purchases)</div>
            <div className="text-[9px]">
              <CashBalance compact showActions={false} />
            </div>
          </div>
        </div>

        {/* Middle: message workspace */}
        <div className="space-y-3">
          <div className="bg-white shadow rounded-lg text-[10px]">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-bold text-gray-900">Vehicle Mailbox</div>
                <div className="text-gray-600">VIN: {mailbox.vin}</div>
                <div className="text-gray-600">Access Level: {mailbox.user_access_level}</div>
              </div>
              {mailbox.message_count > 0 && (
                <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-[9px] font-semibold">
                  {mailbox.message_count} unread
                </span>
              )}
            </div>
            <div className="px-4">
              <nav className="-mb-px flex space-x-4 overflow-x-auto text-[10px]">
                <button
                  onClick={() => setActiveTab('messages')}
                  className={`py-3 px-2 border-b-2 font-semibold ${
                    activeTab === 'messages'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Messages
                </button>
                {mailbox.user_access_level === 'read_write' && (
                  <button
                    onClick={() => setActiveTab('access')}
                    className={`py-3 px-2 border-b-2 font-semibold ${
                      activeTab === 'access'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    Access Management
                  </button>
                )}
                <button
                  onClick={() => setActiveTab('settings')}
                  className={`py-3 px-2 border-b-2 font-semibold ${
                    activeTab === 'settings'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Settings
                </button>
              </nav>
            </div>
          </div>

          {/* Compose with stamps + free comment */}
          <div className="bg-white shadow rounded-lg text-[10px] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-gray-900 font-semibold">Compose</div>
              <div className="text-gray-600 text-[9px]">Stamps: {stamps.length}</div>
            </div>
            <input
              className="w-full border rounded px-2 py-1 text-[10px]"
              placeholder="Title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
            <textarea
              className="w-full border rounded px-2 py-1 text-[10px]"
              rows={2}
              placeholder="Your message..."
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
            />
            <div className="flex items-center flex-wrap gap-2">
              {stamps.length === 0 ? (
                <div className="text-gray-600 text-[9px]">No stamps. Send as comment or acquire stamps.</div>
              ) : (
                stamps.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStampId(s.id)}
                    className={`px-2 py-1 border rounded text-[9px] ${
                      selectedStampId === s.id ? 'border-blue-500 text-blue-600' : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    {s.name || s.sku || 'Stamp'} · uses: {s.remaining_uses ?? 1}
                    {s.is_listed ? ' · listed' : ''}
                  </button>
                ))
              )}
            </div>
            {selectedStamp && (
              <div className="flex items-center gap-2 text-[9px]">
                {!selectedStamp.is_listed ? (
                  <button
                    className="px-2 py-1 border border-gray-300 rounded text-gray-700 hover:border-blue-500"
                    onClick={() => listStamp(selectedStamp.id)}
                  >
                    List for sale
                  </button>
                ) : (
                  <>
                    <span className="text-gray-600">Listed at ${((selectedStamp.list_price_cents || 0) / 100).toFixed(2)}</span>
                    <button
                      className="px-2 py-1 border border-gray-300 rounded text-gray-700 hover:border-blue-500"
                      onClick={() => unlistStamp(selectedStamp.id)}
                    >
                      Unlist
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button
                className="px-3 py-1 bg-blue-600 text-white rounded text-[10px] font-semibold disabled:opacity-50"
                disabled={sending || !selectedStampId}
                onClick={async () => {
                  setSending(true)
                  setSendError(null)
                  try {
                    const authHeaders = await getAuthHeaders()
                    const res = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...authHeaders },
                      body: JSON.stringify({
                        stamp_id: selectedStampId,
                        title: draftTitle,
                        content: draftBody,
                        message_type: 'user_message'
                      })
                    })
                    if (res.ok) {
                      toast.success('Sent with stamp (burned)')
                      setDraftTitle('')
                      setDraftBody('')
                      await loadMessages()
                      await loadStamps()
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
                }}
              >
                Send with Stamp
              </button>
              <button
                className="px-2 py-1 text-gray-700 text-[10px] font-semibold"
                disabled={sending}
                onClick={async () => {
                  setSending(true)
                  setSendError(null)
                  try {
                    const authHeaders = await getAuthHeaders()
                    const res = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...authHeaders },
                      body: JSON.stringify({
                        mode: 'comment',
                        title: draftTitle,
                        content: draftBody,
                        message_type: 'comment'
                      })
                    })
                    if (res.ok) {
                      toast.success('Posted as comment (free)')
                      setDraftTitle('')
                      setDraftBody('')
                      await loadMessages()
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
                }}
              >
                Post as Comment (free)
              </button>
              <button
                className="px-2 py-1 text-gray-700 text-[10px] font-semibold"
                disabled={sending}
                onClick={async () => {
                  setSending(true)
                  setPurchaseError(null)
                  try {
                    const authHeaders = await getAuthHeaders()
                    const res = await fetch(`/api/stamps/purchase`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...authHeaders },
                      body: JSON.stringify({ count: 1, cost_cents_per_stamp: 100 })
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
                }}
              >
                Buy Stamp ($1)
              </button>
            </div>
            {sendError && <div className="text-red-600 text-[9px]">{sendError}</div>}
            {purchaseError && <div className="text-red-600 text-[9px]">{purchaseError}</div>}
          </div>

          <div className="bg-white shadow rounded-lg text-[10px]">
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

            {activeTab === 'access' && mailbox.user_access_level === 'read_write' && (
              <div className="p-4 text-[10px]">
                <AccessKeyManager vehicleId={vehicleId!} />
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="p-4">
                <h3 className="text-[12px] font-semibold text-gray-900 mb-2">Notification Settings</h3>
                <p className="text-gray-600">Notification preferences coming soon.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: message detail / AI pane */}
        <div className="bg-white shadow rounded-lg p-4 text-[10px] space-y-3">
          <div className="border-b pb-2 font-semibold text-gray-900">Message Detail</div>
          {activeTab !== 'messages' && (
            <div className="text-gray-600">Switch to Messages to view details.</div>
          )}
          {activeTab === 'messages' && !selectedMessage && (
            <div className="text-gray-600">Select a message to view details.</div>
          )}
          {activeTab === 'messages' && selectedMessage && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-gray-900">{selectedMessage.title}</div>
                <span className="text-gray-500 text-[9px]">
                  {new Date(selectedMessage.created_at).toLocaleString()}
                </span>
              </div>
              <div className="text-gray-700 leading-snug">{selectedMessage.content}</div>
              {selectedMessage.metadata && (
                <div className="text-gray-500 text-[9px]">
                  Metadata: {JSON.stringify(selectedMessage.metadata)}
                </div>
              )}
              <div className="flex items-center justify-between text-gray-600 text-[9px]">
                <span>Type: {selectedMessage.message_type}</span>
                <span>Priority: {selectedMessage.priority}</span>
              </div>
              {!selectedMessage.resolved_at ? (
                <div className="flex space-x-2">
                  <button
                    className="text-blue-600 hover:text-blue-800 font-semibold"
                    onClick={() => resolveMessage(selectedMessage.id)}
                  >
                    Mark as Resolved
                  </button>
                  {selectedMessage.message_type === 'duplicate_detected' && (
                    <button
                      className="text-red-600 hover:text-red-800 font-semibold"
                      onClick={() => handleDuplicateMessage(selectedMessage)}
                    >
                      Review Duplicate
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-green-700 font-semibold">Resolved</div>
              )}
            </div>
          )}
        </div>

        {/* Marketplace */}
        <div className="xl:col-span-3">
          <StampMarket onPurchased={() => loadStamps()} />
        </div>
      </div>

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