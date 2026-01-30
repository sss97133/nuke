-- ============================================
-- COMMENTER PERSONA SYSTEM
-- Extract personality traits from comments
-- Build profiles, correlate with outcomes
-- ============================================

-- 1. COMMENT-LEVEL PERSONA SIGNALS
-- Extracted from each individual comment
CREATE TABLE IF NOT EXISTS comment_persona_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source
  comment_id UUID,                     -- links to auction_comments if exists
  author_username TEXT NOT NULL,
  author_id UUID,                      -- normalized author entity if we have it
  vehicle_id UUID,
  platform TEXT DEFAULT 'bat',

  -- The comment
  comment_text TEXT,
  comment_length INT,

  -- TONE SIGNALS (how they communicate)
  tone_helpful DECIMAL(3,2),           -- 0-1 helpful vs unhelpful
  tone_technical DECIMAL(3,2),         -- 0-1 technical vs casual
  tone_friendly DECIMAL(3,2),          -- 0-1 friendly vs cold
  tone_confident DECIMAL(3,2),         -- 0-1 confident vs uncertain
  tone_snarky DECIMAL(3,2),            -- 0-1 snarky/sarcastic

  -- EXPERTISE SIGNALS (what they know)
  expertise_level TEXT,                -- novice, enthusiast, expert, professional
  expertise_areas TEXT[],              -- ['porsche', 'air-cooled', 'restoration']
  shows_specific_knowledge BOOLEAN,
  cites_sources BOOLEAN,

  -- INTENT SIGNALS (why they're here)
  intent TEXT,                         -- buying, selling, learning, socializing, showing_off
  is_serious_buyer BOOLEAN,
  is_tire_kicker BOOLEAN,
  is_seller_shill BOOLEAN,

  -- ENGAGEMENT SIGNALS (how they interact)
  asks_questions BOOLEAN,
  answers_questions BOOLEAN,
  gives_advice BOOLEAN,
  makes_jokes BOOLEAN,
  critiques_others BOOLEAN,
  supports_others BOOLEAN,

  -- TRUST SIGNALS
  makes_claims BOOLEAN,
  claims_verifiable BOOLEAN,
  admits_uncertainty BOOLEAN,

  -- META
  extracted_at TIMESTAMPTZ DEFAULT now(),
  model_used TEXT,
  confidence DECIMAL(3,2)
);

CREATE INDEX IF NOT EXISTS persona_signals_author ON comment_persona_signals(author_username);
CREATE INDEX IF NOT EXISTS persona_signals_vehicle ON comment_persona_signals(vehicle_id);
CREATE INDEX IF NOT EXISTS persona_signals_platform ON comment_persona_signals(platform);


-- 2. AGGREGATED AUTHOR PERSONAS
-- Roll up signals into author profiles
CREATE TABLE IF NOT EXISTS author_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  username TEXT NOT NULL,
  platform TEXT DEFAULT 'bat',
  author_id UUID,                      -- normalized if we have it

  -- PERSONA TYPE (computed from signals)
  primary_persona TEXT,                -- 'helpful_expert', 'casual_enthusiast', 'serious_buyer', 'dealer', 'critic'
  secondary_personas TEXT[],

  -- AGGREGATED TONE (averages)
  avg_tone_helpful DECIMAL(3,2),
  avg_tone_technical DECIMAL(3,2),
  avg_tone_friendly DECIMAL(3,2),
  avg_tone_confident DECIMAL(3,2),
  avg_tone_snarky DECIMAL(3,2),

  -- EXPERTISE PROFILE
  expertise_level TEXT,                -- overall level
  expertise_areas TEXT[],              -- all areas they've shown knowledge
  top_expertise_area TEXT,             -- strongest area

  -- ENGAGEMENT STATS
  total_comments INT DEFAULT 0,
  comments_with_questions INT DEFAULT 0,
  comments_with_answers INT DEFAULT 0,
  comments_with_advice INT DEFAULT 0,
  comments_supportive INT DEFAULT 0,
  comments_critical INT DEFAULT 0,

  -- BEHAVIORAL PATTERNS
  avg_comment_length INT,
  active_hours INT[],                  -- hours of day they're active
  active_days INT[],                   -- days of week
  vehicles_commented_on INT DEFAULT 0,
  unique_makes TEXT[],                 -- makes they comment on

  -- TRUST/REPUTATION
  trust_score DECIMAL(3,2),            -- computed trust
  accuracy_score DECIMAL(3,2),         -- when they make claims, are they right?
  influence_score DECIMAL(3,2),        -- do others engage with them?

  -- OUTCOMES (if we can track)
  known_purchases INT DEFAULT 0,
  known_sales INT DEFAULT 0,
  avg_purchase_price INT,

  -- META
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS author_personas_username ON author_personas(username, platform);
CREATE INDEX IF NOT EXISTS author_personas_type ON author_personas(primary_persona);
CREATE INDEX IF NOT EXISTS author_personas_trust ON author_personas(trust_score DESC);


