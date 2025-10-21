/**
 * Create Stripe Checkout Session for Share Purchase
 * Body: { offering_id: string, shares: number, success_url: string, cancel_url: string }
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

    const { offering_id, shares, success_url, cancel_url } = await req.json()

    if (!offering_id || !shares || shares <= 0) {
      return json({ error: 'offering_id and positive shares are required' }, 400)
    }
    if (!success_url || !cancel_url) {
      return json({ error: 'success_url and cancel_url are required' }, 400)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401 })

    const { createClient } = await import('jsr:@supabase/supabase-js@2')

    // Prefer standard env names with fallback to legacy keys used elsewhere in repo
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')
    if (!supabaseUrl || !supabaseAnon) {
      throw new Error('SUPABASE_URL/ANON_KEY not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    })

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401 })

    // Fetch offering details and associated vehicle label
    const { data: offering, error: offeringError } = await supabase
      .from('vehicle_offerings')
      .select('id, vehicle_id, current_share_price, seller_id')
      .eq('id', offering_id)
      .single()

    if (offeringError || !offering) {
      return json({ error: 'Offering not found' }, 404)
    }

    // Try to get a friendly vehicle label (optional)
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model')
      .eq('id', offering.vehicle_id)
      .maybeSingle()

    const label = vehicle
      ? `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
      : `Offering ${offering.id}`

    // Stripe requires integer cents
    const pricePerShareCents = Math.max(1, Math.round((offering.current_share_price || 0) * 100))
    const totalCents = pricePerShareCents * shares
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return json({ error: 'Invalid pricing for offering' }, 400)
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
              name: `Buy Shares • ${label}`,
              description: `${shares} share(s) @ $${(pricePerShareCents / 100).toFixed(2)} each`,
            },
            unit_amount: pricePerShareCents,
          },
          quantity: shares,
        },
      ],
      success_url,
      cancel_url,
      client_reference_id: user.id,
      metadata: {
        purchase_type: 'share_purchase',
        user_id: user.id,
        offering_id,
        shares: String(shares),
        price_per_share_cents: String(pricePerShareCents),
        seller_id: offering.seller_id || '',
      },
    })

    return json({ checkout_url: session.url })
  } catch (error: any) {
    console.error('create-share-checkout error:', error)
    return json({ error: error?.message || 'Unknown error' }, 500)
  }
})
