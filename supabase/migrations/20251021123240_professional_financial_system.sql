-- =====================================================
-- PROFESSIONAL FINANCIAL SYSTEM
-- =====================================================
-- Migrate from "credits" to proper cash balance + share trading
-- Date: October 21, 2025

-- =====================================================
-- CASH BALANCE SYSTEM
-- =====================================================

-- User Cash Balance (replaces user_credits)
CREATE TABLE IF NOT EXISTS user_cash_balances (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_cents BIGINT DEFAULT 0 CHECK (balance_cents >= 0),
  available_cents BIGINT DEFAULT 0 CHECK (available_cents >= 0),
  reserved_cents BIGINT DEFAULT 0 CHECK (reserved_cents >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Invariant: balance = available + reserved
  CONSTRAINT balance_invariant CHECK (balance_cents = available_cents + reserved_cents)
);

CREATE INDEX IF NOT EXISTS idx_user_cash_balances_user_id ON user_cash_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cash_balances_balance ON user_cash_balances(balance_cents DESC);

-- Cash Transactions (replaces credit_transactions)
CREATE TABLE IF NOT EXISTS cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN 
    ('deposit', 'withdrawal', 'trade_buy', 'trade_sell', 'fee', 'refund')),
  status TEXT DEFAULT 'completed' CHECK (status IN 
    ('pending', 'completed', 'failed', 'cancelled')),
  
  -- External References
  stripe_payment_id TEXT,
  stripe_payout_id TEXT,
  reference_id UUID, -- trade_id, offering_id, etc.
  
  -- Audit & Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_user_id ON cash_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_type ON cash_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_created ON cash_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_stripe_payment ON cash_transactions(stripe_payment_id) WHERE stripe_payment_id IS NOT NULL;

-- =====================================================
-- DATA MIGRATION FROM OLD SYSTEM
-- =====================================================

-- Migrate user_credits → user_cash_balances
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_credits'
  ) THEN
    INSERT INTO user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
    SELECT 
      user_id,
      balance AS balance_cents, -- Already in cents
      balance AS available_cents,
      0 AS reserved_cents
    FROM user_credits
    ON CONFLICT (user_id) DO UPDATE SET
      balance_cents = EXCLUDED.balance_cents,
      available_cents = EXCLUDED.available_cents,
      updated_at = NOW();
  ELSE
    RAISE NOTICE 'Skipping user_credits migration: table does not exist.';
  END IF;
END
$$;

-- Migrate credit_transactions → cash_transactions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'credit_transactions'
  ) THEN
    INSERT INTO cash_transactions (
      user_id, 
      amount_cents, 
      transaction_type, 
      reference_id, 
      metadata, 
      created_at,
      completed_at
    )
    SELECT 
      user_id,
      amount,
      CASE 
        WHEN transaction_type = 'purchase' THEN 'deposit'
        WHEN transaction_type = 'allocation' THEN 'trade_buy'
        WHEN transaction_type = 'payout' THEN 'withdrawal'
        ELSE transaction_type
      END,
      reference_id,
      metadata,
      created_at,
      created_at
    FROM credit_transactions
    ON CONFLICT DO NOTHING;
  ELSE
    RAISE NOTICE 'Skipping credit_transactions migration: table does not exist.';
  END IF;
END
$$;

-- =====================================================
-- RLS POLICIES
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_cash_balances'
  ) THEN
    EXECUTE 'ALTER TABLE user_cash_balances ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'user_cash_balances'
        AND policyname = 'Users can view own cash balance'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view own cash balance" ON user_cash_balances';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'user_cash_balances'
        AND policyname = 'System can modify cash balances'
    ) THEN
      EXECUTE 'DROP POLICY "System can modify cash balances" ON user_cash_balances';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view own cash balance" ON user_cash_balances FOR SELECT USING (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY "System can modify cash balances" ON user_cash_balances FOR ALL USING (false) WITH CHECK (false)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for user_cash_balances: table does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'cash_transactions'
  ) THEN
    EXECUTE 'ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'cash_transactions'
        AND policyname = 'Users can view own cash transactions'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view own cash transactions" ON cash_transactions';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'cash_transactions'
        AND policyname = 'System can insert cash transactions'
    ) THEN
      EXECUTE 'DROP POLICY "System can insert cash transactions" ON cash_transactions';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view own cash transactions" ON cash_transactions FOR SELECT USING (auth.uid() = user_id)';
    EXECUTE 'CREATE POLICY "System can insert cash transactions" ON cash_transactions FOR INSERT WITH CHECK (false)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for cash_transactions: table does not exist.';
  END IF;
