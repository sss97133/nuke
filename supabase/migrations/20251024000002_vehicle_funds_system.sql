-- =====================================================
-- VEHICLE FUNDS (ETF) SYSTEM
-- =====================================================
-- Date: October 24, 2025
-- Allows creation of funds (collections of vehicles)
-- Users can invest in diversified portfolios
-- =====================================================

-- Fund Definition
CREATE TABLE IF NOT EXISTS vehicle_funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Fund Identity
  name TEXT NOT NULL,
  symbol TEXT UNIQUE NOT NULL CHECK (LENGTH(symbol) >= 2 AND LENGTH(symbol) <= 6),
  description TEXT,
  
  -- Fund Rules
  fund_rules JSONB DEFAULT '{}'::jsonb,
  -- Example rules: {"require_documentation": true, "min_photos": 20, "livestream_required": false}
  
  -- Management
  created_by UUID NOT NULL REFERENCES auth.users(id),
  manager_id UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'liquidating', 'liquidated')),
  
  -- Share Structure
  total_shares INTEGER NOT NULL DEFAULT 1000000 CHECK (total_shares > 0),
  shares_outstanding INTEGER DEFAULT 0 CHECK (shares_outstanding >= 0 AND shares_outstanding <= total_shares),
  initial_share_price_cents INTEGER NOT NULL CHECK (initial_share_price_cents > 0),
  current_nav_cents BIGINT DEFAULT 0, -- Net Asset Value
  
  -- Performance
  total_vehicles INTEGER DEFAULT 0,
  inception_date TIMESTAMPTZ DEFAULT NOW(),
  last_rebalance_date TIMESTAMPTZ,
  
  -- Visibility
  is_public BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_funds_symbol ON vehicle_funds(symbol);
