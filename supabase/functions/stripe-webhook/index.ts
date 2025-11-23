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
      const purchaseType = session.metadata?.purchase_type || 'credits'

      if (!userId || !amountCents) {
        console.error('Missing user_id or amount in webhook')
        return new Response('Invalid metadata', { status: 400 })
      }

      // Initialize Supabase with service role
      const { createClient } = await import('jsr:@supabase/supabase-js@2')
      const supabase = createClient(
        Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      // Route based on purchase type
      if (purchaseType === 'invoice_payment') {
        // Handle invoice payment
        const invoiceId = session.metadata?.invoice_id
        const paymentToken = session.metadata?.payment_token
        const customerEmail = session.customer_email || session.customer_details?.email
        
        if (!invoiceId || !paymentToken) {
          console.error('Missing invoice_id or payment_token for invoice payment')
          return new Response('Invalid metadata', { status: 400 })
        }

        // Mark invoice as paid via the public function
        const { data: paymentResult, error: paymentError } = await supabase
          .rpc('mark_invoice_paid', {
            p_payment_token: paymentToken,
            p_payment_method: 'stripe',
            p_payment_method_details: {
              stripe_session_id: session.id,
              stripe_payment_intent: session.payment_intent,
              stripe_customer_id: session.customer,
              amount_paid_cents: amountCents,
              amount_paid_usd: amountCents / 100,
              payment_method_type: session.payment_method_types?.[0] || 'card'
            },
            p_confirmed_by: customerEmail || session.customer_details?.name || 'Card Payment',
            p_notes: `Paid via Stripe - Session ${session.id}`
          })

        if (paymentError) {
          console.error('Failed to mark invoice as paid:', paymentError)
          return new Response('Failed to update invoice', { status: 500 })
        }

        console.log(`Invoice ${invoiceId} paid via Stripe: $${amountCents / 100}`)

        // TODO: Send receipt email to customer
        // TODO: Notify shop of payment
        // TODO: Update journal entries for accounting

      } else if (purchaseType === 'vehicle_transaction') {
        // Handle vehicle transaction facilitation fee
        const transactionId = session.metadata?.transaction_id
        
        if (!transactionId) {
          console.error('Missing transaction_id for vehicle transaction')
          return new Response('Invalid metadata', { status: 400 })
        }

        // Update transaction with payment confirmation
        await supabase
          .from('vehicle_transactions')
          .update({
            stripe_payment_id: session.payment_intent,
            fee_paid_at: new Date().toISOString(),
            status: 'pending_documents'
          })
          .eq('id', transactionId)

        console.log(`Vehicle transaction ${transactionId} fee paid: $${amountCents / 100}`)

        // Trigger document generation
        try {
          await fetch(`${Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')}/functions/v1/generate-transaction-documents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')}`
            },
            body: JSON.stringify({ transaction_id: transactionId })
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
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY')}`
            },
            body: JSON.stringify({ 
              transaction_id: transactionId,
              notification_type: 'sign_request'
            })
          })
        } catch (err) {
          console.error('Failed to trigger SMS notifications:', err)
        }

        // Note: Shipping listing will be created after BOTH parties sign
        // This is handled by the transaction service when checking signature status
      } else {
        // Default: Add cash to user account (existing functionality)
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
