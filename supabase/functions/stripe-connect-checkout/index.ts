/**
 * stripe-connect-checkout
 * Creates Stripe Checkout sessions on connected accounts:
 *   POST { action: "direct_charge", accountId, priceId, priceInCents }
 *     — direct charge with platform application fee (one-time purchase)
 *   POST { action: "subscription", accountId, priceId }
 *     — subscription checkout on connected account
 *   POST { action: "billing_portal", accountId }
 *     — billing portal session for connected account
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

// TODO: set STRIPE_WEBHOOK_SECRET in Supabase secrets

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is required — set it in Supabase secrets')
    }
    const stripeClient = new Stripe(stripeSecretKey)

    const body = await req.json()
    const { action, accountId, priceId, priceInCents } = body

    const baseUrl = Deno.env.get('FRONTEND_URL') || 'https://nuke.ag'

    if (action === 'direct_charge') {
      // Direct charge with 5% platform application fee
      if (!accountId || !priceId || priceInCents == null) {
        return new Response(
          JSON.stringify({ error: 'accountId, priceId, and priceInCents are required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      const session = await stripeClient.checkout.sessions.create(
        {
          line_items: [{ price: priceId, quantity: 1 }],
          payment_intent_data: {
            application_fee_amount: Math.round(priceInCents * 0.05), // 5% platform fee
          },
          mode: 'payment',
          success_url: `${baseUrl}/stripe-connect/store/${accountId}?success=true&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/stripe-connect/store/${accountId}`,
        },
        { stripeAccount: accountId }
      )

      return new Response(
        JSON.stringify({ url: session.url, session_id: session.id }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    if (action === 'subscription') {
      // Subscription checkout using V2 customer_account
      if (!accountId || !priceId) {
        return new Response(
          JSON.stringify({ error: 'accountId and priceId are required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      const session = await stripeClient.checkout.sessions.create({
        // V2: use customer_account not customer
        customer_account: accountId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/stripe-connect/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/stripe-connect/dashboard`,
      } as any)

      return new Response(
        JSON.stringify({ url: session.url, session_id: session.id }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    if (action === 'billing_portal') {
      // Billing portal session for connected account
      if (!accountId) {
        return new Response(
          JSON.stringify({ error: 'accountId is required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      const session = await stripeClient.billingPortal.sessions.create({
        // V2: use customer_account
        customer_account: accountId,
        return_url: `${baseUrl}/stripe-connect/dashboard`,
      } as any)

      return new Response(
        JSON.stringify({ url: session.url }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Use direct_charge | subscription | billing_portal` }),
      { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error: any) {
    console.error('[stripe-connect-checkout] error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
