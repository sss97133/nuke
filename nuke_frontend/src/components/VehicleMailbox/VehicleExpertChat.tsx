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
  ui?: any
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
  variant?: 'floating' | 'panel' | 'embedded'
  defaultOpen?: boolean
  onDraftWorkOrder?: (draft: { title: string; description: string; urgency?: string; funds_committed?: { amount_cents: number; currency: 'USD' } | null }) => Promise<void>
}

export const VehicleExpertChat: React.FC<VehicleExpertChatProps> = ({
  vehicleId,
  vehicleVIN,
  vehicleYMM,
  vehicleNickname,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  variant = 'panel',
  defaultOpen,
  onDraftWorkOrder
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
      content:
        `Service advisor for ${vehicleDisplayName}.\n\n` +
        `Tell me what you want to do (repair, upgrade, diagnose, buy parts). I will:\n` +
        `- Ask only the minimum questions needed for fitment/scope\n` +
        `- Give parts options + labor options + estimated totals\n` +
        `- Offer a "do it for me" path (draft a work order and collect quotes)\n` +
        `If you want me to pick, say: "do it for me".`,
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (variant === 'embedded') return true
    if (typeof defaultOpen === 'boolean') return defaultOpen
    return variant === 'panel'
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [messages, isOpen])

  const renderAssistantUI = (ui: any) => {
    if (!ui || typeof ui !== 'object') return null
    const cards: any[] = Array.isArray(ui.cards) ? ui.cards : []
    if (cards.length === 0) return null

    return (
      <div className="space-y-2">
        {cards.map((card, idx) => {
          const type = String(card?.type || '')
          if (type === 'clarifying_questions' && Array.isArray(card?.questions) && card.questions.length > 0) {
            return (
              <div key={idx} className="border border-gray-300 bg-gray-50 p-2">
                <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Questions</div>
                <ul className="list-disc pl-4" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                  {card.questions.slice(0, 6).map((q: string, i: number) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )
          }

          if (type === 'estimate' && card?.totals) {
            const t = card.totals
            return (
              <div key={idx} className="border border-gray-300 bg-white p-2">
                <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Estimated total</div>
                <div style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                  <div><strong>Total:</strong> {t.total_low ? `$${t.total_low}` : '—'} to {t.total_high ? `$${t.total_high}` : '—'}</div>
                  <div><strong>Parts:</strong> {t.parts_low ? `$${t.parts_low}` : '—'} to {t.parts_high ? `$${t.parts_high}` : '—'}</div>
                  <div><strong>Labor:</strong> {t.labor_hours_low ?? '—'} to {t.labor_hours_high ?? '—'} hrs @ {t.labor_rate_usd_per_hr ?? '—'}/hr</div>
                </div>
                {Array.isArray(card?.assumptions) && card.assumptions.length > 0 && (
                  <div className="mt-2 text-gray-700" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                    <div className="font-semibold mb-1">Assumptions</div>
                    <ul className="list-disc pl-4">
                      {card.assumptions.slice(0, 6).map((a: string, i: number) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )
          }

          if (type === 'parts_options' && Array.isArray(card?.items) && card.items.length > 0) {
            return (
              <div key={idx} className="border border-gray-300 bg-white p-2">
                <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Parts options</div>
                <div className="space-y-2">
                  {card.items.slice(0, 6).map((item: any, i: number) => (
                    <div key={i} className="border border-gray-200 p-2">
                      <div className="font-semibold" style={{ fontSize: '8pt' }}>{item?.name || 'Part'}</div>
                      {item?.qty ? (
                        <div style={{ fontSize: '8pt' }} className="text-gray-700">Qty: {item.qty}</div>
                      ) : null}
                      {Array.isArray(item?.options) && item.options.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {item.options.slice(0, 3).map((opt: any, j: number) => (
                            <div key={j} style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                              <strong>{opt?.vendor || 'Option'}</strong>
                              {opt?.price_estimate_usd ? `: $${opt.price_estimate_usd}` : ''}
                              {opt?.part_number ? ` (PN: ${opt.part_number})` : ''}
                              {opt?.url ? (
                                <>
                                  {' '}<a href={opt.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>view</a>
                                </>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          }

          if (type === 'next_actions' && Array.isArray(card?.actions) && card.actions.length > 0) {
            return (
              <div key={idx} className="border border-gray-300 bg-white p-2">
                <div className="font-semibold mb-2" style={{ fontSize: '8pt' }}>Next actions</div>
                <div className="flex flex-wrap gap-2">
                  {card.actions.slice(0, 4).map((a: any, i: number) => {
                    const actionId = String(a?.id || '')
                    const label = String(a?.label || actionId || 'Action')
                    const draft = a?.payload?.work_order_draft

                    if (actionId === 'draft_work_order' && draft && onDraftWorkOrder) {
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onDraftWorkOrder(draft)}
                          className="px-3 py-1 border-2 border-gray-900 bg-white hover:bg-gray-100 font-semibold"
                          style={{ fontSize: '8pt' }}
                        >
                          {label}
                        </button>
                      )
                    }

                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          // If no handler, just paste a suggested command into the input.
                          const suggested = a?.payload?.suggested_user_text
                          if (typeof suggested === 'string' && suggested.trim()) setInput(suggested.trim())
                        }}
                        className="px-3 py-1 border-2 border-gray-300 bg-white hover:bg-gray-100 font-semibold"
                        style={{ fontSize: '8pt' }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          }

          return null
        })}
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isProcessing) return

    const currentInput = input.trim()

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsProcessing(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const formatInvokeError = async (err: any): Promise<string> => {
        const status = err?.context?.status
        const msg = err?.message ? String(err.message) : (status ? `Edge Function error ${status}` : 'Edge Function error')
        const body = err?.context?.body

        // supabase-js sometimes surfaces Response body as a ReadableStream; make it human readable.
        try {
          if (body && typeof body === 'object' && typeof (body as any).getReader === 'function') {
            const text = await new Response(body as any).text()
            return text ? `${msg}: ${text}` : msg
          }
        } catch {
          // ignore
        }

        if (typeof body === 'string') return body ? `${msg}: ${body}` : msg

        try {
          if (body && typeof body === 'object') return `${msg}: ${JSON.stringify(body)}`
        } catch {
          // ignore
        }

        return msg
      }

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
          userId: user.id,
          conversation_history: [...messages, userMessage].slice(-10).map(m => ({
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

      if (error) {
        throw new Error(await formatInvokeError(error))
      }

      // Some edge functions return a soft-fail payload instead of throwing.
      if ((data as any)?.skipped) {
        const reason = String((data as any)?.reason || 'skipped')
        const detail = String((data as any)?.detail || (data as any)?.error || '').trim()
        const friendly =
          reason === 'llm_unavailable'
            ? 'AI is temporarily unavailable (no provider key configured).'
            : 'AI was unable to answer right now.'
        const messageText = detail ? `${friendly}\n\n${detail}` : friendly

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: messageText,
          ui: (data as any)?.ui,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, assistantMessage])
        return
      }

      if ((data as any)?.error) throw new Error(String((data as any)?.error))

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data?.response || data?.text || data?.answer || data?.valuation?.summary || 'No response returned. Please try again.',
        ui: (data as any)?.ui,
        timestamp: new Date()
      }

      setMessages(prev => [...prev, assistantMessage])

    } catch (error: any) {
      const details =
        error?.message ||
        error?.context?.message ||
        (typeof error === 'string' ? error : '') ||
        (() => {
          try { return JSON.stringify(error) } catch { return '' }
        })()

      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `Error: ${details || 'Failed to process request. Please try again.'}`,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsProcessing(false)
      inputRef.current?.focus()
    }
  }

  if (!isOpen && variant !== 'embedded') {
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

  const containerClass =
    variant === 'embedded'
      ? 'w-full h-full bg-white flex flex-col'
      : variant === 'panel'
      ? 'fixed top-4 bottom-4 right-4 left-4 md:left-auto md:w-[45vw] md:min-w-[420px] md:max-w-[760px] bg-white border-2 border-gray-300 shadow-lg flex flex-col'
      : 'fixed bottom-4 right-4 w-80 h-96 bg-white border-2 border-gray-300 shadow-lg flex flex-col'

  const containerStyle: React.CSSProperties = { fontSize: '8pt' }

  return (
    <div className={containerClass} style={containerStyle}>
      {/* Header */}
      <div className={`${variant === 'embedded' ? 'bg-white border-b border-gray-200' : 'bg-gray-100 border-b-2 border-gray-300'} px-3 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center">
            <MessageCircle className="w-3 h-3 text-white" />
          </div>
          <span className="font-semibold" style={{ fontSize: '8pt' }}>{vehicleDisplayName} - Expert</span>
        </div>
        {variant !== 'embedded' && (
          <button
            onClick={() => setIsOpen(false)}
            className="text-gray-600 hover:text-gray-900"
            style={{ fontSize: '8pt' }}
          >
            ×
          </button>
        )}
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
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
              {message.role === 'assistant' && renderAssistantUI(message.ui)}
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

