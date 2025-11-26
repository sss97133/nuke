-- Complete Auto-Buy System Migration
-- This migration ensures all tables, functions, and policies are created
-- Run this in Supabase Dashboard SQL Editor

-- ============================================================================
-- STEP 1: Ensure watchlist table has all auto-buy columns
-- ============================================================================

DO $$ 
BEGIN
  -- Add auto-buy columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_enabled') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_enabled BOOLEAN DEFAULT false;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_max_price') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_max_price NUMERIC(10, 2);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_type') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_type TEXT CHECK (auto_buy_type IN ('bid', 'buy_now', 'reserve_met'));
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_bid_increment') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_bid_increment NUMERIC(10, 2) DEFAULT 100;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_max_bid') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_max_bid NUMERIC(10, 2);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_requires_confirmation') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_requires_confirmation BOOLEAN DEFAULT true;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_payment_method_id') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_payment_method_id UUID;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'price_drop_target') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN price_drop_target NUMERIC(10, 2);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'price_drop_monitoring') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN price_drop_monitoring BOOLEAN DEFAULT false;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vehicle_watchlist' AND column_name = 'auto_buy_executions') THEN
    ALTER TABLE vehicle_watchlist ADD COLUMN auto_buy_executions INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create auto_buy_executions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS auto_buy_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES vehicle_watchlist(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  external_listing_id UUID REFERENCES external_listings(id) ON DELETE SET NULL,
  
  -- Execution details
  execution_type TEXT NOT NULL CHECK (execution_type IN ('bid_placed', 'buy_now', 'reserve_met_bid', 'price_drop_buy')),
  target_price NUMERIC(10, 2) NOT NULL,
  executed_price NUMERIC(10, 2) NOT NULL,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
  requires_confirmation BOOLEAN DEFAULT true,
  user_confirmed BOOLEAN DEFAULT false,
  user_confirmed_at TIMESTAMPTZ,
  
  -- Execution results
  bid_id UUID,
  transaction_id UUID,
  payment_intent_id TEXT,
  error_message TEXT,
  
  -- Timing
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Metadata
  execution_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_auto_buy_watchlist ON auto_buy_executions(watchlist_id, status);
CREATE INDEX IF NOT EXISTS idx_auto_buy_vehicle ON auto_buy_executions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_auto_buy_pending ON auto_buy_executions(status, triggered_at) WHERE status IN ('pending', 'executing');

-- ============================================================================
-- STEP 3: Create price_monitoring table
-- ============================================================================

CREATE TABLE IF NOT EXISTS price_monitoring (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  external_listing_id UUID REFERENCES external_listings(id) ON DELETE CASCADE,
  
  -- Price tracking
  current_price NUMERIC(10, 2) NOT NULL,
  previous_price NUMERIC(10, 2),
  price_change_percent NUMERIC(5, 2),
  
  -- Monitoring settings
  monitor_type TEXT NOT NULL CHECK (monitor_type IN ('watchlist_auto_buy', 'price_drop', 'ending_soon')),
  target_price NUMERIC(10, 2),
  watchlist_id UUID REFERENCES vehicle_watchlist(id) ON DELETE CASCADE,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  triggered BOOLEAN DEFAULT false,
  triggered_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, external_listing_id, watchlist_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_price_monitor_vehicle ON price_monitoring(vehicle_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_price_monitor_watchlist ON price_monitoring(watchlist_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_price_monitor_target ON price_monitoring(target_price, current_price, is_active) WHERE is_active = true AND target_price IS NOT NULL;

-- ============================================================================
-- STEP 4: Create functions
-- ============================================================================

-- Function to check if auto-buy should be triggered
CREATE OR REPLACE FUNCTION check_auto_buy_trigger(
  p_vehicle_id UUID,
  p_current_price NUMERIC,
  p_listing_type TEXT DEFAULT 'auction'
)
RETURNS TABLE(
  watchlist_id UUID,
  user_id UUID,
  execution_type TEXT,
  target_price NUMERIC,
  max_price NUMERIC
) AS $$
DECLARE
  v_watchlist RECORD;
  v_vehicle RECORD;
  v_external_listing RECORD;
BEGIN
  -- Get vehicle details
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Get external listing if exists
  SELECT * INTO v_external_listing 
  FROM external_listings 
  WHERE vehicle_id = p_vehicle_id 
    AND listing_status = 'active'
  LIMIT 1;
  
  -- Check all active watchlists with auto-buy enabled
  FOR v_watchlist IN
    SELECT * FROM vehicle_watchlist 
    WHERE is_active = true 
      AND auto_buy_enabled = true
      AND (
        (price_drop_monitoring = true AND price_drop_target IS NOT NULL AND p_current_price <= price_drop_target) OR
        (auto_buy_max_price IS NOT NULL AND p_current_price <= auto_buy_max_price)
      )
  LOOP
    -- Check if vehicle matches watchlist criteria
    DECLARE
      v_matches BOOLEAN := false;
    BEGIN
      -- Year check
      IF (v_watchlist.year_min IS NULL OR v_vehicle.year >= v_watchlist.year_min) AND
         (v_watchlist.year_max IS NULL OR v_vehicle.year <= v_watchlist.year_max) THEN
        v_matches := true;
      ELSE
        CONTINUE;
      END IF;
      
      -- Make check
      IF v_watchlist.make IS NOT NULL AND LOWER(v_vehicle.make) != LOWER(v_watchlist.make) THEN
        CONTINUE;
      END IF;
      
      -- Model check
      IF v_watchlist.model IS NOT NULL AND 
         NOT (LOWER(v_vehicle.model) LIKE LOWER('%' || v_watchlist.model || '%') OR
              LOWER(v_watchlist.model) LIKE LOWER('%' || v_vehicle.model || '%')) THEN
        CONTINUE;
      END IF;
      
      -- VIN check
      IF v_watchlist.must_have_vin AND (v_vehicle.vin IS NULL OR v_vehicle.vin = '' OR v_vehicle.vin LIKE 'VIVA-%') THEN
        CONTINUE;
      END IF;
      
      -- Price check
      IF v_watchlist.auto_buy_max_price IS NOT NULL AND p_current_price > v_watchlist.auto_buy_max_price THEN
        CONTINUE;
      END IF;
      
      -- Determine execution type
      DECLARE
        v_exec_type TEXT;
        v_target_price NUMERIC;
      BEGIN
        IF v_watchlist.price_drop_monitoring AND v_watchlist.price_drop_target IS NOT NULL AND p_current_price <= v_watchlist.price_drop_target THEN
          v_exec_type := 'price_drop_buy';
          v_target_price := v_watchlist.price_drop_target;
        ELSIF p_listing_type = 'buy_now' AND v_watchlist.auto_buy_type = 'buy_now' THEN
          v_exec_type := 'buy_now';
          v_target_price := p_current_price;
        ELSIF p_listing_type = 'reserve_met' AND v_watchlist.auto_buy_type = 'reserve_met' THEN
          v_exec_type := 'reserve_met_bid';
          v_target_price := p_current_price;
        ELSIF p_listing_type = 'auction' AND v_watchlist.auto_buy_type = 'bid' THEN
          v_exec_type := 'bid_placed';
          v_target_price := LEAST(p_current_price + v_watchlist.auto_buy_bid_increment, v_watchlist.auto_buy_max_bid);
        ELSE
          CONTINUE;
        END IF;
        
        -- Return trigger details
        watchlist_id := v_watchlist.id;
        user_id := v_watchlist.user_id;
        execution_type := v_exec_type;
        target_price := v_target_price;
        max_price := v_watchlist.auto_buy_max_price;
        RETURN NEXT;
      END;
    END;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to execute auto-buy
CREATE OR REPLACE FUNCTION execute_auto_buy(
  p_watchlist_id UUID,
  p_vehicle_id UUID,
  p_external_listing_id UUID,
  p_execution_type TEXT,
  p_target_price NUMERIC,
  p_user_confirmed BOOLEAN DEFAULT false
)
RETURNS UUID AS $$
DECLARE
  v_watchlist RECORD;
  v_execution_id UUID;
  v_requires_confirmation BOOLEAN;
BEGIN
  -- Get watchlist
  SELECT * INTO v_watchlist FROM vehicle_watchlist WHERE id = p_watchlist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Watchlist not found';
  END IF;
  
  v_requires_confirmation := v_watchlist.auto_buy_requires_confirmation;
  
  -- If requires confirmation and not confirmed, create pending execution
  IF v_requires_confirmation AND NOT p_user_confirmed THEN
    INSERT INTO auto_buy_executions (
      watchlist_id,
      vehicle_id,
      external_listing_id,
      execution_type,
      target_price,
      executed_price,
      status,
      requires_confirmation
    ) VALUES (
      p_watchlist_id,
      p_vehicle_id,
      p_external_listing_id,
      p_execution_type,
      p_target_price,
      p_target_price,
      'pending',
      true
    ) RETURNING id INTO v_execution_id;
    
    RETURN v_execution_id;
  END IF;
  
  -- Execute immediately
  INSERT INTO auto_buy_executions (
    watchlist_id,
    vehicle_id,
    external_listing_id,
    execution_type,
    target_price,
    executed_price,
    status,
    requires_confirmation,
    user_confirmed,
    user_confirmed_at
  ) VALUES (
    p_watchlist_id,
    p_vehicle_id,
    p_external_listing_id,
    p_execution_type,
    p_target_price,
    p_target_price,
    'executing',
    v_requires_confirmation,
    p_user_confirmed,
    CASE WHEN p_user_confirmed THEN NOW() ELSE NULL END
  ) RETURNING id INTO v_execution_id;
  
  -- Update watchlist stats
  UPDATE vehicle_watchlist
  SET auto_buy_executions = auto_buy_executions + 1
  WHERE id = p_watchlist_id;
  
  RETURN v_execution_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_auto_buy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_auto_buy_executions_updated_at ON auto_buy_executions;
CREATE TRIGGER update_auto_buy_executions_updated_at
  BEFORE UPDATE ON auto_buy_executions
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_buy_updated_at();

DROP TRIGGER IF EXISTS update_price_monitoring_updated_at ON price_monitoring;
CREATE TRIGGER update_price_monitoring_updated_at
  BEFORE UPDATE ON price_monitoring
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_buy_updated_at();

-- ============================================================================
-- STEP 5: RLS Policies
-- ============================================================================

ALTER TABLE auto_buy_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_monitoring ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own executions" ON auto_buy_executions;
DROP POLICY IF EXISTS "Users can confirm their own executions" ON auto_buy_executions;
DROP POLICY IF EXISTS "Service role can manage executions" ON auto_buy_executions;
DROP POLICY IF EXISTS "Users can view their own price monitoring" ON price_monitoring;

-- Create policies
CREATE POLICY "Users can view their own executions" ON auto_buy_executions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_watchlist 
      WHERE id = auto_buy_executions.watchlist_id 
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can confirm their own executions" ON auto_buy_executions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM vehicle_watchlist 
      WHERE id = auto_buy_executions.watchlist_id 
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage executions" ON auto_buy_executions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Users can view their own price monitoring" ON price_monitoring
  FOR SELECT USING (
    watchlist_id IS NULL OR
    EXISTS (
      SELECT 1 FROM vehicle_watchlist 
      WHERE id = price_monitoring.watchlist_id 
      AND user_id = auth.uid()
    )
  );

-- ============================================================================
-- STEP 6: Comments
-- ============================================================================

COMMENT ON TABLE auto_buy_executions IS 'Records of automatic buy order executions. Like limit orders in stock market - executes when price/criteria are met.';
COMMENT ON TABLE price_monitoring IS 'Tracks price changes for vehicles to trigger auto-buy when price drops to target.';
COMMENT ON FUNCTION check_auto_buy_trigger IS 'Checks if current vehicle price triggers any auto-buy orders. Returns watchlists that should execute.';
COMMENT ON FUNCTION execute_auto_buy IS 'Executes an auto-buy order. Creates execution record and handles confirmation if required.';

-- ============================================================================
-- Migration Complete!
-- ============================================================================

