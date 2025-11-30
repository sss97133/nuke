-- User Auction Preferences
-- Stores user-specific preferences for auction tracking and syncing

CREATE TABLE IF NOT EXISTS user_auction_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Sync preferences
  auto_sync_enabled BOOLEAN DEFAULT true,
  sync_frequency_minutes INTEGER DEFAULT 15,
  platforms_to_sync TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Notification preferences
  notify_on_bid BOOLEAN DEFAULT true,
  notify_on_ending_soon BOOLEAN DEFAULT true,
  notify_on_sold BOOLEAN DEFAULT true,
  notify_on_expired BOOLEAN DEFAULT true,
  
  -- Display preferences
  default_view_mode TEXT DEFAULT 'cards' CHECK (default_view_mode IN ('cards', 'list', 'timeline', 'calendar')),
  default_sort TEXT DEFAULT 'ending_soon' CHECK (default_sort IN ('ending_soon', 'newest', 'highest_bid', 'most_views', 'most_bids')),
  show_platform_badges BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_auction_prefs_user ON user_auction_preferences(user_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_user_auction_prefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_auction_prefs_updated_at ON user_auction_preferences;
CREATE TRIGGER update_user_auction_prefs_updated_at
  BEFORE UPDATE ON user_auction_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_auction_prefs_updated_at();

-- RLS Policies
ALTER TABLE user_auction_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "view_own_preferences" ON user_auction_preferences
  FOR SELECT USING (user_id = auth.uid());

-- Users can create their own preferences
CREATE POLICY "create_own_preferences" ON user_auction_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
CREATE POLICY "update_own_preferences" ON user_auction_preferences
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete their own preferences
CREATE POLICY "delete_own_preferences" ON user_auction_preferences
  FOR DELETE USING (user_id = auth.uid());

COMMENT ON TABLE user_auction_preferences IS 'User-specific preferences for auction tracking: sync settings, notifications, display options';



