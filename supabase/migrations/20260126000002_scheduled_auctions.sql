-- =====================================================
-- SCHEDULED AUCTIONS SYSTEM
-- =====================================================
-- Committed offers auction model with:
-- 1. Scheduled sale dates with visibility windows
-- 2. Visible bid stacking ("10 committed offers totaling $X")
-- 3. Extension logic on late bids
-- 4. Automatic settlement to winner
-- January 2026

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Scheduled Auctions
CREATE TABLE IF NOT EXISTS scheduled_auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES vehicle_offerings(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Auction Type
  auction_type TEXT NOT NULL DEFAULT 'committed_offers' CHECK (auction_type IN (
    'committed_offers',  -- Stacked visible bids
    'sealed_bid',        -- Hidden until end
    'english',           -- Traditional ascending
    'dutch'              -- Descending price
  )),

  -- Pricing
  starting_price DECIMAL(12,2) NOT NULL,
  reserve_price DECIMAL(12,2),  -- Minimum acceptable price
  current_high_bid DECIMAL(12,2),
  buy_now_price DECIMAL(12,2),  -- Instant purchase option

  -- Shares being auctioned
  shares_offered INTEGER NOT NULL DEFAULT 1 CHECK (shares_offered > 0),

  -- Visibility Windows
  visibility_start TIMESTAMPTZ NOT NULL,  -- When auction becomes visible
  bidding_start TIMESTAMPTZ NOT NULL,     -- When bidding opens
  scheduled_end TIMESTAMPTZ NOT NULL,      -- Original end time

  -- Extension Settings
  extension_enabled BOOLEAN DEFAULT true,
  extension_threshold_seconds INTEGER DEFAULT 300,  -- Extend if bid in last 5 min
  extension_duration_seconds INTEGER DEFAULT 120,   -- Add 2 minutes
  max_extensions INTEGER DEFAULT 10,
  extensions_used INTEGER DEFAULT 0,
  actual_end TIMESTAMPTZ,  -- Final end time after extensions

  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',           -- Not yet published
    'scheduled',       -- Waiting for visibility_start
    'preview',         -- Visible but not accepting bids
    'active',          -- Accepting bids
    'extended',        -- Past original end, extended
    'ended',           -- Bidding closed
    'settling',        -- Processing winner
    'completed',       -- Successfully sold
    'cancelled',       -- Cancelled by seller
    'no_sale'          -- Didn't meet reserve
  )),

  -- Winner
  winning_bid_id UUID,
  final_price DECIMAL(12,2),
  winner_id UUID REFERENCES auth.users(id),

  -- Stats
  total_bids INTEGER DEFAULT 0,
  total_committed_value DECIMAL(15,2) DEFAULT 0,
  unique_bidders INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,

  -- Metadata
  title TEXT,
  description TEXT,
  terms TEXT,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scheduled_auctions_offering ON scheduled_auctions(offering_id);
CREATE INDEX idx_scheduled_auctions_seller ON scheduled_auctions(seller_id);
CREATE INDEX idx_scheduled_auctions_status ON scheduled_auctions(status);
CREATE INDEX idx_scheduled_auctions_end ON scheduled_auctions(scheduled_end);
CREATE INDEX idx_scheduled_auctions_active ON scheduled_auctions(status, scheduled_end)
  WHERE status IN ('active', 'extended');

-- Committed Bids
CREATE TABLE IF NOT EXISTS committed_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES scheduled_auctions(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Bid Details
  bid_amount DECIMAL(12,2) NOT NULL CHECK (bid_amount > 0),
  shares_requested INTEGER NOT NULL DEFAULT 1 CHECK (shares_requested > 0),
  max_bid DECIMAL(12,2),  -- For proxy bidding (auto-increase up to max)

  -- Visibility
  is_visible BOOLEAN DEFAULT true,  -- For committed_offers type
  display_name TEXT,  -- Anonymous display name if desired

  -- Cash Reservation
  cash_reserved_cents INTEGER NOT NULL,
  reservation_id UUID,  -- Reference to cash_reservations

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'pending',         -- Awaiting cash verification
    'active',          -- Valid and competing
    'outbid',          -- Surpassed by higher bid
    'winning',         -- Currently winning
    'won',             -- Won the auction
    'lost',            -- Didn't win
    'cancelled',       -- Cancelled by bidder
    'rejected'         -- Rejected by system/seller
  )),

  -- Timestamps
  bid_time TIMESTAMPTZ DEFAULT NOW(),
  outbid_time TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(auction_id, bidder_id)  -- One bid per bidder per auction (can update)
);

