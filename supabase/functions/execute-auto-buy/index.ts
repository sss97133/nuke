import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Execute Auto-Buy Order
 * 
 * When a vehicle price hits a watchlist's target price, this function:
 * 1. Places bid (for auctions)
 * 2. Executes buy-now purchase
 * 3. Handles payment processing
 * 4. Updates execution status
 * 
 * Like a limit order in stock market - executes automatically when price is right
 */

interface Deno {
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

Deno.serve(async (req: Request) => {
  try {
    const { executionId, userConfirmed } = await req.json();

    if (!executionId) {
      return new Response(
        JSON.stringify({ error: 'executionId required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get execution record
    const { data: execution, error: execError } = await supabase
      .from('auto_buy_executions')
      .select(`
        *,
        vehicle_watchlist!inner(*),
        vehicles(*),
        external_listings(*)
      `)
      .eq('id', executionId)
      .single();

    if (execError || !execution) {
      throw new Error('Execution not found');
    }

    const watchlist = execution.vehicle_watchlist;
    const vehicle = execution.vehicles;
    const listing = execution.external_listings;

    // Check if requires confirmation
    if (execution.requires_confirmation && !userConfirmed && !execution.user_confirmed) {
      // Update status to pending confirmation
      await supabase
        .from('auto_buy_executions')
        .update({ status: 'pending' })
        .eq('id', executionId);

      // Create notification for user
      // (Notification system integration)

      return new Response(
        JSON.stringify({
          success: true,
          status: 'pending_confirmation',
          message: 'Auto-buy requires user confirmation'
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update status to executing
    await supabase
      .from('auto_buy_executions')
      .update({ 
        status: 'executing',
        user_confirmed: userConfirmed || execution.user_confirmed,
        user_confirmed_at: userConfirmed ? new Date().toISOString() : execution.user_confirmed_at
      })
      .eq('id', executionId);

    let result: any = { success: false };

    // Execute based on type
    switch (execution.execution_type) {
      case 'bid_placed':
        // Place bid on auction
        result = await placeAuctionBid(
          supabase,
          execution,
          vehicle,
          listing,
          watchlist
        );
        break;

      case 'buy_now':
        // Execute buy-now purchase
        result = await executeBuyNow(
          supabase,
          execution,
          vehicle,
          listing,
          watchlist
        );
        break;

      case 'reserve_met_bid':
        // Place bid when reserve is met
        result = await placeReserveMetBid(
          supabase,
          execution,
          vehicle,
          listing,
          watchlist
        );
        break;

      case 'price_drop_buy':
        // Buy when price drops to target
        result = await executePriceDropBuy(
          supabase,
          execution,
          vehicle,
          listing,
          watchlist
        );
        break;

      default:
        throw new Error(`Unknown execution type: ${execution.execution_type}`);
    }

    // Update execution with result
    await supabase
      .from('auto_buy_executions')
      .update({
        status: result.success ? 'completed' : 'failed',
        executed_at: result.success ? new Date().toISOString() : null,
        completed_at: result.success ? new Date().toISOString() : null,
        bid_id: result.bid_id || null,
        transaction_id: result.transaction_id || null,
        payment_intent_id: result.payment_intent_id || null,
        error_message: result.error || null,
        execution_data: result.data || {},
        executed_price: result.executed_price || execution.executed_price
      })
      .eq('id', executionId);

    return new Response(
      JSON.stringify({
        success: result.success,
        execution_id: executionId,
        result
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

// Place bid on auction
async function placeAuctionBid(
  supabase: any,
  execution: any,
  vehicle: any,
  listing: any,
  watchlist: any
) {
  // Calculate bid amount
  const currentBid = listing.current_bid || 0;
  const bidIncrement = watchlist.auto_buy_bid_increment || 100;
  const maxBid = watchlist.auto_buy_max_bid || execution.target_price;
  const bidAmount = Math.min(currentBid + bidIncrement, maxBid);

  if (bidAmount > maxBid) {
    return {
      success: false,
      error: 'Bid amount exceeds maximum bid limit'
    };
  }

  // Place bid via auction system
  // This would integrate with your auction/bidding system
  const { data: bid, error: bidError } = await supabase
    .from('auction_bids')
    .insert({
      vehicle_id: vehicle.id,
      user_id: watchlist.user_id,
      bid_amount: bidAmount,
      source: 'auto_buy',
      auto_buy_execution_id: execution.id
    })
    .select('id')
    .single();

  if (bidError) {
    return {
      success: false,
      error: bidError.message
    };
  }

  return {
    success: true,
    bid_id: bid.id,
    executed_price: bidAmount,
    data: {
      bid_amount: bidAmount,
      current_bid: currentBid,
      bid_increment: bidIncrement
    }
  };
}

// Execute buy-now purchase
async function executeBuyNow(
  supabase: any,
  execution: any,
  vehicle: any,
  listing: any,
  watchlist: any
) {
  const buyNowPrice = listing.buy_now_price || execution.target_price;

  // Process payment
  // This would integrate with Stripe or your payment processor
  // For now, create a transaction record

  const { data: transaction, error: transError } = await supabase
    .from('transactions')
    .insert({
      vehicle_id: vehicle.id,
      buyer_id: watchlist.user_id,
      seller_id: listing.organization_id,
      amount: buyNowPrice,
      transaction_type: 'buy_now',
      status: 'pending',
      source: 'auto_buy',
      auto_buy_execution_id: execution.id
    })
    .select('id')
    .single();

  if (transError) {
    return {
      success: false,
      error: transError.message
    };
  }

  // Payment processing would happen here
  // Stripe integration, etc.

  return {
    success: true,
    transaction_id: transaction.id,
    executed_price: buyNowPrice,
    data: {
      buy_now_price: buyNowPrice
    }
  };
}

// Place bid when reserve is met
async function placeReserveMetBid(
  supabase: any,
  execution: any,
  vehicle: any,
  listing: any,
  watchlist: any
) {
  // Similar to placeAuctionBid but triggered when reserve is met
  return await placeAuctionBid(supabase, execution, vehicle, listing, watchlist);
}

// Execute buy when price drops to target
async function executePriceDropBuy(
  supabase: any,
  execution: any,
  vehicle: any,
  listing: any,
  watchlist: any
) {
  // Similar to executeBuyNow but triggered by price drop
  return await executeBuyNow(supabase, execution, vehicle, listing, watchlist);
}

