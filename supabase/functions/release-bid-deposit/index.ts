// Edge Function: release-bid-deposit
// Releases deposit hold when bidder is outbid

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
    // This function is called by database triggers, so we use service key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { bid_id } = await req.json();

    if (!bid_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'bid_id required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get bid details
    const { data: bid, error: bidError } = await supabase
      .from('auction_bids')
      .select('*')
      .eq('id', bid_id)
      .single();

    if (bidError || !bid) {
      return new Response(
        JSON.stringify({ success: false, error: 'Bid not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Only release if deposit is authorized and user is outbid
    if (bid.deposit_status !== 'authorized' || !bid.is_outbid) {
      return new Response(
        JSON.stringify({ success: false, error: 'Bid not eligible for release' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Cancel the payment intent (releases hold)
    await stripe.paymentIntents.cancel(bid.deposit_payment_intent_id);

    // Update bid record
    await supabase
      .from('auction_bids')
      .update({
        deposit_status: 'released',
        deposit_released_at: new Date().toISOString(),
      })
      .eq('id', bid_id);

    // Record transaction
    await supabase.from('payment_transactions').insert({
      transaction_type: 'deposit_release',
      listing_id: bid.listing_id,
      bid_id: bid_id,
      user_id: bid.bidder_id,
      stripe_payment_intent_id: bid.deposit_payment_intent_id,
      amount_cents: bid.deposit_amount_cents,
      status: 'succeeded',
    });

    return new Response(
      JSON.stringify({ success: true, bid_id: bid_id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in release-bid-deposit:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

