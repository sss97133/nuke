// Edge Function: release-proxy-bid-deposit
// Releases deposit hold when user loses auction or cancels their proxy bid

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

    // This function can be called by:
    // 1. User cancelling their bid (requires auth)
    // 2. System when user loses auction (uses service role)
    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
    });

    const { proxy_bid_request_id, reason } = await req.json();

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
      .single();

    if (bidError || !bidRequest) {
      return new Response(
        JSON.stringify({ success: false, error: 'Proxy bid request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If user is authenticated, verify they own this bid
    if (authHeader) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && user.id !== bidRequest.user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Check if there's a deposit to release
    if (!bidRequest.deposit_payment_intent_id) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No deposit to release',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if deposit is in a releasable state
    if (bidRequest.deposit_status !== 'authorized') {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Deposit cannot be released (current status: ${bidRequest.deposit_status})`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cancel the Stripe PaymentIntent (releases hold)
    try {
      await stripe.paymentIntents.cancel(bidRequest.deposit_payment_intent_id);
    } catch (stripeError: any) {
      // If the payment intent is already canceled, that's fine
      if (stripeError.code !== 'payment_intent_unexpected_state') {
        throw stripeError;
      }
    }

    // Update proxy bid request
    const newStatus = reason === 'user_cancelled' ? 'cancelled' :
                      reason === 'lost' ? 'lost' :
                      reason === 'expired' ? 'expired' : bidRequest.status;

    const { error: updateError } = await supabase
      .from('proxy_bid_requests')
      .update({
        deposit_status: 'released',
        status: newStatus,
      })
      .eq('id', proxy_bid_request_id);

    if (updateError) {
      console.error('Error updating proxy bid request:', updateError);
    }

    // Record transaction for audit trail
    try {
      await supabase.from('payment_transactions').insert({
        transaction_type: 'proxy_deposit_release',
        user_id: bidRequest.user_id,
        stripe_payment_intent_id: bidRequest.deposit_payment_intent_id,
        amount_cents: bidRequest.deposit_amount_cents,
        status: 'succeeded',
        metadata: {
          proxy_bid_request_id: proxy_bid_request_id,
          reason: reason || 'unspecified',
          original_max_bid_cents: bidRequest.max_bid_cents,
        },
      });
    } catch (e) {
      console.log('Could not record transaction:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Deposit released successfully',
        deposit_amount_cents: bidRequest.deposit_amount_cents,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in release-proxy-bid-deposit:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
