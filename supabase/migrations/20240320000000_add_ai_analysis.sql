-- Add AI analysis column to profiles table
ALTER TABLE profiles
ADD COLUMN ai_analysis JSONB;

-- Add engagement metrics table
CREATE TABLE IF NOT EXISTS engagement_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feed_item_id UUID NOT NULL,
  interaction_type TEXT NOT NULL,
  interaction_weight INTEGER DEFAULT 1,
  view_duration_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create index for faster queries
CREATE INDEX idx_engagement_metrics_user_id ON engagement_metrics(user_id);
CREATE INDEX idx_engagement_metrics_created_at ON engagement_metrics(created_at);

-- Add RLS policies
ALTER TABLE engagement_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own engagement metrics"
  ON engagement_metrics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own engagement metrics"
  ON engagement_metrics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own engagement metrics"
  ON engagement_metrics FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own engagement metrics"
  ON engagement_metrics FOR DELETE
  USING (auth.uid() = user_id); 