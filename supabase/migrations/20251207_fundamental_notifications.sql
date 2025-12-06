-- FUNDAMENTAL NOTIFICATIONS SYSTEM
-- Simple, essential notifications for user-to-user and system-to-user communication
-- Not over-engineered - just what users actually need

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Who gets notified
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Notification type (fundamental types only)
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    -- User-to-User
    'comment_on_vehicle',           -- Someone commented on your vehicle
    'vehicle_access_request',       -- Someone requested access to your vehicle
    'vehicle_contribution',          -- Someone contributed to your vehicle
    'vehicle_liked',                -- Someone liked your vehicle
    'vehicle_favorited',            -- Someone favorited your vehicle
    
    -- System-to-User
    'upload_completed',             -- Your upload finished
    'analysis_completed',           -- AI analysis finished
    'price_updated',               -- Price update on your vehicle
    'similar_vehicle_found',       -- New similar vehicle found
    'auction_ending_soon',         -- Auction ending soon
    
    -- Organization/Shop
    'work_order_assigned',         -- New work order assigned
    'customer_uploaded_images',    -- Customer uploaded images
    'payment_received',            -- Payment received
    
    -- Collaboration
    'verification_request',        -- Verification request
    'ownership_claim',            -- Ownership claim
    'merge_proposal'              -- Vehicle merge proposal
  )),
  
  -- What it's about
  title TEXT NOT NULL,
  message TEXT,
  
  -- Related entities
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  interaction_request_id UUID REFERENCES vehicle_interaction_requests(id) ON DELETE CASCADE,
  
  -- Who triggered it (if user-to-user)
  from_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Action link
  action_url TEXT, -- Where to go when clicked
  
  -- Status
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  
  -- Metadata (flexible JSONB for type-specific data)
  metadata JSONB DEFAULT '{}',
  /*
  Examples:
  {
    "comment_id": "uuid",
    "comment_text": "Nice build!"
  }
  {
    "upload_count": 5,
    "failed_count": 0
  }
  {
    "old_price": 50000,
    "new_price": 55000
  }
  */
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON user_notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_type ON user_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_user_notifications_vehicle ON user_notifications(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- RLS: Users can only see their own notifications
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON user_notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON user_notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert notifications" ON user_notifications
  FOR INSERT WITH CHECK (true);

-- Function to create notification (simple wrapper)
CREATE OR REPLACE FUNCTION create_user_notification(
  p_user_id UUID,
  p_notification_type TEXT,
  p_title TEXT,
  p_message TEXT DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_image_id UUID DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL,
  p_from_user_id UUID DEFAULT NULL,
  p_action_url TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO user_notifications (
    user_id,
    notification_type,
    title,
    message,
    vehicle_id,
    image_id,
    organization_id,
    from_user_id,
    action_url,
    metadata
  ) VALUES (
    p_user_id,
    p_notification_type,
    p_title,
    p_message,
    p_vehicle_id,
    p_image_id,
    p_organization_id,
    p_from_user_id,
    p_action_url,
    p_metadata
  ) RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark as read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE user_notifications
  SET is_read = true,
      read_at = NOW()
  WHERE id = p_notification_id
    AND user_id = p_user_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark all as read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE user_notifications
  SET is_read = true,
      read_at = NOW()
  WHERE user_id = p_user_id
    AND is_read = false;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get unread count
CREATE OR REPLACE FUNCTION get_unread_notification_count(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM user_notifications
  WHERE user_id = p_user_id
    AND is_read = false;
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

