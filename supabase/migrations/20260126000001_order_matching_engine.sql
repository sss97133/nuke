-- =====================================================
-- ORDER MATCHING ENGINE - Price-Time Priority Matching
-- =====================================================
-- Bloomberg-grade order matching with:
-- 1. Price-time priority (FIFO at each price level)
-- 2. Atomic share transfers
-- 3. NBBO (National Best Bid/Offer) caching
-- 4. Full audit trail
-- January 2026

-- =====================================================
-- NEW TABLES
-- =====================================================

-- Order Book Events - Audit trail for all order activity
CREATE TABLE IF NOT EXISTS order_book_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  order_id UUID REFERENCES market_orders(id) ON DELETE SET NULL,
  trade_id UUID REFERENCES market_trades(id) ON DELETE SET NULL,

  -- Event Type
  event_type TEXT NOT NULL CHECK (event_type IN (
    'order_placed', 'order_cancelled', 'order_filled', 'order_partially_filled',
    'trade_executed', 'price_updated', 'nbbo_updated'
  )),

  -- Event Data
  side TEXT CHECK (side IN ('buy', 'sell')),
  price DECIMAL(12,4),
  shares INTEGER,
  shares_remaining INTEGER,

  -- Pre/Post State
  pre_best_bid DECIMAL(12,4),
  pre_best_ask DECIMAL(12,4),
  post_best_bid DECIMAL(12,4),
  post_best_ask DECIMAL(12,4),

  -- User Info
  user_id UUID REFERENCES auth.users(id),
  counterparty_id UUID REFERENCES auth.users(id),

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_book_events_offering ON order_book_events(offering_id);
CREATE INDEX idx_order_book_events_order ON order_book_events(order_id);
CREATE INDEX idx_order_book_events_trade ON order_book_events(trade_id);
CREATE INDEX idx_order_book_events_type ON order_book_events(event_type);
CREATE INDEX idx_order_book_events_created ON order_book_events(created_at DESC);

-- NBBO Cache - Real-time best bid/offer per offering
CREATE TABLE IF NOT EXISTS nbbo_cache (
  offering_id UUID PRIMARY KEY REFERENCES vehicle_offerings(id) ON DELETE CASCADE,

  -- Best Bid (highest buy price)
  best_bid DECIMAL(12,4),
  best_bid_size INTEGER DEFAULT 0,
  best_bid_count INTEGER DEFAULT 0,  -- Number of orders at this level

  -- Best Ask (lowest sell price)
  best_ask DECIMAL(12,4),
  best_ask_size INTEGER DEFAULT 0,
  best_ask_count INTEGER DEFAULT 0,

  -- Spread
  spread DECIMAL(12,4),
  spread_pct DECIMAL(7,4),

  -- Mid Price
  mid_price DECIMAL(12,4),

  -- Total Depth
  total_bid_depth INTEGER DEFAULT 0,  -- Total shares on buy side
  total_ask_depth INTEGER DEFAULT 0,  -- Total shares on sell side

  -- Last Trade
  last_trade_price DECIMAL(12,4),
  last_trade_size INTEGER,
  last_trade_time TIMESTAMPTZ,

  -- Timestamps
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reserved Shares table (for sell order reservations)
CREATE TABLE IF NOT EXISTS reserved_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES market_orders(id) ON DELETE CASCADE,

  shares_reserved INTEGER NOT NULL CHECK (shares_reserved > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'released', 'executed')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  released_at TIMESTAMPTZ,

  UNIQUE(order_id)
);

CREATE INDEX idx_reserved_shares_offering ON reserved_shares(offering_id);
CREATE INDEX idx_reserved_shares_user ON reserved_shares(user_id);
CREATE INDEX idx_reserved_shares_status ON reserved_shares(status);

-- =====================================================
-- CORE MATCHING FUNCTIONS
-- =====================================================

