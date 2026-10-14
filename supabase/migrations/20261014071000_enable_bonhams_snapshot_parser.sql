-- Enable cron job 376 (bonhams-snapshot-parser): the regex parser over the Bonhams snapshot queue, no AI.
--
-- READ THIS FIRST. This lands no data. All 127 rows in the Bonhams queue (77 pending + 50 stuck in processing) point at
-- vehicles that no longer exist (2026-10-14: 127 of 127 have no vehicles row). What enabling the job does is end those rows:
-- three runs (50, 50, 27) mark them 'no_vehicle', the queue is empty, and the job should then be paused. It is queue
-- hygiene, not intake. The 5,764 Bonhams rows already completed are untouched.
--
-- WHAT. Job 376 has been paused since 2026-04-25. It posts to batch-extract-snapshots in queue mode. One change to its body,
-- everything else kept (schedule '4-59/5 * * * *', URL, headers, batch_size 50, mode, use_queue, platform):
--   + "no_ai": true              the model is never called (batch-extract-snapshots honors it since #1127)
-- and one addition to the request: timeout_milliseconds := 120000 (the default 5000 ms drops the run's report). Through the
-- cron API (cron.alter_job): the deploy role may call it but not write cron.job. The command is rebuilt from the live one with
-- a replace, and the migration refuses if the old body is not in it exactly once.
--
-- ORDER. Merge only after the batch-extract-snapshots PR (#1127) has been merged and its deploy has finished. CI applies
-- migrations BEFORE it deploys changed functions. The old function would claim the 50 rows, find no vehicles, return "No
-- vehicles need extraction" and leave all 50 in 'processing', to be re-claimed every 5 minutes for ever (the livelock #1127
-- fixes). Check the deploy first: the deployed source (Supabase get_edge_function batch-extract-snapshots) must contain aiGate.ts.
--
-- VAULT. The command authenticates with get_service_role_key_for_cron(), which reads the key from public._app_secrets. The leaked
-- service-role key is being turned off and the vault given the new one. Until the vault holds a key the functions accept,
-- every run of this job is refused with 401 by requireWriteAuth and lands nothing. Check before merging, read-only (Logs
-- Explorer, last 2 hours): job 419 poll-listing-feeds runs every 15 minutes through the same function and must show only 200s.
--   select log_attributes['response.status_code'] as status, count(*) from logs where source = 'function_edge_logs'
--     and log_attributes['request.pathname'] = '/functions/v1/poll-listing-feeds' group by 1;     -- 200 only, no 401
--
-- BOUND. 12 runs an hour, at most 50 rows each, 127 rows in all; nothing is read from the bucket because no row has a vehicle.
-- No Firecrawl, no AI, no other host.
--
-- BEFORE (2026-10-14, scripts/data/q.sh)
--   select status, count(*), count(v.id) as with_vehicle_row from snapshot_extraction_queue q
--     left join vehicles v on v.id = q.vehicle_id where q.platform = 'bonhams' and q.status in ('pending','processing') group by 1;
--   pending 77 (0 with a vehicle) · processing 50 (0 with a vehicle).   Whole Bonhams queue: completed 5,764 · failed 2.
--
-- EXPECTED AFTER (three runs, about 15 minutes after the migration):
--   run 1: the 50 stuck rows return to pending, 50 are claimed and ended no_vehicle   (pending 127 -> 77)
--   run 2: 50 ended                                                                    (pending 27)
--   run 3: 27 ended                                                                    (pending 0)
--   run 4 on: "No pending items in queue"
--   Bonhams queue: pending 0, processing 0, no_vehicle 127, completed 5,764, failed 2. Vehicles updated: 0. Fields landed: 0.
--   AI calls: 0.
--
-- STOP RULE. Pause (select cron.alter_job(job_id := 376, active := false)) when pending reaches 0, which is the intended end,
-- or at once on any of: a run report with ai_calls > 0 or a '[AI-fallback]' line in the function logs; errors > 0 in a report;
-- a vehicles_found above 0 (a row that does have a vehicle: stop and read it, this job was vetted on 127 rows with none).
--   select status, count(*) from snapshot_extraction_queue where platform = 'bonhams' group by 1;            -- no_vehicle 127
--   select id, status_code, left(content::text, 600) from net._http_response order by id desc limit 3;     -- the run reports
--   select count(*) from logs where source = 'function_logs' and event_message like '%[AI-fallback]%'        -- Logs Explorer: 0
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $mig$
DECLARE
  cur      text;
  old_body constant text := $b$body := '{"platform": "bonhams", "batch_size": 50, "mode": "sparse", "use_queue": true}'::jsonb$b$;
  new_body constant text := $b$body := '{"platform": "bonhams", "batch_size": 50, "mode": "sparse", "use_queue": true, "no_ai": true}'::jsonb,
    timeout_milliseconds := 120000$b$;
BEGIN
  SELECT command INTO cur FROM cron.job WHERE jobid = 376 AND jobname = 'bonhams-snapshot-parser';
  IF cur IS NULL THEN
    RAISE EXCEPTION 'cron job 376 bonhams-snapshot-parser not found';
  END IF;
  IF (length(cur) - length(replace(cur, old_body, ''))) <> length(old_body) THEN
    RAISE EXCEPTION 'cron job 376 does not hold the expected request body exactly once; read it again before changing it';
  END IF;
  PERFORM cron.alter_job(job_id := 376, command := replace(cur, old_body, new_body), active := true);
END $mig$;

DO $check$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobid = 376 AND jobname = 'bonhams-snapshot-parser' AND active AND schedule = '4-59/5 * * * *'
       AND command LIKE '%/functions/v1/batch-extract-snapshots%'
       AND command LIKE '%"platform": "bonhams"%'
       AND command LIKE '%"batch_size": 50%'
       AND command LIKE '%"use_queue": true%'
       AND command LIKE '%"no_ai": true%'
       AND command LIKE '%timeout_milliseconds := 120000%'
  ) THEN
    RAISE EXCEPTION 'cron job 376 was not enabled with no_ai';
  END IF;
END $check$;

COMMIT;
