/**
 * Place Market Order Edge Function
 * 
 * Handles buy/sell orders for fractional vehicle ownership:
 * 1. Validates user funds (for buy orders)
 * 2. Reserves cash (for buy) or shares (for sell)
 * 3. Creates order in market_orders table
 * 4. Attempts immediate matching against existing orders
 * 5. Returns order confirmation with execution status
 * 
 * Commission: 2% on all trades (paid by buyer)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlaceOrderRequest {
  offeringId: string;
  assetType?: 'vehicle' | 'organization';  // NEW: support both assets
  orderType: 'buy' | 'sell';
  sharesRequested: number;
  pricePerShare: number; // In dollars (will be converted to decimal)
  timeInForce?: 'day' | 'gtc' | 'fok' | 'ioc';
}

interface OrderResponse {
  success: boolean;
  orderId?: string;
  status: 'active' | 'filled' | 'partially_filled' | 'rejected';
  sharesFilled: number;
  averageFillPrice?: number;
  totalValue?: number;
  commission?: number;
  message?: string;
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authenticated user
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: PlaceOrderRequest = await req.json();
    const { offeringId, assetType = 'vehicle', orderType, sharesRequested, pricePerShare, timeInForce = 'day' } = body;
    
    // Determine table names based on asset type
    const ordersTable = assetType === 'organization' ? 'organization_market_orders' : 'market_orders';
    const holdingsTable = assetType === 'organization' ? 'organization_share_holdings' : 'share_holdings';
    const tradesTable = assetType === 'organization' ? 'organization_market_trades' : 'market_trades';

    // Validate input
    if (!offeringId || !orderType || !sharesRequested || !pricePerShare) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (sharesRequested <= 0 || pricePerShare <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid order parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate order values
    const COMMISSION_PCT = 2.0;
    const subtotal = sharesRequested * pricePerShare;
    const commission = orderType === 'buy' ? (subtotal * COMMISSION_PCT / 100) : 0;
    const totalValue = orderType === 'buy' ? subtotal + commission : subtotal;

    // For buy orders: Check and reserve funds
    if (orderType === 'buy') {
      const { data: balance } = await supabase
        .from('user_cash_balances')
        .select('available_cents')
        .eq('user_id', user.id)
        .single();

      const availableCents = balance?.available_cents || 0;
      const requiredCents = Math.round(totalValue * 100); // Convert to cents

      if (availableCents < requiredCents) {
        return new Response(
          JSON.stringify({
            success: false,
            status: 'rejected',
            sharesFilled: 0,
            error: `Insufficient funds: $${(availableCents / 100).toFixed(2)} available, $${totalValue.toFixed(2)} required`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Reserve the cash
      const { error: reserveError } = await supabase.rpc('reserve_cash', {
        p_user_id: user.id,
        p_amount_cents: requiredCents,
        p_reference_id: offeringId
      });

      if (reserveError) {
        console.error('Failed to reserve cash:', reserveError);
        return new Response(
          JSON.stringify({ success: false, status: 'rejected', sharesFilled: 0, error: 'Failed to reserve funds' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // For sell orders: Check and reserve shares
    if (orderType === 'sell') {
      const { data: holding } = await supabase
        .from(holdingsTable)
        .select('shares_owned')
        .eq('offering_id', offeringId)
        .eq('holder_id', user.id)
        .maybeSingle();

      const sharesOwned = holding?.shares_owned || 0;

      if (sharesOwned < sharesRequested) {
        return new Response(
          JSON.stringify({
            success: false,
            status: 'rejected',
            sharesFilled: 0,
            error: `Insufficient shares: ${sharesOwned} owned, ${sharesRequested} requested`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // TODO: Reserve shares (implement share reservation system)
    }

    // Create the order
    const { data: order, error: orderError } = await supabase
      .from(ordersTable)
      .insert({
        offering_id: offeringId,
        user_id: user.id,
        order_type: orderType,
        status: 'active',
        shares_requested: sharesRequested,
        shares_filled: 0,
        price_per_share: pricePerShare,
        total_value: totalValue,
        time_in_force: timeInForce
      })
      .select()
      .single();

    if (orderError) {
      console.error('Failed to create order:', orderError);
      
      // Release reserved funds on failure
      if (orderType === 'buy') {
        await supabase.rpc('release_reserved_cash', {
          p_user_id: user.id,
          p_amount_cents: Math.round(totalValue * 100),
          p_reference_id: offeringId
        });
      }

      return new Response(
        JSON.stringify({ success: false, status: 'rejected', sharesFilled: 0, error: 'Failed to create order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // TODO: Attempt immediate matching (implement order matching engine)
    // For now, just return the order as "active"

    const response: OrderResponse = {
      success: true,
      orderId: order.id,
      status: 'active',
      sharesFilled: 0,
      message: `${orderType.toUpperCase()} order placed for ${sharesRequested} shares @ $${pricePerShare.toFixed(2)}/share`
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