CREATE INDEX IF NOT EXISTS idx_vehicle_funds_creator ON vehicle_funds(created_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_funds_manager ON vehicle_funds(manager_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_funds_status ON vehicle_funds(status);

-- Fund Holdings (Which vehicles are in the fund)
CREATE TABLE IF NOT EXISTS fund_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES vehicle_funds(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Ownership
  ownership_percentage DECIMAL(5,2) NOT NULL CHECK (ownership_percentage > 0 AND ownership_percentage <= 100),
  acquisition_price_cents BIGINT NOT NULL CHECK (acquisition_price_cents >= 0),
  current_value_cents BIGINT,
  
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed')),
  
  -- Dates
  added_at TIMESTAMPTZ DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  
  -- Compliance
  complies_with_rules BOOLEAN DEFAULT true,
  last_compliance_check TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  UNIQUE(fund_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_fund_vehicles_fund ON fund_vehicles(fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_vehicles_vehicle ON fund_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fund_vehicles_status ON fund_vehicles(status);

-- Fund Share Holdings (Who owns shares in the fund)
CREATE TABLE IF NOT EXISTS fund_share_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES vehicle_funds(id) ON DELETE CASCADE,
  holder_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Holdings
  shares_owned INTEGER NOT NULL CHECK (shares_owned > 0),
  average_purchase_price_cents INTEGER NOT NULL CHECK (average_purchase_price_cents >= 0),
  total_invested_cents BIGINT NOT NULL CHECK (total_invested_cents >= 0),
  
  -- Performance
  current_value_cents BIGINT,
  unrealized_gain_loss_cents BIGINT,
  unrealized_gain_loss_pct DECIMAL(10,2),
  
  -- Dividends
  total_dividends_received_cents BIGINT DEFAULT 0,
  
  -- Timestamps
  first_purchase_at TIMESTAMPTZ DEFAULT NOW(),
  last_purchase_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(fund_id, holder_id)
);

CREATE INDEX IF NOT EXISTS idx_fund_share_holdings_fund ON fund_share_holdings(fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_share_holdings_holder ON fund_share_holdings(holder_id);

-- Fund Trading Orders
CREATE TABLE IF NOT EXISTS fund_market_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES vehicle_funds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Order Details
  order_type TEXT NOT NULL CHECK (order_type IN ('buy', 'sell')),
  order_side TEXT NOT NULL CHECK (order_side IN ('market', 'limit')),
  shares INTEGER NOT NULL CHECK (shares > 0),
  limit_price_cents INTEGER CHECK (limit_price_cents IS NULL OR limit_price_cents > 0),
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'filled', 'cancelled', 'expired')),
  shares_filled INTEGER DEFAULT 0 CHECK (shares_filled >= 0 AND shares_filled <= shares),
  
  -- Execution
  average_fill_price_cents INTEGER,
  total_cost_cents BIGINT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  filled_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_fund_market_orders_fund ON fund_market_orders(fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_market_orders_user ON fund_market_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_fund_market_orders_status ON fund_market_orders(status);
CREATE INDEX IF NOT EXISTS idx_fund_market_orders_pending ON fund_market_orders(status) WHERE status = 'pending';

-- Fund Trades (Executed)
CREATE TABLE IF NOT EXISTS fund_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES vehicle_funds(id) ON DELETE CASCADE,
  
  -- Parties
  buyer_id UUID NOT NULL REFERENCES auth.users(id),
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  buy_order_id UUID REFERENCES fund_market_orders(id),
  sell_order_id UUID REFERENCES fund_market_orders(id),
  
  -- Trade Details
  shares INTEGER NOT NULL CHECK (shares > 0),
  price_per_share_cents INTEGER NOT NULL CHECK (price_per_share_cents > 0),
  total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents > 0),
  
  -- Fees
  buyer_fee_cents INTEGER DEFAULT 0,
  seller_fee_cents INTEGER DEFAULT 0,
  
  -- Timestamp
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fund_trades_fund ON fund_trades(fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_trades_buyer ON fund_trades(buyer_id);
CREATE INDEX IF NOT EXISTS idx_fund_trades_seller ON fund_trades(seller_id);
CREATE INDEX IF NOT EXISTS idx_fund_trades_executed ON fund_trades(executed_at DESC);

-- Fund Rebalancing History
CREATE TABLE IF NOT EXISTS fund_rebalance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES vehicle_funds(id) ON DELETE CASCADE,
  
  -- Rebalance Details
  rebalance_type TEXT NOT NULL CHECK (rebalance_type IN ('add_vehicle', 'remove_vehicle', 'adjust_weights', 'liquidate')),
  reason TEXT,
  
  -- Before/After
  vehicles_before JSONB,
  vehicles_after JSONB,
  nav_before_cents BIGINT,
  nav_after_cents BIGINT,
  
  -- Performed By
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fund_rebalance_events_fund ON fund_rebalance_events(fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_rebalance_events_date ON fund_rebalance_events(performed_at DESC);

-- =====================================================
-- RLS POLICIES
-- =====================================================

DO $$
BEGIN
  -- Vehicle Funds policies
  IF to_regclass('public.vehicle_funds') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.vehicle_funds ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_funds'
        AND policyname = 'Anyone can view public funds'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view public funds" ON public.vehicle_funds';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view public funds" ON public.vehicle_funds FOR SELECT USING (is_public = true OR auth.uid() = created_by OR auth.uid() = manager_id)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_funds'
        AND policyname = 'Authenticated users can create funds'
    ) THEN
      EXECUTE 'DROP POLICY "Authenticated users can create funds" ON public.vehicle_funds';
    END IF;
    EXECUTE 'CREATE POLICY "Authenticated users can create funds" ON public.vehicle_funds FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_funds'
        AND policyname = 'Fund managers can update their funds'
    ) THEN
      EXECUTE 'DROP POLICY "Fund managers can update their funds" ON public.vehicle_funds';
    END IF;
    EXECUTE 'CREATE POLICY "Fund managers can update their funds" ON public.vehicle_funds FOR UPDATE TO authenticated USING (auth.uid() = created_by OR auth.uid() = manager_id)';
  ELSE
    RAISE NOTICE 'Skipping RLS for vehicle_funds: table does not exist.';
  END IF;

  -- Fund Vehicles policies
  IF to_regclass('public.fund_vehicles') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.fund_vehicles ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_vehicles'
        AND policyname = 'View fund vehicles if fund is viewable'
    ) THEN
      EXECUTE 'DROP POLICY "View fund vehicles if fund is viewable" ON public.fund_vehicles';
    END IF;
    EXECUTE $policy$
      CREATE POLICY "View fund vehicles if fund is viewable"
        ON public.fund_vehicles FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM public.vehicle_funds vf
            WHERE vf.id = fund_vehicles.fund_id
              AND (vf.is_public = true OR auth.uid() = vf.created_by OR auth.uid() = vf.manager_id)
          )
        )
    $policy$;

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_vehicles'
        AND policyname = 'Fund managers can manage fund vehicles'
    ) THEN
      EXECUTE 'DROP POLICY "Fund managers can manage fund vehicles" ON public.fund_vehicles';
    END IF;
    EXECUTE $policy$
      CREATE POLICY "Fund managers can manage fund vehicles"
        ON public.fund_vehicles FOR ALL TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.vehicle_funds vf
            WHERE vf.id = fund_vehicles.fund_id
              AND (auth.uid() = vf.created_by OR auth.uid() = vf.manager_id)
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.vehicle_funds vf
            WHERE vf.id = fund_vehicles.fund_id
              AND (auth.uid() = vf.created_by OR auth.uid() = vf.manager_id)
          )
        )
    $policy$;
  ELSE
    RAISE NOTICE 'Skipping RLS for fund_vehicles: table does not exist.';
  END IF;

  -- Fund Share Holdings policies
  IF to_regclass('public.fund_share_holdings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.fund_share_holdings ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_share_holdings'
        AND policyname = 'Users can view their own fund holdings'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view their own fund holdings" ON public.fund_share_holdings';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view their own fund holdings" ON public.fund_share_holdings FOR SELECT TO authenticated USING (auth.uid() = holder_id)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_share_holdings'
        AND policyname = 'System can manage fund holdings'
    ) THEN
      EXECUTE 'DROP POLICY "System can manage fund holdings" ON public.fund_share_holdings';
    END IF;
    EXECUTE 'CREATE POLICY "System can manage fund holdings" ON public.fund_share_holdings FOR ALL TO authenticated USING (auth.uid() = holder_id OR auth.role() = ''service_role'') WITH CHECK (auth.uid() = holder_id OR auth.role() = ''service_role'')';
  ELSE
    RAISE NOTICE 'Skipping RLS for fund_share_holdings: table does not exist.';
  END IF;

    -- Fund Market Orders policies
  IF to_regclass('public.fund_market_orders') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.fund_market_orders ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_market_orders'
        AND policyname = 'Users can view their own orders'
    ) THEN
      EXECUTE 'DROP POLICY "Users can view their own orders" ON public.fund_market_orders';
    END IF;
    EXECUTE 'CREATE POLICY "Users can view their own orders" ON public.fund_market_orders FOR SELECT TO authenticated USING (auth.uid() = user_id)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_market_orders'
        AND policyname = 'Users can create orders'
    ) THEN
      EXECUTE 'DROP POLICY "Users can create orders" ON public.fund_market_orders';
    END IF;
    EXECUTE 'CREATE POLICY "Users can create orders" ON public.fund_market_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_market_orders'
        AND policyname = 'Users can cancel their orders'
    ) THEN
      EXECUTE 'DROP POLICY "Users can cancel their orders" ON public.fund_market_orders';
    END IF;
    EXECUTE 'CREATE POLICY "Users can cancel their orders" ON public.fund_market_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  ELSE
    RAISE NOTICE 'Skipping RLS for fund_market_orders: table does not exist.';
  END IF;

  -- Fund Trades policies
  IF to_regclass('public.fund_trades') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.fund_trades ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_trades'
        AND policyname = 'Anyone can view fund trades'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view fund trades" ON public.fund_trades';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view fund trades" ON public.fund_trades FOR SELECT USING (true)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_trades'
        AND policyname = 'System can insert trades'
    ) THEN
      EXECUTE 'DROP POLICY "System can insert trades" ON public.fund_trades';
    END IF;
    EXECUTE 'CREATE POLICY "System can insert trades" ON public.fund_trades FOR INSERT WITH CHECK (auth.role() = ''service_role'')';
  ELSE
    RAISE NOTICE 'Skipping RLS for fund_trades: table does not exist.';
  END IF;

  -- Fund Rebalance Events policies
  IF to_regclass('public.fund_rebalance_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.fund_rebalance_events ENABLE ROW LEVEL SECURITY';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_rebalance_events'
        AND policyname = 'Anyone can view rebalance events'
    ) THEN
      EXECUTE 'DROP POLICY "Anyone can view rebalance events" ON public.fund_rebalance_events';
    END IF;
    EXECUTE 'CREATE POLICY "Anyone can view rebalance events" ON public.fund_rebalance_events FOR SELECT USING (true)';

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'fund_rebalance_events'
        AND policyname = 'Fund managers can log rebalance events'
    ) THEN
      EXECUTE 'DROP POLICY "Fund managers can log rebalance events" ON public.fund_rebalance_events';
    END IF;
    EXECUTE $policy$
      CREATE POLICY "Fund managers can log rebalance events"
        ON public.fund_rebalance_events FOR INSERT TO authenticated
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.vehicle_funds vf
            WHERE vf.id = fund_rebalance_events.fund_id
              AND (auth.uid() = vf.created_by OR auth.uid() = vf.manager_id)
          )
        )
    $policy$;
  ELSE
    RAISE NOTICE 'Skipping RLS for fund_rebalance_events: table does not exist.';
  END IF;
