import { getSupabase, getSupabaseUrl } from '../lib/supabase'
import type { CreditTransaction } from '../types'

export async function createCheckout(planId: string, returnUrl: string): Promise<string> {
  const supabase = getSupabase()
  const SUPABASE_URL = getSupabaseUrl()

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/ds-create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      plan_id: planId,
      success_url: `${returnUrl}?status=success`,
      cancel_url: `${returnUrl}?status=cancelled`,
    }),
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Checkout failed' }))
    throw new Error(err.error)
  }

  const { checkout_url } = await resp.json()
  return checkout_url
}

export async function getTransactions(limit = 50): Promise<CreditTransaction[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ds_credit_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)
  return data || []
}
