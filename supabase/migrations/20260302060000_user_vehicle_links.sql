-- User-vehicle links: ownership, favorites, watching, etc.
-- RLS-protected: users can only see/edit their own rows

-- =============================================================================
-- 1. Create table
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_vehicle_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('owner', 'previous_owner', 'favorite', 'watching', 'sold')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, vehicle_id, link_type)
);

COMMENT ON TABLE user_vehicle_links IS 'Links between users and vehicles: ownership, favorites, watchlist. RLS-protected per user.';
COMMENT ON COLUMN user_vehicle_links.link_type IS 'Relationship type: owner, previous_owner, favorite, watching, sold';

-- =============================================================================
-- 2. Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_uvl_user ON user_vehicle_links(user_id);
CREATE INDEX IF NOT EXISTS idx_uvl_vehicle ON user_vehicle_links(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_uvl_user_type ON user_vehicle_links(user_id, link_type);

-- =============================================================================
-- 3. updated_at trigger (uses existing update_updated_at_column function)
-- =============================================================================

DROP TRIGGER IF EXISTS user_vehicle_links_updated_at ON user_vehicle_links;
CREATE TRIGGER user_vehicle_links_updated_at
  BEFORE UPDATE ON user_vehicle_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 4. Row Level Security
-- =============================================================================

ALTER TABLE user_vehicle_links ENABLE ROW LEVEL SECURITY;

-- Users can read their own links
CREATE POLICY "uvl_select_own" ON user_vehicle_links
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own links
CREATE POLICY "uvl_insert_own" ON user_vehicle_links
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own links
CREATE POLICY "uvl_update_own" ON user_vehicle_links
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can delete their own links
CREATE POLICY "uvl_delete_own" ON user_vehicle_links
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role bypasses RLS (for edge functions)
-- (service_role bypasses RLS by default in Supabase, no explicit policy needed)
