/**
 * Vehicle Expert Chat Component
 * AI agent gated specifically to help with the user's vehicle
 */

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { MessageCircle, Send, Loader } from 'lucide-react'
import { SmartInvoiceUploader } from '../SmartInvoiceUploader'
import { ModelHarnessAnnotator } from '../wiring/ModelHarnessAnnotator'
import ErrorBoundary from '../ErrorBoundary'

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
        `- Ask for missing evidence and let you upload receipts/manuals into this vehicle when needed\n` +
        `If you want me to pick, say: "do it for me".`,
      timestamp: new Date()
    }
  ])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showUploader, setShowUploader] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [activeModelPath, setActiveModelPath] = useState<string | null>(null)
  const [activeModelSignedUrl, setActiveModelSignedUrl] = useState<string | null>(null)
  const [activeModelBucket, setActiveModelBucket] = useState<string>('vehicle-models')
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelError, setModelError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (variant === 'embedded') return true
    if (typeof defaultOpen === 'boolean') return defaultOpen
    return variant === 'panel'
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const modelFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [messages, isOpen])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        if (mounted) setUserId(data.user?.id || null)
      } catch {
        if (mounted) setUserId(null)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const modelBucket = 'vehicle-models'

  const allowManualModelAttach = Boolean((import.meta as any)?.env?.VITE_ENABLE_DEBUG === 'true')

  const refreshModelSignedUrl = useCallback(async (bucket: string, path: string) => {
    setModelStatus('loading')
    setModelError(null)
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60) // 1 hour
    if (error) {
      setActiveModelSignedUrl(null)
      setModelStatus('error')
      setModelError(error.message || 'Failed to load model')
      return
    }
    setActiveModelBucket(bucket)
    setActiveModelPath(path)
    setActiveModelSignedUrl(data.signedUrl)
    setModelStatus('ready')
  }, [])

  const loadModelFromRegistry = useCallback(async (): Promise<boolean> => {
    // Registry lookups are for "system catalog" models. If we already have a user model, keep it.
    if (!userId) return false
    if (activeModelSignedUrl) return true

    // Prefer vehicle-specific model, then fall back to Y/M/M (catalog).
    try {
      setModelStatus('loading')
      setModelError(null)

      const select = 'bucket, object_path, format, year, make, model, is_public'

      const byVehicle = await supabase
        .from('vehicle_3d_models')
        .select(select)
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(1)

      if (!byVehicle.error && Array.isArray(byVehicle.data) && byVehicle.data.length > 0) {
        const row: any = byVehicle.data[0]
        const bucket = String(row?.bucket || modelBucket)
        const path = String(row?.object_path || '')
        if (path) {
          await refreshModelSignedUrl(bucket, path)
          return true
        }
      }

      // Fallback: make/model/year catalog match (public entries only by RLS)
      if (vehicleYear && vehicleMake && vehicleModel) {
        const escapeILike = (s: string) => String(s || '').replace(/([%_\\])/g, '\\$1')
        const makeSafe = escapeILike(vehicleMake)
        const modelSafe = escapeILike(vehicleModel)
        const byYmm = await supabase
          .from('vehicle_3d_models')
          .select(select)
          .eq('year', vehicleYear)
          // Escape `%`, `_`, `\` so user-controlled strings can't inject LIKE patterns.
          .ilike('make', makeSafe)
          .ilike('model', modelSafe)
          .order('created_at', { ascending: false })
          .limit(1)

        if (!byYmm.error && Array.isArray(byYmm.data) && byYmm.data.length > 0) {
          const row: any = byYmm.data[0]
          const bucket = String(row?.bucket || modelBucket)
          const path = String(row?.object_path || '')
          if (path) {
            await refreshModelSignedUrl(bucket, path)
            return true
          }
        }
      }

      // No registry match; do not treat as an error.
      setModelStatus('idle')
      return false
    } catch (e: any) {
      setModelStatus('error')
      setModelError(e?.message || 'Failed to load model from registry')
      return false
    }
  }, [activeModelSignedUrl, modelBucket, refreshModelSignedUrl, userId, vehicleId, vehicleMake, vehicleModel, vehicleYear])

  const loadLatestModelForVehicle = useCallback(async (): Promise<boolean> => {
    if (!userId) return false
    setModelError(null)
    setModelStatus('loading')
    try {
      const prefix = `${userId}/${vehicleId}/`
      const { data, error } = await supabase.storage.from(modelBucket).list(prefix, {
        limit: 50,
        sortBy: { column: 'created_at', order: 'desc' }
      } as any)
      if (error) throw error
      const files = (data || []).filter((o: any) => typeof o?.name === 'string')
      const pick = files.find((f: any) => String(f.name).toLowerCase().endsWith('.glb')) ||
        files.find((f: any) => String(f.name).toLowerCase().endsWith('.fbx')) ||
        null
      if (!pick) {
        setModelStatus('idle')
        setActiveModelPath(null)
        setActiveModelSignedUrl(null)
        return false
      }
      await refreshModelSignedUrl(modelBucket, prefix + pick.name)
      return true
    } catch (e: any) {
      setModelStatus('error')
      setModelError(e?.message || 'Failed to list models')
      return false
    }
  }, [refreshModelSignedUrl, userId, vehicleId])

  // Auto-load: if the user has an uploaded model, use it; otherwise fall back to the catalog registry.
  useEffect(() => {
    if (!isOpen) return
    if (!userId) return
    if (activeModelSignedUrl) return
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    ;(async () => {
      const loadedUserModel = await loadLatestModelForVehicle()
      if (!loadedUserModel) {
        await loadModelFromRegistry()
      }
    })()
    // We intentionally omit activeModelSignedUrl from deps to avoid loop while it is being set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, userId, vehicleId])

  // If the assistant requests a model UI card, load it automatically (no user pasted URL).
  useEffect(() => {
    const last = [...messages].reverse().find(m => m.role === 'assistant' && m.ui && typeof m.ui === 'object') as any
    const cards: any[] = Array.isArray(last?.ui?.cards) ? last.ui.cards : []
    const modelCard = cards.find(c => String(c?.type || '') === 'model_viewer')
    const bucket = typeof modelCard?.bucket === 'string' ? modelCard.bucket : null
    const path = typeof modelCard?.path === 'string' ? modelCard.path : null
    if (!bucket || !path) return
    if (activeModelPath === path && activeModelBucket === bucket && activeModelSignedUrl) return
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    refreshModelSignedUrl(bucket, path)
  }, [activeModelBucket, activeModelPath, activeModelSignedUrl, messages, refreshModelSignedUrl])

  const renderAssistantUI = (ui: any) => {
    if (!ui || typeof ui !== 'object') return null
    const cards: any[] = Array.isArray(ui.cards) ? ui.cards : []
    if (cards.length === 0) return null

    const normalizeExternalUrl = (rawUrl: unknown): string | null => {
      if (typeof rawUrl !== 'string') return null
      const s = rawUrl.trim()
      if (!s) return null
      // Prevent relative URLs ("/foo") which would send users to n-zero.dev/foo (often 404).
      if (s.startsWith('/')) return null
      // Handle "www.vendor.com/..." without protocol
      const withProtocol = s.startsWith('http://') || s.startsWith('https://') ? s : (s.startsWith('www.') ? `https://${s}` : s)
      try {
        const u = new URL(withProtocol)
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
        // Basic allowlist: keep users on real commerce/search pages, avoid model hallucinating random domains.
        const host = u.hostname.toLowerCase()
        const allowedBaseDomains = ['summitracing.com', 'jegs.com', 'rockauto.com']
        const isAllowedHost = (h: string, allowedBase: string) => {
          if (h === allowedBase) return true
          if (h === `www.${allowedBase}`) return true
          const suffix = `.${allowedBase}`
          if (!h.endsWith(suffix)) return false
          const sub = h.slice(0, -suffix.length)
          // Only allow a single-label subdomain (prevents deep-subdomain impersonation).
          if (!sub || sub.includes('.')) return false
          return /^[a-z0-9-]+$/.test(sub)
        }
        if (!allowedBaseDomains.some(d => isAllowedHost(host, d))) return null
        return u.toString()
      } catch {
        return null
      }
    }

    return (
      <div className="space-y-2">
        {cards.map((card, idx) => {
          const type = String(card?.type || '')
          if (type === 'context_snapshot') {
            const counts = card?.counts || {}
            const recentDocs: any[] = Array.isArray(card?.recent_documents) ? card.recent_documents : []
            const receiptLikeImages: any[] = Array.isArray(card?.receipt_like_images) ? card.receipt_like_images : []
            const suggestions: any[] = Array.isArray(card?.next_suggestions) ? card.next_suggestions : []

            return (
              <div key={idx} className="border border-gray-300 bg-white p-2">
                <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Context</div>
                <div style={{ fontSize: '8pt', lineHeight: '1.35' }} className="text-gray-800">
                  <div><strong>Docs:</strong> {counts.vehicle_documents_loaded ?? '—'} (receipts {counts.receipts_in_vehicle_documents ?? '—'}, manuals {counts.manuals_in_vehicle_documents ?? '—'})</div>
                  <div><strong>Receipt-like images:</strong> {counts.receipt_like_images ?? '—'}</div>
                  <div><strong>Timeline events:</strong> {counts.timeline_events_loaded ?? '—'}</div>
                </div>

                {recentDocs.length > 0 && (
                  <div className="mt-2">
                    <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Recent documents</div>
                    <ul className="list-disc pl-4" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                      {recentDocs.slice(0, 6).map((d: any, i: number) => {
                        const ref = String(d?.ref || '')
                        const label = [d?.document_type, d?.title].filter(Boolean).join(': ')
                        return (
                          <li key={i}>
                            {label || ref}
                            {ref ? (
                              <>
                                {' '}
                                <button
                                  type="button"
                                  className="underline text-gray-900"
                                  onClick={() => sendCommand(`/open ${ref}`)}
                                  title="Open and inspect this source"
                                >
                                  open
                                </button>
                                {' '}
                                <button
                                  type="button"
                                  className="underline text-gray-900"
                                  onClick={() => setInput(prev => `${(prev || '').trim()} ${ref}`.trim())}
                                  title="Attach this reference to your next message"
                                >
                                  attach
                                </button>
                              </>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {receiptLikeImages.length > 0 && (
                  <div className="mt-2">
                    <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Receipt-like images</div>
                    <ul className="list-disc pl-4" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                      {receiptLikeImages.slice(0, 6).map((img: any, i: number) => {
                        const ref = String(img?.ref || '')
                        const label = [img?.classification, img?.category, img?.caption].filter(Boolean).join(' — ')
                        return (
                          <li key={i}>
                            {label || ref}
                            {ref ? (
                              <>
                                {' '}
                                <button
                                  type="button"
                                  className="underline text-gray-900"
                                  onClick={() => sendCommand(`/open ${ref}`)}
                                  title="Open and inspect this source"
                                >
                                  open
                                </button>
                                {' '}
                                <button
                                  type="button"
                                  className="underline text-gray-900"
                                  onClick={() => setInput(prev => `${(prev || '').trim()} ${ref}`.trim())}
                                  title="Attach this reference to your next message"
                                >
                                  attach
                                </button>
                              </>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestions.slice(0, 4).map((a: any, i: number) => {
                      const actionId = String(a?.id || '')
                      const label = String(a?.label || actionId || 'Action')
                      const suggested = a?.payload?.suggested_user_text
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            if (typeof suggested === 'string' && suggested.trim()) setInput(suggested.trim())
                          }}
                          className="px-2 py-1 border-2 border-gray-300 bg-white hover:bg-gray-100 font-semibold"
                          style={{ fontSize: '8pt' }}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          if (type === 'model_viewer') {
            const title = String(card?.title || '3D model')
            return (
              <div key={idx} className="border border-gray-300 bg-white p-2">
                <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>{title}</div>
                <div style={{ fontSize: '8pt', lineHeight: '1.35' }} className="text-gray-700">
                  The 3D panel should appear above once the model is loaded.
                </div>
              </div>
            )
          }

          if (type === 'search_results') {
            const query = String(card?.query || '')
            const totals = card?.totals || {}
            const results: any[] = Array.isArray(card?.results) ? card.results : []

            return (
              <div key={idx} className="border border-gray-300 bg-white p-2">
                <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Search results</div>
                <div style={{ fontSize: '8pt', lineHeight: '1.35' }} className="text-gray-700">
                  <div><strong>Query:</strong> {query || '—'}</div>
                  <div><strong>Matches:</strong> docs {totals.documents ?? 0}, images {totals.images ?? 0}, events {totals.timeline_events ?? 0}</div>
                </div>
                {results.length > 0 ? (
                  <ul className="mt-2 list-disc pl-4" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                    {results.slice(0, 10).map((r: any, i: number) => {
                      const ref = String(r?.ref || '')
                      const title = String(r?.title || ref || 'Result')
                      const subtitle = String(r?.subtitle || '')
                      return (
                        <li key={i}>
                          <strong>{title}</strong>{subtitle ? ` — ${subtitle}` : ''}
                          {ref ? (
                            <>
                              {' '}
                              <button
                                type="button"
                                className="underline text-gray-900"
                                onClick={() => sendCommand(`/open ${ref}`)}
                                title="Open and inspect this source"
                              >
                                open
                              </button>
                              {' '}
                              <button
                                type="button"
                                className="underline text-gray-900"
                                onClick={() => setInput(prev => `${(prev || '').trim()} ${ref}`.trim())}
                                title="Attach this reference to your next message"
                              >
                                attach
                              </button>
                            </>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="mt-2 text-gray-700" style={{ fontSize: '8pt' }}>No matches found.</div>
                )}
              </div>
            )
          }

          if (type === 'source_open') {
            const title = String(card?.title || 'Source')
            const ref = String(card?.ref || '')
            const metadata = card?.metadata || {}
            const links: any[] = Array.isArray(card?.links) ? card.links : []
            const receipt = card?.receipt || null
            const receiptItems: any[] = Array.isArray(card?.receipt_items) ? card.receipt_items : []
            const excerpts: any[] = Array.isArray(card?.excerpts) ? card.excerpts : []

            return (
              <div key={idx} className="border border-gray-300 bg-white p-2">
                <div className="font-semibold mb-1" style={{ fontSize: '8pt' }}>Source</div>
                <div style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                  <div><strong>{title}</strong></div>
                  {ref ? (
                    <div className="text-gray-700">
                      <span>{ref}</span>
                      {' '}
                      <button
                        type="button"
                        className="underline text-gray-900"
                        onClick={() => setInput(prev => `${(prev || '').trim()} ${ref}`.trim())}
                        title="Attach this reference to your next message"
                      >
                        attach
                      </button>
                    </div>
                  ) : null}
                </div>

                {metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0 && (
                  <div className="mt-2 text-gray-800" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                    <div className="font-semibold mb-1">Metadata</div>
                    <ul className="list-disc pl-4">
                      {Object.entries(metadata).slice(0, 10).map(([k, v]) => (
                        <li key={k}><strong>{k}:</strong> {v === null || v === undefined ? '—' : String(v)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {links.length > 0 && (
                  <div className="mt-2" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                    <div className="font-semibold mb-1">Links</div>
                    <ul className="list-disc pl-4">
                      {links.slice(0, 4).map((l: any, i: number) => {
                        const url = normalizeExternalUrl(l?.url) || (typeof l?.url === 'string' ? l.url : null)
                        const label = String(l?.label || 'Open')
                        return (
                          <li key={i}>
                            {url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>{label}</a>
                            ) : (
                              <span>{label}</span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {receipt?.ref ? (
                  <div className="mt-2" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                    <div className="font-semibold mb-1">Linked receipt</div>
                    <div className="text-gray-800">
                      <span>{String(receipt.ref)}</span>
                      {' '}
                      <button
                        type="button"
                        className="underline text-gray-900"
                        onClick={() => sendCommand(`/open ${String(receipt.ref)}`)}
                        title="Open receipt details"
                      >
                        open
                      </button>
                      {' '}
                      <button
                        type="button"
                        className="underline text-gray-900"
                        onClick={() => setInput(prev => `${(prev || '').trim()} ${String(receipt.ref)}`.trim())}
                        title="Attach receipt ref"
                      >
                        attach
                      </button>
                    </div>
                  </div>
                ) : null}

                {receiptItems.length > 0 && (
                  <div className="mt-2" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                    <div className="font-semibold mb-1">Receipt items (top)</div>
                    <ul className="list-disc pl-4">
                      {receiptItems.slice(0, 12).map((it: any, i: number) => (
                        <li key={i}>
                          {String(it?.description || 'Item')}
                          {it?.part_number ? ` (PN: ${it.part_number})` : ''}
                          {it?.quantity ? ` x${it.quantity}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {excerpts.length > 0 && (
                  <div className="mt-2" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                    <div className="font-semibold mb-1">Excerpts</div>
                    <div className="space-y-2">
                      {excerpts.slice(0, 4).map((ex: any, i: number) => (
                        <div key={i} className="border border-gray-200 p-2 bg-gray-50">
                          <div className="font-semibold mb-1">{String(ex?.label || 'Excerpt')}</div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{String(ex?.text || '')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          }

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
                              {normalizeExternalUrl(opt?.url) ? (
                                <>
                                  {' '}<a href={normalizeExternalUrl(opt?.url) as string} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>search</a>
                                </>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-gray-600" style={{ fontSize: '8pt', lineHeight: '1.35' }}>
                  Links are limited to trusted vendor search pages. If you want exact pricing, share a part number or vendor preference.
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

                    if (actionId === 'upload_document') {
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setShowUploader(true)}
                          className="px-3 py-1 border-2 border-gray-900 bg-white hover:bg-gray-100 font-semibold"
                          style={{ fontSize: '8pt' }}
                          title={String(a?.payload?.hint || 'Upload receipts/manuals for better accuracy')}
                        >
                          {label}
                        </button>
                      )
                    }

                    if (actionId === 'refresh_context') {
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setInput('/context')}
                          className="px-3 py-1 border-2 border-gray-900 bg-white hover:bg-gray-100 font-semibold"
                          style={{ fontSize: '8pt' }}
                          title="Show what evidence is currently attached to this vehicle"
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

  const sendCommand = async (command: string) => {
    if (isProcessing) return
    const cmd = String(command || '').trim()
    if (!cmd) return
    // Use the same submit pipeline, but without requiring user typing.
    setInput(cmd)
    // Let React state flush before submit.
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as any
      void handleSubmit(fakeEvent)
    }, 0)
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => sendCommand('/context')}
            className="px-2 py-1 border-2 border-gray-900 bg-white hover:bg-gray-100 font-semibold"
            style={{ fontSize: '8pt' }}
            title="Show context (docs, receipt-like images, timeline)"
          >
            Context
          </button>
          <button
            type="button"
            onClick={() => setShowUploader(true)}
            className="px-2 py-1 border-2 border-gray-900 bg-white hover:bg-gray-100 font-semibold"
            style={{ fontSize: '8pt' }}
            title="Upload receipts/invoices/manuals to this vehicle"
          >
            Upload
          </button>
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
      </div>

      {/* Inline model attachment: appears only if a model exists for this vehicle (or after upload) */}
      {activeModelSignedUrl && (
        <div className="p-3 border-b border-gray-200 bg-white">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
            <div style={{ fontWeight: 700, fontSize: '8pt' }}>Attached 3D model</div>
            <button
              type="button"
              className="underline text-gray-900"
              style={{ fontSize: '8pt' }}
              onClick={() => {
                setActiveModelSignedUrl(null)
                setActiveModelPath(null)
                setActiveModelBucket(modelBucket)
                setModelStatus('idle')
              }}
              title="Hide the model viewer"
            >
              hide
            </button>
          </div>
          <ErrorBoundary
            fallback={
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '8pt', color: '#666', border: '1px solid var(--border)', borderRadius: '4px' }}>
                3D model viewer unavailable
              </div>
            }
          >
            <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', fontSize: '8pt', color: '#666' }}>Loading 3D model...</div>}>
              <ModelHarnessAnnotator vehicleId={vehicleId} defaultImportUrl={activeModelSignedUrl} autoImportOnLoad={true} />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

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
            ref={modelFileRef}
            type="file"
            accept=".glb,.fbx"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              // Chat-simple behavior:
              // - Upload GLB directly
              // - For FBX, we will still show it (ModelHarnessAnnotator supports FBX->GLB conversion),
              //   but to keep the pipeline consistent we ask users to attach GLB when possible.
              try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) throw new Error('Sign in required')
                setUserId(user.id)
                setModelStatus('loading')
                setModelError(null)

                const safe = f.name.replace(/\s+/g, '_')
                const path = `${user.id}/${vehicleId}/${Date.now()}_${safe}`
                const { error } = await supabase.storage.from(modelBucket).upload(path, f, {
                  upsert: false,
                  contentType: f.type || 'application/octet-stream'
                })
                if (error) throw error
                await refreshModelSignedUrl(modelBucket, path)

                setMessages(prev => [
                  ...prev,
                  {
                    id: (Date.now() + 4).toString(),
                    role: 'assistant',
                    content: 'Model attached. Ask your question and I will tell you what points to mark next.',
                    timestamp: new Date()
                  }
                ])
              } catch (err: any) {
                setModelStatus('error')
                setModelError(err?.message || 'Upload failed')
              }
            }}
          />
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
          {allowManualModelAttach && (
            <button
              type="button"
              onClick={() => {
                // Debug/ops only: lazily load latest model, otherwise open file picker.
                void (async () => {
                  if (!userId) {
                    try {
                      const { data } = await supabase.auth.getUser()
                      if (data.user?.id) setUserId(data.user.id)
                    } catch {
                      // ignore
                    }
                  }
                  await loadLatestModelForVehicle()
                  if (!activeModelSignedUrl) modelFileRef.current?.click()
                })()
              }}
              className="bg-white text-gray-900 px-2 py-1 border-2 border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontSize: '8pt' }}
              disabled={isProcessing}
              title="Attach a 3D model (.glb or .fbx)"
            >
              Attach
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim() || isProcessing}
            className="bg-gray-900 text-white px-3 py-1 border-2 border-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontSize: '8pt' }}
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
        {modelError && (
          <div className="mt-2 text-red-700" style={{ fontSize: '8pt' }}>
            {modelError}
          </div>
        )}
      </form>

      {showUploader && (
        <SmartInvoiceUploader
          vehicleId={vehicleId}
          onClose={() => setShowUploader(false)}
          onSaved={() => {
            setShowUploader(false)
            setMessages(prev => [
              ...prev,
              {
                id: (Date.now() + 3).toString(),
                role: 'assistant',
                content: '✅ Saved. If you tell me what that document contains (or upload the next one), I’ll update the plan and re-check what’s still missing.',
                timestamp: new Date()
              }
            ])
          }}
        />
      )}
    </div>
  )
}

export default VehicleExpertChat

