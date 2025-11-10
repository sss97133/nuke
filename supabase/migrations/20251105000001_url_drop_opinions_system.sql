-- URL Drop & Opinion System
-- Users drop URLs, AI scrapes data, everyone gets credit + can leave opinions

-- Entity opinions/reviews (multi-user, hierarchical)
CREATE TABLE IF NOT EXISTS entity_opinions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('vehicle', 'organization', 'listing', 'person', 'event')),
  entity_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Opinion content
  opinion_text TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  
  -- Contributor hierarchy
  contributor_rank INTEGER NOT NULL DEFAULT 999, -- 1 = first contributor, 2 = second, etc.
  is_original_discoverer BOOLEAN DEFAULT FALSE, -- Did they create the entity?
  
  -- Data contributions
  data_contributed JSONB DEFAULT '{}', -- Fields they filled in
  contribution_score INTEGER DEFAULT 0, -- Points earned
  
  -- Metadata
  source_url TEXT, -- URL they dropped
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(entity_type, entity_id, user_id)
);

CREATE INDEX idx_entity_opinions_entity ON entity_opinions(entity_type, entity_id);
CREATE INDEX idx_entity_opinions_user ON entity_opinions(user_id);
CREATE INDEX idx_entity_opinions_rank ON entity_opinions(contributor_rank);

-- Data gap detection (AI-identified missing fields)
CREATE TABLE IF NOT EXISTS data_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  
  -- Gap details
  field_name TEXT NOT NULL, -- e.g., 'vin', 'year', 'engine_size'
  field_priority TEXT NOT NULL CHECK (field_priority IN ('critical', 'high', 'medium', 'low')),
  gap_reason TEXT, -- Why is this field important?
  
  -- Bounty/reward
  points_reward INTEGER DEFAULT 10, -- Points for filling this gap
  is_filled BOOLEAN DEFAULT FALSE,
  filled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  filled_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(entity_type, entity_id, field_name)
);

CREATE INDEX idx_data_gaps_entity ON data_gaps(entity_type, entity_id);
CREATE INDEX idx_data_gaps_unfilled ON data_gaps(is_filled) WHERE is_filled = FALSE;

-- User contribution points (gamification)
CREATE TABLE IF NOT EXISTS user_contribution_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Point categories
  discovery_points INTEGER DEFAULT 0, -- Finding new entities
  data_fill_points INTEGER DEFAULT 0, -- Filling gaps
  verification_points INTEGER DEFAULT 0, -- Verifying data
  opinion_points INTEGER DEFAULT 0, -- Quality opinions
  
  -- Totals
  total_points INTEGER DEFAULT 0,
  
  -- Ranks/badges
  current_level INTEGER DEFAULT 1,
  badges JSONB DEFAULT '[]', -- ['vin_master', 'first_responder', etc.]
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id)
);

CREATE INDEX idx_contribution_points_total ON user_contribution_points(total_points DESC);

-- URL drop queue (for async processing)
CREATE TABLE IF NOT EXISTS url_drop_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- URL details
  dropped_url TEXT NOT NULL,
  url_type TEXT, -- 'bat_listing', 'instagram', 'organization', 'unknown'
  
  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  
  -- Extracted data
  extracted_data JSONB DEFAULT '{}',
  entity_type TEXT,
  entity_id UUID,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_url_drop_queue_status ON url_drop_queue(status);
CREATE INDEX idx_url_drop_queue_user ON url_drop_queue(user_id);

