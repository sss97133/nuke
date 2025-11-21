-- AI Auction Agent Suggestions System
-- Proactive marketplace intelligence that watches auctions and suggests opportunities to owners

CREATE TABLE IF NOT EXISTS auction_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Opportunity details
  opportunity_type TEXT NOT NULL CHECK (opportunity_type IN (
    'scheduled_lot',      -- Matches upcoming scheduled auction
    'trending_category', -- Vehicle type is trending
    'price_match',       -- Price range matches active auctions
    'similar_sold'       -- Similar vehicle just sold well
  )),
  
  scheduled_auction_id UUID REFERENCES vehicle_listings(id),
  
  -- AI-generated pitch
  pitch_message TEXT NOT NULL,
  pitch_reason TEXT NOT NULL,
  
  -- Suggested auction parameters
  suggested_reserve_cents BIGINT,
  suggested_duration_minutes INTEGER,
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  
  -- Market data that informed this suggestion
  market_data JSONB DEFAULT '{}'::jsonb,
  
  -- Owner response
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',    -- Owner hasn't responded
    'accepted',   -- Owner accepted, listing created
    'declined',   -- Owner declined
    'expired'     -- Suggestion expired (market changed)
  )),
  
  owner_response_at TIMESTAMPTZ,
  listing_id UUID REFERENCES vehicle_listings(id), -- If accepted, link to created listing
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Expiration (suggestions expire after 7 days)
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_auction_suggestions_vehicle ON auction_suggestions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_auction_suggestions_owner ON auction_suggestions(owner_id);
CREATE INDEX IF NOT EXISTS idx_auction_suggestions_status ON auction_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_auction_suggestions_opportunity ON auction_suggestions(opportunity_type);
CREATE INDEX IF NOT EXISTS idx_auction_suggestions_pending ON auction_suggestions(owner_id, status) 
  WHERE status = 'pending';

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_auction_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_auction_suggestions_updated_at ON auction_suggestions;
CREATE TRIGGER update_auction_suggestions_updated_at
  BEFORE UPDATE ON auction_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_auction_suggestions_updated_at();

-- Auto-expire old suggestions
CREATE OR REPLACE FUNCTION expire_old_suggestions()
RETURNS void AS $$
BEGIN
  UPDATE auction_suggestions
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE auction_suggestions ENABLE ROW LEVEL SECURITY;

-- Owners can view their own suggestions
CREATE POLICY "owners_view_own_suggestions" ON auction_suggestions
  FOR SELECT USING (owner_id = auth.uid());

-- Owners can update their own suggestions (accept/decline)
CREATE POLICY "owners_update_own_suggestions" ON auction_suggestions
  FOR UPDATE USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Function to accept a suggestion and create listing
CREATE OR REPLACE FUNCTION accept_auction_suggestion(p_suggestion_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_suggestion RECORD;
  v_listing_id UUID;
BEGIN
  -- Get suggestion
  SELECT * INTO v_suggestion
  FROM auction_suggestions
  WHERE id = p_suggestion_id
    AND owner_id = auth.uid()
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Suggestion not found or already processed');
  END IF;
  
  -- Check if vehicle is already listed
  IF EXISTS (
    SELECT 1 FROM vehicle_listings
    WHERE vehicle_id = v_suggestion.vehicle_id
      AND status IN ('active', 'draft')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vehicle is already listed');
  END IF;
  
  -- Create listing from suggestion
  INSERT INTO vehicle_listings (
    vehicle_id,
    seller_id,
    sale_type,
    reserve_price_cents,
    auction_duration_minutes,
    sniping_protection_minutes,
    status,
    description,
    auction_start_time,
    auction_end_time,
    metadata
  ) VALUES (
    v_suggestion.vehicle_id,
    v_suggestion.owner_id,
    CASE 
      WHEN v_suggestion.scheduled_auction_id IS NOT NULL THEN 'live_auction'
      ELSE 'auction'
    END,
    v_suggestion.suggested_reserve_cents,
    COALESCE(v_suggestion.suggested_duration_minutes, 7 * 24 * 60),
    2, -- Default sniping protection
    'draft', -- Start as draft, owner can activate
    v_suggestion.pitch_reason,
    CASE 
      WHEN v_suggestion.scheduled_auction_id IS NOT NULL THEN
        (SELECT auction_start_time FROM vehicle_listings WHERE id = v_suggestion.scheduled_auction_id)
      ELSE NOW()
    END,
    CASE 
      WHEN v_suggestion.scheduled_auction_id IS NOT NULL THEN
        (SELECT auction_start_time FROM vehicle_listings WHERE id = v_suggestion.scheduled_auction_id) +
        (v_suggestion.suggested_duration_minutes || ' minutes')::INTERVAL
      ELSE NOW() + (COALESCE(v_suggestion.suggested_duration_minutes, 7 * 24 * 60) || ' minutes')::INTERVAL
    END,
    jsonb_build_object(
      'suggestion_id', v_suggestion.id,
      'opportunity_type', v_suggestion.opportunity_type,
      'ai_generated', true
    )
  ) RETURNING id INTO v_listing_id;
  
  -- Update suggestion
  UPDATE auction_suggestions
  SET
    status = 'accepted',
    owner_response_at = NOW(),
    listing_id = v_listing_id,
    updated_at = NOW()
  WHERE id = p_suggestion_id;
  
  -- Trigger AI review for the new listing
  -- (This will be called by the review function)
  
  RETURN jsonb_build_object(
    'success', true,
    'listing_id', v_listing_id,
    'message', 'Listing created from suggestion'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

GRANT EXECUTE ON FUNCTION accept_auction_suggestion(UUID) TO authenticated;

-- Function to decline a suggestion
CREATE OR REPLACE FUNCTION decline_auction_suggestion(p_suggestion_id UUID)
RETURNS JSONB AS $$
BEGIN
  UPDATE auction_suggestions
  SET
    status = 'declined',
    owner_response_at = NOW(),
    updated_at = NOW()
  WHERE id = p_suggestion_id
    AND owner_id = auth.uid()
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Suggestion not found');
  END IF;
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

GRANT EXECUTE ON FUNCTION decline_auction_suggestion(UUID) TO authenticated;

COMMENT ON TABLE auction_suggestions IS 'AI-generated auction opportunities suggested to vehicle owners';
COMMENT ON FUNCTION accept_auction_suggestion IS 'Accept an AI suggestion and create auction listing';
COMMENT ON FUNCTION decline_auction_suggestion IS 'Decline an AI suggestion';

