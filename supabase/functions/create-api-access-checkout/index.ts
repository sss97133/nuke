/**
 * Create Stripe Checkout Session for API Access Subscription
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
    const { subscription_type, success_url, cancel_url } = await req.json()

    // Subscription plans
    const plans = {
      monthly: {
        name: 'Monthly API Access',
        description: '1,000 AI image analyses per month',
        amount: 2999, // $29.99/month
        recurring: true
      },
      prepaid_100: {
        name: 'Prepaid Credits - 100 Images',
        description: '100 AI image analyses (no expiration)',
        amount: 499, // $4.99
        credits: 100,
        recurring: false
      },
      prepaid_500: {
        name: 'Prepaid Credits - 500 Images',
        description: '500 AI image analyses (no expiration)',
        amount: 1999, // $19.99
        credits: 500,
        recurring: false
      },
      prepaid_1000: {
        name: 'Prepaid Credits - 1,000 Images',
        description: '1,000 AI image analyses (no expiration)',
        amount: 3499, // $34.99
        credits: 1000,
        recurring: false
      }
    }

    const plan = plans[subscription_type as keyof typeof plans]
    if (!plan) {
      return new Response(
        JSON.stringify({ error: 'Invalid subscription type' }),
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
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Create Stripe checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan.name,
              description: plan.description,
            },
            unit_amount: plan.amount,
            ...(plan.recurring ? {
              recurring: {
                interval: 'month',
              }
            } : {})
          },
          quantity: 1,
        },
      ],
      mode: plan.recurring ? 'subscription' : 'payment',
      success_url: success_url || `${Deno.env.get('SITE_URL') || 'https://n-zero.dev'}/settings?api_access=success`,
      cancel_url: cancel_url || `${Deno.env.get('SITE_URL') || 'https://n-zero.dev'}/settings?api_access=cancelled`,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        purchase_type: 'api_access_subscription',
        subscription_type: subscription_type,
        ...(plan.credits ? { credits: plan.credits.toString() } : {})
      },
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

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

