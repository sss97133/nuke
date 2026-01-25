/**
 * TRADING API
 *
 * Execute trades, manage portfolios, view transaction history.
 * All operations are fully audited for regulatory compliance.
 *
 * Endpoints:
 * POST /trading { action: "buy" | "sell", index_id?, vehicle_id?, shares?, amount? }
 * GET /trading?action=portfolio - Get portfolio summary
 * GET /trading?action=history - Get transaction history
 * GET /trading?action=indexes - Get available indexes with current prices
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse(401, "Authorization required");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(401, "Invalid token");
    }

    const url = new URL(req.url);

    // Handle GET requests
    if (req.method === "GET") {
      const action = url.searchParams.get("action");

      switch (action) {
        case "portfolio":
          return await getPortfolio(supabase, user.id);
        case "history":
          return await getTransactionHistory(supabase, user.id);
        case "indexes":
          return await getAvailableIndexes(supabase);
        case "wallet":
          return await getWallet(supabase, user.id);
        default:
          return await getPortfolio(supabase, user.id);
      }
    }

    // Handle POST requests (trades)
    if (req.method === "POST") {
      const body = await req.json();
      return await executeTrade(supabase, user.id, body);
    }

    return errorResponse(405, "Method not allowed");

  } catch (e: any) {
    console.error("Trading API error:", e);
    return errorResponse(500, e.message);
  }
});

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function successResponse(data: any) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getWallet(supabase: any, userId: string) {
  // Check if wallet exists, create if not
  let { data: wallet, error } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('user_id', userId)
    .eq('currency', 'USD')
    .single();

  if (error && error.code === 'PGRST116') {
    // No wallet, create one
    const { data: newWallet, error: createError } = await supabase
      .from('user_wallets')
      .insert({
        user_id: userId,
        balance: 100000.00,
        currency: 'USD'
      })
      .select()
      .single();

    if (createError) throw createError;

    // Record initial deposit
    await supabase.from('investment_transactions').insert({
      user_id: userId,
      transaction_type: 'deposit',
      total_amount: 100000.00,
      balance_before: 0,
      balance_after: 100000.00,
      status: 'completed',
      notes: 'Initial mock money allocation'
    });

    wallet = newWallet;
  } else if (error) {
    throw error;
  }

  return successResponse({
    wallet: {
      balance: wallet.balance,
      currency: wallet.currency,
      created_at: wallet.created_at
    }
  });
}

async function getPortfolio(supabase: any, userId: string) {
  // Ensure wallet exists
  await getWallet(supabase, userId);

  const { data, error } = await supabase.rpc('get_portfolio_summary', {
    p_user_id: userId
  });

  if (error) throw error;

  return successResponse({
    portfolio: data
  });
}

async function getTransactionHistory(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('investment_transactions')
    .select(`
      id,
      transaction_type,
      index_id,
      vehicle_id,
      shares,
      price_per_share,
      total_amount,
      fee_amount,
      balance_before,
      balance_after,
      status,
      notes,
      created_at,
      executed_at,
      market_indexes(index_code, index_name),
      vehicles(year, make, model)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  const transactions = (data || []).map((t: any) => ({
    id: t.id,
    type: t.transaction_type,
    asset: t.market_indexes
      ? { type: 'index', code: t.market_indexes.index_code, name: t.market_indexes.index_name }
      : t.vehicles
      ? { type: 'vehicle', name: `${t.vehicles.year} ${t.vehicles.make} ${t.vehicles.model}` }
      : null,
    shares: t.shares,
    price_per_share: t.price_per_share,
    total_amount: t.total_amount,
    fee: t.fee_amount,
    balance_after: t.balance_after,
    status: t.status,
    notes: t.notes,
    timestamp: t.executed_at || t.created_at
  }));

  return successResponse({ transactions });
}

async function getAvailableIndexes(supabase: any) {
  // Get all active indexes with their latest values
  const { data: indexes, error } = await supabase
    .from('market_indexes')
    .select(`
      id,
      index_code,
      index_name,
      description,
      is_active,
      market_index_values(
        close_value,
        volume,
        value_date,
        calculation_metadata
      )
    `)
    .eq('is_active', true)
    .order('index_code');

  if (error) throw error;

  const result = (indexes || []).map((idx: any) => {
    const latestValue = idx.market_index_values?.[0];
    return {
      id: idx.id,
      code: idx.index_code,
      name: idx.index_name,
      description: idx.description,
      current_price: latestValue?.close_value || 0,
      volume: latestValue?.volume || 0,
      as_of: latestValue?.value_date,
      metadata: latestValue?.calculation_metadata
    };
  });

  return successResponse({ indexes: result });
}

async function executeTrade(supabase: any, userId: string, body: any) {
  const { action, index_id, vehicle_id, shares, amount } = body;

  if (!action || !['buy', 'sell'].includes(action)) {
    return errorResponse(400, "Action must be 'buy' or 'sell'");
  }

  if (!index_id && !vehicle_id) {
    return errorResponse(400, "Must specify index_id or vehicle_id");
  }

  if (!shares && !amount) {
    return errorResponse(400, "Must specify shares or amount");
  }

  // Ensure wallet exists
  await getWallet(supabase, userId);

  // Execute the trade
  const { data, error } = await supabase.rpc('execute_trade', {
    p_user_id: userId,
    p_action: action,
    p_index_id: index_id || null,
    p_vehicle_id: vehicle_id || null,
    p_shares: shares || null,
    p_amount: amount || null
  });

  if (error) throw error;

  if (!data.success) {
    return errorResponse(400, data.error);
  }

  // Get updated portfolio
  const { data: portfolio } = await supabase.rpc('get_portfolio_summary', {
    p_user_id: userId
  });

  return successResponse({
    trade: data,
    portfolio
  });
}
