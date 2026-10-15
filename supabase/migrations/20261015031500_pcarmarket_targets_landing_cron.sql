-- pcarmarket-targets-landing: land PCarMarket lots from source_targets through import-pcarmarket-listing.
--
-- Measured 2026-10-15: 27,166 pcarmarket source_targets, 5,901 landed, 29 vehicle_events created in 7 days; targets last
-- discovered 2026-02-11; import_queue rows for the source stop 2026-04-14. Pages are server-rendered now and the function
-- reads them directly. Each run lands up to 30 lots, 2 s apart (about 60 s of each 5 minutes, about 360 lots an hour), and
-- stops early on 3 failures in a row or any 403/429. A daily discover_targets run adds new auction slugs from PCarMarket's
-- own sitemaps. No paid service is called. Both jobs are created INACTIVE: the load budget owner turns them on.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('pcarmarket-targets-landing', 'pcarmarket-targets-discover');

SELECT cron.schedule(
  'pcarmarket-targets-landing',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/import-pcarmarket-listing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{"action": "batch_from_targets", "limit": 30, "delay_ms": 2000}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

SELECT cron.schedule(
  'pcarmarket-targets-discover',
  '17 9 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/import-pcarmarket-listing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{"action": "discover_targets"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname IN ('pcarmarket-targets-landing', 'pcarmarket-targets-discover');

COMMIT;
