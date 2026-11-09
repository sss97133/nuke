-- T6 (paste loop): drain evaluate_listing coverage misses.
--
-- Why: log_listing_coverage (20261022234500) queues a miss into import_queue with the platform's scrape source
-- (e.g. Bring a Trailer db9ff20a…), but the only active import-queue crons claim other sources
-- (process-import-queue-batch-2 → Gooding ce74e304…, bat-settlement-drain → 4d3f0c9e…). Nothing claims a miss, and
-- a row a worker once claimed and lost (release-stale-locks puts it back to 'pending', attempts kept) is invisible
-- to any claimer whose max_attempts is ≤ its attempts. The Nov 5 2026 miss
-- (dcd24793…, https://bringatrailer.com/?post_type=bat-listing&p=126086136, attempts 3) has sat pending since.
--
-- What: a claim RPC scoped to coverage misses, and a 5-minute drain through the existing process-import-queue
-- (which now resolves BaT ?p= shortlinks and fails dead posts terminally). The job is created DISABLED: enable it
-- after review with  SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'coverage-miss-drain';
--
-- No data rows are changed by this migration.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.claim_import_queue_coverage_misses(
  p_batch_size integer DEFAULT 5,
  p_max_attempts integer DEFAULT 8,
  p_worker_id text DEFAULT NULL,
  p_lock_ttl_seconds integer DEFAULT 900
) RETURNS SETOF public.import_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := now();
  v_lock_ttl interval := make_interval(secs => greatest(30, least(coalesce(p_lock_ttl_seconds, 900), 3600)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT iq.id
    FROM public.import_queue iq
    WHERE iq.status = 'pending'
      AND iq.raw_data->>'queued_reason' = 'coverage_miss'
      AND coalesce(iq.attempts, 0) < coalesce(p_max_attempts, 8)
      AND (iq.next_attempt_at IS NULL OR iq.next_attempt_at <= v_now)
      AND (iq.locked_at IS NULL OR iq.locked_at < v_now - v_lock_ttl)
    ORDER BY coalesce(iq.priority, 0) DESC, iq.created_at ASC
    LIMIT greatest(1, least(coalesce(p_batch_size, 5), 50))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.import_queue iq
    SET status = 'processing',
        attempts = coalesce(iq.attempts, 0) + 1,
        locked_at = v_now,
        locked_by = coalesce(p_worker_id, 'coverage-miss-drain'),
        last_attempt_at = v_now
    WHERE iq.id IN (SELECT id FROM candidates)
    RETURNING iq.*
  )
  SELECT * FROM claimed;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_import_queue_coverage_misses(integer, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_import_queue_coverage_misses(integer, integer, text, integer) TO service_role;
COMMENT ON FUNCTION public.claim_import_queue_coverage_misses(integer, integer, text, integer) IS
  'Claims pending import_queue rows queued by log_listing_coverage (raw_data.queued_reason = coverage_miss) for process-import-queue {queued_reason: coverage_miss}. Same lock/attempt contract as claim_import_queue_batch.';

DO $sched$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'coverage-miss-drain' LOOP PERFORM cron.unschedule(j); END LOOP;
  j := cron.schedule('coverage-miss-drain', '3-59/5 * * * *', $cmd$SELECT net.http_post(
    url := get_service_url() || '/functions/v1/process-import-queue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"batch_size": 5, "queued_reason": "coverage_miss"}'::jsonb,
    timeout_milliseconds := 150000);$cmd$);
  -- Created disabled on purpose: a reviewer enables it (see header).
  PERFORM cron.alter_job(j, active := false);
END $sched$;
