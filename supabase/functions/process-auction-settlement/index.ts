// Edge Function: process-auction-settlement
// Processes auction end: captures deposit, charges remainder, pays seller

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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { listing_id } = await req.json();

    if (!listing_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'listing_id required' }),
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

    // Get winning bid
    const { data: winningBid, error: bidError } = await supabase
      .from('auction_bids')
      .select('*')
      .eq('listing_id', listing_id)
      .eq('is_winning', true)
      .single();

    if (bidError || !winningBid) {
      return new Response(
        JSON.stringify({ success: false, error: 'No winning bid found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if reserve was met
    const reserveMet = !listing.reserve_price_cents || 
      winningBid.displayed_bid_cents >= listing.reserve_price_cents;

    if (!reserveMet) {
      // Release deposit since reserve not met
      await stripe.paymentIntents.cancel(winningBid.deposit_payment_intent_id);
      
      await supabase
        .from('auction_bids')
        .update({ deposit_status: 'released' })
        .eq('id', winningBid.id);

      await supabase
        .from('vehicle_listings')
        .update({ status: 'expired', payout_status: 'cancelled' })
        .eq('id', listing_id);

      return new Response(
        JSON.stringify({ success: true, status: 'reserve_not_met' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Capture the deposit
    await stripe.paymentIntents.capture(winningBid.deposit_payment_intent_id);

    await supabase
      .from('auction_bids')
      .update({ deposit_status: 'captured' })
      .eq('id', winningBid.id);

    await supabase.from('payment_transactions').insert({
      transaction_type: 'deposit_capture',
      listing_id: listing_id,
      bid_id: winningBid.id,
      user_id: winningBid.bidder_id,
      stripe_payment_intent_id: winningBid.deposit_payment_intent_id,
      amount_cents: winningBid.deposit_amount_cents,
      status: 'succeeded',
    });

    // 2. Charge the remainder
    const remainderCents = winningBid.displayed_bid_cents - winningBid.deposit_amount_cents;

    // Get winner's payment info
    const { data: winnerProfile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, default_payment_method')
      .eq('id', winningBid.bidder_id)
      .single();

    let finalPaymentIntent;
    if (remainderCents > 0) {
      finalPaymentIntent = await stripe.paymentIntents.create({
        amount: remainderCents,
        currency: 'usd',
        customer: winnerProfile.stripe_customer_id,
        payment_method: winnerProfile.default_payment_method,
        confirm: true,
        metadata: {
          type: 'auction_final_payment',
          listing_id: listing_id,
          bid_id: winningBid.id,
        },
      });

      await supabase
        .from('auction_bids')
        .update({
          final_payment_intent_id: finalPaymentIntent.id,
          final_payment_status: finalPaymentIntent.status,
        })
        .eq('id', winningBid.id);

      await supabase.from('payment_transactions').insert({
        transaction_type: 'final_payment',
        listing_id: listing_id,
        bid_id: winningBid.id,
        user_id: winningBid.bidder_id,
        stripe_payment_intent_id: finalPaymentIntent.id,
        stripe_charge_id: finalPaymentIntent.latest_charge,
        amount_cents: remainderCents,
        status: 'succeeded',
      });
    }

    // 3. Calculate commission and seller payout
    const { data: financials } = await supabase.rpc('calculate_auction_financials', {
      p_listing_id: listing_id,
      p_final_bid_cents: winningBid.displayed_bid_cents,
    });

    // 4. Pay seller (if they have Stripe Connect account)
    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', listing.seller_id)
      .single();

    let transfer;
    if (sellerProfile?.stripe_account_id) {
      transfer = await stripe.transfers.create({
        amount: financials.seller_payout_cents,
        currency: 'usd',
        destination: sellerProfile.stripe_account_id,
        metadata: {
          listing_id: listing_id,
          vehicle_id: listing.vehicle_id,
        },
      });

      await supabase.from('payment_transactions').insert({
        transaction_type: 'seller_payout',
        listing_id: listing_id,
        user_id: listing.seller_id,
        stripe_transfer_id: transfer.id,
        amount_cents: financials.seller_payout_cents,
        status: 'succeeded',
      });
    }

    // 5. Record commission
    await supabase.from('payment_transactions').insert({
      transaction_type: 'commission',
      listing_id: listing_id,
      amount_cents: financials.commission_cents,
      status: 'succeeded',
      metadata: {
        commission_rate: financials.commission_rate,
        total_sale_cents: winningBid.displayed_bid_cents,
      },
    });

    // 6. Update listing
    await supabase
      .from('vehicle_listings')
      .update({
        status: 'sold',
        sold_at: new Date().toISOString(),
        sold_price_cents: winningBid.displayed_bid_cents,
        buyer_id: winningBid.bidder_id,
        commission_cents: financials.commission_cents,
        seller_payout_cents: financials.seller_payout_cents,
        payout_status: transfer ? 'completed' : 'pending',
        payout_transfer_id: transfer?.id,
        payout_completed_at: transfer ? new Date().toISOString() : null,
      })
      .eq('id', listing_id);

    return new Response(
      JSON.stringify({
        success: true,
        status: 'sold',
        final_price_cents: winningBid.displayed_bid_cents,
        commission_cents: financials.commission_cents,
        seller_payout_cents: financials.seller_payout_cents,
        payout_status: transfer ? 'completed' : 'pending',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in process-auction-settlement:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

