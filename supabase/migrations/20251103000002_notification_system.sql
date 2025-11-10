-- Comprehensive notification system for vehicle listings and status changes
-- Designed for fair play with external sales channels like Bring a Trailer

-- Notification channels table
CREATE TABLE IF NOT EXISTS notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('in_app', 'email', 'sms', 'push', 'webhook')),
  is_enabled BOOLEAN DEFAULT TRUE,
  preferences JSONB DEFAULT '{}', -- Channel-specific settings
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, channel_type)
);

-- User subscriptions (what they want to be notified about)
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_type TEXT NOT NULL CHECK (subscription_type IN (
    'dealer_new_listings',      -- All new listings from a dealer
    'dealer_price_drops',        -- Price reductions
    'vehicle_status_change',     -- Specific vehicle status updates
    'auction_starting',          -- Vehicle going to auction soon
    'similar_vehicles',          -- Similar to vehicles user owns/likes
    'make_model',                -- Specific make/model alerts
    'price_range',               -- Vehicles in price range
    'location_radius'            -- Vehicles within geographic area
  )),
  target_id UUID,                -- Organization ID, vehicle ID, etc.
  filters JSONB DEFAULT '{}',    -- Make, model, year range, price range, location
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification events table
CREATE TABLE IF NOT EXISTS notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'vehicle_listed',            -- New vehicle for sale
    'vehicle_price_change',      -- Price updated
    'vehicle_status_change',     -- Status changed (for_sale, sold, etc.)
    'auction_announced',         -- Going to BaT/auction
    'auction_ending_soon',       -- Auction ending in 24h
    'vehicle_sold',              -- Vehicle sold
    'new_images_added',          -- New photos uploaded
    'dealer_inventory_update'    -- Dealer added multiple vehicles
  )),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('vehicle', 'organization')),
  entity_id UUID NOT NULL,
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',  -- Vehicle details, pricing, links
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Notifications sent to users
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES notification_events(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  notification_title TEXT NOT NULL,
  notification_body TEXT NOT NULL,
  action_url TEXT,               -- Link to vehicle, BaT listing, etc.
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT
);

-- External listing integrations (BaT, Cars & Bids, eBay Motors, etc.)
CREATE TABLE IF NOT EXISTS external_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('bat', 'cars_and_bids', 'ebay_motors', 'hemmings', 'autotrader', 'facebook_marketplace')),
  listing_url TEXT NOT NULL,
  listing_id TEXT,               -- External platform's ID
  listing_status TEXT NOT NULL CHECK (listing_status IN ('pending', 'active', 'ended', 'sold', 'cancelled')),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  current_bid NUMERIC,
  reserve_price NUMERIC,
  buy_now_price NUMERIC,
  bid_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  watcher_count INTEGER DEFAULT 0,
  final_price NUMERIC,
  sold_at TIMESTAMPTZ,
  commission_rate NUMERIC,       -- N-Zero's commission if applicable
  affiliate_link TEXT,           -- Referral link for fair play
  sync_enabled BOOLEAN DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vehicle_id, platform, listing_id)
);

-- Fair play policy tracking
CREATE TABLE IF NOT EXISTS listing_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  first_listed_platform TEXT NOT NULL,  -- Where it was listed first
  first_listed_at TIMESTAMPTZ NOT NULL,
  n_zero_listed_first BOOLEAN NOT NULL, -- Did N-Zero list it before external platforms?
  external_listing_id UUID REFERENCES external_listings(id),
  commission_eligible BOOLEAN DEFAULT FALSE,  -- Can N-Zero take commission?
  attribution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_channels_user ON notification_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_type ON user_subscriptions(subscription_type, is_active);
CREATE INDEX IF NOT EXISTS idx_notification_events_entity ON notification_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_created ON notification_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_user_notifications_created ON user_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_listings_vehicle ON external_listings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_external_listings_org ON external_listings(organization_id);
CREATE INDEX IF NOT EXISTS idx_external_listings_status ON external_listings(listing_status, platform);

-- RLS Policies
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_attribution ENABLE ROW LEVEL SECURITY;

