-- =============================================================================
-- Extend release_stale_locks() and queue_lock_health to include publication_pages
-- =============================================================================

-- We need to recreate the function to add the publication_pages block.
-- This follows the exact pattern from 20260225000004_release_stale_locks.sql.

CREATE OR REPLACE FUNCTION release_stale_locks(
  stale_threshold_minutes integer DEFAULT 30,
  dry_run boolean DEFAULT false
)
RETURNS TABLE (
  queue_table  text,
  released     integer,
  oldest_lock  timestamptz,
  sample_ids   uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_threshold  timestamptz := now() - (stale_threshold_minutes || ' minutes')::interval;
  v_released   integer;
  v_oldest     timestamptz;
  v_ids        uuid[];
BEGIN
  -- ── import_queue ──
  SELECT
    COUNT(*)::integer,
    MIN(locked_at),
    (ARRAY_AGG(id ORDER BY locked_at))[1:5]
  INTO v_released, v_oldest, v_ids
  FROM import_queue
  WHERE status = 'processing'
    AND locked_at < v_threshold;

  IF v_released > 0 THEN
    IF NOT dry_run THEN
      UPDATE import_queue
      SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE status = 'processing' AND locked_at < v_threshold;
    END IF;
    queue_table := 'import_queue';
    released := v_released;
    oldest_lock := v_oldest;
    sample_ids := v_ids;
    RETURN NEXT;
  END IF;

  -- ── bat_extraction_queue ──
  SELECT
    COUNT(*)::integer,
    MIN(locked_at),
    (ARRAY_AGG(id ORDER BY locked_at))[1:5]
  INTO v_released, v_oldest, v_ids
  FROM bat_extraction_queue
  WHERE status = 'processing'
    AND locked_at < v_threshold;

  IF v_released > 0 THEN
    IF NOT dry_run THEN
      UPDATE bat_extraction_queue
      SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE status = 'processing' AND locked_at < v_threshold;
    END IF;
    queue_table := 'bat_extraction_queue';
    released := v_released;
    oldest_lock := v_oldest;
    sample_ids := v_ids;
    RETURN NEXT;
  END IF;

  -- ── document_ocr_queue ──
  SELECT
    COUNT(*)::integer,
    MIN(locked_at),
    (ARRAY_AGG(id ORDER BY locked_at))[1:5]
  INTO v_released, v_oldest, v_ids
  FROM document_ocr_queue
  WHERE status = 'processing'
    AND locked_at < v_threshold;

  IF v_released > 0 THEN
    IF NOT dry_run THEN
      UPDATE document_ocr_queue
      SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE status = 'processing' AND locked_at < v_threshold;
    END IF;
    queue_table := 'document_ocr_queue';
    released := v_released;
    oldest_lock := v_oldest;
    sample_ids := v_ids;
    RETURN NEXT;
  END IF;

  -- ── publication_pages (NEW) ──
  SELECT
    COUNT(*)::integer,
    MIN(locked_at),
    (ARRAY_AGG(id ORDER BY locked_at))[1:5]
  INTO v_released, v_oldest, v_ids
  FROM publication_pages
  WHERE ai_processing_status = 'processing'
    AND locked_at < v_threshold;

  IF v_released > 0 THEN
    IF NOT dry_run THEN
      UPDATE publication_pages
      SET ai_processing_status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE ai_processing_status = 'processing' AND locked_at < v_threshold;
    END IF;
    queue_table := 'publication_pages';
    released := v_released;
    oldest_lock := v_oldest;
    sample_ids := v_ids;
    RETURN NEXT;
  END IF;
END;
$$;

-- Recreate the view with publication_pages included
CREATE OR REPLACE VIEW queue_lock_health AS
WITH queues AS (
  SELECT 'import_queue' AS table_name, status, locked_at, NOW() - locked_at AS lock_age
  FROM import_queue WHERE status = 'processing'
  UNION ALL
  SELECT 'bat_extraction_queue', status, locked_at, NOW() - locked_at
  FROM bat_extraction_queue WHERE status = 'processing'
  UNION ALL
  SELECT 'document_ocr_queue', status, locked_at, NOW() - locked_at
  FROM document_ocr_queue WHERE status = ANY (ARRAY['classifying', 'extracting', 'linking'])
  UNION ALL
  SELECT 'publication_pages', ai_processing_status, locked_at, NOW() - locked_at
  FROM publication_pages WHERE ai_processing_status = 'processing'
)
SELECT
  table_name,
  COUNT(*) AS locked_count,
  COUNT(*) FILTER (WHERE lock_age > interval '30 minutes') AS stale_count,
  MIN(locked_at) AS oldest_lock,
  MAX(locked_at) AS newest_lock
FROM queues
GROUP BY table_name
ORDER BY stale_count DESC, locked_count DESC;
