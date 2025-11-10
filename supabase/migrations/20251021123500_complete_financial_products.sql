-- =====================================================
-- COMPLETE FINANCIAL PRODUCTS SUITE
-- =====================================================
-- Adds: Bonds, Profit-Sharing Stakes, Whole Vehicle Sales
-- Date: October 21, 2025

-- =====================================================
-- PRODUCT 2: VEHICLE BONDS (Fixed Income)
-- =====================================================

-- Bond Issuance
CREATE TABLE IF NOT EXISTS vehicle_bonds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  issuer_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Bond Terms
  principal_amount_cents BIGINT NOT NULL CHECK (principal_amount_cents > 0),
  interest_rate_pct DECIMAL(5,2) NOT NULL CHECK (interest_rate_pct >= 0 AND interest_rate_pct <= 50),
  term_months INTEGER NOT NULL CHECK (term_months > 0),
  interest_payment_schedule TEXT DEFAULT 'at_maturity' CHECK (interest_payment_schedule IN 
    ('at_maturity', 'quarterly', 'monthly', 'annually')),
  
  -- Issuance
  amount_sold_cents BIGINT DEFAULT 0,
  amount_remaining_cents BIGINT,
  min_investment_cents BIGINT DEFAULT 100, -- $1 minimum
  max_investment_cents BIGINT,
  
  -- Status
  status TEXT DEFAULT 'open' CHECK (status IN 
    ('open', 'funded', 'active', 'matured', 'defaulted', 'cancelled')),
  
  -- Dates
  issue_date TIMESTAMPTZ DEFAULT NOW(),
  funding_deadline TIMESTAMPTZ,
  maturity_date TIMESTAMPTZ,
  matured_at TIMESTAMPTZ,
  
  -- Metadata
  description TEXT,
  use_of_funds TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_bonds_vehicle ON vehicle_bonds(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_bonds_issuer ON vehicle_bonds(issuer_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_bonds_status ON vehicle_bonds(status);

-- Bond Holdings (who owns bonds)
CREATE TABLE IF NOT EXISTS bond_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bond_id UUID NOT NULL REFERENCES vehicle_bonds(id) ON DELETE CASCADE,
  holder_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Investment
  principal_cents BIGINT NOT NULL CHECK (principal_cents > 0),
  purchase_date TIMESTAMPTZ DEFAULT NOW(),
  purchase_price_cents BIGINT, -- May differ from principal if secondary market
  
  -- Interest Tracking
  accrued_interest_cents BIGINT DEFAULT 0,
  interest_paid_cents BIGINT DEFAULT 0,
  
  -- Returns
  total_return_cents BIGINT, -- Principal + all interest
  
  -- Status
  redeemed BOOLEAN DEFAULT FALSE,
  redeemed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bond_holdings_bond ON bond_holdings(bond_id);
CREATE INDEX IF NOT EXISTS idx_bond_holdings_holder ON bond_holdings(holder_id);
CREATE INDEX IF NOT EXISTS idx_bond_holdings_redeemed ON bond_holdings(redeemed);

-- =====================================================
-- PRODUCT 3: PROFIT-SHARING STAKES
-- =====================================================

-- Funding Rounds (vehicle raises money for restoration)
CREATE TABLE IF NOT EXISTS vehicle_funding_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  builder_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Funding Terms
  target_amount_cents BIGINT NOT NULL CHECK (target_amount_cents > 0),
  raised_amount_cents BIGINT DEFAULT 0,
  min_stake_cents BIGINT DEFAULT 300, -- $3 minimum
  max_stake_cents BIGINT, -- Optional cap per staker
  
  -- Profit Share
  profit_share_pct DECIMAL(5,2) NOT NULL CHECK (profit_share_pct > 0 AND profit_share_pct <= 100),
  builder_investment_cents BIGINT DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'fundraising' CHECK (status IN 
    ('fundraising', 'funded', 'building', 'completed', 'failed', 'cancelled')),
  
  -- Timeline
  funding_deadline TIMESTAMPTZ,
  funded_at TIMESTAMPTZ,
  
  -- Exit / Sale
  sale_price_cents BIGINT,
  total_cost_basis_cents BIGINT,
  net_profit_cents BIGINT,
  staker_profit_pool_cents BIGINT,
  sold_at TIMESTAMPTZ,
  distributed_at TIMESTAMPTZ,
  
  -- Metadata
  description TEXT,
  use_of_funds TEXT,
  estimated_completion_date DATE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_rounds_vehicle ON vehicle_funding_rounds(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_funding_rounds_builder ON vehicle_funding_rounds(builder_id);
CREATE INDEX IF NOT EXISTS idx_funding_rounds_status ON vehicle_funding_rounds(status);

-- Individual Stakes
CREATE TABLE IF NOT EXISTS profit_share_stakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_round_id UUID NOT NULL REFERENCES vehicle_funding_rounds(id) ON DELETE CASCADE,
  staker_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Stake Amount
  amount_staked_cents BIGINT NOT NULL CHECK (amount_staked_cents > 0),
  percentage_of_pool DECIMAL(10,6), -- Your stake / total raised
  staked_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Returns (calculated at sale)
  profit_share_cents BIGINT DEFAULT 0,
  total_return_cents BIGINT,
  return_pct DECIMAL(10,2),
  
  -- Current Estimated Value (updated periodically)
  estimated_vehicle_value_cents BIGINT,
  estimated_return_cents BIGINT,
  last_valuation_at TIMESTAMPTZ,
  
  -- Status
  cashed_out BOOLEAN DEFAULT FALSE,
  cashed_out_at TIMESTAMPTZ,
  
  -- Message
  message TEXT,
  is_anonymous BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profit_stakes_round ON profit_share_stakes(funding_round_id);
CREATE INDEX IF NOT EXISTS idx_profit_stakes_staker ON profit_share_stakes(staker_id);
CREATE INDEX IF NOT EXISTS idx_profit_stakes_cashed_out ON profit_share_stakes(cashed_out);

-- =====================================================
-- PRODUCT 4: WHOLE VEHICLE SALES (Traditional)
-- =====================================================

-- Vehicle Listings (for sale as complete unit)
CREATE TABLE IF NOT EXISTS vehicle_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Pricing
  list_price_cents BIGINT NOT NULL,
  reserve_price_cents BIGINT,
  accept_offers BOOLEAN DEFAULT TRUE,
  
  -- Sale Type
  sale_type TEXT DEFAULT 'auction' CHECK (sale_type IN 
    ('auction', 'fixed_price', 'best_offer', 'hybrid')),
  
  -- Auction Config (if auction)
  auction_start_time TIMESTAMPTZ,
  auction_end_time TIMESTAMPTZ,
  current_high_bid_cents BIGINT,
  bid_count INTEGER DEFAULT 0,
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN 
    ('draft', 'active', 'sold', 'cancelled', 'expired')),
  
  -- Sale Completion
  final_price_cents BIGINT,
  buyer_id UUID REFERENCES auth.users(id),
  sold_at TIMESTAMPTZ,
  
  -- Metadata
  description TEXT,
  terms_conditions TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, status) -- One active listing per vehicle
);

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_vehicle ON vehicle_listings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_seller ON vehicle_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_status ON vehicle_listings(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_sale_type ON vehicle_listings(sale_type);

-- Offers (for best_offer listings)
CREATE TABLE IF NOT EXISTS vehicle_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Offer Details
  offer_amount_cents BIGINT NOT NULL CHECK (offer_amount_cents > 0),
  message TEXT,
  
  -- Financing
  financing_type TEXT CHECK (financing_type IN ('cash', 'financed', 'trade', 'mixed')),
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN 
    ('pending', 'accepted', 'rejected', 'countered', 'expired', 'withdrawn')),
  
  -- Response
  seller_response TEXT,
  counter_offer_cents BIGINT,
  responded_at TIMESTAMPTZ,
  
  -- Expiration
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_offers_listing ON vehicle_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_offers_buyer ON vehicle_offers(buyer_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_offers_status ON vehicle_offers(status);

-- =====================================================
-- RLS POLICIES
-- =====================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_bonds'
  ) THEN
    EXECUTE 'ALTER TABLE vehicle_bonds ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_bonds'
        AND policyname = 'Anyone can view bonds'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view bonds" ON vehicle_bonds';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view bonds" ON vehicle_bonds FOR SELECT USING (true)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for vehicle_bonds: table does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'bond_holdings'
  ) THEN
    EXECUTE 'ALTER TABLE bond_holdings ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'bond_holdings'
        AND policyname = 'Users can view own bond holdings'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view own bond holdings" ON bond_holdings';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view own bond holdings" ON bond_holdings FOR SELECT USING (auth.uid() = holder_id)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for bond_holdings: table does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_funding_rounds'
  ) THEN
    EXECUTE 'ALTER TABLE vehicle_funding_rounds ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_funding_rounds'
        AND policyname = 'Anyone can view funding rounds'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view funding rounds" ON vehicle_funding_rounds';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view funding rounds" ON vehicle_funding_rounds FOR SELECT USING (true)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for vehicle_funding_rounds: table does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'profit_share_stakes'
  ) THEN
    EXECUTE 'ALTER TABLE profit_share_stakes ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profit_share_stakes'
        AND policyname = 'Users can view own stakes'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view own stakes" ON profit_share_stakes';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view own stakes" ON profit_share_stakes FOR SELECT USING (auth.uid() = staker_id)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for profit_share_stakes: table does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_listings'
  ) THEN
    EXECUTE 'ALTER TABLE vehicle_listings ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_listings'
        AND policyname = 'Anyone can view listings'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view listings" ON vehicle_listings';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view listings" ON vehicle_listings FOR SELECT USING (true)';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for vehicle_listings: table does not exist.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_offers'
  ) THEN
    EXECUTE 'ALTER TABLE vehicle_offers ENABLE ROW LEVEL SECURITY';
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_offers'
        AND policyname = 'Users can view relevant offers'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view relevant offers" ON vehicle_offers';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view relevant offers" ON vehicle_offers FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() IN (SELECT seller_id FROM vehicle_listings WHERE id = listing_id))';
  ELSE
    RAISE NOTICE 'Skipping RLS setup for vehicle_offers: table does not exist.';
  END IF;
