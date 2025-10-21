/**
 * Create Stripe Checkout Session for Vehicle Purchase Payment (deposit or full)
 * Body: {
 *   agreement_id: string,
 *   amount_usd: number, // deposit or full amount
 *   purpose?: 'deposit' | 'balance' | 'full',
 *   success_url: string,
 *   cancel_url: string
 * }
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'npm:stripe@14.11.0'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not configured')

    const { agreement_id, amount_usd, purpose = 'deposit', success_url, cancel_url } = await req.json()

    if (!agreement_id || !amount_usd || amount_usd <= 0) {
      return json({ error: 'agreement_id and positive amount_usd are required' }, 400)
    }
    if (!success_url || !cancel_url) {
      return json({ error: 'success_url and cancel_url are required' }, 400)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401 })

    const { createClient } = await import('jsr:@supabase/supabase-js@2')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')
    if (!supabaseUrl || !supabaseAnon) {
      throw new Error('SUPABASE_URL/ANON_KEY not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401 })

    // Fetch agreement minimal details if table exists (best-effort)
    let vehicleLabel = 'Vehicle Purchase'
    let sellerUserId: string | undefined
    try {
      const { data: agreement } = await supabase
        .from('purchase_agreements')
        .select('vehicle_id, seller_user_id')
        .eq('id', agreement_id)
        .single()

      if (agreement?.vehicle_id) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('year, make, model')
          .eq('id', agreement.vehicle_id)
          .maybeSingle()
        if (vehicle) {
          vehicleLabel = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
        }
      }
      if (agreement?.seller_user_id) sellerUserId = agreement.seller_user_id
    } catch (_) {
      // If table missing, proceed with generic label
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${purpose === 'deposit' ? 'Deposit' : purpose === 'balance' ? 'Balance Payment' : 'Purchase'} • ${vehicleLabel}`,
              description: purpose === 'deposit' ? 'Vehicle purchase deposit' : purpose === 'balance' ? 'Remaining balance' : 'Vehicle purchase',
            },
            unit_amount: Math.round(amount_usd * 100),
          },
          quantity: 1,
        },
      ],
      success_url,
      cancel_url,
      client_reference_id: user.id,
      metadata: {
        purchase_type: 'vehicle_purchase',
        user_id: user.id,
        agreement_id,
        purpose,
        seller_id: sellerUserId || '',
      },
    })

    return json({ checkout_url: session.url })
  } catch (error: any) {
    console.error('create-vehicle-checkout error:', error)
    return json({ error: error?.message || 'Unknown error' }, 500)
  }
})
