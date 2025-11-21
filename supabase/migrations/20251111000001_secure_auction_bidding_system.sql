-- Secure Auction Bidding System
-- Implements proxy bidding, 2-minute sniping protection, and secure bid management
-- Supports flexible auction durations (5-10 minutes, scheduled lots, etc.)

-- =====================================================
-- ENHANCE VEHICLE_LISTINGS FOR AUCTIONS
-- =====================================================

-- Add auction-specific fields to vehicle_listings if they don't exist
DO $$
BEGIN
  -- Auction timing fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'auction_start_time') THEN
    ALTER TABLE vehicle_listings ADD COLUMN auction_start_time TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'auction_end_time') THEN
    ALTER TABLE vehicle_listings ADD COLUMN auction_end_time TIMESTAMPTZ;
  END IF;
  
  -- Current high bid tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'current_high_bid_cents') THEN
    ALTER TABLE vehicle_listings ADD COLUMN current_high_bid_cents BIGINT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'current_high_bidder_id') THEN
    ALTER TABLE vehicle_listings ADD COLUMN current_high_bidder_id UUID REFERENCES profiles(id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'bid_count') THEN
    ALTER TABLE vehicle_listings ADD COLUMN bid_count INTEGER DEFAULT 0;
  END IF;
  
  -- Sniping protection extension tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'last_bid_time') THEN
    ALTER TABLE vehicle_listings ADD COLUMN last_bid_time TIMESTAMPTZ;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'sniping_extensions') THEN
    ALTER TABLE vehicle_listings ADD COLUMN sniping_extensions INTEGER DEFAULT 0;
  END IF;
  
  -- Auction configuration
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'auction_duration_minutes') THEN
    ALTER TABLE vehicle_listings ADD COLUMN auction_duration_minutes INTEGER DEFAULT 7 * 24 * 60; -- Default 7 days
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'sniping_protection_minutes') THEN
    ALTER TABLE vehicle_listings ADD COLUMN sniping_protection_minutes INTEGER DEFAULT 2;
  END IF;
  
  -- AI agent review status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'ai_review_status') THEN
    ALTER TABLE vehicle_listings ADD COLUMN ai_review_status TEXT CHECK (ai_review_status IN ('pending', 'approved', 'rejected', 'needs_review'));
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'ai_review_notes') THEN
    ALTER TABLE vehicle_listings ADD COLUMN ai_review_notes TEXT;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'vehicle_listings' AND column_name = 'ai_reviewed_at') THEN
    ALTER TABLE vehicle_listings ADD COLUMN ai_reviewed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Update sale_type to include 'live_auction' for fast auctions
DO $$
BEGIN
  -- Check if constraint exists and update it
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name LIKE '%vehicle_listings_sale_type_check%'
    AND table_name = 'vehicle_listings'
  ) THEN
    -- Drop old constraint
    ALTER TABLE vehicle_listings DROP CONSTRAINT IF EXISTS vehicle_listings_sale_type_check;
    -- Add new constraint with live_auction
    ALTER TABLE vehicle_listings ADD CONSTRAINT vehicle_listings_sale_type_check 
      CHECK (sale_type IN ('fixed_price', 'auction', 'best_offer', 'live_auction'));
  END IF;
END $$;

-- Indexes for auction queries
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_auction_times 
  ON vehicle_listings(auction_start_time, auction_end_time) 
  WHERE sale_type IN ('auction', 'live_auction');

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_active_auctions 
  ON vehicle_listings(status, auction_end_time) 
  WHERE status = 'active' AND sale_type IN ('auction', 'live_auction');

