/**
 * WIRING QUERY CONTEXT BAR
 * 
 * Context bar for natural language wiring queries
 * Similar to IMG GO bar, but for wiring/parts queries
 * 
 * Example queries:
 * - "I need a motec wiring harness for my vehicle"
 * - "What wiring do I need for this build?"
 * - "Get me a quote for motec ECU and wiring"
 */

import React, { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface WiringQueryContextBarProps {
  vehicleId: string
  vehicleInfo?: {
    year?: number
    make?: string
    model?: string
  }
  onQuoteGenerated?: (quote: any) => void
  className?: string
}

export default function WiringQueryContextBar({
  vehicleId,
  vehicleInfo,
  onQuoteGenerated,
  className = ''
}: WiringQueryContextBarProps) {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quoteResult, setQuoteResult] = useState<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isProcessing && input.trim()) {
      handleQuery()
    }
  }

  const handleQuery = async () => {
    if (!input.trim() || isProcessing) return

    // This UI is intentionally lightweight: wiring output belongs on a dedicated page.
    const q = input.trim()
    setError(null)
    setQuoteResult(null)
    navigate(`/vehicle/${vehicleId}/wiring?q=${encodeURIComponent(q)}`)
    setInput('')
  }

  // Detect if user is mid-project (has recent timeline events or images)
  const [isMidProject, setIsMidProject] = useState(false)
  React.useEffect(() => {
    const checkProjectStatus = async () => {
      try {
        const { data: timeline } = await supabase
          .from('timeline_events')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .gte('event_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1)

        const { data: images } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1)

        setIsMidProject((timeline && timeline.length > 0) || (images && images.length > 0))
      } catch (err) {
        console.error('Error checking project status:', err)
      }
    }

    if (vehicleId) {
      checkProjectStatus()
    }
  }, [vehicleId])

  // Smart placeholder based on project status
  const placeholder = isMidProject
    ? "What wiring do you need for this build?"
    : "I need a motec wiring harness for my vehicle..."

  return (
    <div className={className}>
      {/* Context Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'var(--white)',
          border: '2px solid var(--border)',
          padding: '4px 6px',
          height: '28px',
          transition: '0.12s',
          borderRadius: '2px'
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: '8pt',
            fontFamily: '"MS Sans Serif", sans-serif',
            background: 'transparent',
            minWidth: 0,
            height: '100%',
            padding: 0
          }}
        />

        {/* Query Button */}
        <button
          type="button"
          onClick={handleQuery}
          disabled={isProcessing || !input.trim()}
          className="button-win95"
          style={{
            padding: '2px 8px',
            fontSize: '8pt',
            height: '20px',
            minWidth: '35px',
            opacity: (isProcessing || !input.trim()) ? 0.5 : 1,
            cursor: (isProcessing || !input.trim()) ? 'not-allowed' : 'pointer'
          }}
          title="Open Wiring Plan"
        >
          {isProcessing ? '...' : 'PLAN'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            marginTop: '4px',
            padding: '4px 8px',
            background: '#ffebee',
            border: '1px solid #f44336',
            borderRadius: '2px',
            fontSize: '8pt',
            color: '#c62828'
          }}
        >
          {error}
        </div>
      )}

      {/* Quote Result Display */}
      {/* Results intentionally not rendered here; Wiring Plan lives on /vehicle/:id/wiring */}
    </div>
  )
}

