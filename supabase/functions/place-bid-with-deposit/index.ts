// Edge Function: place-bid-with-deposit
// Handles bid placement with Stripe deposit hold

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  try {
    // Get auth token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'No authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
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
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { listing_id, bid_amount_cents, proxy_max_bid_cents } = await req.json();

    // Validate inputs
    if (!listing_id || !bid_amount_cents || !proxy_max_bid_cents) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get listing details
    const { data: listing, error: listingError } = await supabase
      .from('vehicle_listings')
      .select('*')
      .eq('id', listing_id)
      .single();

    if (listingError || !listing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Listing not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
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
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Calculate deposit amount (using RPC function)
    const { data: depositAmount } = await supabase.rpc('calculate_deposit_amount', {
      p_bid_amount_cents: bid_amount_cents,
      p_listing_id: listing_id,
    });

    const deposit_amount_cents = depositAmount || Math.floor(bid_amount_cents * 0.10);

    // Create Stripe PaymentIntent for deposit hold
    const paymentIntent = await stripe.paymentIntents.create({
      amount: deposit_amount_cents,
      currency: 'usd',
      customer: profile.stripe_customer_id,
      payment_method: profile.default_payment_method,
      confirm: true,
      capture_method: 'manual', // Hold, don't capture yet
      metadata: {
        type: 'bid_deposit',
        listing_id: listing_id,
        bidder_id: user.id,
        bid_amount_cents: bid_amount_cents.toString(),
        proxy_max_bid_cents: proxy_max_bid_cents.toString(),
      },
    });

    if (paymentIntent.status !== 'requires_capture') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to authorize payment. Please check your payment method.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Place the bid using existing function
    const { data: bidResult, error: bidError } = await supabase.rpc('place_auction_bid', {
      p_listing_id: listing_id,
      p_proxy_max_bid_cents: proxy_max_bid_cents,
      p_ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
      p_user_agent: req.headers.get('user-agent'),
      p_bid_source: 'web',
    });

    if (bidError || !bidResult.success) {
      // Cancel the payment intent if bid fails
      await stripe.paymentIntents.cancel(paymentIntent.id);

      return new Response(
        JSON.stringify({
          success: false,
          error: bidResult.error || bidError?.message || 'Failed to place bid',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update bid record with payment info
    const { error: updateError } = await supabase
      .from('auction_bids')
      .update({
        deposit_payment_intent_id: paymentIntent.id,
        deposit_amount_cents: deposit_amount_cents,
        deposit_status: 'authorized',
      })
      .eq('id', bidResult.bid_id);

    if (updateError) {
      console.error('Error updating bid with payment info:', updateError);
    }

    // Record payment transaction
    await supabase.from('payment_transactions').insert({
      transaction_type: 'bid_deposit',
      listing_id: listing_id,
      bid_id: bidResult.bid_id,
      user_id: user.id,
      stripe_payment_intent_id: paymentIntent.id,
      amount_cents: deposit_amount_cents,
      status: 'authorized',
      metadata: {
        bid_amount_cents: bid_amount_cents,
        proxy_max_bid_cents: proxy_max_bid_cents,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        bid_id: bidResult.bid_id,
        deposit_amount_cents: deposit_amount_cents,
        payment_intent_id: paymentIntent.id,
        displayed_bid_cents: bidResult.displayed_bid_cents,
        auction_extended: bidResult.auction_extended,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in place-bid-with-deposit:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

