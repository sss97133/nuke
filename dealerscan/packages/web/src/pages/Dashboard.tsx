import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useCredits, getDeals, getDocumentTypeCountsForUser, formatDealDisplayName, formatDocumentTypeSummary, exportAllDealsAsJson } from '@dealerscan/shared'
import type { Deal } from '@dealerscan/shared'
import { Plus, FileText, AlertCircle, CheckCircle, Clock, Loader2, Download, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'

const PROFILE_APP_URL = (import.meta.env.VITE_NUKE_APP_URL || import.meta.env.VITE_PROFILE_APP_URL) as string | undefined

const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-gray-500 bg-gray-100', label: 'Pending' },
  processing: { icon: Loader2, color: 'text-blue-600 bg-blue-50', label: 'Processing' },
  review: { icon: AlertCircle, color: 'text-amber-600 bg-amber-50', label: 'Needs Review' },
  completed: { icon: CheckCircle, color: 'text-green-600 bg-green-50', label: 'Complete' },
}

export default function Dashboard() {
  const { user } = useAuth()
  const { credits } = useCredits(user?.id)
  const [deals, setDeals] = useState<Deal[]>([])
  const [docCounts, setDocCounts] = useState<Record<string, { total: number; byType: Record<string, number> }>>({})
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const navigate = useNavigate()

  const handleBulkExport = async () => {
    if (deals.length === 0) return
    setExporting(true)
    try {
      const json = await exportAllDealsAsJson()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `deal-jackets-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${deals.length} deal jacket${deals.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  const profileUrl = (deal: Deal) => {
    if (!PROFILE_APP_URL) return null
    const vin = deal.vin || (deal.merged_data as Record<string, string>)?.['vin']
    if (vin) return `${PROFILE_APP_URL.replace(/\/$/, '')}/vehicle/${encodeURIComponent(vin)}`
    return PROFILE_APP_URL
  }

  useEffect(() => {
    Promise.all([getDeals(), getDocumentTypeCountsForUser()])
      .then(([dealsList, counts]) => {
        setDeals(dealsList)
        setDocCounts(counts)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Credit summary */}
      {credits && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">Available Credits</p>
            <p className="text-2xl font-bold text-gray-900">{credits.total_available}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {credits.free_remaining > 0 ? `${credits.free_remaining} free remaining` : ''}
              {credits.free_remaining > 0 && credits.paid_remaining > 0 ? ' + ' : ''}
              {credits.paid_remaining > 0 ? `${credits.paid_remaining} paid` : ''}
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/billing" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Buy Credits
            </Link>
            <Link to="/upload" className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> New Upload
            </Link>
            <Link to="/connect-photos" className="text-sm text-gray-600 hover:text-gray-900 font-medium border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-50">
              Connect photos
            </Link>
          </div>
        </div>
      )}

      {/* Deal jackets list */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Your deal jackets</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{deals.length} total</span>
          {deals.length > 0 && (
            <button
              onClick={handleBulkExport}
              disabled={exporting}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> {exporting ? 'Exporting...' : 'Bulk export'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : deals.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No deals yet</h3>
          <p className="mt-1 text-sm text-gray-500">Upload your first deal jacket to get started.</p>
          <Link to="/upload" className="mt-4 inline-flex items-center gap-1.5 bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Upload Documents
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {deals.map(deal => {
            const sc = statusConfig[deal.status] || statusConfig.pending
            const Icon = sc.icon
            return (
              <button
                key={deal.id}
                onClick={() => navigate(`/deal/${deal.id}`)}
                className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors text-left flex items-center gap-4"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${sc.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {formatDealDisplayName(deal, docCounts[deal.id]?.total ?? deal.total_pages)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {deal.total_pages} file{deal.total_pages !== 1 ? 's' : ''}
                    {docCounts[deal.id]?.byType && Object.keys(docCounts[deal.id].byType).length > 0 && (
                      <> · {formatDocumentTypeSummary(docCounts[deal.id].byType)}</>
                    )}
                    {deal.sale_price ? ` · $${deal.sale_price.toLocaleString()}` : ''}
                  </p>
                </div>
                <div className="text-right flex items-center gap-2">
                  {profileUrl(deal) && (
                    <a
                      href={profileUrl(deal)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
                      title="Connect to profile"
                    >
                      <Link2 className="w-3 h-3" /> Connect
                    </a>
                  )}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sc.color}`}>{sc.label}</span>
                  <p className="text-xs text-gray-400 mt-1">{new Date(deal.created_at).toLocaleDateString()}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
