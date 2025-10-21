/**
 * Stripe Webhook Handler
 * Processes successful payments and adds credits to user accounts
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'npm:stripe@14.11.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
    
    if (!stripeKey || !webhookSecret) {
      throw new Error('Stripe keys not configured')
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    })

    // Get request body and signature
    const signature = req.headers.get('stripe-signature')
    if (!signature) {
      return new Response('No signature', { status: 400 })
    }

    const body = await req.text()

    // Verify webhook signature
    let event
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return new Response('Invalid signature', { status: 400 })
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object

      const userId = session.client_reference_id || session.metadata?.user_id
      const amountCents = session.amount_total // Stripe provides this directly

      if (!userId || !amountCents) {
        console.error('Missing user_id or amount in webhook')
        return new Response('Invalid metadata', { status: 400 })
      }

      // Initialize Supabase with service role
      const { createClient } = await import('jsr:@supabase/supabase-js@2')
      const supabase = createClient(
        Deno.env.get('PROJECT_URL')!,
        Deno.env.get('SERVICE_ROLE_KEY')!
      )

      // Add cash to user account (professional system)
      await supabase.rpc('add_cash_to_user', {
        p_user_id: userId,
        p_amount_cents: amountCents,
        p_stripe_payment_id: session.id,
        p_metadata: {
          stripe_session_id: session.id,
          amount_paid_usd: amountCents / 100,
          payment_method: session.payment_method_types?.[0] || 'card'
        }
      })

      console.log(`Added $${amountCents / 100} (${amountCents} cents) to user ${userId}`)
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
