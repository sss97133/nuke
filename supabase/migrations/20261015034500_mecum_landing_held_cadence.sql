-- mecum-targets-landing at the held cadence: every 5 minutes, 25 lots, 2 s apart, and INACTIVE.
--
-- 2026-10-15: the job ran every 2 minutes (20 lots) from 01:52Z until the database stopped answering at about 02:32Z.
-- The owner has not answered on Mecum's terms of service, so the rate stays at the earlier 25 lots per 5 minutes. The job
-- is created paused; whoever brings the Mecum jobs back turns it on with cron.alter_job(jobid, active := true).
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
    body := '{"action": "batch_from_targets", "limit": 25, "delay_ms": 2000}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'mecum-targets-landing';

COMMIT;
