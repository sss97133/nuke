-- Investment Platform Schema
-- Mock money system with full audit trail for regulatory readiness

-- User wallets (mock money accounts)
CREATE TABLE IF NOT EXISTS user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(15,2) NOT NULL DEFAULT 100000.00, -- Start with $100k mock money
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, currency)
);

-- Portfolio holdings (what indexes/vehicles user owns)
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What they own (one of these will be set)
  index_id UUID REFERENCES market_indexes(id),
  vehicle_id UUID REFERENCES vehicles(id),

  -- Position details
  shares NUMERIC(15,6) NOT NULL DEFAULT 0, -- Fractional shares allowed
  cost_basis NUMERIC(15,2) NOT NULL, -- What they paid
  current_value NUMERIC(15,2), -- Last calculated value

  -- Timestamps
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT holding_type_check CHECK (
    (index_id IS NOT NULL AND vehicle_id IS NULL) OR
    (index_id IS NULL AND vehicle_id IS NOT NULL)
  )
);

-- All transactions (full audit trail)
CREATE TABLE IF NOT EXISTS investment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Transaction type
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'adjustment'
  )),

  -- What was traded (null for deposits/withdrawals)
  index_id UUID REFERENCES market_indexes(id),
  vehicle_id UUID REFERENCES vehicles(id),

  -- Transaction details
  shares NUMERIC(15,6), -- Number of shares (for buy/sell)
  price_per_share NUMERIC(15,2), -- Price at transaction time
  total_amount NUMERIC(15,2) NOT NULL, -- Total $ amount
  fee_amount NUMERIC(15,2) DEFAULT 0,

  -- Resulting balance
  balance_before NUMERIC(15,2) NOT NULL,
  balance_after NUMERIC(15,2) NOT NULL,

  -- Audit fields
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

-- Watchlist for tracking vehicles/indexes
CREATE TABLE IF NOT EXISTS user_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  index_id UUID REFERENCES market_indexes(id),
  vehicle_id UUID REFERENCES vehicles(id),
  alert_price_above NUMERIC(15,2),
  alert_price_below NUMERIC(15,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT watchlist_type_check CHECK (
    (index_id IS NOT NULL AND vehicle_id IS NULL) OR
    (index_id IS NULL AND vehicle_id IS NOT NULL)
  )
);

-- Index component snapshots (what vehicles make up each index, for transparency)
CREATE TABLE IF NOT EXISTS index_components_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  index_id UUID NOT NULL REFERENCES market_indexes(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Component vehicle
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,

  -- Valuation at snapshot time
  price NUMERIC(15,2) NOT NULL,
  weight NUMERIC(8,6), -- Weight in index (0-1)

  -- Source info
  price_source TEXT,
  source_url TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(index_id, snapshot_date, vehicle_id)
);

