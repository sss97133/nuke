-- Auction Timeline Events System
-- Extends timeline_events to support auction-specific events
-- This migration is idempotent and safe to run multiple times

-- Step 1: Drop the old constraint (if it exists)
DO $$
BEGIN
  -- Drop the constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'timeline_events_event_type_check'
  ) THEN
    ALTER TABLE timeline_events 
    DROP CONSTRAINT timeline_events_event_type_check;
  END IF;
END $$;

-- Step 2: Add new constraint with auction event types
-- Include all existing event types found in production
ALTER TABLE timeline_events
  ADD CONSTRAINT timeline_events_event_type_check 
  CHECK (event_type IN (
    -- Original event types
    'purchase', 'sale', 'registration', 'inspection', 'maintenance', 
    'repair', 'modification', 'accident', 'insurance_claim', 'recall',
    'ownership_transfer', 'lien_change', 'title_update', 'mileage_reading',
    -- Existing event types found in production
    'other', 'pending_analysis', 'profile_merge', 'profile_merged',
    'vehicle_added', 'vin_added', 'work_completed', 'service',
    -- NEW AUCTION EVENTS:
    'auction_listed',           -- Vehicle listed for auction
    'auction_started',          -- Auction goes live
    'auction_bid_placed',       -- Individual bid placed (milestone)
    'auction_reserve_met',      -- Reserve price reached
    'auction_extended',         -- Sniping protection activated
    'auction_ending_soon',      -- 24h warning
    'auction_ended',            -- Auction closed
    'auction_sold',             -- Sold via auction
    'auction_reserve_not_met'  -- Reserve not met
  ));

-- Step 3: Create function to create auction timeline events
CREATE OR REPLACE FUNCTION create_auction_timeline_event(
  p_vehicle_id UUID,
  p_event_type TEXT,
  p_listing_id UUID,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
  v_listing RECORD;
  v_vehicle RECORD;
  v_title TEXT;
  v_description TEXT;
  v_event_date DATE;
  v_receipt_amount NUMERIC(10,2);
BEGIN
  -- Get listing details
  SELECT * INTO v_listing
  FROM external_listings
  WHERE id = p_listing_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing % not found', p_listing_id;
  END IF;
  
  -- Get vehicle details
  SELECT * INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id;
  END IF;
  
  -- Set title and description based on event type
  CASE p_event_type
    WHEN 'auction_listed' THEN
      v_title := 'Listed for Auction';
      v_description := format('Vehicle listed on %s', 
        CASE v_listing.platform 
          WHEN 'bat' THEN 'Bring a Trailer'
          ELSE initcap(v_listing.platform)
        END
      );
      v_event_date := COALESCE((p_metadata->>'listed_date')::date, v_listing.created_at::date, CURRENT_DATE);
      
    WHEN 'auction_started' THEN
      v_title := 'Auction Started';
      v_description := format('Auction went live on %s', 
        CASE v_listing.platform 
          WHEN 'bat' THEN 'Bring a Trailer'
          ELSE initcap(v_listing.platform)
        END
      );
      v_event_date := COALESCE((p_metadata->>'start_date')::date, v_listing.start_date::date, CURRENT_DATE);
      
    WHEN 'auction_bid_placed' THEN
      v_title := format('Bid Placed: $%s', 
        to_char((p_metadata->>'bid_amount')::numeric, 'FM999,999,999')
      );
      v_description := format('Bid of $%s placed (%s total bids)', 
        to_char((p_metadata->>'bid_amount')::numeric, 'FM999,999,999'),
        COALESCE((p_metadata->>'bid_count')::text, v_listing.bid_count::text, '0')
      );
      v_event_date := COALESCE((p_metadata->>'bid_date')::date, CURRENT_DATE);
      v_receipt_amount := (p_metadata->>'bid_amount')::numeric;
      
    WHEN 'auction_reserve_met' THEN
      v_title := 'Reserve Met';
      v_description := format('Reserve price of $%s has been met', 
        to_char(COALESCE((p_metadata->>'reserve_price')::numeric, v_listing.reserve_price), 'FM999,999,999')
      );
      v_event_date := CURRENT_DATE;
      
    WHEN 'auction_extended' THEN
      v_title := 'Auction Extended';
      v_description := format('Auction extended by %s minutes due to recent bid', 
        COALESCE((p_metadata->>'extension_minutes')::text, '2')
      );
      v_event_date := CURRENT_DATE;
      
    WHEN 'auction_ending_soon' THEN
      v_title := 'Auction Ending Soon';
      v_description := 'Auction ending within 24 hours';
      v_event_date := CURRENT_DATE;
      
    WHEN 'auction_ended' THEN
      v_title := 'Auction Ended';
      v_description := format('Auction closed with %s bids, high bid: $%s', 
        COALESCE(v_listing.bid_count::text, '0'),
        to_char(COALESCE(v_listing.current_bid, 0), 'FM999,999,999')
      );
      v_event_date := COALESCE(v_listing.end_date::date, CURRENT_DATE);
      
    WHEN 'auction_sold' THEN
      v_title := 'Sold at Auction';
      v_description := format('Sold for $%s on %s', 
        to_char(COALESCE(v_listing.final_price, v_listing.current_bid, 0), 'FM999,999,999'),
        CASE v_listing.platform 
          WHEN 'bat' THEN 'Bring a Trailer'
          ELSE initcap(v_listing.platform)
        END
      );
      v_event_date := COALESCE(v_listing.sold_at::date, v_listing.end_date::date, CURRENT_DATE);
      v_receipt_amount := COALESCE(v_listing.final_price, v_listing.current_bid);
      
    WHEN 'auction_reserve_not_met' THEN
      v_title := 'Reserve Not Met';
      v_description := format('Auction ended but reserve of $%s was not met', 
        to_char(COALESCE(v_listing.reserve_price, 0), 'FM999,999,999')
      );
      v_event_date := COALESCE(v_listing.end_date::date, CURRENT_DATE);
      
    ELSE
      v_title := 'Auction Event';
      v_description := COALESCE(p_metadata->>'description', 'Auction activity');
      v_event_date := CURRENT_DATE;
  END CASE;
  
  -- Create timeline event
  INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    event_category,
    title,
    description,
    event_date,
    source,
    source_type,
    confidence_score,
    metadata,
    cost_amount,
    image_urls
  ) VALUES (
    p_vehicle_id,
    NULL, -- System-generated event
    p_event_type,
    'ownership', -- Auction events are ownership-related
    v_title,
    v_description,
    v_event_date,
    CASE v_listing.platform 
      WHEN 'bat' THEN 'Bring a Trailer'
      ELSE initcap(v_listing.platform)
    END, -- source column
    'dealer_record', -- Auction platforms are dealer records
    95, -- High confidence for platform data
    jsonb_build_object(
      'listing_id', p_listing_id,
      'platform', v_listing.platform,
      'listing_url', v_listing.listing_url,
      'auction_data', p_metadata,
      'affects_value', true -- Auctions always affect value
    ) || COALESCE(p_metadata, '{}'::jsonb),
    v_receipt_amount,
    CASE WHEN v_listing.listing_url IS NOT NULL 
      THEN ARRAY[v_listing.listing_url] 
      ELSE ARRAY[]::TEXT[] 
    END
  ) RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Step 4: Create trigger function to track auction phase transitions
