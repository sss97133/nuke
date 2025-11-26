-- Vehicle Watchlist System
-- Like stock market buy orders - users set criteria and get notified when matching vehicles become available

-- ============================================================================
-- VEHICLE WATCHLIST TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Search criteria (like buy order parameters)
  year_min INTEGER,
  year_max INTEGER,
  make TEXT,
  model TEXT,
  trim TEXT,
  series TEXT,
  
  -- Price criteria
  max_price NUMERIC(10, 2),
  min_price NUMERIC(10, 2),
  
  -- Condition/preferences
  condition_preference TEXT CHECK (condition_preference IN ('any', 'excellent', 'good', 'fair', 'project')),
  must_have_vin BOOLEAN DEFAULT false,
  
  -- Source preferences
  preferred_sources TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['bat', 'nzero', 'external']
  preferred_sellers TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['viva', 'other_dealers']
  
  -- Notification settings
  notify_on_new_listing BOOLEAN DEFAULT true,
  notify_on_price_drop BOOLEAN DEFAULT false,
  notify_on_ending_soon BOOLEAN DEFAULT false, -- 24 hours before auction ends
  notification_channels TEXT[] DEFAULT ARRAY['in_app']::TEXT[], -- ['in_app', 'email', 'push']
  
  -- AUTO-BUY SETTINGS (Like limit orders in stock market)
  auto_buy_enabled BOOLEAN DEFAULT false,
  auto_buy_max_price NUMERIC(10, 2), -- Maximum price to auto-buy at
  auto_buy_type TEXT CHECK (auto_buy_type IN ('bid', 'buy_now', 'reserve_met')), -- When to execute
  auto_buy_bid_increment NUMERIC(10, 2) DEFAULT 100, -- Bid increment for auctions
  auto_buy_max_bid NUMERIC(10, 2), -- Maximum bid amount (for auctions)
  auto_buy_requires_confirmation BOOLEAN DEFAULT true, -- Require user confirmation before executing
  auto_buy_payment_method_id UUID, -- Stored payment method for auto-buy
  
  -- Price drop monitoring (like limit buy orders)
  price_drop_target NUMERIC(10, 2), -- Auto-buy when price drops to this amount
  price_drop_monitoring BOOLEAN DEFAULT false, -- Enable price drop monitoring
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_matched_at TIMESTAMPTZ,
  match_count INTEGER DEFAULT 0,
  auto_buy_executions INTEGER DEFAULT 0, -- Count of successful auto-buys
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_year_range CHECK (year_max IS NULL OR year_min IS NULL OR year_max >= year_min),
  CONSTRAINT valid_price_range CHECK (max_price IS NULL OR min_price IS NULL OR max_price >= min_price)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON vehicle_watchlist(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_watchlist_criteria ON vehicle_watchlist(make, model, year_min, year_max) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_watchlist_sources ON vehicle_watchlist USING GIN(preferred_sources) WHERE is_active = true;

-- ============================================================================
-- WATCHLIST MATCHES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS watchlist_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES vehicle_watchlist(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  external_listing_id UUID REFERENCES external_listings(id) ON DELETE SET NULL,
  
  -- Match details
  match_type TEXT NOT NULL CHECK (match_type IN ('new_listing', 'price_drop', 'ending_soon', 'criteria_match', 'auto_buy_triggered')),
  match_score INTEGER DEFAULT 0, -- 0-100, how well it matches
  match_reasons TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['year_match', 'make_match', 'price_in_range']
  
  -- Notification status
  notified_at TIMESTAMPTZ,
  notification_sent BOOLEAN DEFAULT false,
  user_viewed BOOLEAN DEFAULT false,
  user_viewed_at TIMESTAMPTZ,
  
  -- Auto-buy execution
  auto_buy_triggered BOOLEAN DEFAULT false,
  auto_buy_executed BOOLEAN DEFAULT false,
  auto_buy_executed_at TIMESTAMPTZ,
  auto_buy_result JSONB, -- {success: true, bid_id: '...', transaction_id: '...', error: '...'}
  auto_buy_price NUMERIC(10, 2), -- Price at which auto-buy was executed
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(watchlist_id, vehicle_id, match_type)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_matches_watchlist ON watchlist_matches(watchlist_id, notified_at);
CREATE INDEX IF NOT EXISTS idx_watchlist_matches_vehicle ON watchlist_matches(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_matches_unnotified ON watchlist_matches(watchlist_id, notification_sent) WHERE notification_sent = false;

-- ============================================================================
-- BAT SELLER MONITORING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS bat_seller_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  seller_username TEXT NOT NULL, -- BAT seller username (e.g., 'VivaLasVegasAutos')
  seller_url TEXT, -- BAT seller profile URL
  
  -- Monitoring settings
  is_active BOOLEAN DEFAULT true,
  check_frequency_hours INTEGER DEFAULT 6, -- How often to check for new listings
  last_checked_at TIMESTAMPTZ,
  last_listing_found_at TIMESTAMPTZ,
  
  -- Stats
  total_listings_found INTEGER DEFAULT 0,
  listings_processed INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, seller_username)
);

CREATE INDEX IF NOT EXISTS idx_bat_monitor_org ON bat_seller_monitors(organization_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bat_monitor_check ON bat_seller_monitors(last_checked_at) WHERE is_active = true;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to check if a vehicle matches watchlist criteria
CREATE OR REPLACE FUNCTION check_watchlist_match(
  p_vehicle_id UUID,
  p_listing_type TEXT DEFAULT 'new_listing'
)
RETURNS TABLE(
  watchlist_id UUID,
  user_id UUID,
  match_score INTEGER,
  match_reasons TEXT[]
) AS $$
DECLARE
  v_vehicle RECORD;
  v_watchlist RECORD;
  v_score INTEGER;
  v_reasons TEXT[];
BEGIN
  -- Get vehicle details
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Check all active watchlists
  FOR v_watchlist IN
    SELECT * FROM vehicle_watchlist WHERE is_active = true
  LOOP
    v_score := 0;
    v_reasons := ARRAY[]::TEXT[];
    
    -- Check year range
    IF (v_watchlist.year_min IS NULL OR v_vehicle.year >= v_watchlist.year_min) AND
       (v_watchlist.year_max IS NULL OR v_vehicle.year <= v_watchlist.year_max) THEN
      v_score := v_score + 30;
      v_reasons := array_append(v_reasons, 'year_match');
    END IF;
    
    -- Check make
    IF v_watchlist.make IS NULL OR LOWER(v_vehicle.make) = LOWER(v_watchlist.make) THEN
      v_score := v_score + 30;
      v_reasons := array_append(v_reasons, 'make_match');
    END IF;
    
    -- Check model
    IF v_watchlist.model IS NULL OR 
       LOWER(v_vehicle.model) LIKE LOWER('%' || v_watchlist.model || '%') OR
       LOWER(v_watchlist.model) LIKE LOWER('%' || v_vehicle.model || '%') THEN
      v_score := v_score + 20;
      v_reasons := array_append(v_reasons, 'model_match');
    END IF;
    
    -- Check VIN requirement
    IF v_watchlist.must_have_vin AND (v_vehicle.vin IS NULL OR v_vehicle.vin = '' OR v_vehicle.vin LIKE 'VIVA-%') THEN
      -- Skip this watchlist if VIN required but missing
      CONTINUE;
    END IF;
    
    -- Check price range (if vehicle has asking price or current bid)
    IF v_watchlist.max_price IS NOT NULL OR v_watchlist.min_price IS NOT NULL THEN
      DECLARE
        v_price NUMERIC;
      BEGIN
        -- Get price from vehicle or external listing
        SELECT COALESCE(
          (SELECT current_bid FROM external_listings WHERE vehicle_id = p_vehicle_id AND listing_status = 'active' LIMIT 1),
          v_vehicle.asking_price,
          v_vehicle.current_bid
        ) INTO v_price;
        
        IF v_price IS NOT NULL THEN
          IF (v_watchlist.min_price IS NULL OR v_price >= v_watchlist.min_price) AND
             (v_watchlist.max_price IS NULL OR v_price <= v_watchlist.max_price) THEN
            v_score := v_score + 20;
            v_reasons := array_append(v_reasons, 'price_in_range');
          ELSE
            -- Price out of range, skip
            CONTINUE;
          END IF;
        END IF;
      END;
    END IF;
    
    -- Check source preferences
    IF array_length(v_watchlist.preferred_sources, 1) > 0 THEN
      DECLARE
        v_source TEXT;
        v_matches_source BOOLEAN := false;
      BEGIN
        v_source := CASE
          WHEN v_vehicle.profile_origin = 'bat_import' THEN 'bat'
          WHEN v_vehicle.profile_origin = 'dropbox_import' THEN 'nzero'
          ELSE 'external'
        END;
        
        IF v_source = ANY(v_watchlist.preferred_sources) THEN
          v_score := v_score + 10;
          v_reasons := array_append(v_reasons, 'source_match');
          v_matches_source := true;
        END IF;
        
        -- If source preferences specified and doesn't match, skip
        IF NOT v_matches_source THEN
          CONTINUE;
        END IF;
      END;
    END IF;
    
    -- Only return matches with score >= 50 (at least year + make)
    IF v_score >= 50 THEN
      watchlist_id := v_watchlist.id;
      user_id := v_watchlist.user_id;
      match_score := v_score;
      match_reasons := v_reasons;
      RETURN NEXT;
    END IF;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Function to process new BAT listing and match to watchlists
CREATE OR REPLACE FUNCTION process_new_bat_listing(
  p_vehicle_id UUID,
  p_external_listing_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_match RECORD;
  v_matches_created INTEGER := 0;
BEGIN
  -- Find matching watchlists
  FOR v_match IN
    SELECT * FROM check_watchlist_match(p_vehicle_id, 'new_listing')
  LOOP
    -- Create match record
    INSERT INTO watchlist_matches (
      watchlist_id,
      vehicle_id,
      external_listing_id,
      match_type,
      match_score,
      match_reasons
    ) VALUES (
      v_match.watchlist_id,
      p_vehicle_id,
      p_external_listing_id,
      'new_listing',
      v_match.match_score,
      v_match.match_reasons
    )
    ON CONFLICT (watchlist_id, vehicle_id, match_type) DO NOTHING;
    
    -- Update watchlist stats
    UPDATE vehicle_watchlist
    SET 
      match_count = match_count + 1,
      last_matched_at = NOW()
    WHERE id = v_match.watchlist_id;
    
    v_matches_created := v_matches_created + 1;
  END LOOP;
  
  RETURN v_matches_created;
END;
$$ LANGUAGE plpgsql;

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_watchlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_watchlist_updated_at
  BEFORE UPDATE ON vehicle_watchlist
  FOR EACH ROW
  EXECUTE FUNCTION update_watchlist_updated_at();

CREATE TRIGGER update_bat_monitor_updated_at
  BEFORE UPDATE ON bat_seller_monitors
  FOR EACH ROW
  EXECUTE FUNCTION update_watchlist_updated_at();

-- RLS Policies
ALTER TABLE vehicle_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bat_seller_monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own watchlists" ON vehicle_watchlist
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own watchlists" ON vehicle_watchlist
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own watchlists" ON vehicle_watchlist
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own watchlists" ON vehicle_watchlist
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own matches" ON watchlist_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_watchlist 
      WHERE id = watchlist_matches.watchlist_id 
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage matches" ON watchlist_matches
  FOR ALL USING (auth.role() = 'service_role');

-- Comments
COMMENT ON TABLE vehicle_watchlist IS 'User watchlists for vehicles - like buy orders in stock market. Users set criteria and get notified when matching vehicles become available.';
COMMENT ON TABLE watchlist_matches IS 'Records of vehicles that matched user watchlist criteria. Used for notifications and tracking.';
COMMENT ON TABLE bat_seller_monitors IS 'Tracks BAT seller profiles to monitor for new listings (e.g., Viva! Las Vegas Autos).';

