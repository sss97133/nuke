/**
 * Vehicle Expert Chat Component
 * AI agent gated specifically to help with the user's vehicle
 */

import React, { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { MessageCircle, Send, Loader } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

interface VehicleExpertChatProps {
  vehicleId: string
  vehicleVIN?: string
  vehicleYMM?: string
  vehicleNickname?: string
  vehicleYear?: number
  vehicleMake?: string
  vehicleModel?: string
}

export const VehicleExpertChat: React.FC<VehicleExpertChatProps> = ({
  vehicleId,
  vehicleVIN,
  vehicleYMM,
  vehicleNickname,
  vehicleYear,
  vehicleMake,
  vehicleModel
}) => {
  // Determine vehicle display name: nickname > YMM > VIN
  const getVehicleDisplayName = (): string => {
    if (vehicleNickname) return vehicleNickname
    if (vehicleYMM) return vehicleYMM
    if (vehicleYear && vehicleMake && vehicleModel) {
      return `${vehicleYear} ${vehicleMake} ${vehicleModel}`
    }
    if (vehicleVIN) return vehicleVIN
    return 'Vehicle'
  }

  const vehicleDisplayName = getVehicleDisplayName()
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: `I am ${vehicleDisplayName}. I am the vehicle itself, fully self-aware of my own history, maintenance records, repairs, parts, and value. Ask me anything about myself - I have complete access to all my data and can help you make informed decisions.`,
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [messages, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isProcessing) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    const currentInput = input.trim()
    setInput('')
    setIsProcessing(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Call vehicle-specific AI chat edge function
      // First try vehicle-expert-agent, fallback to generic chat
      const { data, error } = await supabase.functions.invoke('vehicle-expert-agent', {
        body: {
          vehicleId: vehicleId,
          question: currentInput,
          vehicle_vin: vehicleVIN,
          vehicle_nickname: vehicleNickname,
          vehicle_ymm: vehicleYMM,
          vehicle_year: vehicleYear,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          conversation_history: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content
          }))
        }
      }).catch(async () => {
        // Fallback to generic vehicle chat if expert agent not available
        return await supabase.functions.invoke('ai-agent-supervisor', {
          body: {
            vehicle_id: vehicleId,
            question: currentInput,
            user_id: user.id
          }
        })
      })

      if (error) throw error

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data?.response || data?.answer || data?.valuation?.summary || 'I processed your request.',
        timestamp: new Date()
      }

      setMessages(prev => [...prev, assistantMessage])

    } catch (error: any) {
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to process request. Please try again.'}`,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsProcessing(false)
      inputRef.current?.focus()
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-gray-900 text-white rounded-full p-3 shadow-lg hover:bg-gray-800 transition-colors flex items-center justify-center"
        style={{ fontSize: '8pt' }}
        title={`Chat with ${vehicleDisplayName}`}
      >
        <MessageCircle className="w-4 h-4" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 w-80 h-96 bg-white border-2 border-gray-300 shadow-lg flex flex-col"
      style={{ fontSize: '8pt' }}>
      {/* Header */}
      <div className="bg-gray-100 border-b-2 border-gray-300 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center">
            <MessageCircle className="w-3 h-3 text-white" />
          </div>
          <span className="font-semibold" style={{ fontSize: '8pt' }}>{vehicleDisplayName}</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-600 hover:text-gray-900"
          style={{ fontSize: '8pt' }}
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-white">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-2 py-1 rounded ${
                message.role === 'user'
                  ? 'bg-gray-900 text-white'
                  : message.role === 'system'
                  ? 'bg-gray-100 text-gray-700 border border-gray-300'
                  : 'bg-gray-50 text-gray-900 border border-gray-300'
              }`}
              style={{ fontSize: '8pt', lineHeight: '1.3' }}
            >
              {message.content}
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-gray-50 border border-gray-300 px-2 py-1 rounded flex items-center gap-1"
              style={{ fontSize: '8pt' }}>
              <Loader className="w-3 h-3 animate-spin" />
              <span>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t-2 border-gray-300 p-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your vehicle..."
            className="flex-1 border-2 border-gray-300 px-2 py-1 focus:outline-none focus:border-gray-900"
            style={{ fontSize: '8pt' }}
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={!input.trim() || isProcessing}
            className="bg-gray-900 text-white px-3 py-1 border-2 border-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontSize: '8pt' }}
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </form>
    </div>
  )
}

export default VehicleExpertChat

