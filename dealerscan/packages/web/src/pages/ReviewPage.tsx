import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSupabase, getPageSignedUrl, updatePageReview, getDealPages } from '@dealerscan/shared'
import type { DocumentPage } from '@dealerscan/shared'
import { ChevronLeft, ChevronRight, Check, RotateCcw, RotateCw, Pencil, ZoomIn, ZoomOut } from 'lucide-react'
import toast from 'react-hot-toast'

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-green-100 text-green-700'
    : score >= 70 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${color}`}>{score}%</span>
}

export default function ReviewPage() {
  const { dealId, pageId } = useParams<{ dealId: string; pageId: string }>()
  const navigate = useNavigate()
  const [page, setPage] = useState<DocumentPage | null>(null)
  const [allPages, setAllPages] = useState<DocumentPage[]>([])
  const [imageUrl, setImageUrl] = useState<string>('')
  const [edits, setEdits] = useState<Record<string, any>>({})
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dealId || !pageId) return
    const supabase = getSupabase()
    supabase.from('ds_document_pages').select('*').eq('id', pageId).single()
      .then(({ data }) => {
        if (data) {
          setPage(data)
          setEdits(data.user_edits || {})
        }
      })
    getDealPages(dealId).then(setAllPages)
  }, [dealId, pageId])

  useEffect(() => {
    if (page?.storage_path) {
      getPageSignedUrl(page.storage_path).then(setImageUrl).catch(() => {})
    }
  }, [page?.storage_path])

  const currentIndex = allPages.findIndex(p => p.id === pageId)
  const prevPage = currentIndex > 0 ? allPages[currentIndex - 1] : null
  const nextPage = currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : null

  const startEdit = (field: string, value: any) => {
    setEditingField(field)
    setEditValue(String(value ?? ''))
  }

  const saveEdit = () => {
    if (!editingField) return
    const val = editValue.trim() || null
    setEdits(prev => ({ ...prev, [editingField]: val }))
    setEditingField(null)
  }

  const handleApproveAll = async () => {
    if (!page) return
    setSaving(true)
    try {
      await updatePageReview(page.id, edits)
      toast.success('Page approved!')
      const nextReview = allPages.find(p => p.id !== page.id && p.needs_review && p.review_status === 'pending')
      if (nextReview) {
        navigate(`/review/${dealId}/${nextReview.id}`)
      } else {
        navigate(`/deal/${dealId}`)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!page) return <div className="flex justify-center py-20 text-gray-400">Loading...</div>

  const data = { ...page.extracted_data, ...edits }
  const confidences = page.confidences || {}

  const fields = Object.entries(data)
    .filter(([k]) => !['_conflicts', 'error'].includes(k) && typeof data[k] !== 'object')
    .sort((a, b) => (confidences[a[0]] || 100) - (confidences[b[0]] || 100))

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/deal/${dealId}`)} className="text-sm text-gray-500 hover:text-gray-700">
            Back to Deal
          </button>
          <span className="text-sm text-gray-400">|</span>
          <span className="text-sm font-medium text-gray-700 capitalize">{page.document_type || 'Document'}</span>
          <span className="text-xs text-gray-400">Page {currentIndex + 1} of {allPages.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {prevPage && (
            <button
              onClick={() => navigate(`/review/${dealId}/${prevPage.id}`)}
              className="p-1.5 border border-gray-300 rounded hover:bg-gray-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          {nextPage && (
            <button
              onClick={() => navigate(`/review/${dealId}/${nextPage.id}`)}
              className="p-1.5 border border-gray-300 rounded hover:bg-gray-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleApproveAll}
            disabled={saving}
            className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> {saving ? 'Saving...' : 'Approve'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 bg-gray-900 relative overflow-auto">
          <div className="absolute top-2 right-2 flex gap-1 z-10">
            <button onClick={() => setZoom(z => Math.min(z + 0.25, 3))} className="bg-black/50 text-white p-1.5 rounded hover:bg-black/70" title="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} className="bg-black/50 text-white p-1.5 rounded hover:bg-black/70" title="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </button>
            <button onClick={() => setRotation(r => (r + 90) % 360)} className="bg-black/50 text-white p-1.5 rounded hover:bg-black/70" title="Rotate clockwise">
              <RotateCw className="w-4 h-4" />
            </button>
            <button onClick={() => { setZoom(1); setRotation(0) }} className="bg-black/50 text-white px-2 py-1 rounded text-xs hover:bg-black/70" title="Reset">
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Document"
              className="transition-all duration-200"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                imageOrientation: 'from-image',
              }}
            />
          )}
        </div>

        <div className="w-1/2 bg-white overflow-y-auto border-l border-gray-200">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Extracted Fields</h3>
            {page.needs_review && page.review_status === 'pending' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4 text-xs text-amber-700">
                Some fields have low confidence. Please review and correct if needed.
              </div>
            )}
            <div className="space-y-1">
              {fields.map(([key, value]) => {
                const conf = confidences[key]
                const isEdited = edits[key] !== undefined
                const displayValue = isEdited ? edits[key] : value

                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2 p-2 rounded-lg ${
                      conf !== undefined && conf < 70 ? 'bg-red-50 border border-red-100' :
                      conf !== undefined && conf < 90 ? 'bg-amber-50 border border-amber-100' :
                      'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-gray-500 capitalize block">{key.replace(/_/g, ' ')}</span>
                      {editingField === key ? (
                        <div className="flex gap-1 mt-0.5">
                          <input
                            autoFocus
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveEdit()}
                            className="flex-1 border border-blue-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <button onClick={saveEdit} className="text-blue-600 text-xs font-medium px-2">Save</button>
                          <button onClick={() => setEditingField(null)} className="text-gray-400 text-xs px-1">Cancel</button>
                        </div>
                      ) : (
                        <span className={`text-sm font-medium ${isEdited ? 'text-blue-700' : 'text-gray-900'}`}>
                          {displayValue !== null && displayValue !== undefined ? String(displayValue) : <span className="text-gray-300 italic">null</span>}
                        </span>
                      )}
                    </div>
                    {conf !== undefined && <ConfidenceBadge score={conf} />}
                    {editingField !== key && (
                      <button
                        onClick={() => startEdit(key, displayValue)}
                        className="text-gray-400 hover:text-blue-600 p-0.5"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {page.raw_ocr_text && (
              <div className="mt-6 pt-4 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Raw OCR Text</h4>
                <p className="text-xs text-gray-600 font-mono whitespace-pre-wrap bg-gray-50 p-2 rounded">{page.raw_ocr_text}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
