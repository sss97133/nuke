/**
 * Clearing House Webhook Handler
 * Processes payments from your banking/clearing house partner
 * PLUG AND PLAY - Update with your partner's webhook format
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const webhookSecret = Deno.env.get('CLEARING_HOUSE_WEBHOOK_SECRET')
    if (!webhookSecret) {
      throw new Error('CLEARING_HOUSE_WEBHOOK_SECRET not configured')
    }

    // Get signature header (UPDATE based on your clearing house)
    const signature = req.headers.get('X-Webhook-Signature') || req.headers.get('X-CH-Signature')
    if (!signature) {
      return new Response('No signature', { status: 400 })
    }

    const body = await req.text()

    // STEP 1: Verify webhook signature
    // UPDATE THIS with your clearing house's verification method
    const isValid = verifySignature(body, signature, webhookSecret)
    if (!isValid) {
      console.error('Invalid webhook signature')
      return new Response('Invalid signature', { status: 401 })
    }

    // STEP 2: Parse event
    const event = JSON.parse(body)
    console.log('Received clearing house event:', event.type)

    // STEP 3: Handle event types
    // UPDATE these event types based on your clearing house
    if (event.type === 'payment.completed' || event.type === 'transfer.completed') {
      await handlePaymentCompleted(event.data)
    } else if (event.type === 'payment.failed') {
      await handlePaymentFailed(event.data)
    } else if (event.type === 'payout.completed') {
      await handlePayoutCompleted(event.data)
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

/**
 * STEP 1: Verify webhook signature
 * UPDATE THIS based on your clearing house's signature method
 */
function verifySignature(body: string, signature: string, secret: string): boolean {
  // Example: HMAC SHA256 verification (common method)
  // UPDATE with your clearing house's exact method
  
  const crypto = globalThis.crypto
  const encoder = new TextEncoder()
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(body)
  )
  
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  
  return expectedSignature === signature
}

/**
 * Handle successful payment
 */
async function handlePaymentCompleted(data: any) {
  console.log('Processing completed payment:', data)

  // Extract details (UPDATE field names based on your clearing house)
  const userId = data.user_id || data.customer_id || data.metadata?.user_id
  const amount = data.amount || data.amount_cents
  const transactionId = data.transaction_id || data.id

  if (!userId || !amount) {
    console.error('Missing required fields:', data)
    return
  }

  // Initialize Supabase
  const { createClient } = await import('jsr:@supabase/supabase-js@2')
  const supabase = createClient(
    Deno.env.get('PROJECT_URL')!,
    Deno.env.get('SERVICE_ROLE_KEY')!
  )

  // Add credits to user account
  const { error } = await supabase.rpc('add_credits_to_user', {
    p_user_id: userId,
    p_credits: amount
  })

  if (error) {
    console.error('Failed to add credits:', error)
    return
  }

  // Record transaction
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: amount,
    transaction_type: 'purchase',
    reference_id: transactionId,
    metadata: {
      provider: 'clearing_house',
      raw_data: data
    }
  })

  console.log(`Added ${amount} credits to user ${userId}`)
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(data: any) {
  console.log('Payment failed:', data)
  // Could notify user, log for investigation
}

/**
 * Handle completed payout (builder cash out)
 */
async function handlePayoutCompleted(data: any) {
  console.log('Payout completed:', data)

  const payoutId = data.payout_id || data.id
  const transactionId = data.transaction_id

  // Update payout status
  const { createClient } = await import('jsr:@supabase/supabase-js@2')
  const supabase = createClient(
    Deno.env.get('PROJECT_URL')!,
    Deno.env.get('SERVICE_ROLE_KEY')!
  )

  await supabase
    .from('builder_payouts')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      metadata: { transaction_id: transactionId }
    })
    .eq('id', payoutId)

  console.log(`Payout ${payoutId} marked as paid`)
}

