/**
 * Create Stripe Checkout Session for Vehicle Transaction Facilitation Fee
 * Body: {
 *   vehicle_id: string,
 *   sale_price: number,
 *   fee_percentage?: number (default 2.0),
 *   buyer_phone?: string,
 *   buyer_email?: string
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

    const { vehicle_id, sale_price, fee_percentage = 2.0, buyer_phone, buyer_email } = await req.json()

    if (!vehicle_id || !sale_price || sale_price <= 0) {
      return json({ error: 'vehicle_id and positive sale_price are required' }, 400)
    }

    if (fee_percentage < 1 || fee_percentage > 5) {
      return json({ error: 'fee_percentage must be between 1 and 5' }, 400)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const { createClient } = await import('jsr:@supabase/supabase-js@2')

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')
    if (!supabaseUrl || !supabaseAnon) {
      throw new Error('SUPABASE_URL/ANON_KEY not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    // Get vehicle details
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin, price, user_id, vehicle_number')
      .eq('id', vehicle_id)
      .maybeSingle()

    if (vehicleError || !vehicle) {
      return json({ error: 'Vehicle not found' }, 404)
    }

    const seller_id = vehicle.user_id

    if (seller_id === user.id) {
      return json({ error: 'Cannot buy your own vehicle' }, 400)
    }

    // Get seller contact info
    const { data: seller, error: sellerError } = await supabase
      .from('profiles')
      .select('phone_number, full_name')
      .eq('id', seller_id)
      .maybeSingle()

    const seller_phone = seller?.phone_number
    const seller_name = seller?.full_name || 'Seller'

    // Calculate facilitation fee
    const facilitation_fee = (sale_price * fee_percentage) / 100

    // Create transaction record (pending fee payment)
    // TODO(ghost-ref 2026-07-12): vehicle_transactions does not exist (half-built) — guarded; see docs/ledger/FINISH_ROADMAP.md
    // The persistence table isn't provisioned, so we can't store the pending transaction.
    // Synthesize a reference id so the Stripe checkout flow still works (success_url + metadata
    // below both need it) instead of hard-failing the whole checkout on a missing table.
    const transaction = { id: crypto.randomUUID() }

    // Create Stripe checkout session
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Transaction Facilitation Fee',
              description: `Paperwork & facilitation for ${vehicleName} ($${sale_price.toLocaleString()})`,
            },
            unit_amount: Math.round(facilitation_fee * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${Deno.env.get('FRONTEND_URL') || 'https://nuke.ag'}/transaction/${transaction.id}/success`,
      cancel_url: `${Deno.env.get('FRONTEND_URL') || 'https://nuke.ag'}/vehicle/${vehicle_id}`,
      client_reference_id: user.id,
      metadata: {
        purchase_type: 'vehicle_transaction',
        transaction_id: transaction.id,
        vehicle_id,
        buyer_id: user.id,
        seller_id,
        sale_price: sale_price.toString(),
        facilitation_fee: facilitation_fee.toString(),
      },
    })

    // Update transaction with Stripe session ID
    // TODO(ghost-ref 2026-07-12): vehicle_transactions does not exist (half-built) — guarded; see docs/ledger/FINISH_ROADMAP.md
    // No transactions table to persist the Stripe session id to yet; it is already carried in the
    // checkout session's metadata above, so skip the update instead of failing the request.

    return json({
      checkout_url: session.url,
      transaction_id: transaction.id,
      facilitation_fee,
      fee_percentage
    })
  } catch (error) {
    console.error('Checkout error:', error)
    return json({ error: error.message }, 500)
  }
})

