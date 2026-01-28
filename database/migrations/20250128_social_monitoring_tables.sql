-- Social Monitoring Tables
-- Supports the live content discovery and engagement tracking system

-- Social Opportunities: Viral moments and reply opportunities discovered
CREATE TABLE IF NOT EXISTS social_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x',
  opportunity_type TEXT NOT NULL, -- 'reply_opportunity', 'trending_wave', 'viral_post', 'niche_mention'
  tweet_id TEXT,
  content TEXT NOT NULL,
  source_account TEXT,
  engagement_metrics JSONB DEFAULT '{}',
  relevance_score REAL DEFAULT 0.5,
  suggested_action TEXT,
  urgency TEXT DEFAULT 'soon', -- 'now', 'soon', 'when_ready'
  status TEXT DEFAULT 'new', -- 'new', 'viewed', 'acted', 'dismissed'
  acted_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, tweet_id)
);

-- Social Alerts: Notifications for viral moments, engagement spikes, etc.
CREATE TABLE IF NOT EXISTS social_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x',
  alert_type TEXT NOT NULL, -- 'viral_moment', 'engagement_spike', 'mention', 'reply'
  tweet_id TEXT,
  message TEXT NOT NULL,
  engagement_snapshot JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, tweet_id, alert_type)
);

-- Social Posts: Already exists but ensure engagement_metrics column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'social_posts' AND column_name = 'engagement_metrics'
  ) THEN
    ALTER TABLE social_posts ADD COLUMN engagement_metrics JSONB DEFAULT '{}';
  END IF;
END $$;

-- Watched Accounts: Accounts to monitor for opportunities
CREATE TABLE IF NOT EXISTS social_watched_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x',
  account_handle TEXT NOT NULL,
  account_name TEXT,
  reason TEXT, -- Why this account is watched
  priority INTEGER DEFAULT 5, -- 1-10, higher = more important
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, account_handle)
);

-- Monitored Keywords: Keywords to track for opportunities
CREATE TABLE IF NOT EXISTS social_monitored_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x',
  keyword TEXT NOT NULL,
  category TEXT, -- 'niche', 'trending', 'brand', 'competitor'
  active BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform, keyword)
);

-- Social Content Queue: Drafted posts waiting to be sent
CREATE TABLE IF NOT EXISTS social_content_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x',
  external_identity_id UUID REFERENCES external_identities(id),
  content TEXT NOT NULL,
  media_urls TEXT[], -- URLs of media to attach
  scheduled_for TIMESTAMPTZ, -- NULL = manual post
  reply_to_tweet_id TEXT, -- If this is a reply
  quote_tweet_id TEXT, -- If this is a quote tweet
  status TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'posted', 'failed'
  posted_at TIMESTAMPTZ,
  post_id TEXT, -- ID of the posted tweet
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_social_opportunities_user_status ON social_opportunities(user_id, status);
CREATE INDEX IF NOT EXISTS idx_social_opportunities_discovered ON social_opportunities(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_alerts_user_read ON social_alerts(user_id, read);
CREATE INDEX IF NOT EXISTS idx_social_content_queue_scheduled ON social_content_queue(scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_content_queue_status ON social_content_queue(user_id, status);

-- RLS policies
ALTER TABLE social_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_watched_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_monitored_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_content_queue ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can view own opportunities" ON social_opportunities
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own opportunities" ON social_opportunities
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own alerts" ON social_alerts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own alerts" ON social_alerts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own watched accounts" ON social_watched_accounts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own watched accounts" ON social_watched_accounts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own keywords" ON social_monitored_keywords
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own keywords" ON social_monitored_keywords
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own queue" ON social_content_queue
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own queue" ON social_content_queue
  FOR ALL USING (auth.uid() = user_id);

-- Service role bypass for edge functions
CREATE POLICY "Service role bypass opportunities" ON social_opportunities
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role bypass alerts" ON social_alerts
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role bypass watched" ON social_watched_accounts
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role bypass keywords" ON social_monitored_keywords
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role bypass queue" ON social_content_queue
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
