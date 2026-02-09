import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useCredits, getDeals, getDocumentTypeCountsForUser, formatDealDisplayName, formatDocumentTypeSummary } from '@dealerscan/shared'
import type { Deal } from '@dealerscan/shared'
import { FolderOpen, FileText, AlertCircle, CheckCircle, Clock, Loader2 } from 'lucide-react'

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
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([getDeals(), getDocumentTypeCountsForUser()])
      .then(([dealsList, counts]) => {
        setDeals(dealsList)
        setDocCounts(counts)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 mt-12">
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
          <Link to="/upload" className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            <FolderOpen className="w-4 h-4" /> Scan Folder
          </Link>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Your deal jackets</h2>
        <span className="text-sm text-gray-500">{deals.length} total</span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : deals.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No deals yet</h3>
          <p className="mt-1 text-sm text-gray-500">Select a folder of deal jacket photos to get started.</p>
          <Link to="/upload" className="mt-4 inline-flex items-center gap-1.5 bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700">
            <FolderOpen className="w-4 h-4" /> Scan Folder
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
                <div className="text-right">
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
