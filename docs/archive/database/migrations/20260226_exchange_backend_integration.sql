-- =============================================================================
-- Exchange Backend Integration
-- 2026-02-26
--
-- Fixes:
-- 1. pre_trade_risk_check RPC (was missing — place-market-order fell open)
-- 2. update_market_nav() — computes fund NAV from segment stats + vehicle prices
-- 3. mark_to_market() — updates current_mark on all holdings
-- 4. update_vehicle_offering_prices() — syncs offering price from nuke_estimate
-- =============================================================================

-- =============================================================================
-- 1. pre_trade_risk_check
--    Called by place-market-order edge function before executing any trade.
--    Returns: {allowed: bool, reason: text, available_cash_cents: int, available_shares: int}
-- =============================================================================
CREATE OR REPLACE FUNCTION pre_trade_risk_check(
  p_user_id       UUID,
  p_offering_id   UUID,
  p_shares        INTEGER,
  p_price_cents   BIGINT,
  p_side          TEXT  -- 'buy' or 'sell'
)
RETURNS TABLE (
  allowed               BOOLEAN,
  reason                TEXT,
  available_cash_cents  BIGINT,
  available_shares      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cash_cents          BIGINT;
  v_available_cents     BIGINT;
  v_shares_held         INTEGER;
  v_offering_status     TEXT;
  v_order_cost_cents    BIGINT;
  v_commission_pct      NUMERIC := 2.0;
BEGIN
  -- 1. Check offering is active and trading
  SELECT status INTO v_offering_status
  FROM vehicle_offerings
  WHERE id = p_offering_id;

  IF v_offering_status IS NULL THEN
    RETURN QUERY SELECT false, 'Offering not found', 0::BIGINT, 0;
    RETURN;
  END IF;

  IF v_offering_status != 'trading' THEN
    RETURN QUERY SELECT false, 'Offering is not currently trading (status: ' || v_offering_status || ')', 0::BIGINT, 0;
    RETURN;
  END IF;

  -- 2. Validate share count
  IF p_shares <= 0 THEN
    RETURN QUERY SELECT false, 'Share count must be positive', 0::BIGINT, 0;
    RETURN;
  END IF;

  -- 3. Get user cash balance
  SELECT COALESCE(available_cents, 0), COALESCE(balance_cents, 0)
  INTO v_available_cents, v_cash_cents
  FROM user_cash_balances
  WHERE user_id = p_user_id;

  IF v_available_cents IS NULL THEN
    v_available_cents := 0;
    v_cash_cents := 0;
  END IF;

  -- 4. Get user's current share position
  SELECT COALESCE(shares_owned, 0)
  INTO v_shares_held
  FROM share_holdings
  WHERE holder_id = p_user_id AND offering_id = p_offering_id;

  IF v_shares_held IS NULL THEN v_shares_held := 0; END IF;

  -- 5. Side-specific checks
  IF p_side = 'buy' THEN
    -- Cost includes 2% commission
    v_order_cost_cents := CEIL(p_shares::NUMERIC * p_price_cents * (1 + v_commission_pct / 100));

    IF v_available_cents < v_order_cost_cents THEN
      RETURN QUERY SELECT
        false,
        'Insufficient cash: need ' || (v_order_cost_cents / 100)::text || ' USD, have ' || (v_available_cents / 100)::text || ' USD',
        v_available_cents,
        v_shares_held;
      RETURN;
    END IF;

  ELSIF p_side = 'sell' THEN
    IF v_shares_held < p_shares THEN
      RETURN QUERY SELECT
        false,
        'Insufficient shares: trying to sell ' || p_shares::text || ', holding ' || v_shares_held::text,
        v_available_cents,
        v_shares_held;
      RETURN;
    END IF;

  ELSE
    RETURN QUERY SELECT false, 'Invalid side: must be buy or sell', v_available_cents, v_shares_held;
    RETURN;
  END IF;

  -- All checks passed
  RETURN QUERY SELECT true, 'OK', v_available_cents, v_shares_held;
END;
$$;

-- =============================================================================
-- 2. update_vehicle_offering_prices()
--    Sets current_share_price = nuke_estimate / total_shares for each offering
--    Falls back to sale_price if nuke_estimate is null.
--    Only moves price if delta > 0.5% (avoids micro-noise updates).
-- =============================================================================
CREATE OR REPLACE FUNCTION update_vehicle_offering_prices()
RETURNS TABLE (
  offering_id       UUID,
  vehicle_id        UUID,
  old_price         NUMERIC,
  new_price         NUMERIC,
  change_pct        NUMERIC,
  source            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH computed AS (
    SELECT
      vo.id                                              AS offering_id,
      vo.vehicle_id,
      vo.current_share_price                             AS old_price,
      vo.total_shares,
      -- Prefer nuke_estimate, fall back to sale_price
      CASE
        WHEN v.nuke_estimate IS NOT NULL AND v.nuke_estimate > 0
          THEN ROUND((v.nuke_estimate / NULLIF(vo.total_shares, 0))::NUMERIC, 4)
        WHEN v.sale_price IS NOT NULL AND v.sale_price > 0
          THEN ROUND((v.sale_price::NUMERIC / NULLIF(vo.total_shares, 0))::NUMERIC, 4)
        ELSE vo.current_share_price
      END                                                AS computed_price,
      CASE
        WHEN v.nuke_estimate IS NOT NULL AND v.nuke_estimate > 0 THEN 'nuke_estimate'
        WHEN v.sale_price    IS NOT NULL AND v.sale_price > 0    THEN 'sale_price'
        ELSE 'unchanged'
      END                                                AS price_source
    FROM vehicle_offerings vo
    JOIN vehicles v ON v.id = vo.vehicle_id
    WHERE vo.status = 'trading'
  ),
  updated AS (
    UPDATE vehicle_offerings vo
    SET
      current_share_price = c.computed_price,
      updated_at          = NOW()
    FROM computed c
    WHERE vo.id = c.offering_id
      AND c.computed_price IS NOT NULL
      AND c.computed_price > 0
      -- Only update if change is meaningful (>0.5%)
      AND ABS(c.computed_price - c.old_price) / NULLIF(c.old_price, 0) > 0.005
    RETURNING vo.id, c.old_price, vo.current_share_price, c.price_source, vo.vehicle_id
  )
  SELECT
    u.id,
    u.vehicle_id,
    u.old_price,
    u.current_share_price,
    ROUND(((u.current_share_price - u.old_price) / NULLIF(u.old_price, 0)) * 100, 2),
    u.price_source
  FROM updated u;
END;
$$;

-- =============================================================================
-- 3. update_market_nav()
--    Recomputes market_funds.nav_share_price from market_segment_stats RPC.
--    NAV moves proportionally to the segment's underlying vehicle price changes.
--    Uses 7d change as proxy for recent performance.
-- =============================================================================
CREATE OR REPLACE FUNCTION update_market_nav()
RETURNS TABLE (
  fund_symbol   TEXT,
  old_nav       NUMERIC,
  new_nav       NUMERIC,
  change_pct    NUMERIC,
  vehicle_count BIGINT,
  market_cap    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fund     RECORD;
  v_stats    RECORD;
  v_new_nav  NUMERIC;
  v_daily_chg NUMERIC;
BEGIN
  FOR v_fund IN
    SELECT id, symbol, nav_share_price, segment_id
    FROM market_funds
    WHERE status = 'active'
  LOOP
    -- Get segment stats via existing RPC
    SELECT * INTO v_stats
    FROM market_segment_stats(v_fund.segment_id)
    LIMIT 1;

    IF v_stats IS NULL THEN
      CONTINUE;
    END IF;

    -- Derive daily change from 7d change (approximate)
    v_daily_chg := COALESCE(v_stats.change_7d_pct, 0) / 7.0;

    -- Apply to current NAV (compound)
    v_new_nav := ROUND(v_fund.nav_share_price * (1 + v_daily_chg / 100.0), 4);

    -- Floor at $0.01
    IF v_new_nav < 0.01 THEN v_new_nav := 0.01; END IF;

    -- Update fund
    UPDATE market_funds
    SET
      nav_share_price = v_new_nav,
      total_aum_usd   = v_new_nav * total_shares_outstanding,
      updated_at      = NOW()
    WHERE id = v_fund.id;

    RETURN QUERY SELECT
      v_fund.symbol,
      v_fund.nav_share_price,
      v_new_nav,
      ROUND(((v_new_nav - v_fund.nav_share_price) / NULLIF(v_fund.nav_share_price, 0)) * 100, 4),
      v_stats.vehicle_count::BIGINT,
      v_stats.market_cap_usd;
  END LOOP;
END;
$$;

-- =============================================================================
-- 4. mark_to_market()
--    Updates current_mark and unrealized P&L on all share_holdings
--    and market_fund_holdings based on current prices.
-- =============================================================================
CREATE OR REPLACE FUNCTION mark_to_market()
RETURNS TABLE (
  holding_type  TEXT,
  holding_id    UUID,
  old_mark      NUMERIC,
  new_mark      NUMERIC,
  unrealized    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 4a. Vehicle fractional holdings (share_holdings → vehicle_offerings)
  RETURN QUERY
  WITH updated AS (
    UPDATE share_holdings sh
    SET
      current_mark          = vo.current_share_price,
      unrealized_gain_loss  = ROUND((vo.current_share_price - sh.entry_price) * sh.shares_owned, 2),
      unrealized_gain_loss_pct = ROUND(
        ((vo.current_share_price - sh.entry_price) / NULLIF(sh.entry_price, 0)) * 100, 2
      ),
      updated_at = NOW()
    FROM vehicle_offerings vo
    WHERE sh.offering_id = vo.id
      AND vo.status = 'trading'
      AND vo.current_share_price IS DISTINCT FROM sh.current_mark
    RETURNING sh.id, sh.current_mark AS old_mark, vo.current_share_price AS new_mark,
              ROUND((vo.current_share_price - sh.entry_price) * sh.shares_owned, 2) AS unrealized_pnl
  )
  SELECT 'vehicle_holding'::TEXT, id, old_mark, new_mark, unrealized_pnl
  FROM updated;

  -- 4b. Fund holdings (market_fund_holdings → market_funds)
  RETURN QUERY
  WITH updated AS (
    UPDATE market_fund_holdings mfh
    SET
      current_nav               = mf.nav_share_price,
      unrealized_gain_loss_usd  = ROUND((mf.nav_share_price - mfh.entry_nav) * mfh.shares_owned, 2),
      unrealized_gain_loss_pct  = ROUND(
        ((mf.nav_share_price - mfh.entry_nav) / NULLIF(mfh.entry_nav, 0)) * 100, 2
      ),
      updated_at = NOW()
    FROM market_funds mf
    WHERE mfh.fund_id = mf.id
      AND mf.status = 'active'
      AND mf.nav_share_price IS DISTINCT FROM mfh.current_nav
    RETURNING mfh.id, mfh.current_nav AS old_nav, mf.nav_share_price AS new_nav,
              ROUND((mf.nav_share_price - mfh.entry_nav) * mfh.shares_owned, 2) AS unrealized_pnl
  )
  SELECT 'fund_holding'::TEXT, id, old_nav, new_nav, unrealized_pnl
  FROM updated;
END;
$$;

-- =============================================================================
-- 5. Convenience: run all pricing updates in sequence
-- =============================================================================
CREATE OR REPLACE FUNCTION run_exchange_pricing_cycle()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_offering_updates  INTEGER := 0;
  v_nav_updates       INTEGER := 0;
  v_mark_updates      INTEGER := 0;
  v_result            JSONB;
BEGIN
  -- Step 1: Update vehicle offering prices from nuke_estimate
  SELECT COUNT(*) INTO v_offering_updates FROM update_vehicle_offering_prices();

  -- Step 2: Update fund NAVs from segment stats
  SELECT COUNT(*) INTO v_nav_updates FROM update_market_nav();

  -- Step 3: Mark all holdings to market
  SELECT COUNT(*) INTO v_mark_updates FROM mark_to_market();

  v_result := jsonb_build_object(
    'ran_at',              NOW(),
    'offering_prices_updated', v_offering_updates,
    'fund_navs_updated',   v_nav_updates,
    'holdings_marked',     v_mark_updates
  );

  RETURN v_result;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION pre_trade_risk_check(UUID, UUID, INTEGER, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION update_vehicle_offering_prices() TO service_role;
GRANT EXECUTE ON FUNCTION update_market_nav() TO service_role;
GRANT EXECUTE ON FUNCTION mark_to_market() TO service_role;
GRANT EXECUTE ON FUNCTION run_exchange_pricing_cycle() TO service_role;