CREATE INDEX idx_committed_bids_auction ON committed_bids(auction_id);
CREATE INDEX idx_committed_bids_bidder ON committed_bids(bidder_id);
CREATE INDEX idx_committed_bids_status ON committed_bids(status);
CREATE INDEX idx_committed_bids_amount ON committed_bids(auction_id, bid_amount DESC);
CREATE INDEX idx_committed_bids_active ON committed_bids(auction_id, status, bid_amount DESC)
  WHERE status IN ('active', 'winning');

-- Auction Activity Log
CREATE TABLE IF NOT EXISTS auction_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES scheduled_auctions(id) ON DELETE CASCADE,
  bid_id UUID REFERENCES committed_bids(id) ON DELETE SET NULL,

  -- Activity Type
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'auction_created', 'auction_published', 'auction_started',
    'bid_placed', 'bid_updated', 'bid_cancelled', 'bid_outbid',
    'auction_extended', 'reserve_met', 'reserve_not_met',
    'auction_ended', 'winner_determined', 'settlement_started',
    'settlement_completed', 'auction_cancelled'
  )),

  -- Actor
  user_id UUID REFERENCES auth.users(id),

  -- Details
  old_value DECIMAL(12,2),
  new_value DECIMAL(12,2),
  details JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auction_activity_auction ON auction_activity_log(auction_id);
CREATE INDEX idx_auction_activity_type ON auction_activity_log(activity_type);
CREATE INDEX idx_auction_activity_created ON auction_activity_log(created_at DESC);

-- =====================================================
-- CORE FUNCTIONS
-- =====================================================

