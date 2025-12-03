-- Add contextual analysis fields to timeline_events
-- These fields support the enhanced contextual batch analyzer

-- Note: vehicle_timeline_events is a VIEW, the base table is timeline_events

-- Add contextual analysis status
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

-- The contextual_analysis and user_commitment_score data will be stored in the metadata JSONB field
-- This migration just adds the status tracking column

