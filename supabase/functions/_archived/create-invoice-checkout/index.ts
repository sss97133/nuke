/**
 * Create Stripe Checkout Session for Invoice Payment
 * Public access - no authentication required (uses payment_token)
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'npm:stripe@14.11.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { payment_token, success_url, cancel_url } = await req.json()

    if (!payment_token) {
      return new Response(
        JSON.stringify({ error: 'Payment token required' }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    // Get Stripe key
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) {
      throw new Error('STRIPE_SECRET_KEY not configured')
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    })

    // Initialize Supabase (no auth required for public invoice lookup)
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabase = createClient(
      Deno.env.get('PROJECT_URL') || Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('ANON_KEY')!
    )

    // Get invoice by payment token (public function)
    const { data: invoiceData, error: invoiceError } = await supabase
      .rpc('get_invoice_by_token', { p_token: payment_token })

    if (invoiceError || !invoiceData || invoiceData.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invoice not found' }),
        { status: 404, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    const invoice = invoiceData[0]

    // Check if already paid
    if (invoice.payment_status === 'paid') {
      return new Response(
        JSON.stringify({ error: 'Invoice already paid', invoice_id: invoice.id }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    // Check if public access enabled
    if (!invoice.payment_token) {
      return new Response(
        JSON.stringify({ error: 'Invoice payment link not available' }),
        { status: 403, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    const amountUSD = parseFloat(invoice.total_amount || 0)
    if (amountUSD <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid invoice amount' }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    // Build invoice description
    const invoiceDescription = invoice.event_title 
      ? `${invoice.event_title} - ${invoice.invoice_number}`
      : `Invoice ${invoice.invoice_number}`

    // Build success/cancel URLs
    const defaultSuccessUrl = success_url || `${invoice.payment_link || ''}/paid`
    const defaultCancelUrl = cancel_url || invoice.payment_link || ''

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice ${invoice.invoice_number}`,
              description: invoiceDescription,
              metadata: {
                invoice_number: invoice.invoice_number,
                vehicle: invoice.vehicle_year && invoice.vehicle_make 
                  ? `${invoice.vehicle_year} ${invoice.vehicle_make} ${invoice.vehicle_model || ''}`.trim()
                  : 'Vehicle service'
              }
            },
            unit_amount: Math.round(amountUSD * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: defaultSuccessUrl,
      cancel_url: defaultCancelUrl,
      metadata: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        payment_token: payment_token,
        purchase_type: 'invoice_payment',
        amount_cents: Math.round(amountUSD * 100),
        client_name: invoice.client_name || 'Customer',
        vehicle_info: invoice.vehicle_year && invoice.vehicle_make
          ? `${invoice.vehicle_year} ${invoice.vehicle_make} ${invoice.vehicle_model || ''}`.trim()
          : null
      },
      customer_email: invoice.contact_email || undefined, // Pre-fill email if available
      allow_promotion_codes: true, // Allow discount codes
    })

    return new Response(
      JSON.stringify({ 
        checkout_url: session.url,
        session_id: session.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number
      }),
      { headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  } catch (error) {
    console.error('Invoice checkout error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})

