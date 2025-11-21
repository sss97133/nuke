-- Auction Notification Triggers
-- Sends notifications for bid updates, auction ending soon, and auction results

-- =====================================================
-- NOTIFICATION TRIGGERS FOR AUCTION BIDS
-- =====================================================

CREATE OR REPLACE FUNCTION notify_auction_bid_placed()
RETURNS TRIGGER AS $$
DECLARE
  v_listing RECORD;
  v_vehicle RECORD;
  v_seller_id UUID;
  v_previous_high_bidder_id UUID;
BEGIN
  -- Get listing details
  SELECT * INTO v_listing
  FROM vehicle_listings
  WHERE id = NEW.listing_id;
  
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  
  -- Get vehicle details
  SELECT * INTO v_vehicle
  FROM vehicles
  WHERE id = v_listing.vehicle_id;
  
  v_seller_id := v_listing.seller_id;
  
  -- Notify seller of new bid
  INSERT INTO user_notifications (
    user_id,
    event_id,
    channel_type,
    notification_title,
    notification_body,
    action_url
  ) VALUES (
    v_seller_id,
    NULL,
    'in_app',
    'New Bid on Your Auction',
    format('Your %s %s %s received a bid of $%s', 
      v_vehicle.year, v_vehicle.make, v_vehicle.model,
      (NEW.displayed_bid_cents::NUMERIC / 100)::TEXT),
    format('/listings/%s', v_listing.id)
  );
  
  -- Notify previous high bidder if they were outbid
  IF NEW.is_winning = TRUE AND NEW.bidder_id != v_listing.current_high_bidder_id THEN
    SELECT current_high_bidder_id INTO v_previous_high_bidder_id
    FROM vehicle_listings
    WHERE id = NEW.listing_id;
    
    -- This will be updated by the place_auction_bid function, but we check here
    -- to notify the previous bidder
    IF v_previous_high_bidder_id IS NOT NULL AND v_previous_high_bidder_id != NEW.bidder_id THEN
      INSERT INTO user_notifications (
        user_id,
        event_id,
        channel_type,
        notification_title,
        notification_body,
        action_url
      ) VALUES (
        v_previous_high_bidder_id,
        NULL,
        'in_app',
        'You Were Outbid',
        format('Your bid on %s %s %s was outbid. Current high bid: $%s',
          v_vehicle.year, v_vehicle.make, v_vehicle.model,
          (NEW.displayed_bid_cents::NUMERIC / 100)::TEXT),
        format('/listings/%s', v_listing.id)
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_auction_bid ON auction_bids;
CREATE TRIGGER trigger_notify_auction_bid
  AFTER INSERT ON auction_bids
  FOR EACH ROW
  EXECUTE FUNCTION notify_auction_bid_placed();

-- =====================================================
-- AUCTION ENDING SOON NOTIFICATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION notify_auction_ending_soon()
RETURNS void AS $$
DECLARE
  v_listing RECORD;
  v_vehicle RECORD;
  v_bidder RECORD;
BEGIN
  -- Find auctions ending in the next hour
  FOR v_listing IN
    SELECT * FROM vehicle_listings
    WHERE sale_type IN ('auction', 'live_auction')
      AND status = 'active'
      AND auction_end_time IS NOT NULL
      AND auction_end_time > NOW()
      AND auction_end_time <= NOW() + INTERVAL '1 hour'
      AND auction_end_time > NOW() + INTERVAL '55 minutes' -- Only notify once per hour
  LOOP
    -- Get vehicle details
    SELECT * INTO v_vehicle
    FROM vehicles
    WHERE id = v_listing.vehicle_id;
    
    -- Notify seller
    INSERT INTO user_notifications (
      user_id,
      event_id,
      channel_type,
      notification_title,
      notification_body,
      action_url
    )
    SELECT
      v_listing.seller_id,
      NULL,
      'in_app',
      'Auction Ending Soon',
      format('Your auction for %s %s %s ends in less than 1 hour. Current bid: $%s',
        v_vehicle.year, v_vehicle.make, v_vehicle.model,
        (COALESCE(v_listing.current_high_bid_cents, 0)::NUMERIC / 100)::TEXT),
      format('/listings/%s', v_listing.id)
    WHERE NOT EXISTS (
      SELECT 1 FROM user_notifications
      WHERE user_id = v_listing.seller_id
        AND notification_title = 'Auction Ending Soon'
        AND created_at > NOW() - INTERVAL '1 hour'
        AND action_url = format('/listings/%s', v_listing.id)
    );
    
    -- Notify all bidders
    FOR v_bidder IN
      SELECT DISTINCT bidder_id
      FROM auction_bids
      WHERE listing_id = v_listing.id
    LOOP
      INSERT INTO user_notifications (
        user_id,
        event_id,
        channel_type,
        notification_title,
        notification_body,
        action_url
      )
      SELECT
        v_bidder.bidder_id,
        NULL,
        'in_app',
        'Auction Ending Soon',
        format('Auction for %s %s %s ends in less than 1 hour. Current bid: $%s',
          v_vehicle.year, v_vehicle.make, v_vehicle.model,
          (COALESCE(v_listing.current_high_bid_cents, 0)::NUMERIC / 100)::TEXT),
        format('/listings/%s', v_listing.id)
      WHERE NOT EXISTS (
        SELECT 1 FROM user_notifications
        WHERE user_id = v_bidder.bidder_id
          AND notification_title = 'Auction Ending Soon'
          AND created_at > NOW() - INTERVAL '1 hour'
          AND action_url = format('/listings/%s', v_listing.id)
      );
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- AUCTION ENDED NOTIFICATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION notify_auction_ended()
RETURNS TRIGGER AS $$
DECLARE
  v_vehicle RECORD;
  v_bidder RECORD;
  v_reserve_met BOOLEAN;
BEGIN
  -- Only trigger when status changes to 'sold' or 'expired'
  IF OLD.status = 'active' AND NEW.status IN ('sold', 'expired') THEN
    -- Get vehicle details
    SELECT * INTO v_vehicle
    FROM vehicles
    WHERE id = NEW.vehicle_id;
    
    v_reserve_met := NEW.status = 'sold';
    
    -- Notify seller
    INSERT INTO user_notifications (
      user_id,
      event_id,
      channel_type,
      notification_title,
      notification_body,
      action_url
    ) VALUES (
      NEW.seller_id,
      NULL,
      'in_app',
      CASE WHEN v_reserve_met THEN 'Auction Sold' ELSE 'Auction Ended - Reserve Not Met' END,
      CASE 
        WHEN v_reserve_met THEN
          format('Your auction for %s %s %s sold for $%s',
            v_vehicle.year, v_vehicle.make, v_vehicle.model,
            (NEW.sold_price_cents::NUMERIC / 100)::TEXT)
        ELSE
          format('Your auction for %s %s %s ended. Reserve price was not met.',
            v_vehicle.year, v_vehicle.make, v_vehicle.model)
      END,
      format('/listings/%s', NEW.id)
    );
    
    -- Notify winning bidder if sold
    IF v_reserve_met AND NEW.buyer_id IS NOT NULL THEN
      INSERT INTO user_notifications (
        user_id,
        event_id,
        channel_type,
        notification_title,
        notification_body,
        action_url
      ) VALUES (
        NEW.buyer_id,
        NULL,
        'in_app',
        'You Won the Auction!',
        format('Congratulations! You won the auction for %s %s %s for $%s',
          v_vehicle.year, v_vehicle.make, v_vehicle.model,
          (NEW.sold_price_cents::NUMERIC / 100)::TEXT),
        format('/listings/%s', NEW.id)
      );
    END IF;
    
    -- Notify all other bidders
    FOR v_bidder IN
      SELECT DISTINCT bidder_id
      FROM auction_bids
      WHERE listing_id = NEW.id
        AND bidder_id != COALESCE(NEW.buyer_id, '00000000-0000-0000-0000-000000000000'::UUID)
    LOOP
      INSERT INTO user_notifications (
        user_id,
        event_id,
        channel_type,
        notification_title,
        notification_body,
        action_url
      ) VALUES (
        v_bidder.bidder_id,
        NULL,
        'in_app',
        'Auction Ended',
        format('The auction for %s %s %s has ended.',
          v_vehicle.year, v_vehicle.make, v_vehicle.model),
        format('/listings/%s', NEW.id)
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_auction_ended ON vehicle_listings;
CREATE TRIGGER trigger_notify_auction_ended
  AFTER UPDATE ON vehicle_listings
  FOR EACH ROW
  WHEN (OLD.status = 'active' AND NEW.status IN ('sold', 'expired'))
  EXECUTE FUNCTION notify_auction_ended();

-- =====================================================
-- SCHEDULED JOB TO CHECK ENDING SOON AUCTIONS
-- =====================================================
-- Note: This should be called by a cron job or scheduled Edge Function
-- For now, we'll create a function that can be called manually or via cron

COMMENT ON FUNCTION notify_auction_ending_soon IS 'Call this function periodically (e.g., every 5 minutes) to notify users of auctions ending soon';
COMMENT ON FUNCTION notify_auction_bid_placed IS 'Triggered automatically when a bid is placed';
COMMENT ON FUNCTION notify_auction_ended IS 'Triggered automatically when an auction ends';

