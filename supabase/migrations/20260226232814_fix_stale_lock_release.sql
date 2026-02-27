-- 1. Create a fast, focused function for import_queue lock release only
-- Uses 5-minute default threshold, no expensive vehicle_images scan
CREATE OR REPLACE FUNCTION release_import_queue_locks(
  stale_threshold_minutes integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  released_count integer;
BEGIN
  UPDATE import_queue
  SET status = 'pending', locked_by = NULL, locked_at = NULL
  WHERE status = 'processing'
    AND locked_at < NOW() - (stale_threshold_minutes || ' minutes')::interval;

  GET DIAGNOSTICS released_count = ROW_COUNT;
  RETURN released_count;
END;
$$;

-- 2. Also create a fast version that handles all queues WITHOUT the broken vehicle_images scan
CREATE OR REPLACE FUNCTION release_stale_locks_fast(
  stale_threshold_minutes integer DEFAULT 10
)
RETURNS TABLE(queue_table text, released integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  n integer;
BEGIN
  -- import_queue
  UPDATE import_queue
  SET status = 'pending', locked_by = NULL, locked_at = NULL
  WHERE status = 'processing'
    AND locked_at < NOW() - (stale_threshold_minutes || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN queue_table := 'import_queue'; released := n; RETURN NEXT; END IF;

  -- bat_extraction_queue
  UPDATE bat_extraction_queue
  SET status = 'pending', locked_by = NULL, locked_at = NULL
  WHERE status = 'processing'
    AND locked_at < NOW() - (stale_threshold_minutes || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN queue_table := 'bat_extraction_queue'; released := n; RETURN NEXT; END IF;

  -- vehicle_images - use LIMIT to avoid full scan timeout
  UPDATE vehicle_images
  SET ai_processing_status = 'pending', ai_processing_started_at = NULL
  WHERE id IN (
    SELECT id FROM vehicle_images
    WHERE ai_processing_status = 'processing'
      AND ai_processing_started_at < NOW() - (stale_threshold_minutes || ' minutes')::interval
    LIMIT 1000
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN queue_table := 'vehicle_images'; released := n; RETURN NEXT; END IF;
END;
$$;

-- 3. Update cron job 188 to use the new fast function with 5-min threshold
SELECT cron.alter_job(
  job_id := 188,
  command := 'SELECT release_stale_locks_fast(stale_threshold_minutes := 5)'
);
