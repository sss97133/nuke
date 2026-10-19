-- mecum-targets-landing: land Mecum lots from source_targets through extract-mecum action batch_from_targets.
--
-- Measured 2026-10-15: 266,998 mecum rows in source_targets, 69,314 mecum vehicle_events all time, none created since
-- 2026-03-26. The 2-hourly workflow failed every run (extract-premium-auction -> extract-vehicle-data-ai non-2xx) and
-- extract-mecum's free path read __NEXT_DATA__, which lot pages no longer carry. The function now reads the app-router
-- payload, and this job drives it: 25 lots per run, 1.5 s apart (Mecum robots.txt Crawl-delay: 1), every 5 minutes
-- (about 300 lots an hour, one request per 1.5 s for about 40 s of each 5 minutes). The function stops early on
-- 3 failures in a row or any 403/429. No paid service is called: direct fetch only.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mecum-targets-landing';

SELECT cron.schedule(
  'mecum-targets-landing',
  '*/5 * * * *',
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
    body := '{"action": "batch_from_targets", "limit": 25, "delay_ms": 1500}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

COMMIT;
