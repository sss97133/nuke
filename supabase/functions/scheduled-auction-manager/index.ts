/**
 * Scheduled Auction Manager Edge Function
 *
 * Manages the full lifecycle of scheduled auctions:
 * - Create auctions with scheduled sale dates
 * - Accept and manage committed bids
 * - Handle extension logic on late bids
 * - Settle auctions to winners
 *
 * Actions:
 * - create: Create a new scheduled auction
 * - bid: Place or update a committed bid
 * - cancel_bid: Cancel a committed bid
 * - get_bid_stack: Get visible bid stack
 * - check_endings: Process auctions that have ended
 * - settle: Settle a specific auction
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AuctionAction = 'create' | 'bid' | 'cancel_bid' | 'get_bid_stack' | 'check_endings' | 'settle' | 'get_auction';

interface CreateAuctionRequest {
  action: 'create';
  offeringId: string;
  startingPrice: number;
  reservePrice?: number;
  buyNowPrice?: number;
  sharesOffered?: number;
  visibilityStart: string;
  biddingStart: string;
  scheduledEnd: string;
  extensionEnabled?: boolean;
  title?: string;
  description?: string;
  terms?: string;
}

interface BidRequest {
  action: 'bid';
  auctionId: string;
  bidAmount: number;
  sharesRequested?: number;
  maxBid?: number;
}

interface CancelBidRequest {
  action: 'cancel_bid';
  bidId: string;
}

interface GetBidStackRequest {
  action: 'get_bid_stack';
  auctionId: string;
}

interface CheckEndingsRequest {
  action: 'check_endings';
}

interface SettleRequest {
  action: 'settle';
  auctionId: string;
}

interface GetAuctionRequest {
  action: 'get_auction';
  auctionId: string;
}

type AuctionRequest =
  | CreateAuctionRequest
  | BidRequest
  | CancelBidRequest
  | GetBidStackRequest
  | CheckEndingsRequest
  | SettleRequest
  | GetAuctionRequest;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: AuctionRequest = await req.json();
    const { action } = body;

    // Get authenticated user for most actions
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    switch (action) {
      case 'create':
        return await handleCreateAuction(supabase, body as CreateAuctionRequest, userId);
      case 'bid':
        return await handlePlaceBid(supabase, body as BidRequest, userId);
      case 'cancel_bid':
        return await handleCancelBid(supabase, body as CancelBidRequest, userId);
      case 'get_bid_stack':
        return await handleGetBidStack(supabase, body as GetBidStackRequest);
      case 'check_endings':
        return await handleCheckEndings(supabase);
      case 'settle':
        return await handleSettle(supabase, body as SettleRequest);
      case 'get_auction':
        return await handleGetAuction(supabase, body as GetAuctionRequest);
      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Auction manager error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handleCreateAuction(supabase: any, body: CreateAuctionRequest, userId: string | null) {
  if (!userId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Authentication required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const {
    offeringId,
    startingPrice,
    reservePrice,
    buyNowPrice,
    sharesOffered = 1,
    visibilityStart,
    biddingStart,
    scheduledEnd,
    extensionEnabled = true,
    title,
    description,
    terms,
  } = body;

  // Validate dates
  const visStart = new Date(visibilityStart);
  const bidStart = new Date(biddingStart);
  const schedEnd = new Date(scheduledEnd);

  if (visStart >= bidStart || bidStart >= schedEnd) {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid date sequence' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Create the auction
  const { data: auction, error } = await supabase
    .from('scheduled_auctions')
    .insert({
      offering_id: offeringId,
      seller_id: userId,
      auction_type: 'committed_offers',
      starting_price: startingPrice,
      reserve_price: reservePrice,
      buy_now_price: buyNowPrice,
      shares_offered: sharesOffered,
      visibility_start: visibilityStart,
      bidding_start: biddingStart,
      scheduled_end: scheduledEnd,
      extension_enabled: extensionEnabled,
      status: 'scheduled',
      title,
      description,
      terms,
    })
    .select()
    .single();

  if (error) throw error;

  // Log creation
  await supabase
    .from('auction_activity_log')
    .insert({
      auction_id: auction.id,
      activity_type: 'auction_created',
      user_id: userId,
      details: { starting_price: startingPrice },
    });

  return new Response(
    JSON.stringify({ success: true, auction }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handlePlaceBid(supabase: any, body: BidRequest, userId: string | null) {
  if (!userId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Authentication required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { auctionId, bidAmount, sharesRequested = 1, maxBid } = body;

  const { data: result, error } = await supabase.rpc('place_committed_bid', {
    p_auction_id: auctionId,
    p_bidder_id: userId,
    p_bid_amount: bidAmount,
    p_shares_requested: sharesRequested,
    p_max_bid: maxBid || null,
  });

  if (error) throw error;

  return new Response(
    JSON.stringify(result),
    { status: result.success ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleCancelBid(supabase: any, body: CancelBidRequest, userId: string | null) {
  if (!userId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Authentication required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const { bidId } = body;

  const { data: result, error } = await supabase.rpc('cancel_committed_bid', {
    p_bid_id: bidId,
    p_user_id: userId,
  });

  if (error) throw error;

  return new Response(
    JSON.stringify(result),
    { status: result.success ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleGetBidStack(supabase: any, body: GetBidStackRequest) {
  const { auctionId } = body;

  const { data, error } = await supabase.rpc('get_bid_stack', {
    p_auction_id: auctionId,
  });

  if (error) throw error;

  const result = data?.[0] || {
    bid_count: 0,
    total_committed: 0,
    high_bid: null,
    reserve_met: false,
    bids: [],
  };

  return new Response(
    JSON.stringify({ success: true, ...result }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleCheckEndings(supabase: any) {
  // Find auctions that have ended but not settled
  const { data: endedAuctions, error } = await supabase
    .from('scheduled_auctions')
    .select('id')
    .in('status', ['active', 'extended'])
    .lt('scheduled_end', new Date().toISOString());

  if (error) throw error;

  const results = [];

  for (const auction of endedAuctions || []) {
    // Mark as ended
    await supabase
      .from('scheduled_auctions')
      .update({ status: 'ended', updated_at: new Date().toISOString() })
      .eq('id', auction.id);

    // Log ending
    await supabase
      .from('auction_activity_log')
      .insert({
        auction_id: auction.id,
        activity_type: 'auction_ended',
      });

    // Settle the auction
    const { data: settleResult } = await supabase.rpc('settle_auction', {
      p_auction_id: auction.id,
    });

    results.push({ auction_id: auction.id, result: settleResult });
  }

  // Also update auctions that should start
  await supabase
    .from('scheduled_auctions')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('status', 'scheduled')
    .lt('bidding_start', new Date().toISOString());

  // Update preview auctions
  await supabase
    .from('scheduled_auctions')
    .update({ status: 'preview', updated_at: new Date().toISOString() })
    .eq('status', 'scheduled')
    .lt('visibility_start', new Date().toISOString())
    .gte('bidding_start', new Date().toISOString());

  return new Response(
    JSON.stringify({ success: true, processed: results.length, results }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleSettle(supabase: any, body: SettleRequest) {
  const { auctionId } = body;

  const { data: result, error } = await supabase.rpc('settle_auction', {
    p_auction_id: auctionId,
  });

  if (error) throw error;

  return new Response(
    JSON.stringify(result),
    { status: result.success ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleGetAuction(supabase: any, body: GetAuctionRequest) {
  const { auctionId } = body;

  const { data: auction, error } = await supabase
    .from('scheduled_auctions')
    .select(`
      *,
      vehicle_offerings (
        id,
        vehicle_id,
        current_share_price,
        total_shares
      )
    `)
    .eq('id', auctionId)
    .single();

  if (error) throw error;

  // Get bid stack
  const { data: bidStack } = await supabase.rpc('get_bid_stack', {
    p_auction_id: auctionId,
  });

  return new Response(
    JSON.stringify({
      success: true,
      auction,
      bid_stack: bidStack?.[0] || { bid_count: 0, total_committed: 0, bids: [] },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