END
$$;

-- =====================================================
-- BOND FUNCTIONS
-- =====================================================

-- Buy bond
CREATE OR REPLACE FUNCTION buy_bond(
  p_bond_id UUID,
  p_holder_id UUID,
  p_amount_cents BIGINT
)
RETURNS UUID AS $$
DECLARE
  bond RECORD;
  holding_id UUID;
  available_cash BIGINT;
BEGIN
  -- Get bond details
  SELECT * INTO bond FROM vehicle_bonds WHERE id = p_bond_id;
  
  IF bond.status != 'open' AND bond.status != 'funded' THEN
    RAISE EXCEPTION 'Bond is not available for purchase';
  END IF;
  
  IF p_amount_cents < bond.min_investment_cents THEN
    RAISE EXCEPTION 'Amount below minimum investment';
  END IF;
  
  -- Check user has cash
  available_cash := get_user_cash_balance(p_holder_id);
  IF available_cash < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient cash balance';
  END IF;
  
  -- Deduct cash
  PERFORM deduct_cash_from_user(p_holder_id, p_amount_cents, 'trade_buy', p_bond_id);
  
  -- Create holding
  INSERT INTO bond_holdings (bond_id, holder_id, principal_cents, purchase_price_cents)
  VALUES (p_bond_id, p_holder_id, p_amount_cents, p_amount_cents)
  RETURNING id INTO holding_id;
  
  -- Update bond
  UPDATE vehicle_bonds
  SET 
    amount_sold_cents = amount_sold_cents + p_amount_cents,
    amount_remaining_cents = principal_amount_cents - amount_sold_cents - p_amount_cents,
    status = CASE 
      WHEN amount_sold_cents + p_amount_cents >= principal_amount_cents THEN 'funded'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = p_bond_id;
  
  RETURN holding_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Calculate accrued interest
