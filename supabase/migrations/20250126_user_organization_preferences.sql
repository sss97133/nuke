-- User Organization Preferences
-- Stores user-specific preferences for organizations (pin, display order, notifications)

CREATE TABLE IF NOT EXISTS user_organization_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Display preferences
  is_pinned BOOLEAN DEFAULT false,  -- Pin to top of list
  display_order INTEGER DEFAULT 0,  -- Custom sort order
  notification_settings JSONB DEFAULT '{}',  -- Per-org notification prefs
  
  -- Quick access
  favorite_actions TEXT[],  -- Quick action buttons to show
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, organization_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_org_prefs_user ON user_organization_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_prefs_org ON user_organization_preferences(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_org_prefs_pinned ON user_organization_preferences(user_id, is_pinned) WHERE is_pinned = true;

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_user_org_prefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_org_prefs_updated_at ON user_organization_preferences;
CREATE TRIGGER update_user_org_prefs_updated_at
  BEFORE UPDATE ON user_organization_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_org_prefs_updated_at();

-- RLS Policies
ALTER TABLE user_organization_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "view_own_preferences" ON user_organization_preferences
  FOR SELECT USING (user_id = auth.uid());

-- Users can create their own preferences
CREATE POLICY "create_own_preferences" ON user_organization_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
CREATE POLICY "update_own_preferences" ON user_organization_preferences
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete their own preferences
CREATE POLICY "delete_own_preferences" ON user_organization_preferences
  FOR DELETE USING (user_id = auth.uid());

COMMENT ON TABLE user_organization_preferences IS 'User-specific preferences for organizations: pin status, display order, notifications';



