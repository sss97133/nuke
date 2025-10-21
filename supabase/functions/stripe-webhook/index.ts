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
      const session = event.data.object as any

      const purchaseType = session.metadata?.purchase_type || 'credits'
      const userId = session.client_reference_id || session.metadata?.user_id

      // Initialize Supabase with service role
      const { createClient } = await import('jsr:@supabase/supabase-js@2')
      const supabase = createClient(
        Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      if (purchaseType === 'share_purchase') {
        const offeringId = session.metadata?.offering_id
        const shares = parseInt(session.metadata?.shares || '0')
        const pricePerShareCents = parseInt(session.metadata?.price_per_share_cents || '0')

        if (!userId || !offeringId || !shares || !pricePerShareCents) {
          console.error('Missing metadata for share purchase')
          return new Response('Invalid metadata', { status: 400 })
        }

        // Record a trade-like entry for primary issuance to user (seller is offering seller_id)
        const totalValue = (shares * pricePerShareCents) / 100
        const sellerId = session.metadata?.seller_id || session.metadata?.seller_user_id || userId

        const pricePerShare = pricePerShareCents / 100
        const { error: tradeErr } = await supabase.from('market_trades').insert({
          offering_id: offeringId,
          buyer_id: userId,
          seller_id: sellerId,
          shares_traded: shares,
          price_per_share: pricePerShare,
          total_value: totalValue,
          trade_type: 'market',
          nuke_commission_pct: 2.0,
          nuke_commission_amount: totalValue * 0.02,
        })
        if (tradeErr) {
          console.error('Failed to insert market_trade:', tradeErr)
        }

        // Update buyer share_holdings (weighted avg entry price)
        const { data: existingHolding } = await supabase
          .from('share_holdings')
          .select('id, shares_owned, entry_price')
          .eq('offering_id', offeringId)
          .eq('holder_id', userId)
          .maybeSingle()

        if (existingHolding) {
          const currentShares = existingHolding.shares_owned || 0
          const currentEntry = Number(existingHolding.entry_price || 0)
          const newTotalShares = currentShares + shares
          const newAvgEntry = newTotalShares > 0
            ? (currentEntry * currentShares + pricePerShare * shares) / newTotalShares
            : pricePerShare

          const { error: updErr } = await supabase
            .from('share_holdings')
            .update({
              shares_owned: newTotalShares,
              entry_price: newAvgEntry,
              current_mark: pricePerShare,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', existingHolding.id)
          if (updErr) console.error('Failed to update share_holdings:', updErr)
        } else {
          const { error: insErr } = await supabase
            .from('share_holdings')
            .insert({
              offering_id: offeringId,
              holder_id: userId,
              shares_owned: shares,
              entry_price: pricePerShare,
              entry_date: new Date().toISOString(),
              current_mark: pricePerShare,
              total_bought: shares,
            })
          if (insErr) console.error('Failed to insert share_holdings:', insErr)
        }

        // Update offering stats and last price
        const { error: offerErr } = await supabase
          .from('vehicle_offerings')
          .update({
            current_share_price: pricePerShare,
            total_trades: (session.metadata?.total_trades as any) || undefined,
            total_volume_shares: undefined, // leave to background aggregation if any
            total_volume_usd: undefined,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', offeringId)
        if (offerErr) console.warn('Failed to update vehicle_offerings (non-fatal):', offerErr)

        console.log(`Share purchase recorded: user ${userId} bought ${shares} of ${offeringId}`)
      } else if (purchaseType === 'vehicle_purchase') {
        const agreementId = session.metadata?.agreement_id
        const purpose = session.metadata?.purpose || 'deposit'
        if (!userId || !agreementId) {
          console.error('Missing agreement_id or user_id in metadata')
          return new Response('Invalid metadata', { status: 400 })
        }

        // Upsert vehicle_purchase_payments ledger if exists
        try {
          await supabase.from('vehicle_purchase_payments').insert({
            agreement_id: agreementId,
            payer_user_id: userId,
            amount_usd: (session.amount_total || 0) / 100,
            payment_provider: 'stripe',
            payment_intent_id: session.payment_intent,
            stripe_session_id: session.id,
            purpose,
            status: 'completed'
          })
        } catch (e) {
          console.warn('vehicle_purchase_payments table missing or insert failed, skipping:', e)
        }

        console.log(`Vehicle payment recorded for agreement ${agreementId} by ${userId}`)
      } else {
        // Default credits top-up flow
        const credits = parseInt(session.metadata?.credits || '0')
        if (!userId || !credits) {
          console.error('Missing user_id or credits in webhook')
          return new Response('Invalid metadata', { status: 400 })
        }

        // Add credits via RPC (handles upsert + transaction log)
        await supabase.rpc('add_credits_to_user', {
          p_user_id: userId,
          p_credits: credits,
        })

        // Record transaction
        await supabase.from('credit_transactions').insert({
          user_id: userId,
          amount: credits,
          transaction_type: 'purchase',
          reference_id: session.id,
          metadata: {
            stripe_session_id: session.id,
            amount_paid: (session.amount_total || 0) / 100,
          },
        })

        console.log(`Added ${credits} credits to user ${userId}`)
      }
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
