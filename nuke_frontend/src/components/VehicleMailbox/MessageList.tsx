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
              <div className="flex items-center space-x-3 py-3 border-b border-gray-100">
                <div className="rounded-full bg-gray-200 h-10 w-10"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
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
      <div className="p-12 text-center">
        <div className="text-gray-400">
          <Clock className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p className="text-sm text-gray-500">No messages in this mailbox yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-200">
      {messages.map((message) => {
        const read = isMessageRead(message)
        return (
          <div
            key={message.id}
            onClick={() => handleMessageClick(message)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors border-l-4 ${getPriorityColor(
              message.priority
            )} ${!read ? 'bg-blue-50 font-medium' : 'bg-white'}`}
          >
            {/* Checkbox area */}
            <div className="flex-shrink-0">
              <input
                type="checkbox"
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Star */}
            <div className="flex-shrink-0">
              <Star className="w-4 h-4 text-gray-400 hover:text-yellow-400" />
            </div>

            {/* Icon */}
            <div className="flex-shrink-0">
              {getMessageIcon(message.message_type, message.priority)}
            </div>

            {/* Sender */}
            <div className="flex-shrink-0 w-32">
              <div className={`text-sm ${!read ? 'text-gray-900 font-semibold' : 'text-gray-700'}`}>
                {getSenderName(message)}
              </div>
            </div>

            {/* Subject and snippet */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm truncate ${!read ? 'text-gray-900 font-semibold' : 'text-gray-700'}`}>
                  {message.title}
                </span>
                {!read && (
                  <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0"></span>
                )}
                {message.priority === 'urgent' && (
                  <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0">
                    URGENT
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 truncate mt-0.5">
                {getSnippet(message.content)}
              </div>
            </div>

            {/* Date */}
            <div className="flex-shrink-0 text-xs text-gray-500 w-20 text-right">
              {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
            </div>

            {/* Resolved indicator */}
            {message.resolved_at && (
              <div className="flex-shrink-0">
                <CheckCircle className="w-4 h-4 text-green-600" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default MessageList
