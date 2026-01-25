-- ============================================================================
-- Risk Management Migration
-- Phase 7: Risk Limits and Pre-Trade Checks
--
-- Tables:
--   - user_position_limits: Per-user trading limits
--   - risk_limit_events: Audit log of limit violations
--
-- Functions:
--   - check_position_limits: Pre-trade position validation
--   - check_order_limits: Pre-trade order size validation
--   - check_daily_trade_limit: Daily trade count check
--   - get_user_risk_profile: Summary of user's risk limits and usage
-- ============================================================================

-- ============================================================================
-- USER POSITION LIMITS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_position_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Position Limits
  max_position_per_offering INTEGER NOT NULL DEFAULT 500, -- Max shares per offering (500 = 50%)
  max_position_value_cents BIGINT NOT NULL DEFAULT 10000000, -- Max value per position ($100K)
  max_total_exposure_cents BIGINT NOT NULL DEFAULT 50000000, -- Max total portfolio value ($500K)

  -- Order Limits
  max_order_value_cents BIGINT NOT NULL DEFAULT 10000000, -- Max single order ($100K)
  max_order_shares INTEGER NOT NULL DEFAULT 100, -- Max shares per order

  -- Daily Limits
  daily_trade_limit INTEGER NOT NULL DEFAULT 50, -- Max trades per day
  daily_volume_limit_cents BIGINT NOT NULL DEFAULT 25000000, -- Max daily volume ($250K)

  -- Risk Score (1-10, higher = more risk allowed)
  risk_tier INTEGER NOT NULL DEFAULT 5 CHECK (risk_tier BETWEEN 1 AND 10),

  -- Account Flags
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_accredited_investor BOOLEAN NOT NULL DEFAULT false,
  kyc_completed_at TIMESTAMPTZ,
  aml_cleared_at TIMESTAMPTZ,

  -- Restrictions
  trading_suspended BOOLEAN NOT NULL DEFAULT false,
  suspension_reason TEXT,
  suspension_until TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One record per user
  CONSTRAINT unique_user_limits UNIQUE (user_id)
);

-- Indexes
CREATE INDEX idx_user_position_limits_user ON user_position_limits(user_id);
CREATE INDEX idx_user_position_limits_suspended ON user_position_limits(trading_suspended) WHERE trading_suspended = true;

-- ============================================================================
-- RISK LIMIT EVENTS TABLE
-- Audit log of limit checks and violations
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offering_id UUID REFERENCES vehicle_offerings(id) ON DELETE SET NULL,
  order_id UUID REFERENCES market_orders(id) ON DELETE SET NULL,

  -- Event Details
  event_type TEXT NOT NULL CHECK (event_type IN (
    'position_limit_exceeded',
    'order_limit_exceeded',
    'daily_limit_exceeded',
    'exposure_limit_exceeded',
    'trading_suspended',
    'limit_warning',
    'limit_increased',
    'limit_decreased'
  )),

  -- Context
  limit_name TEXT NOT NULL, -- e.g., 'max_position_per_offering'
  limit_value BIGINT NOT NULL, -- The limit that was checked
  actual_value BIGINT NOT NULL, -- The value that triggered the event
  requested_value BIGINT, -- The value that was requested (for orders)

  -- Outcome
  action_taken TEXT NOT NULL DEFAULT 'blocked' CHECK (action_taken IN (
    'blocked',
    'allowed',
    'warning_issued',
    'limit_adjusted'
  )),

  -- Details
  details JSONB DEFAULT '{}'::jsonb,
  notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_risk_limit_events_user ON risk_limit_events(user_id);
CREATE INDEX idx_risk_limit_events_type ON risk_limit_events(event_type);
CREATE INDEX idx_risk_limit_events_date ON risk_limit_events(created_at);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Ensure user has position limits record (create default if needed)
CREATE OR REPLACE FUNCTION ensure_user_limits(p_user_id UUID)
RETURNS user_position_limits
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limits user_position_limits%ROWTYPE;
BEGIN
  SELECT * INTO v_limits
  FROM user_position_limits
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO user_position_limits (user_id)
    VALUES (p_user_id)
    RETURNING * INTO v_limits;
  END IF;

  RETURN v_limits;
END;
$$;