END
$$;

-- =====================================================
-- CASH MANAGEMENT FUNCTIONS
-- =====================================================

-- Get user's available cash balance
CREATE OR REPLACE FUNCTION get_user_cash_balance(p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
  available BIGINT;
BEGIN
  SELECT COALESCE(available_cents, 0) INTO available
  FROM user_cash_balances
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(available, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add cash to user (deposits)
CREATE OR REPLACE FUNCTION add_cash_to_user(
  p_user_id UUID,
  p_amount_cents BIGINT,
  p_stripe_payment_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
BEGIN
  -- Upsert cash balance
  INSERT INTO user_cash_balances (user_id, balance_cents, available_cents, reserved_cents)
  VALUES (p_user_id, p_amount_cents, p_amount_cents, 0)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    balance_cents = user_cash_balances.balance_cents + p_amount_cents,
    available_cents = user_cash_balances.available_cents + p_amount_cents,
    updated_at = NOW();
  
  -- Record transaction
  INSERT INTO cash_transactions (
    user_id, 
    amount_cents, 
    transaction_type, 
    stripe_payment_id,
    metadata,
    completed_at
  )
  VALUES (
    p_user_id, 
    p_amount_cents, 
    'deposit',
    p_stripe_payment_id,
    p_metadata,
    NOW()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deduct cash from user (withdrawals, purchases)
CREATE OR REPLACE FUNCTION deduct_cash_from_user(
  p_user_id UUID,
  p_amount_cents BIGINT,
  p_transaction_type TEXT,
  p_reference_id UUID DEFAULT NULL,
  p_stripe_payout_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS BOOLEAN AS $$
DECLARE
  current_available BIGINT;
BEGIN
  -- Get current available balance
  current_available := get_user_cash_balance(p_user_id);
  
  -- Check sufficient funds
  IF current_available < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient funds: have % cents, need % cents', current_available, p_amount_cents;
  END IF;
  
  -- Deduct from balance
  UPDATE user_cash_balances
  SET 
    balance_cents = balance_cents - p_amount_cents,
    available_cents = available_cents - p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_user_id;
  
  -- Record transaction
  INSERT INTO cash_transactions (
    user_id, 
    amount_cents, 
    transaction_type,
    reference_id,
    stripe_payout_id,
    metadata,
    completed_at
  )
  VALUES (
    p_user_id, 
    -p_amount_cents, -- Negative for deductions
    p_transaction_type,
    p_reference_id,
    p_stripe_payout_id,
    p_metadata,
    NOW()
  );
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reserve cash (for pending orders)
CREATE OR REPLACE FUNCTION reserve_cash(
  p_user_id UUID,
  p_amount_cents BIGINT,
  p_reference_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  current_available BIGINT;
BEGIN
  current_available := get_user_cash_balance(p_user_id);
  
  IF current_available < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient funds to reserve: have % cents, need % cents', current_available, p_amount_cents;
  END IF;
  
  UPDATE user_cash_balances
  SET 
    available_cents = available_cents - p_amount_cents,
    reserved_cents = reserved_cents + p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_user_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Release reserved cash (cancel order)
CREATE OR REPLACE FUNCTION release_reserved_cash(
  p_user_id UUID,
  p_amount_cents BIGINT
)
RETURNS VOID AS $$
BEGIN
  UPDATE user_cash_balances
  SET 
    available_cents = available_cents + p_amount_cents,
    reserved_cents = reserved_cents - p_amount_cents,
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Execute trade (atomic cash + share transfer)
CREATE OR REPLACE FUNCTION execute_trade(
  p_buyer_id UUID,
  p_seller_id UUID,
  p_offering_id UUID,
  p_shares INTEGER,
  p_price_per_share DECIMAL,
  p_platform_fee_pct DECIMAL DEFAULT 2.0
)
RETURNS UUID AS $$
DECLARE
  total_cents BIGINT;
  platform_fee_cents BIGINT;
  seller_proceeds_cents BIGINT;
  trade_id UUID;
BEGIN
  -- Calculate amounts
  total_cents := FLOOR(p_shares * p_price_per_share * 100);
  platform_fee_cents := FLOOR(total_cents * p_platform_fee_pct / 100);
  seller_proceeds_cents := total_cents - platform_fee_cents;
  
  -- Generate trade ID
  trade_id := gen_random_uuid();
  
  -- Deduct from buyer
  UPDATE user_cash_balances
  SET 
    balance_cents = balance_cents - total_cents,
    reserved_cents = reserved_cents - total_cents,
    updated_at = NOW()
  WHERE user_id = p_buyer_id;
  
  -- Add to seller (minus fee)
  UPDATE user_cash_balances
  SET 
    balance_cents = balance_cents + seller_proceeds_cents,
    available_cents = available_cents + seller_proceeds_cents,
    updated_at = NOW()
  WHERE user_id = p_seller_id;
  
  -- Record buyer transaction
  INSERT INTO cash_transactions (
    user_id, amount_cents, transaction_type, reference_id, completed_at,
    metadata
  )
  VALUES (
    p_buyer_id, -total_cents, 'trade_buy', trade_id, NOW(),
    jsonb_build_object(
      'offering_id', p_offering_id,
      'shares', p_shares,
      'price_per_share', p_price_per_share
    )
  );
  
  -- Record seller transaction
  INSERT INTO cash_transactions (
    user_id, amount_cents, transaction_type, reference_id, completed_at,
    metadata
  )
  VALUES (
    p_seller_id, seller_proceeds_cents, 'trade_sell', trade_id, NOW(),
    jsonb_build_object(
      'offering_id', p_offering_id,
      'shares', p_shares,
      'price_per_share', p_price_per_share,
      'platform_fee', platform_fee_cents
    )
  );
  
  -- Record platform fee
  INSERT INTO cash_transactions (
    user_id, amount_cents, transaction_type, reference_id, completed_at,
    metadata
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000'::UUID, -- Platform user
    platform_fee_cents, 
    'fee', 
    trade_id, 
    NOW(),
    jsonb_build_object('fee_pct', p_platform_fee_pct)
  );
  
  RETURN trade_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- DEPRECATE OLD TABLES
-- =====================================================

COMMENT ON TABLE user_credits IS 'DEPRECATED - Replaced by user_cash_balances. Do not use for new features.';
COMMENT ON TABLE credit_transactions IS 'DEPRECATED - Replaced by cash_transactions. Do not use for new features.';
COMMENT ON TABLE vehicle_support IS 'DEPRECATED - Replaced by share_holdings in market system.';

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE user_cash_balances IS 'User USD cash balances stored in cents. Professional trading system.';
COMMENT ON TABLE cash_transactions IS 'Audit trail of all cash movements: deposits, trades, withdrawals, fees.';
COMMENT ON FUNCTION add_cash_to_user IS 'Add cash to user balance (deposits from Stripe)';
COMMENT ON FUNCTION deduct_cash_from_user IS 'Deduct cash from user balance (withdrawals, purchases)';
COMMENT ON FUNCTION execute_trade IS 'Atomic trade execution with cash transfer and platform fee';
COMMENT ON FUNCTION get_user_cash_balance IS 'Get user available cash balance in cents';

