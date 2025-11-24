-- Stream Sessions Table
-- Manages user streaming sessions, scheduling, and analytics

BEGIN;

CREATE TABLE IF NOT EXISTS stream_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  stream_url TEXT NOT NULL,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  is_live BOOLEAN DEFAULT false,
  viewer_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_user_id ON stream_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_live ON stream_sessions(is_live) WHERE is_live = true;
CREATE INDEX IF NOT EXISTS idx_stream_sessions_scheduled ON stream_sessions(scheduled_start) WHERE scheduled_start IS NOT NULL;

-- Enable RLS
ALTER TABLE stream_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage their own streams, anyone can view active streams
CREATE POLICY "Users can manage own streams" ON stream_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view live streams" ON stream_sessions
  FOR SELECT
  USING (is_live = true);

COMMIT;

