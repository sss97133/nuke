import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.14.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
    })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { quote_id, success_url, cancel_url } = await req.json()

    // Get the quote
    const { data: quote, error } = await supabase
      .from('concierge_quotes')
      .select('*')
      .eq('id', quote_id)
      .single()

    if (error || !quote) {
      return new Response(
        JSON.stringify({ error: 'Quote not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: quote.guest_email || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `L'Officiel Concierge - Booking Deposit`,
              description: `Deposit for ${quote.request_summary || 'Concierge Services'}`,
            },
            unit_amount: Math.round(quote.deposit_amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        quote_id: quote.id,
        type: 'concierge_deposit',
      },
      success_url: success_url || `https://lofficiel-concierge.vercel.app/booking/success?quote_id=${quote.id}`,
      cancel_url: cancel_url || `https://lofficiel-concierge.vercel.app/booking/cancelled?quote_id=${quote.id}`,
    })

    // Update quote with session ID
    await supabase
      .from('concierge_quotes')
      .update({
        stripe_checkout_session_id: session.id,
        status: 'checkout_started',
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote_id)

    return new Response(
      JSON.stringify({ checkout_url: session.url, session_id: session.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Checkout error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
