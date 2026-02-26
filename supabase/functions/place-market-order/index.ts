/**
 * place-market-order
 *
 * 1. Pre-trade risk check (offering active, sufficient cash/shares)
 * 2. Insert order into market_orders
 * 3. Reserve cash for buy orders (at limit price)
 * 4. Run match_order_book immediately — fills against resting orders
 * 5. Return order ID + fill summary
 *
 * Commission: 2% taken from seller proceeds (buyer pays shares × price only).
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized', success: false, status: 'rejected', sharesFilled: 0 }, 401);

    // Use user's JWT so RLS + auth.uid() work in called RPCs
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: 'Unauthorized', success: false, status: 'rejected', sharesFilled: 0 }, 401);

    const body = await req.json();
    const { offeringId, orderType, sharesRequested, pricePerShare, timeInForce = 'day' } = body;

    // ── Validate ────────────────────────────────────────────────────────────
    if (!offeringId || !orderType || !sharesRequested || !pricePerShare) {
      return json({ error: 'Missing required fields', success: false, status: 'rejected', sharesFilled: 0 }, 400);
    }
    if (orderType !== 'buy' && orderType !== 'sell') {
      return json({ error: 'orderType must be buy or sell', success: false, status: 'rejected', sharesFilled: 0 }, 400);
    }
    if (!Number.isInteger(sharesRequested) || sharesRequested <= 0) {
      return json({ error: 'sharesRequested must be a positive integer', success: false, status: 'rejected', sharesFilled: 0 }, 400);
    }
    if (pricePerShare <= 0) {
      return json({ error: 'pricePerShare must be positive', success: false, status: 'rejected', sharesFilled: 0 }, 400);
    }

    // ── Step 1: Pre-trade risk check ────────────────────────────────────────
    const priceCents = Math.round(pricePerShare * 100);
    const { data: riskRows, error: riskErr } = await supabase.rpc('pre_trade_risk_check', {
      p_user_id:     user.id,
      p_offering_id: offeringId,
      p_shares:      sharesRequested,
      p_price_cents: priceCents,
      p_side:        orderType,
    });

    if (riskErr) {
      return json({ error: riskErr.message, success: false, status: 'rejected', sharesFilled: 0 }, 400);
    }

    const risk = Array.isArray(riskRows) ? riskRows[0] : riskRows;
    if (!risk?.allowed) {
      return json({
        success: false,
        status: 'rejected',
        sharesFilled: 0,
        error: risk?.reason || 'Order rejected',
      }, 400);
    }

    // ── Step 2: Insert order ────────────────────────────────────────────────
    const { data: orderRow, error: insertErr } = await supabase
      .from('market_orders')
      .insert({
        offering_id:      offeringId,
        user_id:          user.id,
        order_type:       orderType,
        shares_requested: sharesRequested,
        price_per_share:  pricePerShare,
        total_value:      sharesRequested * pricePerShare,
        time_in_force:    timeInForce,
        status:           'active',
      })
      .select('id')
      .single();

    if (insertErr || !orderRow) {
      return json({ error: insertErr?.message || 'Failed to create order', success: false, status: 'rejected', sharesFilled: 0 }, 500);
    }

    const orderId = orderRow.id;

    // ── Step 3: Reserve cash for buy orders ─────────────────────────────────
    // Reserve at limit price × shares (commission comes from seller, not buyer)
    if (orderType === 'buy') {
      const reserveCents = Math.round(sharesRequested * pricePerShare * 100);
      const { error: reserveErr } = await supabase.rpc('reserve_cash', {
        p_user_id:      user.id,
        p_amount_cents: reserveCents,
        p_reference_id: orderId,
      });

      if (reserveErr) {
        // Roll back the order
        await supabase.from('market_orders').update({ status: 'cancelled' }).eq('id', orderId);
        return json({ error: reserveErr.message || 'Failed to reserve cash', success: false, status: 'rejected', sharesFilled: 0 }, 400);
      }
    }

    // ── Step 4: Run matching engine ─────────────────────────────────────────
    const { data: matchRows, error: matchErr } = await supabase.rpc('match_order_book', {
      p_order_id: orderId,
    });

    if (matchErr) {
      // Matching failed — order lives as 'active', will rest in the book
      console.error('[place-market-order] match_order_book error:', matchErr.message);
      return json({
        success: true,
        orderId,
        status: 'active',
        sharesFilled: 0,
        tradesExecuted: 0,
        message: 'Order placed — resting in order book',
      });
    }

    // match_order_book returns TABLE(trades_executed INT, shares_filled INT, avg_fill_price NUMERIC, final_status TEXT)
    const match       = Array.isArray(matchRows) ? matchRows[0] : matchRows;
    const filled      = match?.shares_filled    ?? 0;
    const avgPrice    = match?.avg_fill_price   ? Number(match.avg_fill_price) : null;
    const finalStatus = match?.final_status     ?? 'active';
    const trades      = match?.trades_executed  ?? 0;

    return json({
      success:          true,
      orderId,
      status:           finalStatus,
      sharesFilled:     filled,
      averageFillPrice: avgPrice ?? undefined,
      totalValue:       filled > 0 && avgPrice ? filled * avgPrice : undefined,
      commission:       filled > 0 && avgPrice ? filled * avgPrice * 0.02 : undefined,
      tradesExecuted:   trades,
      message: filled > 0
        ? `${orderType.toUpperCase()} ${filled}/${sharesRequested} shares filled @ avg $${(avgPrice ?? pricePerShare).toFixed(4)}`
        : 'Order placed — resting in order book',
    });

  } catch (err: any) {
    console.error('[place-market-order] unhandled error:', err);
    return json({ error: err?.message || 'Internal error', success: false, status: 'rejected', sharesFilled: 0 }, 500);
  }
});
