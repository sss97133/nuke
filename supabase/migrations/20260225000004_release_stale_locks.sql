-- =============================================================================
-- AGENT SAFETY: Stale lock release function
-- =============================================================================
-- Purpose: Queue tables use a lock pattern (locked_by / locked_at) to
--   prevent duplicate processing. When an agent crashes or times out,
--   records get stuck in 'processing' state forever, blocking the queue.
--
-- This function safely reclaims stale locks across all queue tables.
--
-- Usage:
--   -- Dry run (see what would be released)
--   SELECT * FROM release_stale_locks(dry_run := true);
--
--   -- Release locks older than 30 minutes (default)
--   SELECT * FROM release_stale_locks();
--
--   -- Release locks older than 1 hour
--   SELECT * FROM release_stale_locks(stale_threshold_minutes := 60);
-- =============================================================================

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
  v_threshold timestamptz;
  v_released  integer;
  v_oldest    timestamptz;
  v_ids       uuid[];
BEGIN
  v_threshold := now() - (stale_threshold_minutes || ' minutes')::interval;

  -- -------------------------------------------------------------------------
  -- import_queue
  -- -------------------------------------------------------------------------
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
      SET
        status     = 'pending',
        locked_by  = NULL,
        locked_at  = NULL,
        updated_at = now()
      WHERE status = 'processing'
        AND locked_at < v_threshold;
    END IF;

    queue_table := 'import_queue';
    released    := v_released;
    oldest_lock := v_oldest;
    sample_ids  := v_ids;
    RETURN NEXT;
  END IF;

  -- -------------------------------------------------------------------------
  -- bat_extraction_queue
  -- -------------------------------------------------------------------------
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
      SET
        status     = 'pending',
        locked_by  = NULL,
        locked_at  = NULL,
        updated_at = now()
      WHERE status = 'processing'
        AND locked_at < v_threshold;
    END IF;

    queue_table := 'bat_extraction_queue';
    released    := v_released;
    oldest_lock := v_oldest;
    sample_ids  := v_ids;
    RETURN NEXT;
  END IF;

  -- -------------------------------------------------------------------------
  -- document_ocr_queue
  -- -------------------------------------------------------------------------
  SELECT
    COUNT(*)::integer,
    MIN(locked_at),
    (ARRAY_AGG(id ORDER BY locked_at))[1:5]
  INTO v_released, v_oldest, v_ids
  FROM document_ocr_queue
  WHERE status IN ('classifying', 'extracting', 'linking')
    AND locked_at < v_threshold;

  IF v_released > 0 THEN
    IF NOT dry_run THEN
      UPDATE document_ocr_queue
      SET
        status     = 'pending',
        locked_by  = NULL,
        locked_at  = NULL,
        updated_at = now()
      WHERE status IN ('classifying', 'extracting', 'linking')
        AND locked_at < v_threshold;
    END IF;

    queue_table := 'document_ocr_queue';
    released    := v_released;
    oldest_lock := v_oldest;
    sample_ids  := v_ids;
    RETURN NEXT;
  END IF;

  -- -------------------------------------------------------------------------
  -- vehicle_images (ai_processing_status stuck in 'processing')
  -- Note: vehicle_images has no locked_by/locked_at — use ai_processing_started_at
  -- -------------------------------------------------------------------------
  SELECT
    COUNT(*)::integer,
    MIN(ai_processing_started_at),
    (ARRAY_AGG(id ORDER BY ai_processing_started_at))[1:5]
  INTO v_released, v_oldest, v_ids
  FROM vehicle_images
  WHERE ai_processing_status = 'processing'
    AND ai_processing_started_at < v_threshold;

  IF v_released > 0 THEN
    IF NOT dry_run THEN
      UPDATE vehicle_images
      SET
        ai_processing_status = 'pending',
        ai_processing_started_at = NULL,
        updated_at = now()
      WHERE ai_processing_status = 'processing'
        AND ai_processing_started_at < v_threshold;
    END IF;

    queue_table := 'vehicle_images (ai_processing_status)';
    released    := v_released;
    oldest_lock := v_oldest;
    sample_ids  := v_ids;
    RETURN NEXT;
  END IF;

END;
$$;

COMMENT ON FUNCTION release_stale_locks IS
  'Reclaims queue records stuck in processing/locked state due to crashed agents. Safe to run at any time. Use dry_run=true to preview. Default stale threshold: 30 minutes. Called automatically by the stale-lock-release cron, or manually when queue is stuck.';


-- =============================================================================
-- Helper view: current lock health across all queue tables
-- =============================================================================
CREATE OR REPLACE VIEW queue_lock_health AS
WITH queues AS (
  SELECT
    'import_queue' AS table_name,
    status,
    locked_at,
    NOW() - locked_at AS lock_age
  FROM import_queue
  WHERE status = 'processing'

  UNION ALL

  SELECT
    'bat_extraction_queue',
    status,
    locked_at,
    NOW() - locked_at
  FROM bat_extraction_queue
  WHERE status = 'processing'

  UNION ALL

  SELECT
    'document_ocr_queue',
    status,
    locked_at,
    NOW() - locked_at
  FROM document_ocr_queue
  WHERE status IN ('classifying', 'extracting', 'linking')
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

COMMENT ON VIEW queue_lock_health IS
  'Shows current lock state across all queue tables. stale_count > 0 means run release_stale_locks(). Pair with pipeline_registry to understand what each queue does.';
