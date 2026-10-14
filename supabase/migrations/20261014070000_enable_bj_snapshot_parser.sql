-- Enable cron job 418 (batch-extract-barrett-jackson): the regex parser over the Barrett-Jackson snapshot queue, no AI,
-- 25 rows every 5 minutes.
--
-- WHAT. Job 418 has been paused since 2026-04-25. It posts to batch-extract-snapshots in queue mode. Two changes to its body,
-- everything else kept (schedule '2-59/5 * * * *', URL, headers, mode, use_queue, platform):
--   "batch_size": 100 -> 25      the vetting's bound; go to 100 only after a clean hour
--   + "no_ai": true              the model is never called (batch-extract-snapshots honors it since #1127)
-- and one addition to the request: timeout_milliseconds := 120000. The default is 5000 ms; a run takes longer, so the report
-- (counts, orphans, withheld prices) was dropped by pg_net and the stop rule had nothing to read. Through the cron API
-- (cron.alter_job): the deploy role may call it but not write cron.job. The command is rebuilt from the live one with a
-- replace, and the migration refuses if the old body is not in it exactly once, so nothing else in the job can drift.
--
-- ORDER. Merge only after the batch-extract-snapshots PR (#1127) has been merged and its deploy has finished. CI applies
-- migrations BEFORE it deploys changed functions; this migration in the same push would run the OLD function, which has no
-- no_ai, would call claude-haiku on a regex-empty row, and fails a row whenever the database refuses a price or a VIN. Check
-- the deploy first: the deployed source (Supabase get_edge_function batch-extract-snapshots) must contain aiGate.ts.
--
-- BOUND. 12 runs an hour, 25 rows each: at most 300 queue rows an hour, 7,200 a day, 63,144 rows (63,001 pending + 143 stuck
-- in processing since 2026-06-23, which the first claim returns to pending) in about 8.8 days. A run reads 25 snapshots from the
-- private bucket (about 350 to 440 KB each) and writes at most 25 vehicles. No Firecrawl, no AI, no other host.
--
-- BEFORE (2026-10-14, scripts/data/q.sh): snapshot_extraction_queue, platform 'barrett-jackson'
--   select status, count(*), coalesce(sum(fields_filled),0) from snapshot_extraction_queue
--    where platform = 'barrett-jackson' group by 1 order by 2 desc;
--   pending 63,001 · completed 3,180 (6,515 fields) · processing 143 · failed 82.   vehicle_completion_recompute_queue: 8 rows.
--
-- EXPECTED AFTER. Estimated from the function's own parser run on 390 queue rows read at three places in the pending order
-- (offsets 300, 15,000 and 45,000 by vehicle_id), 239 of them with a live vehicle; the rate is +-6 points:
--                                  per run   per hour   per day     whole queue (8.8 days)
--   rows claimed                      25        300      7,200       63,144
--   ended no_vehicle (39%)          ~9.7       ~116     ~2,790      ~24,400   no vehicle row at all; they are ended, not retried
--   live vehicle processed (61%)   ~15.3       ~184     ~4,410      ~38,700
--   of those, land >= 1 field      ~5.3        ~64     ~1,530      ~13,400   (34.7%)
--   fields landed (0.91 a row)    ~13.9       ~167     ~4,000      ~35,100   trim, engine_type, transmission, color, interior_color, description
--   completed with nothing new     ~10.0       ~120     ~2,880      ~25,300   (65% of live: the parsed fields are already on the vehicle)
--   failed                           ~0         ~0        ~0         ~0       (82 stay)
--   regex_empty                       0          0         0          0       the parser returned a field for 239 of 239 snapshots
--   AI calls                          0          0         0          0       by construction, not by estimate
--   Pending falls by 300 an hour. After a day: pending ~55,900; completed ~7,600; no_vehicle ~2,800.
--   Withheld, not failed: ~27% of live rows parse a price for a vehicle not marked sold (sale_price_withheld), and ~38% of
--   live rows parse a VIN that is already on another vehicle (vin_conflicts): those are duplicates of existing vehicles.
--
-- STOP RULE. Pause (select cron.alter_job(job_id := 418, active := false)) on any of, checked after the first two runs and
-- hourly after (read-only; timed on production 2026-10-14, 0.4 to 0.9 s):
--   1. any AI call: a run report with ai_calls > 0, or in the Logs Explorer
--        select count(*) from logs where source = 'function_logs' and event_message like '%[AI-fallback]%'   -- 0
--   2. failed over 20% of claimed: more than 60 an hour, or errors > 5 in one run's report
--        select count(*) filter (where status = 'failed') from snapshot_extraction_queue
--         where platform = 'barrett-jackson' and completed_at > now() - interval '1 hour';                    -- 0
--   3. vehicle_completion_recompute_queue growing past 5,000:
--        select count(*) from vehicle_completion_recompute_queue;                                            -- 8 now
--   4. no_snapshot above 20% of vehicles_found in a run's report (a live vehicle with no snapshot is marked failed).
--   5. the run's report is missing: select id, status_code, left(content::text, 600) from net._http_response
--        order by id desc limit 3;  (pg_net keeps about 6 hours)
--   Progress, hourly:
--        select count(*) filter (where status = 'completed') completed, count(*) filter (where status = 'no_vehicle') no_vehicle,
--               count(*) filter (where status = 'regex_empty') regex_empty, coalesce(sum(fields_filled), 0) fields
--          from snapshot_extraction_queue where platform = 'barrett-jackson' and completed_at > now() - interval '1 hour';
--   Pause when pending reaches 0.
--
-- NOT DECIDED HERE. The yield is low because most of this queue is duplicate vehicles (see the VIN conflicts above);
-- merging them is the larger gain. And ingest-observation, which the fire-and-forget observation writes call, returned a
-- non-200 for 39% of 95,544 calls in the 24 hours to 2026-10-14 04:00 UTC: some of this job's observations will be lost
-- silently while the vehicle update lands.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $mig$
DECLARE
  cur      text;
  old_body constant text := $b$body := '{"platform": "barrett-jackson", "batch_size": 100, "mode": "sparse", "use_queue": true}'::jsonb$b$;
  new_body constant text := $b$body := '{"platform": "barrett-jackson", "batch_size": 25, "mode": "sparse", "use_queue": true, "no_ai": true}'::jsonb,
    timeout_milliseconds := 120000$b$;
BEGIN
  SELECT command INTO cur FROM cron.job WHERE jobid = 418 AND jobname = 'batch-extract-barrett-jackson';
  IF cur IS NULL THEN
    RAISE EXCEPTION 'cron job 418 batch-extract-barrett-jackson not found';
  END IF;
  IF (length(cur) - length(replace(cur, old_body, ''))) <> length(old_body) THEN
    RAISE EXCEPTION 'cron job 418 does not hold the expected request body exactly once; read it again before changing it';
  END IF;
  PERFORM cron.alter_job(job_id := 418, command := replace(cur, old_body, new_body), active := true);
END $mig$;

DO $check$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobid = 418 AND jobname = 'batch-extract-barrett-jackson' AND active AND schedule = '2-59/5 * * * *'
       AND command LIKE '%/functions/v1/batch-extract-snapshots%'
       AND command LIKE '%"platform": "barrett-jackson"%'
       AND command LIKE '%"batch_size": 25%'
       AND command LIKE '%"use_queue": true%'
       AND command LIKE '%"no_ai": true%'
       AND command LIKE '%timeout_milliseconds := 120000%'
       AND command NOT LIKE '%"batch_size": 100%'
  ) THEN
    RAISE EXCEPTION 'cron job 418 was not enabled with batch_size 25 and no_ai';
  END IF;
END $check$;

COMMIT;
