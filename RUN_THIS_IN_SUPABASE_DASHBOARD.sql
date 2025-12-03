-- ========================================
-- CONTEXTUAL ANALYSIS MIGRATION
-- Run this in Supabase Dashboard → SQL Editor
-- ========================================

-- Add contextual analysis status column
ALTER TABLE timeline_events
ADD COLUMN IF NOT EXISTS contextual_analysis_status TEXT DEFAULT 'pending' 
  CHECK (contextual_analysis_status IN ('pending', 'processing', 'completed', 'failed'));

-- Add index for pending analysis queries
CREATE INDEX IF NOT EXISTS idx_timeline_events_contextual_status 
  ON timeline_events(contextual_analysis_status) 
  WHERE contextual_analysis_status = 'pending';

-- Add comment
COMMENT ON COLUMN timeline_events.contextual_analysis_status IS 
  'Status of contextual batch analysis: pending, processing, completed, or failed';

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'timeline_events' 
AND column_name = 'contextual_analysis_status';

-- Show sample of timeline events with images (candidates for analysis)
SELECT 
  te.id,
  te.title,
  te.event_date,
  COUNT(vi.id) as image_count,
  te.contextual_analysis_status
FROM timeline_events te
LEFT JOIN vehicle_images vi ON vi.timeline_event_id = te.id
GROUP BY te.id, te.title, te.event_date, te.contextual_analysis_status
HAVING COUNT(vi.id) > 0
ORDER BY te.event_date DESC
LIMIT 10;

