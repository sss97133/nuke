import { useState, useEffect } from 'react'
import { MessageSquare, Smartphone, Apple, AlertTriangle, Search, Link as LinkIcon } from 'lucide-react'
import toast from 'react-hot-toast'

type MessageSource = 'imessage' | 'ios_backup' | 'android'

interface ConversationThread {
  id: string
  participants: string[]
  messages: MessageItem[]
  matchedDealFields: string[]
}

interface MessageItem {
  id: string
  sender: string
  text: string
  date: string
  isFromMe: boolean
}

export default function Messages() {
  const [source, setSource] = useState<MessageSource | null>(null)
  const [hasFullDiskAccess, setHasFullDiskAccess] = useState<boolean | null>(null)
  const [conversations, setConversations] = useState<ConversationThread[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.checkFullDiskAccess().then(setHasFullDiskAccess)
    }
  }, [])

  const handleSourceSelect = async (s: MessageSource) => {
    setSource(s)
    if (s === 'imessage' && !hasFullDiskAccess) return
    // Placeholder - will be populated when message readers are implemented
    toast('Message reading will be available soon')
  }

  const sources: { id: MessageSource; label: string; desc: string; icon: typeof Apple; available: boolean }[] = [
    {
      id: 'imessage',
      label: 'iMessage (Mac)',
      desc: 'Read messages directly from this Mac. Requires Full Disk Access.',
      icon: Apple,
      available: process.platform === 'darwin',
    },
    {
      id: 'ios_backup',
      label: 'iOS Backup',
      desc: 'Read messages from a local iPhone backup on this computer.',
      icon: Smartphone,
      available: true,
    },
    {
      id: 'android',
      label: 'Android SMS',
      desc: 'Import SMS backup XML file from "SMS Backup & Restore" app.',
      icon: Smartphone,
      available: true,
    },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 mt-12">
      <div className="flex items-center gap-2 mb-6">
        <MessageSquare className="w-5 h-5 text-gray-700" />
        <h1 className="text-xl font-semibold text-gray-900">Text Messages</h1>
      </div>

      <p className="text-sm text-gray-600 mb-6">
        Extract text message conversations about deals. Messages are matched to deals by VIN, customer name, and deal amounts.
      </p>

      {/* Source selector */}
      {!source && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Select Message Source</h2>
          {sources.filter(s => s.available).map(s => (
            <button
              key={s.id}
              onClick={() => handleSourceSelect(s.id)}
              className="w-full flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors text-left"
            >
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <s.icon className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{s.label}</p>
                <p className="text-xs text-gray-500">{s.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* iMessage - Full Disk Access required */}
      {source === 'imessage' && hasFullDiskAccess === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-900">Full Disk Access Required</h2>
          </div>
          <p className="text-sm text-amber-800 mb-4">
            To read iMessages, DealerScan needs Full Disk Access permission.
          </p>
          <ol className="text-sm text-amber-800 space-y-2 list-decimal list-inside mb-4">
            <li>Open <strong>System Settings</strong> (Apple menu)</li>
            <li>Go to <strong>Privacy & Security</strong> &gt; <strong>Full Disk Access</strong></li>
            <li>Click the <strong>+</strong> button and add <strong>DealerScan</strong></li>
            <li>Restart DealerScan</li>
          </ol>
          <button
            onClick={() => setSource(null)}
            className="text-sm text-amber-700 font-medium hover:text-amber-800"
          >
            Choose different source
          </button>
        </div>
      )}

      {/* Conversation browser (placeholder for when readers are connected) */}
      {source && !(source === 'imessage' && hasFullDiskAccess === false) && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setSource(null)} className="text-sm text-gray-500 hover:text-gray-700">
              Change source
            </button>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by VIN, name, phone..."
                className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64"
              />
            </div>
          </div>

          {conversations.length === 0 && (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900">No conversations loaded</h3>
              <p className="mt-1 text-sm text-gray-500">
                Message reading is being set up. Check back soon.
              </p>
            </div>
          )}

          {conversations.map(thread => (
            <div key={thread.id} className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-900">{thread.participants.join(', ')}</p>
                {thread.matchedDealFields.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                    <LinkIcon className="w-3 h-3" /> Matched
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {thread.messages.slice(0, 5).map(msg => (
                  <div key={msg.id} className={`text-xs p-2 rounded ${msg.isFromMe ? 'bg-blue-50 text-blue-900 ml-8' : 'bg-gray-50 text-gray-700 mr-8'}`}>
                    <p>{msg.text}</p>
                    <p className="text-gray-400 mt-0.5">{new Date(msg.date).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