-- Place or update a committed bid
CREATE OR REPLACE FUNCTION place_committed_bid(
  p_auction_id UUID,
  p_bidder_id UUID,
  p_bid_amount DECIMAL(12,2),
  p_shares_requested INTEGER DEFAULT 1,
  p_max_bid DECIMAL(12,2) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auction RECORD;
  v_existing_bid RECORD;
  v_required_cents INTEGER;
  v_reservation_result BOOLEAN;
  v_bid_id UUID;
  v_is_high_bid BOOLEAN := false;
  v_extends BOOLEAN := false;
BEGIN
  -- Get auction details
  SELECT * INTO v_auction
  FROM scheduled_auctions
  WHERE id = p_auction_id;

  IF v_auction IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction not found');
  END IF;

  -- Validate auction status
  IF v_auction.status NOT IN ('active', 'extended') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction is not accepting bids');
  END IF;

  -- Validate bid amount
  IF p_bid_amount < v_auction.starting_price THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bid must be at least the starting price');
  END IF;

  IF v_auction.current_high_bid IS NOT NULL AND p_bid_amount <= v_auction.current_high_bid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bid must be higher than current high bid');
  END IF;

  -- Calculate required cash (bid amount + 2% commission)
  v_required_cents := ROUND(p_bid_amount * p_shares_requested * 1.02 * 100)::INTEGER;

  -- Check for existing bid by this user
  SELECT * INTO v_existing_bid
  FROM committed_bids
  WHERE auction_id = p_auction_id AND bidder_id = p_bidder_id;

  IF v_existing_bid IS NOT NULL THEN
    -- Update existing bid
    IF p_bid_amount <= v_existing_bid.bid_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'New bid must be higher than your previous bid');
    END IF;

    -- Release old reservation
    PERFORM release_reserved_cash(
      p_bidder_id,
      v_existing_bid.cash_reserved_cents,
      v_existing_bid.id::TEXT
    );

    -- Reserve new amount
    v_reservation_result := (SELECT reserve_cash(p_bidder_id, v_required_cents, p_auction_id::TEXT));

    IF NOT v_reservation_result THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient funds');
    END IF;

    -- Update bid
    UPDATE committed_bids
    SET
      bid_amount = p_bid_amount,
      shares_requested = p_shares_requested,
      max_bid = COALESCE(p_max_bid, max_bid),
      cash_reserved_cents = v_required_cents,
      status = 'active',
      bid_time = NOW(),
      updated_at = NOW()
    WHERE id = v_existing_bid.id
    RETURNING id INTO v_bid_id;

    -- Log activity
    INSERT INTO auction_activity_log (auction_id, bid_id, activity_type, user_id, old_value, new_value)
    VALUES (p_auction_id, v_bid_id, 'bid_updated', p_bidder_id, v_existing_bid.bid_amount, p_bid_amount);
  ELSE
    -- New bid - reserve cash first
    v_reservation_result := (SELECT reserve_cash(p_bidder_id, v_required_cents, p_auction_id::TEXT));

    IF NOT v_reservation_result THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient funds');
    END IF;

    -- Create new bid
    INSERT INTO committed_bids (
      auction_id, bidder_id, bid_amount, shares_requested, max_bid,
      cash_reserved_cents, status, is_visible
    ) VALUES (
      p_auction_id, p_bidder_id, p_bid_amount, p_shares_requested, p_max_bid,
      v_required_cents, 'active', true
    )
    RETURNING id INTO v_bid_id;

    -- Log activity
    INSERT INTO auction_activity_log (auction_id, bid_id, activity_type, user_id, new_value)
    VALUES (p_auction_id, v_bid_id, 'bid_placed', p_bidder_id, p_bid_amount);
  END IF;

  -- Update auction stats and check for new high bid
  UPDATE scheduled_auctions
  SET
    current_high_bid = GREATEST(current_high_bid, p_bid_amount),
    total_bids = total_bids + 1,
    total_committed_value = (
      SELECT COALESCE(SUM(bid_amount * shares_requested), 0)
      FROM committed_bids WHERE auction_id = p_auction_id AND status IN ('active', 'winning')
    ),
    unique_bidders = (
      SELECT COUNT(DISTINCT bidder_id)
      FROM committed_bids WHERE auction_id = p_auction_id AND status IN ('active', 'winning')
    ),
    updated_at = NOW()
  WHERE id = p_auction_id;

  -- Check if this is the new high bid
  v_is_high_bid := (p_bid_amount >= COALESCE(v_auction.current_high_bid, 0));

  -- Update all bid statuses
  UPDATE committed_bids
  SET status = CASE
    WHEN bid_amount = (SELECT MAX(bid_amount) FROM committed_bids WHERE auction_id = p_auction_id AND status IN ('active', 'winning'))
    THEN 'winning'
    ELSE 'active'
  END,
  outbid_time = CASE
    WHEN bid_amount < p_bid_amount THEN NOW()
    ELSE outbid_time
  END
  WHERE auction_id = p_auction_id AND status IN ('active', 'winning');

  -- Check for auction extension
  IF v_auction.extension_enabled AND v_auction.extensions_used < v_auction.max_extensions THEN
    IF NOW() > (v_auction.scheduled_end - (v_auction.extension_threshold_seconds || ' seconds')::INTERVAL) THEN
      UPDATE scheduled_auctions
      SET
        scheduled_end = scheduled_end + (v_auction.extension_duration_seconds || ' seconds')::INTERVAL,
        extensions_used = extensions_used + 1,
        status = 'extended',
        updated_at = NOW()
      WHERE id = p_auction_id;

      v_extends := true;

      INSERT INTO auction_activity_log (auction_id, bid_id, activity_type, user_id, details)
      VALUES (p_auction_id, v_bid_id, 'auction_extended', p_bidder_id,
        jsonb_build_object('extension_number', v_auction.extensions_used + 1));
    END IF;
  END IF;

  -- Check if reserve is met
  IF v_auction.reserve_price IS NOT NULL AND p_bid_amount >= v_auction.reserve_price THEN
    INSERT INTO auction_activity_log (auction_id, bid_id, activity_type, user_id, new_value)
    VALUES (p_auction_id, v_bid_id, 'reserve_met', p_bidder_id, p_bid_amount)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'bid_id', v_bid_id,
    'is_high_bid', v_is_high_bid,
    'extended', v_extends,
    'cash_reserved', v_required_cents
  );
END;
$$;