-- =====================================================
-- AUCTION BIDS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS auction_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Proxy bidding: secret maximum bid
  proxy_max_bid_cents BIGINT NOT NULL,
  
  -- Displayed bid (what others see)
  displayed_bid_cents BIGINT NOT NULL,
  
  -- Bid status
  is_winning BOOLEAN DEFAULT FALSE,
  is_outbid BOOLEAN DEFAULT FALSE,
  outbid_at TIMESTAMPTZ,
  
  -- Security & audit
  ip_address INET,
  user_agent TEXT,
  bid_source TEXT CHECK (bid_source IN ('web', 'mobile', 'api')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT bid_amount_positive CHECK (proxy_max_bid_cents > 0 AND displayed_bid_cents > 0),
  CONSTRAINT proxy_higher_than_display CHECK (proxy_max_bid_cents >= displayed_bid_cents)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_auction_bids_listing ON auction_bids(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON auction_bids(bidder_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_winning ON auction_bids(listing_id, is_winning) WHERE is_winning = TRUE;
CREATE INDEX IF NOT EXISTS idx_auction_bids_listing_time ON auction_bids(listing_id, created_at);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_auction_bids_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_auction_bids_updated_at ON auction_bids;
CREATE TRIGGER update_auction_bids_updated_at
  BEFORE UPDATE ON auction_bids
  FOR EACH ROW
  EXECUTE FUNCTION update_auction_bids_updated_at();

-- =====================================================
-- RLS POLICIES FOR AUCTION_BIDS
-- =====================================================

ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;

-- Users can view bids on auctions they're participating in or own
CREATE POLICY "view_own_bids" ON auction_bids
  FOR SELECT USING (bidder_id = auth.uid());

CREATE POLICY "view_listing_bids" ON auction_bids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_listings
      WHERE vehicle_listings.id = auction_bids.listing_id
      AND (
        vehicle_listings.seller_id = auth.uid() OR
        vehicle_listings.status = 'active'
      )
    )
  );

-- Users can only create their own bids (via Edge Function with validation)
CREATE POLICY "create_own_bids" ON auction_bids
  FOR INSERT WITH CHECK (bidder_id = auth.uid());

-- Users cannot update bids directly (only via Edge Function)
CREATE POLICY "no_direct_bid_updates" ON auction_bids
  FOR UPDATE USING (FALSE);

-- =====================================================
-- BID INCREMENT CALCULATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_bid_increment(current_bid_cents BIGINT)
RETURNS BIGINT AS $$
BEGIN
  RETURN CASE
    WHEN current_bid_cents < 10000 THEN 50      -- $0-$100: $50 increments
    WHEN current_bid_cents < 50000 THEN 100     -- $100-$500: $100 increments
    WHEN current_bid_cents < 100000 THEN 250   -- $500-$1,000: $250 increments
    WHEN current_bid_cents < 500000 THEN 500   -- $1,000-$5,000: $500 increments
    WHEN current_bid_cents < 1000000 THEN 1000 -- $5,000-$10,000: $1,000 increments
    WHEN current_bid_cents < 5000000 THEN 2500 -- $10,000-$50,000: $2,500 increments
    ELSE 5000                                  -- $50,000+: $5,000 increments
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- SECURE BID PLACEMENT FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION place_auction_bid(
  p_listing_id UUID,
  p_proxy_max_bid_cents BIGINT,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_bid_source TEXT DEFAULT 'web'
)
RETURNS JSONB AS $$
DECLARE
  v_listing RECORD;
  v_current_high_bid_cents BIGINT;
  v_min_bid_cents BIGINT;
  v_increment BIGINT;
  v_displayed_bid_cents BIGINT;
  v_bid_id UUID;
  v_was_winning_bidder UUID;
  v_auction_extended BOOLEAN := FALSE;
  v_new_end_time TIMESTAMPTZ;
  v_sniping_protection_minutes INTEGER;
BEGIN
  -- Get listing with lock (prevents race conditions)
  SELECT * INTO v_listing
  FROM vehicle_listings
  WHERE id = p_listing_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;
  
  -- Validate auction type
  IF v_listing.sale_type NOT IN ('auction', 'live_auction') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not an auction listing');
  END IF;
  
  -- Validate status
  IF v_listing.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction is not active');
  END IF;
  
  -- Validate auction hasn't ended
  IF v_listing.auction_end_time IS NULL OR NOW() > v_listing.auction_end_time THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction has ended');
  END IF;
  
  -- Prevent seller from bidding
  IF v_listing.seller_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Seller cannot bid on own auction');
  END IF;
  
  -- Get current high bid
  v_current_high_bid_cents := COALESCE(v_listing.current_high_bid_cents, 0);
  
  -- Calculate minimum bid
  v_increment := calculate_bid_increment(v_current_high_bid_cents);
  v_min_bid_cents := v_current_high_bid_cents + v_increment;
  
  -- Validate bid amount
  IF p_proxy_max_bid_cents < v_min_bid_cents THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Bid too low',
      'minimum_bid_cents', v_min_bid_cents,
      'current_high_bid_cents', v_current_high_bid_cents
    );
  END IF;
  
  -- Calculate displayed bid (proxy bidding logic)
  v_displayed_bid_cents := v_min_bid_cents;
  IF p_proxy_max_bid_cents > v_min_bid_cents THEN
    -- User's max is higher, but we only display minimum increment
    v_displayed_bid_cents := LEAST(p_proxy_max_bid_cents, v_current_high_bid_cents + v_increment);
  END IF;
  
  -- Get current winning bidder (to mark as outbid)
  v_was_winning_bidder := v_listing.current_high_bidder_id;
  
  -- =====================================================
  -- SNIPING PROTECTION: Extend auction if needed
  -- =====================================================
  v_sniping_protection_minutes := COALESCE(v_listing.sniping_protection_minutes, 2);
  
  IF v_listing.auction_end_time - NOW() < (v_sniping_protection_minutes || ' minutes')::INTERVAL THEN
    -- Extend auction by sniping protection window
    v_new_end_time := NOW() + (v_sniping_protection_minutes || ' minutes')::INTERVAL;
    
    UPDATE vehicle_listings
    SET 
      auction_end_time = v_new_end_time,
      sniping_extensions = COALESCE(sniping_extensions, 0) + 1,
      last_bid_time = NOW()
    WHERE id = p_listing_id;
    
    v_auction_extended := TRUE;
  ELSE
    -- Just update last bid time
    UPDATE vehicle_listings
    SET last_bid_time = NOW()
    WHERE id = p_listing_id;
  END IF;
  
  -- =====================================================
  -- CREATE BID RECORD
  -- =====================================================
  INSERT INTO auction_bids (
    listing_id,
    bidder_id,
    proxy_max_bid_cents,
    displayed_bid_cents,
    is_winning,
    ip_address,
    user_agent,
    bid_source
  ) VALUES (
    p_listing_id,
    auth.uid(),
    p_proxy_max_bid_cents,
    v_displayed_bid_cents,
    TRUE,
    p_ip_address,
    p_user_agent,
    p_bid_source
  ) RETURNING id INTO v_bid_id;
  
  -- =====================================================
  -- UPDATE LISTING WITH NEW HIGH BID
  -- =====================================================
  UPDATE vehicle_listings
  SET
    current_high_bid_cents = v_displayed_bid_cents,
    current_high_bidder_id = auth.uid(),
    bid_count = COALESCE(bid_count, 0) + 1,
    updated_at = NOW()
  WHERE id = p_listing_id;
  
  -- =====================================================
  -- MARK PREVIOUS WINNING BID AS OUTBID
  -- =====================================================
  IF v_was_winning_bidder IS NOT NULL AND v_was_winning_bidder != auth.uid() THEN
    UPDATE auction_bids
    SET
      is_winning = FALSE,
      is_outbid = TRUE,
      outbid_at = NOW(),
      updated_at = NOW()
    WHERE listing_id = p_listing_id
      AND bidder_id = v_was_winning_bidder
      AND is_winning = TRUE;
  END IF;
  
  -- =====================================================
  -- RETURN SUCCESS RESPONSE
  -- =====================================================
  RETURN jsonb_build_object(
    'success', TRUE,
    'bid_id', v_bid_id,
    'displayed_bid_cents', v_displayed_bid_cents,
    'proxy_max_bid_cents', p_proxy_max_bid_cents,
    'is_winning', TRUE,
    'auction_extended', v_auction_extended,
    'new_end_time', v_new_end_time,
    'current_high_bid_cents', v_displayed_bid_cents,
    'bid_count', v_listing.bid_count + 1
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

GRANT EXECUTE ON FUNCTION place_auction_bid(UUID, BIGINT, INET, TEXT, TEXT) TO authenticated;

-- =====================================================
-- AUCTION END PROCESSING FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION process_auction_end(p_listing_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_listing RECORD;
  v_winning_bid RECORD;
  v_reserve_met BOOLEAN;
BEGIN
  -- Get listing
  SELECT * INTO v_listing
  FROM vehicle_listings
  WHERE id = p_listing_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Listing not found');
  END IF;
  
  -- Check if reserve was met
  v_reserve_met := TRUE;
  IF v_listing.reserve_price_cents IS NOT NULL THEN
    v_reserve_met := COALESCE(v_listing.current_high_bid_cents, 0) >= v_listing.reserve_price_cents;
  END IF;
  
  IF v_reserve_met AND v_listing.current_high_bid_cents IS NOT NULL THEN
    -- Reserve met - mark as sold
    UPDATE vehicle_listings
    SET
      status = 'sold',
      sold_at = NOW(),
      sold_price_cents = v_listing.current_high_bid_cents,
      buyer_id = v_listing.current_high_bidder_id,
      updated_at = NOW()
    WHERE id = p_listing_id;
    
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'sold',
      'final_price_cents', v_listing.current_high_bid_cents,
      'buyer_id', v_listing.current_high_bidder_id
    );
  ELSE
    -- Reserve not met - mark as expired
    UPDATE vehicle_listings
    SET
      status = 'expired',
      updated_at = NOW()
    WHERE id = p_listing_id;
    
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'expired',
      'reserve_not_met', TRUE
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

GRANT EXECUTE ON FUNCTION process_auction_end(UUID) TO authenticated;

COMMENT ON TABLE auction_bids IS 'Secure auction bidding with proxy bidding support';
COMMENT ON FUNCTION place_auction_bid IS 'Securely place a bid with proxy bidding and sniping protection';
COMMENT ON FUNCTION process_auction_end IS 'Process auction end and determine if reserve was met';

