/**
 * Create Stripe Checkout Session for Credit Purchase
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'npm:stripe@14.11.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { amount_usd, success_url, cancel_url } = await req.json()

    if (!amount_usd || amount_usd < 1) {
      return new Response(
        JSON.stringify({ error: 'Minimum $1 purchase' }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    // Get Stripe key
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY not configured')
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    })

    // Get user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(
      Deno.env.get('PROJECT_URL')!,
      Deno.env.get('ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Cash Deposit',
              description: `Add $${amount_usd} to your trading balance`
            },
            unit_amount: amount_usd * 100, // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: success_url,
      cancel_url: cancel_url,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        amount_cents: amount_usd * 100, // Amount in cents
      },
    })

    return new Response(
      JSON.stringify({ checkout_url: session.url }),
      { headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error) {
    console.error('Checkout error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})