CREATE OR REPLACE FUNCTION track_auction_phase_transitions()
RETURNS TRIGGER AS $$
DECLARE
  v_previous_status TEXT;
  v_reserve_met BOOLEAN;
BEGIN
  -- Track status transitions
  IF OLD.listing_status IS DISTINCT FROM NEW.listing_status THEN
    -- Auction started (draft/upcoming → active)
    IF NEW.listing_status = 'active' AND (OLD.listing_status IS NULL OR OLD.listing_status != 'active') THEN
      PERFORM create_auction_timeline_event(
        NEW.vehicle_id,
        'auction_started',
        NEW.id,
        jsonb_build_object(
          'start_date', NEW.start_date,
          'end_date', NEW.end_date,
          'platform', NEW.platform,
          'previous_status', OLD.listing_status
        )
      );
    END IF;
    
    -- Auction ended
    IF NEW.listing_status = 'ended' AND OLD.listing_status = 'active' THEN
      PERFORM create_auction_timeline_event(
        NEW.vehicle_id,
        'auction_ended',
        NEW.id,
        jsonb_build_object(
          'final_bid', NEW.current_bid,
          'bid_count', NEW.bid_count,
          'reserve_met', COALESCE(NEW.current_bid, 0) >= COALESCE(NEW.reserve_price, 0)
        )
      );
    END IF;
    
    -- Auction sold
    IF NEW.listing_status = 'sold' AND OLD.listing_status != 'sold' THEN
      PERFORM create_auction_timeline_event(
        NEW.vehicle_id,
        'auction_sold',
        NEW.id,
        jsonb_build_object(
          'final_price', NEW.final_price,
          'sold_at', NEW.sold_at,
          'bid_count', NEW.bid_count,
          'watcher_count', NEW.watcher_count,
          'view_count', NEW.view_count
        )
      );
    END IF;
  END IF;
  
  -- Track reserve being met (when current_bid crosses reserve_price)
  IF NEW.current_bid IS NOT NULL 
     AND OLD.current_bid IS NOT NULL
     AND NEW.reserve_price IS NOT NULL
     AND OLD.current_bid < NEW.reserve_price
     AND NEW.current_bid >= NEW.reserve_price THEN
    PERFORM create_auction_timeline_event(
      NEW.vehicle_id,
      'auction_reserve_met',
      NEW.id,
      jsonb_build_object(
        'reserve_price', NEW.reserve_price,
        'current_bid', NEW.current_bid,
        'bid_count', NEW.bid_count
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Step 5: Create trigger
DROP TRIGGER IF EXISTS track_auction_transitions ON external_listings;
CREATE TRIGGER track_auction_transitions
  AFTER INSERT OR UPDATE ON external_listings
  FOR EACH ROW
  EXECUTE FUNCTION track_auction_phase_transitions();

-- Step 6: Grant permissions
GRANT EXECUTE ON FUNCTION create_auction_timeline_event(UUID, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION create_auction_timeline_event(UUID, TEXT, UUID, JSONB) TO service_role;

-- Add comments
COMMENT ON FUNCTION create_auction_timeline_event IS 
  'Creates timeline events for auction milestones (listing, bids, reserve met, sale, etc.)';

COMMENT ON FUNCTION track_auction_phase_transitions IS 
  'Automatically creates timeline events when auction status changes or reserve is met';

