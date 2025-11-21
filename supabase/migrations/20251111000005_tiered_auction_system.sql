-- Tiered Auction System
-- Quality-based tiers for sellers and buyers
-- Enables no-reserve auctions, multi-vehicle lots, and ultra-fast auctions

-- =====================================================
-- SELLER TIER SYSTEM
-- =====================================================

CREATE TABLE IF NOT EXISTS seller_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Tier level
  tier TEXT NOT NULL CHECK (tier IN ('C', 'B', 'A', 'S', 'SS', 'SSS')),
  
  -- Quality metrics
  total_sales INTEGER DEFAULT 0,
  successful_sales INTEGER DEFAULT 0,
  total_revenue_cents BIGINT DEFAULT 0,
  average_rating DECIMAL(3,2), -- 0.00 to 5.00
  completion_rate DECIMAL(5,2), -- 0.00 to 100.00 (sales completed / listings created)
  no_reserve_qualification BOOLEAN DEFAULT FALSE,
  
  -- Vehicle quality metrics
  average_vehicle_quality_score INTEGER, -- 0-100
  documentation_score INTEGER, -- 0-100 (images, receipts, history)
  condition_accuracy_score INTEGER, -- 0-100 (described vs actual)
  
  -- Timestamps
  tier_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(seller_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_seller_tiers_tier ON seller_tiers(tier);
CREATE INDEX IF NOT EXISTS idx_seller_tiers_no_reserve ON seller_tiers(no_reserve_qualification) 
  WHERE no_reserve_qualification = TRUE;

-- =====================================================
-- BUYER TIER SYSTEM
-- =====================================================

CREATE TABLE IF NOT EXISTS buyer_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Tier level
  tier TEXT NOT NULL CHECK (tier IN ('C', 'B', 'A', 'S', 'SS', 'SSS')),
  
  -- Reliability metrics
  total_bids INTEGER DEFAULT 0,
  winning_bids INTEGER DEFAULT 0,
  payment_reliability DECIMAL(5,2), -- 0.00 to 100.00 (payments completed / auctions won)
  average_response_time_hours DECIMAL(5,2), -- Time to complete payment after win
  no_show_count INTEGER DEFAULT 0,
  
  -- Financial metrics
  total_spent_cents BIGINT DEFAULT 0,
  average_bid_amount_cents BIGINT,
  highest_bid_cents BIGINT,
  
  -- Trust metrics
  disputes INTEGER DEFAULT 0,
  positive_feedback INTEGER DEFAULT 0,
  negative_feedback INTEGER DEFAULT 0,
  
  -- Timestamps
  tier_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(buyer_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_buyer_tiers_tier ON buyer_tiers(tier);
CREATE INDEX IF NOT EXISTS idx_buyer_tiers_payment_reliability ON buyer_tiers(payment_reliability DESC);

-- =====================================================
-- MULTI-VEHICLE AUCTION LOTS
-- =====================================================

CREATE TABLE IF NOT EXISTS auction_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Lot details
  lot_name TEXT NOT NULL,
  lot_type TEXT NOT NULL CHECK (lot_type IN (
    'single_vehicle',    -- Traditional single vehicle
    'multi_vehicle',     -- Multiple vehicles, sequential
    'simultaneous',      -- Multiple vehicles, all end at same time
    'rapid_fire'         -- Ultra-fast, one after another
  )),
  
  -- Tier requirements
  minimum_seller_tier TEXT CHECK (minimum_seller_tier IN ('C', 'B', 'A', 'S', 'SS', 'SSS')),
  minimum_buyer_tier TEXT CHECK (minimum_buyer_tier IN ('C', 'B', 'A', 'S', 'SS', 'SSS')),
  
  -- Auction configuration
  auction_duration_minutes INTEGER NOT NULL, -- 3 minutes for SSS tier
  sniping_protection_minutes INTEGER DEFAULT 0, -- No sniping protection for ultra-fast
  allow_reserve BOOLEAN DEFAULT TRUE,
  no_reserve_only BOOLEAN DEFAULT FALSE, -- SSS tier requirement
  
  -- Scheduling
  scheduled_start_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled',    -- Scheduled for future
    'active',       -- Currently running
    'completed',    -- All vehicles sold
    'cancelled'
  )),
  
  -- Metadata
  theme TEXT, -- "Classic Trucks", "Muscle Cars", etc.
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lot vehicles (many-to-many)
CREATE TABLE IF NOT EXISTS auction_lot_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES auction_lots(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
  
  -- Sequence in lot
  sequence_number INTEGER NOT NULL,
  
  -- Timing (for rapid-fire)
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Waiting to start
    'active',       -- Currently bidding
    'sold',         -- Sold
    'no_sale',      -- No sale (reserve not met)
    'skipped'       -- Skipped (seller cancelled)
  )),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lot_id, sequence_number),
  UNIQUE(listing_id) -- One listing can only be in one lot
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_auction_lots_scheduled ON auction_lot_vehicles(lot_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_auction_lots_status ON auction_lots(status, scheduled_start_time);

-- =====================================================
-- TIER CALCULATION FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_seller_tier(p_seller_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_metrics RECORD;
  v_score INTEGER := 0;
  v_tier TEXT := 'C';
BEGIN
  -- Get seller metrics
  SELECT 
    COUNT(*) FILTER (WHERE status = 'sold') as successful_sales,
    COUNT(*) as total_listings,
    COALESCE(AVG(rating), 0) as avg_rating,
    COALESCE(SUM(sold_price_cents), 0) as total_revenue
  INTO v_metrics
  FROM vehicle_listings
  WHERE seller_id = p_seller_id;
  
  -- Calculate score
  -- Sales volume (0-30 points)
  IF v_metrics.successful_sales >= 100 THEN
    v_score := v_score + 30;
  ELSIF v_metrics.successful_sales >= 50 THEN
    v_score := v_score + 25;
  ELSIF v_metrics.successful_sales >= 20 THEN
    v_score := v_score + 20;
  ELSIF v_metrics.successful_sales >= 10 THEN
    v_score := v_score + 15;
  ELSIF v_metrics.successful_sales >= 5 THEN
    v_score := v_score + 10;
  ELSIF v_metrics.successful_sales >= 1 THEN
    v_score := v_score + 5;
  END IF;
  
  -- Completion rate (0-25 points)
  IF v_metrics.total_listings > 0 THEN
    DECLARE
      completion_rate DECIMAL := (v_metrics.successful_sales::DECIMAL / v_metrics.total_listings) * 100;
    BEGIN
      IF completion_rate >= 90 THEN
        v_score := v_score + 25;
      ELSIF completion_rate >= 75 THEN
        v_score := v_score + 20;
      ELSIF completion_rate >= 60 THEN
        v_score := v_score + 15;
      ELSIF completion_rate >= 50 THEN
        v_score := v_score + 10;
      END IF;
    END;
  END IF;
  
  -- Revenue (0-25 points)
  IF v_metrics.total_revenue >= 100000000 THEN -- $1M+
    v_score := v_score + 25;
  ELSIF v_metrics.total_revenue >= 50000000 THEN -- $500K+
    v_score := v_score + 20;
  ELSIF v_metrics.total_revenue >= 10000000 THEN -- $100K+
    v_score := v_score + 15;
  ELSIF v_metrics.total_revenue >= 1000000 THEN -- $10K+
    v_score := v_score + 10;
  END IF;
  
  -- Rating (0-20 points)
  IF v_metrics.avg_rating >= 4.8 THEN
    v_score := v_score + 20;
  ELSIF v_metrics.avg_rating >= 4.5 THEN
    v_score := v_score + 15;
  ELSIF v_metrics.avg_rating >= 4.0 THEN
    v_score := v_score + 10;
  ELSIF v_metrics.avg_rating >= 3.5 THEN
    v_score := v_score + 5;
  END IF;
  
  -- Determine tier
  IF v_score >= 90 THEN
    v_tier := 'SSS';
  ELSIF v_score >= 75 THEN
    v_tier := 'SS';
  ELSIF v_score >= 60 THEN
    v_tier := 'S';
  ELSIF v_score >= 45 THEN
    v_tier := 'A';
  ELSIF v_score >= 30 THEN
    v_tier := 'B';
  ELSE
    v_tier := 'C';
  END IF;
  
  RETURN v_tier;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION calculate_buyer_tier(p_buyer_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_metrics RECORD;
  v_score INTEGER := 0;
  v_tier TEXT := 'C';
BEGIN
  -- Get buyer metrics
  SELECT 
    COUNT(*) FILTER (WHERE is_winning = TRUE) as winning_bids,
    COUNT(*) as total_bids,
    COALESCE(SUM(CASE WHEN is_winning THEN displayed_bid_cents ELSE 0 END), 0) as total_spent,
    COALESCE(AVG(CASE WHEN is_winning THEN displayed_bid_cents ELSE NULL END), 0) as avg_winning_bid
  INTO v_metrics
  FROM auction_bids
  WHERE bidder_id = p_buyer_id;
  
  -- Calculate score
  -- Bidding activity (0-30 points)
  IF v_metrics.total_bids >= 100 THEN
    v_score := v_score + 30;
  ELSIF v_metrics.total_bids >= 50 THEN
    v_score := v_score + 25;
  ELSIF v_metrics.total_bids >= 20 THEN
    v_score := v_score + 20;
  ELSIF v_metrics.total_bids >= 10 THEN
    v_score := v_score + 15;
  ELSIF v_metrics.total_bids >= 5 THEN
    v_score := v_score + 10;
  ELSIF v_metrics.total_bids >= 1 THEN
    v_score := v_score + 5;
  END IF;
  
  -- Win rate (0-25 points)
  IF v_metrics.total_bids > 0 THEN
    DECLARE
      win_rate DECIMAL := (v_metrics.winning_bids::DECIMAL / v_metrics.total_bids) * 100;
    BEGIN
      IF win_rate >= 20 THEN
        v_score := v_score + 25;
      ELSIF win_rate >= 15 THEN
        v_score := v_score + 20;
      ELSIF win_rate >= 10 THEN
        v_score := v_score + 15;
      ELSIF win_rate >= 5 THEN
        v_score := v_score + 10;
      END IF;
    END;
  END IF;
  
  -- Spending (0-25 points)
  IF v_metrics.total_spent >= 100000000 THEN -- $1M+
    v_score := v_score + 25;
  ELSIF v_metrics.total_spent >= 50000000 THEN -- $500K+
    v_score := v_score + 20;
  ELSIF v_metrics.total_spent >= 10000000 THEN -- $100K+
    v_score := v_score + 15;
  ELSIF v_metrics.total_spent >= 1000000 THEN -- $10K+
    v_score := v_score + 10;
  END IF;
  
  -- Payment reliability (0-20 points)
  -- This would come from buyer_tiers table or transaction data
  -- For now, assume good if they have wins
  IF v_metrics.winning_bids >= 10 THEN
    v_score := v_score + 20;
  ELSIF v_metrics.winning_bids >= 5 THEN
    v_score := v_score + 15;
  ELSIF v_metrics.winning_bids >= 1 THEN
    v_score := v_score + 10;
  END IF;
  
  -- Determine tier
  IF v_score >= 90 THEN
    v_tier := 'SSS';
  ELSIF v_score >= 75 THEN
    v_tier := 'SS';
  ELSIF v_score >= 60 THEN
    v_tier := 'S';
  ELSIF v_score >= 45 THEN
    v_tier := 'A';
  ELSIF v_score >= 30 THEN
    v_tier := 'B';
  ELSE
    v_tier := 'C';
  END IF;
  
  RETURN v_tier;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- NO-RESERVE QUALIFICATION
-- =====================================================

CREATE OR REPLACE FUNCTION qualify_no_reserve_auction(p_seller_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_tier TEXT;
  v_metrics RECORD;
BEGIN
  -- Get seller tier
  SELECT tier INTO v_tier
  FROM seller_tiers
  WHERE seller_id = p_seller_id;
  
  -- Must be at least S tier
  IF v_tier NOT IN ('S', 'SS', 'SSS') THEN
    RETURN FALSE;
  END IF;
  
  -- Get quality metrics
  SELECT 
    COUNT(*) FILTER (WHERE status = 'sold') as successful_sales,
    COUNT(*) as total_listings
  INTO v_metrics
  FROM vehicle_listings
  WHERE seller_id = p_seller_id;
  
  -- Must have at least 10 successful sales
  IF v_metrics.successful_sales < 10 THEN
    RETURN FALSE;
  END IF;
  
  -- Must have 80%+ completion rate
  IF v_metrics.total_listings > 0 THEN
    IF (v_metrics.successful_sales::DECIMAL / v_metrics.total_listings) < 0.80 THEN
      RETURN FALSE;
    END IF;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- RAPID-FIRE AUCTION PROCESSING
-- =====================================================

CREATE OR REPLACE FUNCTION process_rapid_fire_lot(p_lot_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_lot RECORD;
  v_vehicle RECORD;
  v_current_time TIMESTAMPTZ := NOW();
  v_next_start TIMESTAMPTZ;
BEGIN
  -- Get lot details
  SELECT * INTO v_lot
  FROM auction_lots
  WHERE id = p_lot_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lot not found');
  END IF;
  
  -- Find next vehicle to start
  SELECT * INTO v_vehicle
  FROM auction_lot_vehicles
  WHERE lot_id = p_lot_id
    AND status = 'pending'
  ORDER BY sequence_number
  LIMIT 1;
  
  IF NOT FOUND THEN
    -- All vehicles processed
    UPDATE auction_lots
    SET status = 'completed'
    WHERE id = p_lot_id;
    
    RETURN jsonb_build_object('success', true, 'status', 'completed');
  END IF;
  
  -- Start this vehicle's auction
  v_next_start := v_current_time;
  
  UPDATE auction_lot_vehicles
  SET
    status = 'active',
    start_time = v_next_start,
    end_time = v_next_start + (v_lot.auction_duration_minutes || ' minutes')::INTERVAL
  WHERE id = v_vehicle.id;
  
  -- Update listing to active
  UPDATE vehicle_listings
  SET
    status = 'active',
    auction_start_time = v_next_start,
    auction_end_time = v_next_start + (v_lot.auction_duration_minutes || ' minutes')::INTERVAL
  WHERE id = v_vehicle.listing_id;
  
  -- Update lot status
  UPDATE auction_lots
  SET status = 'active'
  WHERE id = p_lot_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'vehicle_started', v_vehicle.id,
    'end_time', v_next_start + (v_lot.auction_duration_minutes || ' minutes')::INTERVAL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

GRANT EXECUTE ON FUNCTION calculate_seller_tier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_buyer_tier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION qualify_no_reserve_auction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION process_rapid_fire_lot(UUID) TO authenticated;

COMMENT ON TABLE seller_tiers IS 'Quality-based tier system for sellers';
COMMENT ON TABLE buyer_tiers IS 'Reliability-based tier system for buyers';
COMMENT ON TABLE auction_lots IS 'Multi-vehicle auction lots (rapid-fire, simultaneous, etc.)';
COMMENT ON FUNCTION process_rapid_fire_lot IS 'Processes rapid-fire auction lots (3-minute auctions, one after another)';