-- Users can manage their own notification channels
CREATE POLICY "Users manage own notification channels" ON notification_channels
  FOR ALL USING (auth.uid() = user_id);

-- Users can manage their own subscriptions
CREATE POLICY "Users manage own subscriptions" ON user_subscriptions
  FOR ALL USING (auth.uid() = user_id);

-- Everyone can view notification events (public events)
CREATE POLICY "Anyone can view notification events" ON notification_events
  FOR SELECT USING (TRUE);

-- Only system can create notification events (via Edge Function)
CREATE POLICY "System creates notification events" ON notification_events
  FOR INSERT WITH CHECK (FALSE);  -- Will use service role

-- Users can view their own notifications
CREATE POLICY "Users view own notifications" ON user_notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update read status on their notifications
CREATE POLICY "Users update own notifications" ON user_notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Everyone can view external listings (public data)
CREATE POLICY "Anyone can view external listings" ON external_listings
  FOR SELECT USING (TRUE);

-- Organization owners can create/update external listings
CREATE POLICY "Org owners manage external listings" ON external_listings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM organization_contributors
      WHERE organization_id = external_listings.organization_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'co_founder', 'board_member', 'manager')
    )
  );

-- Anyone can view attribution (transparency)
CREATE POLICY "Anyone can view listing attribution" ON listing_attribution
  FOR SELECT USING (TRUE);

