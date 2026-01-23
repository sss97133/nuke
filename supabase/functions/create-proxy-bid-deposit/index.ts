// Edge Function: create-proxy-bid-deposit
// Creates a Stripe PaymentIntent hold for proxy bid deposits on external auctions

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // Get auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's token
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { proxy_bid_request_id } = await req.json();

    if (!proxy_bid_request_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'proxy_bid_request_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the proxy bid request
    const { data: bidRequest, error: bidError } = await supabase
      .from('proxy_bid_requests')
      .select('*')
      .eq('id', proxy_bid_request_id)
      .eq('user_id', user.id)
      .single();

    if (bidError || !bidRequest) {
      return new Response(
        JSON.stringify({ success: false, error: 'Proxy bid request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if deposit already authorized
    if (bidRequest.deposit_payment_intent_id && bidRequest.deposit_status === 'authorized') {
      return new Response(
        JSON.stringify({
          success: true,
          already_authorized: true,
          payment_intent_id: bidRequest.deposit_payment_intent_id,
          deposit_amount_cents: bidRequest.deposit_amount_cents,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user's Stripe customer ID and payment method
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, default_payment_method')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.stripe_customer_id || !profile?.default_payment_method) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No payment method on file. Please add a payment method first.',
          requires_payment_method: true,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate deposit amount (10% of max bid)
    const depositAmountCents = bidRequest.deposit_amount_cents || Math.round(bidRequest.max_bid_cents * 0.1);

    // Create Stripe PaymentIntent with manual capture (hold)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: depositAmountCents,
      currency: 'usd',
      customer: profile.stripe_customer_id,
      payment_method: profile.default_payment_method,
      confirm: true,
      capture_method: 'manual', // Hold, don't capture yet
      metadata: {
        type: 'proxy_bid_deposit',
        proxy_bid_request_id: proxy_bid_request_id,
        user_id: user.id,
        max_bid_cents: bidRequest.max_bid_cents.toString(),
        platform: bidRequest.platform,
        external_listing_id: bidRequest.external_listing_id || '',
      },
      description: `Proxy bid deposit for ${bidRequest.platform} auction`,
    });

    // Check if authorization succeeded
    if (paymentIntent.status !== 'requires_capture') {
      // Clean up and return error
      try {
        await stripe.paymentIntents.cancel(paymentIntent.id);
      } catch (e) {
        console.error('Failed to cancel payment intent:', e);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to authorize payment. Please check your payment method.',
          payment_status: paymentIntent.status,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update proxy bid request with payment info
    const { error: updateError } = await supabase
      .from('proxy_bid_requests')
      .update({
        deposit_payment_intent_id: paymentIntent.id,
        deposit_amount_cents: depositAmountCents,
        deposit_status: 'authorized',
        status: 'active', // Move from pending to active now that deposit is secured
      })
      .eq('id', proxy_bid_request_id);

    if (updateError) {
      console.error('Error updating proxy bid request:', updateError);
      // Don't fail the request - the payment is authorized
    }

    // Record in payment_transactions for audit trail (if table exists)
    try {
      await supabase.from('payment_transactions').insert({
        transaction_type: 'proxy_bid_deposit',
        user_id: user.id,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: depositAmountCents,
        status: 'authorized',
        metadata: {
          proxy_bid_request_id: proxy_bid_request_id,
          max_bid_cents: bidRequest.max_bid_cents,
          platform: bidRequest.platform,
          external_listing_id: bidRequest.external_listing_id,
        },
      });
    } catch (e) {
      // Non-critical - payment_transactions may not exist
      console.log('Could not record transaction:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        payment_intent_id: paymentIntent.id,
        deposit_amount_cents: depositAmountCents,
        deposit_status: 'authorized',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in create-proxy-bid-deposit:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
