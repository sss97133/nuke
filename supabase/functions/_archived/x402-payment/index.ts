/**
 * x402 Payment Handler - Supabase Edge Function
 * Uses x402-hono middleware to handle HTTP 402 payment protocol
 * 
 * This function can be used to:
 * 1. Create payment challenges for invoices/transactions
 * 2. Verify x402 payments
 * 3. Process x402 payment flows
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { Hono } from 'npm:hono@4.0.0'
import { paymentMiddleware, Network } from 'npm:x402-hono@0.5.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const app = new Hono()

// Get wallet address from environment
const walletAddress = Deno.env.get('X402_WALLET_ADDRESS') || Deno.env.get('ADDRESS')
const network = (Deno.env.get('X402_NETWORK') || 'base-sepolia') as Network
const facilitatorUrl = Deno.env.get('X402_FACILITATOR_URL') || 'https://facilitator.payai.network'

if (!walletAddress) {
  console.warn('X402_WALLET_ADDRESS not configured. x402 payments will not work.')
}

// Configure x402 payment middleware for protected routes
// This will automatically handle HTTP 402 responses for routes that require payment
if (walletAddress) {
  app.use(paymentMiddleware(
    walletAddress,
    {
      '/pay/invoice': {
        price: '$0.10', // Default price, can be overridden per request
        network: network,
        config: {
          description: 'Invoice payment via x402',
        }
      },
      '/pay/transaction': {
        price: '$0.10',
        network: network,
        config: {
          description: 'Transaction payment via x402',
        }
      }
    },
    {
      facilitatorUrl: facilitatorUrl
    }
  ))
}

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    x402_enabled: !!walletAddress,
    network: network,
    wallet_address: walletAddress ? `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}` : null
  })
})

// Create payment challenge for invoice
app.post('/create-challenge', async (c) => {
  try {
    const { amount, currency = 'usd', invoice_id, transaction_id, metadata } = await c.req.json()

    if (!amount || amount <= 0) {
      return c.json({ error: 'Invalid amount' }, 400)
    }

    if (!walletAddress) {
      return c.json({ error: 'x402 not configured' }, 500)
    }

    // Format amount as price string (e.g., "$10.00")
    const priceString = `$${(amount / 100).toFixed(2)}`

    // Create payment challenge
    const challenge = {
      amount: amount,
      currency: currency,
      price: priceString,
      recipient: walletAddress,
      network: network,
      invoice_id: invoice_id,
      transaction_id: transaction_id,
      metadata: metadata || {},
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes
    }

    return c.json({
      challenge: challenge,
      payment_url: `${facilitatorUrl}/pay?amount=${amount}&recipient=${walletAddress}&network=${network}`
    })
  } catch (error) {
    console.error('Error creating payment challenge:', error)
    return c.json({ error: error.message }, 500)
  }
})

// Verify payment (called after client processes payment)
app.post('/verify-payment', async (c) => {
  try {
    const { transaction_hash, session_id, amount, recipient } = await c.req.json()

    if (!transaction_hash) {
      return c.json({ error: 'Transaction hash required' }, 400)
    }

    // TODO: Implement actual blockchain verification
    // This would check the blockchain for the transaction
    // and verify it matches the payment challenge

    // For now, return a placeholder response
    return c.json({
      verified: true,
      transaction_hash: transaction_hash,
      amount: amount,
      recipient: recipient,
      verified_at: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error verifying payment:', error)
    return c.json({ error: error.message }, 500)
  }
})

// Protected route example - requires payment via x402
app.get('/pay/invoice', async (c) => {
  // This route is protected by x402 middleware
  // If payment is not provided, it will return HTTP 402
  // If payment is verified, this handler executes
  
  const invoiceId = c.req.query('invoice_id')
  
  return c.json({
    message: 'Payment verified',
    invoice_id: invoiceId,
    access_granted: true
  })
})

// Protected route for transactions
app.get('/pay/transaction', async (c) => {
  const transactionId = c.req.query('transaction_id')
  
  return c.json({
    message: 'Payment verified',
    transaction_id: transactionId,
    access_granted: true
  })
})

// Main handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    return await app.fetch(req, {
      // Pass environment variables to Hono context if needed
    })
  } catch (error) {
    console.error('x402 payment function error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 'content-type': 'application/json', ...corsHeaders } 
      }
    )
  }
})

