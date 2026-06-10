-- ============================================================================
-- reset_stuck_photo_pipeline_images: batched + newest-first
-- Filed 2026-06-10 (overnight prod-eng)
--
-- Bug: the original (20260609000001) ran ONE unbounded UPDATE over every stuck
-- row. There are 1,256,824 images in 'processing' platform-wide, and every
-- vehicle_images UPDATE fires value-recompute + primary-image + count triggers,
-- so the statement trigger-storms past the postgres role's 120s timeout and the
-- */15 cron FAILS every run. Nothing ever requeues — fresh user uploads sit in
-- 'processing' forever (Skylar's June photos: 101/102 stuck, 0 filed).
--
-- Fix: bound each run to a fixed slice with FOR UPDATE SKIP LOCKED, ordered by
-- updated_at DESC so the NEWEST stuck rows (real user uploads) unstick first.
-- AND bound by an UPPER recency window (last 7 days): the 1.26M ancient stuck
-- rows are scraped listing images that never enter the BYOK analysis loop, and
-- scanning for them (esp. the rare retry-exhausted dead-letter set) is what blew
-- the timeout — and since all phases share one txn, that rollback reverted the
-- requeue too. The 7-day window is a tight index range on
-- idx_vehicle_images_pipeline_stuck (status, updated_at). Per Hard Rule #8.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reset_stuck_photo_pipeline_images()
RETURNS TABLE(requeued_processing integer, requeued_failed integer, dead_lettered integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_processing INT := 0;
  v_failed INT := 0;
  v_dead INT := 0;
  c_batch CONSTANT INT := 2000;  -- bound per phase per run; */15 cron chips away
BEGIN
  -- Stuck in 'processing' >30 min (orchestrator died mid-run). Newest first so
  -- fresh user uploads unstick before the million-row scraped backlog.
  WITH stuck AS (
    SELECT id FROM vehicle_images
    WHERE ai_processing_status = 'processing'
      AND updated_at < now() - interval '30 minutes'
      AND updated_at > now() - interval '7 days'
      AND ai_retry_count < 3
    ORDER BY updated_at DESC
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE vehicle_images v
    SET ai_processing_status = 'pending', ai_retry_count = ai_retry_count + 1
    FROM stuck WHERE v.id = stuck.id
    RETURNING v.id
  )
  SELECT count(*) INTO v_processing FROM upd;

  -- Retryable failures (rate limits, transient fetch). Newest first, bounded.
  WITH retryable AS (
    SELECT id FROM vehicle_images
    WHERE ai_processing_status = 'failed'
      AND updated_at < now() - interval '10 minutes'
      AND updated_at > now() - interval '7 days'
      AND ai_retry_count < 3
      AND is_duplicate IS NOT TRUE
      AND image_url IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  ),
  upd2 AS (
    UPDATE vehicle_images v
    SET ai_processing_status = 'pending', ai_retry_count = ai_retry_count + 1
    FROM retryable WHERE v.id = retryable.id
    RETURNING v.id
  )
  SELECT count(*) INTO v_failed FROM upd2;

  -- Out of budget but still 'processing': settle as 'failed' (dead-letter).
  WITH dead AS (
    SELECT id FROM vehicle_images
    WHERE ai_processing_status = 'processing'
      AND updated_at < now() - interval '30 minutes'
      AND updated_at > now() - interval '7 days'
      AND ai_retry_count >= 3
    ORDER BY updated_at DESC
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  ),
  upd3 AS (
    UPDATE vehicle_images v
    SET ai_processing_status = 'failed'
    FROM dead WHERE v.id = dead.id
    RETURNING v.id
  )
  SELECT count(*) INTO v_dead FROM upd3;

  RETURN QUERY SELECT v_processing, v_failed, v_dead;
END;
$function$;