-- Check position limits before trade
CREATE OR REPLACE FUNCTION check_position_limits(
  p_user_id UUID,
  p_offering_id UUID,
  p_shares_requested INTEGER,
  p_side TEXT -- 'buy' or 'sell'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limits user_position_limits%ROWTYPE;
  v_current_position INTEGER;
  v_new_position INTEGER;
  v_offering vehicle_offerings%ROWTYPE;
  v_position_value BIGINT;
  v_total_exposure BIGINT;
BEGIN
  -- Get or create user limits
  v_limits := ensure_user_limits(p_user_id);

  -- Check if trading is suspended
  IF v_limits.trading_suspended THEN
    INSERT INTO risk_limit_events (
      user_id, offering_id, event_type, limit_name,
      limit_value, actual_value, action_taken, details
    ) VALUES (
      p_user_id, p_offering_id, 'trading_suspended', 'trading_suspended',
      1, 1, 'blocked',
      jsonb_build_object('reason', v_limits.suspension_reason)
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Trading is suspended: ' || COALESCE(v_limits.suspension_reason, 'Contact support'),
      'error_code', 'TRADING_SUSPENDED'
    );
  END IF;

  -- Get offering details
  SELECT * INTO v_offering
  FROM vehicle_offerings
  WHERE id = p_offering_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Offering not found',
      'error_code', 'OFFERING_NOT_FOUND'
    );
  END IF;

  -- Get current position
  SELECT COALESCE(shares_owned, 0) INTO v_current_position
  FROM share_holdings
  WHERE user_id = p_user_id AND offering_id = p_offering_id;

  v_current_position := COALESCE(v_current_position, 0);

  -- Calculate new position
  IF p_side = 'buy' THEN
    v_new_position := v_current_position + p_shares_requested;
  ELSE
    v_new_position := v_current_position - p_shares_requested;
  END IF;

  -- Check for negative position (short selling not allowed)
  IF v_new_position < 0 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Insufficient shares to sell',
      'error_code', 'INSUFFICIENT_SHARES',
      'current_position', v_current_position,
      'requested', p_shares_requested
    );
  END IF;

  -- Check max position per offering (only for buys)
  IF p_side = 'buy' AND v_new_position > v_limits.max_position_per_offering THEN
    INSERT INTO risk_limit_events (
      user_id, offering_id, event_type, limit_name,
      limit_value, actual_value, requested_value, action_taken
    ) VALUES (
      p_user_id, p_offering_id, 'position_limit_exceeded', 'max_position_per_offering',
      v_limits.max_position_per_offering, v_current_position, v_new_position, 'blocked'
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Position limit exceeded. Max ' || v_limits.max_position_per_offering || ' shares per offering.',
      'error_code', 'POSITION_LIMIT_EXCEEDED',
      'limit', v_limits.max_position_per_offering,
      'current_position', v_current_position,
      'requested_new_position', v_new_position
    );
  END IF;

  -- Check position value limit
  v_position_value := v_new_position * v_offering.current_share_price;

  IF p_side = 'buy' AND v_position_value > v_limits.max_position_value_cents THEN
    INSERT INTO risk_limit_events (
      user_id, offering_id, event_type, limit_name,
      limit_value, actual_value, requested_value, action_taken
    ) VALUES (
      p_user_id, p_offering_id, 'exposure_limit_exceeded', 'max_position_value_cents',
      v_limits.max_position_value_cents, v_current_position * v_offering.current_share_price, v_position_value, 'blocked'
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Position value limit exceeded',
      'error_code', 'POSITION_VALUE_EXCEEDED',
      'limit_cents', v_limits.max_position_value_cents,
      'position_value_cents', v_position_value
    );
  END IF;

  -- Check total exposure (sum of all positions)
  SELECT COALESCE(SUM(sh.shares_owned * vo.current_share_price), 0) INTO v_total_exposure
  FROM share_holdings sh
  JOIN vehicle_offerings vo ON vo.id = sh.offering_id
  WHERE sh.user_id = p_user_id;

  -- Add the new position value (minus current position in this offering to avoid double counting)
  v_total_exposure := v_total_exposure - (v_current_position * v_offering.current_share_price) + v_position_value;

  IF p_side = 'buy' AND v_total_exposure > v_limits.max_total_exposure_cents THEN
    INSERT INTO risk_limit_events (
      user_id, offering_id, event_type, limit_name,
      limit_value, actual_value, action_taken
    ) VALUES (
      p_user_id, p_offering_id, 'exposure_limit_exceeded', 'max_total_exposure_cents',
      v_limits.max_total_exposure_cents, v_total_exposure, 'blocked'
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Total portfolio exposure limit exceeded',
      'error_code', 'TOTAL_EXPOSURE_EXCEEDED',
      'limit_cents', v_limits.max_total_exposure_cents,
      'total_exposure_cents', v_total_exposure
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'current_position', v_current_position,
    'new_position', v_new_position,
    'position_value_cents', v_position_value,
    'total_exposure_cents', v_total_exposure,
    'remaining_capacity', v_limits.max_position_per_offering - v_new_position
  );
