-- ================================================
-- CREDITS & TIPPING SYSTEM
-- ================================================
-- Enables users to buy credits and support vehicles
-- Platform takes 1% fee, builders receive 99%

-- User credits balance
CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0), -- $1 = 100 credits (cents)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);

-- Credit transactions (audit trail)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- Positive = credit, negative = debit
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'allocation', 'refund', 'payout')),
  reference_id UUID, -- Stripe payment ID or vehicle_id or payout_id
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at);

-- Vehicle support allocations
CREATE TABLE IF NOT EXISTS vehicle_support (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  supporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_allocated INTEGER NOT NULL CHECK (credits_allocated > 0),
  message TEXT,
  is_anonymous BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vehicle_id, supporter_id) -- One entry per user per vehicle (can update)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_support_vehicle_id ON vehicle_support(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_support_supporter_id ON vehicle_support(supporter_id);

-- Vehicle support summary (materialized view for performance)
DROP MATERIALIZED VIEW IF EXISTS vehicle_support_summary;

CREATE MATERIALIZED VIEW vehicle_support_summary AS
SELECT 
  vehicle_id,
  COUNT(DISTINCT supporter_id) as supporter_count,
  SUM(credits_allocated) as total_credits,
  ARRAY_AGG(supporter_id ORDER BY credits_allocated DESC) FILTER (WHERE NOT is_anonymous) as top_supporters
FROM vehicle_support
GROUP BY vehicle_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_support_summary_vehicle_id ON vehicle_support_summary(vehicle_id);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_vehicle_support_summary()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_support_summary;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refresh_support_summary_trigger ON vehicle_support;

CREATE TRIGGER refresh_support_summary_trigger
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_support
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_vehicle_support_summary();

-- Builder payout requests
CREATE TABLE IF NOT EXISTS builder_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  amount_credits INTEGER NOT NULL CHECK (amount_credits > 0),
  amount_usd DECIMAL(10,2) NOT NULL, -- Credits ÷ 100 (minus 1% platform fee)
  platform_fee_credits INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  stripe_payout_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_builder_payouts_user_id ON builder_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_builder_payouts_status ON builder_payouts(status);

-- RLS Policies
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_support ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own credits" ON user_credits;
-- Users can see own balance
CREATE POLICY "Users can view own credits"
  ON user_credits FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own transactions" ON credit_transactions;
-- Users can view own transactions
CREATE POLICY "Users can view own transactions"
  ON credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view vehicle support" ON vehicle_support;
-- Anyone can view vehicle support (public)
CREATE POLICY "Anyone can view vehicle support"
  ON vehicle_support FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can support vehicles" ON vehicle_support;
-- Users can create support allocations
CREATE POLICY "Users can support vehicles"
  ON vehicle_support FOR INSERT
  WITH CHECK (auth.uid() = supporter_id);

DROP POLICY IF EXISTS "Users can update own support" ON vehicle_support;
-- Users can update their own support
CREATE POLICY "Users can update own support"
  ON vehicle_support FOR UPDATE
  USING (auth.uid() = supporter_id);

DROP POLICY IF EXISTS "Users can view own payouts" ON builder_payouts;
-- Users can view own payouts
CREATE POLICY "Users can view own payouts"
  ON builder_payouts FOR SELECT
  USING (auth.uid() = user_id);

-- Functions
CREATE OR REPLACE FUNCTION get_user_credit_balance(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  balance INTEGER;
BEGIN
  SELECT COALESCE(user_credits.balance, 0) INTO balance
  FROM user_credits
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allocate credits to vehicle
CREATE OR REPLACE FUNCTION allocate_credits_to_vehicle(
  p_vehicle_id UUID,
  p_credits INTEGER,
  p_message TEXT DEFAULT NULL,
  p_anonymous BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN AS $$
DECLARE
  current_balance INTEGER;
BEGIN
  -- Get current balance
  current_balance := get_user_credit_balance(auth.uid());
  
  -- Check sufficient balance
  IF current_balance < p_credits THEN
    RAISE EXCEPTION 'Insufficient credits (have %, need %)', current_balance, p_credits;
  END IF;
  
  -- Deduct from balance
  UPDATE user_credits
  SET balance = balance - p_credits,
      updated_at = NOW()
  WHERE user_id = auth.uid();
  
  -- Record transaction
  INSERT INTO credit_transactions (user_id, amount, transaction_type, reference_id)
  VALUES (auth.uid(), -p_credits, 'allocation', p_vehicle_id);
  
  -- Add to vehicle support (upsert)
  INSERT INTO vehicle_support (vehicle_id, supporter_id, credits_allocated, message, is_anonymous)
  VALUES (p_vehicle_id, auth.uid(), p_credits, p_message, p_anonymous)
  ON CONFLICT (vehicle_id, supporter_id)
  DO UPDATE SET
    credits_allocated = vehicle_support.credits_allocated + p_credits,
    message = COALESCE(EXCLUDED.message, vehicle_support.message),
    created_at = NOW();
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to add credits (used by webhook)
CREATE OR REPLACE FUNCTION add_credits_to_user(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE user_credits
  SET balance = balance + p_credits,
      updated_at = NOW()
  WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    INSERT INTO user_credits (user_id, balance)
    VALUES (p_user_id, p_credits);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE user_credits IS 'User credit balances for supporting vehicles';
COMMENT ON TABLE credit_transactions IS 'Audit trail of all credit movements';
COMMENT ON TABLE vehicle_support IS 'Credits allocated by users to support specific vehicles';
COMMENT ON TABLE builder_payouts IS 'Builder requests to cash out their earned credits';

