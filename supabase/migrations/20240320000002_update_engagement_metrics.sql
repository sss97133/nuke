-- Update engagement_metrics table
ALTER TABLE engagement_metrics
RENAME COLUMN feed_item_id TO content_id;

-- Add missing columns
ALTER TABLE engagement_metrics
ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS interaction_time TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW());

-- Update RLS policies
DROP POLICY IF EXISTS "Users can view their own engagement metrics" ON engagement_metrics;
DROP POLICY IF EXISTS "Users can insert their own engagement metrics" ON engagement_metrics;
DROP POLICY IF EXISTS "Users can update their own engagement metrics" ON engagement_metrics;
DROP POLICY IF EXISTS "Users can delete their own engagement metrics" ON engagement_metrics;

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