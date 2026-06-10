-- ============================================================================
-- BAT QUEUE WORKER CRON
-- Filed: 2026-06-10
--
-- Root cause of the BaT ingestion stall (diagnosed 2026-06-10):
--   1. 20250109_disable_conflicting_crons_for_orchestrator.sql disabled the
--      BaT discovery/extraction crons in favor of a `pipeline-orchestrator`
--      that was never built.
--   2. .github/workflows/bat-scrape.yml called a `go-grinder` edge function
--      that does not exist in the repo (404 on every 6-hour run).
--   3. bat-url-discovery queues to import_queue, but bat-queue-worker — the
--      only import_queue drainer for BaT — had NO cron. (The 2026-02-27 cron
--      drains bat_extraction_queue, a different table.)
--
-- The workflow is fixed in the same commit to call bat-url-discovery +
-- bat-queue-worker. This cron makes the drain independent of GitHub Actions:
-- every 5 minutes, one batch of 10 (bat-queue-worker uses the atomic
-- claim_import_queue_batch RPC, so overlapping runs are safe by design).
-- ============================================================================

SELECT cron.unschedule('bat-import-queue-worker')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bat-import-queue-worker');

SELECT cron.schedule(
  'bat-import-queue-worker',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := get_service_url() || '/functions/v1/bat-queue-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"batch_size": 10}'::jsonb
    );
  $$
);