-- 3. PERSONA BENCHMARKS
-- What do successful personas look like?
CREATE TABLE IF NOT EXISTS persona_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Segment
  persona_type TEXT NOT NULL,          -- 'successful_dealer', 'top_buyer', 'trusted_expert'
  platform TEXT DEFAULT 'bat',

  -- Ideal traits
  ideal_tone_helpful DECIMAL(3,2),
  ideal_tone_technical DECIMAL(3,2),
  ideal_tone_friendly DECIMAL(3,2),
  ideal_tone_confident DECIMAL(3,2),
  ideal_tone_snarky DECIMAL(3,2),

  -- Success metrics
  avg_engagement_rate DECIMAL(5,2),
  avg_deal_close_rate DECIMAL(3,2),
  avg_sale_price_premium DECIMAL(5,2), -- % above market

  -- Sample size
  authors_in_segment INT,
  comments_analyzed INT,

  -- Insights
  key_behaviors TEXT[],                -- what they do differently
  avoid_behaviors TEXT[],              -- what successful ones don't do

  updated_at TIMESTAMPTZ DEFAULT now()
);


-- 4. PERSONA COACHING SUGGESTIONS
-- Generated recommendations for users
CREATE TABLE IF NOT EXISTS persona_coaching (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  author_id UUID,
  username TEXT NOT NULL,

  -- Current state
  current_persona TEXT,
  current_trust_score DECIMAL(3,2),

  -- Suggestion
  suggestion_type TEXT,                -- 'tone', 'expertise', 'engagement', 'consistency'
  suggestion TEXT,                     -- "Be more specific when giving advice"
  expected_impact TEXT,                -- "Could increase trust score by 15%"

  -- Evidence
  example_good_comment TEXT,
  example_improve_comment TEXT,

  -- Status
  shown_to_user BOOLEAN DEFAULT false,
  accepted BOOLEAN,

  created_at TIMESTAMPTZ DEFAULT now()
);


-- 5. RLS
ALTER TABLE comment_persona_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE author_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_coaching ENABLE ROW LEVEL SECURITY;

-- Public read for aggregated/anonymous data
CREATE POLICY "Public read author_personas" ON author_personas FOR SELECT USING (true);
CREATE POLICY "Public read persona_benchmarks" ON persona_benchmarks FOR SELECT USING (true);

-- Service role for writes
CREATE POLICY "Service write comment_persona_signals" ON comment_persona_signals FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write author_personas" ON author_personas FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write persona_benchmarks" ON persona_benchmarks FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write persona_coaching" ON persona_coaching FOR ALL USING (auth.role() = 'service_role');


-- 6. HELPER VIEW: Author activity summary
CREATE OR REPLACE VIEW author_activity_summary AS
SELECT
  author_username,
  COUNT(*) as total_comments,
  COUNT(DISTINCT vehicle_id) as vehicles_commented,
  AVG(comment_length) as avg_length,
  MIN(extracted_at) as first_comment,
  MAX(extracted_at) as last_comment,
  AVG(tone_helpful) as avg_helpful,
  AVG(tone_technical) as avg_technical,
  AVG(expertise_level = 'expert' OR expertise_level = 'professional')::DECIMAL as expert_rate
FROM comment_persona_signals
GROUP BY author_username;