-- Update NBBO Cache for an offering
CREATE OR REPLACE FUNCTION update_nbbo(p_offering_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_best_bid DECIMAL(12,4);
  v_best_bid_size INTEGER;
  v_best_bid_count INTEGER;
  v_best_ask DECIMAL(12,4);
  v_best_ask_size INTEGER;
  v_best_ask_count INTEGER;
  v_total_bid_depth INTEGER;
  v_total_ask_depth INTEGER;
  v_spread DECIMAL(12,4);
  v_spread_pct DECIMAL(7,4);
  v_mid_price DECIMAL(12,4);
  v_last_trade RECORD;
BEGIN
  -- Get best bid (highest buy price)
  SELECT
    price_per_share,
    COALESCE(SUM(shares_requested - shares_filled), 0)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_best_bid, v_best_bid_size, v_best_bid_count
  FROM market_orders
  WHERE offering_id = p_offering_id
    AND order_type = 'buy'
    AND status IN ('active', 'partially_filled')
    AND shares_filled < shares_requested
  GROUP BY price_per_share
  ORDER BY price_per_share DESC
  LIMIT 1;

  -- Get best ask (lowest sell price)
  SELECT
    price_per_share,
    COALESCE(SUM(shares_requested - shares_filled), 0)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_best_ask, v_best_ask_size, v_best_ask_count
  FROM market_orders
  WHERE offering_id = p_offering_id
    AND order_type = 'sell'
    AND status IN ('active', 'partially_filled')
    AND shares_filled < shares_requested
  GROUP BY price_per_share
  ORDER BY price_per_share ASC
  LIMIT 1;

  -- Get total bid depth
  SELECT COALESCE(SUM(shares_requested - shares_filled), 0)::INTEGER
  INTO v_total_bid_depth
  FROM market_orders
  WHERE offering_id = p_offering_id
    AND order_type = 'buy'
    AND status IN ('active', 'partially_filled')
    AND shares_filled < shares_requested;

  -- Get total ask depth
  SELECT COALESCE(SUM(shares_requested - shares_filled), 0)::INTEGER
  INTO v_total_ask_depth
  FROM market_orders
  WHERE offering_id = p_offering_id
    AND order_type = 'sell'
    AND status IN ('active', 'partially_filled')
    AND shares_filled < shares_requested;

  -- Calculate spread
  IF v_best_bid IS NOT NULL AND v_best_ask IS NOT NULL THEN
    v_spread := v_best_ask - v_best_bid;
    v_mid_price := (v_best_bid + v_best_ask) / 2;
    IF v_mid_price > 0 THEN
      v_spread_pct := (v_spread / v_mid_price) * 100;
    END IF;
  ELSE
    v_spread := NULL;
    v_spread_pct := NULL;
    v_mid_price := COALESCE(v_best_bid, v_best_ask);
  END IF;

  -- Get last trade
  SELECT price_per_share, shares_traded, executed_at
  INTO v_last_trade
  FROM market_trades
  WHERE offering_id = p_offering_id
  ORDER BY executed_at DESC
  LIMIT 1;

  -- Upsert NBBO cache
  INSERT INTO nbbo_cache (
    offering_id, best_bid, best_bid_size, best_bid_count,
    best_ask, best_ask_size, best_ask_count,
    spread, spread_pct, mid_price,
    total_bid_depth, total_ask_depth,
    last_trade_price, last_trade_size, last_trade_time,
    updated_at
  ) VALUES (
    p_offering_id, v_best_bid, COALESCE(v_best_bid_size, 0), COALESCE(v_best_bid_count, 0),
    v_best_ask, COALESCE(v_best_ask_size, 0), COALESCE(v_best_ask_count, 0),
    v_spread, v_spread_pct, v_mid_price,
    v_total_bid_depth, v_total_ask_depth,
    v_last_trade.price_per_share, v_last_trade.shares_traded, v_last_trade.executed_at,
    NOW()
  )
  ON CONFLICT (offering_id) DO UPDATE SET
    best_bid = EXCLUDED.best_bid,
    best_bid_size = EXCLUDED.best_bid_size,
    best_bid_count = EXCLUDED.best_bid_count,
    best_ask = EXCLUDED.best_ask,
    best_ask_size = EXCLUDED.best_ask_size,
    best_ask_count = EXCLUDED.best_ask_count,
    spread = EXCLUDED.spread,
    spread_pct = EXCLUDED.spread_pct,
    mid_price = EXCLUDED.mid_price,
    total_bid_depth = EXCLUDED.total_bid_depth,
    total_ask_depth = EXCLUDED.total_ask_depth,
    last_trade_price = EXCLUDED.last_trade_price,
    last_trade_size = EXCLUDED.last_trade_size,
    last_trade_time = EXCLUDED.last_trade_time,
    updated_at = NOW();
END;
$$;

-- Execute atomic share transfer between users
CREATE OR REPLACE FUNCTION execute_share_transfer(
  p_offering_id UUID,
  p_seller_id UUID,
  p_buyer_id UUID,
  p_shares INTEGER,
  p_price_per_share DECIMAL(12,4),
  p_buy_order_id UUID,
  p_sell_order_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade_id UUID;
  v_total_value DECIMAL(15,2);
  v_commission DECIMAL(15,2);
  v_seller_holding_id UUID;
  v_buyer_holding_id UUID;
BEGIN
  -- Calculate values
  v_total_value := p_shares * p_price_per_share;
  v_commission := v_total_value * 0.02;  -- 2% commission

  -- Deduct shares from seller
  UPDATE share_holdings
  SET
    shares_owned = shares_owned - p_shares,
    total_sold = COALESCE(total_sold, 0) + p_shares,
    updated_at = NOW()
  WHERE offering_id = p_offering_id AND holder_id = p_seller_id
  RETURNING id INTO v_seller_holding_id;

  -- If seller now has 0 shares, we could delete the row or leave it
  DELETE FROM share_holdings
  WHERE offering_id = p_offering_id AND holder_id = p_seller_id AND shares_owned <= 0;

  -- Add shares to buyer (upsert)
  INSERT INTO share_holdings (
    offering_id, holder_id, shares_owned, entry_price, current_mark,
    total_bought, created_at, updated_at
  ) VALUES (
    p_offering_id, p_buyer_id, p_shares, p_price_per_share, p_price_per_share,
    p_shares, NOW(), NOW()
  )
  ON CONFLICT (offering_id, holder_id) DO UPDATE SET
    shares_owned = share_holdings.shares_owned + p_shares,
    entry_price = (
      (share_holdings.entry_price * share_holdings.shares_owned) +
      (p_price_per_share * p_shares)
    ) / (share_holdings.shares_owned + p_shares),
    total_bought = COALESCE(share_holdings.total_bought, 0) + p_shares,
    updated_at = NOW()
  RETURNING id INTO v_buyer_holding_id;

  -- Execute cash transfer
  -- Deduct from buyer (including commission)
  PERFORM execute_trade(
    p_buyer_id,
    -ROUND((v_total_value + v_commission) * 100)::INTEGER  -- Negative = deduct
  );

  -- Credit to seller (minus commission)
  PERFORM execute_trade(
    p_seller_id,
    ROUND((v_total_value - v_commission) * 100)::INTEGER  -- Positive = credit
  );

  -- Create trade record
  INSERT INTO market_trades (
    offering_id, buyer_id, seller_id,
    shares_traded, price_per_share, total_value,
    buy_order_id, sell_order_id,
    trade_type, nuke_commission_pct, nuke_commission_amount,
    executed_at
  ) VALUES (
    p_offering_id, p_buyer_id, p_seller_id,
    p_shares, p_price_per_share, v_total_value,
    p_buy_order_id, p_sell_order_id,
    'limit', 2.0, v_commission,
    NOW()
  )
  RETURNING id INTO v_trade_id;

  -- Update offering statistics
  UPDATE vehicle_offerings
  SET
    current_share_price = p_price_per_share,
    total_trades = COALESCE(total_trades, 0) + 1,
    total_volume_shares = COALESCE(total_volume_shares, 0) + p_shares,
    total_volume_usd = COALESCE(total_volume_usd, 0) + v_total_value,
    updated_at = NOW()
  WHERE id = p_offering_id;

  RETURN v_trade_id;
END;
$$;

-- Main order matching function with price-time priority
CREATE OR REPLACE FUNCTION match_order_book(p_order_id UUID)
RETURNS TABLE (
  trade_id UUID,
  shares_traded INTEGER,
  price_per_share DECIMAL(12,4),
  counterparty_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_opposite_order RECORD;
  v_shares_remaining INTEGER;
  v_shares_to_trade INTEGER;
  v_trade_id UUID;
  v_pre_nbbo RECORD;
BEGIN
  -- Get the order details
  SELECT * INTO v_order
  FROM market_orders
  WHERE id = p_order_id
    AND status IN ('active', 'partially_filled');

  IF v_order IS NULL THEN
    RETURN;  -- Order not found or not active
  END IF;

  -- Get pre-match NBBO
  SELECT best_bid, best_ask INTO v_pre_nbbo
  FROM nbbo_cache WHERE offering_id = v_order.offering_id;

  v_shares_remaining := v_order.shares_requested - v_order.shares_filled;

  -- Log order placed event
  INSERT INTO order_book_events (
    offering_id, order_id, event_type, side, price, shares, shares_remaining,
    user_id, pre_best_bid, pre_best_ask
  ) VALUES (
    v_order.offering_id, p_order_id, 'order_placed',
    v_order.order_type, v_order.price_per_share, v_order.shares_requested,
    v_shares_remaining, v_order.user_id, v_pre_nbbo.best_bid, v_pre_nbbo.best_ask
  );

  -- Find matching orders on the opposite side
  -- Price-time priority: best price first, then oldest first
  FOR v_opposite_order IN
    SELECT *
    FROM market_orders
    WHERE offering_id = v_order.offering_id
      AND order_type = CASE WHEN v_order.order_type = 'buy' THEN 'sell' ELSE 'buy' END
      AND status IN ('active', 'partially_filled')
      AND shares_filled < shares_requested
      AND user_id != v_order.user_id  -- Can't trade with yourself
      AND (
        (v_order.order_type = 'buy' AND price_per_share <= v_order.price_per_share) OR
        (v_order.order_type = 'sell' AND price_per_share >= v_order.price_per_share)
      )
    ORDER BY
      CASE WHEN v_order.order_type = 'buy' THEN price_per_share END ASC,
      CASE WHEN v_order.order_type = 'sell' THEN price_per_share END DESC,
      created_at ASC  -- Time priority at same price level
  LOOP
    EXIT WHEN v_shares_remaining <= 0;

    -- Calculate shares to trade
    v_shares_to_trade := LEAST(
      v_shares_remaining,
      v_opposite_order.shares_requested - v_opposite_order.shares_filled
    );

    -- Execute the share transfer
    v_trade_id := execute_share_transfer(
      v_order.offering_id,
      CASE WHEN v_order.order_type = 'buy' THEN v_opposite_order.user_id ELSE v_order.user_id END,
      CASE WHEN v_order.order_type = 'buy' THEN v_order.user_id ELSE v_opposite_order.user_id END,
      v_shares_to_trade,
      v_opposite_order.price_per_share,  -- Trade at the resting order's price
      CASE WHEN v_order.order_type = 'buy' THEN p_order_id ELSE v_opposite_order.id END,
      CASE WHEN v_order.order_type = 'sell' THEN p_order_id ELSE v_opposite_order.id END
    );

    -- Update the opposite order
    UPDATE market_orders
    SET
      shares_filled = shares_filled + v_shares_to_trade,
      status = CASE
        WHEN shares_filled + v_shares_to_trade >= shares_requested THEN 'filled'
        ELSE 'partially_filled'
      END,
      last_fill_time = NOW(),
      average_fill_price = COALESCE(
        (average_fill_price * shares_filled + v_opposite_order.price_per_share * v_shares_to_trade) /
        (shares_filled + v_shares_to_trade),
        v_opposite_order.price_per_share
      ),
      updated_at = NOW()
    WHERE id = v_opposite_order.id;

    -- Log trade event
    INSERT INTO order_book_events (
      offering_id, order_id, trade_id, event_type, side, price, shares,
      user_id, counterparty_id
    ) VALUES (
      v_order.offering_id, p_order_id, v_trade_id, 'trade_executed',
      v_order.order_type, v_opposite_order.price_per_share, v_shares_to_trade,
      v_order.user_id, v_opposite_order.user_id
    );

    -- Update tracking
    v_shares_remaining := v_shares_remaining - v_shares_to_trade;

    -- Return this trade
    trade_id := v_trade_id;
    shares_traded := v_shares_to_trade;
    price_per_share := v_opposite_order.price_per_share;
    counterparty_id := v_opposite_order.user_id;
    RETURN NEXT;
  END LOOP;

  -- Update the incoming order
  UPDATE market_orders
  SET
    shares_filled = v_order.shares_requested - v_shares_remaining,
    status = CASE
      WHEN v_shares_remaining = 0 THEN 'filled'
      WHEN v_shares_remaining < v_order.shares_requested THEN 'partially_filled'
      ELSE 'active'
    END,
    last_fill_time = CASE WHEN v_shares_remaining < v_order.shares_requested THEN NOW() ELSE last_fill_time END,
    average_fill_price = (
      SELECT AVG(price_per_share)
      FROM market_trades
      WHERE (buy_order_id = p_order_id OR sell_order_id = p_order_id)
    ),
    updated_at = NOW()
  WHERE id = p_order_id;

  -- Handle FOK (Fill or Kill) - cancel if not fully filled
  IF v_order.time_in_force = 'fok' AND v_shares_remaining > 0 THEN
    UPDATE market_orders SET status = 'cancelled', updated_at = NOW()
    WHERE id = p_order_id;

    -- TODO: Reverse any partial fills (complex - might need to handle separately)
  END IF;

  -- Handle IOC (Immediate or Cancel) - cancel remaining
  IF v_order.time_in_force = 'ioc' AND v_shares_remaining > 0 THEN
    UPDATE market_orders SET status = 'cancelled', updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  -- Update NBBO cache
  PERFORM update_nbbo(v_order.offering_id);

  -- Log final order status
  INSERT INTO order_book_events (
    offering_id, order_id, event_type, side, shares_remaining, user_id,
    post_best_bid, post_best_ask
  )
  SELECT
    v_order.offering_id, p_order_id,
    CASE
      WHEN v_shares_remaining = 0 THEN 'order_filled'
      WHEN v_shares_remaining < v_order.shares_requested THEN 'order_partially_filled'
      ELSE 'order_placed'
    END,
    v_order.order_type, v_shares_remaining, v_order.user_id,
    best_bid, best_ask
  FROM nbbo_cache WHERE offering_id = v_order.offering_id;
END;
$$;

-- Reserve shares for sell orders
CREATE OR REPLACE FUNCTION reserve_shares(
  p_user_id UUID,
  p_offering_id UUID,
  p_order_id UUID,
  p_shares INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_available_shares INTEGER;
  v_reserved_shares INTEGER;
BEGIN
  -- Get current holding
  SELECT shares_owned INTO v_available_shares
  FROM share_holdings
  WHERE holder_id = p_user_id AND offering_id = p_offering_id;

  IF v_available_shares IS NULL OR v_available_shares < p_shares THEN
    RETURN FALSE;
  END IF;

  -- Get already reserved shares
  SELECT COALESCE(SUM(shares_reserved), 0) INTO v_reserved_shares
  FROM reserved_shares
  WHERE user_id = p_user_id AND offering_id = p_offering_id AND status = 'reserved';

  IF v_available_shares - v_reserved_shares < p_shares THEN
    RETURN FALSE;  -- Not enough unreserved shares
  END IF;

  -- Create reservation
  INSERT INTO reserved_shares (
    offering_id, user_id, order_id, shares_reserved, status
  ) VALUES (
    p_offering_id, p_user_id, p_order_id, p_shares, 'reserved'
  );

  RETURN TRUE;
END;
$$;

-- Release reserved shares
CREATE OR REPLACE FUNCTION release_reserved_shares(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE reserved_shares
  SET status = 'released', released_at = NOW()
  WHERE order_id = p_order_id AND status = 'reserved';
END;
$$;

-- Cancel order with proper cleanup
CREATE OR REPLACE FUNCTION cancel_order(p_order_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_unfilled_shares INTEGER;
  v_refund_amount INTEGER;
BEGIN
  -- Get order details
  SELECT * INTO v_order
  FROM market_orders
  WHERE id = p_order_id AND user_id = p_user_id;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  IF v_order.status IN ('filled', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order cannot be cancelled');
  END IF;

  v_unfilled_shares := v_order.shares_requested - v_order.shares_filled;

  -- Cancel the order
  UPDATE market_orders
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_order_id;

  -- Release reserved funds (for buy orders)
  IF v_order.order_type = 'buy' THEN
    v_refund_amount := ROUND(v_unfilled_shares * v_order.price_per_share * 1.02 * 100)::INTEGER;  -- Include commission
    PERFORM release_reserved_cash(p_user_id, v_refund_amount, v_order.offering_id::TEXT);
  END IF;

  -- Release reserved shares (for sell orders)
  IF v_order.order_type = 'sell' THEN
    PERFORM release_reserved_shares(p_order_id);
  END IF;

  -- Log cancellation event
  INSERT INTO order_book_events (
    offering_id, order_id, event_type, side, shares, shares_remaining, user_id
  ) VALUES (
    v_order.offering_id, p_order_id, 'order_cancelled',
    v_order.order_type, v_order.shares_requested, v_unfilled_shares, p_user_id
  );

  -- Update NBBO
  PERFORM update_nbbo(v_order.offering_id);

  RETURN jsonb_build_object(
    'success', true,
    'shares_cancelled', v_unfilled_shares,
    'shares_filled', v_order.shares_filled
  );
END;
$$;

-- =====================================================
-- RPC WRAPPER FOR MARKET METRICS
-- =====================================================

CREATE OR REPLACE FUNCTION get_nbbo(p_offering_id UUID)
RETURNS TABLE (
  best_bid DECIMAL(12,4),
  best_bid_size INTEGER,
  best_ask DECIMAL(12,4),
  best_ask_size INTEGER,
  spread DECIMAL(12,4),
  spread_pct DECIMAL(7,4),
  mid_price DECIMAL(12,4),
  last_trade_price DECIMAL(12,4),
  last_trade_size INTEGER,
  last_trade_time TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    best_bid, best_bid_size,
    best_ask, best_ask_size,
    spread, spread_pct, mid_price,
    last_trade_price, last_trade_size, last_trade_time
  FROM nbbo_cache
  WHERE offering_id = p_offering_id;
$$;

-- =====================================================
-- RLS POLICIES
-- =====================================================

ALTER TABLE order_book_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nbbo_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserved_shares ENABLE ROW LEVEL SECURITY;

-- Order book events: users see events related to their orders
CREATE POLICY "Users see own order events" ON order_book_events
  FOR SELECT USING (user_id = auth.uid() OR counterparty_id = auth.uid());

-- NBBO cache: everyone can read (public market data)
CREATE POLICY "NBBO is public" ON nbbo_cache
  FOR SELECT USING (true);

-- Reserved shares: users see their own
CREATE POLICY "Users see own reserved shares" ON reserved_shares
  FOR SELECT USING (user_id = auth.uid());

-- =====================================================
-- REALTIME SUBSCRIPTIONS
-- =====================================================

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE order_book_events;
ALTER PUBLICATION supabase_realtime ADD TABLE nbbo_cache;
ALTER PUBLICATION supabase_realtime ADD TABLE market_trades;

COMMIT;
