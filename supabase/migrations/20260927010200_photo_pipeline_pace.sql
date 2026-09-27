-- Cron accountability, part 3 of 5 — the photo pipeline at a pace a 1 GB box can carry.
-- Session cb179857 / jobs-rebuild, 2026-09-27. Jobs: photo-pipeline-drain (478), photo-pipeline-reset-stuck (479).
--
-- WHAT WAS WRONG (measured 2026-09-27):
--  * 479 ran three 2,000-row phases every 15 minutes. Every vehicle_images UPDATE fires the table's
--    24 triggers (single-primary check, updated_at, primary-image sync, ...), so a phase is thousands of
--    trigger calls; 12 failed / 4 ok in the 4 h before the pause at the 10 s statement_timeout.
--    Only the newest stuck rows matter (Skylar's uploads; the 7-day window already says so), and those
--    arrive in the tens per day, not thousands per quarter hour.
--  * 478 is a single pg_net insert (cheap) that failed 24 of 49 runs purely on startup/statement
--    timeouts, then called the orchestrator with no HTTP timeout at all.
--
-- CHANGES: reset_stuck_photo_pipeline_images() keeps its signature and logic; the per-phase bound drops
-- from 2,000 to 200 and the job runs hourly with its own 55 s budget. 478 runs every 10 minutes with a
-- 120 s HTTP timeout. Both jobs stay PAUSED until the health gate.

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
  c_batch CONSTANT INT := 200;  -- per phase per run; hourly cron (was 2,000 every 15 min — 2026-09-27)
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

COMMENT ON FUNCTION public.reset_stuck_photo_pipeline_images() IS
  'Requeues photo-pipeline images stuck in processing/failed within the last 7 days (200 per phase, 3-attempt budget). Cron photo-pipeline-reset-stuck, hourly at :17 with a 55 s budget. 2026-09-27.';

DO $do$
DECLARE
  v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'photo-pipeline-reset-stuck';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_id, schedule := '17 * * * *',
      command := $cmd$SET statement_timeout = '55s'; SELECT public.reset_stuck_photo_pipeline_images();$cmd$);
  END IF;

  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'photo-pipeline-drain';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_id, schedule := '*/10 * * * *',
      command := $cmd$SELECT net.http_post(
        url := get_service_url() || '/functions/v1/photo-pipeline-orchestrator',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "process_pending", "limit": 10}'::jsonb,
        timeout_milliseconds := 120000);$cmd$);
  END IF;
END
$do$;
