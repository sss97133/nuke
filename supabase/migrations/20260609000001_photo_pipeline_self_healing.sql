-- ============================================================================
-- PHOTO PIPELINE SELF-HEALING
-- Filed: 2026-06-09
--
-- Problem: image analysis relies on two fragile triggers and nothing retries.
--   1. Frontend fire-and-forget invoke of photo-pipeline-orchestrator
--      (imageUploadService.ts) — lost on network error / tab close.
--   2. pg_net INSERT trigger (20260215_photo_pipeline_trigger.sql) — reads
--      current_setting('app.settings.supabase_url') which is not set in prod,
--      so the EXCEPTION handler swallows the failure on every insert.
-- Result: images accumulate in ai_processing_status='pending'/'failed' forever
-- and never get classified or routed to a vehicle.
--
-- Fixes:
--   1. Retry budget column (ai_retry_count) on vehicle_images.
--   2. reset_stuck_photo_pipeline_images(): requeues rows stuck in
--      'processing' (>30 min) and retryable 'failed' rows, up to 3 attempts.
--   3. Cron: drain pending images every 5 min via the orchestrator's
--      existing process_pending batch mode.
--   4. Cron: run the stuck-image reset every 15 min.
--   5. Repoint the INSERT trigger at the same helper functions the cron
--      jobs use (get_service_url / get_service_role_key_for_cron) instead
--      of unset app.settings GUCs.
-- ============================================================================

-- 1. Retry budget ------------------------------------------------------------
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS ai_retry_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN vehicle_images.ai_retry_count IS
  'Photo-pipeline requeue attempts (reset_stuck_photo_pipeline_images). Max 3.';

-- Partial index so the reset function never scans the whole table.
CREATE INDEX IF NOT EXISTS idx_vehicle_images_pipeline_stuck
  ON vehicle_images (ai_processing_status, updated_at)
  WHERE ai_processing_status IN ('processing', 'failed');

-- 2. Stuck-image reset --------------------------------------------------------
CREATE OR REPLACE FUNCTION reset_stuck_photo_pipeline_images()
RETURNS TABLE (requeued_processing INT, requeued_failed INT, dead_lettered INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_processing INT := 0;
  v_failed INT := 0;
  v_dead INT := 0;
BEGIN
  -- Images stuck in 'processing' for >30 min: the orchestrator died mid-run
  -- (timeout, crash, deploy). Requeue if budget remains.
  WITH stuck AS (
    UPDATE vehicle_images
    SET ai_processing_status = 'pending',
        ai_retry_count = ai_retry_count + 1
    WHERE ai_processing_status = 'processing'
      AND updated_at < now() - interval '30 minutes'
      AND ai_retry_count < 3
    RETURNING id
  )
  SELECT count(*) INTO v_processing FROM stuck;

  -- Retryable failures (rate limits, transient fetch errors). Permanent
  -- skips write ai_processing_status='completed', so anything 'failed'
  -- is worth another attempt while budget remains.
  WITH retried AS (
    UPDATE vehicle_images
    SET ai_processing_status = 'pending',
        ai_retry_count = ai_retry_count + 1
    WHERE ai_processing_status = 'failed'
      AND updated_at < now() - interval '10 minutes'
      AND ai_retry_count < 3
      AND is_duplicate IS NOT TRUE
      AND image_url IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_failed FROM retried;

  -- Out of budget while still marked 'processing': settle as 'failed' so the
  -- row stops looking in-flight. (ai_processing_status has a CHECK constraint
  -- limited to pending/processing/completed/failed/skipped; failed rows with
  -- ai_retry_count >= 3 are the dead-letter set.)
  WITH dead AS (
    UPDATE vehicle_images
    SET ai_processing_status = 'failed'
    WHERE ai_processing_status = 'processing'
      AND updated_at < now() - interval '30 minutes'
      AND ai_retry_count >= 3
    RETURNING id
  )
  SELECT count(*) INTO v_dead FROM dead;

  RETURN QUERY SELECT v_processing, v_failed, v_dead;
END;
$$;

COMMENT ON FUNCTION reset_stuck_photo_pipeline_images() IS
  'Requeues photo-pipeline images stuck in processing/failed (3-attempt budget). Run by cron photo-pipeline-reset-stuck.';

-- 3. Cron: drain pending images every 5 minutes -------------------------------
SELECT cron.unschedule('photo-pipeline-drain')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'photo-pipeline-drain');

SELECT cron.schedule(
  'photo-pipeline-drain',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"action": "process_pending", "limit": 10}'::jsonb
    );
  $$
);

-- 4. Cron: reset stuck images every 15 minutes --------------------------------
SELECT cron.unschedule('photo-pipeline-reset-stuck')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'photo-pipeline-reset-stuck');

SELECT cron.schedule(
  'photo-pipeline-reset-stuck',
  '*/15 * * * *',
  $$ SELECT reset_stuck_photo_pipeline_images(); $$
);

-- 5. Fix the INSERT trigger to use working credential helpers ------------------
CREATE OR REPLACE FUNCTION trigger_photo_pipeline_orchestrator()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ai_processing_status = 'pending' AND NEW.image_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := jsonb_build_object(
        'image_id', NEW.id,
        'image_url', NEW.image_url,
        'vehicle_id', NEW.vehicle_id,
        'user_id', NEW.user_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Non-blocking by design: the drain cron picks up anything this misses.
  RAISE WARNING 'photo-pipeline trigger failed (pg_net?): %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