-- Trigger to create notification event when vehicle status changes
CREATE OR REPLACE FUNCTION trigger_vehicle_status_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger if listing_status changed
  IF OLD.listing_status IS DISTINCT FROM NEW.listing_status THEN
    INSERT INTO notification_events (
      event_type,
      entity_type,
      entity_id,
      metadata
    )
    SELECT
      CASE 
        WHEN NEW.listing_status = 'for_sale' THEN 'vehicle_listed'
        WHEN NEW.listing_status = 'sold' THEN 'vehicle_sold'
        WHEN NEW.listing_status = 'auction_soon' THEN 'auction_announced'
        ELSE 'vehicle_status_change'
      END,
      'vehicle',
      NEW.vehicle_id,
      jsonb_build_object(
        'organization_id', NEW.organization_id,
        'old_status', OLD.listing_status,
        'new_status', NEW.listing_status,
        'asking_price', NEW.asking_price,
        'days_on_lot', NEW.days_on_lot
      );
  END IF;
  
  -- Trigger if price changed significantly (>5%)
  IF OLD.asking_price IS NOT NULL AND NEW.asking_price IS NOT NULL 
     AND ABS(NEW.asking_price - OLD.asking_price) / OLD.asking_price > 0.05 THEN
    INSERT INTO notification_events (
      event_type,
      entity_type,
      entity_id,
      metadata
    ) VALUES (
      'vehicle_price_change',
      'vehicle',
      NEW.vehicle_id,
      jsonb_build_object(
        'organization_id', NEW.organization_id,
        'old_price', OLD.asking_price,
        'new_price', NEW.asking_price,
        'price_change_percent', ((NEW.asking_price - OLD.asking_price) / OLD.asking_price * 100)
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_status_notification ON organization_vehicles;
CREATE TRIGGER trg_vehicle_status_notification
  AFTER UPDATE ON organization_vehicles
  FOR EACH ROW EXECUTE FUNCTION trigger_vehicle_status_notification();

-- Function to process notifications and send to subscribed users
CREATE OR REPLACE FUNCTION process_notification_event(event_id_param UUID)
RETURNS INTEGER AS $$
DECLARE
  event_record RECORD;
  subscription_record RECORD;
  vehicle_record RECORD;
  org_record RECORD;
  notification_count INTEGER := 0;
  notification_title TEXT;
  notification_body TEXT;
  action_url TEXT;
BEGIN
  -- Get the event
  SELECT * INTO event_record FROM notification_events WHERE id = event_id_param;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  -- Get vehicle details if applicable
  IF event_record.entity_type = 'vehicle' THEN
    SELECT v.*, ov.organization_id, ov.asking_price
    INTO vehicle_record
    FROM vehicles v
    JOIN organization_vehicles ov ON v.id = ov.vehicle_id
    WHERE v.id = event_record.entity_id;
    
    -- Get organization details
    SELECT * INTO org_record FROM businesses WHERE id = vehicle_record.organization_id;
    
    -- Build notification content
    notification_title := CASE event_record.event_type
      WHEN 'vehicle_listed' THEN format('%s %s %s Just Listed!', vehicle_record.year, vehicle_record.make, vehicle_record.model)
      WHEN 'vehicle_price_change' THEN format('Price Drop: %s %s %s', vehicle_record.year, vehicle_record.make, vehicle_record.model)
      WHEN 'auction_announced' THEN format('Going to Auction: %s %s %s', vehicle_record.year, vehicle_record.make, vehicle_record.model)
      WHEN 'vehicle_sold' THEN format('SOLD: %s %s %s', vehicle_record.year, vehicle_record.make, vehicle_record.model)
      ELSE 'Vehicle Update'
    END;
    
    notification_body := CASE event_record.event_type
      WHEN 'vehicle_listed' THEN format('%s just listed a %s %s %s for $%s', org_record.business_name, vehicle_record.year, vehicle_record.make, vehicle_record.model, vehicle_record.asking_price)
      WHEN 'vehicle_price_change' THEN format('Price changed from $%s to $%s (%s%%)', 
        event_record.metadata->>'old_price', 
        event_record.metadata->>'new_price',
        ROUND((event_record.metadata->>'price_change_percent')::NUMERIC, 1))
      WHEN 'auction_announced' THEN format('%s is taking this vehicle to auction soon!', org_record.business_name)
      WHEN 'vehicle_sold' THEN format('This vehicle has been sold by %s', org_record.business_name)
      ELSE 'Check out this update'
    END;
    
    action_url := format('/vehicle/%s', vehicle_record.id);
    
    -- Find subscribed users
    FOR subscription_record IN 
      SELECT DISTINCT us.user_id, nc.channel_type
      FROM user_subscriptions us
      JOIN notification_channels nc ON us.user_id = nc.user_id AND nc.is_enabled = TRUE
      WHERE us.is_active = TRUE
      AND (
        -- Dealer-specific subscriptions
        (us.subscription_type = 'dealer_new_listings' AND us.target_id = vehicle_record.organization_id)
        OR
        -- Make/model subscriptions
        (us.subscription_type = 'make_model' AND 
         us.filters->>'make' = vehicle_record.make AND
         (us.filters->>'model' IS NULL OR us.filters->>'model' = vehicle_record.model))
        OR
        -- Price range subscriptions
        (us.subscription_type = 'price_range' AND
         vehicle_record.asking_price BETWEEN (us.filters->>'min_price')::NUMERIC AND (us.filters->>'max_price')::NUMERIC)
      )
    LOOP
      -- Create notification for each user/channel combination
      INSERT INTO user_notifications (
        user_id,
        event_id,
        channel_type,
        notification_title,
        notification_body,
        action_url
      ) VALUES (
        subscription_record.user_id,
        event_id_param,
        subscription_record.channel_type,
        notification_title,
        notification_body,
        action_url
      );
      
      notification_count := notification_count + 1;
    END LOOP;
  END IF;
  
  -- Mark event as processed
  UPDATE notification_events SET processed_at = NOW() WHERE id = event_id_param;
  
  RETURN notification_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE notification_channels IS 'User notification preferences per channel (email, SMS, push, etc.)';
COMMENT ON TABLE user_subscriptions IS 'What users want to be notified about (dealers, vehicles, price ranges)';
COMMENT ON TABLE notification_events IS 'System-wide events that trigger notifications';
COMMENT ON TABLE user_notifications IS 'Actual notifications sent to users';
COMMENT ON TABLE external_listings IS 'Vehicle listings on external platforms (BaT, eBay, etc.) for fair play tracking';
COMMENT ON TABLE listing_attribution IS 'Track which platform listed first to ensure fair commission policies';

