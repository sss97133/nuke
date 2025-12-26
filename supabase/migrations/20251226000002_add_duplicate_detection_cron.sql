-- ==========================================================================
-- ADD DUPLICATE DETECTION CRON JOB
-- ==========================================================================
-- Purpose: Schedule automatic duplicate detection and merging every 30 minutes
-- ==========================================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a function for the cron job to call
CREATE OR REPLACE FUNCTION process_duplicate_detection_batch()
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_result JSONB;
BEGIN
  -- Process vehicles in batches to avoid timeouts
  FOR v_id IN 
    SELECT id FROM vehicles 
    WHERE year IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 100  -- Process 100 vehicles per run
  LOOP
    BEGIN
      -- Check and auto-merge duplicates for this vehicle
      SELECT check_and_auto_merge_duplicates(v_id, 95) INTO v_result;
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue processing
      RAISE WARNING 'Failed to check duplicates for vehicle %: %', v_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Remove existing job if it exists
SELECT cron.unschedule('auto-duplicate-cleanup') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-duplicate-cleanup'
);

-- Create cron job for automatic duplicate detection and merging
SELECT cron.schedule(
  'auto-duplicate-cleanup',
  '*/30 * * * *', -- Every 30 minutes
  'SELECT process_duplicate_detection_batch();'
);

COMMENT ON FUNCTION process_duplicate_detection_batch IS 'Processes vehicles in batches to check for and auto-merge duplicates. Called by cron job every 30 minutes.';