CREATE OR REPLACE FUNCTION calculate_bond_interest(
  p_holding_id UUID
)
RETURNS BIGINT AS $$
DECLARE
  holding RECORD;
  bond RECORD;
  days_held INTEGER;
  annual_interest BIGINT;
  accrued BIGINT;
BEGIN
  SELECT * INTO holding FROM bond_holdings WHERE id = p_holding_id;
  SELECT * INTO bond FROM vehicle_bonds WHERE id = holding.bond_id;
  
  -- Calculate days held
  days_held := EXTRACT(EPOCH FROM (NOW() - holding.purchase_date)) / 86400;
  
  -- Annual interest
  annual_interest := FLOOR(holding.principal_cents * bond.interest_rate_pct / 100);
  
  -- Accrued interest (prorated)
  accrued := FLOOR(annual_interest * days_held / 365.0);
  
  RETURN accrued;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PRODUCT 3: PROFIT-SHARING STAKES
-- =====================================================

-- Create funding round
CREATE OR REPLACE FUNCTION create_funding_round(
  p_vehicle_id UUID,
  p_builder_id UUID,
  p_target_cents BIGINT,
  p_profit_share_pct DECIMAL,
  p_description TEXT,
  p_deadline TIMESTAMPTZ
)
RETURNS UUID AS $$
DECLARE
  round_id UUID;
