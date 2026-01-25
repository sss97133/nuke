/**
 * Cancel Order Edge Function
 *
 * Cancels an active/partially-filled order and releases reserved funds/shares.
 * - For buy orders: releases reserved cash back to available balance
 * - For sell orders: releases reserved shares
 * - Cannot cancel filled orders
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CancelOrderRequest {
  orderId: string;
  assetType?: 'vehicle' | 'organization';
}

interface CancelOrderResponse {
  success: boolean;
  sharesCancelled?: number;
  sharesFilled?: number;
  refundAmount?: number;
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

    // Get authenticated user - safely handle missing header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body - handle invalid JSON
    let body: CancelOrderRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { orderId, assetType = 'vehicle' } = body;

    if (!orderId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing orderId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate orderId is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof orderId !== 'string' || !uuidRegex.test(orderId)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid orderId format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate assetType
    if (assetType !== 'vehicle' && assetType !== 'organization') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid assetType - must be "vehicle" or "organization"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine table names based on asset type
    const ordersTable = assetType === 'organization' ? 'organization_market_orders' : 'market_orders';

    // Get order details first to validate ownership
    const { data: order, error: orderError } = await supabase
      .from(ordersTable)
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found or not owned by user' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.status === 'filled') {
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot cancel a filled order' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.status === 'cancelled') {
      return new Response(
        JSON.stringify({ success: false, error: 'Order is already cancelled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.status === 'expired') {
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot cancel an expired order' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call the cancel_order RPC function
    const { data: cancelResult, error: cancelError } = await supabase.rpc('cancel_order', {
      p_order_id: orderId,
      p_user_id: user.id
    });

    if (cancelError) {
      console.error('Cancel order error:', cancelError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to cancel order: ' + cancelError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!cancelResult?.success) {
      return new Response(
        JSON.stringify({ success: false, error: cancelResult?.error || 'Unknown cancellation error' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sharesCancelled = cancelResult.shares_cancelled || 0;
    const sharesFilled = cancelResult.shares_filled || 0;

    // Calculate refund amount for buy orders
    let refundAmount: number | undefined;
    if (order.order_type === 'buy' && sharesCancelled > 0) {
      refundAmount = sharesCancelled * order.price_per_share * 1.02; // Including commission
    }

    const response: CancelOrderResponse = {
      success: true,
      sharesCancelled,
      sharesFilled,
      refundAmount,
      message: `Order cancelled. ${sharesFilled > 0 ? `${sharesFilled} shares were already filled. ` : ''}${sharesCancelled} shares cancelled.`
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
