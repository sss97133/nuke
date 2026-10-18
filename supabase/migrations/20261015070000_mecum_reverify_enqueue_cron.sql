-- mecum-reverify-enqueue: queue the Mecum sales claimed by the orphan backfill for a re-read of the lot page.
--
-- Measured 2026-10-15: 64,951 mecum vehicle_events rows written by orphan-backfill-v1 say sold (from snapshot run dates,
-- Dec-Feb), 53,638 of them on vehicles still marked available. extract-mecum action enqueue_reverify queues 500 of them
-- per call, in event-id order from the last queued one, behind the upcoming roster (priority 50 against 100); the
-- landing job (mecum-targets-landing, 2 s between lots) re-reads each page and stamps the event
-- metadata.sale_reverified confirmed or refused, keeping the backfill's claim in metadata.orphan_claim.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mecum-reverify-enqueue';

SELECT cron.schedule(
  'mecum-reverify-enqueue',
  '*/15 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-mecum',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{"action": "enqueue_reverify", "limit": 500}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

COMMIT;
