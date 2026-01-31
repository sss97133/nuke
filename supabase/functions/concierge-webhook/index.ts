import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.14.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2023-10-16',
  })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const body = await req.text()
    const signature = req.headers.get('stripe-signature')
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

    let event: Stripe.Event

    // Verify webhook signature if secret is configured
    if (webhookSecret && signature) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
      } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message)
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // For testing without signature verification
      event = JSON.parse(body)
    }

    console.log('Webhook event:', event.type)

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

      // Check if this is a concierge deposit
      if (session.metadata?.type !== 'concierge_deposit') {
        return new Response(
          JSON.stringify({ received: true, skipped: 'not_concierge' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const quoteId = session.metadata?.quote_id

      if (!quoteId) {
        console.error('No quote_id in session metadata')
        return new Response(
          JSON.stringify({ error: 'Missing quote_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`Processing deposit for quote: ${quoteId}`)

      // Update quote status
      const { error: updateError } = await supabase
        .from('concierge_quotes')
        .update({
          status: 'deposit_paid',
          stripe_payment_intent_id: session.payment_intent,
          deposit_paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', quoteId)

      if (updateError) {
        console.error('Failed to update quote:', updateError)
      }

      // Trigger notifications to guest and concierge team
      const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/concierge-notify`

      const notifyResponse = await fetch(notifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          quote_id: quoteId,
          type: 'deposit_received',
        }),
      })

      const notifyResult = await notifyResponse.json()
      console.log('Notification result:', notifyResult)

      return new Response(
        JSON.stringify({
          received: true,
          quote_id: quoteId,
          notifications: notifyResult,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Handle other events
    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      console.log('Payment failed:', paymentIntent.id)

      // Could notify concierge team about failed payment
    }

    return new Response(
      JSON.stringify({ received: true, type: event.type }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