END
$$;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Calculate Fund NAV (Net Asset Value)
CREATE OR REPLACE FUNCTION calculate_fund_nav(p_fund_id UUID)
RETURNS BIGINT AS $$
DECLARE
  total_value BIGINT := 0;
BEGIN
  -- Sum current value of all active vehicles in fund
  SELECT COALESCE(SUM(current_value_cents), 0)
  INTO total_value
  FROM fund_vehicles
  WHERE fund_id = p_fund_id
  AND status = 'active';
  
  -- Update fund NAV
  UPDATE vehicle_funds
  SET 
    current_nav_cents = total_value,
    updated_at = NOW()
  WHERE id = p_fund_id;
  
  RETURN total_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Update Fund Share Prices
CREATE OR REPLACE FUNCTION update_fund_share_prices(p_fund_id UUID)
RETURNS VOID AS $$
DECLARE
  nav BIGINT;
  shares_out INTEGER;
  price_per_share INTEGER;
BEGIN
  -- Get current NAV and shares
  SELECT current_nav_cents, shares_outstanding
  INTO nav, shares_out
  FROM vehicle_funds
  WHERE id = p_fund_id;
  
  IF shares_out > 0 THEN
    price_per_share := nav / shares_out;
    
    -- Update all holdings
    UPDATE fund_share_holdings
    SET
      current_value_cents = shares_owned * price_per_share,
      unrealized_gain_loss_cents = (shares_owned * price_per_share) - total_invested_cents,
      unrealized_gain_loss_pct = CASE
        WHEN total_invested_cents > 0 THEN
          (((shares_owned * price_per_share)::DECIMAL - total_invested_cents) / total_invested_cents) * 100
        ELSE 0
      END,
      updated_at = NOW()
    WHERE fund_id = p_fund_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Success message
DO $$
BEGIN
  IF to_regclass('public.vehicle_funds') IS NOT NULL THEN
    RAISE NOTICE 'Vehicle Funds (ETF) system ready.';
  ELSE
    RAISE NOTICE 'Vehicle Funds (ETF) system skipped (vehicle_funds table missing).';
  END IF;
END
$$;

