import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getDeal, getDealPages, mergeDeal, getPageSignedUrl, exportDealAsJson, exportDealAsCsv, archiveDeal } from '@dealerscan/shared'
import type { Deal, DocumentPage } from '@dealerscan/shared'
import { FileText, Download, AlertCircle, CheckCircle, Clock, Loader2, Eye, Archive, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

export default function DealView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [deal, setDeal] = useState<Deal | null>(null)
  const [pages, setPages] = useState<DocumentPage[]>([])
  const [loading, setLoading] = useState(true)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!id) return
    Promise.all([getDeal(id), getDealPages(id)])
      .then(([d, p]) => { setDeal(d); setPages(p) })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    pages.forEach(async (page) => {
      if (!imageUrls[page.id] && page.storage_path) {
        try {
          const url = await getPageSignedUrl(page.storage_path)
          setImageUrls(prev => ({ ...prev, [page.id]: url }))
        } catch { /* ignore */ }
      }
    })
  }, [pages])

  const handleMerge = async () => {
    if (!id) return
    try {
      await mergeDeal(id)
      const d = await getDeal(id)
      setDeal(d)
      toast.success('Deal data merged!')
    } catch {
      toast.error('Merge failed')
    }
  }

  const handleExport = (format: 'json' | 'csv') => {
    if (!deal) return
    const content = format === 'json' ? exportDealAsJson(deal, pages) : exportDealAsCsv(deal)
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${deal.deal_name || deal.vin || 'deal'}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleArchive = async () => {
    if (!id) return
    await archiveDeal(id)
    navigate('/dashboard')
  }

  if (loading) return <div className="flex justify-center py-20 mt-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (!deal) return <div className="text-center py-20 mt-12 text-gray-500">Deal not found</div>

  const merged = deal.merged_data || {}
  const conflicts = merged._conflicts || {}

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 mt-12">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {deal.deal_name || `${deal.year || ''} ${deal.make || ''} ${deal.model || ''}`.trim() || 'Untitled Deal'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {deal.total_pages} pages - {deal.pages_extracted} extracted
            {deal.pages_needing_review > 0 && (
              <span className="text-amber-600"> - {deal.pages_needing_review} need review</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleMerge} className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" /> Merge
          </button>
          <button onClick={() => handleExport('json')} className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            <Download className="w-3.5 h-3.5" /> JSON
          </button>
          <button onClick={() => handleExport('csv')} className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={handleArchive} className="flex items-center gap-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            <Archive className="w-3.5 h-3.5" /> Archive
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Merged Deal Data</h2>
            <dl className="space-y-2">
              {Object.entries(merged)
                .filter(([k]) => !k.startsWith('_') && typeof merged[k] !== 'object')
                .map(([key, val]) => (
                  <div key={key} className="flex justify-between text-sm">
                    <dt className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</dt>
                    <dd className={`font-medium text-gray-900 ${conflicts[key] ? 'text-amber-600' : ''}`}>
                      {String(val ?? '-')}
                      {conflicts[key] && <AlertCircle className="inline w-3 h-3 ml-1 text-amber-500" />}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Document Pages</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pages.map(page => (
              <Link
                key={page.id}
                to={`/review/${deal.id}/${page.id}`}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 transition-colors"
              >
                <div className="h-32 bg-gray-100 flex items-center justify-center overflow-hidden">
                  {imageUrls[page.id] ? (
                    <img src={imageUrls[page.id]} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <FileText className="w-8 h-8 text-gray-300" />
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 uppercase">{page.document_type || 'unknown'}</span>
                    {page.needs_review && page.review_status === 'pending' ? (
                      <span className="flex items-center gap-1 text-xs text-amber-600"><AlertCircle className="w-3 h-3" /> Review</span>
                    ) : page.review_status === 'user_reviewed' || page.review_status === 'auto_accepted' ? (
                      <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="w-3 h-3" /> Done</span>
                    ) : page.extracted_at ? (
                      <span className="flex items-center gap-1 text-xs text-gray-500"><Clock className="w-3 h-3" /> Extracted</span>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 truncate">{page.original_filename || `Page ${page.page_number}`}</p>
                  <div className="flex items-center gap-1 mt-2 text-xs text-blue-600">
                    <Eye className="w-3 h-3" /> View & Edit
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
