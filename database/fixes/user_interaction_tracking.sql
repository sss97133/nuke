-- User Interaction Tracking System
-- Logs all user interactions for personalization and analytics

-- 1. Create user_interactions table
CREATE TABLE IF NOT EXISTS user_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- What happened
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'like', 'dislike', 'save', 'skip', 'share', 'view', 
    'tag_verify', 'tag_reject', 'comment', 'follow', 'unfollow'
  )),
  
  -- What was interacted with
  target_type TEXT NOT NULL CHECK (target_type IN (
    'image', 'vehicle', 'tag', 'event', 'user', 'shop', 'receipt'
  )),
  target_id TEXT NOT NULL,
  
  -- Context
  context JSONB DEFAULT '{}'::jsonb,
  /*
    {
      "vehicle_id": "uuid",
      "session_duration": 120,
      "source_page": "/vehicle/xyz",
      "device_type": "mobile",
      "gesture_type": "swipe",
      "vendor_name": "CJ Pony Parts"
    }
  */
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create user_saved_images table
CREATE TABLE IF NOT EXISTS user_saved_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, image_id)
);

-- 3. Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Interface preferences
  preferred_view_mode TEXT DEFAULT 'gallery' CHECK (preferred_view_mode IN ('gallery', 'compact', 'technical')),
  preferred_device TEXT DEFAULT 'desktop' CHECK (preferred_device IN ('mobile', 'desktop', 'tablet')),
  enable_gestures BOOLEAN DEFAULT true,
  enable_haptic_feedback BOOLEAN DEFAULT true,
  
  -- Content preferences
  preferred_vendors TEXT[] DEFAULT ARRAY[]::TEXT[],
  hidden_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  favorite_makes TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Personalization scores
  interaction_style JSONB DEFAULT '{}'::jsonb,
  /*
    {
      "swipe_frequency": 0.8,
      "double_tap_frequency": 0.3,
      "avg_session_duration": 180,
      "preferred_gesture": "swipe"
    }
  */
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_target ON user_interactions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_type ON user_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_created_at ON user_interactions(created_at);
CREATE INDEX IF NOT EXISTS idx_user_saved_images_user ON user_saved_images(user_id);
CREATE INDEX IF NOT EXISTS idx_user_saved_images_vehicle ON user_saved_images(vehicle_id);

-- 5. Create RLS policies
ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only see their own interactions
CREATE POLICY "Users view own interactions" ON user_interactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own interactions" ON user_interactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only see their own saved images
CREATE POLICY "Users view own saved images" ON user_saved_images
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users manage own saved images" ON user_saved_images
  FOR ALL USING (auth.uid() = user_id);

-- Users can only see their own preferences
CREATE POLICY "Users view own preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- 6. Create analytics view
CREATE OR REPLACE VIEW user_interaction_analytics AS
SELECT 
  user_id,
  COUNT(*) as total_interactions,
  COUNT(*) FILTER (WHERE interaction_type = 'like') as likes,
  COUNT(*) FILTER (WHERE interaction_type = 'dislike') as dislikes,
  COUNT(*) FILTER (WHERE interaction_type = 'save') as saves,
  COUNT(*) FILTER (WHERE interaction_type = 'tag_verify') as tags_verified,
  COUNT(*) FILTER (WHERE interaction_type = 'tag_reject') as tags_rejected,
  COUNT(DISTINCT target_id) FILTER (WHERE target_type = 'vehicle') as vehicles_viewed,
  COUNT(DISTINCT DATE(created_at)) as active_days,
  EXTRACT(HOUR FROM created_at) as most_active_hour,
  MAX(created_at) as last_active
FROM user_interactions
GROUP BY user_id, EXTRACT(HOUR FROM created_at);

-- 7. Create function to update user preferences based on interactions
CREATE OR REPLACE FUNCTION update_user_preferences_from_interactions()
RETURNS TRIGGER AS $$
BEGIN
  -- Update or insert user preferences
  INSERT INTO user_preferences (user_id, updated_at)
  VALUES (NEW.user_id, NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET 
    preferred_device = CASE 
      WHEN NEW.context->>'device_type' IS NOT NULL 
      THEN NEW.context->>'device_type'
      ELSE user_preferences.preferred_device
    END,
    interaction_style = user_preferences.interaction_style || jsonb_build_object(
      'last_gesture', NEW.context->>'gesture_type',
      'last_interaction', NEW.interaction_type
    ),
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger to auto-update preferences
DROP TRIGGER IF EXISTS trg_update_preferences_on_interaction ON user_interactions;
CREATE TRIGGER trg_update_preferences_on_interaction
  AFTER INSERT ON user_interactions
  FOR EACH ROW
  EXECUTE FUNCTION update_user_preferences_from_interactions();

-- 9. Create function to get personalized content
CREATE OR REPLACE FUNCTION get_personalized_images_for_user(p_user_id UUID, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  image_id UUID,
  vehicle_id UUID,
  image_url TEXT,
  relevance_score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vi.id,
    vi.vehicle_id,
    vi.image_url,
    -- Calculate relevance based on user preferences and interactions
    (
      -- Boost for vehicles user has interacted with
      COALESCE((
        SELECT COUNT(*) * 10
        FROM user_interactions ui
        WHERE ui.user_id = p_user_id
          AND ui.target_type = 'vehicle'
          AND ui.target_id = vi.vehicle_id::text
      ), 0) +
      
      -- Boost for saved images
      CASE WHEN EXISTS (
        SELECT 1 FROM user_saved_images
        WHERE user_id = p_user_id AND image_id = vi.id
      ) THEN 50 ELSE 0 END +
      
      -- Recency bonus
      EXTRACT(EPOCH FROM (NOW() - vi.inserted_at)) / 3600 * -0.1
      
    )::NUMERIC as relevance_score
  FROM vehicle_images vi
  WHERE NOT EXISTS (
    -- Exclude disliked images
    SELECT 1 FROM user_interactions ui
    WHERE ui.user_id = p_user_id
      AND ui.interaction_type = 'dislike'
      AND ui.target_type = 'image'
      AND ui.target_id = vi.id::text
  )
  ORDER BY relevance_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON TABLE user_interactions IS 'Tracks all user interactions for personalization and analytics';
COMMENT ON TABLE user_saved_images IS 'User-saved images (favorites/bookmarks)';
COMMENT ON TABLE user_preferences IS 'User preferences and personalization settings';
COMMENT ON VIEW user_interaction_analytics IS 'Analytics on user engagement and behavior';
COMMENT ON FUNCTION get_personalized_images_for_user IS 'Returns personalized image feed based on user history';