END;
$$;

-- Check order size limits
CREATE OR REPLACE FUNCTION check_order_limits(
  p_user_id UUID,
  p_shares INTEGER,
  p_price_cents BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limits user_position_limits%ROWTYPE;
  v_order_value BIGINT;
BEGIN
  v_limits := ensure_user_limits(p_user_id);
  v_order_value := p_shares * p_price_cents;

  -- Check max order shares
  IF p_shares > v_limits.max_order_shares THEN
    INSERT INTO risk_limit_events (
      user_id, event_type, limit_name,
      limit_value, actual_value, action_taken
    ) VALUES (
      p_user_id, 'order_limit_exceeded', 'max_order_shares',
      v_limits.max_order_shares, p_shares, 'blocked'
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Order size exceeds maximum of ' || v_limits.max_order_shares || ' shares',
      'error_code', 'ORDER_SHARES_EXCEEDED',
      'limit', v_limits.max_order_shares,
      'requested', p_shares
    );
  END IF;

  -- Check max order value
  IF v_order_value > v_limits.max_order_value_cents THEN
    INSERT INTO risk_limit_events (
      user_id, event_type, limit_name,
      limit_value, actual_value, action_taken
    ) VALUES (
      p_user_id, 'order_limit_exceeded', 'max_order_value_cents',
      v_limits.max_order_value_cents, v_order_value, 'blocked'
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Order value exceeds maximum',
      'error_code', 'ORDER_VALUE_EXCEEDED',
      'limit_cents', v_limits.max_order_value_cents,
      'order_value_cents', v_order_value
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'order_value_cents', v_order_value
  );
END;
$$;

-- Check daily trading limits
CREATE OR REPLACE FUNCTION check_daily_trade_limit(
  p_user_id UUID,
  p_order_value_cents BIGINT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limits user_position_limits%ROWTYPE;
  v_today_trades INTEGER;
  v_today_volume BIGINT;
BEGIN
  v_limits := ensure_user_limits(p_user_id);

  -- Count today's trades
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
  INTO v_today_trades, v_today_volume
  FROM market_trades
  WHERE (buyer_id = p_user_id OR seller_id = p_user_id)
    AND created_at >= CURRENT_DATE
    AND created_at < CURRENT_DATE + INTERVAL '1 day';

  -- Check trade count limit
  IF v_today_trades >= v_limits.daily_trade_limit THEN
    INSERT INTO risk_limit_events (
      user_id, event_type, limit_name,
      limit_value, actual_value, action_taken
    ) VALUES (
      p_user_id, 'daily_limit_exceeded', 'daily_trade_limit',
      v_limits.daily_trade_limit, v_today_trades, 'blocked'
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Daily trade limit reached (' || v_limits.daily_trade_limit || ' trades)',
      'error_code', 'DAILY_TRADE_LIMIT',
      'limit', v_limits.daily_trade_limit,
      'today_trades', v_today_trades
    );
  END IF;

  -- Check daily volume limit
  IF v_today_volume + p_order_value_cents > v_limits.daily_volume_limit_cents THEN
    INSERT INTO risk_limit_events (
      user_id, event_type, limit_name,
      limit_value, actual_value, action_taken
    ) VALUES (
      p_user_id, 'daily_limit_exceeded', 'daily_volume_limit_cents',
      v_limits.daily_volume_limit_cents, v_today_volume + p_order_value_cents, 'blocked'
    );

    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Daily volume limit would be exceeded',
      'error_code', 'DAILY_VOLUME_LIMIT',
      'limit_cents', v_limits.daily_volume_limit_cents,
      'today_volume_cents', v_today_volume,
      'remaining_cents', v_limits.daily_volume_limit_cents - v_today_volume
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'today_trades', v_today_trades,
    'today_volume_cents', v_today_volume,
    'remaining_trades', v_limits.daily_trade_limit - v_today_trades,
    'remaining_volume_cents', v_limits.daily_volume_limit_cents - v_today_volume
  );
END;
$$;

-- Combined pre-trade risk check
CREATE OR REPLACE FUNCTION pre_trade_risk_check(
  p_user_id UUID,
  p_offering_id UUID,
  p_shares INTEGER,
  p_price_cents BIGINT,
  p_side TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_position_check JSONB;
  v_order_check JSONB;
  v_daily_check JSONB;
  v_order_value BIGINT;
BEGIN
  v_order_value := p_shares * p_price_cents;

  -- Check position limits
  v_position_check := check_position_limits(p_user_id, p_offering_id, p_shares, p_side);
  IF NOT (v_position_check->>'allowed')::boolean THEN
    RETURN v_position_check;
  END IF;

  -- Check order limits
  v_order_check := check_order_limits(p_user_id, p_shares, p_price_cents);
  IF NOT (v_order_check->>'allowed')::boolean THEN
    RETURN v_order_check;
  END IF;

  -- Check daily limits
  v_daily_check := check_daily_trade_limit(p_user_id, v_order_value);
  IF NOT (v_daily_check->>'allowed')::boolean THEN
    RETURN v_daily_check;
  END IF;

  -- All checks passed
  RETURN jsonb_build_object(
    'allowed', true,
    'position', v_position_check,
    'order', v_order_check,
    'daily', v_daily_check
  );
END;
$$;

-- Get user's risk profile summary
CREATE OR REPLACE FUNCTION get_user_risk_profile(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limits user_position_limits%ROWTYPE;
  v_today_trades INTEGER;
  v_today_volume BIGINT;
  v_total_exposure BIGINT;
  v_largest_position JSONB;
BEGIN
  v_limits := ensure_user_limits(p_user_id);

  -- Get today's trading activity
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
  INTO v_today_trades, v_today_volume
  FROM market_trades
  WHERE (buyer_id = p_user_id OR seller_id = p_user_id)
    AND created_at >= CURRENT_DATE
    AND created_at < CURRENT_DATE + INTERVAL '1 day';

  -- Get total exposure
  SELECT COALESCE(SUM(sh.shares_owned * vo.current_share_price), 0)
  INTO v_total_exposure
  FROM share_holdings sh
  JOIN vehicle_offerings vo ON vo.id = sh.offering_id
  WHERE sh.user_id = p_user_id;

  -- Get largest position
  SELECT jsonb_build_object(
    'offering_id', sh.offering_id,
    'shares', sh.shares_owned,
    'value_cents', sh.shares_owned * vo.current_share_price
  ) INTO v_largest_position
  FROM share_holdings sh
  JOIN vehicle_offerings vo ON vo.id = sh.offering_id
  WHERE sh.user_id = p_user_id
  ORDER BY sh.shares_owned * vo.current_share_price DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'risk_tier', v_limits.risk_tier,
    'is_verified', v_limits.is_verified,
    'is_accredited', v_limits.is_accredited_investor,
    'trading_suspended', v_limits.trading_suspended,
    'limits', jsonb_build_object(
      'max_position_per_offering', v_limits.max_position_per_offering,
      'max_position_value_cents', v_limits.max_position_value_cents,
      'max_total_exposure_cents', v_limits.max_total_exposure_cents,
      'max_order_value_cents', v_limits.max_order_value_cents,
      'max_order_shares', v_limits.max_order_shares,
      'daily_trade_limit', v_limits.daily_trade_limit,
      'daily_volume_limit_cents', v_limits.daily_volume_limit_cents
    ),
    'current_usage', jsonb_build_object(
      'today_trades', v_today_trades,
      'today_volume_cents', v_today_volume,
      'total_exposure_cents', v_total_exposure,
      'largest_position', v_largest_position
    ),
    'remaining', jsonb_build_object(
      'trades_today', v_limits.daily_trade_limit - v_today_trades,
      'volume_today_cents', v_limits.daily_volume_limit_cents - v_today_volume,
      'exposure_cents', v_limits.max_total_exposure_cents - v_total_exposure
    )
  );
END;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_user_position_limits_updated_at
  BEFORE UPDATE ON user_position_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE user_position_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_limit_events ENABLE ROW LEVEL SECURITY;

-- Users can view their own limits
CREATE POLICY "Users can view own limits"
  ON user_position_limits FOR SELECT
  USING (user_id = auth.uid());

-- Users can view their own events
CREATE POLICY "Users can view own events"
  ON risk_limit_events FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE user_position_limits IS 'Per-user trading and position limits for risk management';
COMMENT ON TABLE risk_limit_events IS 'Audit log of risk limit checks and violations';
COMMENT ON FUNCTION pre_trade_risk_check IS 'Combined pre-trade risk check - call before order placement';
COMMENT ON FUNCTION get_user_risk_profile IS 'Get summary of user risk limits and current usage';
