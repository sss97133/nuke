-- Remove vehicle_images from the fast stale lock release (it times out on 1M+ rows)
-- Keep only import_queue and bat_extraction_queue which are fast
CREATE OR REPLACE FUNCTION release_stale_locks_fast(
  stale_threshold_minutes integer DEFAULT 5
)
RETURNS TABLE(queue_table text, released integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  n integer;
BEGIN
  -- import_queue (primary concern)
  UPDATE import_queue
  SET status = 'pending', locked_by = NULL, locked_at = NULL
  WHERE status = 'processing'
    AND locked_at < NOW() - (stale_threshold_minutes || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN queue_table := 'import_queue'; released := n; RETURN NEXT; END IF;

  -- bat_extraction_queue (secondary)
  UPDATE bat_extraction_queue
  SET status = 'pending', locked_by = NULL, locked_at = NULL
  WHERE status = 'processing'
    AND locked_at < NOW() - (stale_threshold_minutes || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN queue_table := 'bat_extraction_queue'; released := n; RETURN NEXT; END IF;

  -- vehicle_images: SKIPPED here — handled separately by a dedicated slow job
  -- (the table has 1M+ rows and times out in this fast cron)
END;
$$;
