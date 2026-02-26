-- =============================================================================
-- Order Book Matching Engine + market_fund_buy Cash Integration
-- 2026-02-26
--
-- Implements:
--   1. deduct_reserved_cash()  — post-fill cash settlement (buyer)
--   2. credit_cash()           — post-fill cash settlement (seller)
--   3. release_reserved_cash() — release over-reserved on full/partial fill
--   4. market_fund_buy()       — rewritten with atomic cash deduction
--   5. match_order_book()      — price-time priority matching engine
--   6. cancel_market_order()   — cancel + release reserved cash
-- =============================================================================


-- ─── 1. deduct_reserved_cash ─────────────────────────────────────────────────
-- Called after each fill for the buyer.
-- Removes from reserved_cents + balance_cents (reserved was set aside from
-- available_cents when the order was placed; now we actually spend it).
CREATE OR REPLACE FUNCTION deduct_reserved_cash(
  p_user_id     UUID,
  p_amount_cents BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE user_cash_balances
  SET
    balance_cents  = balance_cents  - p_amount_cents,
    reserved_cents = reserved_cents - p_amount_cents,
    updated_at     = NOW()
  WHERE user_id = p_user_id
    AND reserved_cents >= p_amount_cents;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'deduct_reserved_cash: insufficient reserved for user % (amount %)',
      p_user_id, p_amount_cents;
  END IF;
END;
$$;


-- ─── 2. credit_cash ──────────────────────────────────────────────────────────
-- Called after each fill for the seller.
-- Adds to balance_cents + available_cents (immediate liquidity).
CREATE OR REPLACE FUNCTION credit_cash(
  p_user_id     UUID,
  p_amount_cents BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_user_id, p_amount_cents, p_amount_cents, 0)
  ON CONFLICT (user_id) DO UPDATE
  SET
    balance_cents   = user_cash_balances.balance_cents   + p_amount_cents,
    available_cents = user_cash_balances.available_cents + p_amount_cents,
    updated_at      = NOW();
END;
$$;


-- ─── 3. release_reserved_cash ────────────────────────────────────────────────
-- Called when a buy order fills at a price better than the limit,
-- or when an order is cancelled (unfilled portion).
-- Moves reserved_cents back to available_cents.
CREATE OR REPLACE FUNCTION release_reserved_cash(
  p_user_id     UUID,
  p_amount_cents BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_amount_cents <= 0 THEN RETURN; END IF;

  UPDATE user_cash_balances
  SET
    available_cents = available_cents + p_amount_cents,
    reserved_cents  = reserved_cents  - p_amount_cents,
    updated_at      = NOW()
  WHERE user_id = p_user_id
    AND reserved_cents >= p_amount_cents;

  IF NOT FOUND THEN
    RAISE WARNING 'release_reserved_cash: user % reserved underflow (amount %)',
      p_user_id, p_amount_cents;
  END IF;
END;
$$;


-- ─── 4. market_fund_buy (rewrite with cash deduction) ────────────────────────
-- ETF buys are immediate (no order book). Cash deducted atomically before
-- share issuance. On NAV lookup failure, cash is refunded.
DROP FUNCTION IF EXISTS market_fund_buy(UUID, BIGINT);
CREATE FUNCTION market_fund_buy(
  p_fund_id     UUID,
  p_amount_cents BIGINT
)
RETURNS TABLE (
  fund_id         UUID,
  user_id         UUID,
  amount_cents    BIGINT,
  nav_share_price NUMERIC,
  shares_issued   NUMERIC,
  shares_owned    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id     UUID;
  v_nav         NUMERIC(12,4);
  v_amount_usd  NUMERIC(15,2);
  v_shares      NUMERIC(20,6);
  v_prev_shares NUMERIC(20,6) := 0;
  v_prev_entry  NUMERIC(12,4) := 0;
  v_new_entry   NUMERIC(12,4);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Deduct cash atomically (check available, deduct in one UPDATE)
  UPDATE user_cash_balances
  SET
    balance_cents   = balance_cents   - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at      = NOW()
  WHERE user_id       = v_user_id
    AND available_cents >= p_amount_cents;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient cash. Check your available balance.';
  END IF;

  -- Lookup fund NAV
  SELECT nav_share_price INTO v_nav
  FROM market_funds
  WHERE id = p_fund_id AND status = 'active';

  IF v_nav IS NULL OR v_nav <= 0 THEN
    -- Refund
    UPDATE user_cash_balances
    SET
      balance_cents   = balance_cents   + p_amount_cents,
      available_cents = available_cents + p_amount_cents,
      updated_at      = NOW()
    WHERE user_id = v_user_id;
    RAISE EXCEPTION 'Fund not active or NAV invalid';
  END IF;

  v_amount_usd := (p_amount_cents::NUMERIC / 100.0)::NUMERIC(15,2);
  v_shares     := ROUND((v_amount_usd / v_nav)::NUMERIC, 6);

  IF v_shares <= 0 THEN
    UPDATE user_cash_balances
    SET
      balance_cents   = balance_cents   + p_amount_cents,
      available_cents = available_cents + p_amount_cents,
      updated_at      = NOW()
    WHERE user_id = v_user_id;
    RAISE EXCEPTION 'Amount too small to issue shares';
  END IF;

  -- Get existing holding for weighted-avg entry NAV
  SELECT COALESCE(shares_owned, 0), COALESCE(entry_nav, 0)
    INTO v_prev_shares, v_prev_entry
  FROM market_fund_holdings
  WHERE fund_id = p_fund_id AND user_id = v_user_id;

  IF v_prev_shares IS NULL THEN
    v_prev_shares := 0;
    v_prev_entry  := 0;
  END IF;

  v_new_entry := CASE
    WHEN v_prev_shares = 0 THEN v_nav
    ELSE ROUND(
      ((v_prev_shares * v_prev_entry) + (v_shares * v_nav)) /
      (v_prev_shares + v_shares),
      4
    )
  END;

  -- Upsert holding
  INSERT INTO market_fund_holdings (
    fund_id, user_id, shares_owned, entry_nav, current_nav,
    unrealized_gain_loss_usd, unrealized_gain_loss_pct,
    created_at, updated_at
  )
  VALUES (
    p_fund_id, v_user_id,
    v_prev_shares + v_shares, v_new_entry, v_nav,
    0, 0, NOW(), NOW()
  )
  ON CONFLICT (fund_id, user_id) DO UPDATE SET
    shares_owned = EXCLUDED.shares_owned,
    entry_nav    = EXCLUDED.entry_nav,
    current_nav  = EXCLUDED.current_nav,
    updated_at   = NOW();

  -- Update fund AUM + shares outstanding
  UPDATE market_funds
  SET
    total_shares_outstanding = total_shares_outstanding + v_shares,
    total_aum_usd            = total_aum_usd + v_amount_usd,
    updated_at               = NOW()
  WHERE id = p_fund_id;

  RETURN QUERY SELECT
    p_fund_id, v_user_id, p_amount_cents, v_nav, v_shares,
    (SELECT shares_owned::NUMERIC FROM market_fund_holdings
     WHERE fund_id = p_fund_id AND user_id = v_user_id);
END;
$$;


-- ─── 5. match_order_book ─────────────────────────────────────────────────────
-- Price-time priority order matching engine.
-- Call this after any new order is placed.
--
-- Algorithm:
--   - Aggressor order fills against resting orders on opposite side
--   - BUY aggressor: best ask (lowest price) first, then oldest
--   - SELL aggressor: best bid (highest price) first, then oldest
--   - Fill price = resting order's price (maker price)
--   - Commission: 2% on trade value, deducted from seller's proceeds
--   - Cash: buyer reserved at order placement; deducted post-fill
--   - Seller: credited net proceeds immediately
--   - Over-reserved cash released on full fill
--
CREATE OR REPLACE FUNCTION match_order_book(
  p_order_id UUID
)
RETURNS TABLE (
  trades_executed INT,
  shares_filled   INT,
  avg_fill_price  NUMERIC,
  final_status    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- Order records
  v_order         RECORD;
  v_resting       RECORD;
  -- Fill tracking
  v_remaining       INT;
  v_fill_qty        INT;
  v_fill_price      NUMERIC;
  v_fill_value_usd  NUMERIC;
  v_commission_pct  NUMERIC := 0.02;
  v_commission_amt  NUMERIC;
  v_net_seller      NUMERIC;
  -- Aggregates
  v_total_trades         INT     := 0;
  v_total_shares         INT     := 0;
  v_total_value          NUMERIC := 0;
  v_aggressor_new_shares INT     := 0;
  v_aggressor_new_value  NUMERIC := 0;
  -- Share holdings
  v_seller_holding  RECORD;
  v_buyer_holding   RECORD;
  v_new_entry_price NUMERIC;
  -- Party IDs
  v_buyer_id  UUID;
  v_seller_id UUID;
  -- Cash release
  v_reserved_cents      BIGINT;
  v_actual_spent_cents  BIGINT;
  v_over_reserved_cents BIGINT;
  -- Final result
  v_final_status TEXT;
BEGIN
  -- Lock and read aggressor order
  SELECT * INTO v_order
  FROM market_orders
  WHERE id = p_order_id
    AND status IN ('active', 'partially_filled')
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0::NUMERIC, 'not_found';
    RETURN;
  END IF;

  v_remaining := v_order.shares_requested - v_order.shares_filled;
  IF v_remaining <= 0 THEN
    RETURN QUERY SELECT 0, 0, 0::NUMERIC, v_order.status;
    RETURN;
  END IF;

  -- Find resting orders on the opposite side, price-time priority.
  -- Price trick: negate price for SELL aggressors so ASC gives highest-bid-first.
  FOR v_resting IN
    SELECT *
    FROM market_orders
    WHERE offering_id = v_order.offering_id
      AND order_type  = CASE WHEN v_order.order_type = 'buy' THEN 'sell' ELSE 'buy' END
      AND status IN ('active', 'partially_filled')
      AND id      != p_order_id
      AND user_id != v_order.user_id
      AND (
        (v_order.order_type = 'buy'  AND price_per_share <= v_order.price_per_share) OR
        (v_order.order_type = 'sell' AND price_per_share >= v_order.price_per_share)
      )
    ORDER BY
      CASE WHEN v_order.order_type = 'buy'  THEN  price_per_share
           ELSE                                   -price_per_share
      END ASC,
      created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Safety: re-check resting order is still fillable
    CONTINUE WHEN v_resting.shares_requested - v_resting.shares_filled <= 0;

    -- Resolve parties for this fill
    v_buyer_id  := CASE WHEN v_order.order_type = 'buy' THEN v_order.user_id ELSE v_resting.user_id END;
    v_seller_id := CASE WHEN v_order.order_type = 'sell' THEN v_order.user_id ELSE v_resting.user_id END;

    -- Verify seller has shares (lock row to prevent concurrent double-fill)
    SELECT * INTO v_seller_holding
    FROM share_holdings
    WHERE offering_id = v_order.offering_id
      AND holder_id   = v_seller_id
    FOR UPDATE;

    IF v_seller_holding IS NULL OR v_seller_holding.shares_owned < 1 THEN
      IF v_seller_id = v_order.user_id THEN
        -- Aggressor seller has no shares — stop
        EXIT;
      ELSE
        -- Resting seller has no shares — cancel bogus order, continue
        UPDATE market_orders
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = v_resting.id;
        CONTINUE;
      END IF;
    END IF;

    -- Fill quantity: min of (aggressor remaining, resting remaining, seller's actual shares)
    v_fill_qty := LEAST(
      v_remaining,
      v_resting.shares_requested - v_resting.shares_filled,
      v_seller_holding.shares_owned
    );

    IF v_fill_qty <= 0 THEN CONTINUE; END IF;

    v_fill_price     := v_resting.price_per_share;
    v_fill_value_usd := v_fill_qty * v_fill_price;
    v_commission_amt := ROUND(v_fill_value_usd * v_commission_pct, 2);
    v_net_seller     := v_fill_value_usd - v_commission_amt;

    -- ── Record trade ──────────────────────────────────────────────────────────
    INSERT INTO market_trades (
      offering_id, buyer_id, seller_id,
      shares_traded, price_per_share, total_value,
      buy_order_id, sell_order_id,
      nuke_commission_pct, nuke_commission_amount,
      trade_type, executed_at
    ) VALUES (
      v_order.offering_id,
      v_buyer_id, v_seller_id,
      v_fill_qty, v_fill_price, v_fill_value_usd,
      CASE WHEN v_order.order_type = 'buy' THEN p_order_id ELSE v_resting.id END,
      CASE WHEN v_order.order_type = 'sell' THEN p_order_id ELSE v_resting.id END,
      v_commission_pct, v_commission_amt,
      'exchange', NOW()
    );

    -- ── Share settlement: buyer ───────────────────────────────────────────────
    SELECT * INTO v_buyer_holding
    FROM share_holdings
    WHERE offering_id = v_order.offering_id
      AND holder_id   = v_buyer_id;

    v_new_entry_price := CASE
      WHEN v_buyer_holding IS NULL THEN v_fill_price
      ELSE ROUND(
        ((v_buyer_holding.shares_owned * v_buyer_holding.entry_price) +
         (v_fill_qty * v_fill_price)) /
        (v_buyer_holding.shares_owned + v_fill_qty),
        4
      )
    END;

    INSERT INTO share_holdings (
      offering_id, holder_id, shares_owned, entry_price, entry_date,
      current_mark, unrealized_gain_loss, unrealized_gain_loss_pct,
      total_bought, total_sold, created_at, updated_at
    ) VALUES (
      v_order.offering_id, v_buyer_id,
      v_fill_qty, v_fill_price, NOW(),
      v_fill_price, 0, 0,
      v_fill_qty, 0, NOW(), NOW()
    )
    ON CONFLICT (offering_id, holder_id) DO UPDATE SET
      shares_owned  = share_holdings.shares_owned + v_fill_qty,
      entry_price   = v_new_entry_price,
      total_bought  = share_holdings.total_bought + v_fill_qty,
      updated_at    = NOW();

    -- ── Share settlement: seller ──────────────────────────────────────────────
    UPDATE share_holdings
    SET
      shares_owned = shares_owned - v_fill_qty,
      total_sold   = total_sold   + v_fill_qty,
      updated_at   = NOW()
    WHERE offering_id = v_order.offering_id
      AND holder_id   = v_seller_id;

    -- ── Cash settlement ───────────────────────────────────────────────────────
    PERFORM deduct_reserved_cash(v_buyer_id,  ROUND(v_fill_value_usd * 100)::BIGINT);
    PERFORM credit_cash(v_seller_id, ROUND(v_net_seller * 100)::BIGINT);

    -- ── Update resting order ──────────────────────────────────────────────────
    UPDATE market_orders
    SET
      shares_filled      = shares_filled + v_fill_qty,
      average_fill_price = CASE
        WHEN shares_filled = 0 OR average_fill_price IS NULL THEN v_fill_price
        ELSE ROUND(
          ((shares_filled * average_fill_price) + (v_fill_qty * v_fill_price)) /
          (shares_filled + v_fill_qty),
          4
        )
      END,
      first_fill_time = COALESCE(first_fill_time, NOW()),
      last_fill_time  = NOW(),
      status = CASE
        WHEN shares_filled + v_fill_qty >= shares_requested THEN 'filled'
        ELSE 'partially_filled'
      END,
      updated_at = NOW()
    WHERE id = v_resting.id;

    -- ── Track aggressor totals ────────────────────────────────────────────────
    v_aggressor_new_shares := v_aggressor_new_shares + v_fill_qty;
    v_aggressor_new_value  := v_aggressor_new_value  + v_fill_value_usd;
    v_total_trades         := v_total_trades + 1;
    v_total_shares         := v_total_shares + v_fill_qty;
    v_total_value          := v_total_value  + v_fill_value_usd;
    v_remaining            := v_remaining    - v_fill_qty;

  END LOOP;

  -- ── Update aggressor order ────────────────────────────────────────────────
  IF v_aggressor_new_shares > 0 THEN

    UPDATE market_orders
    SET
      shares_filled      = shares_filled + v_aggressor_new_shares,
      average_fill_price = CASE
        WHEN shares_filled = 0 OR average_fill_price IS NULL
          THEN ROUND(v_aggressor_new_value / v_aggressor_new_shares, 4)
        ELSE ROUND(
          ((shares_filled * average_fill_price) + v_aggressor_new_value) /
          (shares_filled + v_aggressor_new_shares),
          4
        )
      END,
      first_fill_time = COALESCE(first_fill_time, NOW()),
      last_fill_time  = NOW(),
      status = CASE
        WHEN shares_filled + v_aggressor_new_shares >= shares_requested THEN 'filled'
        ELSE 'partially_filled'
      END,
      updated_at = NOW()
    WHERE id = p_order_id;

    -- ── Update vehicle_offerings market data ──────────────────────────────────
    UPDATE vehicle_offerings
    SET
      total_trades        = total_trades        + v_total_trades,
      total_volume_shares = total_volume_shares + v_total_shares,
      total_volume_usd    = total_volume_usd    + v_total_value,
      current_share_price = v_fill_price,  -- last executed trade price
      updated_at          = NOW()
    WHERE id = v_order.offering_id;

    -- ── Release over-reserved cash for fully-filled buy orders ────────────────
    -- Buyer reserved at limit price; may have filled at better (lower) prices.
    -- Refund the difference between what was reserved and what was actually spent.
    IF v_order.order_type = 'buy'
       AND v_order.shares_filled + v_aggressor_new_shares >= v_order.shares_requested
    THEN
      -- Total reserved when order was placed = shares_requested * limit_price
      v_reserved_cents := ROUND(
        v_order.shares_requested * v_order.price_per_share * 100
      )::BIGINT;

      -- Actual spent = prior fills + this session's fills
      v_actual_spent_cents :=
        ROUND(COALESCE(v_order.shares_filled, 0) *
              COALESCE(v_order.average_fill_price, v_order.price_per_share) * 100)::BIGINT
        + ROUND(v_aggressor_new_value * 100)::BIGINT;

      v_over_reserved_cents := v_reserved_cents - v_actual_spent_cents;

      IF v_over_reserved_cents > 0 THEN
        PERFORM release_reserved_cash(v_order.user_id, v_over_reserved_cents);
      END IF;
    END IF;

  END IF;

  -- ── Return result ─────────────────────────────────────────────────────────
  SELECT status INTO v_final_status FROM market_orders WHERE id = p_order_id;

  RETURN QUERY SELECT
    v_total_trades,
    v_aggressor_new_shares,
    CASE WHEN v_aggressor_new_shares > 0
         THEN ROUND(v_aggressor_new_value / v_aggressor_new_shares, 4)
         ELSE 0::NUMERIC
    END,
    COALESCE(v_final_status, 'active');
END;
$$;


-- ─── 6. cancel_market_order ──────────────────────────────────────────────────
-- Cancels an open or partially-filled order belonging to the caller.
-- Releases reserved cash for the unfilled portion of buy orders.
CREATE OR REPLACE FUNCTION cancel_market_order(
  p_order_id UUID
)
RETURNS TABLE (
  cancelled      BOOLEAN,
  released_cents BIGINT,
  message        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id       UUID;
  v_order         RECORD;
  v_unfilled      INT;
  v_release_cents BIGINT := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_order
  FROM market_orders
  WHERE id      = p_order_id
    AND user_id = v_user_id
    AND status IN ('active', 'partially_filled')
  FOR UPDATE;

  IF v_order IS NULL THEN
    RETURN QUERY SELECT false, 0::BIGINT, 'Order not found or already closed';
    RETURN;
  END IF;

  v_unfilled := v_order.shares_requested - v_order.shares_filled;

  -- Release reserved cash for unfilled buy orders
  IF v_order.order_type = 'buy' AND v_unfilled > 0 THEN
    v_release_cents := ROUND(v_unfilled * v_order.price_per_share * 100)::BIGINT;
    PERFORM release_reserved_cash(v_user_id, v_release_cents);
  END IF;

  UPDATE market_orders
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_order_id;

  RETURN QUERY SELECT
    true,
    v_release_cents,
    format('Cancelled. %s shares unfilled. $%s released.',
           v_unfilled,
           ROUND(v_release_cents::NUMERIC / 100, 2));
END;
$$;


-- ─── 7. Grants ────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION deduct_reserved_cash(UUID, BIGINT)  TO service_role;
GRANT EXECUTE ON FUNCTION credit_cash(UUID, BIGINT)           TO service_role;
GRANT EXECUTE ON FUNCTION release_reserved_cash(UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION market_fund_buy(UUID, BIGINT)       TO authenticated;
GRANT EXECUTE ON FUNCTION match_order_book(UUID)              TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION cancel_market_order(UUID)           TO authenticated;
