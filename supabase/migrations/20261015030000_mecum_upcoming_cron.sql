-- mecum-targets-landing every 2 minutes (20 lots, 2 s apart, 100 s budget so runs never overlap) and
-- mecum-upcoming-roster hourly (extract-mecum action enumerate_upcoming).
--
-- Measured 2026-10-15 01:10-01:20Z: at 25 lots per 5 minutes with 1.5 s between lots the job landed 17-21 lots a run and
-- hit the function's time budget (fetch plus save is 3-5 s a lot), about 5,000 lots a day. Upcoming sales (2,407 lots in
-- 5 sales on Mecum's calendar) are enumerated from its public search index and landed ahead of the sitemap walk; the
-- roster read also schedules re-reads (weekly inside 30 days of the run day, daily inside 7, once the day after) and
-- records the stated size of each sale in source_census.
-- Throttle: one request per 2 s while a run is active (at most 20 lots in about 100 s of every 120 s).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('mecum-targets-landing', 'mecum-upcoming-roster');

SELECT cron.schedule(
  'mecum-targets-landing',
  '*/2 * * * *',
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
    body := '{"action": "batch_from_targets", "limit": 20, "delay_ms": 2000}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

SELECT cron.schedule(
  'mecum-upcoming-roster',
  '7 * * * *',
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
    body := '{"action": "enumerate_upcoming"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

COMMIT;