-- Performance history for portfolios
CREATE TABLE IF NOT EXISTS portfolio_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,

  total_value NUMERIC(15,2) NOT NULL,
  total_cost_basis NUMERIC(15,2) NOT NULL,
  total_gain_loss NUMERIC(15,2) NOT NULL,
  total_gain_loss_pct NUMERIC(8,4),

  cash_balance NUMERIC(15,2) NOT NULL,
  invested_value NUMERIC(15,2) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, snapshot_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_user ON portfolio_holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_index ON portfolio_holdings(index_id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_user ON investment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_investment_transactions_created ON investment_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_index_components_snapshot_index_date ON index_components_snapshot(index_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_portfolio_performance_user_date ON portfolio_performance(user_id, snapshot_date DESC);

-- RLS Policies
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_performance ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY wallet_user_policy ON user_wallets
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY holdings_user_policy ON portfolio_holdings
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY transactions_user_policy ON investment_transactions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY watchlist_user_policy ON user_watchlist
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY performance_user_policy ON portfolio_performance
  FOR ALL USING (auth.uid() = user_id);

-- Index components are public (transparency)
ALTER TABLE index_components_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY index_components_public_read ON index_components_snapshot
  FOR SELECT USING (true);

-- Function to initialize wallet for new users
CREATE OR REPLACE FUNCTION initialize_user_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_wallets (user_id, balance, currency)
  VALUES (NEW.id, 100000.00, 'USD')
  ON CONFLICT (user_id, currency) DO NOTHING;

  -- Record the initial deposit
  INSERT INTO investment_transactions (
    user_id, transaction_type, total_amount,
    balance_before, balance_after, status, notes
  ) VALUES (
    NEW.id, 'deposit', 100000.00,
    0, 100000.00, 'completed', 'Initial mock money allocation'
  );

  RETURN NEW;
END;
$$;

-- Trigger to auto-create wallet on user signup
DROP TRIGGER IF EXISTS on_auth_user_created_wallet ON auth.users;
CREATE TRIGGER on_auth_user_created_wallet
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION initialize_user_wallet();

-- Function to execute a trade
CREATE OR REPLACE FUNCTION execute_trade(
  p_user_id UUID,
  p_action TEXT, -- 'buy' or 'sell'
  p_index_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_shares NUMERIC DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL -- Either shares or amount, we calculate the other
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet user_wallets%ROWTYPE;
  v_current_price NUMERIC;
  v_shares_to_trade NUMERIC;
  v_total_cost NUMERIC;
  v_fee NUMERIC := 0; -- No fees for now
  v_holding portfolio_holdings%ROWTYPE;
  v_transaction_id UUID;
BEGIN
  -- Get user wallet
  SELECT * INTO v_wallet FROM user_wallets WHERE user_id = p_user_id AND currency = 'USD';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;

  -- Get current price
  IF p_index_id IS NOT NULL THEN
    SELECT close_value INTO v_current_price
    FROM market_index_values
    WHERE index_id = p_index_id
    ORDER BY value_date DESC
    LIMIT 1;
  ELSIF p_vehicle_id IS NOT NULL THEN
    SELECT COALESCE(sale_price, asking_price) INTO v_current_price
    FROM vehicles WHERE id = p_vehicle_id;
  END IF;

  IF v_current_price IS NULL OR v_current_price <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unable to determine current price');
  END IF;

  -- Calculate shares and cost
  IF p_shares IS NOT NULL THEN
    v_shares_to_trade := p_shares;
    v_total_cost := p_shares * v_current_price;
  ELSIF p_amount IS NOT NULL THEN
    v_shares_to_trade := p_amount / v_current_price;
    v_total_cost := p_amount;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Must specify shares or amount');
  END IF;

  -- Execute based on action
  IF p_action = 'buy' THEN
    -- Check balance
    IF v_wallet.balance < v_total_cost + v_fee THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient funds',
        'required', v_total_cost + v_fee, 'available', v_wallet.balance);
    END IF;

    -- Deduct from wallet
    UPDATE user_wallets
    SET balance = balance - (v_total_cost + v_fee), updated_at = NOW()
    WHERE id = v_wallet.id;

    -- Add or update holding
    INSERT INTO portfolio_holdings (user_id, index_id, vehicle_id, shares, cost_basis, current_value)
    VALUES (p_user_id, p_index_id, p_vehicle_id, v_shares_to_trade, v_total_cost, v_total_cost)
    ON CONFLICT (user_id, index_id) WHERE index_id IS NOT NULL
    DO UPDATE SET
      shares = portfolio_holdings.shares + v_shares_to_trade,
      cost_basis = portfolio_holdings.cost_basis + v_total_cost,
      current_value = (portfolio_holdings.shares + v_shares_to_trade) * v_current_price,
      updated_at = NOW();

    -- Record transaction
    INSERT INTO investment_transactions (
      user_id, transaction_type, index_id, vehicle_id,
      shares, price_per_share, total_amount, fee_amount,
      balance_before, balance_after, status, executed_at
    ) VALUES (
      p_user_id, 'buy', p_index_id, p_vehicle_id,
      v_shares_to_trade, v_current_price, v_total_cost, v_fee,
      v_wallet.balance, v_wallet.balance - v_total_cost - v_fee, 'completed', NOW()
    ) RETURNING id INTO v_transaction_id;

  ELSIF p_action = 'sell' THEN
    -- Get existing holding
    SELECT * INTO v_holding
    FROM portfolio_holdings
    WHERE user_id = p_user_id
      AND ((index_id = p_index_id) OR (vehicle_id = p_vehicle_id));

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'No position to sell');
    END IF;

    IF v_holding.shares < v_shares_to_trade THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient shares',
        'requested', v_shares_to_trade, 'available', v_holding.shares);
    END IF;

    -- Add to wallet
    UPDATE user_wallets
    SET balance = balance + v_total_cost - v_fee, updated_at = NOW()
    WHERE id = v_wallet.id;

    -- Update or remove holding
    IF v_holding.shares = v_shares_to_trade THEN
      DELETE FROM portfolio_holdings WHERE id = v_holding.id;
    ELSE
      UPDATE portfolio_holdings
      SET shares = shares - v_shares_to_trade,
          cost_basis = cost_basis * ((shares - v_shares_to_trade) / shares),
          current_value = (shares - v_shares_to_trade) * v_current_price,
          updated_at = NOW()
      WHERE id = v_holding.id;
    END IF;

    -- Record transaction
    INSERT INTO investment_transactions (
      user_id, transaction_type, index_id, vehicle_id,
      shares, price_per_share, total_amount, fee_amount,
      balance_before, balance_after, status, executed_at
    ) VALUES (
      p_user_id, 'sell', p_index_id, p_vehicle_id,
      v_shares_to_trade, v_current_price, v_total_cost, v_fee,
      v_wallet.balance, v_wallet.balance + v_total_cost - v_fee, 'completed', NOW()
    ) RETURNING id INTO v_transaction_id;

  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'action', p_action,
    'shares', v_shares_to_trade,
    'price_per_share', v_current_price,
    'total_amount', v_total_cost,
    'fee', v_fee,
    'new_balance', v_wallet.balance - CASE WHEN p_action = 'buy' THEN v_total_cost + v_fee ELSE -(v_total_cost - v_fee) END
  );
