-- Follow as Pre-Investment System
-- Tracks following as a precursor to investing, showing hypothetical ROI

-- ============================================================================
-- EXTEND USER_SUBSCRIPTIONS
-- ============================================================================

-- Add follow tracking columns if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_subscriptions' 
    AND column_name = 'followed_at'
  ) THEN
    ALTER TABLE user_subscriptions 
    ADD COLUMN followed_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_subscriptions' 
    AND column_name = 'price_at_follow'
  ) THEN
    ALTER TABLE user_subscriptions 
    ADD COLUMN price_at_follow NUMERIC(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_subscriptions' 
    AND column_name = 'invested_at'
  ) THEN
    ALTER TABLE user_subscriptions 
    ADD COLUMN invested_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_subscriptions' 
    AND column_name = 'investment_amount'
  ) THEN
    ALTER TABLE user_subscriptions 
    ADD COLUMN investment_amount NUMERIC(10, 2);
  END IF;
END $$;

-- ============================================================================
-- FOLLOW ROI TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS follow_roi_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Follow metrics
  followed_at TIMESTAMPTZ NOT NULL,
  price_at_follow NUMERIC(10, 2) NOT NULL,
  price_source TEXT, -- 'asking_price', 'current_bid', 'current_value', 'sale_price'
  
  -- Current metrics (updated periodically)
  current_price NUMERIC(10, 2),
  current_price_source TEXT,
  current_value NUMERIC(10, 2),
  
  -- Calculated ROI
  hypothetical_roi_pct NUMERIC(5, 2), -- e.g., 15.50 for 15.5%
  hypothetical_gain NUMERIC(10, 2), -- Dollar amount
  days_following INTEGER,
  
  -- Investment status
  has_invested BOOLEAN DEFAULT false,
  invested_at TIMESTAMPTZ,
  investment_type TEXT, -- 'stake', 'bond', 'whole_vehicle', 'contract'
  investment_id UUID, -- References profit_share_stakes, bond_holdings, etc.
  investment_amount NUMERIC(10, 2),
  actual_roi_pct NUMERIC(5, 2),
  actual_gain NUMERIC(10, 2),
  
  -- Metadata
  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one tracking record per subscription
  UNIQUE(subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_roi_vehicle ON follow_roi_tracking(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_follow_roi_user ON follow_roi_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_roi_subscription ON follow_roi_tracking(subscription_id);
CREATE INDEX IF NOT EXISTS idx_follow_roi_has_invested ON follow_roi_tracking(has_invested);
CREATE INDEX IF NOT EXISTS idx_follow_roi_roi_pct ON follow_roi_tracking(hypothetical_roi_pct DESC NULLS LAST);

-- ============================================================================
-- FUNCTION: Get Current Vehicle Price
-- ============================================================================

CREATE OR REPLACE FUNCTION get_vehicle_current_price(p_vehicle_id UUID)
RETURNS TABLE(
  price NUMERIC(10, 2),
  price_source TEXT
) AS $$
DECLARE
  v_vehicle RECORD;
  v_external_listing RECORD;
BEGIN
  -- Get vehicle
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Priority 1: Sale price (if sold)
  IF v_vehicle.sale_price IS NOT NULL AND v_vehicle.sale_price > 0 THEN
    RETURN QUERY SELECT v_vehicle.sale_price, 'sale_price';
  END IF;
  
  -- Priority 2: Active auction bid
  SELECT * INTO v_external_listing
  FROM external_listings
  WHERE vehicle_id = p_vehicle_id
    AND listing_status IN ('active', 'live', 'pending')
    AND current_bid IS NOT NULL
    AND current_bid > 0
  ORDER BY updated_at DESC
  LIMIT 1;
  
  IF FOUND AND v_external_listing.current_bid IS NOT NULL THEN
    RETURN QUERY SELECT v_external_listing.current_bid, 'current_bid';
  END IF;
  
  -- Priority 3: Asking price
  IF v_vehicle.asking_price IS NOT NULL AND v_vehicle.asking_price > 0 THEN
    RETURN QUERY SELECT v_vehicle.asking_price, 'asking_price';
  END IF;
  
  -- Priority 4: Current value
  IF v_vehicle.current_value IS NOT NULL AND v_vehicle.current_value > 0 THEN
    RETURN QUERY SELECT v_vehicle.current_value, 'current_value';
  END IF;
  
  -- No price available
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Calculate Follow ROI
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_follow_roi(p_subscription_id UUID)
RETURNS TABLE(
  hypothetical_roi_pct NUMERIC(5, 2),
  hypothetical_gain NUMERIC(10, 2),
  days_following INTEGER,
  current_price NUMERIC(10, 2),
  price_at_follow NUMERIC(10, 2)
) AS $$
DECLARE
  v_subscription RECORD;
  v_price_result RECORD;
  v_roi_pct NUMERIC(5, 2);
  v_gain NUMERIC(10, 2);
  v_days INTEGER;
BEGIN
  -- Get subscription
  SELECT * INTO v_subscription
  FROM user_subscriptions
  WHERE id = p_subscription_id
    AND subscription_type = 'vehicle_status_change';
  
  IF NOT FOUND OR v_subscription.price_at_follow IS NULL THEN
    RETURN;
  END IF;
  
  -- Get current price
  SELECT * INTO v_price_result
  FROM get_vehicle_current_price(v_subscription.target_id::UUID);
  
  IF NOT FOUND OR v_price_result.price IS NULL THEN
    RETURN;
  END IF;
  
  -- Calculate ROI
  v_gain := v_price_result.price - v_subscription.price_at_follow;
  v_roi_pct := (v_gain / v_subscription.price_at_follow) * 100;
  v_days := EXTRACT(EPOCH FROM (NOW() - v_subscription.followed_at)) / 86400;
  
  RETURN QUERY SELECT
    ROUND(v_roi_pct, 2),
    ROUND(v_gain, 2),
    v_days::INTEGER,
    v_price_result.price,
    v_subscription.price_at_follow;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update Follow ROI Tracking
-- ============================================================================

CREATE OR REPLACE FUNCTION update_follow_roi_tracking(p_subscription_id UUID)
RETURNS void AS $$
DECLARE
  v_subscription RECORD;
  v_roi_result RECORD;
  v_tracking_id UUID;
BEGIN
  -- Get subscription
  SELECT * INTO v_subscription
  FROM user_subscriptions
  WHERE id = p_subscription_id
    AND subscription_type = 'vehicle_status_change';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Calculate ROI
  SELECT * INTO v_roi_result
  FROM calculate_follow_roi(p_subscription_id);
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Get or create tracking record
  SELECT id INTO v_tracking_id
  FROM follow_roi_tracking
  WHERE subscription_id = p_subscription_id;
  
  IF v_tracking_id IS NULL THEN
    -- Create new tracking record
    INSERT INTO follow_roi_tracking (
      subscription_id,
      vehicle_id,
      user_id,
      followed_at,
      price_at_follow,
      current_price,
      hypothetical_roi_pct,
      hypothetical_gain,
      days_following,
      last_calculated_at
    )
    SELECT
      p_subscription_id,
      v_subscription.target_id::UUID,
      v_subscription.user_id,
      v_subscription.followed_at,
      v_subscription.price_at_follow,
      v_roi_result.current_price,
      v_roi_result.hypothetical_roi_pct,
      v_roi_result.hypothetical_gain,
      v_roi_result.days_following,
      NOW()
    RETURNING id INTO v_tracking_id;
  ELSE
    -- Update existing record
    UPDATE follow_roi_tracking
    SET
      current_price = v_roi_result.current_price,
      hypothetical_roi_pct = v_roi_result.hypothetical_roi_pct,
      hypothetical_gain = v_roi_result.hypothetical_gain,
      days_following = v_roi_result.days_following,
      last_calculated_at = NOW(),
      updated_at = NOW()
    WHERE id = v_tracking_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Auto-create ROI tracking when user follows
-- ============================================================================

CREATE OR REPLACE FUNCTION on_user_follows_vehicle()
RETURNS TRIGGER AS $$
DECLARE
  v_price_result RECORD;
BEGIN
  -- Only process vehicle_status_change subscriptions
  IF NEW.subscription_type != 'vehicle_status_change' THEN
    RETURN NEW;
  END IF;
  
  -- Set followed_at if not set
  IF NEW.followed_at IS NULL THEN
    NEW.followed_at := NOW();
  END IF;
  
  -- Get current price if not set
  IF NEW.price_at_follow IS NULL THEN
    SELECT * INTO v_price_result
    FROM get_vehicle_current_price(NEW.target_id::UUID);
    
    IF FOUND AND v_price_result.price IS NOT NULL THEN
      NEW.price_at_follow := v_price_result.price;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_on_user_follows_vehicle
  BEFORE INSERT ON user_subscriptions
  FOR EACH ROW
  WHEN (NEW.subscription_type = 'vehicle_status_change')
  EXECUTE FUNCTION on_user_follows_vehicle();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE follow_roi_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own ROI tracking" ON follow_roi_tracking
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage ROI tracking" ON follow_roi_tracking
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE follow_roi_tracking IS 'Tracks hypothetical ROI for vehicles users are following. Shows "if you invested when you started following, you would have X% return".';
COMMENT ON FUNCTION get_vehicle_current_price IS 'Gets the most relevant current price for a vehicle (sale_price > current_bid > asking_price > current_value)';
COMMENT ON FUNCTION calculate_follow_roi IS 'Calculates hypothetical ROI if user had invested when they started following';
COMMENT ON FUNCTION update_follow_roi_tracking IS 'Updates or creates ROI tracking record for a subscription';
