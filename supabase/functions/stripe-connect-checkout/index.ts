/**
 * stripe-connect-checkout
 * Creates Stripe Checkout sessions on connected accounts:
 *   POST { action: "direct_charge", accountId, priceId, priceInCents }
 *     — direct charge with platform application fee (one-time purchase)
 *   POST { action: "subscription", accountId, priceId }
 *     — subscription checkout on connected account
 *   POST { action: "billing_portal", accountId }
 *     — billing portal session for connected account (auth required)
 *
 * SECURITY:
 *   - "direct_charge" is intentionally available without auth (public storefront checkout).
 *     application_fee_amount is computed server-side from the STRIPE PRICE (not client-supplied amount).
 *   - "subscription" and "billing_portal" require authentication.
 *   - All actions: priceInCents from the client is ONLY used for the fee calculation as a
 *     HINT — we re-fetch the price from Stripe to get the authoritative amount.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// CORS: restrict to nuke.ag origin only
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://nuke.ag',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Validate that a success/cancel URL is within our own domain to prevent open redirect
function validateReturnUrl(url: string, baseUrl: string): boolean {
  try {
    const parsed = new URL(url)
    const base = new URL(baseUrl)
    return parsed.hostname === base.hostname || parsed.hostname === 'nuke.ag'
  } catch {
    return false
  }
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
    const { action, accountId, priceId } = body

    const baseUrl = Deno.env.get('FRONTEND_URL') || 'https://nuke.ag'

    if (action === 'direct_charge') {
      // Public storefront checkout — no auth required.
      // application_fee_amount is computed from the AUTHORITATIVE Stripe price,
      // never from the client-supplied priceInCents.
      if (!accountId || !priceId) {
        return new Response(
          JSON.stringify({ error: 'accountId and priceId are required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      // Validate accountId format
      if (!/^acct_[a-zA-Z0-9]+$/.test(accountId)) {
        return new Response(
          JSON.stringify({ error: 'Invalid accountId format' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      // Validate priceId format
      if (!/^price_[a-zA-Z0-9]+$/.test(priceId)) {
        return new Response(
          JSON.stringify({ error: 'Invalid priceId format' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      // Fetch authoritative price from Stripe — never trust client-supplied amounts for fee calculation
      const stripePrice = await stripeClient.prices.retrieve(priceId, {}, { stripeAccount: accountId })
      const authoritativeAmount = stripePrice.unit_amount
      if (!authoritativeAmount || authoritativeAmount <= 0) {
        return new Response(
          JSON.stringify({ error: 'Could not determine price amount from Stripe' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      // Build safe redirect URLs — both go to nuke.ag, accountId embedded for session context
      const successUrl = `${baseUrl}/stripe-connect/store/${encodeURIComponent(accountId)}?success=true&session_id={CHECKOUT_SESSION_ID}`
      const cancelUrl = `${baseUrl}/stripe-connect/store/${encodeURIComponent(accountId)}`

      if (!validateReturnUrl(successUrl, baseUrl) || !validateReturnUrl(cancelUrl, baseUrl)) {
        return new Response(
          JSON.stringify({ error: 'Invalid redirect URL' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      const session = await stripeClient.checkout.sessions.create(
        {
          line_items: [{ price: priceId, quantity: 1 }],
          payment_intent_data: {
            application_fee_amount: Math.round(authoritativeAmount * 0.05), // 5% platform fee — computed from Stripe's authoritative price
          },
          mode: 'payment',
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        { stripeAccount: accountId }
      )

      return new Response(
        JSON.stringify({ url: session.url, session_id: session.id }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    // "subscription" and "billing_portal" require authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')!

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required — invalid or expired token' }),
        { status: 401, headers: { 'content-type': 'application/json', ...corsHeaders } }
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
    console.error('[stripe-connect-checkout] error:', error?.message || String(error))
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
