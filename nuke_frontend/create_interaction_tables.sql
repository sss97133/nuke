-- User Interaction Tracking System
-- Comprehensive backend support for likes, saves, and user preferences

-- Table: user_interactions - Log all user interactions
CREATE TABLE IF NOT EXISTS user_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'like', 'dislike', 'save', 'skip', 'share', 'view', 'tag_verify', 'tag_reject'
  )),
  target_type TEXT NOT NULL CHECK (target_type IN (
    'image', 'vehicle', 'tag', 'event', 'user', 'shop'
  )),
  target_id UUID NOT NULL,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_target ON user_interactions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_type ON user_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_created ON user_interactions(created_at DESC);

-- Table: user_saved_images - User's saved image collection
CREATE TABLE IF NOT EXISTS user_saved_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, image_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_images_user_id ON user_saved_images(user_id);
CREATE INDEX IF NOT EXISTS idx_user_saved_images_vehicle_id ON user_saved_images(vehicle_id);

-- Table: user_saved_vehicles - User's saved vehicle collection
CREATE TABLE IF NOT EXISTS user_saved_vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,
  UNIQUE(user_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_vehicles_user_id ON user_saved_vehicles(user_id);

-- Table: user_preferences - Aggregated user preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  liked_tags TEXT[] DEFAULT '{}',
  disliked_tags TEXT[] DEFAULT '{}',
  preferred_vendors TEXT[] DEFAULT '{}',
  interaction_style TEXT DEFAULT 'desktop' CHECK (interaction_style IN ('mobile', 'desktop')),
  settings JSONB DEFAULT '{}',
  last_calculated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Function to update user preferences based on interactions
CREATE OR REPLACE FUNCTION update_user_preferences()
RETURNS TRIGGER AS $$
BEGIN
  -- Update user preferences when interactions change
  INSERT INTO user_preferences (user_id, last_calculated)
  VALUES (NEW.user_id, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    last_calculated = NOW(),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update preferences
DROP TRIGGER IF EXISTS trigger_update_user_preferences ON user_interactions;
CREATE TRIGGER trigger_update_user_preferences
  AFTER INSERT ON user_interactions
  FOR EACH ROW EXECUTE FUNCTION update_user_preferences();

-- Function to calculate user engagement score
CREATE OR REPLACE FUNCTION get_user_engagement_score(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  like_count INTEGER;
  save_count INTEGER;
  tag_verify_count INTEGER;
  days_active INTEGER;
  engagement_score INTEGER;
BEGIN
  -- Get interaction counts
  SELECT
    COUNT(CASE WHEN interaction_type = 'like' THEN 1 END),
    COUNT(CASE WHEN interaction_type = 'save' THEN 1 END),
    COUNT(CASE WHEN interaction_type = 'tag_verify' THEN 1 END),
    COUNT(DISTINCT DATE(created_at))
  INTO like_count, save_count, tag_verify_count, days_active
  FROM user_interactions
  WHERE user_id = p_user_id
    AND created_at > NOW() - INTERVAL '30 days';

  -- Calculate engagement score
  engagement_score := (like_count * 1) + (save_count * 3) + (tag_verify_count * 5) + (days_active * 2);

  RETURN engagement_score;
END;
$$ LANGUAGE plpgsql;

-- Function to get personalized image recommendations
CREATE OR REPLACE FUNCTION get_recommended_images(p_user_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  image_id UUID,
  vehicle_id UUID,
  score INTEGER,
  reasoning TEXT
) AS $$
DECLARE
  user_liked_tags TEXT[];
  user_disliked_tags TEXT[];
BEGIN
  -- Get user preferences
  SELECT
    ARRAY(
      SELECT DISTINCT target_id::TEXT
      FROM user_interactions
      WHERE user_id = p_user_id
        AND interaction_type = 'like'
        AND target_type = 'tag'
      LIMIT 20
    ),
    ARRAY(
      SELECT DISTINCT target_id::TEXT
      FROM user_interactions
      WHERE user_id = p_user_id
        AND interaction_type = 'dislike'
        AND target_type = 'tag'
      LIMIT 10
    )
  INTO user_liked_tags, user_disliked_tags;

  -- Return recommended images based on liked tags
  RETURN QUERY
  SELECT DISTINCT
    vi.id as image_id,
    vi.vehicle_id,
    (CASE
      WHEN ARRAY_LENGTH(user_liked_tags, 1) > 0 THEN
        (SELECT COUNT(*)::INTEGER FROM unnest(user_liked_tags) tag
         WHERE EXISTS (
           SELECT 1 FROM image_tags it
           WHERE it.image_id = vi.id AND it.tag_name = tag
         )) * 10
      ELSE 5
    END) as score,
    CASE
      WHEN ARRAY_LENGTH(user_liked_tags, 1) > 0 THEN 'Based on your liked tags'
      ELSE 'Popular content'
    END as reasoning
  FROM vehicle_images vi
  WHERE vi.id NOT IN (
    -- Exclude already seen images
    SELECT DISTINCT target_id::UUID
    FROM user_interactions
    WHERE user_id = p_user_id
      AND target_type = 'image'
  )
  AND (
    ARRAY_LENGTH(user_disliked_tags, 1) IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM image_tags it
      WHERE it.image_id = vi.id
        AND it.tag_name = ANY(user_disliked_tags)
    )
  )
  ORDER BY score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users can manage own interactions" ON user_interactions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own saved images" ON user_saved_images
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own saved vehicles" ON user_saved_vehicles
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- Grant permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON user_interactions TO authenticated;
GRANT ALL ON user_saved_images TO authenticated;
GRANT ALL ON user_saved_vehicles TO authenticated;
GRANT ALL ON user_preferences TO authenticated;

-- Test data for development
DO $$
DECLARE
  test_user_id UUID;
  test_vehicle_id UUID;
  test_image_id UUID;
BEGIN
  -- Only create test data if tables are empty
  IF NOT EXISTS (SELECT 1 FROM user_interactions LIMIT 1) THEN
    -- Get a test user (or create one for testing)
    SELECT id INTO test_user_id FROM auth.users LIMIT 1;

    IF test_user_id IS NOT NULL THEN
      -- Get test vehicle and image
      SELECT id INTO test_vehicle_id FROM vehicles LIMIT 1;
      SELECT id INTO test_image_id FROM vehicle_images LIMIT 1;

      IF test_vehicle_id IS NOT NULL AND test_image_id IS NOT NULL THEN
        -- Insert sample interactions
        INSERT INTO user_interactions (user_id, interaction_type, target_type, target_id, context)
        VALUES
          (test_user_id, 'like', 'image', test_image_id, '{"device_type": "mobile", "gesture_type": "double_tap"}'),
          (test_user_id, 'save', 'vehicle', test_vehicle_id, '{"device_type": "mobile"}'),
          (test_user_id, 'view', 'image', test_image_id, '{"device_type": "mobile", "session_duration": 1200}');
      END IF;
    END IF;
  END IF;
END $$;