BEGIN
  INSERT INTO vehicle_funding_rounds (
    vehicle_id,
    builder_id,
    target_amount_cents,
    profit_share_pct,
    description,
    funding_deadline
  )
  VALUES (
    p_vehicle_id,
    p_builder_id,
    p_target_cents,
    p_profit_share_pct,
    p_description,
    p_deadline
  )
  RETURNING id INTO round_id;
  
  RETURN round_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Stake on funding round
CREATE OR REPLACE FUNCTION stake_on_vehicle(
  p_round_id UUID,
  p_staker_id UUID,
  p_amount_cents BIGINT,
  p_message TEXT DEFAULT NULL,
  p_anonymous BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
  round RECORD;
  stake_id UUID;
  available_cash BIGINT;
  pool_percentage DECIMAL;
BEGIN
  -- Get round details
  SELECT * INTO round FROM vehicle_funding_rounds WHERE id = p_round_id;
  
  IF round.status != 'fundraising' THEN
    RAISE EXCEPTION 'Funding round is not open';
  END IF;
  
  IF p_amount_cents < round.min_stake_cents THEN
    RAISE EXCEPTION 'Amount below minimum stake';
  END IF;
  
  IF round.raised_amount_cents + p_amount_cents > round.target_amount_cents THEN
    RAISE EXCEPTION 'Would exceed funding target';
  END IF;
  
  -- Check user has cash
  available_cash := get_user_cash_balance(p_staker_id);
  IF available_cash < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient cash balance';
  END IF;
  
  -- Deduct cash
  PERFORM deduct_cash_from_user(p_staker_id, p_amount_cents, 'trade_buy', p_round_id);
  
  -- Calculate percentage of pool
  pool_percentage := p_amount_cents::DECIMAL / (round.raised_amount_cents + p_amount_cents);
  
  -- Create stake
  INSERT INTO profit_share_stakes (
    funding_round_id,
    staker_id,
    amount_staked_cents,
    percentage_of_pool,
    message,
    is_anonymous
  )
  VALUES (
    p_round_id,
    p_staker_id,
    p_amount_cents,
    pool_percentage,
    p_message,
    p_anonymous
  )
  RETURNING id INTO stake_id;
  
  -- Update funding round
  UPDATE vehicle_funding_rounds
  SET 
    raised_amount_cents = raised_amount_cents + p_amount_cents,
    status = CASE 
      WHEN raised_amount_cents + p_amount_cents >= target_amount_cents THEN 'funded'
      ELSE status
    END,
    funded_at = CASE
      WHEN raised_amount_cents + p_amount_cents >= target_amount_cents THEN NOW()
      ELSE funded_at
    END,
    updated_at = NOW()
  WHERE id = p_round_id;
  
  -- Recalculate all stake percentages
  UPDATE profit_share_stakes
  SET percentage_of_pool = amount_staked_cents::DECIMAL / 
    (SELECT raised_amount_cents FROM vehicle_funding_rounds WHERE id = p_round_id)
  WHERE funding_round_id = p_round_id;
  
  RETURN stake_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Distribute sale proceeds
CREATE OR REPLACE FUNCTION distribute_sale_proceeds(
  p_round_id UUID,
  p_sale_price_cents BIGINT
)
RETURNS VOID AS $$
DECLARE
  round RECORD;
  net_profit BIGINT;
  staker_pool BIGINT;
  stake RECORD;
  stake_profit BIGINT;
BEGIN
  -- Get funding round
  SELECT * INTO round FROM vehicle_funding_rounds WHERE id = p_round_id;
  
  -- Calculate net profit
  net_profit := p_sale_price_cents - round.total_cost_basis_cents;
  
  IF net_profit <= 0 THEN
    -- Loss or break-even: return principal only
    FOR stake IN SELECT * FROM profit_share_stakes WHERE funding_round_id = p_round_id
    LOOP
      UPDATE profit_share_stakes
      SET 
        profit_share_cents = 0,
        total_return_cents = amount_staked_cents,
        return_pct = 0
      WHERE id = stake.id;
      
      -- Return principal to staker
      PERFORM add_cash_to_user(stake.staker_id, stake.amount_staked_cents, NULL, 
        jsonb_build_object('type', 'stake_return', 'round_id', p_round_id));
    END LOOP;
  ELSE
    -- Profit: distribute according to profit_share_pct
    staker_pool := FLOOR(net_profit * round.profit_share_pct / 100);
    
    FOR stake IN SELECT * FROM profit_share_stakes WHERE funding_round_id = p_round_id
    LOOP
      -- Each staker gets proportional share of profit pool
      stake_profit := FLOOR(staker_pool * stake.percentage_of_pool);
      
      UPDATE profit_share_stakes
      SET
        profit_share_cents = stake_profit,
        total_return_cents = amount_staked_cents + stake_profit,
        return_pct = (stake_profit::DECIMAL / amount_staked_cents) * 100,
        cashed_out = TRUE,
        cashed_out_at = NOW()
      WHERE id = stake.id;
      
      -- Pay out to staker (principal + profit)
      PERFORM add_cash_to_user(stake.staker_id, stake.amount_staked_cents + stake_profit, NULL,
        jsonb_build_object(
          'type', 'stake_profit',
          'round_id', p_round_id,
          'principal', stake.amount_staked_cents,
          'profit', stake_profit
        ));
    END LOOP;
  END IF;
  
  -- Update funding round
  UPDATE vehicle_funding_rounds
  SET
    sale_price_cents = p_sale_price_cents,
    net_profit_cents = net_profit,
    staker_profit_pool_cents = staker_pool,
    status = 'completed',
    sold_at = NOW(),
    distributed_at = NOW()
  WHERE id = p_round_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE vehicle_bonds IS 'Fixed-income bonds: lend money, earn interest';
COMMENT ON TABLE bond_holdings IS 'Individual bond ownership records';
COMMENT ON TABLE vehicle_funding_rounds IS 'Profit-sharing funding rounds for restoration';
COMMENT ON TABLE profit_share_stakes IS 'Stakes with profit-sharing on vehicle sale';
COMMENT ON TABLE vehicle_listings IS 'Whole vehicle listings for sale';
COMMENT ON TABLE vehicle_offers IS 'Purchase offers on listed vehicles';

COMMENT ON FUNCTION buy_bond IS 'Purchase vehicle bond with cash balance';
COMMENT ON FUNCTION stake_on_vehicle IS 'Stake cash on vehicle restoration with profit sharing';
COMMENT ON FUNCTION distribute_sale_proceeds IS 'Distribute sale profits to stakers';

