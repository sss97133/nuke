-- Spread pg_cron start minutes: same cadences, staggered offsets.
--
-- 2026-10-15 21:20Z: pg_cron logged 'job startup timeout' for 11 jobs in one minute (bat-live-pull, bat-settlement-drain,
-- drain-completion-b, drain-metric-a/b/c, drain-vehicle-derived-queues, market-venue-v2-fill, project-retained-listing-properties,
-- qualify-retained-vin-references, refresh-market-pulse-live) while the database was idle (4 active, 0 IO waits, REST 0.13 s).
-- Cause: 27 jobs scheduled */N all fire on minute 0 of their step, so 34 jobs start at :00 and :30, 26-27 at :10/:20/:40/:50,
-- against a median of 10. #1595 (every-minute -> */5, */2) added to the :00/:05/... pile-up.
--
-- Change (schedule only; command, owner, active flag and cadence untouched): each */N job gets an offset o-59/N chosen greedily
-- to flatten starts per minute. Peak 34 -> 13 starts per minute (min 12), measured from cron.job at 21:30Z.
-- Kept as is: bat-live-pull-check (paired with bat-live-pull), every-minute jobs, fixed-minute and daily jobs, and the five */N
-- jobs whose best offset is already 0 (drain-vehicle-derived-queues, refresh-market-pulse-live, qualify-bat-archived-sales,
-- derive-vehicle-image-attribution, poll-craigslist).
-- A later cron.schedule(name, '*/N ...') for one of these jobs resets its offset: re-schedule with the offset below instead.
-- Revert: the same cron.alter_job calls with the 'was' schedules.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('drain-vehicle-taxonomy',              '1-59/2 * * * *'),    -- was */2
      ('bat-settlement-drain',                '1-59/5 * * * *'),    -- was */5
      ('bonhams-typesense-land',              '4-59/5 * * * *'),    -- was */5
      ('concierge-notify',                    '3-59/5 * * * *'),    -- was */5
      ('drain-metric-slow',                   '1-59/5 * * * *'),    -- was */5
      ('drain-sale-residual-fold',            '4-59/5 * * * *'),    -- was */5
      ('mecum-targets-landing',               '3-59/5 * * * *'),    -- was */5
      ('project-retained-listing-properties', '1-59/5 * * * *'),    -- was */5
      ('qualify-retained-vin-references',     '4-59/5 * * * *'),    -- was */5
      ('refresh-job-health',                  '2-59/5 * * * *'),    -- was */5
      ('barnfinds-intake-batch',              '5-59/10 * * * *'),   -- was */10
      ('bonhams-lot-pages',                   '1-59/10 * * * *'),   -- was */10
      ('compute-org-seller-stats-daily',      '7-59/10 * * * *'),   -- was */10
      ('derivation-queue-drain',              '8-59/10 * * * *'),   -- was */10
      ('process-import-queue-batch-2',        '9-59/10 * * * *'),   -- was */10
      ('account-deletion-worker',             '10-59/15 * * * *'),  -- was */15
      ('compact-user-image-counts',           '5-59/15 * * * *'),   -- was */15
      ('poll-listing-feeds',                  '13-59/15 * * * *'),  -- was */15
      ('refresh-feed-rollups',                '8-59/15 * * * *'),   -- was */15
      ('sync-live-auctions',                  '1-59/15 * * * *'),   -- was */15
      ('instagram-feed-sync',                 '3-59/30 * * * *')    -- was */30
    ) AS t(name, sched)
  LOOP
    PERFORM cron.alter_job(j.jobid, schedule := r.sched)
    FROM cron.job j WHERE j.jobname = r.name;
  END LOOP;
END $$;

DO $$
DECLARE v_peak int;
BEGIN
  -- Every-hour jobs only: starts per minute of the hour after the change.
  WITH j AS (
    SELECT split_part(schedule, ' ', 1) AS m FROM cron.job WHERE active AND split_part(schedule, ' ', 2) = '*'
  ), parts AS (
    SELECT unnest(string_to_array(m, ',')) AS p FROM j
  ), spec AS (
    SELECT split_part(p, '/', 1) AS base, coalesce(nullif(split_part(p, '/', 2), ''), '1')::int AS step, (p LIKE '%/%') AS stepped FROM parts
  ), rng AS (
    SELECT CASE WHEN base = '*' THEN 0 WHEN base LIKE '%-%' THEN split_part(base, '-', 1)::int ELSE base::int END AS lo,
           CASE WHEN base = '*' THEN 59 WHEN base LIKE '%-%' THEN split_part(base, '-', 2)::int
                WHEN stepped THEN 59 ELSE base::int END AS hi,
           step
    FROM spec
  )
  SELECT max(n) INTO v_peak FROM (
    SELECT g AS minute, count(*) AS n FROM rng, generate_series(lo, hi, step) g GROUP BY g
  ) s;
  IF v_peak > 18 THEN
    RAISE EXCEPTION 'cron start peak is still % jobs in one minute', v_peak;
  END IF;
  RAISE NOTICE 'cron start peak after spread: % jobs per minute', v_peak;
END $$;
