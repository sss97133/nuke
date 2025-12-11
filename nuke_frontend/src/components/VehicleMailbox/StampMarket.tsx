import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toast } from 'react-hot-toast'

interface Stamp {
  id: string
  user_id?: string
  sku?: string
  name?: string
  list_price_cents?: number
  remaining_uses?: number
  rarity?: string | null
}

interface Props {
  onPurchased?: () => void
}

const StampMarket: React.FC<Props> = ({ onPurchased }) => {
  const [loading, setLoading] = useState(false)
  const [listed, setListed] = useState<Stamp[]>([])

  const getAuthHeaders = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token || localStorage.getItem('auth_token')
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  }

  const loadMarket = async () => {
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/stamps/market', { headers })
      if (res.ok) {
        const result = await res.json()
        setListed(result.data || [])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMarket()
  }, [])

  const buy = async (stampId: string, priceCents?: number) => {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/stamps/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ stamp_id: stampId })
      })
      if (res.ok) {
        toast.success('Purchased stamp')
        await loadMarket()
        if (onPurchased) onPurchased()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.message || 'Purchase failed')
      }
    } catch (err) {
      console.error(err)
      toast.error('Purchase failed')
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-3 text-[10px] space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-gray-900 font-semibold">Marketplace</div>
        <button
          className="text-[10px] text-blue-600"
          onClick={loadMarket}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {listed.length === 0 && (
        <div className="text-gray-600 text-[9px]">No listings.</div>
      )}
      <div className="space-y-2">
        {listed.map((s) => (
          <div key={s.id} className="border rounded p-2 flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-gray-900 font-semibold">
                {s.name || s.sku || 'Stamp'}
              </div>
              <div className="text-gray-600 text-[9px]">
                Uses: {s.remaining_uses ?? 1}
                {s.rarity ? ` · ${s.rarity}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-semibold text-gray-900">
                ${((s.list_price_cents || 0) / 100).toFixed(2)}
              </div>
              <button
                className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] font-semibold"
                onClick={() => buy(s.id, s.list_price_cents)}
                disabled={loading}
              >
                Buy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default StampMarket

