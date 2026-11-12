-- The profile's comment summary (popup_vehicle_intel.comment_intel) reads comment_discoveries. Its writer, the discover
-- mode of batch-comment-discovery, had no schedule and last wrote 2026-02-15; PRs #3463 and #3466 bounded it to lots that
-- ended in the last 48 hours and moved it to a current model. This schedules it.
--   * cron comment-summary-recent-closes, every 10 minutes at :04: POST batch-comment-discovery {batch_size: 8, since_hours: 48}.
--     At most 8 model calls a run (1,152 a day). Measured 2026-11-12 on 5 closed BaT lots: $0.0023 a lot on
--     claude-haiku-5-5, so the ceiling is about $2.65 a day; the steady load is the day's closes with 5+ comments
--     (348 owed across the prior 48 hours when this was written).
--   * The function never chains itself and stops a batch on a billing refusal; unsummarized lots stay owed.
-- Rows landed: SELECT count(*) FROM comment_discoveries WHERE prompt_version = 'comment_discovery_v2' AND discovered_at > now() - interval '1 day'.
-- Revert: SELECT cron.unschedule('comment-summary-recent-closes').
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'comment-summary-recent-closes') THEN
    EXECUTE $s$ SELECT cron.schedule('comment-summary-recent-closes', '4-59/10 * * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/batch-comment-discovery',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || get_service_role_key_for_cron()
        ),
        body := '{"batch_size": 8, "since_hours": 48}'::jsonb,
        timeout_milliseconds := 120000
      );
    $c$) $s$;
  END IF;
END $job$;
COMMIT;