-- Cancel a committed bid
CREATE OR REPLACE FUNCTION cancel_committed_bid(p_bid_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bid RECORD;
  v_auction RECORD;
BEGIN
  -- Get bid details
  SELECT * INTO v_bid
  FROM committed_bids
  WHERE id = p_bid_id AND bidder_id = p_user_id;

  IF v_bid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bid not found');
  END IF;

  IF v_bid.status NOT IN ('active', 'winning') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bid cannot be cancelled');
  END IF;

  -- Get auction
  SELECT * INTO v_auction
  FROM scheduled_auctions
  WHERE id = v_bid.auction_id;

  -- Can't cancel winning bid in last hour of auction
  IF v_bid.status = 'winning' AND v_auction.scheduled_end - NOW() < INTERVAL '1 hour' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel winning bid in final hour');
  END IF;

  -- Release cash
  PERFORM release_reserved_cash(p_user_id, v_bid.cash_reserved_cents, v_bid.id::TEXT);

  -- Update bid status
  UPDATE committed_bids
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = p_bid_id;

  -- Log activity
  INSERT INTO auction_activity_log (auction_id, bid_id, activity_type, user_id, old_value)
  VALUES (v_bid.auction_id, p_bid_id, 'bid_cancelled', p_user_id, v_bid.bid_amount);

  -- Update auction stats
  UPDATE scheduled_auctions
  SET
    total_committed_value = (
      SELECT COALESCE(SUM(bid_amount * shares_requested), 0)
      FROM committed_bids WHERE auction_id = v_bid.auction_id AND status IN ('active', 'winning')
    ),
    current_high_bid = (
      SELECT MAX(bid_amount)
      FROM committed_bids WHERE auction_id = v_bid.auction_id AND status IN ('active', 'winning')
    ),
    updated_at = NOW()
  WHERE id = v_bid.auction_id;

  -- Promote new winning bid
  UPDATE committed_bids
  SET status = 'winning'
  WHERE auction_id = v_bid.auction_id
    AND status = 'active'
    AND bid_amount = (
      SELECT MAX(bid_amount)
      FROM committed_bids WHERE auction_id = v_bid.auction_id AND status = 'active'
    );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Settle completed auction
CREATE OR REPLACE FUNCTION settle_auction(p_auction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auction RECORD;
  v_winning_bid RECORD;
  v_trade_id UUID;
BEGIN
  -- Get auction
  SELECT * INTO v_auction
  FROM scheduled_auctions
  WHERE id = p_auction_id;

  IF v_auction IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction not found');
  END IF;

  IF v_auction.status NOT IN ('ended', 'settling') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Auction cannot be settled yet');
  END IF;

  -- Get winning bid
  SELECT * INTO v_winning_bid
  FROM committed_bids
  WHERE auction_id = p_auction_id
    AND status = 'winning'
  ORDER BY bid_amount DESC
  LIMIT 1;

  IF v_winning_bid IS NULL THEN
    -- No bids or reserve not met
    UPDATE scheduled_auctions
    SET
      status = 'no_sale',
      actual_end = NOW(),
      updated_at = NOW()
    WHERE id = p_auction_id;

    -- Release all cash reservations
    UPDATE committed_bids
    SET status = 'lost'
    WHERE auction_id = p_auction_id AND status IN ('active', 'winning');

    INSERT INTO auction_activity_log (auction_id, activity_type, details)
    VALUES (p_auction_id, 'reserve_not_met', jsonb_build_object('reserve', v_auction.reserve_price));

    RETURN jsonb_build_object('success', true, 'result', 'no_sale');
  END IF;

  -- Check reserve met
  IF v_auction.reserve_price IS NOT NULL AND v_winning_bid.bid_amount < v_auction.reserve_price THEN
    UPDATE scheduled_auctions
    SET status = 'no_sale', actual_end = NOW(), updated_at = NOW()
    WHERE id = p_auction_id;

    INSERT INTO auction_activity_log (auction_id, activity_type, details)
    VALUES (p_auction_id, 'reserve_not_met', jsonb_build_object(
      'highest_bid', v_winning_bid.bid_amount,
      'reserve', v_auction.reserve_price
    ));

    RETURN jsonb_build_object('success', true, 'result', 'reserve_not_met');
  END IF;

  -- Update auction status to settling
  UPDATE scheduled_auctions
  SET status = 'settling', updated_at = NOW()
  WHERE id = p_auction_id;

  -- Execute the trade (transfer shares)
  v_trade_id := execute_share_transfer(
    v_auction.offering_id,
    v_auction.seller_id,
    v_winning_bid.bidder_id,
    v_auction.shares_offered,
    v_winning_bid.bid_amount,
    NULL,
    NULL
  );

  -- Mark winning bid
  UPDATE committed_bids
  SET status = 'won', updated_at = NOW()
  WHERE id = v_winning_bid.id;

  -- Mark all other bids as lost and release their cash
  UPDATE committed_bids
  SET status = 'lost', updated_at = NOW()
  WHERE auction_id = p_auction_id
    AND id != v_winning_bid.id
    AND status IN ('active', 'winning', 'outbid');

  -- Release cash for losing bids
  PERFORM release_reserved_cash(
    cb.bidder_id,
    cb.cash_reserved_cents,
    cb.id::TEXT
  )
  FROM committed_bids cb
  WHERE cb.auction_id = p_auction_id
    AND cb.status = 'lost'
    AND cb.cash_reserved_cents > 0;

  -- Complete auction
  UPDATE scheduled_auctions
  SET
    status = 'completed',
    actual_end = NOW(),
    winning_bid_id = v_winning_bid.id,
    final_price = v_winning_bid.bid_amount,
    winner_id = v_winning_bid.bidder_id,
    updated_at = NOW()
  WHERE id = p_auction_id;

  -- Log completion
  INSERT INTO auction_activity_log (auction_id, bid_id, activity_type, user_id, new_value, details)
  VALUES (p_auction_id, v_winning_bid.id, 'settlement_completed', v_winning_bid.bidder_id,
    v_winning_bid.bid_amount,
    jsonb_build_object('trade_id', v_trade_id, 'shares', v_auction.shares_offered));

  RETURN jsonb_build_object(
    'success', true,
    'result', 'completed',
    'winner_id', v_winning_bid.bidder_id,
    'final_price', v_winning_bid.bid_amount,
    'trade_id', v_trade_id
  );
END;
$$;

-- Get visible bid stack for an auction
CREATE OR REPLACE FUNCTION get_bid_stack(p_auction_id UUID)
RETURNS TABLE (
  bid_count INTEGER,
  total_committed DECIMAL(12,2),
  high_bid DECIMAL(12,2),
  reserve_met BOOLEAN,
  bids JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auction RECORD;
BEGIN
  SELECT * INTO v_auction FROM scheduled_auctions WHERE id = p_auction_id;

  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as bid_count,
    COALESCE(SUM(cb.bid_amount * cb.shares_requested), 0) as total_committed,
    MAX(cb.bid_amount) as high_bid,
    (MAX(cb.bid_amount) >= COALESCE(v_auction.reserve_price, 0)) as reserve_met,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', cb2.id,
        'amount', cb2.bid_amount,
        'shares', cb2.shares_requested,
        'display_name', COALESCE(cb2.display_name, 'Bidder ' || LEFT(cb2.bidder_id::TEXT, 4)),
        'is_winning', cb2.status = 'winning',
        'time', cb2.bid_time
      ) ORDER BY cb2.bid_amount DESC)
      FROM committed_bids cb2
      WHERE cb2.auction_id = p_auction_id
        AND cb2.is_visible = true
        AND cb2.status IN ('active', 'winning')
    ) as bids
  FROM committed_bids cb
  WHERE cb.auction_id = p_auction_id
    AND cb.status IN ('active', 'winning');
