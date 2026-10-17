-- Slow four every-minute derived jobs so pg_cron can start the rest.
--
-- 2026-10-15: under disk saturation, pg_cron logged 'job startup timeout' across the board over 24 h
-- (lane-live-market, 16:06Z): bat-live-pull 94 of 1,402, drain-vehicle-derived-queues 87 of 701,
-- drain-completion-a/b 80+84 of 595, project-retained-listing-properties 55 of 1,402,
-- qualify-retained-vin-references 47, drain-vehicle-taxonomy 43, qualify-bat-archived-sales 27, poll-craigslist 10 of 73.
-- Five jobs run every minute; when each runs long they overlap and the launcher cannot start new ones.
--
-- Change (schedule only; command, owner and active flag untouched):
--   project-retained-listing-properties  * * * * *   -> */5   (retained-capture projection; backlog work)
--   qualify-retained-vin-references      * * * * *   -> */5   (retained VIN qualification; backlog work)
--   qualify-bat-archived-sales           * * * * *   -> */3   (archived BaT sale qualification; backlog work)
--   drain-vehicle-taxonomy               * * * * *   -> */2
-- Unchanged: bat-live-pull (live bids), the metric/completion drains (queue throughput).
-- Revert: the same cron.alter_job calls with schedule := '* * * * *'.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('project-retained-listing-properties', '*/5 * * * *'),
      ('qualify-retained-vin-references',     '*/5 * * * *'),
      ('qualify-bat-archived-sales',          '*/3 * * * *'),
      ('drain-vehicle-taxonomy',              '*/2 * * * *')) AS t(name, sched)
  LOOP
    PERFORM cron.alter_job(j.jobid, schedule := r.sched)
    FROM cron.job j WHERE j.jobname = r.name;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('project-retained-listing-properties','qualify-retained-vin-references',
             'qualify-bat-archived-sales','drain-vehicle-taxonomy') AND schedule = '* * * * *') THEN
    RAISE EXCEPTION 'a job still runs every minute';
  END IF;
END $$;
