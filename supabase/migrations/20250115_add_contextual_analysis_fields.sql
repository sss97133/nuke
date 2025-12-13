-- Add contextual analysis fields to timeline_events
-- These fields support the enhanced contextual batch analyzer

-- Note: vehicle_timeline_events is a VIEW, the base table is timeline_events

-- Add contextual analysis status
ALTER TABLE IF EXISTS public.timeline_events
ADD COLUMN IF NOT EXISTS contextual_analysis_status TEXT DEFAULT 'pending' 
  CHECK (contextual_analysis_status IN ('pending', 'processing', 'completed', 'failed'));

-- Add index for pending analysis queries
DO $$
BEGIN
  IF to_regclass('public.timeline_events') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_timeline_events_contextual_status ON public.timeline_events(contextual_analysis_status) WHERE contextual_analysis_status = ''pending''';
  END IF;
END $$;

-- Add comment
DO $$
BEGIN
  IF to_regclass('public.timeline_events') IS NOT NULL THEN
    EXECUTE 'COMMENT ON COLUMN public.timeline_events.contextual_analysis_status IS ''Status of contextual batch analysis: pending, processing, completed, or failed''';
  END IF;
END $$;

-- The contextual_analysis and user_commitment_score data will be stored in the metadata JSONB field
-- This migration just adds the status tracking column

