-- Tier System Refresh Functions and Triggers
-- Adds functions to actually update tier tables (not just calculate)
-- Adds automatic tier refresh triggers and bulk refresh capabilities

-- =====================================================
-- FIX MISSING ID COLUMN IN buyer_tiers (if needed)
-- =====================================================

DO $$
BEGIN
  -- Check if id column exists, if not add it
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'buyer_tiers' AND column_name = 'id'
  ) THEN
    ALTER TABLE buyer_tiers ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();
  END IF;
END $$;

-- =====================================================
-- ADD RATING COLUMN TO vehicle_listings (if needed)
-- =====================================================

DO $$
BEGIN
  -- Add rating column if it doesn't exist (needed for seller tier calculations)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'vehicle_listings' AND column_name = 'rating'
  ) THEN
    ALTER TABLE vehicle_listings 
    ADD COLUMN rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5);
    
    COMMENT ON COLUMN vehicle_listings.rating IS 'Seller rating for this listing (0-5 scale). Used for tier calculations.';
  END IF;
END $$;

-- =====================================================
-- SELLER TIER REFRESH FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_seller_tier(p_seller_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_metrics RECORD;
  v_score INTEGER := 0;
  v_tier TEXT := 'C';
  v_completion_rate DECIMAL(5,2) := 0;
  v_no_reserve_qual BOOLEAN := FALSE;
  v_total_sales INTEGER := 0;
  v_successful_sales INTEGER := 0;
  v_total_revenue BIGINT := 0;
  v_avg_rating DECIMAL(3,2) := 0;
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
  
  v_successful_sales := COALESCE(v_metrics.successful_sales, 0);
  v_total_sales := COALESCE(v_metrics.total_listings, 0);
  v_total_revenue := COALESCE(v_metrics.total_revenue, 0);
  v_avg_rating := COALESCE(v_metrics.avg_rating, 0);
  
  -- Calculate completion rate
  IF v_total_sales > 0 THEN
    v_completion_rate := (v_successful_sales::DECIMAL / v_total_sales) * 100;
  END IF;
  
  -- Calculate score
  -- Sales volume (0-30 points)
  IF v_successful_sales >= 100 THEN
    v_score := v_score + 30;
  ELSIF v_successful_sales >= 50 THEN
    v_score := v_score + 25;
  ELSIF v_successful_sales >= 20 THEN
    v_score := v_score + 20;
  ELSIF v_successful_sales >= 10 THEN
    v_score := v_score + 15;
  ELSIF v_successful_sales >= 5 THEN
    v_score := v_score + 10;
  ELSIF v_successful_sales >= 1 THEN
    v_score := v_score + 5;
  END IF;
  
  -- Completion rate (0-25 points)
  IF v_completion_rate >= 90 THEN
    v_score := v_score + 25;
  ELSIF v_completion_rate >= 75 THEN
    v_score := v_score + 20;
  ELSIF v_completion_rate >= 60 THEN
    v_score := v_score + 15;
  ELSIF v_completion_rate >= 50 THEN
    v_score := v_score + 10;
  END IF;
  
  -- Revenue (0-25 points)
  IF v_total_revenue >= 100000000 THEN -- $1M+
    v_score := v_score + 25;
  ELSIF v_total_revenue >= 50000000 THEN -- $500K+
    v_score := v_score + 20;
  ELSIF v_total_revenue >= 10000000 THEN -- $100K+
    v_score := v_score + 15;
  ELSIF v_total_revenue >= 1000000 THEN -- $10K+
    v_score := v_score + 10;
  END IF;
  
  -- Rating (0-20 points)
  IF v_avg_rating >= 4.8 THEN
    v_score := v_score + 20;
  ELSIF v_avg_rating >= 4.5 THEN
    v_score := v_score + 15;
  ELSIF v_avg_rating >= 4.0 THEN
    v_score := v_score + 10;
  ELSIF v_avg_rating >= 3.5 THEN
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
  
  -- Check no-reserve qualification (S tier+, 10+ sales, 80%+ completion)
  IF v_tier IN ('S', 'SS', 'SSS') AND v_successful_sales >= 10 AND v_completion_rate >= 80 THEN
    v_no_reserve_qual := TRUE;
  END IF;
  
  -- Upsert seller tier
  INSERT INTO seller_tiers (
    seller_id,
    tier,
    total_sales,
    successful_sales,
    total_revenue_cents,
    average_rating,
    completion_rate,
    no_reserve_qualification,
    tier_updated_at,
    updated_at
  ) VALUES (
    p_seller_id,
    v_tier,
    v_total_sales,
    v_successful_sales,
    v_total_revenue,
    v_avg_rating,
    v_completion_rate,
    v_no_reserve_qual,
    NOW(),
    NOW()
  )
  ON CONFLICT (seller_id) DO UPDATE SET
    tier = EXCLUDED.tier,
    total_sales = EXCLUDED.total_sales,
    successful_sales = EXCLUDED.successful_sales,
    total_revenue_cents = EXCLUDED.total_revenue_cents,
    average_rating = EXCLUDED.average_rating,
    completion_rate = EXCLUDED.completion_rate,
    no_reserve_qualification = EXCLUDED.no_reserve_qualification,
    tier_updated_at = NOW(),
    updated_at = NOW();
  
  RETURN jsonb_build_object(
    'success', true,
    'seller_id', p_seller_id,
    'tier', v_tier,
    'score', v_score,
    'total_sales', v_total_sales,
    'successful_sales', v_successful_sales,
    'completion_rate', v_completion_rate,
    'total_revenue_cents', v_total_revenue,
    'average_rating', v_avg_rating,
    'no_reserve_qualification', v_no_reserve_qual
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =====================================================
-- BUYER TIER REFRESH FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_buyer_tier(p_buyer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_metrics RECORD;
  v_score INTEGER := 0;
  v_tier TEXT := 'C';
  v_win_rate DECIMAL(5,2) := 0;
  v_payment_reliability DECIMAL(5,2) := 0;
  v_total_bids INTEGER := 0;
  v_winning_bids INTEGER := 0;
  v_total_spent BIGINT := 0;
  v_avg_bid BIGINT := 0;
  v_highest_bid BIGINT := 0;
BEGIN
  -- Get buyer metrics from auction_bids
  SELECT 
    COUNT(*) FILTER (WHERE is_winning = TRUE) as winning_bids,
    COUNT(*) as total_bids,
    COALESCE(SUM(CASE WHEN is_winning THEN displayed_bid_cents ELSE 0 END), 0) as total_spent,
    COALESCE(AVG(CASE WHEN is_winning THEN displayed_bid_cents ELSE NULL END), 0) as avg_winning_bid,
    COALESCE(MAX(displayed_bid_cents), 0) as highest_bid
  INTO v_metrics
  FROM auction_bids
  WHERE bidder_id = p_buyer_id;
  
  v_winning_bids := COALESCE(v_metrics.winning_bids, 0);
  v_total_bids := COALESCE(v_metrics.total_bids, 0);
  v_total_spent := COALESCE(v_metrics.total_spent, 0);
  v_avg_bid := COALESCE(v_metrics.avg_winning_bid, 0)::BIGINT;
  v_highest_bid := COALESCE(v_metrics.highest_bid, 0);
  
  -- Calculate win rate
  IF v_total_bids > 0 THEN
    v_win_rate := (v_winning_bids::DECIMAL / v_total_bids) * 100;
  END IF;
  
  -- TODO: Calculate payment_reliability from transaction/payment data
  -- For now, assume good if they have wins
  IF v_winning_bids >= 10 THEN
    v_payment_reliability := 100;
  ELSIF v_winning_bids >= 5 THEN
    v_payment_reliability := 95;
  ELSIF v_winning_bids >= 1 THEN
    v_payment_reliability := 90;
  END IF;
  
  -- Calculate score
  -- Bidding activity (0-30 points)
  IF v_total_bids >= 100 THEN
    v_score := v_score + 30;
  ELSIF v_total_bids >= 50 THEN
    v_score := v_score + 25;
  ELSIF v_total_bids >= 20 THEN
    v_score := v_score + 20;
  ELSIF v_total_bids >= 10 THEN
    v_score := v_score + 15;
  ELSIF v_total_bids >= 5 THEN
    v_score := v_score + 10;
  ELSIF v_total_bids >= 1 THEN
    v_score := v_score + 5;
  END IF;
  
  -- Win rate (0-25 points)
  IF v_win_rate >= 20 THEN
    v_score := v_score + 25;
  ELSIF v_win_rate >= 15 THEN
    v_score := v_score + 20;
  ELSIF v_win_rate >= 10 THEN
    v_score := v_score + 15;
  ELSIF v_win_rate >= 5 THEN
    v_score := v_score + 10;
  END IF;
  
  -- Spending (0-25 points)
  IF v_total_spent >= 100000000 THEN -- $1M+
    v_score := v_score + 25;
  ELSIF v_total_spent >= 50000000 THEN -- $500K+
    v_score := v_score + 20;
  ELSIF v_total_spent >= 10000000 THEN -- $100K+
    v_score := v_score + 15;
  ELSIF v_total_spent >= 1000000 THEN -- $10K+
    v_score := v_score + 10;
  END IF;
  
  -- Payment reliability (0-20 points)
  IF v_payment_reliability >= 95 THEN
    v_score := v_score + 20;
  ELSIF v_payment_reliability >= 90 THEN
    v_score := v_score + 15;
  ELSIF v_payment_reliability >= 80 THEN
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
  
  -- Upsert buyer tier
  INSERT INTO buyer_tiers (
    buyer_id,
    tier,
    total_bids,
    winning_bids,
    payment_reliability,
    total_spent_cents,
    average_bid_amount_cents,
    highest_bid_cents,
    tier_updated_at,
    updated_at
  ) VALUES (
    p_buyer_id,
    v_tier,
    v_total_bids,
    v_winning_bids,
    v_payment_reliability,
    v_total_spent,
    v_avg_bid,
    v_highest_bid,
    NOW(),
    NOW()
  )
  ON CONFLICT (buyer_id) DO UPDATE SET
    tier = EXCLUDED.tier,
    total_bids = EXCLUDED.total_bids,
    winning_bids = EXCLUDED.winning_bids,
    payment_reliability = EXCLUDED.payment_reliability,
    total_spent_cents = EXCLUDED.total_spent_cents,
    average_bid_amount_cents = EXCLUDED.average_bid_amount_cents,
    highest_bid_cents = EXCLUDED.highest_bid_cents,
    tier_updated_at = NOW(),
    updated_at = NOW();
  
  RETURN jsonb_build_object(
    'success', true,
    'buyer_id', p_buyer_id,
    'tier', v_tier,
    'score', v_score,
    'total_bids', v_total_bids,
    'winning_bids', v_winning_bids,
    'win_rate', v_win_rate,
    'total_spent_cents', v_total_spent,
    'payment_reliability', v_payment_reliability
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =====================================================
-- BULK REFRESH FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION refresh_all_seller_tiers()
RETURNS JSONB AS $$
DECLARE
  v_seller RECORD;
  v_refreshed INTEGER := 0;
  v_errors INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Refresh tiers for all sellers who have listings
  FOR v_seller IN 
    SELECT DISTINCT seller_id 
    FROM vehicle_listings
    WHERE seller_id IS NOT NULL
  LOOP
    BEGIN
      v_result := refresh_seller_tier(v_seller.seller_id);
      IF (v_result->>'success')::BOOLEAN THEN
        v_refreshed := v_refreshed + 1;
      ELSE
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'Error refreshing tier for seller %: %', v_seller.seller_id, SQLERRM;
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'refreshed', v_refreshed,
    'errors', v_errors,
    'total_processed', v_refreshed + v_errors
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

CREATE OR REPLACE FUNCTION refresh_all_buyer_tiers()
RETURNS JSONB AS $$
DECLARE
  v_buyer RECORD;
  v_refreshed INTEGER := 0;
  v_errors INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Refresh tiers for all buyers who have bids
  FOR v_buyer IN 
    SELECT DISTINCT bidder_id as buyer_id
    FROM auction_bids
    WHERE bidder_id IS NOT NULL
  LOOP
    BEGIN
      v_result := refresh_buyer_tier(v_buyer.buyer_id);
      IF (v_result->>'success')::BOOLEAN THEN
        v_refreshed := v_refreshed + 1;
      ELSE
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE WARNING 'Error refreshing tier for buyer %: %', v_buyer.buyer_id, SQLERRM;
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'refreshed', v_refreshed,
    'errors', v_errors,
    'total_processed', v_refreshed + v_errors
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- =====================================================
-- AUTO-REFRESH TRIGGERS
-- =====================================================

-- Function to trigger seller tier refresh when listing status changes
CREATE OR REPLACE FUNCTION trigger_refresh_seller_tier()
RETURNS TRIGGER AS $$
BEGIN
  -- Refresh seller tier when listing status changes to 'sold' or when relevant fields change
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND 
     (NEW.status = 'sold' OR NEW.status != COALESCE(OLD.status, '')) THEN
    PERFORM refresh_seller_tier(NEW.seller_id);
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_seller_tier(OLD.seller_id);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger on vehicle_listings
DROP TRIGGER IF EXISTS refresh_seller_tier_on_listing_change ON vehicle_listings;
CREATE TRIGGER refresh_seller_tier_on_listing_change
  AFTER INSERT OR UPDATE OF status, sold_price_cents, rating OR DELETE
  ON vehicle_listings
  FOR EACH ROW
  WHEN (seller_id IS NOT NULL)
  EXECUTE FUNCTION trigger_refresh_seller_tier();

-- Function to trigger buyer tier refresh when bid changes
CREATE OR REPLACE FUNCTION trigger_refresh_buyer_tier()
RETURNS TRIGGER AS $$
BEGIN
  -- Refresh buyer tier when bid is placed or when winning status changes
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    PERFORM refresh_buyer_tier(NEW.bidder_id);
    
    -- Also refresh other bidders who were outbid (if needed)
    IF TG_OP = 'UPDATE' AND NEW.is_winning = TRUE AND OLD.is_winning = FALSE THEN
      -- Refresh previous winner if they were outbid
      PERFORM refresh_buyer_tier(bidder_id)
      FROM auction_bids
      WHERE listing_id = NEW.listing_id
        AND bidder_id != NEW.bidder_id
        AND is_winning = FALSE
        AND is_outbid = TRUE;
    END IF;
  END IF;
  
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_buyer_tier(OLD.bidder_id);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger on auction_bids
DROP TRIGGER IF EXISTS refresh_buyer_tier_on_bid_change ON auction_bids;
CREATE TRIGGER refresh_buyer_tier_on_bid_change
  AFTER INSERT OR UPDATE OF is_winning, is_outbid, displayed_bid_cents OR DELETE
  ON auction_bids
  FOR EACH ROW
  WHEN (bidder_id IS NOT NULL)
  EXECUTE FUNCTION trigger_refresh_buyer_tier();

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- Enable RLS on tier tables
ALTER TABLE seller_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_tiers ENABLE ROW LEVEL SECURITY;

-- Users can view their own tier
CREATE POLICY "users_view_own_seller_tier" ON seller_tiers
  FOR SELECT USING (seller_id = auth.uid());

CREATE POLICY "users_view_own_buyer_tier" ON buyer_tiers
  FOR SELECT USING (buyer_id = auth.uid());

-- Users can view any tier (for auction eligibility checks, etc.)
-- This allows the system to check seller/buyer tiers for auctions
CREATE POLICY "users_view_all_tiers" ON seller_tiers
  FOR SELECT USING (true);

CREATE POLICY "users_view_all_buyer_tiers" ON buyer_tiers
  FOR SELECT USING (true);

-- Only system can insert/update tiers (via SECURITY DEFINER functions)
CREATE POLICY "system_only_tier_updates" ON seller_tiers
  FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "system_only_buyer_tier_updates" ON buyer_tiers
  FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- GRANTS
-- =====================================================

GRANT EXECUTE ON FUNCTION refresh_seller_tier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_buyer_tier(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_all_seller_tiers() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_all_buyer_tiers() TO authenticated;
GRANT SELECT ON seller_tiers TO authenticated;
GRANT SELECT ON buyer_tiers TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION refresh_seller_tier(UUID) IS 'Refreshes and updates seller tier based on current metrics';
COMMENT ON FUNCTION refresh_buyer_tier(UUID) IS 'Refreshes and updates buyer tier based on current metrics';
COMMENT ON FUNCTION refresh_all_seller_tiers() IS 'Bulk refresh all seller tiers (use sparingly, can be expensive)';
COMMENT ON FUNCTION refresh_all_buyer_tiers() IS 'Bulk refresh all buyer tiers (use sparingly, can be expensive)';
COMMENT ON FUNCTION trigger_refresh_seller_tier() IS 'Trigger function to auto-refresh seller tier on listing changes';
COMMENT ON FUNCTION trigger_refresh_buyer_tier() IS 'Trigger function to auto-refresh buyer tier on bid changes';

