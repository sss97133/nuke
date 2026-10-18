-- 20261008068000_enable_batch_vin_decode_cron.sql
--
-- Turn job 315 (batch-vin-decode-backfill) back on, command and schedule unchanged, so new vehicles keep getting their
-- factory specs from NHTSA while no agent runs (the owner is away for about a week from 2026-10-07).
--
-- EVIDENCE (read-only, prod, 2026-10-07 18:10-18:30Z): 42 of the 414 vehicles created in the 3 days to 18:10Z with a
-- 17-character VIN have no decode; tonight's bulk run (scripts/mass-vin-decode.ts, 86,198 decodes) covered the rest and
-- nothing schedules a decoder. Job 315 has been paused since 2026-04-25, when the whole cron fleet failed with "job startup
-- timeout"; that was not an error of its own (lane G assessment, 2026-10-06). Its command calls
-- get_service_role_key_for_cron() and targets batch-vin-decode, which is on main, calls requireWriteAuth, and decodes
-- through NHTSA vPIC, a free service. The function fills only NULL spec columns on vehicles, skips empty values, and
-- writes no field evidence, so it cannot recreate the "undefined" evidence rows flagged on 2026-10-07; those came from the
-- service adapters. Each run reads the newest 100 vehicles that still miss a spec, so new arrivals are decoded within 15
-- minutes. Rows that NHTSA cannot fill are read again on later runs, which costs nothing.
--
-- WHAT: cron.alter_job(315, active := true), following 20261006123000_enable_gooding_intake.sql. The schedule
-- '2-59/15 * * * *' and batch_size 100 are unchanged.
-- Bound: 100 vehicles per run, at most 9,600 a day.
-- Measure: vehicles created after this migration with a 17-character VIN and a NULL body_style fall to the share NHTSA
-- cannot fill.
-- Stop rule: pause the job if its calls return non-200 on more than half the runs of a day.
-- Reversal: select cron.alter_job(315, active := false);
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobid = 315 AND jobname = 'batch-vin-decode-backfill'
      AND command LIKE '%/functions/v1/batch-vin-decode%' AND command LIKE '%get_service_role_key_for_cron()%'
  ) THEN
    RAISE EXCEPTION 'job 315 is not batch-vin-decode-backfill calling batch-vin-decode with the cron key; refusing to enable';
  END IF;
  PERFORM cron.alter_job(job_id := 315, active := true);
  IF NOT (SELECT active FROM cron.job WHERE jobid = 315) THEN
    RAISE EXCEPTION 'job 315 is still inactive';
  END IF;
  RAISE NOTICE 'job 315 batch-vin-decode-backfill active on %', (SELECT schedule FROM cron.job WHERE jobid = 315);
END $$;

COMMIT;
