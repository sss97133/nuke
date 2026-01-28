-- ============================================================================
-- SOCIAL AUTOMATION SCHEMA
-- Capture insights → Auto-distribute to platforms
-- ============================================================================

-- INSIGHTS
-- Valuable moments captured during work/life
CREATE TABLE IF NOT EXISTS insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who had this insight
  user_id uuid REFERENCES auth.users(id),

  -- The insight itself
  content text NOT NULL,
  context text,  -- What was happening
  source text CHECK (source IN ('vibe_coding', 'conversation', 'manual', 'auto_detected')),

  -- Categorization
  tags text[] DEFAULT '{}',

  -- Distribution
  auto_post_requested boolean DEFAULT false,
  platforms_requested text[] DEFAULT '{}',
  status text DEFAULT 'captured' CHECK (status IN ('captured', 'pending_post', 'posted', 'rejected', 'scheduled')),

  -- Post results
  post_results jsonb,
  posted_at timestamptz,

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SOCIAL POSTS
-- Log of all posts made to social platforms
CREATE TABLE IF NOT EXISTS social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which platform and account
  platform text NOT NULL,  -- 'x', 'instagram', 'threads', 'linkedin'
  external_identity_id uuid REFERENCES external_identities(id),

  -- The post
  post_id text,  -- Platform's ID for the post
  content text,
  post_url text,

  -- Source insight (if derived from an insight)
  insight_id uuid REFERENCES insights(id),

  -- Engagement metrics (updated by sync jobs)
  likes int DEFAULT 0,
  reposts int DEFAULT 0,
  replies int DEFAULT 0,
  views int DEFAULT 0,

  -- Timestamps
  posted_at timestamptz DEFAULT now(),
  metrics_updated_at timestamptz,

  -- Additional data
  metadata jsonb DEFAULT '{}'
);

-- INSIGHT QUEUE
-- For scheduled/batched posting
CREATE TABLE IF NOT EXISTS insight_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  insight_id uuid REFERENCES insights(id),
  platform text NOT NULL,
  external_identity_id uuid REFERENCES external_identities(id),

  -- Scheduling
  scheduled_for timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'posted', 'failed')),
  attempts int DEFAULT 0,
  last_error text,

  -- Result
  post_id uuid REFERENCES social_posts(id),

  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status);
CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_identity ON social_posts(external_identity_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_insight ON social_posts(insight_id);

CREATE INDEX IF NOT EXISTS idx_insight_queue_status ON insight_queue(status, scheduled_for);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Get insights ready to post
CREATE OR REPLACE FUNCTION get_pending_insights(p_limit int DEFAULT 10)
RETURNS TABLE (
  insight_id uuid,
  content text,
  user_id uuid,
  platforms text[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id as insight_id,
    i.content,
    i.user_id,
    i.platforms_requested as platforms
  FROM insights i
  WHERE i.status = 'pending_post'
    AND i.auto_post_requested = true
  ORDER BY i.created_at
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE insights IS 'Valuable insights captured during work sessions for potential distribution';
COMMENT ON TABLE social_posts IS 'Log of all posts made to social platforms';
COMMENT ON TABLE insight_queue IS 'Queue for scheduled/batched social posting';
