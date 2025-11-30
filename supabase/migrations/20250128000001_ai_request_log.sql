-- AI Request Log Table
-- Tracks API requests for rate limiting (especially free tier providers)

CREATE TABLE IF NOT EXISTS ai_request_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL, -- 'openai', 'anthropic', 'google', etc.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient rate limit queries
CREATE INDEX IF NOT EXISTS idx_ai_request_log_provider_created 
  ON ai_request_log(provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_request_log_user_provider_created 
  ON ai_request_log(user_id, provider, created_at DESC) 
  WHERE user_id IS NOT NULL;

-- Enable RLS
ALTER TABLE ai_request_log ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own request logs
CREATE POLICY "Users can view own request logs" ON ai_request_log
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Auto-cleanup: Delete logs older than 7 days (keep recent for rate limiting)
CREATE OR REPLACE FUNCTION cleanup_old_ai_request_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM ai_request_log
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Optional: Schedule cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-ai-request-logs', '0 2 * * *', 'SELECT cleanup_old_ai_request_logs()');

