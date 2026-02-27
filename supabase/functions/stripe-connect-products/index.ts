/**
 * stripe-connect-products
 * Manages Stripe products on connected accounts:
 *   POST { action: "create", accountId, name, description, priceInCents } — create product
 *   GET  ?accountId=acct_... — list products on connected account
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

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const accountId = url.searchParams.get('accountId')

      if (!accountId) {
        return new Response(
          JSON.stringify({ error: 'accountId query param is required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      const products = await stripeClient.products.list(
        {
          limit: 20,
          active: true,
          expand: ['data.default_price'],
        },
        { stripeAccount: accountId }
      )

      return new Response(
        JSON.stringify({ products: products.data }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    if (req.method === 'POST') {
      const body = await req.json()
      const { action, accountId, name, description, priceInCents } = body

      if (action === 'create') {
        if (!accountId || !name || !priceInCents) {
          return new Response(
            JSON.stringify({ error: 'accountId, name, and priceInCents are required' }),
            { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
          )
        }

        const product = await stripeClient.products.create(
          {
            name,
            description: description || undefined,
            default_price_data: {
              unit_amount: Math.round(priceInCents),
              currency: 'usd',
            },
          },
          { stripeAccount: accountId }
        )

        return new Response(
          JSON.stringify({ product }),
          { headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}. Use create` }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use GET or POST.' }),
      { status: 405, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error: any) {
    console.error('[stripe-connect-products] error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
