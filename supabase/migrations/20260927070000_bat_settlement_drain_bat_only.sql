-- BaT settlement, leg 2 scoped to BaT: a drain that claims only the rows the daily sync queued.
-- Session cb179857 / bat-to-db, 2026-09-27. Follows 20260927060000 (daily sync, probe view).
--
-- WHY: job 420 process-import-queue-batch drains ALL of import_queue. Measured 17:53Z: besides BaT
-- (80 pending, 79 stuck in processing since 06/07, 2,121 failed), the queue holds 22 pending non-BaT
-- rows (hemmings 19, hagerty 3, from 2026-04) and 3,600+ failed rows across classicdriver, mecum,
-- classic.com, hagerty, goodingco, hemmings, barnfinds, jamesedition, carandclassic, craigslist… from
-- 2026-03/04. Enabling 420 would wake those extractors. claim_import_queue_batch() already filters on
-- source_id; bat-closed-lots-sync 1.1.0 stamps every row it queues with the fixed
-- BAT_SETTLEMENT_SOURCE_ID (4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37), so this job drains those and nothing
-- else. 420 stays paused and untouched.
--
-- SCHEMA_LAW: no new organ (a second scheduled call of an existing function with a filter it already
-- supports); created PAUSED; enable after the watch together with bat-closed-lots-sync-daily.

DO $do$
DECLARE
  v_id bigint;
  v_cmd text := $cmd$SELECT net.http_post(
    url := get_service_url() || '/functions/v1/process-import-queue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := '{"batch_size": 10, "source_id": "4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37"}'::jsonb,
    timeout_milliseconds := 150000
  );$cmd$;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'bat-settlement-drain';
  IF v_id IS NULL THEN
    v_id := cron.schedule('bat-settlement-drain', '*/5 * * * *', v_cmd);
    PERFORM cron.alter_job(job_id := v_id, active := false);   -- off until the lead's watch
  ELSE
    PERFORM cron.alter_job(job_id := v_id, schedule := '*/5 * * * *', command := v_cmd);
  END IF;
END
$do$;

-- Live verification (after apply): select jobid, jobname, schedule, active from cron.job
--   where jobname in ('bat-closed-lots-sync-daily','bat-settlement-drain');   -- both active=false
-- After enabling: select status, count(*) from import_queue
--   where source_id = '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37' group by 1;   -- pending drains at ≤120/h
