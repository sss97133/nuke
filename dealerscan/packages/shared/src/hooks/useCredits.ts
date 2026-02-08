import { useEffect, useState, useCallback } from 'react'
import { getSupabase } from '../lib/supabase'
import type { CreditSummary } from '../types'

export function useCredits(userId: string | undefined) {
  const [credits, setCredits] = useState<CreditSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!userId) return
    const supabase = getSupabase()
    const { data } = await supabase.rpc('ds_get_credits', { p_user_id: userId })
    if (data?.[0]) {
      setCredits(data[0])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { credits, loading, refresh }
}
