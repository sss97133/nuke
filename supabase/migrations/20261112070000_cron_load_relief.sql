-- Cron load relief after the 2026-11-08 database hang (19:55:44Z-21:06:03Z, CPU 100%, memory 98% on 8 GB / 2 vCPU).
--
-- Measured 2026-11-09 00:00-00:20Z from cron.job_run_details (24 h) and pg_stat_statements (since the 21:06Z restart):
-- - Minutes :00/:10/:20/:30/:40/:50 carry 84-104 busy seconds of cron work per hour-slot; every other minute 2-28.
--   map-facts-recent (35 s avg), cited-evidence-accept (27 s), capture-sets-drain (8.6 s, max 134 s) and
--   clip-carrier-backfill (5.7 s) all start on those minutes. At 19:50Z, six minutes before the hang, they ran together
--   for 295 busy seconds in one minute and every-minute jobs that normally take <1 s took ~30 s.
-- - cited-evidence-accept: 137 runs/day x 27 s = 3,696 s/day; 18 runs read 4,240,290 shared blocks (22.6% of all
--   disk reads since restart, ~1.8 GB per run against 2 GB shared_buffers). cited_evidence_accept_log holds one
--   productive run in the last 36 h (21 rows, 2026-11-07 13:00Z). Hourly keeps it accepting what arrives.
-- - map-facts-recent: 4,813 s/day (the largest cron consumer); each run deletes and re-inserts ~13,000 map_facts rows
--   for the last 3 days. Every 20 minutes is ample for per-day map numbers.
-- - refresh-job-health: 4.8 s every 5 min, 812,963 blocks read and 113,996 temp blocks written in 36 runs.
-- - evidence-backfill-bf001 (every 20 s) and evidence-features-fe001 (every 30 s): evidence_backfill_queue finished
--   on 2026-10-23 (52,825 rows, 0 left); 6,766 empty runs/day, each a new backend. Paused, not unscheduled
--   (these two were scheduled outside migrations).
--
-- Change: schedules and two active flags only; commands untouched.
-- Revert: the same cron.alter_job calls with the 'was' values.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cited-evidence-accept',  '43 * * * *'),      -- was */10
      ('map-facts-recent',       '8-59/20 * * * *'), -- was */10
      ('clip-carrier-backfill',  '9-59/10 * * * *'), -- was */10
      ('capture-sets-drain',     '1-59/5 * * * *'),  -- was */5
      ('refresh-job-health',     '2-59/10 * * * *')  -- was 2-59/5
    ) AS t(name, sched)
  LOOP
    SELECT count(*) INTO n FROM cron.job j WHERE j.jobname = r.name;
    IF n <> 1 THEN RAISE EXCEPTION 'cron_load_relief: expected one job named %, found %', r.name, n; END IF;
    PERFORM cron.alter_job(j.jobid, schedule := r.sched) FROM cron.job j WHERE j.jobname = r.name;
  END LOOP;

  FOR r IN SELECT j.jobid, j.jobname FROM cron.job j
           WHERE j.jobname IN ('evidence-backfill-bf001', 'evidence-features-fe001') LOOP
    IF EXISTS (SELECT 1 FROM public.evidence_backfill_queue WHERE done_at IS NULL OR features_done_at IS NULL) THEN
      RAISE NOTICE 'cron_load_relief: % left active, evidence_backfill_queue has work', r.jobname;
    ELSE
      PERFORM cron.alter_job(r.jobid, active := false);  -- was active
    END IF;
  END LOOP;
END $$;
