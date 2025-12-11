import React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle, AlertTriangle, Clock, ExternalLink, Star } from 'lucide-react'

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

interface MessageListProps {
  messages: MailboxMessage[]
  loading: boolean
  onMarkAsRead: (messageId: string) => void
  onResolve: (messageId: string, resolutionData?: Record<string, any>) => void
  onHandleDuplicate: (message: MailboxMessage) => void
  onSelect?: (message: MailboxMessage) => void
  getMessageIcon: (messageType: string, priority: string) => JSX.Element
  getPriorityColor: (priority: string) => string
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  loading,
  onMarkAsRead,
  onResolve,
  onHandleDuplicate,
  onSelect,
  getMessageIcon,
  getPriorityColor
}) => {
  const isMessageRead = (message: MailboxMessage) => {
    return message.read_by && message.read_by.includes('current_user')
  }

  const handleMessageClick = (message: MailboxMessage) => {
    if (!isMessageRead(message)) {
      onMarkAsRead(message.id)
    }
    if (onSelect) {
      onSelect(message)
    }
  }

  const getSenderName = (message: MailboxMessage) => {
    if (message.sender_type === 'system') return 'System'
    if (message.metadata?.sender_name) return message.metadata.sender_name
    return 'User'
  }

  const getSnippet = (content: string, maxLength: number = 80) => {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + '...'
  }

  if (loading) {
    return (
      <div className="p-4">
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-center space-x-2 py-2 border-b-2 border-gray-200">
                <div className="rounded-full bg-gray-200 h-6 w-6"></div>
                <div className="flex-1 space-y-1">
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-2 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-400">
          <Clock className="w-8 h-8 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500" style={{ fontSize: '8pt' }}>No messages in this mailbox yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y-2 divide-gray-200">
      {messages.map((message) => {
        const read = isMessageRead(message)
        return (
          <div
            key={message.id}
            onClick={() => handleMessageClick(message)}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors border-l-2 ${getPriorityColor(
              message.priority
            )} ${!read ? 'bg-gray-100 font-semibold' : 'bg-white'}`}
            style={{ fontSize: '8pt' }}
          >
            {/* Checkbox area */}
            <div className="flex-shrink-0">
              <input
                type="checkbox"
                className="w-3 h-3 text-gray-900 border-2 border-gray-300"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Star */}
            <div className="flex-shrink-0">
              <Star className="w-3 h-3 text-gray-400 hover:text-gray-600" />
            </div>

            {/* Icon */}
            <div className="flex-shrink-0">
              {getMessageIcon(message.message_type, message.priority)}
            </div>

            {/* Sender */}
            <div className="flex-shrink-0 w-32">
              <div className={`${!read ? 'text-gray-900 font-semibold' : 'text-gray-700'}`} style={{ fontSize: '8pt' }}>
                {getSenderName(message)}
              </div>
            </div>

            {/* Subject and snippet */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`truncate ${!read ? 'text-gray-900 font-semibold' : 'text-gray-700'}`} style={{ fontSize: '8pt' }}>
                  {message.title}
                </span>
                {!read && (
                  <span className="w-1.5 h-1.5 bg-gray-900 rounded-full flex-shrink-0"></span>
                )}
                {message.priority === 'urgent' && (
                  <span className="bg-red-100 text-red-800 px-1 py-0.5 rounded font-semibold flex-shrink-0" style={{ fontSize: '7pt' }}>
                    URGENT
                  </span>
                )}
              </div>
              <div className="text-gray-500 truncate mt-0.5" style={{ fontSize: '8pt' }}>
                {getSnippet(message.content)}
              </div>
            </div>

            {/* Date */}
            <div className="flex-shrink-0 text-gray-500 w-20 text-right" style={{ fontSize: '8pt' }}>
              {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
            </div>

            {/* Resolved indicator */}
            {message.resolved_at && (
              <div className="flex-shrink-0">
                <CheckCircle className="w-3 h-3 text-green-600" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default MessageList
