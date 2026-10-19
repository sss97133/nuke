-- barnfinds-intake-batch: land Barn Finds posts from source_targets through extract-barn-finds-listing action batch.
--
-- Measured 2026-10-15: 59,662 barnfinds rows in source_targets, 0 barnfinds vehicle_events. The extractor wrote its event with
-- an upsert whose conflict target Postgres cannot infer (#1261 writes by key), and nothing scheduled it. This job drives it:
-- 50 posts per run, one fetch per 2 s (about 110 s of each 5 minutes), every 5 minutes: at most 600 posts an hour from one
-- site. The function stops on a 403/429, after 3 failures in a row, and at its time box. Direct fetch only, no paid service.
-- Replaces 20261015030000_barnfinds_intake_batch.sql, which queued all targets in import_queue and timed out in CI (its
-- insert triggers cost 14 ms a row and would have fired one HTTP call per row); that file never applied and is removed.
-- Stop: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'barnfinds-intake-batch'), active := false)
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'barnfinds-intake-batch';

SELECT cron.schedule(
  'barnfinds-intake-batch',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-barn-finds-listing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{"action": "batch", "limit": 50}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);

COMMIT;
