import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth, useCredits, createCheckout, getTransactions } from '@dealerscan/shared'
import type { CreditTransaction } from '@dealerscan/shared'
import { CreditCard, Check, Loader2, Zap } from 'lucide-react'
import toast from 'react-hot-toast'

const plans = [
  { id: 'credits_100', name: '100 Extractions', price: '$20', per: '$0.20/each', credits: 100 },
  { id: 'credits_500', name: '500 Extractions', price: '$90', per: '$0.18/each', credits: 500, popular: true },
  { id: 'credits_1000', name: '1,000 Extractions', price: '$160', per: '$0.16/each', credits: 1000 },
]

export default function BillingPage() {
  const { user } = useAuth()
  const { credits, refresh: refreshCredits } = useCredits(user?.id)
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [searchParams] = useSearchParams()

  useEffect(() => {
    getTransactions().then(setTransactions)
    const status = searchParams.get('status')
    if (status === 'success') {
      toast.success('Credits purchased successfully!')
      refreshCredits()
      getTransactions().then(setTransactions)
    } else if (status === 'cancelled') {
      toast('Purchase cancelled', { icon: 'info' })
    }
  }, [])

  const handlePurchase = async (planId: string) => {
    setLoading(planId)
    try {
      const checkoutUrl = await createCheckout(planId, `${window.location.origin}/billing`)
      window.location.href = checkoutUrl
    } catch (err: any) {
      toast.error(err.message)
      setLoading(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Billing & Credits</h1>

      {credits && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Current Balance</p>
              <p className="text-4xl font-bold text-gray-900 mt-1">{credits.total_available}</p>
              <p className="text-sm text-gray-500 mt-1">
                {credits.free_remaining > 0 && <span>{credits.free_remaining} free</span>}
                {credits.free_remaining > 0 && credits.paid_remaining > 0 && <span> + </span>}
                {credits.paid_remaining > 0 && <span>{credits.paid_remaining} paid</span>}
              </p>
            </div>
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center">
              <Zap className="w-8 h-8 text-blue-600" />
            </div>
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-900 mb-4">Buy Credits</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {plans.map(plan => (
          <div
            key={plan.id}
            className={`border rounded-xl p-5 ${plan.popular ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200'}`}
          >
            {plan.popular && (
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Best Value</span>
            )}
            <h3 className="mt-2 font-semibold text-gray-900">{plan.name}</h3>
            <div className="mt-1">
              <span className="text-2xl font-bold text-gray-900">{plan.price}</span>
            </div>
            <p className="text-sm text-gray-500">{plan.per}</p>
            <button
              onClick={() => handlePurchase(plan.id)}
              disabled={!!loading}
              className={`mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium ${
                plan.popular
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } disabled:opacity-50`}
            >
              {loading === plan.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              {loading === plan.id ? 'Redirecting...' : 'Purchase'}
            </button>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-gray-900 mb-4">Transaction History</h2>
      {transactions.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-6 text-center">
          No transactions yet.
        </p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-2 text-gray-500">{new Date(tx.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                      tx.transaction_type === 'purchase' ? 'bg-green-50 text-green-700' :
                      tx.transaction_type === 'extraction' ? 'bg-blue-50 text-blue-700' :
                      tx.transaction_type === 'refund' ? 'bg-amber-50 text-amber-700' :
                      'bg-gray-50 text-gray-600'
                    }`}>
                      {tx.transaction_type === 'purchase' && <Check className="w-3 h-3" />}
                      {tx.transaction_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{tx.description || '-'}</td>
                  <td className={`px-4 py-2 text-right font-medium ${tx.amount > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{tx.balance_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
