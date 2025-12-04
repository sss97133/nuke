-- ============================================================
-- AUCTION INTELLIGENCE SYSTEM
-- Scientific analysis of bidding behavior & market sentiment
-- ============================================================

-- 1. AUCTION COMMENTS (Granular Data)
CREATE TABLE IF NOT EXISTS auction_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id UUID REFERENCES auction_events(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Metadata
  comment_type TEXT CHECK (comment_type IN (
    'bid', 'sold', 'question', 'answer', 'observation', 
    'seller_update', 'seller_response', 'expert_opinion'
  )),
  posted_at TIMESTAMPTZ NOT NULL,
  sequence_number INTEGER, -- Position in thread
  hours_until_close NUMERIC, -- Time before auction end
  
  -- Author
  author_username TEXT NOT NULL,
  author_type TEXT, -- 'seller', 'winning_bidder', 'losing_bidder', 'observer'
  author_total_likes INTEGER DEFAULT 0,
  is_seller BOOLEAN DEFAULT false,
  
  -- Content
  comment_text TEXT NOT NULL,
  word_count INTEGER,
  has_question BOOLEAN DEFAULT false,
  has_media BOOLEAN DEFAULT false,
  media_urls TEXT[],
  mentions TEXT[], -- @username references
  
  -- Engagement
  comment_likes INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  is_flagged BOOLEAN DEFAULT false,
  
  -- Bid-specific
  bid_amount NUMERIC,
  is_leading_bid BOOLEAN,
  bid_increment NUMERIC,
  
  -- AI Analysis (Tier 1: Fast)
  sentiment TEXT, -- 'bullish', 'bearish', 'neutral', 'skeptical'
  sentiment_score NUMERIC, -- -100 to +100
  toxicity_score NUMERIC, -- 0-100
  expertise_indicators TEXT[],
  
  -- AI Analysis (Tier 2: Deep)
  authenticity_score NUMERIC, -- 0-100 (100 = definitely human)
  expertise_score NUMERIC, -- 0-100
  influence_score NUMERIC, -- Did this comment drive action?
  key_claims TEXT[], -- Factual statements
  
  -- Metadata
  raw_html TEXT,
  analyzed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auction_comments_auction ON auction_comments(auction_event_id);
CREATE INDEX idx_auction_comments_author ON auction_comments(author_username);
CREATE INDEX idx_auction_comments_type ON auction_comments(comment_type);
CREATE INDEX idx_auction_comments_posted ON auction_comments(posted_at);

-- 2. USER BEHAVIORAL PROFILES
CREATE TABLE IF NOT EXISTS bat_user_profiles (
  username TEXT PRIMARY KEY,
  
  -- Activity Stats
  total_comments INTEGER DEFAULT 0,
  total_bids INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  total_answers INTEGER DEFAULT 0,
  
  -- Financial Behavior
  avg_bid_amount NUMERIC,
  max_bid_amount NUMERIC,
  min_bid_amount NUMERIC,
  win_rate NUMERIC, -- % of auctions won
  
  -- Expertise Scoring (AI-derived)
  expertise_score NUMERIC DEFAULT 0, -- 0-100
  technical_knowledge NUMERIC DEFAULT 0,
  market_knowledge NUMERIC DEFAULT 0,
  avg_comment_quality NUMERIC DEFAULT 0,
  
  -- Behavioral Patterns
  preferred_categories TEXT[],
  typical_price_range JSONB, -- {min: 5000, max: 50000}
  bidding_strategy TEXT, -- 'sniper', 'early_aggressive', 'steady'
  avg_sentiment TEXT,
  
  -- Social
  avg_likes_received NUMERIC DEFAULT 0,
  community_trust_score NUMERIC DEFAULT 0,
  
  -- Detection Flags
  bot_likelihood NUMERIC DEFAULT 0,
  shill_flags INTEGER DEFAULT 0,
  
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bat_users_expertise ON bat_user_profiles(expertise_score DESC);
CREATE INDEX idx_bat_users_win_rate ON bat_user_profiles(win_rate DESC) WHERE total_bids > 5;

-- 3. SENTIMENT TIMELINE (Sentiment evolution during auction)
CREATE TABLE IF NOT EXISTS auction_sentiment_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id UUID REFERENCES auction_events(id) ON DELETE CASCADE,
  
  snapshot_at TIMESTAMPTZ NOT NULL,
  hours_until_close NUMERIC,
  
  -- Aggregate metrics at this point
  total_comments INTEGER DEFAULT 0,
  total_bids INTEGER DEFAULT 0,
  current_bid NUMERIC,
  
  -- Sentiment
  sentiment_score NUMERIC, -- -100 to +100
  excitement_level NUMERIC, -- 0-100
  skepticism_level NUMERIC, -- 0-100
  expert_endorsements INTEGER DEFAULT 0,
  concerns_raised INTEGER DEFAULT 0,
  
  -- Predictive
  predicted_final_price NUMERIC,
  predicted_reserve_met BOOLEAN,
  prediction_confidence NUMERIC,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sentiment_timeline_auction ON auction_sentiment_timeline(auction_event_id, snapshot_at);

-- 4. COMMENT INTERACTIONS (Network graph)
CREATE TABLE IF NOT EXISTS comment_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id UUID REFERENCES auction_events(id),
  
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  interaction_type TEXT, -- 'question', 'answer', 'endorsement', 'dispute'
  
  source_comment_id UUID REFERENCES auction_comments(id),
  timestamp TIMESTAMPTZ NOT NULL,
  
  -- Impact measurement
  influenced_bid_change NUMERIC, -- Did 'to_user' bid after this interaction?
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_interactions_auction ON comment_interactions(auction_event_id);
CREATE INDEX idx_interactions_users ON comment_interactions(from_user, to_user);

-- 5. MARKET INSIGHTS (Macro trends)
CREATE TABLE IF NOT EXISTS market_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  insight_type TEXT NOT NULL, -- 'price_trend', 'sentiment_shift', 'fraud_alert', 'expert_consensus'
  vehicle_category TEXT,
  time_period TEXT, -- 'daily', 'weekly', 'monthly'
  
  title TEXT,
  summary TEXT,
  supporting_data JSONB,
  confidence NUMERIC,
  
  -- Affected auctions
  related_auction_ids UUID[],
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_insights_type ON market_insights(insight_type);
CREATE INDEX idx_market_insights_category ON market_insights(vehicle_category);

-- 6. AUCTION RECEIPT (Auto-generated summary)
ALTER TABLE auction_events ADD COLUMN IF NOT EXISTS receipt_data JSONB;
ALTER TABLE auction_events ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE auction_events ADD COLUMN IF NOT EXISTS sentiment_arc JSONB;
ALTER TABLE auction_events ADD COLUMN IF NOT EXISTS key_moments JSONB;
ALTER TABLE auction_events ADD COLUMN IF NOT EXISTS top_contributors JSONB;

-- RLS Policies
ALTER TABLE auction_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bat_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_sentiment_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_insights ENABLE ROW LEVEL SECURITY;

-- Public read for market data
CREATE POLICY "Public read auction comments" ON auction_comments FOR SELECT USING (true);
CREATE POLICY "Public read user profiles" ON bat_user_profiles FOR SELECT USING (true);
CREATE POLICY "Public read sentiment timeline" ON auction_sentiment_timeline FOR SELECT USING (true);
CREATE POLICY "Public read interactions" ON comment_interactions FOR SELECT USING (true);
CREATE POLICY "Public read market insights" ON market_insights FOR SELECT USING (true);

-- Admin write (service role only)
CREATE POLICY "Service role write comments" ON auction_comments FOR ALL 
  USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role write profiles" ON bat_user_profiles FOR ALL 
  USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role write timeline" ON auction_sentiment_timeline FOR ALL 
  USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role write interactions" ON comment_interactions FOR ALL 
  USING (auth.jwt() ->> 'role' = 'service_role');
CREATE POLICY "Service role write insights" ON market_insights FOR ALL 
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Helper function: Update user profile from comment
CREATE OR REPLACE FUNCTION update_user_profile_from_comment()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO bat_user_profiles (username, total_comments, last_seen)
  VALUES (NEW.author_username, 1, NEW.posted_at)
  ON CONFLICT (username) DO UPDATE SET
    total_comments = bat_user_profiles.total_comments + 1,
    total_bids = bat_user_profiles.total_bids + CASE WHEN NEW.comment_type = 'bid' THEN 1 ELSE 0 END,
    last_seen = NEW.posted_at,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_profile
  AFTER INSERT ON auction_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profile_from_comment();

COMMENT ON TABLE auction_comments IS 'Granular auction comment data for behavioral analysis';
COMMENT ON TABLE bat_user_profiles IS 'User behavioral profiles built from auction activity';
COMMENT ON TABLE auction_sentiment_timeline IS 'Sentiment evolution during auctions for prediction';

