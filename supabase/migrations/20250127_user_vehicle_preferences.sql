-- User Vehicle Preferences
-- Stores manual organization preferences for vehicles (favorites, collections, hidden)

CREATE TABLE IF NOT EXISTS user_vehicle_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Manual organization
  is_favorite BOOLEAN DEFAULT false,
  is_hidden BOOLEAN DEFAULT false,  -- Hide from personal view (still visible in org context)
  collection_name TEXT,  -- Custom collection name (null = not in collection)
  notes TEXT,  -- Personal notes about this vehicle
  
  -- Display preferences
  display_order INTEGER DEFAULT 0,  -- Custom sort order within collections
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, vehicle_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_vehicle_prefs_user ON user_vehicle_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_vehicle_prefs_vehicle ON user_vehicle_preferences(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_user_vehicle_prefs_favorite ON user_vehicle_preferences(user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_user_vehicle_prefs_hidden ON user_vehicle_preferences(user_id, is_hidden) WHERE is_hidden = true;
CREATE INDEX IF NOT EXISTS idx_user_vehicle_prefs_collection ON user_vehicle_preferences(user_id, collection_name) WHERE collection_name IS NOT NULL;

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_user_vehicle_prefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_vehicle_prefs_updated_at ON user_vehicle_preferences;
CREATE TRIGGER update_user_vehicle_prefs_updated_at
  BEFORE UPDATE ON user_vehicle_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_vehicle_prefs_updated_at();

-- RLS Policies
ALTER TABLE user_vehicle_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "view_own_vehicle_preferences" ON user_vehicle_preferences
  FOR SELECT USING (user_id = auth.uid());

-- Users can create their own preferences
CREATE POLICY "create_own_vehicle_preferences" ON user_vehicle_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
CREATE POLICY "update_own_vehicle_preferences" ON user_vehicle_preferences
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete their own preferences
CREATE POLICY "delete_own_vehicle_preferences" ON user_vehicle_preferences
  FOR DELETE USING (user_id = auth.uid());

COMMENT ON TABLE user_vehicle_preferences IS 'Manual organization preferences for vehicles: favorites, collections, hidden status, notes';
COMMENT ON COLUMN user_vehicle_preferences.is_hidden IS 'Hide from personal view but still visible in organization context';
COMMENT ON COLUMN user_vehicle_preferences.collection_name IS 'Custom collection name. NULL means not in any collection. Multiple vehicles can share same collection name.';