-- Function: Award points to user
CREATE OR REPLACE FUNCTION award_points(
  p_user_id UUID,
  p_category TEXT,
  p_points INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_total INTEGER;
  v_new_level INTEGER;
BEGIN
  -- Upsert user points
  INSERT INTO user_contribution_points (user_id, total_points)
  VALUES (p_user_id, p_points)
  ON CONFLICT (user_id) DO UPDATE
  SET
    discovery_points = CASE WHEN p_category = 'discovery' THEN user_contribution_points.discovery_points + p_points ELSE user_contribution_points.discovery_points END,
    data_fill_points = CASE WHEN p_category = 'data_fill' THEN user_contribution_points.data_fill_points + p_points ELSE user_contribution_points.data_fill_points END,
    verification_points = CASE WHEN p_category = 'verification' THEN user_contribution_points.verification_points + p_points ELSE user_contribution_points.verification_points END,
    opinion_points = CASE WHEN p_category = 'opinion' THEN user_contribution_points.opinion_points + p_points ELSE user_contribution_points.opinion_points END,
    total_points = user_contribution_points.total_points + p_points,
    updated_at = NOW();
  
  -- Get new total
  SELECT total_points INTO v_total
  FROM user_contribution_points
  WHERE user_id = p_user_id;
  
  -- Calculate new level (every 1000 points = 1 level)
  v_new_level := FLOOR(v_total / 1000.0) + 1;
  
  -- Update level
  UPDATE user_contribution_points
  SET current_level = v_new_level
  WHERE user_id = p_user_id;
  
  -- TODO: Award badges based on milestones
END;
$$ LANGUAGE plpgsql;

-- Function: Detect data gaps for entity
CREATE OR REPLACE FUNCTION detect_data_gaps(
  p_entity_type TEXT,
  p_entity_id UUID
)
RETURNS void AS $$
DECLARE
  v_vehicle RECORD;
  v_org RECORD;
BEGIN
  -- Vehicle gaps
  IF p_entity_type = 'vehicle' THEN
    SELECT * INTO v_vehicle FROM vehicles WHERE id = p_entity_id;
    
    IF v_vehicle.vin IS NULL OR v_vehicle.vin LIKE 'VIVA-%' THEN
      INSERT INTO data_gaps (entity_type, entity_id, field_name, field_priority, gap_reason, points_reward)
      VALUES (p_entity_type, p_entity_id, 'vin', 'critical', 'VIN is required for accurate vehicle identification', 100)
      ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING;
    END IF;
    
    IF v_vehicle.year IS NULL THEN
      INSERT INTO data_gaps (entity_type, entity_id, field_name, field_priority, gap_reason, points_reward)
      VALUES (p_entity_type, p_entity_id, 'year', 'critical', 'Year is essential for valuation', 50)
      ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING;
    END IF;
    
    IF v_vehicle.engine_size IS NULL THEN
      INSERT INTO data_gaps (entity_type, entity_id, field_name, field_priority, gap_reason, points_reward)
      VALUES (p_entity_type, p_entity_id, 'engine_size', 'high', 'Engine details affect value and searchability', 30)
      ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING;
    END IF;
    
    IF v_vehicle.transmission IS NULL THEN
      INSERT INTO data_gaps (entity_type, entity_id, field_name, field_priority, gap_reason, points_reward)
      VALUES (p_entity_type, p_entity_id, 'transmission', 'medium', 'Transmission type is important to buyers', 20)
      ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING;
    END IF;
    
    IF v_vehicle.mileage IS NULL THEN
      INSERT INTO data_gaps (entity_type, entity_id, field_name, field_priority, gap_reason, points_reward)
      VALUES (p_entity_type, p_entity_id, 'mileage', 'high', 'Mileage significantly impacts value', 40)
      ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING;
    END IF;
  END IF;
  
  -- Organization gaps
  IF p_entity_type = 'organization' THEN
    SELECT * INTO v_org FROM organizations WHERE id = p_entity_id;
    
    IF v_org.location IS NULL THEN
      INSERT INTO data_gaps (entity_type, entity_id, field_name, field_priority, gap_reason, points_reward)
      VALUES (p_entity_type, p_entity_id, 'location', 'high', 'Location helps users find nearby shops', 30)
      ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING;
    END IF;
    
    IF v_org.website IS NULL THEN
      INSERT INTO data_gaps (entity_type, entity_id, field_name, field_priority, gap_reason, points_reward)
      VALUES (p_entity_type, p_entity_id, 'website', 'medium', 'Website link increases credibility', 20)
      ON CONFLICT (entity_type, entity_id, field_name) DO NOTHING;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE entity_opinions ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_contribution_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE url_drop_queue ENABLE ROW LEVEL SECURITY;

-- Anyone can view opinions
CREATE POLICY "Anyone can view opinions"
  ON entity_opinions FOR SELECT
  USING (true);

-- Users can create their own opinions
CREATE POLICY "Users can create opinions"
  ON entity_opinions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own opinions
CREATE POLICY "Users can update own opinions"
  ON entity_opinions FOR UPDATE
  USING (auth.uid() = user_id);

-- Anyone can view data gaps
CREATE POLICY "Anyone can view data gaps"
  ON data_gaps FOR SELECT
  USING (true);

-- Anyone can view points (leaderboard)
CREATE POLICY "Anyone can view points"
  ON user_contribution_points FOR SELECT
  USING (true);

-- Users can view their own drop queue
CREATE POLICY "Users can view own queue"
  ON url_drop_queue FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert into queue
CREATE POLICY "Users can drop URLs"
  ON url_drop_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE entity_opinions IS 'User opinions/reviews for any entity (vehicle, org, etc.) with contributor hierarchy';
COMMENT ON TABLE data_gaps IS 'AI-detected missing fields that users can fill for points';
COMMENT ON TABLE user_contribution_points IS 'Gamification: points and badges for data contributions';
COMMENT ON TABLE url_drop_queue IS 'Queue of dropped URLs waiting for AI processing';
