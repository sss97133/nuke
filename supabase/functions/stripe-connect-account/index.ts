/**
 * stripe-connect-account
 * Handles Stripe Connect V2 connected account operations:
 *   POST { action: "create" }    — create V2 connected account
 *   POST { action: "get_link" }  — create onboarding account link
 *   POST { action: "status" }    — retrieve account status from Stripe directly
 *
 * SECURITY: All actions require a valid JWT (authenticated user).
 *   - "create" and "get_link" require the caller to be authenticated.
 *   - "status" additionally validates that the requested account belongs to the caller.
 *   - "get_link" additionally validates ownership before issuing an onboarding link.
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')!
    const sb = createClient(supabaseUrl, serviceRoleKey)

    // --- AUTH GUARD: every action requires an authenticated user ---
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
    const { action } = body

    const baseUrl = Deno.env.get('FRONTEND_URL') || 'https://nuke.ag'

    if (action === 'create') {
      const { display_name: displayName, contact_email: contactEmail } = body

      if (!displayName || !contactEmail) {
        return new Response(
          JSON.stringify({ error: 'display_name and contact_email are required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      // Create V2 connected account
      const account = await (stripeClient as any).v2.core.accounts.create({
        display_name: displayName,
        contact_email: contactEmail,
        identity: { country: 'us' },
        dashboard: 'full',
        defaults: {
          responsibilities: {
            fees_collector: 'stripe',
            losses_collector: 'stripe',
          },
        },
        configuration: {
          customer: {},
          merchant: {
            capabilities: {
              card_payments: { requested: true },
            },
          },
        },
      })

      // Store mapping in DB — always tied to authenticated user.id
      await sb.from('stripe_connect_accounts').insert({
        user_id: user.id,
        stripe_account_id: account.id,
        display_name: displayName,
        contact_email: contactEmail,
      })

      // Return only safe fields — never return the full Stripe account object
      return new Response(
        JSON.stringify({ account_id: account.id }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    if (action === 'get_link') {
      const { account_id: accountId } = body

      if (!accountId) {
        return new Response(
          JSON.stringify({ error: 'account_id is required' }),
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

      const accountLink = await (stripeClient as any).v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['merchant', 'customer'],
            refresh_url: `${baseUrl}/stripe-connect?refresh=true`,
            return_url: `${baseUrl}/stripe-connect?accountId=${accountId}`,
          },
        },
      })

      return new Response(
        JSON.stringify({ url: accountLink.url }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    if (action === 'status') {
      const { account_id: stripeAccountId } = body

      if (!stripeAccountId) {
        return new Response(
          JSON.stringify({ error: 'account_id is required' }),
          { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      // OWNERSHIP CHECK: verify this account belongs to the calling user
      const { data: ownedAccount } = await sb
        .from('stripe_connect_accounts')
        .select('id')
        .eq('stripe_account_id', stripeAccountId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!ownedAccount) {
        return new Response(
          JSON.stringify({ error: 'Account not found or access denied' }),
          { status: 403, headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }

      const account = await (stripeClient as any).v2.core.accounts.retrieve(stripeAccountId, {
        include: ['configuration.merchant', 'requirements'],
      })

      const readyToProcessPayments =
        account?.configuration?.merchant?.capabilities?.card_payments?.status === 'active'
      const requirementsStatus = account.requirements?.summary?.minimum_deadline?.status
      const onboardingComplete =
        requirementsStatus !== 'currently_due' && requirementsStatus !== 'past_due'

      // Persist status to DB so it survives without re-polling Stripe
      await sb
        .from('stripe_connect_accounts')
        .update({
          onboarding_complete: onboardingComplete,
          payments_enabled: readyToProcessPayments,
          requirements_status: requirementsStatus || null,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_account_id', stripeAccountId)

      // Return only safe, derived fields — do NOT return the full Stripe account object
      return new Response(
        JSON.stringify({
          account_id: stripeAccountId,
          readyToProcessPayments,
          onboardingComplete,
          requirementsStatus,
        }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Use create | get_link | status` }),
      { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error: any) {
    console.error('[stripe-connect-account] error:', error?.message || String(error))
    // Do not leak internal error details to clients
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