END;
$$;

-- =====================================================
-- RLS POLICIES
-- =====================================================

ALTER TABLE scheduled_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE committed_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_activity_log ENABLE ROW LEVEL SECURITY;

-- Scheduled Auctions: visible to all authenticated users when published
CREATE POLICY "Auctions visible when published" ON scheduled_auctions
  FOR SELECT USING (status != 'draft' OR seller_id = auth.uid());

-- Committed Bids: users see their own bids, visible bids shown to all
CREATE POLICY "Users see own bids" ON committed_bids
  FOR SELECT USING (bidder_id = auth.uid() OR (is_visible = true AND status IN ('active', 'winning')));

-- Activity Log: viewable for auction participants
CREATE POLICY "Activity log for participants" ON auction_activity_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM scheduled_auctions WHERE id = auction_id AND (seller_id = auth.uid() OR status != 'draft'))
    OR EXISTS (SELECT 1 FROM committed_bids WHERE auction_id = auction_activity_log.auction_id AND bidder_id = auth.uid())
  );

-- =====================================================
-- REALTIME SUBSCRIPTIONS
-- =====================================================

ALTER PUBLICATION supabase_realtime ADD TABLE scheduled_auctions;
ALTER PUBLICATION supabase_realtime ADD TABLE committed_bids;

COMMIT;