END;
$$;

-- Function to get portfolio summary
CREATE OR REPLACE FUNCTION get_portfolio_summary(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_result JSONB;
  v_wallet user_wallets%ROWTYPE;
  v_total_invested NUMERIC := 0;
  v_total_current NUMERIC := 0;
BEGIN
  -- Get wallet
  SELECT * INTO v_wallet FROM user_wallets WHERE user_id = p_user_id AND currency = 'USD';

  -- Calculate portfolio totals
  SELECT
    COALESCE(SUM(cost_basis), 0),
    COALESCE(SUM(current_value), 0)
  INTO v_total_invested, v_total_current
  FROM portfolio_holdings
  WHERE user_id = p_user_id;

  -- Build result
  SELECT jsonb_build_object(
    'cash_balance', COALESCE(v_wallet.balance, 0),
    'total_invested', v_total_invested,
    'total_current_value', v_total_current,
    'total_gain_loss', v_total_current - v_total_invested,
    'total_gain_loss_pct', CASE WHEN v_total_invested > 0
      THEN ((v_total_current - v_total_invested) / v_total_invested * 100)
      ELSE 0 END,
    'total_portfolio_value', COALESCE(v_wallet.balance, 0) + v_total_current,
    'holdings', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', h.id,
        'type', CASE WHEN h.index_id IS NOT NULL THEN 'index' ELSE 'vehicle' END,
        'index_id', h.index_id,
        'index_code', mi.index_code,
        'index_name', mi.index_name,
        'vehicle_id', h.vehicle_id,
        'vehicle_name', CONCAT(v.year, ' ', v.make, ' ', v.model),
        'shares', h.shares,
        'cost_basis', h.cost_basis,
        'current_value', h.current_value,
        'gain_loss', h.current_value - h.cost_basis,
        'gain_loss_pct', CASE WHEN h.cost_basis > 0
          THEN ((h.current_value - h.cost_basis) / h.cost_basis * 100)
          ELSE 0 END,
        'acquired_at', h.acquired_at
      ) ORDER BY h.current_value DESC), '[]'::jsonb)
      FROM portfolio_holdings h
      LEFT JOIN market_indexes mi ON mi.id = h.index_id
      LEFT JOIN vehicles v ON v.id = h.vehicle_id
      WHERE h.user_id = p_user_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION execute_trade TO authenticated;
GRANT EXECUTE ON FUNCTION get_portfolio_summary TO authenticated;
