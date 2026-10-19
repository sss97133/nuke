-- broad-arrow-targets-landing: land Broad Arrow's past lots (source_targets) through extract-broad-arrow batch_from_targets.
--
-- Measured 2026-10-16: 2,194 broad-arrow source_targets, about 1,300 without a broad_arrow event; the hourly roster job (586)
-- lands upcoming lots only, the queue job (452) is paused and read lots through Firecrawl. Lot pages are server-rendered and
-- robots.txt allows them, so the batch reads them directly (0 credits): 12 lots a run, 1.5 s apart, every 10 minutes at minute 7
-- (off the :00/:30/:45 jobs), and it skips the run when firecrawl_io_gate() is closed. About 1,700 lots a day at full speed, so the
-- backlog clears in under a day and the job then idles (nothing unlanded).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'broad-arrow-targets-landing';

SELECT cron.schedule(
  'broad-arrow-targets-landing',
  '7-59/10 * * * *',
  $job$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-broad-arrow',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"action": "batch_from_targets", "limit": 12, "delay_ms": 1500}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

COMMIT;
