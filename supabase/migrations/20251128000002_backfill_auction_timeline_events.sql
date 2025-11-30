-- Backfill timeline events for existing external_listings
-- Creates "auction_listed" events for all existing listings
-- Creates "auction_sold" events for sold listings

DO $$
DECLARE
  v_listing RECORD;
  v_event_id UUID;
  v_count INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting backfill of auction timeline events...';
  
  -- Loop through all external_listings
  FOR v_listing IN 
    SELECT * FROM external_listings
    WHERE vehicle_id IS NOT NULL
    ORDER BY created_at
  LOOP
    -- Create "auction_listed" event if listing exists
    BEGIN
      -- Check if event already exists
      IF NOT EXISTS (
        SELECT 1 FROM timeline_events
        WHERE vehicle_id = v_listing.vehicle_id
          AND event_type = 'auction_listed'
          AND metadata->>'listing_id' = v_listing.id::text
      ) THEN
        v_event_id := create_auction_timeline_event(
          v_listing.vehicle_id,
          'auction_listed',
          v_listing.id,
          jsonb_build_object(
            'listed_date', v_listing.created_at::date,
            'platform', v_listing.platform,
            'backfilled', true
          )
        );
        v_count := v_count + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Skip if event already exists or vehicle missing
      RAISE NOTICE 'Skipped listing %: %', v_listing.id, SQLERRM;
      v_skipped := v_skipped + 1;
    END;
    
    -- Create "auction_started" if active
    IF v_listing.listing_status = 'active' THEN
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM timeline_events
          WHERE vehicle_id = v_listing.vehicle_id
            AND event_type = 'auction_started'
            AND metadata->>'listing_id' = v_listing.id::text
        ) THEN
          v_event_id := create_auction_timeline_event(
            v_listing.vehicle_id,
            'auction_started',
            v_listing.id,
            jsonb_build_object(
              'start_date', COALESCE(v_listing.start_date::date, v_listing.created_at::date),
              'backfilled', true
            )
          );
          v_count := v_count + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipped auction_started for %: %', v_listing.id, SQLERRM;
      END;
    END IF;
    
    -- Create "auction_sold" if sold
    IF v_listing.listing_status = 'sold' AND v_listing.final_price IS NOT NULL THEN
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM timeline_events
          WHERE vehicle_id = v_listing.vehicle_id
            AND event_type = 'auction_sold'
            AND metadata->>'listing_id' = v_listing.id::text
        ) THEN
          v_event_id := create_auction_timeline_event(
            v_listing.vehicle_id,
            'auction_sold',
            v_listing.id,
            jsonb_build_object(
              'final_price', v_listing.final_price,
              'sold_at', COALESCE(v_listing.sold_at, v_listing.end_date),
              'bid_count', v_listing.bid_count,
              'backfilled', true
            )
          );
          v_count := v_count + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipped auction_sold for %: %', v_listing.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Backfill complete: % events created, % skipped', v_count, v_skipped;
END $$;

