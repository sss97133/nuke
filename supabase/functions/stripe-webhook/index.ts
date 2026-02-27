/**
 * Stripe Webhook Handler
 * Processes:
 * - Standard checkout/subscription events (existing functionality)
 * - Thin V2 events for connected account requirements/capabilities
 * - Standard subscription events for V2 connected accounts
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

// TODO: set STRIPE_WEBHOOK_SECRET in Supabase secrets

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

    const stripe = new Stripe(stripeKey) as any

    // Get request body and signature
    const signature = req.headers.get('stripe-signature')
    if (!signature) {
      return new Response('No signature', { status: 400 })
    }

    const body = await req.text()

    // Initialize Supabase with service role
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')!
    )

    // -------------------------------------------------------------------------
    // Attempt V2 thin event parsing first (for Connect account events)
    // V2 thin events have an 'id' but the full event must be fetched separately
    // -------------------------------------------------------------------------
    let handledAsThinEvent = false
    try {
      const thinEvent = stripe.parseThinEvent(body, signature, webhookSecret)

      if (thinEvent && thinEvent.id && thinEvent.type?.startsWith('v2.')) {
        handledAsThinEvent = true
        const event = await stripe.v2.core.events.retrieve(thinEvent.id)

        console.log(`[stripe-webhook] V2 thin event: ${event.type}`)

        switch (event.type) {
          case 'v2.core.account[requirements].updated': {
            const accountId = event.related_object?.id
            console.log(`[stripe-webhook] Account requirements updated for ${accountId}`)
            // Could update stripe_connect_accounts with requirements status if needed
            break
          }

          case 'v2.core.account[configuration.merchant].capability_status_updated': {
            const accountId = event.related_object?.id
            const data = (event as any).data
            console.log(`[stripe-webhook] Merchant capability updated for ${accountId}:`, data)
            break
          }

          case 'v2.core.account[configuration.customer].capability_status_updated': {
            const accountId = event.related_object?.id
            const data = (event as any).data
            console.log(`[stripe-webhook] Customer capability updated for ${accountId}:`, data)
            break
          }

          default:
            console.log(`[stripe-webhook] Unhandled V2 event type: ${event.type}`)
        }

        return new Response(
          JSON.stringify({ received: true }),
          { headers: { 'content-type': 'application/json', ...corsHeaders } }
        )
      }
    } catch (_thinErr) {
      // Not a V2 thin event — fall through to standard webhook handling
    }

    // -------------------------------------------------------------------------
    // Standard webhook verification (V1 events)
    // -------------------------------------------------------------------------
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return new Response('Invalid signature', { status: 400 })
    }

    console.log(`[stripe-webhook] Standard event: ${event.type}`)

    // -------------------------------------------------------------------------
    // Standard subscription events (including V2 connected accounts)
    // For V2 accounts, use subscription.customer_account instead of .customer
    // -------------------------------------------------------------------------
    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object as any
      // V2 accounts use customer_account; V1 use customer
      const stripeAccountId = subscription.customer_account || subscription.customer

      if (stripeAccountId) {
        await supabase.from('stripe_subscriptions').upsert(
          {
            stripe_account_id: stripeAccountId,
            subscription_id: subscription.id,
            status: subscription.status,
            price_id: subscription.items?.data?.[0]?.price?.id || null,
            quantity: subscription.items?.data?.[0]?.quantity || 1,
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            current_period_end: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'subscription_id' }
        )
        console.log(`[stripe-webhook] Upserted subscription ${subscription.id} for account ${stripeAccountId}`)
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as any
      // V2 accounts use customer_account; V1 use customer
      const stripeAccountId = subscription.customer_account || null
      const customerId = subscription.customer

      // Update stripe_subscriptions table
      if (stripeAccountId) {
        await supabase.from('stripe_subscriptions').upsert(
          {
            stripe_account_id: stripeAccountId,
            subscription_id: subscription.id,
            status: 'canceled',
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'subscription_id' }
        )
      }

      // Downgrade to free when subscription is canceled (existing V1 logic)
      if (customerId && !stripeAccountId) {
        const { data: sub2 } = await supabase
          .from('api_access_subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle()

        if (sub2) {
          await supabase.from('api_access_subscriptions')
            .update({ subscription_type: 'free', status: 'canceled', stripe_subscription_id: null })
            .eq('user_id', sub2.user_id)

          // Reset rate limits to free tier (100/day = ~5/hour)
          await supabase.from('api_keys')
            .update({ rate_limit_per_hour: 5 })
            .eq('user_id', sub2.user_id)
            .eq('is_active', true)

          console.log(`Subscription canceled for user ${sub2.user_id}, downgraded to free`)
        }
      }

      return new Response(
        JSON.stringify({ received: true }),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    if (event.type === 'payment_method.attached') {
      const paymentMethod = event.data.object as any
      console.log(`[stripe-webhook] Payment method attached: ${paymentMethod.id} to customer ${paymentMethod.customer}`)
    }

    if (event.type === 'payment_method.detached') {
      const paymentMethod = event.data.object as any
      console.log(`[stripe-webhook] Payment method detached: ${paymentMethod.id}`)
    }

    if (event.type === 'customer.updated') {
      const customer = event.data.object as any
      console.log(`[stripe-webhook] Customer updated: ${customer.id}`)
    }

    if (event.type === 'customer.tax_id.created') {
      const taxId = event.data.object as any
      console.log(`[stripe-webhook] Tax ID created: ${taxId.id} for customer ${taxId.customer}`)
    }

    if (event.type === 'customer.tax_id.deleted') {
      const taxId = event.data.object as any
      console.log(`[stripe-webhook] Tax ID deleted: ${taxId.id}`)
    }

    if (event.type === 'customer.tax_id.updated') {
      const taxId = event.data.object as any
      console.log(`[stripe-webhook] Tax ID updated: ${taxId.id} — verification: ${taxId.verification?.status}`)
    }

    if (event.type === 'billing_portal.session.created') {
      const session = event.data.object as any
      console.log(`[stripe-webhook] Billing portal session created: ${session.id} for customer ${session.customer}`)
    }

    // -------------------------------------------------------------------------
    // checkout.session.completed — existing logic preserved exactly
    // -------------------------------------------------------------------------
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any

      const userId = session.client_reference_id || session.metadata?.user_id
      const amountCents = session.amount_total
      const purchaseType = session.metadata?.purchase_type || 'credits'

      if (!userId || !amountCents) {
        console.error('Missing user_id or amount in webhook')
        return new Response('Invalid metadata', { status: 400 })
      }

      if (purchaseType === 'invoice_payment') {
        const invoiceId = session.metadata?.invoice_id
        const paymentToken = session.metadata?.payment_token
        const customerEmail = session.customer_email || session.customer_details?.email

        if (!invoiceId || !paymentToken) {
          console.error('Missing invoice_id or payment_token for invoice payment')
          return new Response('Invalid metadata', { status: 400 })
        }

        const { error: paymentError } = await supabase.rpc('mark_invoice_paid', {
          p_payment_token: paymentToken,
          p_payment_method: 'stripe',
          p_payment_method_details: {
            stripe_session_id: session.id,
            stripe_payment_intent: session.payment_intent,
            stripe_customer_id: session.customer,
            amount_paid_cents: amountCents,
            amount_paid_usd: amountCents / 100,
            payment_method_type: session.payment_method_types?.[0] || 'card',
          },
          p_confirmed_by: customerEmail || session.customer_details?.name || 'Card Payment',
          p_notes: `Paid via Stripe - Session ${session.id}`,
        })

        if (paymentError) {
          console.error('Failed to mark invoice as paid:', paymentError)
          return new Response('Failed to update invoice', { status: 500 })
        }

        console.log(`Invoice ${invoiceId} paid via Stripe: $${amountCents / 100}`)

        // TODO: Send receipt email to customer
        // TODO: Notify shop of payment
        // TODO: Update journal entries for accounting

      } else if (purchaseType === 'api_access_subscription') {
        const subscriptionType = session.metadata?.subscription_type
        const credits = session.metadata?.credits ? parseInt(session.metadata.credits, 10) || null : null

        if (!subscriptionType) {
          console.error('Missing subscription_type for API access subscription')
          return new Response('Invalid metadata', { status: 400 })
        }

        if (subscriptionType === 'monthly') {
          const subscription = await (stripe as Stripe).subscriptions.retrieve(session.subscription as string)

          const { error: subError } = await supabase
            .from('api_access_subscriptions')
            .upsert({
              user_id: userId,
              subscription_type: 'monthly',
              status: 'active',
              stripe_subscription_id: subscription.id,
              stripe_customer_id: subscription.customer as string,
              current_period_start: new Date((subscription as any).current_period_start * 1000).toISOString(),
              current_period_end: new Date((subscription as any).current_period_end * 1000).toISOString(),
              monthly_limit: 1000,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' })

          if (subError) {
            console.error('Failed to create subscription:', subError)
            return new Response('Failed to create subscription', { status: 500 })
          }

          console.log(`Monthly API access subscription created for user ${userId}`)
        } else if (subscriptionType.startsWith('prepaid_')) {
          const { error: subError } = await supabase
            .from('api_access_subscriptions')
            .upsert({
              user_id: userId,
              subscription_type: 'prepaid_credits',
              status: 'active',
              credits_remaining: credits || 0,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' })

          if (subError) {
            console.error('Failed to create prepaid subscription:', subError)
            return new Response('Failed to create subscription', { status: 500 })
          }

          console.log(`Prepaid credits subscription created for user ${userId}: ${credits} credits`)
        }

      } else if (purchaseType === 'dealerscan_credits') {
        const credits = session.metadata?.credits ? (parseInt(session.metadata.credits, 10) || 0) : 0

        if (credits > 0) {
          const { data: newBalance, error: dsError } = await supabase.rpc('ds_add_credits', {
            p_user_id: userId,
            p_credits: credits,
            p_stripe_session_id: session.id,
            p_stripe_payment_intent: session.payment_intent,
          })

          if (dsError) {
            console.error('Failed to add DealerScan credits:', dsError)
            return new Response('Failed to add credits', { status: 500 })
          }

          console.log(`DealerScan: Added ${credits} credits for user ${userId}, new balance: ${newBalance}`)
        }

      } else if (purchaseType === 'vehicle_transaction') {
        const transactionId = session.metadata?.transaction_id

        if (!transactionId) {
          console.error('Missing transaction_id for vehicle transaction')
          return new Response('Invalid metadata', { status: 400 })
        }

        const { error: updateError } = await supabase
          .from('vehicle_transactions')
          .update({
            stripe_payment_id: session.payment_intent,
            fee_paid_at: new Date().toISOString(),
            status: 'pending_documents',
          })
          .eq('id', transactionId)

        if (updateError) {
          console.error(`Failed to update vehicle_transactions for ${transactionId}:`, updateError)
        }

        console.log(`Vehicle transaction ${transactionId} fee paid: $${amountCents / 100}`)

        // Advance ownership_transfer payment_confirmed milestone
        const transferId = session.metadata?.transfer_id || null
        if (transferId) {
          try {
            await fetch(`${Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')}/functions/v1/transfer-advance`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                action: 'advance_manual',
                transfer_id: transferId,
                milestone_type: 'payment_confirmed',
                notes: `Facilitation fee paid via Stripe - Session ${session.id} - $${amountCents / 100}`,
              }),
              signal: AbortSignal.timeout(30000),
            })
            console.log(`[stripe-webhook] Advanced payment_confirmed milestone for transfer ${transferId}`)
          } catch (err) {
            console.error('[stripe-webhook] Failed to advance transfer milestone (non-fatal):', err)
          }
        } else {
          try {
            const { data: txRecord } = await supabase
              .from('vehicle_transactions')
              .select('ownership_transfer_id')
              .eq('id', transactionId)
              .maybeSingle()

            const resolvedTransferId = txRecord?.ownership_transfer_id
            if (resolvedTransferId) {
              await fetch(`${Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')}/functions/v1/transfer-advance`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({
                  action: 'advance_manual',
                  transfer_id: resolvedTransferId,
                  milestone_type: 'payment_confirmed',
                  notes: `Facilitation fee paid via Stripe - Session ${session.id} - $${amountCents / 100}`,
                }),
                signal: AbortSignal.timeout(30000),
              })
              console.log(`[stripe-webhook] Advanced payment_confirmed milestone for transfer ${resolvedTransferId} (resolved from vehicle_transactions)`)
            }
          } catch (err) {
            console.error('[stripe-webhook] Failed to resolve/advance transfer milestone (non-fatal):', err)
          }
        }

        // Trigger document generation
        try {
          await fetch(`${Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')}/functions/v1/generate-transaction-documents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')}`,
            },
            body: JSON.stringify({ transaction_id: transactionId }),
            signal: AbortSignal.timeout(30000),
          })
        } catch (err) {
          console.error('Failed to trigger document generation:', err)
        }

        // Trigger SMS notifications
        try {
          await fetch(`${Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')}/functions/v1/send-transaction-sms`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')}`,
            },
            body: JSON.stringify({
              transaction_id: transactionId,
              notification_type: 'sign_request',
            }),
            signal: AbortSignal.timeout(30000),
          })
        } catch (err) {
          console.error('Failed to trigger SMS notifications:', err)
        }

        // Note: Shipping listing will be created after BOTH parties sign
      } else {
        // Default: Add cash to user account (existing functionality)
        const { error: rpcError } = await supabase.rpc('add_cash_to_user', {
          p_user_id: userId,
          p_amount_cents: amountCents,
          p_stripe_payment_id: session.id,
          p_metadata: {
            stripe_session_id: session.id,
            amount_paid_usd: amountCents / 100,
            payment_method: session.payment_method_types?.[0] || 'card',
          },
        })

        if (rpcError) console.error('CRITICAL: Failed to add cash to user:', rpcError.message)

        console.log(`Added $${amountCents / 100} (${amountCents} cents) to user ${userId}`)
      }
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error: any) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
