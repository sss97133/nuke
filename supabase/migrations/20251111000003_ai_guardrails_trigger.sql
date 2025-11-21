-- AI Guardrails Trigger
-- Automatically reviews auction listings when they're created or updated

CREATE OR REPLACE FUNCTION trigger_ai_auction_review()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for auction-type listings
  IF NEW.sale_type IN ('auction', 'live_auction') THEN
    -- Mark as pending review when created or when status changes to draft/active
    IF (TG_OP = 'INSERT' OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('draft', 'active'))) THEN
      -- Set initial review status
      IF NEW.ai_review_status IS NULL THEN
        NEW.ai_review_status := 'pending';
      END IF;
      
      -- Note: The actual AI review will be triggered by the Edge Function
      -- This trigger just ensures the status is set
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ai_auction_review_insert ON vehicle_listings;
CREATE TRIGGER trigger_ai_auction_review_insert
  BEFORE INSERT ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION trigger_ai_auction_review();

DROP TRIGGER IF EXISTS trigger_ai_auction_review_update ON vehicle_listings;
CREATE TRIGGER trigger_ai_auction_review_update
  BEFORE UPDATE ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION trigger_ai_auction_review();

-- Function to check if listing can be activated
CREATE OR REPLACE FUNCTION can_activate_auction(p_listing_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_listing RECORD;
BEGIN
  SELECT * INTO v_listing
  FROM vehicle_listings
  WHERE id = p_listing_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_activate', false, 'reason', 'Listing not found');
  END IF;
  
  -- Check if already active
  IF v_listing.status = 'active' THEN
    RETURN jsonb_build_object('can_activate', false, 'reason', 'Already active');
  END IF;
  
  -- Check AI review status
  IF v_listing.ai_review_status = 'rejected' THEN
    RETURN jsonb_build_object('can_activate', false, 'reason', 'Listing was rejected by AI review');
  END IF;
  
  -- If pending or needs_review, allow but warn
  IF v_listing.ai_review_status IN ('pending', 'needs_review') THEN
    RETURN jsonb_build_object(
      'can_activate', true,
      'warning', 'Listing has not been fully reviewed yet',
      'review_status', v_listing.ai_review_status
    );
  END IF;
  
  -- Approved or no review yet - allow activation
  RETURN jsonb_build_object('can_activate', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

GRANT EXECUTE ON FUNCTION can_activate_auction(UUID) TO authenticated;

COMMENT ON FUNCTION trigger_ai_auction_review IS 'Automatically sets AI review status when auction listings are created or updated';
COMMENT ON FUNCTION can_activate_auction IS 'Checks if an auction listing can be activated based on AI review status';

