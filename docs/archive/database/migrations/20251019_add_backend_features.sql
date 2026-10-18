-- ================================================
-- BACKEND FEATURES FOR MOBILE UX REFINEMENTS
-- ================================================
-- This migration adds:
-- 1. Image metrics tracking (views, engagement)
-- 2. Betting/speculation system
-- 3. Auction voting mechanism
-- 4. Spec research cache

-- ================================================
-- 1. IMAGE METRICS TRACKING
-- ================================================

-- Add metrics columns to vehicle_images
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS engagement_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS technical_value INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS tag_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

-- Create image_views table for detailed tracking
CREATE TABLE IF NOT EXISTS image_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  view_duration_seconds INTEGER,
  device_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_views_image_id ON image_views(image_id);
CREATE INDEX IF NOT EXISTS idx_image_views_user_id ON image_views(user_id);
CREATE INDEX IF NOT EXISTS idx_image_views_viewed_at ON image_views(viewed_at);

-- Create image_interactions table (likes, comments, etc.)
CREATE TABLE IF NOT EXISTS image_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('like', 'comment', 'share')),
  comment_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(image_id, user_id, interaction_type)
);

CREATE INDEX IF NOT EXISTS idx_image_interactions_image_id ON image_interactions(image_id);
CREATE INDEX IF NOT EXISTS idx_image_interactions_user_id ON image_interactions(user_id);

-- ================================================
-- 2. BETTING/SPECULATION SYSTEM
-- ================================================

CREATE TABLE IF NOT EXISTS vehicle_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bet_type TEXT NOT NULL CHECK (bet_type IN ('value_milestone', 'completion_date', 'next_mod_value', 'auction_price')),
  prediction JSONB NOT NULL, -- { "target_value": 50000, "by_date": "2025-12-31" }
  confidence_percent INTEGER NOT NULL CHECK (confidence_percent BETWEEN 0 AND 100),
  stake_amount DECIMAL(10, 2),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'cancelled')),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_bets_vehicle_id ON vehicle_bets(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_bets_user_id ON vehicle_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_bets_status ON vehicle_bets(status);

-- Market sentiment aggregation view
CREATE OR REPLACE VIEW vehicle_market_sentiment AS
SELECT 
  vehicle_id,
  bet_type,
  COUNT(*) as total_bets,
  AVG(confidence_percent) as avg_confidence,
  AVG((prediction->>'target_value')::numeric) as avg_predicted_value,
  jsonb_agg(prediction) as all_predictions
FROM vehicle_bets
WHERE status = 'active'
GROUP BY vehicle_id, bet_type;

-- ================================================
-- 3. AUCTION VOTING MECHANISM
-- ================================================

CREATE TABLE IF NOT EXISTS auction_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  reason TEXT,
  estimated_value DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vehicle_id, user_id) -- One vote per user per vehicle
);

CREATE INDEX IF NOT EXISTS idx_auction_votes_vehicle_id ON auction_votes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_auction_votes_user_id ON auction_votes(user_id);

-- Auction vote summary view
CREATE OR REPLACE VIEW auction_vote_summary AS
SELECT 
  vehicle_id,
  COUNT(*) as total_votes,
  SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) as yes_votes,
  SUM(CASE WHEN vote = 'no' THEN 1 ELSE 0 END) as no_votes,
  ROUND(100.0 * SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) / COUNT(*), 1) as yes_percent,
  AVG(estimated_value) as avg_estimated_value,
  MAX(updated_at) as last_vote_at
FROM auction_votes
GROUP BY vehicle_id;

-- ================================================
-- 4. SPEC RESEARCH CACHE
-- ================================================

CREATE TABLE IF NOT EXISTS spec_research_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  spec_name TEXT NOT NULL, -- 'engine', 'transmission', etc.
  spec_value TEXT NOT NULL, -- '350ci V8', 'TH350', etc.
  research_data JSONB NOT NULL, -- Full AI response with sources
  sources JSONB, -- Array of sources used
  confidence_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  UNIQUE(vehicle_id, spec_name)
);

CREATE INDEX IF NOT EXISTS idx_spec_research_vehicle_id ON spec_research_cache(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_spec_research_expires_at ON spec_research_cache(expires_at);

-- ================================================
-- 5. RLS POLICIES
-- ================================================

-- Image views: Anyone can log views
ALTER TABLE image_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can log image views" ON image_views FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can see their own views" ON image_views FOR SELECT USING (auth.uid() = user_id);

-- Image interactions: Users can interact
ALTER TABLE image_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create interactions" ON image_interactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can view interactions" ON image_interactions FOR SELECT USING (true);
CREATE POLICY "Users can delete own interactions" ON image_interactions FOR DELETE USING (auth.uid() = user_id);

-- Vehicle bets: Users can create and view
ALTER TABLE vehicle_bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create bets" ON vehicle_bets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can view bets" ON vehicle_bets FOR SELECT USING (true);
CREATE POLICY "Users can update own bets" ON vehicle_bets FOR UPDATE USING (auth.uid() = user_id);

-- Auction votes: Users can vote
ALTER TABLE auction_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create votes" ON auction_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can view votes" ON auction_votes FOR SELECT USING (true);
CREATE POLICY "Users can update own votes" ON auction_votes FOR UPDATE USING (auth.uid() = user_id);

-- Spec research cache: Read-only for all
ALTER TABLE spec_research_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read spec research" ON spec_research_cache FOR SELECT USING (true);
CREATE POLICY "Service role can manage spec research" ON spec_research_cache FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ================================================
-- 6. FUNCTIONS
-- ================================================

-- Function to update image view count
CREATE OR REPLACE FUNCTION increment_image_view_count(image_uuid UUID)
RETURNS void AS $$
BEGIN
  UPDATE vehicle_images 
  SET 
    view_count = view_count + 1,
    last_viewed_at = NOW()
  WHERE id = image_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate engagement score
CREATE OR REPLACE FUNCTION calculate_engagement_score(image_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  score INTEGER := 0;
  view_cnt INTEGER;
  interaction_cnt INTEGER;
BEGIN
  -- Get view count
  SELECT view_count INTO view_cnt 
  FROM vehicle_images 
  WHERE id = image_uuid;
  
  -- Get interaction count
  SELECT COUNT(*) INTO interaction_cnt
  FROM image_interactions
  WHERE image_id = image_uuid;
  
  -- Calculate score (views * 1 + interactions * 10)
  score := COALESCE(view_cnt, 0) + (COALESCE(interaction_cnt, 0) * 10);
  
  -- Update the score
  UPDATE vehicle_images
  SET engagement_score = LEAST(100, score) -- Cap at 100
  WHERE id = image_uuid;
  
  RETURN score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE image_views IS 'Tracks individual image view events with duration and device info';
COMMENT ON TABLE image_interactions IS 'Stores user interactions (likes, comments) on images';
COMMENT ON TABLE vehicle_bets IS 'Market speculation and predictions on vehicle values';
COMMENT ON TABLE auction_votes IS 'Community voting to send vehicles to auction';
COMMENT ON TABLE spec_research_cache IS 'Cached AI-generated spec research to avoid redundant API calls';

