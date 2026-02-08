import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'npm:stripe@14.11.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const plans: Record<string, { name: string; description: string; amount: number; credits: number }> = {
  credits_100: {
    name: 'DealerScan - 100 Extractions',
    description: '100 document extractions (no expiration)',
    amount: 2000, // $20.00
    credits: 100,
  },
  credits_500: {
    name: 'DealerScan - 500 Extractions',
    description: '500 document extractions - save 10% (no expiration)',
    amount: 9000, // $90.00
    credits: 500,
  },
  credits_1000: {
    name: 'DealerScan - 1,000 Extractions',
    description: '1,000 document extractions - save 20% (no expiration)',
    amount: 16000, // $160.00
    credits: 1000,
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { plan_id, success_url, cancel_url } = await req.json()

    const plan = plans[plan_id]
    if (!plan) {
      return new Response(
        JSON.stringify({ error: 'Invalid plan. Options: credits_100, credits_500, credits_1000' }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not configured')

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    // Get user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const defaultBaseUrl = Deno.env.get('DEALERSCAN_URL') || 'https://dealerscan.app'

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: plan.name,
            description: plan.description,
          },
          unit_amount: plan.amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: success_url || `${defaultBaseUrl}/billing?status=success`,
      cancel_url: cancel_url || `${defaultBaseUrl}/billing?status=cancelled`,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        purchase_type: 'dealerscan_credits',
        credits: plan.credits.toString(),
        plan_id: plan_id,
      },
    })

    return new Response(
      JSON.stringify({ checkout_url: session.url }),
      { headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error) {
    console.error('DealerScan checkout error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
