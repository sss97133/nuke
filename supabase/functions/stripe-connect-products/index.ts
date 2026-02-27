/**
 * stripe-connect-products
 * Manages Stripe products on connected accounts:
 *   POST { action: "create", accountId, name, description, priceInCents } — create product (auth required + ownership check)
 *   GET  ?accountId=acct_... — list products on connected account (public storefront read — no auth required)
 *
 * SECURITY:
 *   - POST (create) requires a valid JWT and verifies the accountId belongs to the caller.
 *   - GET (list) is intentionally public — it powers the storefront which is customer-facing.
 *     Listing products on a public storefront is not sensitive.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// CORS: restrict to nuke.ag origin only
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://nuke.ag',
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

    // GET: public storefront product listing — no auth required
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const accountId = url.searchParams.get('accountId')

      if (!accountId) {
        return new Response(
          JSON.stringify({ error: 'accountId query param is required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      // Validate accountId format to prevent probing with arbitrary strings
      if (!/^acct_[a-zA-Z0-9]+$/.test(accountId)) {
        return new Response(
          JSON.stringify({ error: 'Invalid accountId format' }),
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
      // POST: requires authentication + ownership check
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')!
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')!
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')!
      const sb = createClient(supabaseUrl, serviceRoleKey)

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

      const body = await req.json()
      const { action, accountId, name, description, priceInCents } = body

      if (action === 'create') {
        if (!accountId || !name || !priceInCents) {
          return new Response(
            JSON.stringify({ error: 'accountId, name, and priceInCents are required' }),
            { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
          )
        }

        // OWNERSHIP CHECK: verify this account belongs to the calling user
        const { data: ownedAccount } = await sb
          .from('stripe_connect_accounts')
          .select('id')
          .eq('stripe_account_id', accountId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (!ownedAccount) {
          return new Response(
            JSON.stringify({ error: 'Account not found or access denied' }),
            { status: 403, headers: { 'content-type': 'application/json', ...corsHeaders } }
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
    console.error('[stripe-connect-products] error:', error?.message || String(error))
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
